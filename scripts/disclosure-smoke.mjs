import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";
import {scanCss, scanJs} from "./design-smoke.mjs";

// <Disclosure> (src/components/ui/Disclosure.jsx) y su uso en Empresa (A2): los campos opcionales van
// plegados, los obligatorios no, y nada con contenido o con error queda oculto. Mismo patrón que
// module-header-smoke: Vite ssrLoadModule + renderToStaticMarkup, sin Firebase.

const count = (markup, pattern) => (markup.match(pattern) || []).length;

const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});

try {
  const {default: Disclosure} = await vite.ssrLoadModule("/src/components/ui/Disclosure.jsx");
  const render = (props, children = "Contenido") => renderToStaticMarkup(React.createElement(Disclosure, props, children));

  // --- Cerrado: botón con aria-expanded=false y sin cuerpo ---
  const closed = render({description: "Giro y código postal.", id: "datos", open: false, title: "Más datos"});
  assert.doesNotMatch(closed, /undefined|NaN|<!--|\[object/);
  assert.match(closed, /^<div class="ui-disclosure">/);
  assert.match(closed, /<button type="button" class="ui-disclosure__toggle" aria-expanded="false">/);
  assert.equal(count(closed, /aria-controls/g), 0, "cerrado no apunta a un cuerpo que no existe");
  assert.equal(count(closed, /ui-disclosure__body/g), 0, "cerrado no dibuja el cuerpo (sus campos no se tabulan)");
  assert.doesNotMatch(closed, /Contenido/);
  assert.match(closed, /<strong class="ui-disclosure__title">Más datos<\/strong>/);
  assert.match(closed, /<small class="ui-disclosure__description">Giro y código postal\.<\/small>/);
  assert.match(closed, /aria-hidden="true"/, "el chevron es decorativo");
  assert.equal(count(closed, /<button\b/g), 1);
  assert.equal(count(closed, /role=|aria-live/g), 0, "no es una región de carga ni de aviso");

  // --- Abierto: cuerpo enlazado por aria-controls ---
  const opened = render({id: "datos", open: true, title: "Más datos"});
  assert.match(opened, /^<div class="ui-disclosure is-open">/);
  assert.match(opened, /aria-controls="datos-body" aria-expanded="true"/);
  assert.match(opened, /<div class="ui-disclosure__body" id="datos-body">Contenido<\/div>/);
  assert.equal(count(opened, /ui-disclosure__description/g), 0, "sin descripción no hay <small> vacío");

  // --- Sin id propio usa useId; con className extra al final; disabled se respeta ---
  assert.match(render({open: true, title: "T"}), /aria-controls="[^"]+-body"/);
  assert.match(render({className: "extra", open: false, title: "T"}), /^<div class="ui-disclosure extra">/);
  assert.match(render({disabled: true, open: true, title: "T"}), /<button[^>]*disabled/);
  assert.equal(count(render({open: undefined, title: "T"}), /aria-expanded="false"/g), 1, "open ausente = cerrado");
  console.log("OK: Disclosure — cerrado sin cuerpo, abierto con aria-controls, descripción opcional, disabled");

  // --- Estilos: 0 literales, solo tokens que existen, todas las clases con regla ---
  const css = await readFile(new URL("../src/styles/components.css", import.meta.url), "utf8");
  const tokens = await readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
  const rules = [...css.matchAll(/(\.ui-disclosure[^{]*)\{([^}]*)\}/g)];
  assert.ok(rules.length >= 9, `existen las reglas del plegable (${rules.length})`);
  const block = rules.map((m) => m[0]).join("\n");
  assert.deepEqual(scanCss(block), [], "0 literales de color/radio/sombra/duración según test:design");
  assert.doesNotMatch(block, /color:\s*var\(--color-(brand-\d+|dark-[a-z0-9-]+)\)/, "ningún color de marca fija ni dark-* como texto (modo oscuro)");
  for (const name of new Set([...block.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]))) {
    assert.match(tokens, new RegExp(String.raw`${name}\s*:`), `${name} existe en tokens.css`);
  }
  for (const className of new Set([...(closed + opened).matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => c.startsWith("ui-disclosure")))) {
    assert.match(css, new RegExp(String.raw`\.${className}\b[^{]*\{`), `${className} tiene regla en components.css`);
  }
  assert.match(css, /\.ui-disclosure__toggle:focus-visible \{\s*outline: var\(--focus-outline\);/, "foco visible con el token");
  const componentSource = await readFile(new URL("../src/components/ui/Disclosure.jsx", import.meta.url), "utf8");
  assert.deepEqual(scanJs(componentSource, "Disclosure.jsx"), [], "Disclosure.jsx: 0 literales según test:design");
  assert.doesNotMatch(componentSource, /style=|#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  console.log("OK: estilos del plegable — 0 literales, tokens existentes, clases con regla, foco visible");

  // --- Uso en Empresa (EM1): sin plegable; todo visible y agrupado en "Datos comerciales" y "Contacto" ---
  const company = await readFile(new URL("../src/features/company/CompanyConfig.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(company, /<Disclosure\b|ui\/Disclosure|optionalOpen|setOptionalOpen|OPTIONAL_INFORMATION_FIELDS|OPTIONAL_FOCUS_TARGETS|Más datos de la empresa/, "Empresa ya no usa el plegable ni deja su estado");
  const providerForm = await readFile(new URL("../src/features/providers/ProviderFormDialog.jsx", import.meta.url), "utf8");
  assert.match(providerForm, /<Disclosure\b/, "el componente se conserva: lo usa el formulario de proveedores");
  assert.equal(count(company, /<h3>Datos comerciales<\/h3>/g), 1, "un solo título 'Datos comerciales'");
  assert.equal(count(company, /<h3>Contacto<\/h3>/g), 1, "un solo título 'Contacto'");
  const commercial = company.slice(company.indexOf("<h3>Datos comerciales</h3>"), company.indexOf("<h3>Contacto</h3>"));
  const contact = company.slice(company.indexOf("<h3>Contacto</h3>"), company.indexOf("</fieldset>", company.indexOf("<h3>Contacto</h3>")));
  for (const field of ["nombreComercial", "giro", "regionCodigo", "comunaCodigo", "direccion", "codigoPostal"]) {
    assert.match(commercial, new RegExp(`name="${field}"`), `${field} está visible en Datos comerciales`);
  }
  assert.match(commercial, /<BusinessCategoryPicker/, "el rubro está visible en Datos comerciales");
  for (const field of ["telefono", "email", "sitioWeb"]) {
    assert.match(contact, new RegExp(`name="${field}"`), `${field} está visible en Contacto`);
  }
  assert.match(contact, /label="Teléfono comercial" optional targetId="empresa-contacto"/, "el objetivo de foco 'contacto' sigue en el teléfono");
  // Obligatorios con "*" y opcionales con "Opcional" (la prop que SettingsField ya soporta).
  assert.match(commercial, /<SettingsField label="Nombre comercial" required /);
  assert.match(commercial, /Rubro principal<span aria-hidden="true"> \*<\/span>/, "el rubro lleva el mismo '*' que los demás");
  assert.match(commercial, /<SettingsField label="Región" required /);
  assert.match(commercial, /<SettingsField label="Región \/ Estado" required /);
  assert.match(commercial, /Los campos con \* son obligatorios\./, "leyenda de obligatorios");
  for (const label of ["Giro", "Comuna / ciudad", "Ciudad", "Dirección comercial", "Código postal", "Teléfono comercial", "Correo comercial", "Sitio web"]) {
    assert.match(company, new RegExp(`<SettingsField label="${label.replace("/", "\\/")}" optional`), `${label} lleva 'Opcional'`);
  }
  assert.doesNotMatch(company, /<SettingsField label="(Nombre comercial|Región|Región \/ Estado)"[^>]*optional/, "los obligatorios no llevan 'Opcional'");
  // Placeholders concretos (español de Chile).
  for (const [field, placeholder] of [
    ["nombreComercial", "Ej\\.: Servicios Eléctricos Pérez"],
    ["giro", "Ej\\.: Servicios de ingeniería"],
    ["codigoPostal", "Ej\\.: 1100000"],
    ["direccion", "Calle y número"],
    ["telefono", "\\+56 9 1234 5678"],
    ["email", "contacto@empresa\\.cl"],
    ["sitioWeb", "https:\\/\\/www\\.empresa\\.cl"],
  ]) {
    assert.match(company, new RegExp(`<input name="${field}"[^\\n]*placeholder="${placeholder}"`), `${field} trae su placeholder`);
  }
  // SettingsField no reserva una línea de ayuda vacía y solo usa aria-describedby cuando hay texto.
  const settingsField = company.slice(company.indexOf("function SettingsField("), company.indexOf("function LockedSetting("));
  assert.doesNotMatch(settingsField, /&nbsp;|\u00a0/, "sin línea de ayuda vacía");
  assert.match(settingsField, /\{support && \(\s*<span id=\{supportId\} className="settings-field__support"/, "la ayuda solo existe si hay texto");
  assert.match(settingsField, /React\.cloneElement\(children, \{ "aria-describedby": supportId \}\)/, "el control apunta a la ayuda con aria-describedby");
  assert.match(settingsField, /const canDescribe = Boolean\(support\) && React\.isValidElement\(children\);/, "aria-describedby solo con texto");
  // Sin cambios de validación ni de textos de error.
  for (const message of ["Ingresa el nombre comercial.", "Selecciona un rubro.", "Selecciona una región.", "Ingresa un correo comercial válido.", "Incluye http:// o https:// en la dirección web."]) {
    assert.ok(company.includes(message), `se conserva el texto de error: ${message}`);
  }
  console.log("OK: Empresa — sin plegable, Datos comerciales y Contacto visibles, obligatorios con *, opcionales marcados, placeholders y sin ayuda vacía");

  console.log("DISCLOSURE_SMOKE_OK");
} finally {
  await vite.close();
}
