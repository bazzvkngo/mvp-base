import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";

// Selector de envío (SendMethodDialog): dos tarjetas, Correo y WhatsApp, que se abre al pulsar "Enviar".
// Fija el componente compartido y su uso en Órdenes de compra: listado, pantalla de edición, detalle y el diálogo
// posterior al guardado. Sin emuladores ni red.

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const strip = (html) => html.replace(/<!-- -->/g, "");
const HINT = "Agrega un teléfono para compartir por WhatsApp.";

// --- 1. Componente: render real ---------------------------------------------------------------------------------------
const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
try {
  const module = await vite.ssrLoadModule("/src/components/ui/SendMethodDialog.jsx");
  const SendMethodDialog = module.default;
  const {WhatsAppSentConfirm, WHATSAPP_MISSING_PHONE_HINT} = module;
  const noop = () => {};
  const render = (props) => strip(renderToStaticMarkup(React.createElement(SendMethodDialog, {
    eyebrow: "Órdenes de compra", onClose: noop, onEmail: noop, onWhatsApp: noop, open: true, title: "Enviar la orden de compra", ...props,
  })));
  const buttons = (html) => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs, inner]) => ({
    attrs, disabled: /\bdisabled=""/.test(attrs), label: inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), inner,
  }));

  assert.equal(WHATSAPP_MISSING_PHONE_HINT, HINT, "la pista exacta sin teléfono");

  // Dos tarjetas grandes con ícono, título y una línea de ayuda; son botones nativos (teclado) dentro de un grupo.
  const html = render({whatsAppEnabled: true});
  assert.match(html, /role="dialog"/, "usa el diálogo existente");
  assert.match(html, /<div class="ui-send-method" role="group" aria-label="Elige cómo enviarla">/);
  const cards = buttons(html).filter((button) => /ui-send-method__card/.test(button.attrs));
  assert.deepEqual(cards.map((card) => card.label.replace(/\s+/g, " ")), ["Correo Con el PDF adjunto, desde ValoraCloud.", "WhatsApp Abre el chat con el mensaje ya escrito."]);
  for (const card of cards) {
    assert.match(card.attrs, /type="button"/, "tarjeta enfocable con teclado");
    assert.match(card.inner, /ui-send-method__icon"><svg/, "con ícono");
    assert.match(card.inner, /ui-send-method__title/);
    assert.match(card.inner, /ui-send-method__help/);
    assert.ok(!card.disabled, "habilitada con teléfono");
  }
  assert.match(html, />Cancelar<\/span><\/button>/, "cierre por defecto: Cancelar");

  // Sin teléfono: WhatsApp deshabilitada, con la pista y descrita para lectores de pantalla; Correo sigue disponible.
  const noPhone = render({whatsAppEnabled: false});
  const [email, whatsApp] = buttons(noPhone).filter((button) => /ui-send-method__card/.test(button.attrs));
  assert.ok(!email.disabled, "Correo sigue habilitada sin teléfono");
  assert.ok(whatsApp.disabled, "WhatsApp deshabilitada sin teléfono");
  assert.ok(whatsApp.inner.includes(HINT), "la tarjeta muestra la pista");
  const hintId = whatsApp.attrs.match(/aria-describedby="([^"]+)"/)?.[1];
  assert.ok(hintId && noPhone.includes(`id="${hintId}"`), "la pista está asociada a la tarjeta");

  // Enlace discreto: solo si el llamador ofrece el registro manual.
  assert.ok(!render({}).includes("Ya la envié por otro medio"), "sin registro manual no hay enlace");
  const withLink = render({onAlreadySent: noop});
  const link = buttons(withLink).find((button) => /ui-send-method__link/.test(button.attrs));
  assert.equal(link?.label, "Ya la envié por otro medio", "enlace de texto discreto");

  // Diálogo posterior al guardado.
  const fresh = render({closeLabel: "Más tarde", title: "Guardada. ¿La envías ahora?"});
  assert.match(fresh, /<h2[^>]*>Guardada\. ¿La envías ahora\?<\/h2>/);
  assert.match(fresh, />Más tarde<\/span><\/button>/);
  assert.ok(!fresh.includes(">Cancelar</span>"));

  // Procesando: nada se puede pulsar dos veces.
  assert.ok(buttons(render({processing: true})).filter((button) => /ui-send-method__card/.test(button.attrs)).every((card) => card.disabled), "procesando: tarjetas bloqueadas");

  // Paso posterior a abrir WhatsApp: no se puede confirmar el envío, así que se pregunta.
  const confirm = strip(renderToStaticMarkup(React.createElement(WhatsAppSentConfirm, {
    confirmLabel: "Marcar como emitida", description: "Abrir WhatsApp no confirma que el proveedor haya recibido la orden.", onClose: noop, onConfirm: noop, open: true, processing: false,
  })));
  assert.match(confirm, /<h2[^>]*>¿La enviaste\?<\/h2>/);
  assert.match(confirm, /Abrir WhatsApp no confirma que el proveedor haya recibido la orden\./);
  assert.match(confirm, /Todavía no/);
  assert.match(confirm, /Marcar como emitida/);
} finally {
  await vite.close();
}

// --- 2. Código del componente: Button y ResponsiveDialog reutilizados, WhatsApp síncrono, sin literales ------------------
const component = read("src/components/ui/SendMethodDialog.jsx");
assert.match(component, /import Button from "\.\/Button";/);
assert.match(component, /import ResponsiveDialog from "\.\/ResponsiveDialog";/);
assert.doesNotMatch(component, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, "sin colores literales");
// El chat se abre dentro del clic (el navegador bloquea las ventanas abiertas tras una espera) y solo entonces se pregunta.
assert.match(component, /setOpening\(true\);\s*try \{\s*const opened = await onWhatsApp\?\.\(\);\s*if \(opened\) setStep\("whatsapp"\);/);

const css = read("src/styles/components.css");
const block = css.slice(css.indexOf("/* Selector de envío (SendMethodDialog)"));
assert.match(block, /\.ui-send-method\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/, "dos tarjetas en escritorio");
assert.match(block, /@media \(max-width: 620px\)\s*\{\s*\.ui-send-method\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/, "apiladas a ancho completo en móvil");
assert.match(block, /\.ui-send-method__card:focus-visible\s*\{[^}]*outline:\s*var\(--focus-outline\);/, "foco visible en las tarjetas");
assert.match(block, /\.ui-send-method__link:focus-visible/, "foco visible en el enlace");
assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|radius:\s*\d|shadow:\s*\d|\d(ms|s)\b/, "sin literales de color, radio, sombra ni duración");

// --- 3. Uso en Órdenes de compra ---------------------------------------------------------------------------------------
const list = read("src/pages/PurchaseOrdersPage.jsx");
assert.match(list, /import SendMethodDialog from "\.\.\/components\/ui\/SendMethodDialog";/);
assert.equal((list.match(/onSend=\{openSend\}/g) || []).length, 2, "el Enviar de la tabla y el de las tarjetas abren el selector");
assert.match(list, /onEmail=\{\(\) => \{ setEmailOrder\(sendOrder\); closeSend\(\); \}\}/, "Correo abre el diálogo de correo que ya existe");
assert.match(list, /<SendPurchaseOrderEmailDialog /);
assert.match(list, /onWhatsApp=\{\(\) => shareWhatsApp\(sendOrder\)\}/);
assert.match(list, /canalEmision: "whatsapp", destinatario: whatsAppDestination/, "WhatsApp registra la emisión con el canal");
assert.match(list, /canalEmision: "manual"/, "el registro manual existente");
assert.match(list, /onAlreadySent=\{\(\) => \{ setManualOrder\(sendOrder\); closeSend\(\); \}\}/, "Ya la envié por otro medio lleva al registro manual");
assert.match(list, /title=\{sendIsFresh \? "Guardada\. ¿La envías ahora\?" : "Enviar la orden de compra"\}/);
assert.match(list, /closeLabel=\{sendIsFresh \? "Más tarde" : "Cancelar"\}/);
assert.match(list, /useState\(initialCreatedOrder\)[\s\S]*Boolean\(initialCreatedOrder\)/, "al volver de guardar una orden nueva se abre el selector");
assert.doesNotMatch(list, /po-order-preview-dialog|PurchaseOrderPrintView|selectedOrder/, "el diálogo posterior al guardado ya no es la vista previa completa");

const edit = read("src/pages/NewPurchaseOrderPage.jsx");
assert.match(edit, /import SendMethodDialog from "\.\.\/components\/ui\/SendMethodDialog";/);
assert.match(edit, /onClick=\{\(\) => setSendOpen\(true\)\}>Enviar<\/button>/, "pantalla de edición: Enviar");
assert.match(edit, /onClick=\{\(\) => setSendOpen\(true\)\}>Reenviar<\/button>/, "pantalla de edición, orden emitida: Reenviar");
assert.doesNotMatch(edit, />Enviar por correo<|>Reenviar correo<|Reenviar por WhatsApp|onClick=\{openWhatsApp\}/, "sin botones de canal sueltos");
assert.match(edit, /onEmail=\{\(\) => \{ setSendOpen\(false\); setEmailOpen\(true\); \}\}/);
assert.match(edit, /onAlreadySent=\{order\?\.estado === "borrador" \? \(\) => \{ setSendOpen\(false\); setActionDialog\("manual"\); \} : undefined\}/, "el enlace lleva al registro manual existente (solo borrador)");
assert.match(edit, /Registrar envío manual/, "el botón de registro manual se conserva");
assert.match(edit, /onSend=\{\(\) => setSendOpen\(true\)\}/, "el detalle de una orden emitida abre el selector");

const detail = read("src/features/purchaseOrders/PurchaseOrderDetailView.jsx");
assert.match(detail, /onClick=\{onSend\}>Reenviar<\/Button>/, "detalle: Reenviar");
assert.doesNotMatch(detail, /onEmail|onWhatsApp|whatsAppAvailability/);

// --- 4. Fuera de alcance: Cotizaciones conserva su flujo propio; Ventas no tiene envío -----------------------------------
const quotes = read("src/pages/QuoteHistoryPage.jsx");
assert.doesNotMatch(quotes, /SendMethodDialog/, "Cotizaciones no cambia en esta tarea (propuesta en el informe)");

console.log("send-method-dialog-smoke OK");
