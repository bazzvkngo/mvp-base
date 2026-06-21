import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "../firebase/firebaseConfig";
import { DRAFT_QUOTE_NUMBER_LABEL, getQuoteDisplayNumber } from "./quoteService";

const FUNCTIONS_REGION = "us-central1";

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

export function buildDefaultQuoteEmail({ quote, companyProfile }) {
  const quoteNumber = getQuoteDisplayNumber(quote, "");
  const companyName =
    quote?.empresa?.nombreComercial ||
    companyProfile?.nombreComercial ||
    companyProfile?.razonSocial ||
    "ValoraCloud";

  return {
    emailCliente: quote?.clienteEmail || "",
    asunto: quoteNumber
      ? `Cotización ${quoteNumber} - ${companyName}`
      : `Cotización - ${companyName}`,
    mensaje:
      "Estimado/a cliente:\n\n" +
      `Adjuntamos la cotización ${quoteNumber || ""} preparada por ${companyName} para su revisión.\n\n` +
      "Quedamos atentos a sus comentarios.\n\n" +
      "Saludos,\n" +
      companyName,
  };
}

export function buildManualQuoteEmail({ quote }) {
  const quoteNumber = getQuoteDisplayNumber(quote, "");

  return (
    "Estimado/a cliente:\n\n" +
    `Comparto la cotización ${quoteNumber || ""} preparada por Bagner para su revisión.\n\n` +
    "Antes de enviar este mensaje, adjuntaré manualmente el archivo PDF de la cotización.\n\n" +
    "Quedamos atentos a sus comentarios.\n\n" +
    "Saludos,\n" +
    "Bagner"
  );
}

export function isQuoteEmailSendable(quote, quoteId = quote?.id) {
  const quoteNumber = getQuoteDisplayNumber(quote, "");
  const sendableStatuses = ["emitida", "aceptada", "rechazada", "vencida"];

  return Boolean(
    quoteId &&
      quoteNumber &&
      quoteNumber !== DRAFT_QUOTE_NUMBER_LABEL &&
      quote?.fecha &&
      sendableStatuses.includes((quote?.estado || "").toLowerCase())
  );
}

export function buildMailtoUrl({ emailCliente, asunto, mensaje }) {
  const recipient = encodeURIComponent(String(emailCliente || "").trim());
  const subject = encodeURIComponent(asunto || "");
  const body = encodeURIComponent(mensaje || "");
  return `mailto:${recipient}?subject=${subject}&body=${body}`;
}

export async function sendQuoteEmail({
  quoteId,
  emailCliente,
  asunto,
  mensaje,
  pdfAttachment,
}) {
  if (!quoteId) {
    throw new Error("Guarda la cotizacion antes de enviarla por correo.");
  }
  if (!isValidEmail(emailCliente)) {
    throw new Error("Ingresa un correo de cliente valido.");
  }
  if (!String(asunto || "").trim()) {
    throw new Error("Ingresa el asunto del correo.");
  }
  if (!String(mensaje || "").trim()) {
    throw new Error("Ingresa el mensaje del correo.");
  }

  const functions = getFunctions(app, FUNCTIONS_REGION);
  const callable = httpsCallable(functions, "sendQuoteEmail");
  const pdfBase64 = String(pdfAttachment?.contentBase64 || "").replace(
    /^data:application\/pdf;base64,/i,
    ""
  );
  const response = await callable({
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
    provider: response.data?.provider || "",
    warning: response.data?.warning || "",
    error: response.data?.error || "",
    quoteEmailStatus: response.data?.quoteEmailStatus || {},
  };
}
