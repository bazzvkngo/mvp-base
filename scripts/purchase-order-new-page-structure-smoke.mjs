import assert from "node:assert/strict";
import {existsSync, readFileSync} from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {MemoryRouter} from "react-router-dom";
import {createServer} from "vite";
import {addInventoryItemToLines} from "../src/domain/inventoryLineAdd.mjs";
import {incrementScannedItem} from "../src/domain/barcode.mjs";

// Nueva y Editar orden de compra con el mismo patrón visual que Nueva compra y Nueva venta: cabecera corta, selector de
// proveedor en línea, títulos de sección con ¿…?, diálogo "Agregar desde inventario", líneas con selector de cantidad,
// Entrega y Condiciones comerciales como tarjetas visibles (sin acordeones) y resumen. Solo presentación y estructura:
// sin cálculos, validaciones, modelo, estados, stock ni costos. Sin emuladores ni red.

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const strip = (html) => html.replace(/<!-- -->/g, "");
const count = (text, pattern) => (text.match(pattern) || []).length;

// --- 1. Fuente de la pantalla: estructura nueva y nada del patrón anterior -----------------------------------------
const page = read("src/pages/NewPurchaseOrderPage.jsx");
assert.match(page, /<header className="ui-doc-head no-print">/, "cabecera corta compartida");
assert.match(page, /className="ui-doc-back" onClick=\{\(\) => navigate\("\/ordenes-compra"\)\}>← Órdenes de compra</, "enlace ← Órdenes de compra");
assert.match(page, /<p className="ui-doc-head__title">\{order\?\.numero \|\| "Nueva orden de compra"\}<\/p>/, "el título va en un <p> (un solo h1 por pantalla)");
assert.doesNotMatch(page, /<h1/, "sin segundo h1");
assert.match(page, /po-status po-status--\$\{order\?\.estado \|\| "borrador"\}/, "chip de estado");
assert.match(page, /"Pendiente de envío"/, "el chip de una orden guardada conserva su texto");
assert.match(page, /El número se asignará al crearla\./, "se conserva el aviso de numeración, de forma discreta");
assert.match(page, /\{!order && <span>El número se asignará al crearla\.<\/span>\}/, "el aviso va como un dato más de la cabecera y solo en la orden nueva");
assert.match(page, /ordenCompraOrigenNumero \? `Copia de \$\{order\.ordenCompraOrigenNumero\}` : "Orden directa"/, "origen de la orden");
assert.doesNotMatch(page, /Volver al historial|po-back-link|po-header__copy|po-header__title-row/, "ya no hay el enlace pequeño ni la tarjeta de título");
assert.match(page, /<h2 id="po-provider-title" className="ui-step-title">¿A quién le pides\?<\/h2>/, "título con signos de apertura y cierre, como Ventas y Compras");
assert.match(page, /<PurchaseProviderSelector[\s\S]*?purpose="pedir"/, "selector de proveedor en línea (adaptador de Compra)");
assert.doesNotMatch(page, /<ProviderSelector|PROVEEDOR REGISTRADO|Proveedor registrado/i, "ya no usa la tarjeta fija con diálogo");
assert.match(page, /getProviderPurchaseOrderPaymentTerms\(provider\)/, "al elegir proveedor se siguen sugiriendo sus condiciones de pago");
assert.match(page, />Entrega<\/h2>/);
assert.match(page, />Condiciones comerciales<\/h2>/);
assert.match(page, />Editar condiciones<\/Button>/);
assert.match(page, /Vista previa imprimible/);
assert.doesNotMatch(page, /<details|po-details|<summary|po-details__indicator|Condiciones y observaciones/, "sin acordeones +/−");
assert.equal(count(page, /¿/g), count(page, /¿[^<"?]*\?[<"]/g), "cada ¿ de la pantalla cierra con ?");
// Campos y datos: todos siguen, con los mismos manejadores.
for (const field of ["fechaEntregaEstimada", "direccionEntrega", "condicionesPago", "observaciones"]) {
  assert.ok(page.includes(`draft.${field}`), `el campo ${field} sigue en la pantalla`);
}
assert.match(page, /Fecha estimada<input disabled=\{readOnly\} type="date"/);
assert.match(page, /Dirección de entrega<input disabled=\{readOnly\}/);
assert.match(page, /Condiciones de pago<textarea rows="4" disabled=\{readOnly\}/);
assert.match(page, /Observaciones<textarea rows="4" disabled=\{readOnly\}/);
assert.match(page, /\{!readOnly && <Button type="button" variant="secondary" onClick=\{\(\) => setConditionsOpen\(true\)\}>Editar condiciones<\/Button>\}/, "editar condiciones solo si se puede editar");
// Diálogo de inventario compartido (no el propio de la orden).
assert.match(page, /<InventoryCatalogDialog[\s\S]*?priceLabel="Costo"/, "usa el diálogo compartido Agregar desde inventario");
assert.doesNotMatch(page, /PurchaseOrderCatalogDialog|Agregar desde catálogo/, "ya no usa el diálogo propio");
// Lógica intacta: mismas funciones de guardado, emisión, cancelación, recepción y eliminación; mismos diálogos y botones.
for (const needle of [
  "crearOrdenCompra(", "actualizarOrdenCompraBorrador(", "emitirOrdenCompra(", "cancelarOrdenCompra(", "duplicarOrdenCompraComoBorrador(",
  "crearRecepcionDesdeOrden(", "registrarRespuestaProveedor(", "calculatePurchaseOrderTotals(", "persistDraft", "findActiveProductByBarcode(",
  "Enviar por correo", "Registrar envío manual", "Descargar PDF", "Imprimir", "Cancelar", "Eliminar", "Duplicar como nueva orden",
  "<PurchaseOrderDeleteDialog", "<SendPurchaseOrderEmailDialog", "<PurchaseOrderDetailView",
]) {
  assert.ok(page.includes(needle), `se conserva ${needle}`);
}
assert.match(page, /const moneyStep = documentDecimals > 0 \? String\(10 \*\* -documentDecimals\) : "any";/, "mismo paso de importes");
assert.match(page, /const readOnly = !canManage \|\| \(order && order\.estado !== "borrador"\);/, "misma regla de solo lectura");
assert.match(page, /const showDetailView = Boolean\(order && order\.estado !== "borrador"\);/, "emitida y cancelada siguen en la vista de detalle");
assert.equal(count(page, /<ResponsiveDialog/g), 5, "diálogos: condiciones, confirmación del proveedor, WhatsApp, envío manual y cancelar");

// --- 2. Agregar ítems: escaneo igual que antes; catálogo igual que en Compra ---------------------------------------------
assert.match(page, /items: incrementScannedItem\(current\.items, item\.id, \(\) => newLine\(item\)\)/, "el escaneo sigue sumando 1 a la línea existente");
assert.match(page, /const addCatalogItem = \(item, quantity = 1\) =>/, "agregar desde inventario parte en 1");
assert.match(page, /priceKey: "costoUnitario"/);
assert.match(page, /cantidad: 1,\s*costoUnitario: Number\(item\.costoBase \|\| 0\)/, "la línea nueva nace con cantidad 1 y el costo del inventario");
const lineOf = (item) => ({lineaId: `l-${item.id}`, itemId: item.id, tipoItem: "producto", cantidad: 1, costoUnitario: item.costoBase, descuentoPct: 0});
const product = {id: "p1", costoBase: 60};
const scanned = incrementScannedItem([], product.id, () => lineOf(product));
assert.equal(incrementScannedItem(scanned, product.id, () => lineOf(product))[0].cantidad, 2, "escanear dos veces suma 1");
const added = addInventoryItemToLines([], product, {itemId: product.id, quantity: 3, priceKey: "costoUnitario", createLine: () => lineOf(product)});
assert.equal(added.items[0].cantidad, 3, "el diálogo agrega la cantidad pedida");
assert.equal(addInventoryItemToLines(added.items, product, {itemId: product.id, priceKey: "costoUnitario", createLine: () => lineOf(product)}).items[0].cantidad, 4, "agregar otra vez reagrupa");

// --- 3. Componentes renderizados -------------------------------------------------------------------------------------------
Object.assign(process.env, {
  VITE_FIREBASE_MODE: "emulator",
  VITE_USE_FIREBASE_CORE_EMULATORS: "true",
  VITE_USE_FIREBASE_FUNCTIONS_EMULATOR: "true",
  VITE_USE_FIREBASE_STORAGE_EMULATOR: "true",
});
const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
try {
  const hook = await vite.ssrLoadModule("/src/hooks/useBusinessFormat.js");
  const wrap = (element, business = {paisCodigo: "BO", monedaCodigo: "BOB", locale: "es-BO"}) => strip(renderToStaticMarkup(
    React.createElement(MemoryRouter, {initialEntries: ["/ordenes-compra/nueva"]},
      React.createElement(hook.BusinessFormatProvider, {business}, element)),
  ));

  // --- 3a. Líneas: cantidad con − y +, costo y descuento, sin cabecera de columnas ------------------------------------------
  const editor = (await vite.ssrLoadModule("/src/features/purchaseOrders/PurchaseOrderItemsEditor.jsx")).default;
  const items = [
    {lineaId: "a", itemId: "p1", codigo: "FA-1", nombre: "Filtro de aceite", descripcion: "Filtro de aceite", tipoItem: "producto", unidad: "un", cantidad: 3, costoUnitario: 60, descuentoPct: 5},
    {lineaId: "b", itemId: "p2", codigo: "SV-1", nombre: "Instalación", descripcion: "Mano de obra en sitio", tipoItem: "servicio", unidad: "", cantidad: 1, costoUnitario: 20, descuentoPct: 0},
  ];
  const renderEditor = (props) => wrap(React.createElement(editor, {items, onChange() {}, onOpenCatalog() {}, onScanProduct: async () => ({key: "p1", label: "Filtro"}), moneyStep: "0.01", ...props}));
  const html = renderEditor({});
  assert.match(html, /<h2 id="po-items-title" class="ui-step-title">¿Qué pides\?<\/h2>/, "título tipo pregunta con ¿ y ?, como Ventas y Compras");
  assert.ok(!html.includes("po-lines__head") && !html.includes("Ítems de la orden"), "sin la cabecera de columnas ni el título anterior");
  assert.ok(html.includes("2 ítems"), "contador de ítems");
  assert.ok(html.includes("Agregar desde inventario") && !html.includes("Agregar desde catálogo"), "botón del diálogo de inventario");
  assert.ok(html.includes("Escanear producto"), "el escaneo se conserva");
  assert.deepEqual([...html.matchAll(/data-scan-mode="([^"]*)"/g)].map((match) => match[1]), ["continuous"], "escaneo continuo, como antes");
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
  assert.ok(html.includes('class="ui-doc-line__total"'), "total por línea");
  assert.ok(html.includes("Bs") && html.includes("171"), "total de la primera línea: 3 × 60 − 5 %");
  // Estado vacío y bloqueos
  assert.ok(renderEditor({items: []}).includes("Agrega productos, servicios o actividades."), "vacío");
  assert.ok(renderEditor({items: []}).includes("0 ítems"));
  const locked = renderEditor({disabled: true});
  assert.ok(!locked.includes("Agregar desde inventario") && !locked.includes("Escanear producto") && !locked.includes('aria-label="Quitar'), "sin permiso: no se agrega, no se escanea ni se quita");
  const staticHtml = renderEditor({readOnly: true, disabled: true});
  assert.ok(!staticHtml.includes("<input") && !staticHtml.includes("ui-qty"), "solo lectura: valores estáticos");
  assert.ok(staticHtml.includes("Costo unitario") && staticHtml.includes("Desc. %"), "solo lectura: etiquetas de costo y descuento");

  // --- 3b. Selector de proveedor: buscador, "Ver todos los proveedores" y tarjeta con "Cambiar proveedor" --------------------
  const selector = (await vite.ssrLoadModule("/src/features/purchases/PurchaseProviderSelector.jsx")).default;
  const providers = [
    {proveedorId: "pv1", razonSocial: "Ferretería Andes", identificadorFiscalTipo: "NIT", identificadorFiscalValor: "1020304050", personaContacto: "Ana Rojas", estado: "activo"},
    {proveedorId: "pv2", razonSocial: "Eléctrica Sur", identificadorFiscalValor: "99887766", email: "ventas@sur.test", estado: "activo"},
    {proveedorId: "pv3", razonSocial: "Proveedor inactivo", identificadorFiscalValor: "1", estado: "inactivo"},
  ];
  const renderSelector = (props) => wrap(React.createElement(selector, {providers, onChange() {}, value: "", purpose: "pedir", ...props}));
  const picking = renderSelector({});
  assert.match(picking, /type="search" aria-label="Buscar proveedor" placeholder="Buscar por nombre o identificación fiscal"/, "buscador por nombre o NIT");
  assert.ok(picking.includes("Tienes 2 proveedores activos · escribe un nombre o NIT para buscar"), "cuenta solo los activos y nombra el identificador del país");
  assert.ok(picking.includes(">Ver todos los proveedores</button>"), "enlace Ver todos los proveedores");
  assert.ok(!picking.includes("Ferretería Andes"), "sin escribir no se dibuja ninguna lista");
  const chosen = renderSelector({value: "pv1"});
  assert.ok(chosen.includes("Ferretería Andes") && chosen.includes("NIT 1020304050") && chosen.includes("Ana Rojas"), "tarjeta del proveedor elegido");
  assert.ok(chosen.includes(">Cambiar proveedor<"), "opción de cambiar");
  assert.ok(!chosen.includes("Seleccionar proveedor</button>") && !chosen.includes("Proveedor registrado"), "sin el botón ni la etiqueta anteriores");
  const locked2 = renderSelector({value: "pv1", disabled: true});
  assert.ok(locked2.includes("Ferretería Andes") && !locked2.includes("Cambiar proveedor") && !locked2.includes("Buscar proveedor"), "sin permiso: muestra el proveedor sin cambiarlo");
  const historical = renderSelector({providers: [], value: "pv9", originalSnapshot: {proveedorId: "pv9", razonSocial: "Proveedor histórico", identificadorFiscalValor: "55"}, historicalNote: "Datos del proveedor al momento de la orden"});
  assert.ok(historical.includes("Proveedor histórico") && historical.includes("Datos del proveedor al momento de la orden"), "snapshot histórico conservado");
  const none = renderSelector({providers: [providers[2]]});
  assert.ok(none.includes("Crea uno en Proveedores para poder pedir.") && none.includes('href="/proveedores"'), "sin proveedores activos: aviso con enlace y propósito de la orden");
  const forPurchase = wrap(React.createElement(selector, {providers: [providers[2]], onChange() {}, value: ""}));
  assert.ok(forPurchase.includes("Crea uno en Proveedores para poder comprar."), "Compra conserva su texto");

  // --- 3c. Resumen: mismo estilo que Compra y mismos textos de botón ---------------------------------------------------------
  const summary = (await vite.ssrLoadModule("/src/features/purchaseOrders/PurchaseOrderSummary.jsx")).default;
  const totals = {subtotal: 1000, descuentoTotal: 50, neto: 950, iva: 123.5, total: 1073.5};
  const renderSummary = (props) => wrap(React.createElement(summary, {currency: "BOB", locale: "es-BO", totals, taxName: "IVA", taxRate: 13, onSave() {}, saving: false, ...props}));
  const fresh = renderSummary({isNew: true, disabled: false});
  assert.ok(fresh.includes("purchase-summary") && fresh.includes("<h2>Resumen</h2>"), "título Resumen");
  assert.ok(!fresh.includes("Totales") && !fresh.includes("po-kicker"), "sin la etiqueta y el título anteriores");
  assert.ok(fresh.includes(">Crear orden de compra<") && fresh.includes("purchase-summary__primary"), "orden nueva: Crear orden de compra, botón principal alto");
  assert.ok(renderSummary({isNew: false, disabled: false}).includes(">Guardar cambios<"), "orden guardada: Guardar cambios");
  assert.ok(!renderSummary({isNew: false, disabled: true}).includes("<button"), "solo lectura: sin acciones");
  assert.ok(renderSummary({isNew: true, saving: true}).includes("Guardando..."), "estado de proceso");
  assert.ok(fresh.includes("Subtotal") && fresh.includes("Descuentos") && fresh.includes("Neto") && fresh.includes("IVA 13%") && fresh.includes("Total"), "mismas filas de importes");

  // --- 3d. La pantalla carga sin error de importación (estado inicial: cargando) --------------------------------------------
  const pageModule = await vite.ssrLoadModule("/src/pages/NewPurchaseOrderPage.jsx");
  let pageHtml = "";
  assert.doesNotThrow(() => { pageHtml = wrap(React.createElement(pageModule.default, {businessId: "negocio-prueba", role: "ADMIN"})); }, "Nueva orden de compra renderiza su estado inicial");
  assert.ok(pageHtml.length > 0);
} finally {
  await vite.close();
}

// --- 4. Archivos que se conservan (otras pruebas y la vista de detalle los leen) ------------------------------------------
for (const file of ["src/features/purchaseOrders/ProviderSelector.jsx", "src/features/purchaseOrders/PurchaseOrderCatalogDialog.jsx"]) {
  assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${file} se conserva sin usarse en esta pantalla`);
}

// --- 5. CSS: lo compartido vive en components.css (ui-*) y purchase-orders.css; solo tokens -------------------------------
const orderCss = read("src/features/purchaseOrders/purchase-orders.css");
const purchaseCss = read("src/features/purchases/purchases.css");
for (const selector of [".purchase-conditions-summary", ".purchase-conditions-form", ".purchase-summary__primary"]) {
  assert.ok(orderCss.includes(`${selector} {`) || orderCss.includes(`${selector}:`), `purchase-orders.css define ${selector}`);
  assert.ok(!purchaseCss.includes(`${selector} {`), `purchases.css no duplica ${selector}`);
}
assert.ok(!/(^|\n)\.ui-/.test(orderCss), "purchase-orders.css no define clases ui-*");
const ownCss = orderCss.slice(orderCss.indexOf("Nueva y Editar orden de compra (borrador)"), orderCss.indexOf("Fin de Nueva y Editar orden de compra"));
assert.ok(ownCss.length > 400, "se localiza el bloque propio de la orden");
assert.doesNotMatch(ownCss, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, "bloque propio: sin colores literales");
assert.doesNotMatch(ownCss, /--color-(brand-[6-9]00|dark-)/, "bloque propio: sin tokens que no cambian con el tema");
assert.doesNotMatch(ownCss, /border-radius:\s*\d|box-shadow:\s*\d|transition:[^;]*\d+m?s/, "bloque propio: sin radios, sombras ni duraciones literales");
assert.match(ownCss, /\.po-delivery-panel \.po-fields input:focus-visible \{ outline: var\(--focus-outline\)/, "foco visible en los campos de Entrega");
assert.match(ownCss, /\.po-delivery-panel \.po-fields input \{[^}]*min-height: 2\.75rem;/, "área táctil de 44 px en los campos de Entrega");
const uiCss = read("src/styles/components.css");
for (const selector of [".ui-doc-head", ".ui-doc-back", ".ui-step-card", ".ui-step-title", ".ui-section-head", ".ui-party", ".ui-qty"]) {
  assert.ok(uiCss.includes(`${selector} {`), `components.css define ${selector}`);
}

console.log("PURCHASE_ORDER_NEW_PAGE_STRUCTURE_SMOKE_OK");
