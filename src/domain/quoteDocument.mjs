import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import {
  adaptStoredQuote,
  calculateQuoteExpiryDate,
  getQuoteDisplayNumber,
  getQuotePdfFileName,
  normalizeCompanySnapshot,
} from "./quoteModel.mjs";

const NAVY = [7, 40, 93];
const RED = [210, 36, 48];
const INK = [20, 31, 50];
const MUTED = [79, 93, 117];
const LIGHT = [244, 247, 251];
const BORDER = [211, 220, 233];
const PAGE_MARGIN = 14;
const PAGE_BOTTOM = 278;

const STATUS_LABELS = {
  borrador: "Borrador",
  emitida: "Emitida",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  vencida: "Vencida",
  archivada: "Archivada",
};

function hasText(value) {
  return Boolean(String(value ?? "").trim());
}

function formatCLP(value) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatDate(value) {
  const text = String(value || "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? text || "-" : date.toLocaleDateString("es-CL");
}

function joinNonEmpty(parts, separator = " · ") {
  return parts.filter(hasText).join(separator);
}

function fitLogoSize(doc, logoDataUrl, maxWidth, maxHeight) {
  try {
    const properties = doc.getImageProperties(logoDataUrl);
    const ratio = properties.width / properties.height;
    let width = maxWidth;
    let height = width / ratio;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * ratio;
    }
    return { width, height };
  } catch {
    return { width: maxWidth, height: maxHeight };
  }
}

function setFittedFontSize(doc, text, preferredSize, minimumSize, maxWidth) {
  let size = preferredSize;
  doc.setFontSize(size);
  while (size > minimumSize && doc.getTextWidth(String(text)) > maxWidth) {
    size -= 0.5;
    doc.setFontSize(size);
  }
  return size;
}

function drawHeader(doc, quote, company, logoDataUrl, { compact = false } = {}) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const top = compact ? 10 : 12;
  const headerBottom = compact ? 38 : 52;
  const brand = company.nombreComercial || company.razonSocial || "Bagner";
  let textX = PAGE_MARGIN;

  if (hasText(logoDataUrl)) {
    try {
      const format = /^data:image\/jpe?g/i.test(logoDataUrl) ? "JPEG" : "PNG";
      const size = fitLogoSize(doc, logoDataUrl, compact ? 31 : 38, compact ? 16 : 23);
      doc.addImage(logoDataUrl, format, PAGE_MARGIN, top, size.width, size.height, undefined, "FAST");
      textX = PAGE_MARGIN + size.width + 4;
    } catch {
      textX = PAGE_MARGIN;
    }
  }

  doc.setTextColor(...NAVY);
  doc.setFont("helvetica", "bold");
  const rightColumnStart = pageWidth - PAGE_MARGIN - (compact ? 48 : 52);
  setFittedFontSize(
    doc,
    brand,
    compact ? 12 : 17,
    compact ? 9 : 11,
    Math.max(45, rightColumnStart - textX - 5)
  );
  doc.text(brand, textX, top + (compact ? 5 : 6));

  if (!compact) {
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.6);
    const companyLines = [
      company.razonSocial && company.razonSocial !== brand ? company.razonSocial : "",
      joinNonEmpty([company.rut ? `RUT ${company.rut}` : "", company.giro]),
      joinNonEmpty([company.direccion, company.ciudad, company.region]),
      joinNonEmpty([company.email, company.telefono, company.sitioWeb]),
    ].filter(hasText);
    companyLines.slice(0, 4).forEach((line, index) => {
      doc.text(String(line), textX, top + 12 + index * 4.1, {
        maxWidth: 105,
      });
    });
  }

  const quoteNumber = getQuoteDisplayNumber(quote, quote.id || "-");
  const right = pageWidth - PAGE_MARGIN;
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(compact ? 10 : 15);
  doc.text("COTIZACIÓN", right, top + 4, { align: "right" });
  doc.setTextColor(...RED);
  doc.setFontSize(compact ? 9 : 11);
  doc.text(`N° ${quoteNumber}`, right, top + (compact ? 10 : 12), { align: "right" });

  if (!compact) {
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`Emisión ${formatDate(quote.fecha)}`, right, top + 19, { align: "right" });
    doc.text(
      `Vence ${formatDate(
        quote.fechaVencimiento || calculateQuoteExpiryDate(quote.fecha, quote.validezDias)
      )}`,
      right,
      top + 24,
      { align: "right" }
    );
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text(STATUS_LABELS[quote.estado] || quote.estado || "Borrador", right, top + 30, {
      align: "right",
    });
  }

  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.8);
  doc.line(PAGE_MARGIN, headerBottom, pageWidth - PAGE_MARGIN, headerBottom);
  doc.setDrawColor(...RED);
  doc.setLineWidth(1.8);
  doc.line(PAGE_MARGIN, headerBottom, PAGE_MARGIN + 22, headerBottom);
  return headerBottom;
}

function drawClientBlock(doc, quote, y) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const width = pageWidth - PAGE_MARGIN * 2;
  const client = quote.cliente || {};
  const leftLines = [
    client.empresa,
    client.rut ? `RUT ${client.rut}` : "",
    client.contacto ? `Contacto: ${client.contacto}` : "",
    joinNonEmpty([client.email, client.telefono]),
  ].filter(hasText);
  const rightLines = [
    client.proyecto ? `Proyecto: ${client.proyecto}` : "",
    joinNonEmpty([client.direccion, client.ciudad]),
    `Validez: ${quote.validezDias || 15} días`,
    `Moneda: ${quote.moneda || "CLP"}`,
  ].filter(hasText);
  const rowCount = Math.max(leftLines.length, rightLines.length, 2);
  const height = 12 + rowCount * 4.4;

  doc.setFillColor(...LIGHT);
  doc.setDrawColor(...BORDER);
  doc.roundedRect(PAGE_MARGIN, y, width, height, 1.5, 1.5, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...NAVY);
  doc.text("CLIENTE", PAGE_MARGIN + 4, y + 6);
  doc.text("PROYECTO Y VIGENCIA", PAGE_MARGIN + width / 2 + 2, y + 6);
  doc.setDrawColor(...BORDER);
  doc.line(PAGE_MARGIN + width / 2, y + 4, PAGE_MARGIN + width / 2, y + height - 4);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...INK);
  doc.setFontSize(8.3);
  leftLines.forEach((line, index) => {
    doc.setFont("helvetica", index === 0 ? "bold" : "normal");
    doc.text(String(line), PAGE_MARGIN + 4, y + 12 + index * 4.4, {
      maxWidth: width / 2 - 9,
    });
  });
  rightLines.forEach((line, index) => {
    doc.setFont("helvetica", index === 0 && client.proyecto ? "bold" : "normal");
    doc.text(String(line), PAGE_MARGIN + width / 2 + 4, y + 12 + index * 4.4, {
      maxWidth: width / 2 - 8,
    });
  });
  return y + height + 7;
}

function ensureSpace(doc, y, required, onNewPage) {
  if (y + required <= PAGE_BOTTOM) return y;
  doc.addPage();
  onNewPage();
  return 44;
}

function drawSectionHeading(doc, title, y) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...NAVY);
  doc.text(String(title).toUpperCase(), PAGE_MARGIN, y);
  doc.setDrawColor(...RED);
  doc.setLineWidth(0.8);
  doc.line(PAGE_MARGIN, y + 2, PAGE_MARGIN + 16, y + 2);
  return y + 7;
}

function drawWrappedParagraph(doc, text, y, onNewPage, { bullet = false } = {}) {
  const maxWidth = doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2 - (bullet ? 6 : 0);
  const lines = doc.splitTextToSize(String(text), maxWidth);
  let cursor = y;
  lines.forEach((line, index) => {
    cursor = ensureSpace(doc, cursor, 5, onNewPage);
    if (bullet && index === 0) {
      doc.setFillColor(...RED);
      doc.circle(PAGE_MARGIN + 1.2, cursor - 1, 0.65, "F");
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.4);
    doc.setTextColor(...INK);
    doc.text(line, PAGE_MARGIN + (bullet ? 5 : 0), cursor);
    cursor += 4.3;
  });
  return cursor + 0.7;
}

function drawTotals(doc, quote, y, onNewPage) {
  const rows = [
    ["Subtotal", formatCLP(quote.subtotal)],
    ...(Number(quote.descuentoTotal) > 0
      ? [["Descuento total", `-${formatCLP(quote.descuentoTotal)}`]]
      : []),
    ["Subtotal neto", formatCLP(quote.neto)],
    [quote.afectaIva ? "IVA 19%" : "IVA (exenta)", formatCLP(quote.iva)],
    ["TOTAL", formatCLP(quote.total)],
  ];
  const width = 76;
  const height = 8 + rows.length * 7;
  let cursor = ensureSpace(doc, y, height + 4, onNewPage);
  const x = doc.internal.pageSize.getWidth() - PAGE_MARGIN - width;
  doc.setFillColor(...LIGHT);
  doc.setDrawColor(...BORDER);
  doc.roundedRect(x, cursor, width, height, 1.5, 1.5, "FD");
  rows.forEach(([label, value], index) => {
    const isTotal = index === rows.length - 1;
    const rowY = cursor + 7 + index * 7;
    if (isTotal) {
      doc.setFillColor(...NAVY);
      doc.rect(x, rowY - 5.2, width, 7.7, "F");
      doc.setTextColor(255, 255, 255);
    } else {
      doc.setTextColor(...INK);
      if (index > 0) {
        doc.setDrawColor(...BORDER);
        doc.line(x + 4, rowY - 5.2, x + width - 4, rowY - 5.2);
      }
    }
    doc.setFont("helvetica", isTotal ? "bold" : "normal");
    doc.setFontSize(isTotal ? 9.5 : 8.5);
    doc.text(label, x + 4, rowY);
    doc.text(value, x + width - 4, rowY, { align: "right" });
  });
  return cursor + height + 8;
}

function drawFooter(doc, quote, company) {
  const pages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const brand = company.nombreComercial || company.razonSocial || "Bagner";
  const responsible = joinNonEmpty([
    company.responsable,
    company.telefono,
  ]);
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.35);
    doc.line(PAGE_MARGIN, 284, pageWidth - PAGE_MARGIN, 284);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.setTextColor(...MUTED);
    doc.text(responsible || brand, PAGE_MARGIN, 289, { maxWidth: 78 });
    doc.text(`${brand} · ValoraCloud`, pageWidth / 2, 289, { align: "center" });
    doc.text(`Página ${page} de ${pages}`, pageWidth - PAGE_MARGIN, 289, {
      align: "right",
    });
  }
  doc.setProperties({
    title: `Cotización ${getQuoteDisplayNumber(quote, quote.id || "")}`,
    subject: quote.cliente?.proyecto || quote.cliente?.empresa || "Cotización comercial",
    author: brand,
    creator: "ValoraCloud",
  });
}

export function buildQuotePdfDocument({ quote: rawQuote, companyProfile, logoDataUrl = "" }) {
  const quote = adaptStoredQuote({
    ...rawQuote,
    empresa: rawQuote?.empresa || companyProfile || {},
  });
  const company = normalizeCompanySnapshot(quote.empresa || companyProfile || {});
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const drawCompactHeader = () => drawHeader(doc, quote, company, logoDataUrl, { compact: true });
  let y = drawHeader(doc, quote, company, logoDataUrl) + 7;
  y = drawClientBlock(doc, quote, y);

  const tableBody = quote.items.map((item, index) => [
    item.codigo || String(index + 1),
    {
      content: `${item.nombre}${item.descripcionComercial ? `\n${item.descripcionComercial}` : ""}`,
      styles: { fontStyle: item.descripcionComercial ? "normal" : "bold" },
    },
    item.unidad || "-",
    String(item.cantidad),
    formatCLP(item.precioUnitarioEditable),
    item.descuentoPorcentaje ? `${item.descuentoPorcentaje}%` : "-",
    formatCLP(item.totalLinea),
  ]);

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, top: 44, bottom: 21 },
    head: [["Código", "Producto, servicio o actividad", "Unidad", "Cant.", "P. unitario", "Desc.", "Total"]],
    body: tableBody,
    theme: "grid",
    showHead: "everyPage",
    pageBreak: "auto",
    rowPageBreak: "avoid",
    styles: {
      cellPadding: 2.2,
      font: "helvetica",
      fontSize: 7.5,
      lineColor: BORDER,
      lineWidth: 0.25,
      overflow: "linebreak",
      textColor: INK,
      valign: "top",
    },
    headStyles: {
      fillColor: NAVY,
      fontStyle: "bold",
      fontSize: 7.2,
      halign: "left",
      textColor: 255,
    },
    alternateRowStyles: { fillColor: LIGHT },
    columnStyles: {
      0: { cellWidth: 18 },
      1: { cellWidth: "auto" },
      2: { cellWidth: 16 },
      3: { cellWidth: 13, halign: "right" },
      4: { cellWidth: 25, halign: "right" },
      5: { cellWidth: 14, halign: "right" },
      6: { cellWidth: 27, halign: "right" },
    },
    willDrawPage: (data) => {
      if (data.pageNumber > 1) drawCompactHeader();
    },
  });

  y = (doc.lastAutoTable?.finalY || y) + 7;
  const onNewPage = () => drawCompactHeader();
  y = drawTotals(doc, quote, y, onNewPage);

  if (quote.legacyIvaNoDefinido) {
    y = ensureSpace(doc, y, 12, onNewPage);
    doc.setFillColor(255, 248, 230);
    doc.setDrawColor(241, 190, 80);
    doc.roundedRect(PAGE_MARGIN, y, 182, 9, 1.2, 1.2, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.7);
    doc.setTextColor(112, 77, 13);
    doc.text(
      "Documento histórico: la condición tributaria no fue registrada en el modelo original.",
      PAGE_MARGIN + 4,
      y + 5.7
    );
    y += 15;
  }

  quote.seccionesAlcance.forEach((section) => {
    y = ensureSpace(doc, y, 15, onNewPage);
    y = drawSectionHeading(doc, section.titulo, y);
    section.lineas.forEach((line) => {
      y = drawWrappedParagraph(doc, line, y, onNewPage, { bullet: true });
    });
    y += 3;
  });

  const conditionEntries = [
    ["Plazo de ejecución o entrega", quote.condiciones.plazoEntrega],
    ["Forma de pago", quote.condiciones.formaPago],
    ["Alcance geográfico", quote.condiciones.alcanceGeografico],
    ["Garantía", quote.condiciones.garantia],
    ["Observaciones", quote.condiciones.observaciones],
    ["Exclusiones", quote.condiciones.exclusiones],
    ["Términos adicionales", quote.condiciones.terminosAdicionales],
  ].filter(([, value]) => hasText(value));

  if (conditionEntries.length > 0) {
    y = ensureSpace(doc, y, 15, onNewPage);
    y = drawSectionHeading(doc, "Condiciones comerciales", y);
    conditionEntries.forEach(([label, value]) => {
      y = ensureSpace(doc, y, 10, onNewPage);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.4);
      doc.setTextColor(...INK);
      doc.text(`${label}:`, PAGE_MARGIN, y);
      y = drawWrappedParagraph(doc, value, y + 4.5, onNewPage);
    });
    y += 2;
  }

  if (quote.aceptacion?.habilitada) {
    y = ensureSpace(doc, y, 48, onNewPage);
    y = drawSectionHeading(doc, "Aceptación", y);
    y = drawWrappedParagraph(doc, quote.aceptacion.texto, y, onNewPage);
    y += 5;
    const pageWidth = doc.internal.pageSize.getWidth();
    const fieldWidth = (pageWidth - PAGE_MARGIN * 2 - 8) / 2;
    const acceptanceFields = ["Nombre", "RUT", "Cargo", "Firma", "Fecha"];
    acceptanceFields.forEach((label, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = PAGE_MARGIN + column * (fieldWidth + 8);
      const fieldY = y + row * 11;
      doc.setDrawColor(...BORDER);
      doc.line(x, fieldY + 5, x + fieldWidth, fieldY + 5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.2);
      doc.setTextColor(...MUTED);
      doc.text(label, x, fieldY + 9);
    });
  }

  drawFooter(doc, quote, company);
  return { doc, quote, fileName: getQuotePdfFileName(quote) };
}

export function buildQuotePdfBase64(options) {
  const result = buildQuotePdfDocument(options);
  const dataUri = result.doc.output("datauristring");
  return {
    fileName: result.fileName,
    contentType: "application/pdf",
    contentBase64: dataUri.split(",")[1] || "",
  };
}
