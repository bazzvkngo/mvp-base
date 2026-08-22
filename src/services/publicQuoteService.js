import { httpsCallable } from "firebase/functions";
import { assertCloudFunctionAllowed } from "../config/firebaseEnvironment.mjs";
import { getFirebaseFunctions } from "../firebase/firebaseConfig";

const FUNCTIONS_REGION = "us-central1";
const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REJECTION_REASONS = new Set([
  "precio",
  "plazo",
  "requerimiento_cambio",
  "otra_alternativa",
  "otro",
  "no_indica",
]);

export function createQuoteDeliveryRequestId(medium = "delivery") {
  if (globalThis.crypto?.randomUUID) {
    return `quote-${medium}-${globalThis.crypto.randomUUID()}`;
  }
  return `quote-${medium}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function validateToken(token) {
  const normalized = String(token || "").trim();
  if (!PUBLIC_TOKEN_PATTERN.test(normalized)) {
    throw new Error(
      "No pudimos abrir esta propuesta. Revisa el enlace o contacta a la empresa emisora."
    );
  }
  return normalized;
}

function publicProposalError(error, fallback) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  if (code.includes("failed-precondition")) {
    return new Error(message || "Esta propuesta ya no admite respuestas.");
  }
  if (code.includes("invalid-argument")) {
    return new Error(message || fallback);
  }
  return new Error(fallback);
}

export async function getPublicQuoteProposal(token) {
  const safeToken = validateToken(token);
  try {
    const callable = httpsCallable(
      getFirebaseFunctions(FUNCTIONS_REGION),
      "getPublicQuoteProposal"
    );
    const response = await callable({ token: safeToken });
    return response.data?.proposal || null;
  } catch (error) {
    throw publicProposalError(
      error,
      "No pudimos abrir esta propuesta. Revisa el enlace o contacta a la empresa emisora."
    );
  }
}

export async function respondPublicQuoteProposal({
  token,
  action,
  motivo = "no_indica",
  comentario = "",
}) {
  const safeToken = validateToken(token);
  if (!["accept", "reject"].includes(action)) {
    throw new Error("Selecciona una respuesta válida.");
  }
  if (action === "reject" && !REJECTION_REASONS.has(motivo)) {
    throw new Error("Selecciona un motivo válido.");
  }
  if (String(comentario).length > 500) {
    throw new Error("El comentario no puede superar 500 caracteres.");
  }

  try {
    const callable = httpsCallable(
      getFirebaseFunctions(FUNCTIONS_REGION),
      "respondPublicQuoteProposal"
    );
    const response = await callable({
      token: safeToken,
      action,
      ...(action === "reject"
        ? { motivo, comentario: String(comentario).trim() }
        : {}),
    });
    return response.data;
  } catch (error) {
    throw publicProposalError(
      error,
      "No pudimos registrar tu respuesta. Recarga la propuesta e inténtalo nuevamente."
    );
  }
}

export async function prepareQuoteWhatsAppShare(
  businessId,
  quoteId,
  {requestId} = {}
) {
  assertCloudFunctionAllowed("preparar el enlace público de la cotización");
  if (!businessId || !quoteId) {
    throw new Error("Selecciona una cotización válida.");
  }
  try {
    const callable = httpsCallable(
      getFirebaseFunctions(FUNCTIONS_REGION),
      "prepareQuoteWhatsAppShare"
    );
    const stableRequestId = requestId || createQuoteDeliveryRequestId("whatsapp");
    const response = await callable({businessId, quoteId, requestId: stableRequestId});
    const publicUrl = String(response.data?.publicUrl || "");
    if (!/^https?:\/\//i.test(publicUrl)) {
      throw new Error("No se pudo preparar el enlace público.");
    }
    return {
      publicUrl,
      expiresAt: response.data?.expiresAt || "",
      requestId: stableRequestId,
    };
  } catch (error) {
    throw publicProposalError(
      error,
      "No pudimos preparar el enlace para WhatsApp."
    );
  }
}

export async function confirmQuoteWhatsAppSent(businessId, quoteId, requestId) {
  assertCloudFunctionAllowed("confirmar el envío de la cotización por WhatsApp");
  if (!businessId || !quoteId) {
    throw new Error("Selecciona una cotización válida.");
  }
  try {
    const callable = httpsCallable(
      getFirebaseFunctions(FUNCTIONS_REGION),
      "confirmQuoteWhatsAppSent"
    );
    const response = await callable({businessId, quoteId, requestId});
    return response.data?.quoteStatus || {};
  } catch (error) {
    throw publicProposalError(
      error,
      "No pudimos registrar la confirmación del envío. Puedes mantenerla pendiente e intentarlo nuevamente."
    );
  }
}
