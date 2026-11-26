import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";
import {scanCss, scanJs} from "./design-smoke.mjs";

// <Notice> (src/components/ui/Notice.jsx): cuatro variantes con icono decorativo y texto visible,
// un solo role por aviso, solo tokens. Mismo patrón que disclosure-smoke: Vite ssrLoadModule +
// renderToStaticMarkup, sin Firebase.

const count = (markup, pattern) => (markup.match(pattern) || []).length;
const VARIANTS = {
  error: {icon: "lucide-circle-x", role: "alert", tokens: ["danger-50", "danger-200", "danger-700"]},
  info: {icon: "lucide-info", role: "status", tokens: ["info-50", "info-200", "info-700"]},
  success: {icon: "lucide-circle-check", role: "status", tokens: ["success-50", "success-200", "success-700"]},
  warning: {icon: "lucide-circle-alert", role: "status", tokens: ["warning-50", "warning-200", "warning-800"]},
};

const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});

try {
  const {default: Notice} = await vite.ssrLoadModule("/src/components/ui/Notice.jsx");
  const render = (props, children = "Texto del aviso") => renderToStaticMarkup(React.createElement(Notice, props, children));

  // --- Cada variante: clase, icono propio decorativo, texto visible y role por defecto ---
  for (const [variant, expected] of Object.entries(VARIANTS)) {
    const markup = render({variant});
    assert.doesNotMatch(markup, /undefined|NaN|<!--|\[object/);
    assert.match(markup, new RegExp(`^<div class="ui-notice ui-notice--${variant}" role="${expected.role}">`), `${variant}: clase y role por defecto`);
    assert.equal(count(markup, /<svg\b/g), 1, `${variant}: un solo icono`);
    assert.ok(markup.includes(expected.icon), `${variant}: icono ${expected.icon}`);
    assert.match(markup, /<svg[^>]*aria-hidden="true"/, `${variant}: icono decorativo`);
    assert.equal(count(markup, /aria-label=|role="img"/g), 0, `${variant}: el icono no es el portador del significado`);
    assert.match(markup, /<div class="ui-notice__body">Texto del aviso<\/div>/, `${variant}: texto visible`);
    assert.equal(count(markup, /role=|aria-live/g), 1, `${variant}: un solo role, sin aria-live`);
  }
  assert.equal(new Set(Object.values(VARIANTS).map((v) => v.icon)).size, 4, "cuatro iconos distintos: el amarillo no se confunde con el error sin color");
  console.log("OK: Notice — 4 variantes con icono propio aria-hidden, texto visible y un solo role");

  // --- Por defecto info; variante desconocida cae a info ---
  assert.match(render({}), /^<div class="ui-notice ui-notice--info" role="status">/);
  assert.match(render({variant: "peligro"}), /^<div class="ui-notice ui-notice--info" role="status">/);

  // --- role explícito, role={null} sin role, className extra al final, props extra ---
  assert.match(render({role: "alert", variant: "warning"}), /^<div class="ui-notice ui-notice--warning" role="alert">/);
  const staticNotice = render({role: null, variant: "warning"});
  assert.equal(count(staticNotice, /role=|aria-live/g), 0, "role={null} deja el aviso estático");
  assert.match(render({className: "auth-wait__notice", variant: "warning"}), /^<div class="ui-notice ui-notice--warning auth-wait__notice" role="status">/);
  assert.match(render({id: "aviso", variant: "warning"}), /id="aviso"/);

  // --- title, actions y cuerpo opcionales: nada vacío en el DOM ---
  const bare = renderToStaticMarkup(React.createElement(Notice, {variant: "warning"}));
  assert.equal(count(bare, /ui-notice__body|ui-notice__title|ui-notice__actions/g), 0, "sin contenido no hay cajas vacías");
  const full = renderToStaticMarkup(React.createElement(
    Notice,
    {actions: React.createElement("button", {type: "button"}, "Reenviar"), title: "Primero verifica tu correo", variant: "warning"},
    "Te enviamos un mensaje."
  ));
  assert.match(full, /<strong class="ui-notice__title">Primero verifica tu correo<\/strong>/);
  assert.match(full, /<div class="ui-notice__actions"><button type="button">Reenviar<\/button><\/div>/);
  assert.equal(count(full, /<button\b/g), 1, "el aviso no crea botones por su cuenta");
  assert.equal(count(full, /<h1\b|<h2\b/g), 0, "el aviso no crea encabezados");
  console.log("OK: Notice — role por defecto y explícito, className extra, title/actions opcionales");

  // --- Estilos: 0 literales, solo tokens que existen, todas las clases con regla ---
  const css = await readFile(new URL("../src/styles/components.css", import.meta.url), "utf8");
  const tokens = await readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
  const rules = [...css.matchAll(/(\.ui-notice[^{]*)\{([^}]*)\}/g)];
  assert.ok(rules.length >= 10, `existen las reglas del aviso (${rules.length})`);
  const block = rules.map((m) => m[0]).join("\n");
  assert.deepEqual(scanCss(block), [], "0 literales de color/radio/sombra/duración según test:design");
  assert.doesNotMatch(block, /color:\s*var\(--color-(brand-\d+|dark-[a-z0-9-]+)\)/, "ningún color de marca fija ni dark-* como texto (modo oscuro)");
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\\[0-9a-fA-F]{4}/, "sin hex, rgb() ni escapes unicode");
  for (const name of new Set([...block.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]))) {
    assert.match(tokens, new RegExp(String.raw`${name}\s*:`), `${name} existe en tokens.css`);
  }
  const markupAll = Object.keys(VARIANTS).map((variant) => render({actions: "a", title: "t", variant})).join("");
  for (const className of new Set([...markupAll.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => c.startsWith("ui-notice")))) {
    assert.match(css, new RegExp(String.raw`\.${className}\b[^{]*\{`), `${className} tiene regla en components.css`);
  }
  for (const [variant, expected] of Object.entries(VARIANTS)) {
    const [bg, border, text] = expected.tokens;
    const rule = css.match(new RegExp(String.raw`\.ui-notice--${variant} \{([^}]*)\}`))?.[1] ?? "";
    assert.ok(rule.includes(`background: var(--color-${bg});`), `${variant}: fondo ${bg}`);
    assert.ok(rule.includes(`border-color: var(--color-${border});`), `${variant}: borde ${border}`);
    assert.ok(rule.includes(`color: var(--color-${text});`), `${variant}: texto ${text}`);
  }
  console.log("OK: estilos del aviso — 0 literales, tokens existentes, clases con regla, par de cada variante");

  // --- Los pares de cada variante están medidos por test:contrast ---
  const contrast = await readFile(new URL("./contrast-smoke.mjs", import.meta.url), "utf8");
  for (const {tokens: [bg, border, text]} of Object.values(VARIANTS)) {
    assert.ok(contrast.includes(`{fg: "--color-${text}", bg: "--color-${bg}", kind: "text"`), `${text}/${bg} está en test:contrast`);
    assert.ok(contrast.includes(`{fg: "--color-${border}", bg: "--color-${bg}", kind: "nontext"`), `${border}/${bg} está en test:contrast`);
  }

  // --- Fuente: sin estilos inline, literales, emojis ni escapes \uXXXX ---
  const source = await readFile(new URL("../src/components/ui/Notice.jsx", import.meta.url), "utf8");
  assert.deepEqual(scanJs(source, "Notice.jsx"), [], "Notice.jsx: 0 literales según test:design");
  assert.doesNotMatch(source, /style=|#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  assert.doesNotMatch(source, /\\u[0-9a-fA-F]{4}|\\u\{/, "sin escapes \\uXXXX");
  assert.doesNotMatch(source, /\p{Extended_Pictographic}/u, "sin emojis: los iconos son de lucide-react");
  assert.match(source, /from "lucide-react"/);
  console.log("OK: fuente de Notice — sin estilos inline, literales, emojis ni \\u");
  console.log("NOTICE_SMOKE_OK");
} finally {
  await vite.close();
}
