import {buildPurchaseOrderPdfBase64} from "../domain/purchaseOrderDocument.mjs";
import {resolveDocumentCompany} from "../domain/companySnapshot.mjs";

async function blobToDataUrl(blob) {
  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });
}

async function loadLogo(url) {
  if (!String(url || "").trim()) return "";
  if (/^data:image\//i.test(url)) return url;
  try {
    const response = await fetch(url);
    return response.ok ? blobToDataUrl(await response.blob()) : "";
  } catch {
    return "";
  }
}

export async function buildPurchaseOrderPdfAttachment({order, companyProfile}) {
  const company = resolveDocumentCompany(order, companyProfile);
  const logoDataUrl = await loadLogo(company.logoUrl);
  return buildPurchaseOrderPdfBase64({order, companyProfile, logoDataUrl});
}

function attachmentToBlob(attachment) {
  const binary = window.atob(attachment.contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], {type: attachment.contentType});
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function downloadPurchaseOrderPdf(options) {
  const attachment = await buildPurchaseOrderPdfAttachment(options);
  downloadBlob(attachmentToBlob(attachment), attachment.fileName);
  return attachment.fileName;
}

export function normalizePurchaseOrderWhatsAppPhone(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  if (raw.startsWith("+") || raw.startsWith("00")) return raw.startsWith("00") ? digits.slice(2) : digits;
  if (digits.startsWith("56") && digits.length === 11) return digits;
  if (digits.length === 9) return `56${digits}`;
  return "";
}

export function getPurchaseOrderWhatsAppAvailability(order) {
  const phone = normalizePurchaseOrderWhatsAppPhone(order?.proveedorSnapshot?.telefono);
  return {
    enabled: Boolean(phone),
    phone,
    help: phone ? "" : "Agrega un teléfono al proveedor para compartir por WhatsApp.",
  };
}

export function buildPurchaseOrderWhatsAppMessage({order, companyProfile}) {
  const company = resolveDocumentCompany(order, companyProfile);
  const companyName = company.nombreComercial || company.razonSocial || "nuestra empresa";
  return `Hola, te enviamos la orden de compra ${order.numero} de ${companyName}. Por favor confirma su recepción o indícanos cualquier observación.`;
}

export async function sharePurchaseOrderWhatsApp({order, companyProfile, targetWindow = null}) {
  const availability = getPurchaseOrderWhatsAppAvailability(order);
  if (!availability.enabled) throw new Error(availability.help);
  const text = buildPurchaseOrderWhatsAppMessage({order, companyProfile});
  const url = `https://wa.me/${availability.phone}?text=${encodeURIComponent(text)}`;
  if (targetWindow && !targetWindow.closed) {
    targetWindow.location.href = url;
  } else if (!window.open(url, "_blank", "noopener,noreferrer")) {
    throw new Error("El navegador bloqueó la apertura de WhatsApp.");
  }
  return {
    externalFlowOpened: true,
    sharedDirectly: false,
    destination: availability.phone,
  };
}
