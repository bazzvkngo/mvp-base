// Guardia de tildes: ningún texto que ve la persona (texto JSX, atributos de
// texto y cadenas con espacios) puede traer palabras castellanas sin tilde.
// Solo mira cadenas visibles: no identificadores, claves, rutas, clases CSS ni
// valores de datos (cadenas de una sola palabra fuera de atributos de texto).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Palabras que en castellano siempre llevan tilde (no verbos ni sustantivos
// que existan también sin ella).
const FORBIDDEN = [
  "sesion", "sesiones", "navegacion", "importacion", "historico", "historica", "informacion",
  "configuracion", "direccion", "descripcion", "verificacion", "cotizacion", "recepcion",
  "categoria", "categorias", "codigo", "codigos", "telefono", "tecnico", "tecnica", "linea",
  "lineas", "seccion", "operacion", "gestion", "version", "opcion", "accion", "pagina",
  "paginas", "ultimo", "ultima", "proximo", "proxima", "minimo", "maximo", "segun", "tambien",
  "ademas", "aqui", "mas", "exito", "mostrara", "ordenes", "item", "items", "area", "areas",
  "numero", "titulo", "identificacion", "devolucion", "credito",
  // Adjetivos: "una fecha válida", "no son válidos". El verbo "valida" no se usa en textos de pantalla.
  "valida", "validas", "valido", "validos", "invalida", "invalidas", "invalido", "invalidos",
  // Al revés que las demás: la forma con tilde es la prohibida. Según la RAE, «solo» ya no lleva tilde.
  "sólo",
];

// Atributos cuyo valor lee la persona.
const TEXT_ATTRIBUTES = new Set([
  "aria-label", "aria-description", "title", "placeholder", "alt", "label", "description",
  "subtitle", "eyebrow", "help", "hint", "legend", "emptyMessage", "menuLabel", "ariaLabel",
  "message", "text", "heading", "caption",
]);
const SKIPPED_ATTRIBUTES = new Set([
  "className", "id", "to", "path", "href", "htmlFor", "key", "name", "value", "type", "role",
  "field", "targetId", "documentKey", "variant", "form", "data-inventory-field", "style",
]);

// Cadenas que no ve la persona: claves normalizadas (sin tildes a propósito) con
// las que se comparan encabezados y nombres ya sin acentos.
const ALLOWED_NORMALIZED_KEYS = [
  {file: "src/services/inventoryImportService.js", reason: "alias de encabezados, se comparan sin tildes"},
  {file: "src/domain/inventoryCatalog.mjs", text: "otra categoria", reason: "comparación con el nombre normalizado"},
];
const isAllowedKey = (label, text) => ALLOWED_NORMALIZED_KEYS.some(
  (entry) => entry.file === label && (!entry.text || entry.text === text)
);

function listSourceFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(full));
    else if (/\.(jsx?|mjs)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const wordPattern = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g;
function findForbidden(text) {
  const found = new Set();
  for (const word of text.match(wordPattern) || []) {
    if (word === word.toUpperCase() && word.length > 1) continue; // constantes
    const lower = word.toLowerCase();
    if (FORBIDDEN.includes(lower)) found.add(word);
    // Plural mal armado: "cotizaciónes", "sesiónes" (el plural de -ción/-sión es -ciones/-siones, sin tilde).
    else if (MISSPELLED_PLURAL.test(word)) found.add(word);
  }
  return [...found];
}

const MISSPELLED_PLURAL = /(ci|si)ónes$/i;
// Plural armado a mano en JSX o plantillas: la palabra termina en -ción/-sión y el plural se pega con una
// expresión que aporta "es" (`cotización{n === 1 ? "" : "es"}`), que en pantalla queda "cotizaciónes". La
// cadena literal "ciónes" no existe en el código, así que se detecta la forma que la arma.
const ENDS_IN_SINGULAR = /(ci|si)[óo]n$/i;
const containsEsLiteral = (path) => {
  let found = false;
  const check = (node) => { if (node.type === "StringLiteral" && node.value === "es") found = true; };
  check(path.node);
  path.traverse({StringLiteral(inner) { check(inner.node); }});
  return found;
};

const slugLike = /^[a-z0-9_\-:/.#?=&[\]{}()]+$/;
const cssLike = /__|--|^[#.][\w-]/; // clases BEM y selectores CSS
const isConsoleArgument = (parent) =>
  parent.type === "CallExpression" &&
  parent.callee?.type === "MemberExpression" &&
  parent.callee.object?.name === "console";
export function collectVisibleTextFindings(code, label = "fuente") {
  const ast = parser.parse(code, {sourceType: "module", plugins: ["jsx"], errorRecovery: true});
  const findings = [];
  const add = (node, text, kind) => {
    // {numero}, {proyecto}...: nombres de variable de plantillas, no texto.
    const visible = text.replace(/[{][A-Za-z_]+[}]/g, " ");
    if (isAllowedKey(label, text.trim())) return;
    const words = findForbidden(visible);
    if (words.length) findings.push({label, line: node.loc.start.line, kind, words, text: text.trim().slice(0, 100)});
  };
  const addHandBuiltPlural = (node, before) => findings.push({label, line: node.loc.start.line, kind: "plural", words: ["ción+es"], text: before.trim().slice(-60)});
  traverse(ast, {
    JSXExpressionContainer(p) {
      const siblings = p.parent.children || [];
      const previous = siblings[siblings.indexOf(p.node) - 1];
      if (previous?.type === "JSXText" && ENDS_IN_SINGULAR.test(previous.value) && p.get("expression").isExpression() && containsEsLiteral(p.get("expression"))) addHandBuiltPlural(p.node, previous.value);
    },
    TemplateLiteral(p) {
      p.node.quasis.forEach((quasi, index) => {
        const expression = p.get("expressions")[index];
        const text = quasi.value.cooked ?? quasi.value.raw;
        if (expression && /s/.test(text) && ENDS_IN_SINGULAR.test(text) && containsEsLiteral(expression)) addHandBuiltPlural(quasi, text);
      });
    },
    JSXText(p) {
      if (p.node.value.trim()) add(p.node, p.node.value, "jsx");
    },
    StringLiteral(p) {
      const parent = p.parent;
      if (["ImportDeclaration", "ExportAllDeclaration", "ExportNamedDeclaration"].includes(parent.type)) return;
      if ((parent.type === "ObjectProperty" || parent.type === "ObjectMethod") && parent.key === p.node && !parent.computed) return;
      if (parent.type === "JSXAttribute") {
        const name = parent.name.name;
        if (SKIPPED_ATTRIBUTES.has(name) || !TEXT_ATTRIBUTES.has(name)) return;
        add(p.node, p.node.value, `attr:${name}`);
        return;
      }
      const value = p.node.value;
      if (isConsoleArgument(parent) || cssLike.test(value)) return;
      if (!/\s/.test(value) || slugLike.test(value)) return; // identificadores, rutas y claves
      add(p.node, value, "string");
    },
    TemplateElement(p) {
      const value = p.node.value.cooked ?? p.node.value.raw;
      if (!/\s/.test(value) || cssLike.test(value)) return;
      // Plantillas de CSS-en-JS o de código: no son texto de pantalla.
      if (/[{};:]\s*[.#a-z-]+\s*[{:]/.test(value) && /[{}]/.test(value)) return;
      add(p.node, value, "template");
    },
  });
  return findings;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // 1) La guardia detecta una palabra sin tilde en texto JSX, atributo y cadena.
  const sample = collectVisibleTextFindings(
    'const a = <button aria-label="Abrir navegacion">Cerrar sesion</button>; const b = "Proveedor historico"; const c = "/ordenes-compra"; const d = {field: "telefono"};',
    "muestra"
  );
  assert.deepEqual(sample.map((entry) => entry.words[0]).sort(), ["historico", "navegacion", "sesion"]);
  // ...y respeta las versiones con tilde.
  assert.equal(
    collectVisibleTextFindings('const a = <b aria-label="Abrir navegación">Cerrar sesión</b>; const x = "Proveedor histórico";', "muestra").length,
    0
  );

  // 1b) Plurales de -ción/-sión: la forma escrita ("ciónes") y la armada a mano pegando "es" a la palabra.
  const pluralSample = collectVisibleTextFindings(
    'const a = "Hay 3 cotizaciónes"; const b = <span>{n} cotización{n === 1 ? "" : "es"}</span>; const c = `${n} sesión${n === 1 ? "" : "es"}`; const d = <p>Tres versiónes</p>;',
    "muestra"
  );
  assert.deepEqual(pluralSample.map((entry) => entry.kind).sort(), ["plural", "plural", "jsx", "string"].sort(), "detecta el literal y las dos formas armadas a mano");
  assert.deepEqual(
    collectVisibleTextFindings('const a = <span>{n} cotización{n === 1 ? "" : "es"} y {n === 1 ? "cotización" : "cotizaciones"}</span>; const b = <b>{n} venta{n === 1 ? "" : "s"}</b>; const c = <i>Tres cotizaciones</i>;', "muestra").filter((entry) => entry.words[0] !== "ción+es"),
    [],
    "el plural correcto y las ventas no se marcan"
  );
  assert.equal(collectVisibleTextFindings('const a = <span>{n === 1 ? "cotización" : "cotizaciones"}</span>; const b = <b>{n} acción{n === 1 ? "" : "es"}</b>;', "muestra").filter((entry) => entry.kind === "plural").length, 1, "solo se marca la palabra con \"es\" pegado");

  // 1c) «sólo» con tilde también es un error en pantalla (se escribe «solo»); un comentario no se marca.
  const soloSample = collectVisibleTextFindings(
    'const a = <p>Disponible sólo hoy</p>; const b = "Sólo el propietario"; const c = <i aria-label="Sólo lectura">x</i>; // sólo en un comentario',
    "muestra"
  );
  assert.equal(soloSample.length, 3, "detecta «sólo» en texto JSX, cadena y atributo");
  assert.equal(collectVisibleTextFindings('const a = <p>Disponible solo hoy</p>; const b = "Solo el propietario";', "muestra").length, 0, "«solo» sin tilde no se marca");

  // 2) Ningún archivo de src/ trae textos visibles sin tilde.
  const failures = [];
  for (const file of listSourceFiles(path.join(ROOT, "src"))) {
    const label = path.relative(ROOT, file).split(path.sep).join("/");
    const findings = collectVisibleTextFindings(fs.readFileSync(file, "utf8"), label);
    for (const f of findings) failures.push(`${f.label}:${f.line} [${f.kind}] ${f.words.join(",")} -> ${JSON.stringify(f.text)}`);
  }
  assert.equal(failures.length, 0, `Textos visibles sin tilde:\n${failures.join("\n")}`);
  console.log("Visible text accents smoke: OK");
}
