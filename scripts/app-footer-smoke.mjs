import assert from "node:assert/strict";
import {readFile, readdir} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {LEGAL_PROVIDER} from "../src/domain/legalDocumentsContent.mjs";

// Pie mínimo de ValoraCloud (AppFooter): aserciones estáticas sobre el código
// fuente. Solo la razón social, solo en Login y Mi cuenta, nunca en el layout.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFile(path.join(ROOT, file), "utf8");

const [footer, css, login, account] = await Promise.all([
  read("src/components/AppFooter.jsx"),
  read("src/components/app-footer.css"),
  read("src/features/auth/Login.jsx"),
  read("src/pages/AccountPage.jsx"),
]);

// --- Datos: solo la razón social, tomada de LEGAL_PROVIDER ---------------
assert.match(footer, /import \{ LEGAL_PROVIDER \} from "\.\.\/domain\/legalDocumentsContent\.mjs"/);
assert.match(footer, /LEGAL_PROVIDER\.razonSocial/);
assert.match(footer, /new Date\(\)\.getFullYear\(\)/);
assert.match(footer, /ValoraCloud · ©/);
for (const key of ["rut", "domicilio", "correoPrivacidad", "sitio"]) {
  assert.doesNotMatch(footer, new RegExp(`LEGAL_PROVIDER\.${key}\b`), `no usa LEGAL_PROVIDER.${key}`);
}
for (const [key, value] of Object.entries(LEGAL_PROVIDER)) {
  assert.ok(!footer.includes(value), `AppFooter no repite literalmente LEGAL_PROVIDER.${key}`);
  assert.ok(!css.includes(value), `app-footer.css no repite LEGAL_PROVIDER.${key}`);
}
assert.doesNotMatch(footer, /\d{1,2}\.\d{3}\.\d{3}-[\dkK]/, "sin RUT");
assert.doesNotMatch(footer, /@[\w-]+\.\w+/, "sin correo");
assert.doesNotMatch(footer, /mailto:|tel:/, "sin correo ni teléfono");
console.log("OK Footer: solo LEGAL_PROVIDER.razonSocial y el año actual; sin RUT, domicilio ni correo");

// --- Estructura y accesibilidad -----------------------------------------
assert.match(footer, /<footer[\s\S]*?aria-label="Información de la empresa"/);
assert.match(footer, /variant = "ingreso"/);
assert.match(footer, /isAccount && <BrandMark/);
assert.match(footer, /LEGAL_DOCUMENTS\.privacidad, LEGAL_DOCUMENTS\.terminos/);
assert.equal(
  (footer.match(/isAccount && \(\s*<nav/g) || []).length,
  1,
  "los enlaces solo existen en la variante cuenta"
);
console.log("OK Footer: <footer> con aria-label; enlaces y logo solo en la variante cuenta");

// --- Estilos: tokens, foco, oscuro y 390 px -----------------------------
assert.match(footer, /import "\.\/app-footer\.css"/);
assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/, "sin colores literales");
assert.doesNotMatch(css, /border-radius:\s*[^v;]*\d/, "sin radios literales");
assert.doesNotMatch(css, /box-shadow:\s*[^v;\n]*\d/, "sin sombras literales");
assert.doesNotMatch(css, /(?<![\w-])\d*\.?\d+m?s\b/, "sin duraciones literales");
assert.match(css, /\.app-footer__link:focus-visible/);
assert.match(css, /:root\[data-theme="dark"\]/);
assert.match(css, /@media \(max-width: 480px\)[\s\S]*flex-direction: column/);
console.log("OK Footer: solo tokens, foco visible, modo oscuro y apilado a 390 px");

// --- Dónde vive -----------------------------------------------------------
assert.match(login, /import AppFooter from "\.\.\/\.\.\/components\/AppFooter"/);
assert.equal((login.match(/<AppFooter variant="ingreso" \/>/g) || []).length, 1);
assert.ok(
  login.indexOf('className="auth-legal"') < login.indexOf("<AppFooter"),
  "el footer va debajo de la frase de aceptación"
);
assert.match(login, /Al continuar aceptas la /, "se conserva la frase de aceptación");
assert.match(account, /import AppFooter from "\.\.\/components\/AppFooter"/);
assert.equal((account.match(/<AppFooter variant="cuenta" \/>/g) || []).length, 1);

const users = [];
async function walk(dir) {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (/\.(jsx?|mjs)$/.test(entry.name)) {
      const text = await readFile(full, "utf8");
      if (/\bAppFooter\b/.test(text)) users.push(path.relative(ROOT, full).split(path.sep).join("/"));
    }
  }
}
await walk(path.join(ROOT, "src"));
assert.deepEqual(
  users.sort(),
  ["src/components/AppFooter.jsx", "src/features/auth/Login.jsx", "src/pages/AccountPage.jsx"],
  "AppFooter solo aparece en su definición, Login y Mi cuenta"
);
for (const file of ["src/layout/AppLayout.jsx", "src/app/App.jsx"]) {
  assert.doesNotMatch(await read(file), /AppFooter/, `${file} (layout general) no monta el footer`);
}
console.log("OK Footer: existe en Login y Mi cuenta y no en el layout general");
console.log("APP_FOOTER_SMOKE_OK");
