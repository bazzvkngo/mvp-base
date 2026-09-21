import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";

// ETAPA 2 (estados de carga), PASO 5: LoadingScreen de marca
// (src/components/LoadingScreen.jsx) y retraso de aparición (.ui-reveal-delay).
// Sin Firebase: se prueba vía Vite ssrLoadModule + renderToStaticMarkup, mismo
// patrón que skeleton-smoke y button-smoke. Por eso LoadingScreen vive en su
// propio archivo: App.jsx arrastra Firebase y no se puede renderizar aquí.

const count = (text, pattern) => (text.match(pattern) || []).length;
const assertClean = (markup, name) =>
  assert.doesNotMatch(markup, /undefined|NaN|Infinity|<!--/, `${name}: markup sin undefined/NaN/Infinity/comentarios`);

const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});

try {
  const {default: LoadingScreen} = await vite.ssrLoadModule("/src/components/LoadingScreen.jsx");
  const html = (props) => renderToStaticMarkup(React.createElement(LoadingScreen, props));

  // --- Estructura, un único status y BrandLogo fuera de él ---
  const markup = html({});
  assert.match(markup, /^<main class="brand-loader"><div class="brand-loader__content ui-reveal-delay">/, "main.brand-loader > div con ui-reveal-delay (al contenido, no al fondo)");
  assert.equal(count(markup, /role="status"/g), 1, "un único role=status");
  assert.equal(count(markup, /aria-live/g), 0, "sin aria-live (role=status ya implica polite)");
  assert.doesNotMatch(markup, /^<main class="brand-loader ui-reveal-delay"/, "el retraso no va en el contenedor de fondo");

  const statusMatch = markup.match(/<div class="ui-loading-state ui-loading-state--page" role="status">.*?<\/div>/);
  assert.ok(statusMatch, "LoadingState variant=page con role=status");
  const status = statusMatch[0];
  assert.doesNotMatch(status, /brand-logo|ValoraCloud Gestión|role="img"/, "BrandLogo no queda dentro del role=status");
  assert.ok(markup.indexOf("brand-logo brand-logo--auth") > -1, "BrandLogo variant=auth presente");
  assert.ok(markup.indexOf("brand-logo brand-logo--auth") < markup.indexOf('role="status"'), "BrandLogo va antes y como hermano del status");
  assert.equal(count(status, /role=|aria-live/g), 1, "nada más con role ni aria-live dentro del status");
  assert.match(markup, /<span class="ui-spinner ui-spinner--md" aria-hidden="true"><\/span>/, "Spinner md decorativo");
  assertClean(markup, "LoadingScreen");
  console.log("OK: estructura — un único role=status, BrandLogo fuera de él, sin aria-live ni anidamiento");

  // --- Label por defecto y personalizado (un único nodo de texto) ---
  assert.match(markup, /<span class="ui-loading-state__label">Cargando ValoraCloud\.\.\.<\/span>/, "label por defecto");
  const custom = html({label: "Restaurando sesión..."});
  assert.match(custom, /<span class="ui-loading-state__label">Restaurando sesión\.\.\.<\/span>/, "label personalizado");
  assert.doesNotMatch(custom, /Cargando ValoraCloud/);
  assert.equal(count(custom, /role="status"/g), 1);
  for (const bad of [null, 0, NaN, {}, ""]) {
    const badMarkup = html({label: bad});
    assert.equal(count(badMarkup, /role="status"/g), 1);
    assertClean(badMarkup, `LoadingScreen con label ${String(bad)}`);
  }
  assert.match(html({label: undefined}), /Cargando ValoraCloud\.\.\./, "label undefined cae al valor por defecto");
  assertClean(custom, "LoadingScreen con label personalizado");
  console.log("OK: label por defecto y personalizado, y valores inválidos sin undefined/NaN/Infinity");

  // --- CSS y tokens ---
  const [components, tokens, appSource] = await Promise.all([
    readFile(new URL("../src/styles/components.css", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8"),
    readFile(new URL("../src/app/App.jsx", import.meta.url), "utf8"),
  ]);
  const css = components.replace(/\/\*[\s\S]*?\*\//g, "");
  const revealRule = css.match(/\.ui-reveal-delay \{[^}]*\}/)?.[0];
  assert.ok(revealRule, "existe la regla .ui-reveal-delay");
  assert.match(revealRule, /\bboth\b/, "fill-mode both: sin él, con reduced motion el elemento volvería a opacity 0");
  assert.match(revealRule, /var\(--motion-reveal-duration\)/);
  assert.match(revealRule, /var\(--motion-reveal-delay\)/);
  assert.match(revealRule, /animation:\s*ui-reveal /, "shorthand animation");
  assert.equal(count(css, /@keyframes ui-reveal\b/g), 1, "un solo @keyframes ui-reveal");
  const revealKeyframes = css.match(/@keyframes ui-reveal \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(revealKeyframes, /opacity: 0/);
  assert.match(revealKeyframes, /opacity: 1/);
  assert.equal(count(tokens, /--motion-reveal-delay:\s*250ms/g), 1);
  assert.equal(count(tokens, /--motion-reveal-duration:\s*150ms/g), 1);
  const revealStart = css.indexOf(".ui-reveal-delay {");
  const revealEnd = css.indexOf(".brand-loader {");
  assert.ok(revealStart > -1 && revealEnd > revealStart);
  assert.doesNotMatch(css.slice(revealStart, revealEnd), /@media/, "sin @media propio: globals.css cubre reduced motion");

  const loaderRule = css.match(/\.brand-loader \{[^}]*\}/)?.[0];
  assert.ok(loaderRule, "existe la regla .brand-loader");
  assert.match(loaderRule, /min-height: 100dvh/);
  assert.match(loaderRule, /display: grid/);
  assert.match(loaderRule, /place-content: center/);
  assert.match(loaderRule, /justify-items: center/);
  assert.match(loaderRule, /background: var\(--color-surface-canvas\)/);
  assert.doesNotMatch(loaderRule, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i, ".brand-loader solo con tokens");
  assert.match(css, /\.auth-screen \{/, ".auth-screen se conserva (lo usa Login)");
  assert.doesNotMatch(css, /\.auth-screen > \.muted:only-child/, "el hack de LoadingScreen se eliminó");

  // El shimmer no lleva fill-mode: la comprobación se acota a su regla y su keyframes.
  const shimmerRule = css.match(/\.ui-skeleton \{[^}]*\}/)?.[0];
  const shimmerKeyframes = css.match(/@keyframes ui-shimmer \{[\s\S]*?\n\}/)?.[0];
  assert.ok(shimmerRule && shimmerKeyframes);
  assert.doesNotMatch(shimmerRule + shimmerKeyframes, /animation-fill-mode|forwards|\bboth\b/, "sin both en el shimmer");
  console.log("OK: CSS — .ui-reveal-delay con both y los dos tokens, un keyframes, sin @media; .brand-loader solo con tokens; shimmer sin both");

  // --- App.jsx: mismos puntos, misma posición, sin perder EnvironmentNotice ---
  assert.match(appSource, /import LoadingScreen from "\.\.\/components\/LoadingScreen";/);
  assert.doesNotMatch(appSource, /function LoadingScreen/, "App.jsx ya no define su propio LoadingScreen");
  assert.equal(count(appSource, /if \(loading\) return <LoadingScreen \/>;/g), 1);
  assert.equal(count(appSource, /if \(businessLoading\) return <LoadingScreen \/>;/g), 1);
  assert.equal(count(appSource, /<LoadingScreen/g), 2, "solo los 2 puntos originales, sin key ni props");
  assert.equal(count(appSource, /<EnvironmentNotice \/>/g), 1, "EnvironmentNotice sigue una sola vez, fuera de AppRoutes");
  assert.ok(appSource.indexOf("/propuesta/:token") < appSource.indexOf("if (!usuario)"), "la ruta pública sigue antes del guard de autenticación");
  assert.ok(appSource.indexOf("if (loading) return <LoadingScreen />;") < appSource.indexOf("if (businessLoading) return <LoadingScreen />;"));
  console.log("OK: App.jsx — 2 retornos originales, EnvironmentNotice único y ruta pública antes de if (!usuario)");

  console.log("LOADING_SCREEN_SMOKE_OK");
} finally {
  await vite.close();
}
