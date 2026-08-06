import { buildQuotePdfBase64 } from "../domain/quoteDocument.mjs";
import { getQuotePdfFileName } from "../domain/quoteModel.mjs";

function hasText(value) {
  return Boolean(String(value ?? "").trim());
}

async function blobToDataUrl(blob) {
  if (typeof FileReader !== "undefined") {
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (typeof Buffer !== "undefined") {
    return `data:${blob.type || "image/png"};base64,${Buffer.from(bytes).toString("base64")}`;
  }
  return "";
}

async function loadImageDataUrl(url) {
  if (!hasText(url)) return "";
  if (/^data:image\//i.test(url)) return url;

  try {
    const response = await fetch(url);
    if (!response.ok) return "";
    return await blobToDataUrl(await response.blob());
  } catch (error) {
    console.warn("No se pudo cargar el logo para el PDF.", error);
    return "";
  }
}

export { getQuotePdfFileName };

export async function buildQuotePdfAttachment({ quote, companyProfile }) {
  const company = quote?.empresa || companyProfile || {};
  const logoDataUrl = await loadImageDataUrl(company.logoUrl);
  return buildQuotePdfBase64({ quote, companyProfile, logoDataUrl });
}

export async function downloadQuotePdf({ quote, companyProfile }) {
  const attachment = await buildQuotePdfAttachment({ quote, companyProfile });
  if (!attachment.contentBase64) throw new Error("PDF de cotización vacío o inválido.");

  const blob = attachmentToBlob(attachment);
  triggerBlobDownload(blob, attachment.fileName);
  return attachment.fileName;
}

function attachmentToBlob(attachment) {
  const binary = window.atob(attachment.contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: attachment.contentType });
}

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function shareQuotePdf({ quote, companyProfile }) {
  const attachment = await buildQuotePdfAttachment({ quote, companyProfile });
  if (!attachment.contentBase64) throw new Error("PDF de cotización vacío o inválido.");
  const blob = attachmentToBlob(attachment);
  const file = new File([blob], attachment.fileName, { type: attachment.contentType });
  const title = `Cotización ${quote?.numero || ""}`.trim();
  const sharePayload = {
    title,
    text: `${title} para ${quote?.clienteNombre || "cliente"}.`,
    files: [file],
  };
  if (navigator.share && (!navigator.canShare || navigator.canShare(sharePayload))) {
    await navigator.share(sharePayload);
    return { fileName: attachment.fileName, sharedDirectly: true };
  }

  triggerBlobDownload(blob, attachment.fileName);
  const whatsappText = encodeURIComponent(
    `${title}. Descargué ${attachment.fileName}; adjúntalo en este chat.`
  );
  window.open(`https://wa.me/?text=${whatsappText}`, "_blank", "noopener,noreferrer");
  return { fileName: attachment.fileName, sharedDirectly: false };
}
