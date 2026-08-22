import { httpsCallable } from "firebase/functions";
import { assertCloudFunctionAllowed } from "../config/firebaseEnvironment.mjs";
import { getFirebaseFunctions } from "../firebase/firebaseConfig";
import { formatDate, formatMoney } from "../utils/formatters";
import { buildQuoteValidityEmailLine } from "../domain/quoteEmailCopy.mjs";
import {resolveDocumentCompany} from "../domain/companySnapshot.mjs";
import { DRAFT_QUOTE_NUMBER_LABEL, getQuoteDisplayNumber } from "./quoteService";

const FUNCTIONS_REGION = "us-central1";

export function isValidEmail(value) {
  if (typeof value !== "string" || value.length > 180) return false;
  if (/[\r\n,;]/.test(value)) return false;
  return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i.test(
    value.trim()
  );
}

export function buildDefaultQuoteEmail({ quote, companyProfile }) {
  const quoteNumber = getQuoteDisplayNumber(quote, "");
  const company = resolveDocumentCompany(quote, companyProfile);
  const companyName = company.nombreComercial || company.razonSocial || "";
  const contactName =
    quote?.clienteNombre ||
    quote?.cliente?.nombreRazonSocial ||
    quote?.clienteSnapshot?.nombreRazonSocial ||
    quote?.clienteContacto ||
    quote?.cliente?.personaContacto ||
    quote?.clienteSnapshot?.personaContacto ||
    "";
  const projectName = String(quote?.proyectoNombre || "").trim();
  const hasTotal = quote?.total !== null && quote?.total !== undefined;
  const total = Number(quote?.total);
  const quoteLabel = quoteNumber ? ` ${quoteNumber}` : "";
  const projectLine = projectName
    ? `, correspondiente a ${projectName}`
    : "";
  const totalLine = hasTotal && Number.isFinite(total)
    ? `, por un total de ${formatMoney(total, quote?.moneda, quote?.locale)}`
    : "";
  const paragraphs = [
    contactName ? `Hola ${contactName}:` : "Hola:",
    `Te enviamos la cotización${quoteLabel}${projectLine}${totalLine}.`,
    buildQuoteValidityEmailLine(quote, formatDate),
    "Adjuntamos el documento PDF con el detalle completo.",
    "Puedes revisar y responder la propuesta desde el enlace incluido en este correo.",
    "Si tienes consultas o necesitas ajustes, responde a este correo.",
    companyName ? `Saludos,\n${companyName}` : "Saludos,",
  ].filter(Boolean);
  const subjectParts = [
    `Cotización${quoteLabel}`,
    companyName,
  ].filter(Boolean);

  return {
    emailCliente:
      quote?.cliente?.email ||
      quote?.clienteSnapshot?.email ||
      quote?.clienteEmail ||
      "",
    asunto: subjectParts.join(" | "),
    mensaje: paragraphs.join("\n\n"),
  };
}

export function isQuoteEmailSendable(quote, quoteId = quote?.id) {
  const quoteNumber = getQuoteDisplayNumber(quote, "");
  const sendableStatuses = ["borrador", "emitida"];

  return Boolean(
    quoteId &&
      quoteNumber &&
      quoteNumber !== DRAFT_QUOTE_NUMBER_LABEL &&
      quote?.fecha &&
      sendableStatuses.includes((quote?.estado || "").toLowerCase())
  );
}

export async function sendQuoteEmail({
  businessId,
  quoteId,
  emailCliente,
  asunto,
  mensaje,
  pdfAttachment,
}) {
  assertCloudFunctionAllowed("el envío de cotizaciones por correo");
  if (!quoteId) {
    throw new Error("Guarda la cotización antes de enviarla por correo.");
  }
  if (!isValidEmail(emailCliente)) {
    throw new Error("Ingresa un único correo de destino válido.");
  }
  if (!String(asunto || "").trim()) {
    throw new Error("Ingresa el asunto del correo.");
  }
  if (String(asunto).length > 180) {
    throw new Error("El asunto debe tener 180 caracteres o menos.");
  }
  if (/[\r\n]/.test(String(asunto))) {
    throw new Error("El asunto no puede contener saltos de linea.");
  }
  if (!String(mensaje || "").trim()) {
    throw new Error("Ingresa el mensaje del correo.");
  }
  if (String(mensaje).length > 2000) {
    throw new Error("El mensaje debe tener 2000 caracteres o menos.");
  }

  const functions = getFirebaseFunctions(FUNCTIONS_REGION);
  const callable = httpsCallable(functions, "sendQuoteEmail");
  const pdfBase64 = String(pdfAttachment?.contentBase64 || "").replace(
    /^data:application\/pdf;base64,/i,
    ""
  );
  const response = await callable({
    businessId,
    quoteId,
    emailCliente: String(emailCliente).trim(),
    asunto: String(asunto).trim(),
    mensaje: String(mensaje).trim(),
    pdfBase64,
    pdfFilename: pdfAttachment?.fileName || "",
    pdfMimeType: pdfAttachment?.contentType || "application/pdf",
  });

  return {
    success: Boolean(response.data?.success),
    simulated: Boolean(response.data?.simulated),
    provider: response.data?.provider || "",
    qaPublicUrl: response.data?.qaPublicUrl || "",
    warning: response.data?.warning || "",
    error: response.data?.error || "",
    quoteEmailStatus: response.data?.quoteEmailStatus || {},
  };
}
