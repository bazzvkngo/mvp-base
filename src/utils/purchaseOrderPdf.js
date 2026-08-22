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

function normalizePhone(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  if (raw.startsWith("+") || raw.startsWith("00")) return raw.startsWith("00") ? digits.slice(2) : digits;
  if (digits.startsWith("56") && digits.length === 11) return digits;
  if (digits.length === 9) return `56${digits}`;
  return "";
}

export async function sharePurchaseOrderWhatsApp({order, companyProfile}) {
  const supportsFileShare = Boolean(
    navigator.share && navigator.canShare && typeof File !== "undefined"
  );
  const fallbackWindow = supportsFileShare ? null : window.open("", "_blank");
  if (fallbackWindow) fallbackWindow.opener = null;
  let attachment;
  try {
    attachment = await buildPurchaseOrderPdfAttachment({order, companyProfile});
  } catch (error) {
    fallbackWindow?.close();
    throw error;
  }
  const blob = attachmentToBlob(attachment);
  const file = new File([blob], attachment.fileName, {type: attachment.contentType});
  const company = resolveDocumentCompany(order, companyProfile);
  const companyName = company.nombreComercial || company.razonSocial || "nuestra empresa";
  const providerName = order.proveedorSnapshot?.razonSocial || "proveedor";
  const text = `Hola ${providerName}, te comparto la orden de compra ${order.numero} de ${companyName}. El PDF contiene el detalle completo.`;
  const payload = {title: `Orden de compra ${order.numero}`, text, files: [file]};
  if (supportsFileShare && navigator.canShare(payload)) {
    await navigator.share(payload);
    return {externalFlowOpened: true, sharedDirectly: true, destination: order.proveedorSnapshot?.telefono || ""};
  }
  downloadBlob(blob, attachment.fileName);
  const phone = normalizePhone(order.proveedorSnapshot?.telefono);
  const url = `${phone ? `https://wa.me/${phone}` : "https://wa.me/"}?text=${encodeURIComponent(text)}`;
  if (fallbackWindow && !fallbackWindow.closed) fallbackWindow.location.href = url;
  else if (!window.open(url, "_blank", "noopener,noreferrer")) throw new Error("El navegador bloqueó la apertura de WhatsApp.");
  return {externalFlowOpened: true, sharedDirectly: false, destination: order.proveedorSnapshot?.telefono || ""};
}
