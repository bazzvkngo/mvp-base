import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {MemoryRouter} from "react-router-dom";
import {createServer} from "vite";
import {addInventoryItemToLines} from "../src/domain/inventoryLineAdd.mjs";
import {stepSaleQuantity} from "../src/features/sales/saleLineStepper.mjs";

// Nueva compra con el mismo patrón visual que Nueva venta: cabecera corta, selector de proveedor en línea, títulos de
// sección sin acordeones, líneas con selector de cantidad (más costo y descuento) y resumen. Solo presentación y
// estructura: sin cálculos, validaciones ni modelo. Sin emuladores ni red.

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const strip = (html) => html.replace(/<!-- -->/g, "");
const count = (text, pattern) => (text.match(pattern) || []).length;

// --- 1. Fuente de la pantalla: estructura nueva y nada del patrón anterior -----------------------------------------
const page = read("src/pages/NewPurchasePage.jsx");
assert.match(page, /<header className="ui-doc-head no-print">/, "cabecera corta compartida");
assert.match(page, /className="ui-doc-back" onClick=\{\(\) => navigate\("\/compras"\)\}>← Compras</, "enlace ← Compras");
assert.match(page, /<p className="ui-doc-head__title">/, "el título va en un <p> (un solo h1 por pantalla)");
assert.doesNotMatch(page, /<h1/, "sin segundo h1");
assert.match(page, /po-status po-status--\$\{purchase\?\.estado \|\| "borrador"\}/, "chip de estado");
assert.doesNotMatch(page, /Volver al historial/, "ya no hay botón Volver al historial");
assert.match(page, /icon=\{FileUp\} onClick=\{\(\) => setImportOpen\(true\)\}>Importar factura</, "Importar factura se conserva");
assert.match(page, /\{canImport && /, "Importar factura solo si se puede editar y no está bloqueada por referencias");
assert.match(page, /const canImport = !readOnly && !referencesLocked;/, "mismo permiso que antes");
assert.match(page, /<h2 id="purchase-provider-title" className="ui-step-title">¿A quién le compras\?<\/h2>/, "título con signos de apertura y cierre, como Ventas");
assert.match(page, /<PurchaseProviderSelector/, "selector de proveedor en línea");
assert.doesNotMatch(page, /<ProviderSelector/, "ya no usa la tarjeta fija con diálogo");
assert.match(page, /Documento y fechas/);
assert.match(page, /Condiciones comerciales/);
assert.match(page, /Editar condiciones/);
assert.match(page, /Vista previa imprimible/);
assert.doesNotMatch(page, /<details|po-details|<summary|po-details__indicator/, "sin acordeones +/−");
assert.equal(count(page, /¿/g), count(page, /¿[^<?]*\?</g), "cada ¿ de la pantalla cierra con ?");
assert.doesNotMatch(page, /Detalle de compra|DETALLE DE COMPRA/, "sin la etiqueta en mayúsculas como título de sección");
// Campos y datos del documento: todos siguen, con los mismos manejadores.
for (const field of ["tipoDocumento", "numeroDocumentoProveedor", "fechaCompra", "fechaDocumento", "condicionesPago", "observaciones"]) {
  assert.ok(page.includes(`draft.${field}`), `el campo ${field} sigue en la pantalla`);
}
assert.match(page, /changeDocumentType\(event\.target\.value\)/);
assert.match(page, /Factura importada y pendiente de confirmación/, "el bloque de factura importada se conserva");
assert.match(page, /Los totales del documento no coinciden con las líneas\. Revisa antes de confirmar\./);
// Lógica intacta: mismas funciones de guardado, confirmación y cancelación; mismos diálogos.
for (const needle of ["crearCompra(", "actualizarCompraBorrador(", "confirmarCompra(", "cancelarCompraBorrador(", "calculatePurchaseTotals(", "shouldReconcilePurchaseConfirmation(", "Confirmar compra", "Cancelar compra"]) {
  assert.ok(page.includes(needle), `se conserva ${needle}`);
}
assert.equal(count(page, /<ResponsiveDialog/g), 3, "diálogos: condiciones, confirmar y cancelar");

// --- 2. Cantidad por defecto 1 (Compra no tiene un valor fijo distinto) ------------------------------------------------
assert.match(page, /const addItem = \(item, quantity = 1\) =>/, "agregar parte en 1");
assert.match(page, /cantidad: 1,\s*costoUnitario: Number\(item\.costoBase \|\| 0\)/, "la línea nueva nace con cantidad 1");
assert.doesNotMatch(page, /cantidad: (?!1\b)\d/, "ningún valor fijo distinto de 1");
const dialogSource = read("src/components/ui/InventoryCatalogDialog.jsx");
assert.match(dialogSource, /quantities\[id\] \?\? "1"/, "el diálogo compartido parte en 1");
const line = (item) => ({lineaId: "l1", itemId: item.id, tipoItem: "producto", cantidad: 1, costoUnitario: item.costoBase, descuentoPct: 0});
const product = {id: "p1", nombre: "Filtro", costoBase: 60};
const first = addInventoryItemToLines([], product, {itemId: product.id, priceKey: "costoUnitario", createLine: () => line(product)});
assert.equal(first.items[0].cantidad, 1, "agregar sin cantidad deja 1");
assert.equal(addInventoryItemToLines(first.items, product, {itemId: product.id, priceKey: "costoUnitario", createLine: () => line(product)}).items[0].cantidad, 2, "agregar otra vez suma 1 (reagrupa)");

// --- 3. Selector de cantidad: mismos pasos que el de Venta ------------------------------------------------------------
Object.assign(process.env, {
  VITE_FIREBASE_MODE: "emulator",
  VITE_USE_FIREBASE_CORE_EMULATORS: "true",
  VITE_USE_FIREBASE_FUNCTIONS_EMULATOR: "true",
  VITE_USE_FIREBASE_STORAGE_EMULATOR: "true",
});
const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
try {
  const stepper = await vite.ssrLoadModule("/src/components/ui/QuantityStepper.jsx");
  for (const current of [1, 2, 2.3, "4", 0.5, 0, "", "abc", 1e-7]) {
    for (const direction of [-1, 1]) {
      assert.equal(stepper.stepQuantity(current, direction), stepSaleQuantity(current, direction), `paso ${direction} desde ${JSON.stringify(current)} igual que Venta`);
    }
  }
  assert.equal(stepper.stepQuantity(1, -1), null, "− no baja de 1 a 0");
  assert.equal(stepper.stepQuantity(2.3, 1), 3.3, "sin ruido de coma flotante");

  const hook = await vite.ssrLoadModule("/src/hooks/useBusinessFormat.js");
  const wrap = (element, business = {paisCodigo: "BO", monedaCodigo: "BOB", locale: "es-BO"}) => strip(renderToStaticMarkup(
    React.createElement(MemoryRouter, {initialEntries: ["/compras/nueva"]},
      React.createElement(hook.BusinessFormatProvider, {business}, element)),
  ));

  // --- 4. Líneas: cantidad con − y +, costo y descuento, sin cabecera de columnas ---------------------------------------
  const editor = (await vite.ssrLoadModule("/src/features/purchases/PurchaseItemsEditor.jsx")).default;
  const items = [
    {lineaId: "a", itemId: "p1", codigo: "FA-1", nombre: "Filtro de aceite", descripcion: "Filtro de aceite", tipoItem: "producto", unidad: "un", cantidad: 3, costoUnitario: 60, descuentoPct: 5},
    {lineaId: "b", itemId: "p2", codigo: "SV-1", nombre: "Instalación", descripcion: "Mano de obra en sitio", tipoItem: "servicio", unidad: "", cantidad: 1, costoUnitario: 20, descuentoPct: 0},
  ];
  const renderEditor = (props) => wrap(React.createElement(editor, {items, onChange() {}, onOpenCatalog() {}, moneyStep: "0.01", ...props}));
  const html = renderEditor({});
  assert.match(html, /<h2 id="purchase-items-title" class="ui-step-title">¿Qué compras\?<\/h2>/, "título tipo pregunta con ¿ y ?, como Ventas");
  assert.ok(!html.includes("po-lines__head"), "sin la cabecera de columnas anterior");
  assert.ok(html.includes("2 ítems"), "contador de ítems");
  assert.ok(html.includes("Agregar desde inventario"), "botón del diálogo de inventario");
  for (const name of ["Filtro de aceite", "Instalación"]) {
    assert.ok(html.includes(`aria-label="Disminuir cantidad de ${name}"`), `${name}: botón −`);
    assert.ok(html.includes(`aria-label="Aumentar cantidad de ${name}"`), `${name}: botón +`);
    assert.ok(html.includes(`aria-label="Cantidad de ${name}"`), `${name}: campo de cantidad editable`);
    assert.ok(html.includes(`aria-label="Costo unitario de ${name}"`), `${name}: costo unitario`);
    assert.ok(html.includes(`aria-label="Descuento % de ${name}"`), `${name}: descuento`);
    assert.ok(html.includes(`aria-label="Quitar ${name}"`), `${name}: quitar`);
  }
  assert.match(html, /aria-label="Cantidad de Filtro de aceite"[^>]*value="3"/, "la cantidad se edita directo");
  assert.match(html, /aria-label="Costo unitario de Filtro de aceite"[^>]*step="0\.01"[^>]*value="60"/, "el costo usa el paso de la moneda");
  assert.match(html, /aria-label="Descuento % de Filtro de aceite"[^>]*max="100"[^>]*value="5"/);
  assert.ok(html.includes("Mano de obra en sitio") && !html.includes('ui-doc-line__description">Filtro de aceite'), "la descripción solo si difiere del nombre");
  assert.equal(count(html, /class="ui-doc-line"/g), 2, "una fila por ítem");
  assert.ok(html.includes('class="ui-doc-line__total"') && html.includes("Total"), "total por línea");
  // Estado vacío y bloqueos
  assert.ok(renderEditor({items: []}).includes("Agrega productos, servicios o actividades."), "vacío");
  assert.ok(renderEditor({items: []}).includes("0 ítems"));
  const locked = renderEditor({referencesLocked: true});
  assert.ok(!locked.includes("Agregar desde inventario") && !locked.includes('aria-label="Quitar'), "con referencias bloqueadas no se agrega ni se quita");
  const staticHtml = renderEditor({readOnly: true, disabled: true});
  assert.ok(!staticHtml.includes("<input") && !staticHtml.includes("ui-qty"), "solo lectura: valores estáticos");
  assert.ok(staticHtml.includes("Costo unitario") && staticHtml.includes("Desc. %"), "solo lectura: etiquetas de costo y descuento");

  // --- 5. Selector de proveedor: buscador, "Ver todos los proveedores" y tarjeta con "Cambiar proveedor" ---------------
  const selector = (await vite.ssrLoadModule("/src/features/purchases/PurchaseProviderSelector.jsx")).default;
  const providers = [
    {proveedorId: "pv1", razonSocial: "Ferretería Andes", identificadorFiscalTipo: "NIT", identificadorFiscalValor: "1020304050", personaContacto: "Ana Rojas", estado: "activo"},
    {proveedorId: "pv2", razonSocial: "Eléctrica Sur", identificadorFiscalValor: "99887766", email: "ventas@sur.test", estado: "activo"},
    {proveedorId: "pv3", razonSocial: "Proveedor inactivo", identificadorFiscalValor: "1", estado: "inactivo"},
  ];
  const renderSelector = (props) => wrap(React.createElement(selector, {providers, onChange() {}, value: "", ...props}));
  const picking = renderSelector({});
  assert.match(picking, /type="search" aria-label="Buscar proveedor" placeholder="Buscar por nombre o identificación fiscal"/, "buscador por nombre o identificación fiscal");
  assert.ok(picking.includes("Tienes 2 proveedores activos · escribe un nombre o NIT para buscar"), "cuenta solo los activos y nombra el identificador del país");
  assert.ok(picking.includes(">Ver todos los proveedores</button>"), "enlace Ver todos los proveedores");
  assert.ok(!picking.includes("Ferretería Andes"), "sin escribir no se dibuja ninguna lista");
  assert.ok(!picking.includes("Cambiar proveedor"));
  const chosen = renderSelector({value: "pv1"});
  assert.ok(chosen.includes("Ferretería Andes") && chosen.includes("NIT 1020304050") && chosen.includes("Ana Rojas"), "tarjeta del proveedor elegido con identificador y contacto");
  assert.ok(chosen.includes(">Cambiar proveedor<"), "opción de cambiar");
  assert.ok(!chosen.includes('aria-label="Buscar proveedor"'), "con proveedor elegido el buscador queda oculto hasta pulsar Cambiar");
  assert.ok(chosen.includes("Sin contacto informado") === false, "con contacto no muestra el respaldo");
  assert.ok(renderSelector({value: "pv2"}).includes("ventas@sur.test"), "sin persona de contacto usa el correo");
  const locked2 = renderSelector({value: "pv1", disabled: true});
  assert.ok(locked2.includes("Ferretería Andes") && !locked2.includes("Cambiar proveedor") && !locked2.includes("Buscar proveedor"), "bloqueado: muestra el proveedor sin cambiarlo");
  const historical = renderSelector({providers: [], value: "pv9", originalSnapshot: {proveedorId: "pv9", razonSocial: "Proveedor histórico", identificadorFiscalValor: "55"}, historicalNote: "Datos del proveedor al momento de la compra"});
  assert.ok(historical.includes("Proveedor histórico") && historical.includes("Datos del proveedor al momento de la compra"), "snapshot histórico conservado");
  const none = renderSelector({providers: [providers[2]]});
  assert.ok(none.includes("Aún no tienes proveedores") && none.includes('href="/proveedores"') && none.includes("Ir a Proveedores"), "sin proveedores activos: aviso con enlace a Proveedores");
  assert.ok(!none.includes("Ver todos los proveedores"));
  assert.ok(renderSelector({disabled: true}).includes("Selecciona un proveedor activo."), "bloqueado y sin proveedor");
  const chile = wrap(React.createElement(selector, {providers, onChange() {}, value: ""}), {paisCodigo: "CL", monedaCodigo: "CLP", locale: "es-CL"});
  assert.ok(chile.includes("escribe un nombre o RUT para buscar"), "Chile: RUT");

  // --- 6. Resumen: mismo estilo y mismos textos de botón ------------------------------------------------------------------
  const summary = (await vite.ssrLoadModule("/src/features/purchases/PurchaseSummaryPanel.jsx")).default;
  const totals = {subtotal: 1000, descuentoTotal: 50, neto: 950, iva: 123.5, total: 1073.5};
  const renderSummary = (props) => wrap(React.createElement(summary, {currency: "BOB", locale: "es-BO", totals, taxName: "IVA", taxRate: 13, onCancel: null, onConfirm() {}, onSave() {}, processing: false, ...props}));
  const fresh = renderSummary({isNew: true, disabled: false});
  assert.ok(fresh.includes("purchase-summary") && fresh.includes("<h2>Resumen</h2>"), "título Resumen");
  assert.ok(fresh.includes("Preparar compra") && !fresh.includes("Confirmar compra") && !fresh.includes("Guardar cambios"), "compra nueva: Preparar compra");
  const saved = renderSummary({isNew: false, disabled: false, onCancel() {}});
  for (const text of ["Confirmar compra", "Guardar cambios", "Cancelar compra"]) assert.ok(saved.includes(text), `compra guardada: ${text}`);
  assert.ok(saved.indexOf("Confirmar compra") < saved.indexOf("Guardar cambios") && saved.indexOf("Guardar cambios") < saved.indexOf("Cancelar compra"), "orden: confirmar, guardar, cancelar");
  assert.ok(!renderSummary({isNew: false, disabled: true, onCancel() {}}).includes("Confirmar compra"), "solo lectura: sin acciones");
  assert.ok(renderSummary({isNew: true, processing: true}).includes("Procesando..."), "estado de proceso");
  assert.ok(fresh.includes("Subtotal") && fresh.includes("Descuentos") && fresh.includes("Neto") && fresh.includes("IVA 13%") && fresh.includes("Total"), "mismas filas de importes");

  // --- 7. La pantalla carga sin error de importación (estado inicial: cargando) -------------------------------------------
  const pageModule = await vite.ssrLoadModule("/src/pages/NewPurchasePage.jsx");
  let pageHtml = "";
  assert.doesNotThrow(() => { pageHtml = wrap(React.createElement(pageModule.default, {businessId: "negocio-prueba", role: "ADMIN"})); }, "Nueva compra renderiza su estado inicial");
  assert.ok(pageHtml.length > 0);
} finally {
  await vite.close();
}

// --- 8. CSS: lo compartido vive en components.css (ui-*) y lo propio en purchases.css; solo tokens ------------------------
const uiCss = read("src/styles/components.css");
const purchaseCss = read("src/features/purchases/purchases.css");
// El patrón del editor de documentos (Compra y Orden de compra) vive en purchase-orders.css, que purchases.css importa.
const orderCss = read("src/features/purchaseOrders/purchase-orders.css");
for (const selector of [".ui-doc-head", ".ui-doc-back", ".ui-step-card", ".ui-step-title", ".ui-section-head", ".ui-party", ".ui-party__all", ".ui-party__search", ".ui-qty", ".ui-qty__button"]) {
  assert.ok(uiCss.includes(`${selector} {`), `components.css define ${selector}`);
  assert.ok(!purchaseCss.includes(`${selector} {`), `purchases.css no redefine ${selector}`);
}
assert.ok(!/(^|\n)\.ui-/.test(purchaseCss), "purchases.css no define clases ui-*");
assert.ok(purchaseCss.includes('@import "../purchaseOrders/purchase-orders.css";'),"purchases.css importa el CSS compartido");
assert.ok(!purchaseCss.includes("Fin del editor de la compra"), "el bloque compartido ya no está duplicado en purchases.css");
const newPurchaseCss = orderCss.slice(orderCss.indexOf("Editor de la compra (borrador)"), orderCss.indexOf("Fin del editor de la compra"));
assert.ok(newPurchaseCss.length > 500, "se localiza el bloque del editor en purchase-orders.css");
const newUiCss = uiCss.slice(uiCss.indexOf("Patrón de documento en edición compartido"));
for (const [name, css] of [["purchase-orders.css (bloque del editor)", newPurchaseCss], ["components.css (bloque nuevo)", newUiCss]]) {
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, `${name}: sin colores literales`);
  assert.doesNotMatch(css, /--color-(brand-[6-9]00|dark-)[^;]*;/, `${name}: sin tokens que no cambian con el tema`);
  assert.doesNotMatch(css, /(^|[;{\s])(color|fill|stroke):\s*var\(--color-(brand-[6-9]00|dark-)/m, `${name}: sin brand-600+ ni dark como texto`);
  assert.doesNotMatch(css, /border-radius:\s*\d|box-shadow:\s*\d|transition:[^;]*\d+m?s/, `${name}: sin radios, sombras ni duraciones literales`);
}
assert.match(newUiCss, /\.ui-party__all \{[^}]*min-height: 44px;/, "área táctil de 44 px en Ver todos");
assert.match(newUiCss, /\.ui-qty__button \{[^}]*min-height: 2\.75rem;[^}]*min-width: 2\.75rem;/, "área táctil de 44 px en − y +");
assert.match(newUiCss, /\.ui-party__search:focus-visible[\s\S]*?outline: var\(--focus-outline\)/, "foco visible en el buscador");
assert.match(newUiCss, /\.ui-qty__button:focus-visible,\s*\.ui-qty__input:focus-visible \{[^}]*outline: var\(--focus-outline\)/, "foco visible en el selector de cantidad");
assert.match(newUiCss, /\.ui-doc-line__input:focus-visible \{ outline: var\(--focus-outline\)/, "foco visible en costo y descuento");
assert.match(newUiCss, /@container \(max-width: 46rem\)[\s\S]*@container \(max-width: 30rem\)/, "la fila baja a dos y tres renglones con poco ancho");

console.log("PURCHASE_NEW_PAGE_STRUCTURE_SMOKE_OK");
