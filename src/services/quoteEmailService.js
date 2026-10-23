import { httpsCallable } from "firebase/functions";
import { assertCloudFunctionAllowed } from "../config/firebaseEnvironment.mjs";
import { getFirebaseFunctions } from "../firebase/firebaseConfig";
import { formatDate, formatMoney } from "../utils/formatters";
import {
  buildQuoteEmailFromTemplate,
  buildQuoteEmailPreview,
  getQuoteEmailClientAddress,
} from "../domain/quoteEmailTemplate.mjs";
import { DRAFT_QUOTE_NUMBER_LABEL, getQuoteDisplayNumber } from "./quoteService";

const FUNCTIONS_REGION = "us-central1";

export function createQuoteEmailRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return `quote-email-${globalThis.crypto.randomUUID()}`;
  }
  return `quote-email-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function isValidEmail(value) {
  if (typeof value !== "string" || value.length > 180) return false;
  if (/[\r\n,;]/.test(value)) return false;
  return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i.test(
    value.trim()
  );
}

export function buildDefaultQuoteEmail({ quote, companyProfile, accountEmail = "" }) {
  const { asunto, mensaje } = buildQuoteEmailFromTemplate({
    quote,
    companyProfile,
    accountEmail,
    quoteNumber: getQuoteDisplayNumber(quote, ""),
    formatMoney,
    formatDate,
  });

  return {
    emailCliente: getQuoteEmailClientAddress(quote),
    asunto,
    mensaje,
  };
}

export function buildQuoteEmailPanelPreview({
  quote,
  companyProfile,
  accountEmail = "",
  emailCliente,
  asunto,
  mensaje,
  enviarCopia,
}) {
  return buildQuoteEmailPreview({
    quote,
    companyProfile,
    accountEmail,
    quoteNumber: getQuoteDisplayNumber(quote, ""),
    emailCliente,
    asunto,
    mensaje,
    enviarCopia,
    formatMoney,
    formatDate,
  });
}

export function isQuoteEmailSendable(quote, quoteId = quote?.id) {
  const quoteNumber = getQuoteDisplayNumber(quote, "");
  const sendableStatuses = ["borrador", "emitida", "aceptada", "rechazada", "vencida"];

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
  requestId,
  enviarCopia = false,
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
    requestId: requestId || createQuoteEmailRequestId(),
    ...(enviarCopia === true ? { enviarCopia: true } : {}),
  });

  return {
    success: Boolean(response.data?.success),
    idempotent: Boolean(response.data?.idempotent),
    simulated: Boolean(response.data?.simulated),
    provider: response.data?.provider || "",
    qaPublicUrl: response.data?.qaPublicUrl || "",
    warning: response.data?.warning || "",
    error: response.data?.error || "",
    quoteEmailStatus: response.data?.quoteEmailStatus || {},
  };
}
