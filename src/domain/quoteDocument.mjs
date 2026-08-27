import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { resolveDocumentCompany } from "./companySnapshot.mjs";
import {
  adaptStoredQuote,
  calculateQuoteExpiryDate,
  getQuoteDisplayNumber,
  getQuotePdfFileName,
  getQuoteStatusLabel,
  normalizeCompanySnapshot,
} from "./quoteModel.mjs";
import { formatMoney } from "../utils/formatters.js";

const NAVY = [18, 55, 101];
const RED = [181, 34, 45];
const INK = [24, 35, 53];
const MUTED = [95, 107, 124];
const BORDER = [216, 222, 232];
const PAGE_MARGIN = 16;
const PAGE_BOTTOM = 278;

function hasText(value) {
  return Boolean(String(value ?? "").trim());
}

function money(value, quote) {
  return formatMoney(value, quote?.moneda, quote?.locale);
}

function formatDate(value) {
  const text = String(value || "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? text || "-" : date.toLocaleDateString("es-CL");
}

function joinNonEmpty(parts, separator = " · ") {
  return parts.filter(hasText).join(separator);
}

function taxLabel(quote) {
  if (!quote.afectaIva) return `${quote.impuestoNombre || "Impuesto"} (exenta)`;
  const rate = new Intl.NumberFormat(quote.locale || "es-CL", {
    maximumFractionDigits: 2,
  }).format(Number(quote.tasaIva || 0) * 100);
  return `${quote.impuestoNombre || "Impuesto"} ${rate}%`;
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
  const top = compact ? 10 : 13;
  const bottom = compact ? 34 : 57;
  const brand = company.nombreComercial || company.razonSocial || "ValoraCloud";
  const pendingEmission = quote.estado === "borrador" && !quote.fechaEmision;
  let textX = PAGE_MARGIN;

  if (hasText(logoDataUrl)) {
    try {
      const format = /^data:image\/jpe?g/i.test(logoDataUrl) ? "JPEG" : "PNG";
      const size = fitLogoSize(doc, logoDataUrl, compact ? 26 : 34, compact ? 13 : 21);
      doc.addImage(logoDataUrl, format, PAGE_MARGIN, top, size.width, size.height, undefined, "FAST");
      textX += size.width + 5;
    } catch {
      textX = PAGE_MARGIN;
    }
  }

  const rightColumnStart = pageWidth - PAGE_MARGIN - (compact ? 52 : 61);
  doc.setTextColor(...NAVY);
  doc.setFont("helvetica", "bold");
  setFittedFontSize(doc, brand, compact ? 12 : 17, compact ? 9 : 11, rightColumnStart - textX - 5);
  doc.text(brand, textX, top + 5);

  if (!compact) {
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    const fiscal = company.identificadorFiscalValor || company.rut;
    const companyLines = [
      company.razonSocial !== brand ? company.razonSocial : "",
      joinNonEmpty([
        fiscal ? `${company.identificadorFiscalTipo || "Identificación fiscal"} ${fiscal}` : "",
        company.giro ? `Giro: ${company.giro}` : "",
      ]),
      joinNonEmpty([company.direccion, company.ciudad, company.region]),
      joinNonEmpty([company.email, company.telefono, company.sitioWeb]),
    ].filter(hasText);
    companyLines.slice(0, 4).forEach((line, index) => {
      doc.text(String(line), textX, top + 11 + index * 4.2, { maxWidth: 112 });
    });
  }

  const right = pageWidth - PAGE_MARGIN;
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(compact ? 9.5 : 11);
  doc.text("COTIZACIÓN", right, top + 3, { align: "right" });
  doc.setTextColor(...RED);
  doc.setFontSize(compact ? 9 : 13);
  doc.text(`Nº ${getQuoteDisplayNumber(quote, quote.id || "-")}`, right, top + (compact ? 9 : 10), { align: "right" });

  if (!compact) {
    const expiry = quote.fechaVencimiento || calculateQuoteExpiryDate(quote.fecha, quote.validezDias);
    const details = [
      ["Fecha de emisión", formatDate(quote.fechaEmision || quote.fecha)],
      [pendingEmission ? "Vigencia" : "Válida hasta", pendingEmission ? `${quote.validezDias || "-"} días desde la emisión` : formatDate(expiry)],
      ["Estado comercial", getQuoteStatusLabel(quote.estado)],
    ];
    details.forEach(([label, value], index) => {
      const rowY = top + 18 + index * 5;
      doc.setTextColor(...MUTED);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.3);
      doc.text(label, right - 32, rowY, { align: "right" });
      doc.setTextColor(...INK);
      doc.setFont("helvetica", "bold");
      doc.text(String(value), right, rowY, { align: "right", maxWidth: 31 });
    });
    if (pendingEmission) {
      doc.setTextColor(...MUTED);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.6);
      doc.text("Aún no ha sido enviada al cliente.", right, top + 35, { align: "right" });
    }
  }

  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.65);
  doc.line(PAGE_MARGIN, bottom, pageWidth - PAGE_MARGIN, bottom);
  doc.setDrawColor(...RED);
  doc.setLineWidth(1.35);
  doc.line(PAGE_MARGIN, bottom, PAGE_MARGIN + 19, bottom);
  return bottom;
}

function drawSectionHeading(doc, title, y) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.2);
  doc.setTextColor(...NAVY);
  doc.text(String(title).toUpperCase(), PAGE_MARGIN, y);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.35);
  doc.line(PAGE_MARGIN, y + 2.3, doc.internal.pageSize.getWidth() - PAGE_MARGIN, y + 2.3);
  return y + 7;
}

function drawDetailLine(doc, { label = "", value = "", x, y, width, bold = false }) {
  if (!hasText(value)) return y;
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(bold ? 9.2 : 8.1);
  doc.setTextColor(bold ? INK[0] : MUTED[0], bold ? INK[1] : MUTED[1], bold ? INK[2] : MUTED[2]);
  const content = label ? `${label}: ${value}` : String(value);
  const lines = doc.splitTextToSize(content, width);
  doc.text(lines, x, y);
  return y + Math.max(4.3, lines.length * 4.1);
}

function drawClientAndProject(doc, quote, y) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - PAGE_MARGIN * 2;
  const columnWidth = (contentWidth - 10) / 2;
  const client = quote.cliente || {};
  let cursor = drawSectionHeading(doc, "Cliente", y);
  let leftY = cursor;
  let rightY = cursor;
  leftY = drawDetailLine(doc, { value: client.empresa, x: PAGE_MARGIN, y: leftY, width: columnWidth, bold: true });
  const fiscal = client.identificadorFiscalValor || client.rut;
  leftY = drawDetailLine(doc, {
    label: client.identificadorFiscalTipo || "Identificación fiscal",
    value: fiscal,
    x: PAGE_MARGIN,
    y: leftY,
    width: columnWidth,
  });
  leftY = drawDetailLine(doc, { label: "Contacto", value: client.contacto, x: PAGE_MARGIN, y: leftY, width: columnWidth });
  rightY = drawDetailLine(doc, { value: joinNonEmpty([client.email, client.telefono]), x: PAGE_MARGIN + columnWidth + 10, y: rightY, width: columnWidth });
  rightY = drawDetailLine(doc, { value: joinNonEmpty([client.direccion, client.ciudad]), x: PAGE_MARGIN + columnWidth + 10, y: rightY, width: columnWidth });
  cursor = Math.max(leftY, rightY) + 3;

  const project = client.proyecto || quote.trabajoTitulo;
  if (hasText(project)) {
    cursor = drawSectionHeading(doc, "Proyecto", cursor + 2);
    cursor = drawDetailLine(doc, { value: project, x: PAGE_MARGIN, y: cursor, width: contentWidth, bold: true }) + 2;
  }
  return cursor;
}

function ensureSpace(doc, y, required, onNewPage) {
  if (y + required <= PAGE_BOTTOM) return y;
  doc.addPage();
  onNewPage();
  return 41;
}

function drawWrappedParagraph(doc, text, y, onNewPage, { bullet = false } = {}) {
  const maxWidth = doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2 - (bullet ? 6 : 0);
  const lines = doc.splitTextToSize(String(text), maxWidth);
  let cursor = y;
  lines.forEach((line, index) => {
    cursor = ensureSpace(doc, cursor, 5, onNewPage);
    if (bullet && index === 0) {
      doc.setFillColor(...RED);
      doc.circle(PAGE_MARGIN + 1.2, cursor - 1, 0.6, "F");
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.2);
    doc.setTextColor(...INK);
    doc.text(line, PAGE_MARGIN + (bullet ? 5 : 0), cursor);
    cursor += 4.3;
  });
  return cursor + 0.7;
}

function drawTotals(doc, quote, y, onNewPage) {
  const rows = [
    ["Subtotal", money(quote.subtotal, quote)],
    ...(Number(quote.descuentoTotal) > 0 ? [["Descuento", `-${money(quote.descuentoTotal, quote)}`]] : []),
    ["Neto", money(quote.neto, quote)],
    [taxLabel(quote), money(quote.iva, quote)],
    ["TOTAL", money(quote.total, quote)],
  ];
  const width = 76;
  const height = rows.length * 6.7 + 4;
  const cursor = ensureSpace(doc, y, height + 4, onNewPage);
  const x = doc.internal.pageSize.getWidth() - PAGE_MARGIN - width;

  rows.forEach(([label, value], index) => {
    const isTotal = index === rows.length - 1;
    const rowY = cursor + 5.5 + index * 6.7;
    if (index > 0) {
      doc.setDrawColor(...(isTotal ? NAVY : BORDER));
      doc.setLineWidth(isTotal ? 0.5 : 0.25);
      doc.line(x, rowY - 4.6, x + width, rowY - 4.6);
    }
    doc.setFont("helvetica", isTotal ? "bold" : "normal");
    doc.setFontSize(isTotal ? 10.5 : 8.3);
    doc.setTextColor(...(isTotal ? NAVY : INK));
    doc.text(label, x, rowY);
    doc.setFont("helvetica", "bold");
    doc.text(value, x + width, rowY, { align: "right" });
    if (isTotal) {
      doc.setDrawColor(...NAVY);
      doc.setLineWidth(0.8);
      doc.line(x, rowY + 2.5, x + width, rowY + 2.5);
    }
  });
  return cursor + height + 8;
}

function drawFooter(doc, quote, company) {
  const pages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const brand = company.nombreComercial || company.razonSocial || "ValoraCloud";
  const responsible = joinNonEmpty([company.responsable, company.telefono, company.email]);
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.3);
    doc.line(PAGE_MARGIN, 284, pageWidth - PAGE_MARGIN, 284);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.7);
    doc.setTextColor(...MUTED);
    doc.text(responsible || `${brand} · ValoraCloud`, PAGE_MARGIN, 289, { maxWidth: 128 });
    doc.text(`Página ${page} de ${pages}`, pageWidth - PAGE_MARGIN, 289, { align: "right" });
  }
  doc.setProperties({
    title: `Cotización ${getQuoteDisplayNumber(quote, quote.id || "")}`,
    subject: quote.cliente?.proyecto || quote.cliente?.empresa || "Cotización comercial",
    author: brand,
    creator: "ValoraCloud",
  });
}

function buildTableDefinition(quote) {
  const showCode = quote.items.some((item) => hasText(item.codigo));
  const showUnit = quote.items.some((item) => hasText(item.unidad));
  const showDiscount = quote.items.some((item) => Number(item.descuentoPorcentaje) > 0);
  const columns = [
    ...(showCode ? [{ key: "code", header: "Código", width: 21 }] : []),
    { key: "item", header: "Producto, servicio o actividad", width: "auto" },
    ...(showUnit ? [{ key: "unit", header: "Unidad", width: 15 }] : []),
    { key: "quantity", header: "Cantidad", width: 15, numeric: true },
    { key: "price", header: "Precio unitario", width: 25, numeric: true },
    ...(showDiscount ? [{ key: "discount", header: "Descuento", width: 18, numeric: true }] : []),
    { key: "total", header: "Total", width: 27, numeric: true },
  ];
  const valueFor = (item, index, key) => ({
    code: item.codigo || "-",
    item: `${item.nombre}${item.descripcionComercial ? `\n${item.descripcionComercial}` : ""}`,
    unit: item.unidad || "-",
    quantity: String(item.cantidad),
    price: money(item.precioUnitarioEditable, quote),
    discount: item.descuentoPorcentaje ? `${item.descuentoPorcentaje}%` : "-",
    total: money(item.totalLinea, quote),
  }[key] ?? String(index + 1));
  const columnStyles = Object.fromEntries(columns.map((column, index) => [
    index,
    {
      cellWidth: column.width,
      ...(column.numeric ? { halign: "right" } : {}),
    },
  ]));
  return {
    head: [columns.map((column) => column.header)],
    body: quote.items.map((item, index) => columns.map((column) => valueFor(item, index, column.key))),
    columnStyles,
  };
}

export function buildQuotePdfDocument({ quote: rawQuote, companyProfile, logoDataUrl = "" }) {
  const quote = adaptStoredQuote({
    ...rawQuote,
    empresaSnapshot: resolveDocumentCompany(rawQuote, companyProfile),
  });
  const company = normalizeCompanySnapshot(quote.empresa || companyProfile || {});
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const drawCompactHeader = () => drawHeader(doc, quote, company, logoDataUrl, { compact: true });
  let y = drawHeader(doc, quote, company, logoDataUrl) + 8;
  y = drawClientAndProject(doc, quote, y);

  const table = buildTableDefinition(quote);
  autoTable(doc, {
    startY: y + 2,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, top: 40, bottom: 20 },
    head: table.head,
    body: table.body,
    theme: "plain",
    showHead: "everyPage",
    pageBreak: "auto",
    rowPageBreak: "avoid",
    styles: {
      cellPadding: { top: 2.6, right: 1.8, bottom: 2.6, left: 1.8 },
      font: "helvetica",
      fontSize: 7.5,
      lineColor: BORDER,
      lineWidth: { bottom: 0.2 },
      overflow: "linebreak",
      textColor: INK,
      valign: "top",
    },
    headStyles: {
      fillColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 6.8,
      lineColor: NAVY,
      lineWidth: { bottom: 0.55 },
      textColor: NAVY,
    },
    columnStyles: table.columnStyles,
    willDrawPage: (data) => {
      if (data.pageNumber > 1) drawCompactHeader();
    },
  });

  y = (doc.lastAutoTable?.finalY || y) + 7;
  const onNewPage = () => drawCompactHeader();
  y = drawTotals(doc, quote, y, onNewPage);

  if (quote.legacyIvaNoDefinido) {
    y = ensureSpace(doc, y, 12, onNewPage);
    doc.setDrawColor(212, 157, 40);
    doc.setLineWidth(0.8);
    doc.line(PAGE_MARGIN, y, PAGE_MARGIN, y + 8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(112, 77, 13);
    doc.text(
      "Documento histórico: la condición tributaria no quedó registrada en su versión original.",
      PAGE_MARGIN + 4,
      y + 5
    );
    y += 14;
  }

  quote.seccionesAlcance.forEach((section) => {
    const sectionHeight = 12 + section.lineas.reduce((height, line) => {
      const wrapped = doc.splitTextToSize(
        String(line),
        doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2 - 6
      );
      return height + Math.max(1, wrapped.length) * 4.3 + 0.7;
    }, 0);
    y = ensureSpace(doc, y, Math.min(sectionHeight, PAGE_BOTTOM - 41), onNewPage);
    y = drawSectionHeading(doc, section.titulo, y);
    section.lineas.forEach((line) => {
      y = drawWrappedParagraph(doc, line, y, onNewPage, { bullet: true });
    });
    y += 3;
  });

  const conditionEntries = [
    ["Condiciones de pago", quote.condiciones.formaPago],
    ["Plazo de ejecución o entrega", quote.condiciones.plazoEntrega],
    ["Alcance geográfico", quote.condiciones.alcanceGeografico],
    ["Garantía", quote.condiciones.garantia],
    ["Observaciones comerciales", quote.condiciones.observaciones],
    ["Exclusiones", quote.condiciones.exclusiones],
    ["Términos adicionales", quote.condiciones.terminosAdicionales],
  ].filter(([, value]) => hasText(value));

  if (conditionEntries.length > 0) {
    const conditionsHeight = 12 + conditionEntries.reduce((height, [, value]) => {
      const wrapped = doc.splitTextToSize(
        String(value),
        doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2
      );
      return height + 5 + Math.max(1, wrapped.length) * 4.3 + 0.7;
    }, 0);
    y = ensureSpace(doc, y, Math.min(conditionsHeight, PAGE_BOTTOM - 41), onNewPage);
    y = drawSectionHeading(doc, "Condiciones comerciales", y);
    conditionEntries.forEach(([label, value]) => {
      y = ensureSpace(doc, y, 10, onNewPage);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.2);
      doc.setTextColor(...INK);
      doc.text(label, PAGE_MARGIN, y);
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
    ["Nombre", "RUT", "Cargo", "Firma", "Fecha"].forEach((label, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = PAGE_MARGIN + column * (fieldWidth + 8);
      const fieldY = y + row * 11;
      doc.setDrawColor(...BORDER);
      doc.line(x, fieldY + 5, x + fieldWidth, fieldY + 5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.1);
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
