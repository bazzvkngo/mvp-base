// Piezas del documento formal de cotización que comparten sus dos
// implementaciones: la vista HTML (QuotePrintView: pantalla, impresión y
// enlace público) y el PDF (quoteDocument.mjs: descarga, WhatsApp y adjunto
// del correo). Todo sale de los datos de la empresa y de la cotización; nada
// queda fijo para una empresa en particular.

export const QUOTE_FOOTER_QUESTION =
  "Si usted tiene alguna pregunta sobre esta cotización, por favor, póngase en contacto con nosotros";
export const QUOTE_FOOTER_THANKS = "Gracias por su preferencia";
export const QUOTE_ACCEPTANCE_SUFFIX = "(firmar a continuación)";

function hasText(value) {
  return Boolean(String(value ?? "").trim());
}

const CONDITION_LABELS = [
  ["formaPago", "Condiciones de pago"],
  ["plazoEntrega", "Plazo de ejecución o entrega"],
  ["alcanceGeografico", "Alcance geográfico"],
  ["garantia", "Garantía"],
  ["observaciones", "Observaciones comerciales"],
  ["exclusiones", "Exclusiones"],
];

// Términos y condiciones como lista para numerar (1., 2., 3.). Cada condición
// con valor es un término; "Términos adicionales" aporta uno por línea (sin su
// propia numeración, para no duplicarla). Sin datos, la lista queda vacía.
export function buildQuoteTerms(conditions = {}) {
  const terms = CONDITION_LABELS
    .filter(([key]) => hasText(conditions[key]))
    .map(([key, label]) => `${label}: ${String(conditions[key]).trim()}`);
  String(conditions.terminosAdicionales ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\d+[.)]\s+/, ""))
    .filter(Boolean)
    .forEach((line) => terms.push(line));
  return terms;
}

// Contacto del pie: solo los datos que la empresa tiene cargados.
export function buildQuoteFooterContact(company = {}) {
  return [company.responsable, company.telefono, company.email, company.sitioWeb]
    .filter(hasText)
    .map((value) => String(value).trim())
    .join(", ");
}

export function buildQuoteAcceptanceLine(acceptance = {}) {
  return `${String(acceptance.texto || "").trim()} ${QUOTE_ACCEPTANCE_SUFFIX}`.trim();
}

// Filas etiqueta/valor del bloque CLIENTE; las vacías no aparecen.
export function buildQuoteClientRows(client = {}, project = "") {
  return [
    ["Empresa", client.empresa],
    [client.identificadorFiscalTipo || "Identificación fiscal", client.identificadorFiscalValor || client.rut],
    ["Contacto", client.contacto],
    ["Correo", client.email],
    ["Teléfono", client.telefono],
    ["Dirección", client.direccion],
    ["Ciudad", client.ciudad],
    ["Proyecto", project],
  ].filter(([, value]) => hasText(value)).map(([label, value]) => [label, String(value).trim()]);
}
