// Sugerencias discretas para la pantalla Empresa (Información): datos que no son obligatorios pero que
// aparecen en los documentos de la empresa. No son una alerta ni un bloqueo y NO forman parte del
// porcentaje de completitud (eso vive en businessCompletion.mjs y no se toca aquí).
//
// Cada afirmación se comprobó contra el código que arma los documentos:
// - email: es la dirección "responder a" de los correos de cotizaciones y órdenes de compra
//   (functions/quoteEmail.js, functions/purchaseOrderEmail.js -> emailEnvelope.js resolveReplyTo).
// - telefono: pie de la cotización, encabezado y pie de la orden de compra y los correos.
// - giro: PDF y vista de cotización y de orden de compra.
// - sitioWeb: solo cotizaciones (pie del PDF y de la vista, correo y propuesta pública); las órdenes de
//   compra no lo muestran, por eso el texto habla de cotizaciones y no de "documentos".
// - logo: PDF y vistas de impresión de cotizaciones, órdenes de compra, compras y ventas.
const filled = (value) => Boolean(String(value || "").trim());

export const COMPANY_DOCUMENT_SUGGESTIONS = Object.freeze([
  Object.freeze({
    id: "email",
    section: "contacto",
    label: "Correo comercial",
    text: "Las respuestas de tus órdenes y cotizaciones te llegarán a este correo.",
    isMissing: (profile) => !filled(profile.email),
  }),
  Object.freeze({
    id: "telefono",
    section: "contacto",
    label: "Teléfono comercial",
    text: "Aparece en tus documentos para que te contacten.",
    isMissing: (profile) => !filled(profile.telefono),
  }),
  Object.freeze({
    id: "sitioWeb",
    section: "contacto",
    label: "Sitio web",
    text: "Se muestra en tus cotizaciones.",
    isMissing: (profile) => !filled(profile.sitioWeb),
  }),
  Object.freeze({
    id: "giro",
    section: "comerciales",
    label: "Giro",
    text: "Se muestra en tus cotizaciones y órdenes de compra.",
    isMissing: (profile) => !filled(profile.giro),
  }),
  Object.freeze({
    id: "logo",
    section: "comerciales",
    label: "Logo",
    text: "Se muestra en tus PDF y vistas de impresión.",
    isMissing: (profile) => !filled(profile.logoUrl) && !filled(profile.logoPath),
  }),
]);

// Devuelve solo las sugerencias de los datos que faltan, o [] si la persona no puede editar. Se calcula
// sobre el formulario en pantalla, así que desaparece apenas el dato se completa.
export function getCompanyDocumentSuggestions(profile = {}, { canEdit = false } = {}) {
  if (!canEdit) return [];
  const source = profile && typeof profile === "object" ? profile : {};
  return COMPANY_DOCUMENT_SUGGESTIONS
    .filter((suggestion) => suggestion.isMissing(source))
    .map(({ id, label, section, text }) => ({ id, label, section, text }));
}
