import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "../firebase/firebaseConfig";
import { getQuoteDisplayNumber } from "./quoteService";

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
      ? `Cotizacion ${quoteNumber} - ${companyName}`
      : `Cotizacion - ${companyName}`,
    mensaje:
      `Hola ${quote?.clienteNombre || ""},\n\n` +
      "Adjunto el detalle de la cotizacion preparada en ValoraCloud. " +
      "Quedo atento a tus comentarios o confirmacion.\n\n" +
      "Saludos.",
  };
}

export function buildMailtoUrl({ emailCliente, asunto, mensaje }) {
  const params = new URLSearchParams({
    subject: asunto || "",
    body: mensaje || "",
  });
  return `mailto:${encodeURIComponent(emailCliente || "")}?${params.toString()}`;
}

export async function sendQuoteEmail({ quoteId, emailCliente, asunto, mensaje }) {
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
  const response = await callable({
    quoteId,
    emailCliente: String(emailCliente).trim(),
    asunto: String(asunto).trim(),
    mensaje: String(mensaje).trim(),
  });

  return {
    success: Boolean(response.data?.success),
    provider: response.data?.provider || "",
    warning: response.data?.warning || "",
    error: response.data?.error || "",
    quoteEmailStatus: response.data?.quoteEmailStatus || {},
  };
}
