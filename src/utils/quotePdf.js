import { buildQuotePdfBase64 } from "../domain/quoteDocument.mjs";
import {
  getQuoteDisplayNumber,
  getQuotePdfFileName,
} from "../domain/quoteModel.mjs";

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

function canSharePdfFiles() {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.share !== "function" ||
    typeof navigator.canShare !== "function" ||
    typeof File === "undefined"
  ) {
    return false;
  }

  try {
    const probe = new File([new Uint8Array()], "cotizacion.pdf", {
      type: "application/pdf",
    });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

function normalizeWhatsAppPhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";

  if (raw.startsWith("+") || raw.startsWith("00")) {
    return raw.startsWith("00") ? digits.slice(2) : digits;
  }
  if (digits.startsWith("56") && digits.length === 11) return digits;
  if (digits.length === 9) return `56${digits}`;
  return "";
}

function buildWhatsAppUrl({ quote, companyProfile, publicUrl }) {
  const company = quote?.empresa || companyProfile || {};
  const quoteNumber = getQuoteDisplayNumber(quote, quote?.id || "");
  const clientName = String(quote?.clienteNombre || "").trim() || "cliente";
  const companyName = String(
    company.nombreComercial || company.razonSocial || "nuestra empresa"
  ).trim();
  const phone = normalizeWhatsAppPhone(
    quote?.clienteTelefono || quote?.cliente?.telefono
  );
  const message = [
    `Hola ${clientName}, te comparto la cotización ${quoteNumber} de ${companyName}.`,
    `Revisar y responder propuesta: ${publicUrl}`,
    "Quedo atento a tus comentarios.",
  ].join("\n\n");
  const destination = phone ? `https://wa.me/${phone}` : "https://wa.me/";
  return `${destination}?text=${encodeURIComponent(message)}`;
}

export async function shareQuotePdf({ quote, companyProfile, publicUrl }) {
  if (!/^https?:\/\//i.test(String(publicUrl || ""))) {
    throw new Error("No se pudo preparar el enlace público de la propuesta.");
  }
  const supportsDirectFileShare = canSharePdfFiles();
  const fallbackWindow = supportsDirectFileShare
    ? null
    : window.open("", "_blank");
  if (fallbackWindow) fallbackWindow.opener = null;
  let attachment;

  try {
    attachment = await buildQuotePdfAttachment({ quote, companyProfile });
  } catch (error) {
    fallbackWindow?.close();
    throw error;
  }
  if (!attachment.contentBase64) {
    fallbackWindow?.close();
    throw new Error("PDF de cotización vacío o inválido.");
  }
  const blob = attachmentToBlob(attachment);
  const file = new File([blob], attachment.fileName, { type: attachment.contentType });
  const quoteNumber = getQuoteDisplayNumber(quote, quote?.id || "");
  const title = `Cotización ${quoteNumber}`;
  const company = quote?.empresa || companyProfile || {};
  const companyName = String(
    company.nombreComercial || company.razonSocial || "nuestra empresa"
  ).trim();
  const sharePayload = {
    title,
    text: [
      `Hola ${quote?.clienteNombre || "cliente"}, te comparto ${title} de ${companyName}.`,
      `Revisar y responder propuesta: ${publicUrl}`,
    ].join("\n\n"),
    files: [file],
  };

  if (supportsDirectFileShare && navigator.canShare(sharePayload)) {
    await navigator.share(sharePayload);
    return {
      externalFlowOpened: true,
      fileName: attachment.fileName,
      sharedDirectly: true,
    };
  }

  triggerBlobDownload(blob, attachment.fileName);
  const whatsappUrl = buildWhatsAppUrl({ quote, companyProfile, publicUrl });
  if (fallbackWindow && !fallbackWindow.closed) {
    fallbackWindow.location.href = whatsappUrl;
  } else {
    const openedWindow = window.open(whatsappUrl, "_blank", "noopener,noreferrer");
    if (!openedWindow) {
      throw new Error("El navegador bloqueó la apertura de WhatsApp.");
    }
  }
  return {
    externalFlowOpened: true,
    fileName: attachment.fileName,
    sharedDirectly: false,
  };
}
