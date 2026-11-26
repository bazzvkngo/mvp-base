import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {MemoryRouter} from "react-router-dom";
import {createServer} from "vite";

// Nueva cotización con el mismo patrón visual que Nueva venta, Nueva compra y Nueva orden de compra: encabezado con
// "← Cotizaciones", título y chip del estado; cliente con el selector en línea compartido; títulos de sección sin
// numeración; ítems con el bloque compartido (etiquetas visibles, símbolo de la moneda, flechas y descripción por línea);
// condiciones en una tarjeta visible; resumen con el descuento global y el motivo del botón. Solo presentación: los
// manejadores son los de siempre y el adaptador de ítems los alcanza con los mismos campos. Sin emuladores ni red.

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const strip = (html) => html.replace(/<!-- -->/g, "").replace(/\u00a0/g, " ");
const plain = (text) => String(text).replace(/\u00a0/g, " ");
const count = (text, pattern) => (text.match(pattern) || []).length;
const BOB = {paisCodigo: "BO", monedaCodigo: "BOB", locale: "es-BO"};
const CLP = {paisCodigo: "CL", monedaCodigo: "CLP", locale: "es-CL"};

Object.assign(process.env, {
  VITE_FIREBASE_MODE: "emulator",
  VITE_USE_FIREBASE_CORE_EMULATORS: "true",
  VITE_USE_FIREBASE_FUNCTIONS_EMULATOR: "true",
  VITE_USE_FIREBASE_STORAGE_EMULATOR: "true",
});
const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
try {
  const hook = await vite.ssrLoadModule("/src/hooks/useBusinessFormat.js");
  const formatters = await vite.ssrLoadModule("/src/utils/formatters.js");
  const page = (await vite.ssrLoadModule("/src/pages/NewQuotePage.jsx")).default;
  const itemsEditor = (await vite.ssrLoadModule("/src/features/quotes/QuoteItemsEditor.jsx")).default;
  const summaryPanel = (await vite.ssrLoadModule("/src/features/quotes/QuoteSummaryPanel.jsx")).default;
  const conditionsPanel = (await vite.ssrLoadModule("/src/features/quotes/QuoteConditionsPanel.jsx")).default;
  const {QuoteClientPicker} = await vite.ssrLoadModule("/src/features/quotes/QuoteClientSelector.jsx");
  const sharedItems = (await vite.ssrLoadModule("/src/components/ui/DocumentItemsEditor.jsx")).default;
  const layout = await vite.ssrLoadModule("/src/domain/quoteDocumentLayout.mjs");
  const emailTemplate = await vite.ssrLoadModule("/src/domain/quoteEmailTemplate.mjs");
  const wrap = (element, business) => strip(renderToStaticMarkup(
    React.createElement(MemoryRouter, {initialEntries: ["/cotizaciones/nueva"]},
      React.createElement(hook.BusinessFormatProvider, {business}, element)),
  ));

  // --- 1. Pantalla completa: encabezado, secciones sin numeración y orden ---------------------------------------------------
  for (const [country, business] of [["BOB", BOB], ["CLP", CLP]]) {
    const html = wrap(React.createElement(page, {userId: "usuario-prueba"}), business);
    const label = `Nueva cotización · ${country}`;
    assert.ok(html.includes('<header class="ui-doc-head no-print">'), `${label}: cabecera del patrón compartido`);
    assert.ok(html.includes('class="ui-doc-back" href="/cotizaciones"') && html.includes("← Cotizaciones</a>"), `${label}: "← Cotizaciones"`);
    assert.ok(html.includes('<p class="ui-doc-head__title">Nueva cotización</p>'), `${label}: título en un <p> (el h1 es el de la barra superior)`);
    assert.ok(!html.includes("<h1"), `${label}: un solo h1 por pantalla`);
    assert.ok(html.includes('<span class="ui-status-badge ui-status-badge--warning">Pendiente</span>'), `${label}: chip con el estado de una cotización nueva (borrador = Pendiente)`);
    assert.ok(html.includes('<h2 id="quote-client-title" class="ui-step-title">¿A quién le cotizas?</h2>'), `${label}: ¿A quién le cotizas?`);
    assert.ok(html.includes('<h2 id="quote-items-title" class="ui-step-title">¿Qué cotizas?</h2>'), `${label}: ¿Qué cotizas?`);
    assert.ok(html.includes('<h2 id="quote-conditions-title" class="ui-section-head__title">Condiciones</h2>'), `${label}: Condiciones`);
    assert.ok(!/<h2[^>]*>\s*\d\s*·/.test(html), `${label}: sin numeración "1 · / 2 · / 3 ·"`);
    assert.ok(html.indexOf("quote-client-title") < html.indexOf("quote-items-title") && html.indexOf("quote-items-title") < html.indexOf("quote-conditions-title"), `${label}: orden cliente, ítems, condiciones`);
    // Asunto: campo propio con texto guía genérico y rótulo "Asunto" en el PDF
    assert.ok(html.includes("<span>Asunto</span>") && html.includes('placeholder="Escribe el asunto de la cotización"'), `${label}: Asunto con texto guía genérico`);
    assert.ok(!html.includes("Escalera") && !html.includes("estanque"), `${label}: sin ejemplos de rubro`);
    assert.ok(html.includes("Resume en pocas palabras qué se cotiza. Aparece como &#x27;Asunto&#x27; en el PDF."), `${label}: ayuda del Asunto`);
    assert.ok(count(html, /La cotización guarda una copia histórica de los datos del cliente\./g) === 1, `${label}: nota de copia histórica, una sola vez`);
    // Ítems vacíos: bloque compartido
    assert.ok(html.includes("0 ítems") && html.includes("Escanear producto") && html.includes("Agregar desde inventario"), `${label}: bloque de ítems con sus dos acciones`);
    assert.ok(html.includes("Agrega productos, servicios o actividades para construir la cotización."), `${label}: estado vacío`);
    // Resumen
    assert.ok(html.includes('<aside class="po-panel po-summary purchase-summary quote-summary no-print"') && html.includes("<h2>Resumen</h2>"), `${label}: resumen con el estilo de Compras y Ventas`);
    assert.ok(html.includes("Crear cotización") && html.includes("purchase-summary__primary"), `${label}: botón principal alto`);
    assert.ok(html.includes("El número se asignará al crear la cotización."), `${label}: aviso del número`);
    // Condiciones visibles dentro de la tarjeta (no en un diálogo)
    assert.ok(html.includes('<section class="po-panel quote-conditions no-print"') && html.includes("Vigencia (días)") && html.includes("Forma de pago") && html.includes("Plazo de ejecución o entrega"), `${label}: condiciones y vigencia visibles en la tarjeta`);
    assert.ok(!html.includes("Editar condiciones"), `${label}: no hay botón Editar condiciones (los campos no son los de Ventas)`);
  }

  // --- 2. Selector de cliente: el de Compras y Órdenes de compra, con el texto de cada país --------------------------------
  const clients = [
    {clienteId: "c1", negocioId: "n1", estado: "activo", nombreRazonSocial: "Constructora Andina", identificadorFiscalTipo: "NIT", identificadorFiscalValor: "1023456789", personaContacto: "Rosa Quispe", email: "rosa@andina.test"},
    {clienteId: "c2", negocioId: "n1", estado: "activo", nombreRazonSocial: "Taller Los Pinos", identificadorFiscalTipo: "CI", identificadorFiscalValor: "7654321", email: "pinos@taller.test"},
  ];
  const picker = (props, business) => wrap(React.createElement(QuoteClientPicker, {clients, onChange() {}, ...props}), business);
  for (const [country, business, fiscal] of [["BOB", BOB, "CI o NIT"], ["CLP", CLP, "RUT"]]) {
    const html = picker({value: ""}, business);
    assert.ok(html.includes('class="ui-party__search"') && html.includes('aria-label="Buscar cliente"') && html.includes('placeholder="Buscar por nombre o identificación fiscal"'), `${country}: buscador de cliente`);
    assert.ok(html.includes(`Tienes 2 clientes activos · escribe un nombre o ${fiscal} para buscar`), `${country}: línea guía con "${fiscal}"`);
    assert.ok(html.includes(">Ver todos los clientes</button>"), `${country}: Ver todos los clientes`);
    assert.ok(!html.includes("Constructora Andina"), `${country}: sin escribir no se dibuja la lista`);
  }
  const chosen = picker({value: "c1", snapshot: clients[0]}, BOB);
  assert.ok(chosen.includes('class="ui-party__selected"') && chosen.includes("Constructora Andina") && chosen.includes("NIT 1023456789") && chosen.includes("Rosa Quispe"), "cliente elegido: tarjeta con nombre, identificación y contacto");
  assert.ok(chosen.includes(">Cambiar cliente</span>"), "cliente elegido: Cambiar cliente");
  const saved = picker({value: "c1", snapshot: clients[0], originalSnapshot: {...clients[0], nombreRazonSocial: "Constructora Andina SA (al cotizar)"}}, BOB);
  assert.ok(saved.includes("Constructora Andina SA (al cotizar)") && saved.includes("Datos del cliente guardados en la cotización"), "cotización guardada: se muestran los datos congelados con su nota");
  const inactive = picker({clients: [clients[1]], value: "c1", snapshot: clients[0]}, BOB);
  assert.ok(inactive.includes("Constructora Andina") && inactive.includes(">Cambiar cliente</span>"), "cliente elegido que ya no está entre los activos: se muestra la copia de la cotización");
  const legacy = picker({value: "", snapshot: {nombreRazonSocial: "Cliente antiguo"}}, BOB);
  assert.ok(legacy.includes("Cliente histórico no vinculado: Cliente antiguo."), "cotización antigua sin vínculo: el dato histórico no desaparece");
  const noClients = picker({clients: [], value: ""}, BOB);
  assert.ok(noClients.includes("Aún no tienes clientes") && noClients.includes("Crea uno en Clientes para poder cotizar.") && noClients.includes('href="/clientes"'), "sin clientes: aviso con enlace a Clientes");

  // --- 3. Ítems: bloque compartido en modo venta, con flechas y descripción por línea -------------------------------------------
  const quoteLines = [
    {lineaId: "a", itemId: "p1", codigo: "FA-1", nombre: "Filtro de aceite", tipoItem: "producto", unidad: "un", cantidad: 3, precioUnitarioEditable: 60, descuentoPorcentaje: 5, totalLinea: 171.5, descripcionComercial: "Filtro original, incluye empaque"},
    {lineaId: "", itemId: "p2", inventarioSnapshot: {codigoInterno: "SV-9"}, nombre: "Instalación", tipoItem: "servicio", unidad: "unidad", cantidad: 1, precioUnitarioEditable: 20.5, descuentoPorcentaje: 0, totalLinea: 20.5, descripcion: "Mano de obra en sitio"},
  ];
  const baseProps = {items: quoteLines, onMove() {}, onOpenCatalog() {}, onRemove() {}, onScanProduct: async () => ({key: "p1", label: "Filtro"}), onUpdate() {}};
  for (const [country, business, symbol, step] of [["BOB", BOB, "Bs", "0.01"], ["CLP", CLP, "$", "any"]]) {
    const html = wrap(React.createElement(itemsEditor, {...baseProps, moneyStep: step, highlightedItemId: "p2", feedback: "Ítem agregado a la cotización."}), business);
    assert.ok(html.includes('<h2 id="quote-items-title" class="ui-step-title">¿Qué cotizas?</h2>') && html.includes("2 ítems"), `${country}: título y contador`);
    assert.ok(html.includes("Escanear producto") && html.includes("Agregar desde inventario") && !html.includes("Abrir catálogo"), `${country}: Escanear producto y Agregar desde inventario`);
    for (const caption of ["Cantidad", "Precio unitario", "Desc. %", "Total"]) {
      assert.equal(count(html, new RegExp(`class="ui-doc-line__caption"[^>]*>${caption.replace(".", "\\.")}</span>`, "g")), 2, `${country}: etiqueta visible "${caption}" en cada fila`);
    }
    assert.equal(count(html, new RegExp(`<span class="ui-doc-line__symbol" aria-hidden="true">${symbol.replace("$", "\\$")}</span>`, "g")), 2, `${country}: símbolo ${symbol} en cada fila`);
    assert.match(html, new RegExp(`aria-label="Precio unitario de Filtro de aceite"[^>]*step="${step === "any" ? "any" : "0\\.01"}"[^>]*value="60"`), `${country}: precio con el paso de la moneda`);
    assert.match(html, /aria-label="Descuento % de Filtro de aceite"[^>]*max="100"[^>]*step="any"[^>]*value="5"/, `${country}: Desc. % visible, no plegado`);
    assert.ok(html.includes('aria-label="Disminuir cantidad de Filtro de aceite"') && html.includes('aria-label="Aumentar cantidad de Filtro de aceite"'), `${country}: − y +`);
    assert.ok(!html.includes("<details") && !html.includes("Descripción y descuento") && !html.includes("lucide-pencil"), `${country}: sin desplegable ni lápiz`);
    // Total de línea: el que calcula la página (totalLinea), con el formato de la moneda
    for (const total of [171.5, 20.5]) assert.ok(html.includes(plain(formatters.formatBusinessMoney(total, business.monedaCodigo, business.locale))), `${country}: total ${total} con el formato de la moneda`);
    assert.ok(!(country === "BOB" && /\$\s?\d/.test(html)), "BOB: sin signo de dólar");
    // Flechas
    assert.ok(html.includes('aria-label="Subir Filtro de aceite"') && html.includes('aria-label="Bajar Filtro de aceite"') && html.includes('aria-label="Subir Instalación"') && html.includes('aria-label="Bajar Instalación"'), `${country}: flechas de orden`);
    assert.match(html, /aria-label="Subir Filtro de aceite"[^>]*disabled=""/, `${country}: la primera línea no sube`);
    assert.match(html, /aria-label="Bajar Instalación"[^>]*disabled=""/, `${country}: la última línea no baja`);
    assert.equal(count(html, /ui-doc-line__row ui-doc-line__row--movable/g), 2, `${country}: filas con flechas`);
    assert.ok(html.includes('aria-label="Quitar Filtro de aceite"'), `${country}: quitar`);
    // Descripción por línea visible bajo la fila
    assert.equal(count(html, /Descripción para esta cotización<\/span><textarea/g), 2, `${country}: descripción visible en cada línea`);
    assert.ok(html.includes("Filtro original, incluye empaque") && html.includes("Mano de obra en sitio"), `${country}: descripción comercial, o la del ítem si no hay`);
    assert.ok(html.includes("solo cambian esta cotización; el inventario no se modifica."), `${country}: aviso del inventario`);
    // Código, tipo y unidad; resaltado y aviso de agregado
    assert.ok(html.includes("FA-1 · Producto · un</small>") && html.includes("SV-9 · Servicio</small>"), `${country}: código · tipo · unidad (con el código del snapshot)`);
    assert.equal(count(html, /ui-doc-line ui-doc-line--highlighted/g), 1, `${country}: se resalta solo la línea agregada`);
    assert.ok(html.includes("Ítem agregado a la cotización."), `${country}: aviso de agregado`);
    assert.ok(wrap(React.createElement(itemsEditor, {...baseProps, items: [], validationError: "Agrega al menos un ítem."}), business).includes('role="alert"'), `${country}: error de validación con rol alert`);
  }

  // El adaptador alcanza los mismos manejadores y campos de siempre (sin renderizar de nuevo: se evalúa el elemento que devuelve).
  {
    const calls = [];
    let element;
    const Probe = (props) => { element = itemsEditor(props); return null; };
    renderToStaticMarkup(React.createElement(Probe, {
      ...baseProps,
      onMove: (...args) => calls.push(["move", ...args]),
      onRemove: (...args) => calls.push(["remove", ...args]),
      onUpdate: (...args) => calls.push(["update", ...args]),
    }));
    const props = element.props;
    assert.equal(props.mode, "venta", "modo venta: precio unitario");
    assert.equal(props.items[1].lineaId, "p2", "una línea sin lineaId usa su itemId, como siempre");
    assert.equal(props.getLineTotal(props.items[0]), 171.5, "el total de línea es totalLinea");
    props.onMoveLine(1, -1);
    assert.deepEqual(calls.pop(), ["move", 1, -1], "las flechas llaman a onMove(index, direction)");
    props.onChange(props.items.map((item) => (item.lineaId === "a" ? {...item, cantidad: 4} : item)));
    assert.deepEqual(calls.pop(), ["update", "a", "cantidad", 4], "cantidad -> cantidad");
    props.onChange(props.items.map((item) => (item.lineaId === "a" ? {...item, precioUnitario: "65"} : item)));
    assert.deepEqual(calls.pop(), ["update", "a", "precioUnitarioEditable", "65"], "precio unitario -> precioUnitarioEditable");
    props.onChange(props.items.map((item) => (item.lineaId === "p2" ? {...item, descuentoPct: "10"} : item)));
    assert.deepEqual(calls.pop(), ["update", "p2", "descuentoPorcentaje", "10"], "Desc. % -> descuentoPorcentaje");
    props.onChange(props.items.filter((item) => item.lineaId !== "a"));
    assert.deepEqual(calls.pop(), ["remove", "a"], "quitar llama a onRemove(lineId)");
    assert.equal(calls.length, 0, "cada cambio llama a un solo manejador");
    const note = props.renderLineDescription(props.items[0]);
    const textarea = React.Children.toArray(note.props.children).find((child) => child.type === "textarea");
    assert.equal(textarea.props.value, "Filtro original, incluye empaque");
    textarea.props.onChange({target: {value: "Otra descripción"}});
    assert.deepEqual(calls.pop(), ["update", "a", "descripcionComercial", "Otra descripción"], "la descripción llama a onUpdate(lineId, descripcionComercial, texto)");
  }

  // El bloque compartido no cambia para Ventas, Compras y Órdenes de compra: sin las props nuevas no hay flechas ni filas "movable".
  const plainItems = [{lineaId: "a", itemId: "p1", codigo: "FA-1", nombre: "Filtro", descripcion: "Filtro de aceite sintético", tipoItem: "producto", unidad: "un", cantidad: 3, precioUnitario: 60, costoUnitario: 40, descuentoPct: 5}];
  const unchanged = wrap(React.createElement(sharedItems, {items: plainItems, mode: "venta", onChange() {}, onOpenCatalog() {}, title: "¿Qué vendes?", titleId: "sale-items-title"}), BOB);
  assert.ok(!unchanged.includes("ui-doc-line__move") && !unchanged.includes("--movable") && !unchanged.includes("--highlighted") && !unchanged.includes("<textarea"), "sin las props nuevas el bloque es el de siempre");
  assert.ok(unchanged.includes("Filtro de aceite sintético") && unchanged.includes(plain(formatters.formatBusinessMoney(171, "BOB", "es-BO"))), "la descripción es texto y el total es cantidad × precio × descuento");

  // --- 4. Resumen: descuento global, subtotal neto, IVA, total, botón y motivo --------------------------------------------------
  const totals = {subtotal: 1000, descuentoItems: 50, descuento: 100, neto: 850, iva: 110.5, total: 960.5};
  for (const [country, currency, locale, rate, symbolPattern] of [["BOB", "BOB", "es-BO", 13, /Bs/], ["CLP", "CLP", "es-CL", 19, /\$/]]) {
    const props = {currency, locale, isEditMode: false, onDiscountChange() {}, onSave() {}, quote: {descuento: 100, afectaIva: true}, saveBlocked: true, saveBlockedReason: "Falta: cliente", saving: false, savingEstado: "", totals, totalsError: "", taxName: "IVA", taxRate: rate};
    const html = wrap(React.createElement(summaryPanel, props), country === "BOB" ? BOB : CLP);
    assert.ok(html.includes("<h2>Resumen</h2>") && !html.includes("Totales"), `${country}: título "Resumen"`);
    assert.ok(html.includes(`>Descuento (${currency})</label>`) && html.includes('id="quote-global-discount"') && html.includes('value="100"'), `${country}: descuento global con su moneda`);
    assert.ok(html.includes("<span>Subtotal neto</span>") && html.includes("<span>Descuentos por línea</span>") && html.includes(`<span>IVA ${rate}%</span>`), `${country}: subtotal neto, descuentos por línea e IVA`);
    assert.ok(html.includes('<div class="po-summary__total"><span>Total</span>'), `${country}: total destacado`);
    assert.ok(symbolPattern.test(html) && html.includes(plain(formatters.formatMoney(960.5, currency, locale))), `${country}: importes con la moneda del negocio`);
    assert.match(html, /<button[^>]*purchase-summary__primary[^>]*disabled=""[^>]*aria-describedby="quote-save-blocked-reason"/, `${country}: botón principal deshabilitado y descrito por el motivo`);
    assert.ok(html.includes('id="quote-save-blocked-reason"') && html.includes("Falta: cliente"), `${country}: motivo "Falta: cliente"`);
    assert.ok(html.includes("El número se asignará al crear la cotización."), `${country}: aviso del número`);
  }
  const enabled = wrap(React.createElement(summaryPanel, {currency: "BOB", locale: "es-BO", isEditMode: true, onDiscountChange() {}, onSave() {}, quote: {descuento: 0, afectaIva: false}, saveBlocked: false, saveBlockedReason: "", saving: false, savingEstado: "", totals: {...totals, descuentoItems: 0}, totalsError: "No se pudieron calcular los totales.", taxName: "IVA", taxRate: 13}), BOB);
  assert.ok(enabled.includes("Guardar cambios") && !enabled.includes("El número se asignará") && !enabled.includes("quote-save-blocked-reason"), "edición: Guardar cambios, sin aviso del número ni motivo");
  assert.ok(enabled.includes("IVA (exenta)") && !enabled.includes("Descuentos por línea") && enabled.includes("No se pudieron calcular los totales."), "exenta, sin descuentos por línea y con el error de totales");

  // --- 5. Condiciones: tarjeta visible con los mismos campos de siempre ---------------------------------------------------------
  const condProps = {
    afectaIva: true, conditions: {formaPago: "50 % al iniciar", plazoEntrega: "", alcanceGeografico: "", garantia: "12 meses", observaciones: "", exclusiones: "", terminosAdicionales: ""},
    fieldErrors: {}, isAdvancedScope: false, isEditMode: false, onAddScopeSection() {}, onCondition() {}, onField() {}, onMoveScopeSection() {}, onPlazoApply() {}, onPrimaryScopeText() {}, onRemoveScopeSection() {}, onRestore() {}, onUpdateScopeSection() {},
    plazoRangeDraft: {desde: "", hasta: ""}, plazoRangeOpen: false, plazoRangeShowError: false, plazoRangeValid: false, primaryScopeText: "", restoreDisabled: false, scopeHasContent: false, scopeOpen: false, scopeSections: [],
    setPlazoRangeDraft() {}, setPlazoRangeOpen() {}, setScopeOpen() {}, taxName: "IVA", taxRate: 13, validezDias: 15,
  };
  const conditions = wrap(React.createElement(conditionsPanel, condProps), BOB);
  assert.ok(conditions.includes('<header class="ui-section-head">') && conditions.includes('class="ui-section-head__title">Condiciones</h2>'), "condiciones: título con el estilo de Ventas y Compras");
  assert.ok(conditions.includes('class="purchase-document-grid purchase-data-grid') && conditions.includes("Vigencia (días)") && conditions.includes("Tratamiento tributario") && conditions.includes("Afecta IVA 13 %"), "condiciones: vigencia y tratamiento tributario con las etiquetas de Compras");
  assert.ok(conditions.includes('value="50 % al iniciar"') && conditions.includes('value="12 meses"') && conditions.includes("Definir con fecha desde/hasta"), "condiciones: valores y plazo desde/hasta conservados");
  assert.ok(conditions.includes("Restaurar valores de Empresa") && conditions.includes("Solo lo que esté agregado aparece en el PDF."), "condiciones: restaurar y nota del PDF");
  assert.ok(!conditions.includes("Editar condiciones") && !conditions.includes("<dialog"), "condiciones: campos visibles, sin diálogo");

  // --- 6. "Asunto" en el PDF y en el correo (solo cliente; Functions recibe el texto ya armado) ------------------------------------
  assert.deepEqual(layout.buildQuoteClientRows({empresa: "Cliente SA", email: "a@b.test"}, "Escalera").map(([name]) => name), ["Empresa", "Correo", "Asunto"], "PDF y vista formal: Asunto");
  assert.ok(emailTemplate.DEFAULT_QUOTE_EMAIL_TEMPLATE.mensaje.includes("Asunto: {proyecto}") && !emailTemplate.DEFAULT_QUOTE_EMAIL_TEMPLATE.mensaje.includes("Proyecto:"), "correo: línea Asunto");
} finally {
  await vite.close();
}

// --- 7. Guardias de fuente ----------------------------------------------------------------------------------------------------------
const quotesCss = read("src/features/quotes/quote-workspace.css");
const pageSource = read("src/pages/NewQuotePage.jsx");
assert.doesNotMatch(pageSource, /import ClientSelector|<ClientSelector/, "Cotización no usa el selector de Taller");
assert.match(pageSource, /import "\.\.\/features\/purchases\/purchases\.css";/, "la página carga el patrón compartido de documentos");
assert.doesNotMatch(quotesCss, /@import/, "la hoja de cotizaciones no importa la de otro feature");
assert.doesNotMatch(quotesCss, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, "sin colores literales");
assert.doesNotMatch(quotesCss, /\.quote-workspace (input|select|textarea)|\.quote-items /, "sin reglas globales sobre los campos del bloque compartido");

console.log("QUOTE_NEW_PAGE_STRUCTURE_SMOKE_OK");
