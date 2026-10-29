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

  // --- Uso en Empresa: opcionales plegados, obligatorios visibles ---
  const company = await readFile(new URL("../src/features/company/CompanyConfig.jsx", import.meta.url), "utf8");
  const folded = company.slice(company.indexOf("<Disclosure"), company.indexOf("</Disclosure>"));
  assert.ok(folded.length > 0, "Empresa usa el plegable");
  for (const field of ["giro", "codigoPostal", "telefono", "email", "sitioWeb"]) {
    assert.match(folded, new RegExp(`name="${field}"`), `${field} va dentro del plegable`);
  }
  assert.deepEqual(
    [...company.matchAll(/OPTIONAL_INFORMATION_FIELDS = Object\.freeze\(\[([^\]]*)\]/g)][0][1].split(",").map((x) => x.trim().replaceAll('"', "")),
    ["giro", "codigoPostal", "telefono", "email", "sitioWeb"],
    "la lista de opcionales coincide con lo plegado"
  );
  for (const visible of ['name="nombreComercial"', "<BusinessCategoryPicker", 'name="regionCodigo"', 'name="comunaCodigo"', 'name="direccion"']) {
    assert.ok(company.includes(visible), `${visible} existe`);
    assert.ok(!folded.includes(visible), `${visible} NO va plegado`);
  }
  assert.match(folded, /label="Teléfono comercial" targetId="empresa-contacto"/, "el objetivo de foco 'contacto' sigue dentro del plegable");
  // Nada con contenido o con error queda oculto; el foco pedido desde fuera lo abre primero.
  assert.match(company, /OPTIONAL_INFORMATION_FIELDS\.some\(\(field\) => String\(form\[field\] \|\| ""\)\.trim\(\)\)/, "se abre si algún opcional trae contenido");
  assert.match(company, /touched\.email && fieldErrors\.email[\s\S]{0,80}touched\.sitioWeb && fieldErrors\.sitioWeb/, "se abre si hay error de correo o sitio web");
  assert.match(company, /OPTIONAL_FOCUS_TARGETS\.has\(focusTarget\) && !optionalOpen[\s\S]{0,60}setOptionalOpen\(true\)/, "enfocar 'contacto' abre antes de enfocar");
  assert.match(company, /open=\{optionalOpen \|\| !canEdit\}/, "solo lectura: siempre abierto");
  assert.match(company, /disabled=\{!canEdit\}/);
  console.log("OK: Empresa — opcionales plegados, obligatorios visibles, se abre con contenido, error o foco");

  console.log("DISCLOSURE_SMOKE_OK");
} finally {
  await vite.close();
}
