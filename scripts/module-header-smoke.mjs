import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";
import {scanCss, scanJs} from "./design-smoke.mjs";

// <EmptyState> y <ModuleHeader> (src/components/ui/) y la barra superior que no repite el
// título (src/layout/TopbarHeading.jsx + PAGE_HEADING_ROUTES). Mismo patrón que los demás
// smokes de ui/: Vite ssrLoadModule + renderToStaticMarkup, sin Firebase.

const count = (markup, pattern) => (markup.match(pattern) || []).length;
const assertClean = (markup, name) =>
  assert.doesNotMatch(markup, /undefined|NaN|Infinity|<!--|\[object/, `${name}: markup sin undefined/NaN/Infinity/comentarios`);

const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});

try {
  const {default: EmptyState} = await vite.ssrLoadModule("/src/components/ui/EmptyState.jsx");
  const {default: ModuleHeader} = await vite.ssrLoadModule("/src/components/ui/ModuleHeader.jsx");
  const {default: TopbarHeading} = await vite.ssrLoadModule("/src/layout/TopbarHeading.jsx");
  const navigation = await vite.ssrLoadModule("/src/app/navigation.js");
  const {Users, Truck} = await vite.ssrLoadModule("lucide-react");
  const renderEmpty = (props) => renderToStaticMarkup(React.createElement(EmptyState, props));
  const renderHeader = (props) => renderToStaticMarkup(React.createElement(ModuleHeader, props));
  const renderBar = (props) => renderToStaticMarkup(React.createElement(TopbarHeading, props));
  const noop = () => {};

  // =================== EmptyState ===================

  // --- Con botón principal y enlace secundario ---
  const withLink = renderEmpty({
    action: {label: "Crear primer cliente", onClick: noop},
    description: "Cuando registres uno aparecerá aquí.",
    icon: Users,
    links: [{label: "o importa una lista desde Excel", onClick: noop}],
    title: "Aún no tienes clientes",
  });
  assertClean(withLink, "vacío con enlace");
  assert.match(withLink, /^<div class="ui-empty-state ui-empty-state--panel">/, "raíz ui-empty-state + modificador panel");
  assert.doesNotMatch(withLink, /erp-empty-state/, "no depende de .erp-empty-state (declara su propio relleno)");
  assert.equal(count(withLink, /<h2 class="ui-empty-state__title">Aún no tienes clientes<\/h2>/g), 1, "título h2 por omisión");
  assert.equal(count(withLink, /<h1/g), 0, "el vacío nunca dibuja un h1");
  assert.match(withLink, /<p class="ui-empty-state__description">Cuando registres uno aparecerá aquí\.<\/p>/);
  assert.equal(count(withLink, /<button\b/g), 2, "un botón principal + un enlace");
  assert.equal(count(withLink, /ui-button--primary/g), 1, "exactamente un botón principal");
  assert.equal(count(withLink, /class="ui-empty-state__link"/g), 1, "un enlace de texto");
  assert.match(withLink, /<button class="ui-empty-state__link" type="button">o importa una lista desde Excel<\/button>/, "el enlace es texto, no un ui-button");
  assert.doesNotMatch(withLink.match(/<button class="ui-empty-state__link"[^>]*>/)[0], /ui-button/, "el enlace no usa la familia de botones");
  assert.match(withLink, /<span class="ui-empty-state__icon" aria-hidden="true">/, "círculo con el ícono, decorativo");
  assert.equal(count(withLink, /ui-empty-illustration/g), 0, "con icon no se dibuja la ilustración");
  assert.ok(withLink.indexOf("ui-button--primary") < withLink.indexOf("ui-empty-state__link"), "el botón principal va antes que el enlace");
  assert.equal(count(withLink, /role=|aria-live/g), 0, "sin role ni aria-live: no es una región de carga");
  console.log("OK: vacío con enlace — un solo botón principal, enlace de texto, círculo con ícono, h2 y sin h1");

  // --- Sin enlace secundario ---
  const noLink = renderEmpty({action: {label: "Nueva venta", onClick: noop}, title: "Aún no hay ventas"});
  assertClean(noLink, "vacío sin enlace");
  assert.equal(count(noLink, /ui-button--primary/g), 1);
  assert.equal(count(noLink, /ui-empty-state__link/g), 0, "sin links no hay fila de enlaces");
  assert.equal(count(noLink, /<button\b/g), 1);
  assert.equal(count(noLink, /ui-empty-state__description/g), 0, "sin descripción no hay <p> vacío");
  assert.match(noLink, /ui-empty-illustration--empty-list/, "sin icon cae a la ilustración empty-list");
  for (const links of [undefined, null, [], "texto", [{label: "Sin acción"}], [{onClick: noop}], [null]]) {
    const markup = renderEmpty({action: {label: "Crear", onClick: noop}, links, title: "Vacío"});
    assertClean(markup, `links=${JSON.stringify(links)}`);
    assert.equal(count(markup, /ui-empty-state__link/g), 0, `links inválidos (${JSON.stringify(links)}) no dibujan enlaces`);
  }
  assert.match(renderEmpty({illustration: "no-results", title: "Sin resultados"}), /ui-empty-illustration--no-results/, "la variante de ilustración se respeta");
  console.log("OK: vacío sin enlace — sin fila de enlaces ni <p> vacío; links inválidos se ignoran; ilustración por omisión");

  // --- Sin acción principal: no dibuja botón ---
  for (const action of [undefined, null, {}, {label: ""}, {onClick: noop}]) {
    const markup = renderEmpty({action, description: "Pide a un administrador que lo cree.", title: "Aún no hay proveedores"});
    assertClean(markup, `action=${JSON.stringify(action)}`);
    assert.equal(count(markup, /<button\b/g), 0, `sin acción principal (${JSON.stringify(action)}) no hay botón`);
    assert.equal(count(markup, /ui-empty-state__actions/g), 0, "ni contenedor de acciones");
  }
  const onlyLinks = renderEmpty({links: [{label: "Ir al inventario", onClick: noop}], title: "Sin permiso"});
  assert.equal(count(onlyLinks, /ui-button/g), 0, "solo enlaces: ningún botón principal");
  assert.equal(count(onlyLinks, /class="ui-empty-state__link"/g), 1);
  const disabled = renderEmpty({action: {disabled: true, label: "Crear", onClick: noop}, title: "Vacío"});
  assert.match(disabled, /<button[^>]*disabled/, "action.disabled se respeta");
  const withIcon = renderEmpty({action: {icon: Truck, label: "Crear", onClick: noop}, title: "Vacío"});
  assert.match(withIcon, /<button[^>]*>.*<svg.*ui-button__label">Crear</, "action.icon dibuja el ícono antes del texto");
  console.log("OK: vacío sin acción principal — no dibuja botón (ni contenedor); disabled e icon se respetan");

  // --- Nivel del título ---
  assert.match(renderEmpty({headingLevel: 3, title: "T"}), /<h3 class="ui-empty-state__title">T<\/h3>/);
  for (const level of [1, 5, 0, "x", null]) {
    assert.match(renderEmpty({headingLevel: level, title: "T"}), /<h2 class="ui-empty-state__title">T<\/h2>/, `headingLevel=${level} cae a h2 (nunca h1)`);
  }
  assert.match(renderEmpty({className: "extra", title: "T"}), /^<div class="ui-empty-state ui-empty-state--panel extra">/, "className extra al final");
  console.log("OK: nivel del título — 2 por omisión, solo 2-4, nunca h1");

  // =================== ModuleHeader ===================

  const actions = React.createElement("button", {className: "ui-button ui-button--primary", type: "button"}, "Nuevo cliente");

  // --- Con chip y acciones ---
  const full = renderHeader({
    actions,
    chips: ["12 clientes"],
    description: "Quiénes te compran y cómo contactarlos.",
    icon: Users,
    title: "Clientes",
  });
  assertClean(full, "cabecera completa");
  assert.match(full, /^<header class="ui-module-header">/);
  assert.equal(count(full, /<h1 class="ui-module-header__title">Clientes<\/h1>/g), 1, "un único h1");
  assert.match(full, /<p class="ui-module-header__description">Quiénes te compran y cómo contactarlos\.<\/p>/);
  assert.match(full, /<span class="ui-module-header__icon" aria-hidden="true">/, "ícono decorativo");
  assert.match(full, /<ul class="ui-module-header__chips"><li><span class="ui-status-badge ui-status-badge--neutral">12 clientes<\/span><\/li><\/ul>/, "chip con el StatusBadge existente");
  assert.match(full, /<div class="ui-module-header__actions"><button[^>]*>Nuevo cliente<\/button><\/div>/, "acciones a la derecha");
  assert.ok(full.indexOf("ui-module-header__text") < full.indexOf("ui-module-header__actions"), "texto a la izquierda, acciones a la derecha");
  console.log("OK: cabecera con chip y acciones — h1, ícono, descripción, chip y acciones en orden");

  // --- Sin chip ---
  for (const chips of [undefined, null, [], [""], ["  "], [null], [3], "12 clientes"]) {
    const markup = renderHeader({chips, icon: Users, title: "Clientes"});
    assertClean(markup, `chips=${JSON.stringify(chips)}`);
    assert.equal(count(markup, /ui-module-header__chips|ui-status-badge/g), 0, `chips inválidos (${JSON.stringify(chips)}) no dibujan la fila`);
  }
  const bare = renderHeader({title: "Compras"});
  assertClean(bare, "cabecera mínima");
  assert.equal(count(bare, /ui-module-header__icon|ui-module-header__description|ui-module-header__actions|ui-module-header__chips/g), 0, "solo título: sin ícono, descripción, acciones ni chips");
  assert.equal(count(bare, /<h1/g), 1);
  console.log("OK: cabecera sin chip — la fila no existe; con solo título dibuja únicamente el h1");

  // --- Acciones solo con datos ---
  const empty = renderHeader({actions, hasData: false, icon: Users, title: "Clientes"});
  assert.equal(count(empty, /ui-module-header__actions|Nuevo cliente|<button/g), 0, "hasData=false: la cabecera no dibuja las acciones");
  assert.equal(count(renderHeader({actions, hasData: true, title: "Clientes"}), /Nuevo cliente/g), 1, "hasData=true las dibuja");
  assert.equal(count(renderHeader({actions, title: "Clientes"}), /Nuevo cliente/g), 1, "por omisión (con datos) las dibuja");
  // Pantalla vacía completa: cabecera (sin acciones) + vacío (con acción) => un solo botón principal.
  const emptyScreen = renderHeader({actions, hasData: false, title: "Clientes"}) + renderEmpty({action: {label: "Crear primer cliente", onClick: noop}, title: "Aún no tienes clientes"});
  assert.equal(count(emptyScreen, /ui-button--primary/g), 1, "lista vacía: un solo botón principal en toda la pantalla");
  assert.match(emptyScreen, /Crear primer cliente/);
  // Pantalla con datos: cabecera con acciones, sin vacío.
  const dataScreen = renderHeader({actions, hasData: true, title: "Clientes"});
  assert.equal(count(dataScreen, /ui-button--primary/g), 1, "con datos: el botón principal está solo en la cabecera");
  console.log("OK: acciones solo con datos — lista vacía y lista con datos tienen un único botón principal");

  // =================== Barra superior ===================

  const business = "PRUEBA Simulación";
  // Bloque 2: /reportes (cabecera propia) + las seis páginas simples con ModuleHeader.
  const WIRED_ROUTES = ["/clientes", "/ventas", "/compras", "/ordenes-compra", "/proveedores", "/recepciones"];
  assert.deepEqual([...navigation.PAGE_HEADING_ROUTES].sort(), ["/reportes", ...WIRED_ROUTES].sort(), "las rutas con título propio son /reportes y las seis páginas cableadas");
  assert.ok(Object.isFrozen(navigation.PAGE_HEADING_ROUTES), "la lista está congelada");
  assert.equal(navigation.routeProvidesPageHeading("/reportes"), true);
  for (const path of ["/inventario", "/cotizaciones", "/trabajos", "/empleados", "/reportes/otro", "/reportes/", "/ventas/nueva", "/compras/abc", "/clientes/", "", undefined]) {
    assert.equal(navigation.routeProvidesPageHeading(path), false, `${String(path)} no trae su propio título`);
  }

  // Ruta con título propio: la barra solo muestra el negocio.
  const reportsBar = renderBar({businessName: business, pathname: "/reportes"});
  assertClean(reportsBar, "barra /reportes");
  assert.equal(count(reportsBar, /<h1/g), 0, "/reportes: la barra no dibuja h1");
  assert.equal(count(reportsBar, /ui-page-header/g), 0, "/reportes: la barra no usa ui/PageHeader");
  assert.match(reportsBar, /^<div class="topbar-context" aria-label="Negocio activo"><span>PRUEBA Simulación<\/span><\/div>$/, "solo el negocio activo");
  // Ruta sin título propio: la barra conserva eyebrow + título.
  const inventoryBar = renderBar({businessName: business, pathname: "/inventario"});
  assertClean(inventoryBar, "barra /inventario");
  assert.equal(count(inventoryBar, /<h1/g), 1, "/inventario: un h1 en la barra");
  assert.match(inventoryBar, /<span class="ui-page-header__eyebrow">PRUEBA Simulación<\/span>/);
  assert.match(inventoryBar, /<h1 class="ui-page-header__title">Inventario<\/h1>/, "título del menú, igual que antes");
  assert.match(renderBar({pathname: "/inventario"}), /ui-page-header__eyebrow">Módulo activo</, "sin negocio: 'Módulo activo'");
  // Las rutas hijas de las páginas cableadas conservan el título de la barra (siguen sin ModuleHeader).
  for (const [path, title] of [["/ventas/nueva", "Nueva venta"], ["/compras/nueva", "Nueva compra"], ["/ordenes-compra/nueva", "Nueva orden de compra"], ["/recepciones/abc", "Ver recepcion"]]) {
    assert.match(renderBar({businessName: business, pathname: path}), new RegExp(`<h1 class="ui-page-header__title">${title}</h1>`), `${path}: la barra conserva su título`);
  }
  assert.match(renderBar({pathname: "/reportes"}), /<span>Módulo activo<\/span>/);

  // Un h1 por pantalla: si la ruta está en la lista, el h1 es el de la página, y si no, el de la barra.
  const pageHeader = renderHeader({icon: Users, title: "Clientes"});
  for (const path of navigation.PAGE_HEADING_ROUTES) {
    const screen = renderBar({businessName: business, pathname: path}) + pageHeader;
    assert.equal(count(screen, /<h1/g), 1, `${path}: barra + ModuleHeader = un solo h1`);
    assert.equal(count(screen, /ui-page-header__title/g), 0, `${path}: el título de la barra no se repite`);
  }
  // Y una ruta que NO esté en la lista y use ModuleHeader sí duplicaría: el smoke lo deja visible.
  const duplicated = renderBar({businessName: business, pathname: "/inventario"}) + pageHeader;
  assert.equal(count(duplicated, /<h1/g), 2, "control: una ruta fuera de la lista con ModuleHeader tendría dos h1 (por eso hay que agregarla a PAGE_HEADING_ROUTES)");
  // Cada ruta cableada: la barra solo muestra el negocio y no repite el título del módulo.
  for (const path of WIRED_ROUTES) {
    const bar = renderBar({businessName: business, pathname: path});
    assert.equal(count(bar, /<h1|ui-page-header/g), 0, `${path}: la barra no dibuja título`);
    assert.match(bar, /^<div class="topbar-context" aria-label="Negocio activo"><span>PRUEBA Simulación<\/span><\/div>$/, `${path}: solo el negocio activo`);
  }
  console.log("OK: barra superior — /reportes y las seis rutas cableadas solo muestran el negocio; en el resto, eyebrow + título; barra + ModuleHeader = un h1");

  // =================== Páginas cableadas (Bloque 2) ===================
  // Las páginas cargan datos con Firebase y no se pueden renderizar aquí (el SSR no corre useEffect, solo
  // vería el estado de carga). Se fija por código lo que garantiza "un h1 y un solo botón principal".
  const PAGES = [
    {file: "src/pages/SalesPage.jsx", route: "/ventas", title: "Aún no hay ventas", button: "Nueva venta", header: true},
    {file: "src/pages/PurchasesPage.jsx", route: "/compras", title: "Aún no hay compras", button: "Nueva compra", header: true},
    {file: "src/pages/PurchaseOrdersPage.jsx", route: "/ordenes-compra", title: "Aún no hay órdenes de compra", button: "Crear orden de compra", header: true},
    {file: "src/pages/ReceptionsPage.jsx", route: "/recepciones", title: "Aún no hay recepciones", button: "Ir a órdenes de compra", header: false},
    {file: "src/features/clients/ClientsManager.jsx", route: "/clientes", title: "Aún no hay clientes", button: "Crear primer cliente", headerButton: "Nuevo cliente", header: true, noPermission: true},
    {file: "src/features/providers/ProvidersManager.jsx", route: "/proveedores", title: "No hay proveedores registrados", button: "Crear primer proveedor", headerButton: "Nuevo proveedor", header: true, noPermission: true},
  ];
  for (const page of PAGES) {
    const source = await readFile(new URL(`../${page.file}`, import.meta.url), "utf8");
    const name = page.file.split("/").pop();
    assert.ok(navigation.routeProvidesPageHeading(page.route), `${name}: ${page.route} está en PAGE_HEADING_ROUTES`);
    assert.ok(source.includes(`const MODULE = getRouteMeta("${page.route}");`), `${name}: ícono y título salen de navigation.js`);
    assert.equal(count(source, /<ModuleHeader\b/g), page.noPermission ? 2 : 1, `${name}: ModuleHeader${page.noPermission ? " (con y sin permiso de lectura)" : ""}, una vez por pantalla`);
    assert.match(source, /icon=\{MODULE\.icon\}[\s\S]*?title=\{MODULE\.title\}/, `${name}: ícono y título del módulo`);
    assert.doesNotMatch(source, /<h1\b/, `${name}: el h1 lo dibuja ModuleHeader, la página no agrega otro`);
    assert.doesNotMatch(source, /erp-module-intro/, `${name}: ya no usa la fila alineada a la derecha`);
    assert.equal(count(source, /<EmptyState\b/g), 1, `${name}: un solo EmptyState de módulo`);
    assert.match(source, /const showEmpty = !loading && !\w+ && \w+\.length === 0;/, `${name}: showEmpty = cargada, sin error y sin registros`);
    assert.match(source, new RegExp(`title="${page.title}"`), `${name}: conserva el título del vacío ("${page.title}")`);
    // El botón principal: una vez en el EmptyState y (si lo tenía) una vez en la cabecera, y la cabecera lo recibe solo con datos.
    assert.equal(count(source, new RegExp(`label: "${page.button}"`, "g")), 1, `${name}: "${page.button}" una vez en el EmptyState`);
    if (page.header) {
      assert.match(source, /hasData=\{!showEmpty\}/, `${name}: las acciones de la cabecera solo con datos`);
      const headerButton = page.headerButton || page.button;
      assert.equal(count(source, new RegExp(`>${headerButton}</Button>`, "g")), 1, `${name}: "${headerButton}" una vez en la cabecera`);
    } else {
      assert.doesNotMatch(source, /actions=\{/, `${name}: sin botón en la cabecera (no lo tenía)`);
      assert.doesNotMatch(source, /hasData=/, `${name}: no recibe hasData porque no tiene acciones`);
    }
    // Sin permiso para crear no hay botón en el vacío.
    assert.match(source, /action=\{canManage \? \{label: /, `${name}: sin permiso no hay acción`);
    // La lista (y su botón) sigue visible con datos o con filtros sin resultados: el vacío solo reemplaza al panel de la lista vacía.
    assert.match(source, /\{showEmpty \? [\s\S]*?(?:\)|\/>) : <section className="erp-panel/, `${name}: el panel de la lista solo se oculta con showEmpty`);
    assert.match(source, /No hay [\p{L}]+ coincidentes|No hay coincidencias/u, `${name}: el vacío por filtros sigue en la lista`);
    assert.doesNotMatch(source, /ui-empty-state__actions/, `${name}: sin el markup viejo del vacío`);
  }
  console.log("OK: páginas — ModuleHeader con ícono y título de navigation.js, un solo vacío, acciones de la cabecera solo con datos y un botón principal por pantalla");

  // --- AppLayout usa el componente y no conserva la condición fija ---
  const layoutSource = await readFile(new URL("../src/layout/AppLayout.jsx", import.meta.url), "utf8");
  assert.match(layoutSource, /<div className="topbar-heading">\s*<TopbarHeading[\s\S]*?\/>\s*<EnvironmentNotice inline \/>\s*<\/div>/, "TopbarHeading dentro de .topbar-heading, antes del aviso de entorno");
  assert.doesNotMatch(layoutSource, /pathname === "\/reportes"|pageProvidesHeading|import PageHeader/, "AppLayout ya no decide el título ni importa PageHeader");
  assert.equal(count(layoutSource, /<TopbarHeading/g), 1, "una sola barra de título");
  const topbarSource = await readFile(new URL("../src/layout/TopbarHeading.jsx", import.meta.url), "utf8");
  assert.match(topbarSource, /routeProvidesPageHeading\(pathname\)/);
  console.log("OK: AppLayout — usa TopbarHeading y la lista de rutas; sin condición fija");

  // =================== Estilos ===================

  const sources = {
    "EmptyState.jsx": await readFile(new URL("../src/components/ui/EmptyState.jsx", import.meta.url), "utf8"),
    "ModuleHeader.jsx": await readFile(new URL("../src/components/ui/ModuleHeader.jsx", import.meta.url), "utf8"),
    "TopbarHeading.jsx": topbarSource,
  };
  for (const [name, source] of Object.entries(sources)) {
    assert.deepEqual(scanJs(source, name), [], `${name}: 0 literales según test:design`);
    assert.doesNotMatch(source, /style=|#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, `${name}: sin estilos inline ni colores literales`);
  }

  const css = await readFile(new URL("../src/styles/components.css", import.meta.url), "utf8");
  const tokens = await readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
  const rules = [...css.matchAll(/(\.ui-(?:empty-state(?:--panel|__[a-z]+)|module-header[^{]*)[^{]*)\{([^}]*)\}/g)];
  assert.ok(rules.length >= 14, `existen las reglas del vacío y de la cabecera (${rules.length})`);
  const block = rules.map((m) => m[0]).join("\n");
  assert.deepEqual(scanCss(block), [], "reglas nuevas: 0 literales de color/radio/sombra/duración según test:design");
  assert.doesNotMatch(block, /color:\s*var\(--color-(brand-\d+|dark-[a-z0-9-]+)\)/, "ningún color de marca fija ni dark-* como texto (modo oscuro)");
  for (const name of new Set([...block.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]))) {
    assert.match(tokens, new RegExp(`${name}\\s*:`), `${name} existe en tokens.css`);
  }

  // Cada clase usada por los componentes tiene regla.
  const used = new Set();
  for (const markup of [withLink, noLink, full, onlyLinks]) {
    for (const m of markup.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).filter((c) => /^ui-(empty-state|module-header)/.test(c)).forEach((c) => used.add(c));
  }
  assert.ok(used.size >= 12, `clases usadas (${used.size})`);
  for (const className of used) {
    assert.match(css, new RegExp(`\\.${className}\\b[^{]*\\{`), `${className} tiene regla en components.css`);
  }

  // El panel punteado declara su relleno completo (.erp-card no trae padding propio) y el borde punteado.
  const panelRule = css.match(/\.ui-empty-state--panel \{([^}]*)\}/)[1];
  assert.match(panelRule, /padding:\s*var\(--space-\d+\) var\(--space-\d+\)/, "relleno completo (vertical y horizontal)");
  assert.match(panelRule, /border:\s*1px dashed var\(--color-border-control\)/);
  assert.match(panelRule, /background:\s*var\(--color-surface-subtle\)/);
  // Móvil: la cabecera permite pasar las acciones a la segunda línea.
  assert.match(css, /@media \(max-width: 640px\) \{\s*\.ui-module-header \{\s*flex-wrap: wrap;/, "móvil: la cabecera envuelve");
  console.log("OK: estilos — 0 literales, sin colores de marca fija como texto, tokens existentes, clases con regla, relleno completo");

  console.log("MODULE_HEADER_SMOKE_OK");
} finally {
  await vite.close();
}
