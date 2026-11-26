import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {MemoryRouter, Route, Routes} from "react-router-dom";
import {createServer} from "vite";

// Editar recepción (borrador) y las vistas de detalle de Compra, Orden de compra y Recepción con el patrón común de Ventas,
// Compras y Órdenes de compra: cabecera "← <módulo>", título en <p> (un solo h1 por pantalla), chip de estado, fecha y origen;
// secciones como tarjetas visibles (sin acordeones); líneas de la recepción con los campos del sistema; y las fechas de las
// listas y de las cabeceras con formatDate (barras en BOB, formato de es-CL en Chile), nunca ISO crudo.
// Solo presentación y estructura: sin cálculos, validaciones, modelo, estados, stock ni costos. Sin emuladores ni red.
// Nueva recepción no es una pantalla aparte: la recepción nace desde la orden de compra (crearRecepcionDesdeOrden) y se
// completa en esta misma pantalla, que es la que se renderiza aquí.

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const strip = (html) => html.replace(/<!-- -->/g, "");
const text = (html) => strip(html).replace(/<[^>]+>/g, "");
const count = (value, pattern) => (value.match(pattern) || []).length;
const intlDate = (locale) => new Intl.DateTimeFormat(locale, {year: "numeric", month: "2-digit", day: "2-digit"}).format(new Date("2026-11-23T12:00:00Z"));
const BOB_DATE = "23/11/2026";
const CHILE_DATE = intlDate("es-CL");
assert.equal(BOB_DATE, intlDate("es-BO"), "el formato de es-BO usa barras");

// --- 1. Fuente: sin h1, sin acordeones, sin el patrón anterior --------------------------------------------------------------
const files = {
  reception: read("src/pages/NewReceptionPage.jsx"),
  receptionDetail: read("src/features/receptions/ReceptionDetailView.jsx"),
  purchaseDetail: read("src/features/purchases/PurchaseDetailView.jsx"),
  orderDetail: read("src/features/purchaseOrders/PurchaseOrderDetailView.jsx"),
};
for (const [name, source] of Object.entries(files)) {
  assert.doesNotMatch(source, /<h1\b/, `${name}: un solo h1 por pantalla (el de la barra superior)`);
  assert.doesNotMatch(source, /<details|<summary|po-details|Volver al historial|po-header__copy|po-header__title-row/, `${name}: sin acordeones ni el encabezado anterior`);
  assert.match(source, /<header className="ui-doc-head( no-print)?">/, `${name}: cabecera compartida`);
  assert.match(source, /<p className="ui-doc-head__title">/, `${name}: título en un <p>`);
}
assert.match(files.reception, /className="ui-doc-back" onClick=\{\(\) => navigate\("\/recepciones"\)\}>← Recepciones</);
assert.match(files.receptionDetail, /className="ui-doc-back" onClick=\{\(\) => navigate\("\/recepciones"\)\}>← Recepciones</);
assert.match(files.purchaseDetail, /className="ui-doc-back" onClick=\{\(\) => navigate\("\/compras"\)\}>← Compras</);
assert.match(files.orderDetail, /className="ui-doc-back" onClick=\{\(\) => navigate\("\/ordenes-compra"\)\}>← Órdenes de compra</);
for (const name of ["purchaseDetail", "orderDetail"]) {
  assert.match(files[name], /"Ver vista previa"/, `${name}: botón Ver vista previa`);
  assert.match(files[name], /"Ocultar vista previa"/, `${name}: botón Ocultar vista previa`);
  assert.match(files[name], /aria-expanded=\{previewOpen\}/, `${name}: el botón informa si la vista previa está abierta`);
}
// Lógica de la recepción intacta: mismos servicios, escáner, importación y diálogos (con su texto).
for (const needle of [
  "actualizarRecepcionBorrador(", "confirmarRecepcion(", "cancelarRecepcionBorrador(", "resolveReceptionScan(", "findActiveProductByBarcode(",
  "getReceptionConfirmationImpact(", "<ReceptionDocumentImportDialog", "<BarcodeInput", "Confirma el impacto de esta recepción",
  "Importar factura o documento", "Confirmar recepción y registrar compra", "Cancelar recepción",
]) {
  assert.ok(files.reception.includes(needle), `se conserva ${needle}`);
}
assert.match(files.reception, /const pending = Math\.max\(0, line\.cantidadSolicitada - line\.cantidadRecibidaAnterior\);/, "mismo cálculo de lo pendiente");
assert.match(files.reception, /\{\.\.\.item, \[field\]: Number\(value\)\}/, "mismo valor numérico al editar una línea");
// Las fechas de las listas pasan por formatDate.
const listSources = {receptions: read("src/pages/ReceptionsPage.jsx"), purchases: read("src/pages/PurchasesPage.jsx")};
assert.match(listSources.receptions, /formatDate\(entry\.fechaRecepcion, entry\.locale \|\| businessFormat\.locale\)/);
assert.match(listSources.purchases, /formatDate\(purchase\.fechaCompra, purchase\.locale \|\| businessFormat\.locale\)/);
assert.doesNotMatch(listSources.receptions, /\{entry\.fechaRecepcion \|\| "—"\}/);
assert.doesNotMatch(listSources.purchases, /\{purchase\.fechaCompra \|\| "—"\}/);

// --- 2. CSS: solo tokens, sin el diseño anterior ----------------------------------------------------------------------------
const receptionsCss = read("src/features/receptions/receptions.css");
const ownStart = receptionsCss.indexOf(".reception-grid {");
const ownEnd = receptionsCss.indexOf(".reception-document-source {");
const ownCss = receptionsCss.slice(ownStart, ownEnd);
assert.ok(ownCss.includes(".reception-line__row {") && ownCss.includes("@container (max-width: 30rem)"), "se localiza el bloque propio de las líneas");
assert.doesNotMatch(ownCss, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, "sin colores literales");
assert.doesNotMatch(ownCss, /border-radius:\s*\d|box-shadow:\s*\d|transition:[^;]*\d+m?s|\d+px/, "sin radios, sombras, duraciones ni px literales");
assert.doesNotMatch(receptionsCss, /\.reception-items-table|\.reception-line-action-label|\.reception-qty|\.reception-cost|\.reception-discount|\.reception-grid input/, "sin los controles y la tabla anteriores");
assert.doesNotMatch(receptionsCss, /\.reception-detail__(context|top|title|facts)/, "sin la tarjeta de título anterior");

// --- 3. Renderizado -------------------------------------------------------------------------------------------------------
// Las pantallas cargan sus datos en un efecto, que el render estático no ejecuta: el plugin siembra el estado inicial de la
// pantalla a probar (y falla en voz alta si el código fuente dejó de tener esas líneas).
const SEEDS = {
  "/src/pages/NewReceptionPage.jsx": [
    ["const [reception, setReception] = useState(null);", "const [reception, setReception] = useState(globalThis.__seed.reception);"],
    ['const [draft, setDraft] = useState({fechaRecepcion: "", observaciones: "", documentoOrigen: null, items: []});', "const [draft, setDraft] = useState(globalThis.__seed.draft);"],
    ["const [loading, setLoading] = useState(true);", "const [loading, setLoading] = useState(false);"],
  ],
  "/src/pages/ReceptionsPage.jsx": [
    ["const [items, setItems] = useState([]);", "const [items, setItems] = useState(globalThis.__seed.items);"],
    ["const [loading, setLoading] = useState(true);", "const [loading, setLoading] = useState(false);"],
  ],
  "/src/pages/PurchasesPage.jsx": [
    ["const [items, setItems] = useState([]);", "const [items, setItems] = useState(globalThis.__seed.items);"],
    ["const [loading, setLoading] = useState(true);", "const [loading, setLoading] = useState(false);"],
  ],
};
const seedPlugin = {
  name: "seed-initial-state",
  enforce: "pre",
  transform(code, id) {
    const key = Object.keys(SEEDS).find((suffix) => id.replaceAll("\\", "/").endsWith(suffix));
    if (!key) return null;
    let next = code;
    for (const [from, to] of SEEDS[key]) {
      assert.ok(next.includes(from), `${key}: ya no contiene «${from}»; actualiza el smoke`);
      next = next.replace(from, to);
    }
    return next;
  },
};

Object.assign(process.env, {
  VITE_FIREBASE_MODE: "emulator",
  VITE_USE_FIREBASE_CORE_EMULATORS: "true",
  VITE_USE_FIREBASE_FUNCTIONS_EMULATOR: "true",
  VITE_USE_FIREBASE_STORAGE_EMULATOR: "true",
});
const vite = await createServer({appType: "custom", logLevel: "silent", plugins: [seedPlugin], server: {middlewareMode: true}});
try {
  const hook = await vite.ssrLoadModule("/src/hooks/useBusinessFormat.js");
  const BUSINESSES = {
    BO: {paisCodigo: "BO", monedaCodigo: "BOB", locale: "es-BO"},
    CL: {paisCodigo: "CL", monedaCodigo: "CLP", locale: "es-CL"},
  };
  const render = (element, {business = BUSINESSES.BO, path = "/", route = "*"} = {}) => strip(renderToStaticMarkup(
    React.createElement(MemoryRouter, {initialEntries: [path]},
      React.createElement(hook.BusinessFormatProvider, {business},
        React.createElement(Routes, null, React.createElement(Route, {path: route, element}))))));

  const receptionFor = (key) => ({
    id: "r1", numero: "REC-2026-0001", estado: "borrador", fechaRecepcion: "2026-11-23", ordenCompraId: "o1", ordenCompraNumero: "OC-2026-0007",
    proveedorSnapshot: {razonSocial: "Ferretería Andes"}, respuestaProveedorEstado: "confirmada", observaciones: "", documentoOrigen: null,
    moneda: BUSINESSES[key].monedaCodigo, locale: BUSINESSES[key].locale, tasaIva: 0.13, montoDecimales: key === "BO" ? 2 : 0,
    items: [
      {lineaId: "l1", ordenLineaId: "l1", itemId: "p1", nombre: "Filtro de aceite", codigo: "", tipoItem: "producto", unidad: "unidad", cantidadSolicitada: 10, cantidadRecibidaAnterior: 4, cantidad: 3, costoUnitario: 60, descuentoPct: 5},
      {lineaId: "l2", ordenLineaId: "l2", itemId: "s1", nombre: "Instalación", codigo: "SV-1", tipoItem: "servicio", unidad: "hora", cantidadSolicitada: 2, cantidadRecibidaAnterior: 0, cantidad: 1, costoUnitario: 20, descuentoPct: 0, documentoLineas: [{}]},
    ],
  });

  // --- 3a. Editar recepción (borrador) ----------------------------------------------------------------------------------------
  const page = (await vite.ssrLoadModule("/src/pages/NewReceptionPage.jsx")).default;
  const editReception = (key, role = "ADMIN") => {
    const reception = receptionFor(key);
    globalThis.__seed = {reception, draft: {fechaRecepcion: reception.fechaRecepcion, observaciones: reception.observaciones, documentoOrigen: reception.documentoOrigen, items: reception.items}};
    return render(React.createElement(page, {businessId: "negocio-prueba", role}), {business: BUSINESSES[key], path: "/recepciones/r1/editar", route: "/recepciones/:recepcionId/editar"});
  };
  const bo = editReception("BO");
  assert.match(bo, /<header class="ui-doc-head no-print">/, "cabecera compartida");
  assert.ok(bo.includes('class="ui-doc-back">← Recepciones</button>'), "enlace ← Recepciones");
  assert.ok(bo.includes('<p class="ui-doc-head__title">REC-2026-0001</p>'), "título en un <p>");
  assert.ok(bo.includes('<span class="po-status po-status--borrador">Preparada</span>'), "chip de estado");
  assert.ok(bo.includes(`<span>${BOB_DATE}</span><span>Orden de compra OC-2026-0007</span>`), "fecha con barras (BOB) y origen en la cabecera");
  assert.ok(!bo.includes("<h1") && !bo.includes("Volver al historial") && !bo.includes("po-kicker"), "ya no hay h1, botón Volver al historial ni etiqueta RECEPCIÓN");
  assert.ok(!text(bo).includes("2026-11-23") || /type="date"[^>]*value="2026-11-23"/.test(bo), "la fecha ISO solo vive en el valor del campo de fecha del navegador");
  assert.ok(!/>2026-11-23</.test(bo), "ninguna fecha ISO visible");
  assert.match(bo, /<input class="erp-control" type="date" value="2026-11-23"\/>/, "el campo de fecha sigue siendo el date del navegador, con el campo del sistema");
  assert.ok(bo.includes('<textarea class="erp-control"'), "observaciones con el campo del sistema");
  assert.ok(!bo.includes("<details") && !bo.includes("po-details"), "sin acordeones");
  // Confirmación del proveedor y proveedor
  assert.ok(text(bo).includes("Confirmación del proveedorConfirmada"), "se muestra la confirmación del proveedor");
  assert.ok(text(bo).includes("ProveedorFerretería Andes"), "se muestra el proveedor");
  // Líneas: sin tabla, con los campos del sistema y el espacio entre nombre y detalle
  assert.ok(!bo.includes("<table") && !bo.includes("erp-table") && !bo.includes("reception-items-table"), "sin la tabla anterior");
  assert.equal(count(bo, /class="ui-doc-line"/g), 2, "una fila por ítem");
  const plain = text(bo);
  assert.ok(plain.includes("Filtro de aceite Producto · unidad"), "el nombre y «Producto · unidad» quedan separados por un espacio");
  assert.ok(!plain.includes("aceiteProducto") && !plain.includes("aceiteproducto"), "ya no se pega el detalle al nombre");
  assert.ok(plain.includes("Instalación SV-1 · Servicio · hora · Asociado desde documento"), "código, tipo, unidad y marca de documento asociado");
  assert.equal(count(bo, /<input class="ui-doc-line__input"/g), 6, "tres campos del sistema por línea: cantidad, costo y descuento");
  assert.equal(count(bo, /<input[^>]*class="(reception-qty|reception-cost|reception-discount)"/g), 0, "sin los controles sin estilo");
  assert.match(bo, /type="number" min="0" max="6" step="any" aria-label="Recibir ahora: cantidad de Filtro de aceite" value="3"/, "cantidad actual: tope = pendiente (10 − 4)");
  assert.match(bo, /type="number" min="0" step="0\.01" aria-label="Costo unitario de Filtro de aceite" value="60"/, "el costo usa el paso de la moneda (BOB: 0,01)");
  assert.match(bo, /type="number" min="0" max="100" step="any" aria-label="Descuento % de Filtro de aceite" value="5"/);
  assert.match(bo, /aria-label="Confirmar ahora: cantidad de Instalación"|aria-label="Confirmar prestación: cantidad de Instalación"/, "los servicios conservan su etiqueta de acción");
  assert.ok(bo.includes('class="ui-doc-line__symbol" aria-hidden="true">Bs</span>'), "el costo muestra el símbolo de la moneda (BOB)");
  for (const caption of ["Solicitado", "Recibido antes", "Pendiente", "Recibir ahora", "Confirmar prestación", "Costo unitario", "Desc. %"]) {
    assert.ok(bo.includes(`>${caption}</span>`), `columna ${caption}`);
  }
  assert.match(bo, /reception-line__pending"><span class="ui-doc-line__caption">Pendiente<\/span><span class="ui-doc-line__amount">6</, "pendiente = solicitado − recibido antes");
  // Acciones, escáner e importación
  for (const label of ["Guardar", "Confirmar recepción", "Cancelar", "Importar factura o documento", "Escanear producto"]) {
    assert.ok(bo.includes(label), `acción ${label}`);
  }
  assert.ok(bo.includes('class="ui-button ui-button--danger"'), "Cancelar con el botón compartido de peligro");
  assert.ok(!bo.includes("po-button"), "sin la familia de botón anterior");
  // Chile: mismo formato de fecha que el resto del sistema en es-CL
  const cl = editReception("CL");
  assert.ok(cl.includes(`<span>${CHILE_DATE}</span><span>Orden de compra OC-2026-0007</span>`), `fecha con el formato de Chile (${CHILE_DATE})`);
  assert.ok(!/>2026-11-23</.test(cl));
  // Sin permiso: valores estáticos, sin acciones
  const viewer = editReception("BO", "VIEWER");
  assert.ok(!viewer.includes('<input class="ui-doc-line__input"') && !viewer.includes("Guardar") && !viewer.includes("Importar factura"), "sin permiso: sin campos ni acciones");
  assert.ok(viewer.includes(">Costo unitario</span>") && viewer.includes(">Desc. %</span>"), "sin permiso: valores con su etiqueta");

  // --- 3b. Detalle de la recepción confirmada ------------------------------------------------------------------------------------
  const receptionDetail = (await vite.ssrLoadModule("/src/features/receptions/ReceptionDetailView.jsx")).default;
  for (const [key, expected] of [["BO", BOB_DATE], ["CL", CHILE_DATE]]) {
    const confirmed = {...receptionFor(key), estado: "confirmada", compraId: "c1", compraNumero: "CMP-2026-0003"};
    const html = render(React.createElement(receptionDetail, {reception: confirmed, linkedPurchase: null, message: ""}), {business: BUSINESSES[key]});
    assert.ok(html.includes('class="ui-doc-back">← Recepciones</button>') && html.includes('<p class="ui-doc-head__title">REC-2026-0001</p>'), `${key}: cabecera`);
    assert.ok(html.includes('po-status po-status--confirmada">Recibida</span>'), `${key}: chip de estado`);
    assert.ok(html.includes(`<span>${expected}</span>`) && !/>2026-11-23</.test(html), `${key}: fecha ${expected}`);
    assert.ok(html.includes("Orden de compra OC-2026-0007</button>"), `${key}: origen con enlace a la orden`);
    assert.ok(!html.includes("<h1") && !html.includes("<details") && !html.includes("Volver al historial"), `${key}: sin h1, acordeones ni Volver al historial`);
    assert.ok(text(html).includes("Filtro de aceite") && html.includes("Costo unitario (neto)"), `${key}: tabla de ítems de la compra`);
  }

  // --- 3c. Detalle de la compra --------------------------------------------------------------------------------------------------
  const purchaseDetail = (await vite.ssrLoadModule("/src/features/purchases/PurchaseDetailView.jsx")).default;
  const purchaseFor = (key) => ({
    id: "c1", numero: "CMP-2026-0003", estado: "confirmada", fechaCompra: "2026-11-23", fechaDocumento: "2026-11-20", tipoDocumento: "factura", numeroDocumentoProveedor: "F-100",
    recepcionId: "r1", recepcionNumero: "REC-2026-0001", ordenCompraId: "o1", ordenCompraNumero: "OC-2026-0007", proveedorSnapshot: {razonSocial: "Ferretería Andes"},
    moneda: BUSINESSES[key].monedaCodigo, locale: BUSINESSES[key].locale, paisCodigo: key, subtotal: 180, descuentoTotal: 0, neto: 180, montoExento: 0, iva: 23.4, total: 203.4,
    condicionesPago: "30 días", observaciones: "Entrega en bodega", documentoOrigen: {fechaVencimiento: "2026-12-20"}, efectosInventario: [], items: [
      {lineaId: "l1", nombre: "Filtro de aceite", tipoItem: "producto", unidad: "unidad", cantidad: 3, costoUnitario: 60, descuentoPct: 0},
    ],
  });
  for (const [key, expected] of [["BO", BOB_DATE], ["CL", CHILE_DATE]]) {
    const purchase = purchaseFor(key);
    const html = render(React.createElement(purchaseDetail, {purchase, printable: {...purchase, impuestoNombre: "IVA", tasaIva: 0.13}, company: {nombre: "Bagner", paisCodigo: key, locale: BUSINESSES[key].locale}, message: ""}), {business: BUSINESSES[key]});
    assert.ok(html.includes('class="ui-doc-back">← Compras</button>') && html.includes('<p class="ui-doc-head__title">Compra CMP-2026-0003</p>'), `${key}: cabecera`);
    assert.ok(html.includes('po-status po-status--confirmada">'), `${key}: chip de estado`);
    assert.ok(html.includes(`<span>${expected}</span>`), `${key}: fecha de la compra ${expected}`);
    assert.ok(html.includes("Recepción REC-2026-0001</button>") && html.includes("Orden de compra OC-2026-0007</button>"), `${key}: origen`);
    assert.ok(!html.includes("<h1") && !html.includes("<details") && !html.includes("po-details") && !html.includes("Volver al historial"), `${key}: sin h1, acordeones ni Volver al historial`);
    for (const title of ["Documento y fechas", "Condiciones comerciales", "Vista previa imprimible"]) {
      assert.ok(html.includes(`class="ui-section-head__title">${title}</h2>`), `${key}: tarjeta ${title}`);
    }
    assert.ok(html.includes(">Ver vista previa</span>") && !html.includes("Ocultar vista previa"), `${key}: la vista previa parte cerrada`);
    assert.ok(!html.includes('<div class="purchase-preview-body">'), `${key}: la vista previa no se dibuja cerrada`);
    assert.ok(html.includes("30 días") && html.includes("Entrega en bodega"), `${key}: condiciones y observaciones visibles`);
    assert.ok(text(html).includes(`Fecha${expected}`) || text(html).includes(expected), `${key}: fecha del documento con formato regional`);
    assert.ok(!/>2026-1[12]-\d\d</.test(html), `${key}: ninguna fecha ISO visible`);
  }

  // --- 3d. Detalle de la orden de compra -------------------------------------------------------------------------------------------
  const orderDetail = (await vite.ssrLoadModule("/src/features/purchaseOrders/PurchaseOrderDetailView.jsx")).default;
  for (const [key, expected] of [["BO", BOB_DATE], ["CL", CHILE_DATE]]) {
    const order = {
      id: "o1", numero: "OC-2026-0007", estado: "emitida", fechaEmision: "2026-11-23", fechaEntregaEstimada: "2026-11-30", direccionEntrega: "Bodega central", condicionesPago: "Contado", observaciones: "",
      proveedorSnapshot: {razonSocial: "Ferretería Andes"}, canalEmision: "correo", emitidaEn: "2026-11-23T15:00:00Z", creadoEn: "2026-11-23T14:00:00Z",
      respuestaProveedor: {estado: "confirmada_con_observaciones", comentario: "Entrega parcial el viernes", fecha: "2026-11-24T10:00:00Z"},
      items: [{lineaId: "l1", nombre: "Filtro de aceite", tipoItem: "producto", unidad: "unidad", cantidad: 10, costoUnitario: 60, descuentoPct: 0}],
    };
    const html = render(React.createElement(orderDetail, {
      canDelete: false, canManage: true, company: {nombre: "Bagner"}, currentUser: null, duplicating: false, memberByUid: new Map(), message: "", order,
      printableOrder: {...order, moneda: BUSINESSES[key].monedaCodigo, locale: BUSINESSES[key].locale, paisCodigo: key, impuestoNombre: "IVA", tasaIva: 0.13},
      receptionActionLabel: "Registrar recepción", receptionStatus: "sin_recepcion", receptions: [], saving: false,
      totals: {subtotal: 600, descuentoTotal: 0, neto: 600, iva: 78, total: 678}, whatsAppAvailability: {enabled: false, help: ""},
      onCancel() {}, onCreateReception() {}, onDelete() {}, onDownloadPdf() {}, onDuplicate() {}, onEmail() {}, onSupplierConfirmation() {}, onWhatsApp() {},
    }), {business: BUSINESSES[key]});
    assert.ok(html.includes('class="ui-doc-back">← Órdenes de compra</button>') && html.includes('<p class="ui-doc-head__title">OC-2026-0007</p>'), `${key}: cabecera`);
    assert.ok(html.includes('po-status po-status--emitida">Emitida</span>'), `${key}: chip de estado`);
    assert.ok(html.includes(`<span>${expected}</span><span>Orden directa</span>`), `${key}: fecha ${expected} y origen`);
    assert.ok(!html.includes("<h1") && !html.includes("<details") && !html.includes("po-details") && !html.includes("Volver al historial"), `${key}: sin h1, acordeones ni Volver al historial`);
    assert.ok(html.includes("Registrar recepción") && html.includes("Descargar PDF") && html.includes("Reenviar correo"), `${key}: acciones de la orden`);
    assert.ok(html.includes("Confirmada con observaciones") && html.includes("Entrega parcial el viernes"), `${key}: la orden muestra el estado completo del proveedor y su observación`);
    assert.ok(html.includes("Recepción pendiente"), `${key}: estado de recepción`);
    assert.ok(html.includes('class="ui-section-head__title">Vista previa imprimible</h2>') && html.includes(">Ver vista previa</span>") && !html.includes("Ocultar vista previa"), `${key}: vista previa como tarjeta, cerrada`);
    assert.ok(!html.includes('<div class="po-preview-body">'), `${key}: la vista previa no se dibuja cerrada`);
  }

  // --- 3e. Listas: fechas con formato regional -------------------------------------------------------------------------------------
  const receptionsPage = (await vite.ssrLoadModule("/src/pages/ReceptionsPage.jsx")).default;
  const purchasesPage = (await vite.ssrLoadModule("/src/pages/PurchasesPage.jsx")).default;
  for (const [key, expected] of [["BO", BOB_DATE], ["CL", CHILE_DATE]]) {
    const reception = {...receptionFor(key), estado: "confirmada"};
    globalThis.__seed = {items: [reception]};
    const receptions = render(React.createElement(receptionsPage, {businessId: "negocio-prueba", role: "ADMIN"}), {business: BUSINESSES[key]});
    assert.ok(receptions.includes(`<td>${expected}</td>`) && !/>2026-11-23</.test(receptions), `${key}: lista de Recepciones con ${expected}`);
    // Un documento antiguo sin formato propio usa el del negocio, no el ISO.
    globalThis.__seed = {items: [{...reception, locale: ""}]};
    assert.ok(render(React.createElement(receptionsPage, {businessId: "negocio-prueba", role: "ADMIN"}), {business: BUSINESSES[key]}).includes(`<td>${expected}</td>`), `${key}: sin locale propio, el del negocio`);
    globalThis.__seed = {items: [purchaseFor(key)]};
    const purchases = render(React.createElement(purchasesPage, {businessId: "negocio-prueba", role: "ADMIN"}), {business: BUSINESSES[key]});
    assert.ok(purchases.includes(`<small>${expected}</small>`) && purchases.includes(`<dd>${expected}</dd>`), `${key}: lista de Compras (tabla y tarjetas) con ${expected}`);
    assert.ok(!/>2026-11-23</.test(purchases), `${key}: la lista de Compras ya no muestra ISO`);
  }
} finally {
  await vite.close();
}
console.log("reception-detail-pages-smoke: OK");
