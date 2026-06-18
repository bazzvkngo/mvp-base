import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { getQuoteDisplayNumber } from "../services/quoteService";
import { formatCLP, formatDate } from "./formatters";

const statusLabels = {
  borrador: "Borrador",
  emitida: "Emitida",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  vencida: "Vencida",
  archivada: "Archivada",
};

function hasText(value) {
  return Boolean(String(value || "").trim());
}

function cleanFilePart(value) {
  return String(value || "cotizacion")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function joinParts(parts) {
  return parts.filter(hasText).join(" / ");
}

function getCompanyData(quote, companyProfile) {
  const snapshot = quote?.empresa || {};
  const hasSnapshotData = [
    "nombreComercial",
    "razonSocial",
    "rut",
    "giro",
    "email",
    "telefono",
    "direccion",
    "ciudad",
    "sitioWeb",
    "logoUrl",
    "condicionesPago",
    "notaPieCotizacion",
  ].some((field) => hasText(snapshot[field]));

  return hasSnapshotData ? snapshot : companyProfile || {};
}

function addWrappedText(doc, text, x, y, options = {}) {
  const maxWidth = options.maxWidth || 180;
  const lineHeight = options.lineHeight || 5;
  const lines = doc.splitTextToSize(String(text || ""), maxWidth);
  doc.text(lines, x, y);
  return y + lines.length * lineHeight;
}

async function loadImageDataUrl(url) {
  if (!hasText(url)) return "";

  try {
    const response = await fetch(url);
    if (!response.ok) return "";
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn("No se pudo cargar el logo para el PDF.", error);
    return "";
  }
}

export function getQuotePdfFileName(quote) {
  const quoteNumber = cleanFilePart(getQuoteDisplayNumber(quote, quote?.id || ""));
  return `Cotizacion_${quoteNumber || "cotizacion"}.pdf`;
}

export async function buildQuotePdfAttachment({ quote, companyProfile }) {
  const doc = new jsPDF();
  const company = getCompanyData(quote, companyProfile);
  const logoDataUrl = await loadImageDataUrl(company.logoUrl);
  const quoteNumber = getQuoteDisplayNumber(quote, quote?.id || "-");
  const brand = company.nombreComercial || company.razonSocial || "ValoraCloud";
  const items = Array.isArray(quote?.items) ? quote.items : [];
  const margin = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 16;

  if (logoDataUrl) {
    try {
      const logoFormat = logoDataUrl.includes("image/jpeg") ? "JPEG" : "PNG";
      doc.addImage(logoDataUrl, logoFormat, margin, 14, 18, 18);
    } catch (error) {
      console.warn("No se pudo insertar el logo en el PDF.", error);
    }
  }

  const companyTextX = logoDataUrl ? margin + 24 : margin;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(brand, companyTextX, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  [
    company.razonSocial && company.razonSocial !== brand ? company.razonSocial : "",
    company.rut ? `RUT: ${company.rut}` : "",
    company.giro ? `Giro: ${company.giro}` : "",
    joinParts([company.email, company.telefono, company.sitioWeb]),
    joinParts([company.direccion, company.ciudad]),
  ]
    .filter(hasText)
    .forEach((line) => {
      doc.text(String(line), companyTextX, y);
      y += 5;
    });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`Cotizacion N. ${quoteNumber}`, pageWidth - margin, 16, {
    align: "right",
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Fecha: ${formatDate(quote?.fecha)}`, pageWidth - margin, 22, {
    align: "right",
  });
  doc.text(
    `Estado: ${statusLabels[quote?.estado] || quote?.estado || "-"}`,
    pageWidth - margin,
    28,
    { align: "right" }
  );

  y = Math.max(y + 5, 42);
  doc.setDrawColor(15, 118, 110);
  doc.setLineWidth(0.7);
  doc.line(margin, y, pageWidth - margin, y);
  y += 9;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Cliente", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  [
    quote?.clienteNombre || "Sin cliente",
    quote?.clienteRut ? `RUT/DNI: ${quote.clienteRut}` : "",
    quote?.clienteEmail ? `Email: ${quote.clienteEmail}` : "",
    quote?.clienteTelefono ? `Telefono: ${quote.clienteTelefono}` : "",
    quote?.clienteDireccion ? `Direccion: ${quote.clienteDireccion}` : "",
  ]
    .filter(hasText)
    .forEach((line) => {
      doc.text(String(line), margin, y);
      y += 5;
    });

  y += 4;
  autoTable(doc, {
    startY: y,
    head: [["Item", "Descripcion", "Cant.", "Precio unit.", "Total"]],
    body: items.map((item) => [
      item.nombre || "Item sin nombre",
      item.descripcion || item.categoria || item.tipoItem || "",
      String(item.cantidad || 0),
      formatCLP(item.precioUnitarioEditable),
      formatCLP(item.totalLinea),
    ]),
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: 255,
    },
    columnStyles: {
      2: { halign: "right", cellWidth: 18 },
      3: { halign: "right", cellWidth: 30 },
      4: { halign: "right", cellWidth: 30 },
    },
  });

  y = (doc.lastAutoTable?.finalY || y) + 8;
  const totalsX = pageWidth - margin;
  doc.setFontSize(10);
  [
    ["Subtotal", formatCLP(quote?.subtotal)],
    ["Descuento", formatCLP(quote?.descuento)],
    ["Total", formatCLP(quote?.total)],
  ].forEach(([label, value], index) => {
    doc.setFont("helvetica", index === 2 ? "bold" : "normal");
    doc.text(label, totalsX - 56, y);
    doc.text(value, totalsX, y, { align: "right" });
    y += 6;
  });

  y += 4;
  if (y > 245) {
    doc.addPage();
    y = 18;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Condiciones comerciales", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  y = addWrappedText(
    doc,
    `Pago: ${quote?.condicionesPago || company.condicionesPago || "-"}`,
    margin,
    y
  );
  y = addWrappedText(
    doc,
    `Validez: ${company.validezCotizacionDias || 15} dias`,
    margin,
    y + 1
  );

  if (hasText(quote?.observaciones)) {
    y = addWrappedText(doc, `Observaciones: ${quote.observaciones}`, margin, y + 1);
  }
  if (hasText(company.notaPieCotizacion)) {
    y = addWrappedText(doc, company.notaPieCotizacion, margin, y + 3, {
      maxWidth: 170,
      lineHeight: 4,
    });
  }

  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text("Documento generado con ValoraCloud", pageWidth / 2, 286, {
    align: "center",
  });

  const fileName = getQuotePdfFileName(quote);
  const dataUri = doc.output("datauristring");
  const base64 = dataUri.split(",")[1] || "";

  return {
    fileName,
    contentType: "application/pdf",
    contentBase64: base64,
  };
}
