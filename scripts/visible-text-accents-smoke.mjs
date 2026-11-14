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
  }
  return [...found];
}

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
  traverse(ast, {
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
