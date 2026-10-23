import { resolveDocumentCompany } from "./companySnapshot.mjs";
import {
  buildQuoteReplyLine,
  buildSenderDisplayName,
  resolveCopyPreview,
  resolveReplyToPreview,
} from "./emailReplyTo.mjs";
import { buildQuoteValidityPhrase } from "./quoteEmailCopy.mjs";

// Plantilla del correo de cotización: funciones puras, sin red ni React.
// Las variables públicas son las que una plantilla por empresa podrá usar más
// adelante; hoy solo las usa el texto por defecto.
export const QUOTE_EMAIL_VARIABLES = Object.freeze([
  "contacto",
  "cliente",
  "numero",
  "proyecto",
  "total",
  "vigencia",
  "empresa",
]);

export const QUOTE_EMAIL_SUBJECT_MAX = 180;
export const QUOTE_EMAIL_MESSAGE_MAX = 2000;

// Sintaxis: {variable} y segmentos opcionales [texto {variable}]. Una línea
// con una variable sin dato se omite entera; un segmento opcional se omite
// solo él. Así un dato ausente no deja huecos ni inventa texto.
export const DEFAULT_QUOTE_EMAIL_TEMPLATE = Object.freeze({
  asunto: "Cotización {numero}[ – {proyecto}][ | {empresa}]",
  mensaje: [
    "Hola[ {contacto}]:",
    "",
    "Te enviamos la cotización {numero}[, por un total de {total}].",
    "",
    "Proyecto: {proyecto}",
    "Propuesta {vigencia}.",
    "",
    "Puedes revisar y responder la propuesta desde el enlace de este correo.",
    "{respuesta}",
    "",
    "Saludos,",
    "{empresa}",
    "{contactoEmpresa}",
  ].join("\n"),
});

const TOKEN_PATTERN = /\[([^[\]]*)\]|\{(\w+)\}/g;
const VARIABLE_PATTERN = /\{(\w+)\}/g;

function singleLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function findUnknownQuoteEmailVariables(template) {
  const unknown = new Set();
  for (const [, name] of String(template ?? "").matchAll(VARIABLE_PATTERN)) {
    if (!QUOTE_EMAIL_VARIABLES.includes(name)) unknown.add(name);
  }
  return [...unknown];
}

export function renderQuoteEmailTemplate(template, variables = {}) {
  const valueOf = (name) =>
    Object.prototype.hasOwnProperty.call(variables, name)
      ? singleLine(variables[name])
      : "";
  const lines = [];

  for (const line of String(template ?? "").split(/\r?\n/)) {
    let dropLine = false;
    const rendered = line.replace(TOKEN_PATTERN, (_match, segment, name) => {
      if (segment !== undefined) {
        let missing = false;
        const text = segment.replace(VARIABLE_PATTERN, (_m, inner) => {
          const value = valueOf(inner);
          if (!value) missing = true;
          return value;
        });
        return missing ? "" : text;
      }
      const value = valueOf(name);
      if (!value) dropLine = true;
      return value;
    });
    if (!dropLine) lines.push(rendered.trimEnd());
  }

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pickClientName(quote = {}) {
  return singleLine(
    quote.clienteNombre ||
      quote.cliente?.nombreRazonSocial ||
      quote.clienteSnapshot?.nombreRazonSocial
  );
}

// La persona de contacto va primero; sin ella se saluda al cliente.
function pickContactName(quote = {}) {
  return (
    singleLine(
      quote.clienteContacto ||
        quote.cliente?.personaContacto ||
        quote.clienteSnapshot?.personaContacto
    ) || pickClientName(quote)
  );
}

export function getQuoteEmailClientAddress(quote = {}) {
  return (
    quote.cliente?.email || quote.clienteSnapshot?.email || quote.clienteEmail || ""
  );
}

function joinNonEmpty(parts, separator) {
  return parts.filter((part) => String(part || "").trim()).join(separator);
}

function companyDisplayName(company = {}) {
  return singleLine(company.nombreComercial || company.razonSocial);
}

export function resolveQuoteEmailVariables({
  quote,
  companyProfile,
  accountEmail = "",
  quoteNumber = "",
  formatMoney,
  formatDate,
} = {}) {
  const company = resolveDocumentCompany(quote, companyProfile);
  const hasTotal = quote?.total !== null && quote?.total !== undefined;
  const total = Number(quote?.total);
  const replyTo = resolveReplyToPreview({
    companyEmail: companyProfile?.email,
    accountEmail,
  }).replyTo;
  const phone = singleLine(company.telefono);

  return {
    contacto: pickContactName(quote),
    cliente: pickClientName(quote),
    numero: singleLine(quoteNumber),
    proyecto: singleLine(quote?.proyectoNombre),
    total:
      hasTotal && Number.isFinite(total)
        ? formatMoney(total, quote?.moneda, quote?.locale)
        : "",
    vigencia: buildQuoteValidityPhrase(quote, formatDate),
    empresa: companyDisplayName(company),
    // Internas: las usa el texto por defecto, no se ofrecen al usuario.
    respuesta: buildQuoteReplyLine(Boolean(replyTo)),
    contactoEmpresa: joinNonEmpty(
      [phone && `Tel. ${phone}`, singleLine(company.email)],
      " · "
    ),
  };
}

export function buildQuoteEmailFromTemplate({
  template = DEFAULT_QUOTE_EMAIL_TEMPLATE,
  ...context
} = {}) {
  const variables = resolveQuoteEmailVariables(context);
  const asunto = renderQuoteEmailTemplate(template.asunto, variables)
    .replace(/\s*\n\s*/g, " ")
    .slice(0, QUOTE_EMAIL_SUBJECT_MAX)
    .trim();
  const mensaje = renderQuoteEmailTemplate(template.mensaje, variables).slice(
    0,
    QUOTE_EMAIL_MESSAGE_MAX
  );
  return { asunto, mensaje };
}

// Lo que se ve en el panel: remitente, Reply-To y copia salen de las mismas
// reglas que usa el servidor (ver scripts/quote-email-smoke.mjs, paridad); el
// resumen replica la caja que agrega el servidor bajo el mensaje.
export function buildQuoteEmailPreview({
  quote,
  companyProfile,
  accountEmail = "",
  quoteNumber = "",
  emailCliente = "",
  asunto = "",
  mensaje = "",
  enviarCopia = false,
  formatMoney,
  formatDate,
} = {}) {
  const company = resolveDocumentCompany(quote, companyProfile);
  const senderName =
    companyProfile?.nombreComercial ||
    companyProfile?.razonSocial ||
    company.nombreComercial ||
    company.razonSocial;
  const { replyTo, source } = resolveReplyToPreview({
    companyEmail: companyProfile?.email,
    accountEmail,
  });
  const validityDays =
    Number(quote?.validezDias) || Number(company.validezCotizacionDias) || 15;

  return {
    from: buildSenderDisplayName(senderName),
    replyTo,
    replyToSource: source,
    copyTo: resolveCopyPreview({
      sendCopy: enviarCopia === true && Boolean(accountEmail),
      accountEmail,
      to: emailCliente,
    }),
    to: String(emailCliente || "").trim(),
    subject: String(asunto || "").trim(),
    message: String(mensaje || "").trim(),
    brand: companyDisplayName(company),
    summary: {
      numero: singleLine(quoteNumber),
      fecha: quote?.fecha ? formatDate(quote.fecha) : "",
      // La caja del servidor siempre formatea en CLP (formatCurrencyClp).
      total: formatMoney(Number(quote?.total || 0), "CLP", "es-CL"),
      validezDias: validityDays,
    },
    contact: joinNonEmpty(
      [company.email, company.telefono, company.sitioWeb],
      " / "
    ),
    address: joinNonEmpty([company.direccion, company.ciudad], " / "),
  };
}
