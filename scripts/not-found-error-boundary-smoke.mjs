// Página 404 y ErrorBoundary global. Sin Firebase ni emuladores:
//  - comprobaciones estáticas sobre el código (AST con @babel/parser);
//  - renderizado de prueba con Vite ssrLoadModule + renderToStaticMarkup, el
//    mismo patrón de scripts/additional-selector-smoke.mjs.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {MemoryRouter} from "react-router-dom";
import {createServer} from "vite";
import {parse} from "@babel/parser";
import traverseModule from "@babel/traverse";
import {isKnownAppPath} from "../src/domain/knownRoutes.mjs";
import {isKnownBusinessPath} from "../src/domain/rbac.mjs";

const traverse = traverseModule.default ?? traverseModule;
const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const parseJsx = (code) => parse(code, {sourceType: "module", plugins: ["jsx"]});

const appSource = await read("src/app/App.jsx");
const appLayoutSource = await read("src/layout/AppLayout.jsx");
const platformLayoutSource = await read("src/platform/PlatformAdminLayout.jsx");
const boundarySource = await read("src/components/AppErrorBoundary.jsx");
const notFoundSource = await read("src/components/NotFoundPage.jsx");
const statusSource = await read("src/components/AppStatusPage.jsx");

// --- Ayudas de AST -----------------------------------------------------------
const elementName = (element) => element.openingElement.name.name;
const childElements = (element) => element.children.filter((child) => child.type === "JSXElement");
function attribute(element, name) {
  const found = element.openingElement.attributes.find((entry) => entry.name?.name === name);
  if (!found) return undefined;
  return found.value?.type === "StringLiteral" ? found.value.value : found.value;
}
function findElements(code, name) {
  const found = [];
  traverse(parseJsx(code), {JSXElement(path) { if (elementName(path.node) === name) found.push(path.node); }});
  return found;
}
const sourceOf = (code, node) => code.slice(node.start, node.end);
// Última ruta efectiva: baja por los Route de layout (sin path) hasta una con path.
function effectiveLastRoute(routes) {
  let element = childElements(routes).at(-1);
  while (element && attribute(element, "path") === undefined && childElements(element).length) {
    element = childElements(element).at(-1);
  }
  return element;
}

// --- 1) La ruta comodín existe, es la última y muestra la página 404 ----------
const allRoutes = findElements(appSource, "Routes");
assert.equal(allRoutes.length, 7, "App.jsx monta 7 bloques <Routes>");
const byMarker = (marker) => allRoutes.filter((routes) => sourceOf(appSource, routes).includes(marker));
const [businessRoutes] = byMarker('"/ventas/:ventaId"');
const [platformRoutes] = byMarker('"/admin/dashboard"');
const [anonymousRoutes] = byMarker("<LoginPage />");
assert.ok(businessRoutes && platformRoutes && anonymousRoutes, "no se encontraron los bloques de rutas esperados");

for (const routes of allRoutes) {
  if (sourceOf(appSource, routes).includes('"/privacidad"')) continue; // solo se monta con una ruta exacta
  const last = effectiveLastRoute(routes);
  assert.equal(attribute(last, "path"), "*", `el último Route de ${sourceOf(appSource, routes).slice(0, 80)} debe ser el comodín`);
}
for (const [label, routes] of [["con sesión", businessRoutes], ["consola de plataforma", platformRoutes], ["sin sesión", anonymousRoutes]]) {
  const wildcard = effectiveLastRoute(routes);
  assert.match(sourceOf(appSource, wildcard), /<NotFoundPage\b/, `el comodín ${label} debe mostrar la página 404`);
}
// El comodín con sesión vive dentro del layout (menú y encabezado visibles) y después del grupo con compuerta.
const layoutRoute = childElements(businessRoutes).at(-1);
assert.match(sourceOf(appSource, layoutRoute.openingElement), /<AppLayout\b/);
assert.match(sourceOf(appSource, layoutRoute.openingElement), /homePath=\{safeLanding\}/, "AppLayout recibe el inicio del rol para el botón del error");
assert.equal(attribute(childElements(layoutRoute).at(-1), "path"), "*");
assert.match(sourceOf(appSource, childElements(layoutRoute).at(-1)), /homePath=\{safeLanding\}/);
// Sin sesión: lo privado va al ingreso, lo inexistente a la 404 con botón hacia /login.
const anonymousWildcard = sourceOf(appSource, effectiveLastRoute(anonymousRoutes));
assert.match(anonymousWildcard, /isKnownAppPath\(location\.pathname\)/);
assert.match(anonymousWildcard, /<Navigate to="\/login" replace \/>/);
assert.match(anonymousWildcard, /homePath="\/login"/);
assert.match(anonymousWildcard, /variant="screen"/);
// Con sesión solo se redirige una ruta que existe y no se puede abrir.
assert.match(
  appSource,
  /isKnownBusinessPath\(location\.pathname, businessPathOptions\) &&\s*!canAccessBusinessPath\(/,
  "la redirección por permiso no debe tragarse las rutas inexistentes"
);
// Ningún Route con comodín redirige en silencio después de la 404.
assert.equal((appSource.match(/<Route path="\*" element=\{<Navigate to=\{safeLanding\}/g) || []).length, 0);

// --- 2) El ErrorBoundary envuelve el contenido -------------------------------
const globalBoundary = findElements(appSource, "RouteErrorBoundary");
assert.equal(globalBoundary.length, 1);
assert.equal(attribute(globalBoundary[0], "variant"), "screen");
assert.match(sourceOf(appSource, globalBoundary[0]), /<AppRoutes\b/, "el boundary global envuelve las rutas");
for (const [label, code] of [["AppLayout", appLayoutSource], ["PlatformAdminLayout", platformLayoutSource]]) {
  const boundaries = findElements(code, "RouteErrorBoundary");
  assert.equal(boundaries.length, 1, `${label} acota el contenido con un boundary`);
  assert.match(sourceOf(code, boundaries[0]), /<Outlet\b/, `${label}: el boundary envuelve el Outlet`);
  assert.ok(!/variant="screen"/.test(sourceOf(code, boundaries[0].openingElement)), `${label}: boundary de contenido, no de pantalla`);
}
assert.match(appLayoutSource, /homePath=\{homePath\}/);

// --- 3) Ni la 404 ni el boundary muestran error.message ni la pila ------------
function memberAccesses(code) {
  const found = [];
  traverse(parseJsx(code), {
    MemberExpression(path) {
      const name = path.node.property.name || path.node.property.value;
      if (!["message", "stack", "componentStack", "toString"].includes(name)) return;
      const call = path.findParent((parent) => parent.isCallExpression());
      const insideConsoleError = call?.node.callee.object?.name === "console" && call.node.callee.property?.name === "error";
      found.push({name, insideConsoleError});
    },
    JSXExpressionContainer(path) {
      if (/\b(error|info|message|stack)\b/.test(code.slice(path.node.start, path.node.end))) {
        found.push({name: `JSX:${code.slice(path.node.start, path.node.end)}`, insideConsoleError: false});
      }
    },
  });
  return found;
}
for (const [label, code] of [["AppErrorBoundary", boundarySource], ["NotFoundPage", notFoundSource], ["AppStatusPage", statusSource]]) {
  const leaks = memberAccesses(code).filter((entry) => !entry.insideConsoleError);
  assert.deepEqual(leaks, [], `${label} no debe leer ni mostrar message/stack del error`);
}
assert.match(boundarySource, /static getDerivedStateFromError\(\) \{\s*return \{failed: true\};/, "el estado solo guarda que falló, no el error");
assert.doesNotMatch(boundarySource, /this\.state\.(error|message|stack)/);

// --- 4) El error se registra con console.error y no sale a ningún servicio ----
assert.match(boundarySource, /componentDidCatch\(error, info\) \{\s*console\.error\(/);
for (const [label, code] of [["AppErrorBoundary", boundarySource], ["NotFoundPage", notFoundSource], ["AppStatusPage", statusSource]]) {
  assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|firebase|sentry|analytics|httpsCallable/i, `${label} no envía nada fuera`);
}

// --- 5) Botones: "Ir al inicio" respeta la sesión -----------------------------
assert.match(notFoundSource, /navigate\(homePath, \{replace: true\}\)/);
assert.match(boundarySource, /onGoHome\(homePath\)/);
assert.match(boundarySource, /resetKey=\{location\.key\}/, "navegar a otra pantalla limpia el error");

// --- 6) Rutas conocidas: lo inexistente no se confunde con lo prohibido -------
for (const known of ["/", "/login", "/onboarding", "/ventas", "/ventas/nueva", "/ventas/abc/editar", "/ordenes-compra/abc", "/cuenta", "/dashboard", "/admin", "/admin/empresas/x"]) {
  assert.equal(isKnownAppPath(known), true, `${known} existe`);
}
for (const unknown of ["/foo", "/ventas-x", "/clientesabc", "/no/existe", "/administracion", "/Ventas2", "/login/otra"]) {
  assert.equal(isKnownAppPath(unknown), false, `${unknown} no existe`);
}
assert.equal(isKnownBusinessPath("/finanzas/x"), true);
assert.equal(isKnownBusinessPath("/foo"), false);
assert.equal(isKnownBusinessPath("/taller/ordenes", {registry: [{id: "taller", basePath: "/taller"}]}), true, "las rutas de un vertical registrado existen");
assert.equal(isKnownBusinessPath("/taller/ordenes"), false, "sin vertical registrado no existen");

// --- 7) Renderizado de prueba (Vite ssrLoadModule + renderToStaticMarkup) -----
const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
const originalConsoleError = console.error;
const originalFetch = globalThis.fetch;
try {
  const {default: NotFoundPage} = await vite.ssrLoadModule("/src/components/NotFoundPage.jsx");
  const {ErrorBoundary, RouteErrorBoundary, renderErrorFallback} = await vite.ssrLoadModule("/src/components/AppErrorBoundary.jsx");
  const inRouter = (element) => renderToStaticMarkup(React.createElement(MemoryRouter, {initialEntries: ["/no-existe"]}, element));
  const JARGON = /404|undefined|null|stack|exception|error:|firebase|firestore|\bat \w+ \(|TypeError|\.jsx/i;

  // Página 404 dentro del layout (h2: el h1 lo pone el encabezado) y de pantalla completa (h1).
  const content = inRouter(React.createElement(NotFoundPage, {homePath: "/reportes"}));
  assert.match(content, /No encontramos esta página/);
  assert.match(content, /La dirección que abriste no existe o cambió de lugar/);
  assert.match(content, /<h2 id="not-found-title"/);
  assert.doesNotMatch(content, /<h1/);
  assert.match(content, /<button[^>]*type="button"[^>]*>(?:(?!<\/button>).)*Ir al inicio/s);
  assert.match(content, /ui-empty-state--panel/);
  assert.doesNotMatch(content, JARGON);
  const screen = inRouter(React.createElement(NotFoundPage, {variant: "screen", homePath: "/login", homeLabel: "Ir a iniciar sesión"}));
  assert.match(screen, /<h1 id="not-found-title"/);
  assert.match(screen, /Ir a iniciar sesión/);
  assert.doesNotMatch(screen, /Ir al inicio/);
  assert.match(screen, /onboarding-card--message/);
  assert.doesNotMatch(screen, JARGON);
  // Sin colores ni medidas literales en el marcado.
  assert.doesNotMatch(content + screen, /style=|#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);

  // Mensaje de error: reintentar + ir al inicio, sin message ni pila.
  const SECRET = "SECRETO-DEL-ERROR-123";
  const failure = Object.assign(new Error(SECRET), {stack: `Error: ${SECRET}\n    at Boom (/src/pages/Boom.jsx:10:5)`});
  const fallbackMarkup = (variant) => renderToStaticMarkup(renderErrorFallback({variant, homePath: "/", onGoHome() {}, reset() {}}));
  for (const variant of ["screen", "content"]) {
    const markup = fallbackMarkup(variant);
    assert.match(markup, /Algo salió mal/);
    assert.match(markup, /role="alert"/);
    assert.match(markup, /Reintentar/);
    assert.match(markup, /Ir al inicio/);
    assert.equal((markup.match(/<button/g) || []).length, 2, "un botón para reintentar y otro para ir al inicio");
    assert.doesNotMatch(markup, JARGON);
  }
  assert.match(fallbackMarkup("screen"), /<h1 id="app-error-title"/);
  assert.match(fallbackMarkup("content"), /<h2 id="app-error-title"/);

  // Comportamiento del boundary sin DOM: estado, registro y reinicio.
  assert.deepEqual(ErrorBoundary.getDerivedStateFromError(failure), {failed: true}, "el estado no guarda el error");
  const calls = [];
  const instance = new ErrorBoundary({
    resetKey: "a",
    renderFallback: ({reset}) => React.createElement("div", {"data-fallback": "1"}, typeof reset),
    children: React.createElement("p", null, "contenido sano"),
  });
  assert.equal(renderToStaticMarkup(instance.render()), "<p>contenido sano</p>", "sin error muestra el contenido");
  const logged = [];
  console.error = (...args) => logged.push(args);
  globalThis.fetch = () => { throw new Error("el boundary no debe llamar a la red"); };
  instance.componentDidCatch(failure, {componentStack: "\n    at Boom"});
  assert.equal(logged.length, 1, "registra el error con console.error");
  assert.equal(logged[0][1], failure);
  console.error = originalConsoleError;
  instance.state = {failed: true};
  const failedMarkup = renderToStaticMarkup(instance.render());
  assert.equal(failedMarkup, '<div data-fallback="1">function</div>');
  assert.ok(!failedMarkup.includes(SECRET));
  instance.setState = (value) => calls.push(value);
  instance.reset();
  assert.deepEqual(calls.splice(0), [{failed: false}], "Reintentar limpia el error");
  instance.props = {...instance.props, resetKey: "a"};
  instance.componentDidUpdate({resetKey: "a"});
  assert.deepEqual(calls, [], "sin cambio de ruta el error se mantiene");
  instance.props = {...instance.props, resetKey: "b"};
  instance.componentDidUpdate({resetKey: "a"});
  assert.deepEqual(calls.splice(0), [{failed: false}], "cambiar de ruta limpia el error");
  instance.state = {failed: false};
  instance.componentDidUpdate({resetKey: "a"});
  assert.deepEqual(calls, [], "sin error no hay nada que limpiar");

  // El boundary de rutas deja pasar un contenido sano.
  const healthy = inRouter(React.createElement(RouteErrorBoundary, {homePath: "/"}, React.createElement("p", null, "pantalla sana")));
  assert.equal(healthy, "<p>pantalla sana</p>");
} finally {
  console.error = originalConsoleError;
  globalThis.fetch = originalFetch;
  await vite.close();
}

console.log("Not found + error boundary smoke: OK");
