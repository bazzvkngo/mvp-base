// Guardia ESTÁTICO del presupuesto de lecturas de Firestore en storage.rules.
//
// Storage Rules solo permite consultar un máximo de 2 documentos distintos de
// Firestore por petición (firestore.get / firestore.exists). Si una regla
// necesita más, la petición se deniega (403) en producción aunque el usuario
// tenga permiso. No se confía en el emulador para detectarlo: este guardia lee
// storage.rules como texto, expande las funciones auxiliares y cuenta, para
// cada `allow`, los documentos distintos que puede leer en el peor caso.
//
// Criterio conservador (nunca subestima):
// - Se cuentan las lecturas de TODAS las ramas de `&&` y `||` (el peor caso).
// - Dos rutas cuentan como el mismo documento solo si, tras sustituir los
//   parámetros de las funciones, son textualmente iguales (get + exists del
//   mismo documento = 1 lectura).
//
// Uso:
//   node scripts/storage-rules-budget-smoke.mjs                  (guardia normal)
//   node scripts/storage-rules-budget-smoke.mjs --no-allowlist   (ignora las
//     excepciones documentadas; sirve para ver qué quedaría fuera de presupuesto)

import {readFileSync} from "node:fs";

const MAX_FIRESTORE_DOCUMENTS = 2;

// Excepciones documentadas. Hoy no hay ninguna: todas las reglas respetan el
// máximo. Si se agregara una, cada entrada fija el máximo tolerado
// (`{match, maxDocuments, reason}`): si la regla empeora por encima de
// `maxDocuments`, el guardia vuelve a fallar, y si la regla ya no existe,
// falla para obligar a retirar la excepción.
const ALLOWLIST = [];

const ignoreAllowlist = process.argv.includes("--no-allowlist");
const rulesSource = readFileSync(new URL("../storage.rules", import.meta.url), "utf8");

// ---------- Utilidades de texto ----------

function stripComments(source) {
  let out = "";
  let quote = null;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      out += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      out += char;
      continue;
    }
    if (char === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    out += char;
  }
  return out;
}

// Devuelve el índice del cierre que corresponde a la apertura en `openIndex`
// (respeta comillas y anidación del mismo tipo de delimitador).
function findClosing(source, openIndex, open, close) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") quote = char;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`No se encontró el cierre de '${open}' abierto en la posición ${openIndex}.`);
}

// Separa por comas de primer nivel (fuera de paréntesis y comillas).
function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = "";
  for (const char of text) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") quote = char;
    if (char === "(" || char === "[" || char === "{") depth += 1;
    if (char === ")" || char === "]" || char === "}") depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim());
}

// Sustituye identificadores sueltos fuera de comillas y que no sean acceso a
// propiedad (`.data.uid` no es el parámetro `uid`).
function substituteIdentifiers(expression, bindings) {
  return expression
    .split(/("[^"]*"|'[^']*')/)
    .map((piece, index) => {
      if (index % 2 === 1) return piece;
      return piece.replace(/(?<![\w.$])[A-Za-z_]\w*(?!\w)/g, (name) =>
        Object.hasOwn(bindings, name) ? bindings[name] : name
      );
    })
    .join("");
}

const isSimpleToken = (text) => /^[\w.]+$/.test(text) || /^("[^"]*"|'[^']*')$/.test(text);
const wrap = (text) => (isSimpleToken(text) ? text : `(${text})`);

// ---------- Parser de storage.rules ----------

const source = stripComments(rulesSource);
const functions = new Map();
const allows = [];

function parseBlock(body, matchPath) {
  let i = 0;
  while (i < body.length) {
    const rest = body.slice(i);
    const skip = rest.match(/^\s+/);
    if (skip) {
      i += skip[0].length;
      continue;
    }
    const fn = rest.match(/^function\s+(\w+)\s*\(([^)]*)\)\s*\{/);
    if (fn) {
      const open = i + fn[0].length - 1;
      const close = findClosing(body, open, "{", "}");
      functions.set(fn[1], {
        params: fn[2].split(",").map((param) => param.trim()).filter(Boolean),
        statements: splitTopLevel(body.slice(open + 1, close), ";"),
      });
      i = close + 1;
      continue;
    }
    const match = rest.match(/^match\s+(\S+)\s*\{/);
    if (match) {
      const open = i + match[0].length - 1;
      const close = findClosing(body, open, "{", "}");
      parseBlock(body.slice(open + 1, close), `${matchPath}${match[1]}`);
      i = close + 1;
      continue;
    }
    if (rest.startsWith("allow")) {
      const header = rest.match(/^allow\s+([\w,\s]+?)\s*:\s*if\s+/);
      if (!header) throw new Error(`allow no reconocido: ${rest.slice(0, 80)}`);
      const end = findAllowEnd(rest);
      allows.push({
        matchPath,
        operations: header[1].split(",").map((op) => op.trim()),
        condition: rest.slice(header[0].length, end).trim(),
      });
      i += end + 1;
      continue;
    }
    throw new Error(`Bloque no reconocido en storage.rules: ${rest.slice(0, 80)}`);
  }
}

function findAllowEnd(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") quote = char;
    else if (char === ";") return i;
  }
  throw new Error("allow sin ';' final.");
}

const serviceMatch = source.match(/service\s+firebase\.storage\s*\{/);
if (!serviceMatch) throw new Error("storage.rules no declara 'service firebase.storage'.");
const serviceOpen = serviceMatch.index + serviceMatch[0].length - 1;
parseBlock(source.slice(serviceOpen + 1, findClosing(source, serviceOpen, "{", "}")), "");
// Las rutas se muestran y se comparan sin el prefijo del bucket.
allows.forEach((allow) => {
  allow.matchPath = allow.matchPath.replace(/^\/b\/\{bucket\}\/o/, "");
});

// ---------- Expansión de funciones y conteo ----------

// Cuerpo de la función con sus parámetros reemplazados por los argumentos y
// sus `let` resueltos, listo para insertarse en la expresión llamadora.
function inlineFunction(name, args, depth) {
  const fn = functions.get(name);
  if (!fn) throw new Error(`Función desconocida: ${name}`);
  if (fn.params.length !== args.length) {
    throw new Error(`${name} espera ${fn.params.length} argumentos y recibió ${args.length}.`);
  }
  const bindings = {};
  fn.params.forEach((param, index) => {
    bindings[param] = wrap(args[index]);
  });
  let result = null;
  for (const statement of fn.statements) {
    const letMatch = statement.match(/^let\s+(\w+)\s*=\s*([\s\S]+)$/);
    if (letMatch) {
      bindings[letMatch[1]] = wrap(substituteIdentifiers(letMatch[2].trim(), bindings));
      continue;
    }
    const returnMatch = statement.match(/^return\s+([\s\S]+)$/);
    if (returnMatch) {
      result = substituteIdentifiers(returnMatch[1].trim(), bindings);
      break;
    }
    throw new Error(`Sentencia no reconocida en ${name}: ${statement.slice(0, 60)}`);
  }
  if (result === null) throw new Error(`La función ${name} no tiene return.`);
  return expandCalls(result, depth + 1);
}

function expandCalls(expression, depth = 0) {
  if (depth > 20) throw new Error("Recursión de funciones demasiado profunda en storage.rules.");
  const callPattern = /(?<![\w.$])([A-Za-z_]\w*)\(/g;
  let match;
  while ((match = callPattern.exec(expression)) !== null) {
    if (!functions.has(match[1])) continue;
    const open = match.index + match[0].length - 1;
    const close = findClosing(expression, open, "(", ")");
    const args = splitTopLevel(expression.slice(open + 1, close), ",");
    const replacement = wrap(inlineFunction(match[1], args, depth));
    return expandCalls(
      expression.slice(0, match.index) + replacement + expression.slice(close + 1),
      depth
    );
  }
  return expression;
}

function firestoreDocuments(expression) {
  const documents = new Set();
  const pattern = /firestore\.(?:get|exists|getAfter|existsAfter)\(/g;
  let match;
  while ((match = pattern.exec(expression)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = findClosing(expression, open, "(", ")");
    let documentPath = expression.slice(open + 1, close).replace(/\s+/g, "");
    // Una ruta devuelta por una función llega envuelta en paréntesis.
    while (documentPath.startsWith("(") && findClosing(documentPath, 0, "(", ")") === documentPath.length - 1) {
      documentPath = documentPath.slice(1, -1);
    }
    documents.add(documentPath);
  }
  return [...documents];
}

// ---------- Evaluación ----------

const rows = allows.map((allow) => {
  const documents = firestoreDocuments(expandCalls(allow.condition));
  return {...allow, documents};
});

const shortDoc = (doc) => doc.replace("/databases/(default)/documents/", "");

console.log(`Presupuesto de lecturas de Firestore por regla de Storage (máximo ${MAX_FIRESTORE_DOCUMENTS}).`);
if (ignoreAllowlist) console.log("(modo --no-allowlist: las excepciones documentadas se ignoran)");
console.log("");

const violations = [];
const matchedExceptions = new Set();
for (const row of rows) {
  const count = row.documents.length;
  const exception = ignoreAllowlist ? null : ALLOWLIST.find((entry) => entry.match === row.matchPath);
  if (exception) matchedExceptions.add(exception.match);
  let status = "OK";
  if (count > MAX_FIRESTORE_DOCUMENTS) {
    if (exception && count <= exception.maxDocuments) status = `EXCEPCIÓN (tolerado hasta ${exception.maxDocuments}: ${exception.reason})`;
    else {
      status = "FUERA DE PRESUPUESTO";
      violations.push(row);
    }
  }
  console.log(`${row.matchPath}  [${row.operations.join(", ")}]  -> ${count} lectura(s)  ${status}`);
  row.documents.forEach((doc) => console.log(`    - ${shortDoc(doc)}`));
}

const staleExceptions = ignoreAllowlist
  ? []
  : ALLOWLIST.filter((entry) => !rows.some((row) => row.matchPath === entry.match));

console.log("");
if (staleExceptions.length) {
  staleExceptions.forEach((entry) =>
    console.error(`La excepción documentada ya no corresponde a ninguna regla: ${entry.match}`)
  );
}
if (violations.length) {
  console.error(`FALLA: ${violations.length} regla(s) superan ${MAX_FIRESTORE_DOCUMENTS} documentos de Firestore por petición:`);
  violations.forEach((row) =>
    console.error(`  - ${row.matchPath} [${row.operations.join(", ")}]: ${row.documents.length} documentos`)
  );
}
if (violations.length || staleExceptions.length) process.exit(1);
console.log("STORAGE_RULES_BUDGET_OK");
