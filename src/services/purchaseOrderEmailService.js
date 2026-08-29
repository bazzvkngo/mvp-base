import {httpsCallable} from "firebase/functions";
import {assertCloudFunctionAllowed} from "../config/firebaseEnvironment.mjs";
import {getFirebaseFunctions} from "../firebase/firebaseConfig";

export function isValidPurchaseOrderEmail(value) {
  if (typeof value !== "string" || value.length > 180 || /[\r\n,;]/.test(value)) return false;
  return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i.test(value.trim());
}

export function isValidPurchaseOrderEmailSubject(value) {
  return typeof value === "string" && Boolean(value.trim()) && value.length <= 180 && !/[\r\n]/.test(value);
}

export function isValidPurchaseOrderEmailMessage(value) {
  return typeof value === "string" && Boolean(value.trim()) && value.length <= 2000;
}

export async function sendPurchaseOrderEmail({businessId, ordenCompraId, emailProveedor, asunto, mensaje, pdfAttachment}) {
  assertCloudFunctionAllowed("el envío de órdenes de compra por correo");
  if (!ordenCompraId) throw new Error("Crea la orden antes de enviarla.");
  if (!isValidPurchaseOrderEmail(emailProveedor)) throw new Error("Ingresa un único correo de destino válido.");
  if (!isValidPurchaseOrderEmailSubject(asunto)) throw new Error("Ingresa un asunto válido de hasta 180 caracteres.");
  if (!isValidPurchaseOrderEmailMessage(mensaje)) throw new Error("Ingresa un mensaje válido de hasta 2000 caracteres.");
  const response = await httpsCallable(
    getFirebaseFunctions("us-central1"),
    "sendPurchaseOrderEmail"
  )({
    businessId,
    ordenCompraId,
    emailProveedor: emailProveedor.trim(),
    asunto: asunto.trim(),
    mensaje: mensaje.trim(),
    pdfBase64: pdfAttachment?.contentBase64 || "",
    pdfFilename: pdfAttachment?.fileName || "",
    pdfMimeType: pdfAttachment?.contentType || "application/pdf",
  });
  return {
    success: Boolean(response.data?.success),
    simulated: Boolean(response.data?.simulated),
    emitted: Boolean(response.data?.emitted),
    resent: Boolean(response.data?.resent),
    provider: response.data?.provider || "",
    error: response.data?.error || "",
  };
}
