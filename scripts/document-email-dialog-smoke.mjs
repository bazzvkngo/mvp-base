import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {MemoryRouter} from "react-router-dom";
import {createServer} from "vite";

// Diálogo único de envío de documentos por correo (DocumentEmailDialog), compartido por Orden de compra y Cotización.
// Fija: estructura, aviso de simulación según el entorno, destinatario con texto guía genérico, motivo cuando el botón
// está deshabilitado, las dos pestañas, la nota por documento (con y sin enlace) y el aviso cuando no hay "Responder a".
// Solo presentación, sin emuladores ni red: render del servidor, sin DOM.

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const strip = (html) => html.replace(/<!-- -->/g, "").replace(/ /g, " ");
const count = (text, pattern) => (text.match(pattern) || []).length;

// QA local: es la condición que usa Cotización y ahora también la orden de compra.
Object.assign(process.env, {
  VITE_FIREBASE_MODE: "emulator",
  VITE_USE_FIREBASE_CORE_EMULATORS: "true",
  VITE_USE_FIREBASE_FUNCTIONS_EMULATOR: "true",
  VITE_USE_FIREBASE_STORAGE_EMULATOR: "true",
});

// --- 1. Guardias de fuente: sin literales de diseño, sin enlace supuesto, sin dominios ni países ------------------------
const sharedSource = read("src/components/ui/DocumentEmailDialog.jsx");
const previewSource = read("src/components/ui/DocumentEmailPreview.jsx");
const withoutComments = (source) => source.split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n");
for (const [name, source] of [["DocumentEmailDialog", withoutComments(sharedSource)], ["DocumentEmailPreview", withoutComments(previewSource)]]) {
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|style=/, `${name}: solo tokens, sin literales ni estilos inline`);
  assert.doesNotMatch(source, /enlace|aceptar|rechazar|link/i, `${name}: no asume que existe un enlace`);
  assert.doesNotMatch(source, /@empresa\.|\.cl\b|snapshot|Chile|Bolivia/i, `${name}: sin dominios, países ni jerga`);
}
assert.match(sharedSource, /simulated = firebaseEnvironment\.isEmulator/, "el aviso usa la misma condición que Cotización");
assert.match(sharedSource, /<ResponsiveDialog/, "reutiliza el diálogo base (Esc, foco y cierre)");
assert.match(sharedSource, /<SegmentedControl/, "reutiliza el control segmentado");
assert.match(sharedSource, /<Button/, "reutiliza Button");
assert.match(sharedSource, /<Notice variant="warning"/, "reutiliza Notice para el aviso de Responder a");
assert.match(sharedSource, /initialFocusRef=\{recipientRef\}/, "el foco inicial va al destinatario");
assert.match(sharedSource, /form=\{formId\}/, "el botón del pie envía el formulario");
// Orden de tabulación: destinatario, enlace "Usar otro correo", copia, pestañas, asunto, mensaje, pie.
const order = ["id={recipientId}", "quote-email-dialog__recipient-action", 'className="ui-checkbox"', "<SegmentedControl", "id={asuntoId}", "id={mensajeId}", "<aside"];
const positions = order.map((marker) => sharedSource.indexOf(marker));
assert.ok(positions.every((position) => position > 0), "todos los puntos del orden de tabulación existen");
assert.deepEqual([...positions].sort((a, b) => a - b), positions, "el orden del HTML es el orden de tabulación");

const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
try {
  const Dialog = (await vite.ssrLoadModule("/src/components/ui/DocumentEmailDialog.jsx")).default;
  const Preview = (await vite.ssrLoadModule("/src/components/ui/DocumentEmailPreview.jsx")).default;
  const hook = await vite.ssrLoadModule("/src/hooks/useBusinessFormat.js");
  const formatters = await vite.ssrLoadModule("/src/utils/formatters.js");
  const previewDomain = await vite.ssrLoadModule("/src/domain/purchaseOrderEmailPreview.mjs");
  const OrderDialog = (await vite.ssrLoadModule("/src/features/purchaseOrders/SendPurchaseOrderEmailDialog.jsx")).default;
  const QuoteModal = (await vite.ssrLoadModule("/src/features/quotes/SendQuoteEmailModal.jsx")).default;
  const environment = await vite.ssrLoadModule("/src/config/firebaseEnvironment.mjs");
  assert.equal(environment.firebaseEnvironment.isEmulator, true, "el smoke corre en el entorno QA local");

  const render = (element) => strip(renderToStaticMarkup(
    React.createElement(MemoryRouter, {initialEntries: ["/"]},
      React.createElement(hook.BusinessFormatProvider, {business: {paisCodigo: "BO", monedaCodigo: "BOB", locale: "es-BO"}}, element)),
  ));
  const noop = () => {};
  const base = {
    asunto: "Orden de compra OC-0007 | Bagner",
    attachmentName: "OC-0007.pdf",
    copyTo: "",
    description: "Se adjuntará el PDF de la orden.",
    documentName: "OC-0007",
    eyebrow: "Emisión al proveedor",
    from: "Bagner (vía ValoraCloud)",
    mensaje: "Estimado/a Proveedor Uno:",
    note: {title: "El proveedor responderá por correo a la dirección de arriba."},
    onAsuntoChange: noop,
    onClose: noop,
    onMensajeChange: noop,
    onSubmit: noop,
    open: true,
    previewContent: React.createElement("p", null, "CONTENIDO-VISTA-PREVIA"),
    recipient: {defaultValue: "ventas@proveedor.test", onChange: noop, value: "ventas@proveedor.test"},
    replyTo: "contacto@bagner.test",
    submitLabel: "Enviar por correo",
    submittingLabel: "Enviando...",
    summaryRows: [{label: "Orden de compra", value: "OC-0007"}, {label: "Proveedor", value: "Proveedor Uno"}, {label: "Total", value: "Bs 1.000,00"}],
  };
  const dialog = (props = {}) => render(React.createElement(Dialog, {...base, ...props}));

  // --- 2. Estructura: encabezado, campos, sobre, pestañas, resumen, pie --------------------------------------------------
  const html = dialog({simulated: false});
  assert.match(html, /responsive-dialog__eyebrow">Emisión al proveedor</, "etiqueta pequeña");
  assert.match(html, /<h2[^>]*>Enviar OC-0007 por correo<\/h2>/, "título «Enviar <documento> por correo»");
  assert.match(html, /responsive-dialog__description">Se adjuntará el PDF de la orden\.</, "subtítulo breve");
  assert.match(html, /<label[^>]*>Destinatario<\/label>/);
  assert.match(html, /Usar otro correo/, "enlace para escribir otro correo");
  assert.match(html, /Por defecto se usa el correo guardado\. Si escribes otro, se usa solo para este envío y no cambia la ficha\./, "ayuda sin jerga");
  assert.match(html, /<input(?=[^>]*type="email")(?=[^>]*readOnly="")(?=[^>]*value="ventas@proveedor\.test")[^>]*>/, "destinatario prefijado y de solo lectura hasta elegir otro correo");
  for (const label of ["De", "Responder a", "Copia oculta"]) assert.match(html, new RegExp(`<dt>${label}</dt>`), `sobre: ${label}`);
  assert.match(html, /<dd>Bagner \(vía ValoraCloud\)<\/dd>/);
  assert.match(html, /<dd>contacto@bagner\.test<\/dd>/, "Responder a muestra el valor real");
  assert.match(html, /<dd>Sin copia<\/dd>/);
  assert.match(html, />Redactar</, "pestaña Redactar");
  assert.match(html, />Vista previa</, "pestaña Vista previa");
  assert.equal(count(html, /type="radio"/g), 2, "exactamente dos pestañas");
  assert.match(html, /<label[^>]*>Asunto<\/label>/);
  assert.match(html, /<label[^>]*>Mensaje<\/label>/);
  assert.doesNotMatch(html, /CONTENIDO-VISTA-PREVIA/, "en Redactar no se ve la vista previa");
  assert.match(html, /<h3>Resumen<\/h3>/);
  for (const row of ["Orden de compra", "Proveedor", "Total", "Proveedor Uno", "Bs 1\\.000,00"]) assert.match(html, new RegExp(row), `resumen: ${row}`);
  assert.match(html, /<strong>PDF adjunto<\/strong><small>OC-0007\.pdf<\/small>/, "PDF adjunto con su nombre");
  assert.match(html, /quote-email-dialog__attachment[\s\S]*lucide-check/, "PDF adjunto con check");
  assert.match(html, /Cancelar/);
  assert.match(html, /<button[^>]*type="submit"[^>]*form="[^"]+"[^>]*>[\s\S]*Enviar por correo/, "botón principal conectado al formulario");
  assert.doesNotMatch(html, /snapshot|CC ni BCC|proveedor@empresa\.cl|cliente@empresa\.cl/, "sin jerga ni dominios de otro país");
  assert.equal(count(html, /role="status"/g), 0, "sin simulación no hay aviso ni role=status");
  assert.doesNotMatch(html, /quote-email-dialog__error/, "sin error no se muestra el recuadro");

  // --- 3. Pestaña Vista previa -------------------------------------------------------------------------------------------
  const previewHtml = dialog({defaultView: "preview", simulated: false});
  assert.match(previewHtml, /CONTENIDO-VISTA-PREVIA/, "la pestaña Vista previa muestra el contenido recibido");
  assert.doesNotMatch(previewHtml, /<label[^>]*>Asunto<\/label>|<textarea/, "en Vista previa no se editan Asunto ni Mensaje");
  assert.match(previewHtml, /<input[^>]*value="OC-0007|checked=""[^>]*value="preview"|value="preview"[^>]*checked=""/, "la pestaña activa es Vista previa");

  // --- 4. Aviso de simulación según el entorno --------------------------------------------------------------------------
  assert.equal(count(html, /Simulación de correo — QA local/g), 0, "fuera de QA local no hay aviso");
  assert.match(html, /Enviar por correo/);
  assert.doesNotMatch(html, /Preparar simulación/, "fuera de QA local el botón dice lo de siempre");
  const qaHtml = dialog({simulated: true, simulationText: "No se enviará un correo real. La orden quedará pendiente de envío."});
  assert.match(qaHtml, /quote-email-dialog__qa-notice" role="status"><strong>Simulación de correo — QA local<\/strong><span>No se enviará un correo real\. La orden quedará pendiente de envío\.<\/span>/, "aviso en QA local con su texto");
  assert.match(qaHtml, /Preparar simulación/, "en QA local el botón avisa que es una simulación");
  assert.doesNotMatch(qaHtml, /Enviar por correo/);
  const qaResultHtml = dialog({simulated: true, simulationResult: {text: "Resultado de prueba.", actions: React.createElement("a", {href: "#qa"}, "Abrir QA")}});
  assert.match(qaResultHtml, /quote-email-dialog__qa-notice quote-email-dialog__qa-notice--result/, "variante con resultado");
  assert.match(qaResultHtml, /Resultado de prueba\./);
  assert.match(qaResultHtml, /quote-email-dialog__qa-actions"><a href="#qa">Abrir QA<\/a>/, "acciones del resultado dentro del aviso");
  assert.equal(count(qaResultHtml, /role="status"/g), 1, "un solo role=status");
  // Sin la prop, la condición sale del entorno (aquí QA local): lo comprueba el render del feature más abajo.
  assert.match(dialog(), /Simulación de correo — QA local/, "por defecto sigue la condición del entorno");

  // --- 5. Destinatario: texto guía genérico y sin correo guardado --------------------------------------------------------
  const emptyRecipient = dialog({simulated: false, recipient: {defaultValue: "", onChange: noop, value: ""}});
  assert.match(emptyRecipient, /placeholder="Escribe el correo del destinatario"/, "texto guía genérico");
  assert.doesNotMatch(emptyRecipient, /Usar otro correo/, "sin correo guardado no hay nada a lo que volver");
  assert.doesNotMatch(emptyRecipient, /<input[^>]*type="email"[^>]*readOnly/, "sin correo guardado el campo se puede escribir");
  assert.match(emptyRecipient, /No hay un correo guardado\. Escribe uno: se usa solo para este envío y no cambia la ficha\./);
  const withError = dialog({simulated: false, recipient: {defaultValue: "", onChange: noop, value: "mal", error: "Ingresa un solo correo válido."}});
  assert.match(withError, /aria-invalid="true"/);
  assert.match(withError, /quote-email-dialog__field-error">Ingresa un solo correo válido\./);

  // --- 6. Motivo cuando el botón está deshabilitado -----------------------------------------------------------------------
  const blocked = dialog({simulated: false, disabled: true, disabledReason: "Escribe un correo para enviar"});
  assert.match(blocked, /quote-email-dialog__footer-hint">Escribe un correo para enviar</, "motivo visible junto al botón");
  assert.match(blocked, /<button[^>]*type="submit"[^>]*disabled=""/, "el botón está deshabilitado");
  assert.ok(blocked.indexOf("footer-hint") < blocked.indexOf("Cancelar"), "el motivo va antes de los botones");
  assert.doesNotMatch(dialog({simulated: false}), /footer-hint/, "habilitado no hay motivo");
  assert.doesNotMatch(dialog({simulated: false, disabled: true}), /footer-hint/, "sin motivo no se inventa uno");
  assert.doesNotMatch(dialog({simulated: false, disabled: true, disabledReason: "Motivo", processing: true}), /footer-hint/, "enviando no se muestra el motivo");
  assert.match(dialog({simulated: false, processing: true}), /Enviando\.\.\./, "texto mientras envía");
  assert.match(dialog({simulated: true, processing: true}), /Preparando\.\.\./, "texto mientras prepara la simulación");

  // --- 7. «Responder a»: valor real o aviso cuando no hay ---------------------------------------------------------------
  const warning = "Tu empresa no tiene un correo configurado: el proveedor no podrá responder a tu correo.";
  const noReply = dialog({simulated: false, replyTo: "", replyToWarning: warning});
  assert.match(noReply, /<dd>Sin correo de respuesta<\/dd>/, "el sobre dice que no hay Responder a");
  assert.match(noReply, /ui-notice ui-notice--warning/, "aviso de advertencia");
  assert.match(noReply, /Tu empresa no tiene un correo configurado: el proveedor no podrá responder a tu correo\./);
  assert.doesNotMatch(dialog({simulated: false, replyTo: "contacto@bagner.test", replyToWarning: warning}), /ui-notice--warning/, "con Responder a no hay aviso");
  assert.match(dialog({simulated: false, replyTo: "", replyToEmptyText: "Sin correo de respuesta: el cliente responderá desde el enlace"}), /el cliente responderá desde el enlace/, "texto propio del documento");

  // --- 8. Copia opcional ------------------------------------------------------------------------------------------------
  assert.doesNotMatch(html, /Enviarme una copia/, "sin cuenta verificada no hay casilla de copia");
  const withCopy = dialog({simulated: false, accountEmail: "yo@bagner.test", copyTo: "yo@bagner.test", sendCopy: true});
  assert.match(withCopy, /Enviarme una copia a yo@bagner\.test/);
  assert.match(withCopy, /<dd>yo@bagner\.test<\/dd>/, "Copia oculta muestra la dirección");

  // --- 9. Nota específica del documento: con y sin enlace ------------------------------------------------------------------
  const quoteNote = dialog({simulated: false, note: {title: "El cliente podrá aceptar o rechazar", description: "Podrá revisar, aceptar o rechazar desde el enlace."}});
  assert.match(quoteNote, /<strong>El cliente podrá aceptar o rechazar<\/strong><small>Podrá revisar, aceptar o rechazar desde el enlace\.<\/small>/, "la nota con enlace llega por prop");
  assert.doesNotMatch(dialog({simulated: false, note: null}), /quote-email-dialog__reply-notice/, "sin nota no se muestra nada");
  assert.doesNotMatch(html, /enlace|aceptar|rechazar/i, "el diálogo por defecto no menciona ningún enlace");

  // --- 10. Vista previa genérica: sin enlace salvo que el documento lo pida --------------------------------------------------
  const noLinkPreview = render(React.createElement(Preview, {documentTitle: "Orden de compra", from: "Bagner (vía ValoraCloud)", to: "ventas@proveedor.test", replyTo: "contacto@bagner.test", subject: "Asunto", message: "Mensaje", brand: "Bagner", summaryRows: [{label: "Total", value: "Bs 1,00"}], note: "El detalle completo se encuentra en el PDF adjunto."}));
  assert.match(noLinkPreview, /<dt>Responder a<\/dt><dd>contacto@bagner\.test<\/dd>/);
  assert.doesNotMatch(noLinkPreview, /quote-email-preview__cta|Revisar y responder/, "sin cta no hay botón");
  assert.match(render(React.createElement(Preview, {documentTitle: "Cotización", from: "x", cta: "Revisar y responder cotización", summaryRows: []})), /quote-email-preview__cta[^>]*><span>Revisar y responder cotización</, "con cta sí");

  // --- 11. Datos del correo de la orden: mismas reglas que el servidor -------------------------------------------------------
  const order = {numero: "OC-0007", total: 1000, moneda: "BOB", locale: "es-BO", condicionesPago: "credito", fechaEntregaEstimada: "2026-12-08", proveedorSnapshot: {razonSocial: "Proveedor Uno", email: "ventas@proveedor.test"}, empresaSnapshot: {nombreComercial: "Bagner", email: "snapshot@bagner.test"}};
  const buildPreview = (extra = {}) => previewDomain.buildPurchaseOrderEmailPreview({asunto: "A", mensaje: "M", emailProveedor: "ventas@proveedor.test", formatDate: formatters.formatDate, formatMoney: formatters.formatMoney, order, ...extra});
  const fromCompany = buildPreview({companyProfile: {nombreComercial: "Bagner", email: "Contacto@Bagner.test"}, accountEmail: "yo@bagner.test"});
  assert.equal(fromCompany.replyTo, "contacto@bagner.test", "Responder a: el correo de la empresa va primero");
  assert.equal(fromCompany.replyToSource, "empresa");
  assert.equal(previewDomain.describePurchaseOrderReplyTo(fromCompany), "contacto@bagner.test");
  const fromAccount = buildPreview({companyProfile: {nombreComercial: "Bagner"}, accountEmail: "yo@bagner.test"});
  assert.equal(fromAccount.replyTo, "yo@bagner.test", "sin correo de empresa, respaldo: la cuenta verificada (igual que el servidor)");
  assert.equal(previewDomain.describePurchaseOrderReplyTo(fromAccount), "yo@bagner.test (correo de tu cuenta)");
  const none = buildPreview({companyProfile: {nombreComercial: "Bagner"}});
  assert.equal(none.replyTo, "", "sin ninguno, vacío");
  assert.equal(previewDomain.describePurchaseOrderReplyTo(none), "");
  assert.equal(fromCompany.from, "Bagner (vía ValoraCloud)");
  assert.equal(buildPreview({accountEmail: "yo@bagner.test", enviarCopia: true}).copyTo, "yo@bagner.test");
  assert.equal(buildPreview({accountEmail: "ventas@proveedor.test", enviarCopia: true}).copyTo, "", "la copia no repite al destinatario");
  assert.deepEqual(fromCompany.summaryRows.map((row) => row.label), ["Orden de compra", "Total", "Condiciones", "Entrega estimada"]);
  assert.equal(fromCompany.summaryRows[2].value, "Crédito");
  assert.equal(fromCompany.summaryRows[3].value, formatters.formatDate("2026-12-08", "es-BO"), "la entrega usa el formato del país del documento");

  // --- 12. Orden de compra: el diálogo real, con y sin correo de empresa ----------------------------------------------------
  const orderDialog = (props = {}) => render(React.createElement(OrderDialog, {onClose: noop, onSend: noop, open: true, order: {id: "oc-1", ...order}, processing: false, companyProfile: {nombreComercial: "Bagner", email: "contacto@bagner.test"}, ...props}));
  const orderHtml = orderDialog();
  assert.match(orderHtml, /<h2[^>]*>Enviar OC-0007 por correo<\/h2>/);
  assert.match(orderHtml, /Emisión al proveedor/);
  assert.match(orderHtml, /<dd>contacto@bagner\.test<\/dd>/, "Responder a: el correo de contacto de la empresa");
  assert.match(orderHtml, /El proveedor responderá por correo a la dirección de arriba\./, "nota de la orden: responde por correo");
  assert.doesNotMatch(orderHtml, /enlace|aceptar|rechazar/i, "la orden de compra no menciona enlace ni aceptar o rechazar");
  assert.doesNotMatch(orderHtml, /ui-notice--warning/, "con correo de empresa no hay aviso");
  assert.match(orderHtml, /Simulación de correo — QA local/, "en QA local la orden de compra también avisa que es simulación");
  assert.match(orderHtml, /No se enviará un correo real\. La orden quedará pendiente de envío\./);
  assert.match(orderHtml, /Preparar simulación/);
  assert.match(orderHtml, /value="ventas@proveedor\.test"/, "destinatario prefijado con el proveedor");
  assert.match(orderHtml, /<strong>PDF adjunto<\/strong><small>OC-0007\.pdf<\/small>/);
  assert.match(orderHtml, /Proveedor Uno/);
  assert.doesNotMatch(orderHtml, /footer-hint/, "con datos válidos el botón está habilitado");
  const orderNoReply = orderDialog({companyProfile: {nombreComercial: "Bagner"}});
  assert.match(orderNoReply, /<dd>Sin correo de respuesta<\/dd>/);
  assert.match(orderNoReply, /Tu empresa no tiene un correo configurado: el proveedor no podrá responder a tu correo\./, "aviso cuando no hay Responder a");
  assert.match(orderNoReply, /El proveedor responderá por correo\./);
  assert.doesNotMatch(orderNoReply, /a la dirección de arriba/, "sin dirección no se manda a mirar «arriba»");
  const noProviderEmail = orderDialog({order: {id: "oc-2", ...order, proveedorSnapshot: {razonSocial: "Proveedor Dos"}}});
  assert.match(noProviderEmail, /placeholder="Escribe el correo del destinatario"/);
  assert.match(noProviderEmail, /footer-hint">Escribe un correo para enviar</, "sin correo el botón explica por qué está deshabilitado");
  assert.match(noProviderEmail, /<button[^>]*type="submit"[^>]*disabled=""/);
  assert.doesNotMatch(noProviderEmail, /po-email|snapshot|proveedor@empresa\.cl/);

  // --- 13. Cotización: mismo diálogo, con su enlace --------------------------------------------------------------------------
  const quote = {id: "cot-1", numero: "COT-0001", estado: "emitida", fecha: "2026-11-20", total: 500, moneda: "BOB", locale: "es-BO", clienteNombre: "Cliente Uno", clienteEmail: "cliente@cliente.test", items: [], validezDias: 15};
  const quoteHtml = render(React.createElement(QuoteModal, {businessId: "negocio-1", open: true, quote, quoteId: "cot-1", companyProfile: {nombreComercial: "Bagner", email: "contacto@bagner.test"}, onClose: noop, onSent: noop}));
  assert.match(quoteHtml, /<h2[^>]*>Enviar cotización por correo<\/h2>/, "título único también en QA local");
  assert.match(quoteHtml, /Simulación de correo — QA local/);
  assert.match(quoteHtml, /No se enviará un correo real\. El destinatario se registrará solo como dato de prueba\./);
  assert.match(quoteHtml, /Preparar simulación/);
  assert.match(quoteHtml, /<strong>El cliente podrá aceptar o rechazar<\/strong>/, "la cotización conserva su nota con enlace");
  assert.match(quoteHtml, /desde el enlace\./);
  assert.match(quoteHtml, /<dd>contacto@bagner\.test<\/dd>/);
  assert.match(quoteHtml, /value="cliente@cliente\.test"/);
  assert.match(quoteHtml, /Usar otro correo/);
  assert.match(quoteHtml, /<dt>Cliente<\/dt><dd>Cliente Uno<\/dd>/);
  assert.match(quoteHtml, /<dt>Cotización<\/dt><dd>COT-0001<\/dd>/);
  assert.doesNotMatch(quoteHtml, /cliente@empresa\.cl/, "sin ejemplos de otro país");
  const quoteNoReply = render(React.createElement(QuoteModal, {businessId: "negocio-1", open: true, quote, quoteId: "cot-1", companyProfile: {nombreComercial: "Bagner"}, onClose: noop, onSent: noop}));
  assert.match(quoteNoReply, /Sin correo de respuesta: el cliente responderá desde el enlace/, "Cotización conserva su texto sin Responder a");
  assert.doesNotMatch(quoteNoReply, /ui-notice--warning/, "en Cotización no aplica el aviso de la orden de compra");
  const quoteDraftBlocked = render(React.createElement(QuoteModal, {businessId: "negocio-1", open: true, quote: {...quote, estado: "anulada"}, quoteId: "cot-1", companyProfile: {nombreComercial: "Bagner"}, onClose: noop, onSent: noop}));
  assert.match(quoteDraftBlocked, /footer-hint">La cotización no puede enviarse desde su estado actual\.</, "Cotización explica por qué no se puede enviar");
} finally {
  await vite.close();
}

// --- 14. El CSS compartido existe una sola vez y con tokens ----------------------------------------------------------------
const components = read("src/styles/components.css");
for (const selector of [".quote-email-dialog__recipient {", ".quote-email-dialog__help,", ".quote-email-dialog__footer-hint {"]) {
  assert.equal(count(components, new RegExp(`^${selector.replace(/[.{]/g, "\\$&")}`, "gm")), 1, `${selector} se define una vez (fuera de los @media)`);
}
assert.doesNotMatch(read("src/features/purchaseOrders/purchase-orders.css"), /po-email/, "el CSS del feature ya no duplica el diálogo");
assert.doesNotMatch(read("src/features/quotes/SendQuoteEmailModal.jsx"), /<ResponsiveDialog|<SegmentedControl/, "Cotización ya no arma su propia estructura");
assert.doesNotMatch(read("src/features/purchaseOrders/SendPurchaseOrderEmailDialog.jsx"), /<ResponsiveDialog|<SegmentedControl/, "la orden de compra tampoco");

console.log("DOCUMENT_EMAIL_DIALOG_SMOKE_OK estructura, simulación por entorno, destinatario, motivo del botón, pestañas, nota por documento y aviso sin Responder a");
