import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { getDefaultFiscalIdentifierLabel } from "./businessCatalog.js";
import { resolveDocumentCompany } from "./companySnapshot.mjs";
import {
  adaptStoredQuote,
  calculateQuoteExpiryDate,
  getQuoteDisplayNumber,
  getQuotePdfFileName,
  normalizeCompanySnapshot,
} from "./quoteModel.mjs";
import {
  QUOTE_FOOTER_QUESTION,
  QUOTE_FOOTER_THANKS,
  buildQuoteAcceptanceLine,
  buildQuoteClientRows,
  buildQuoteFooterContact,
  buildQuoteTerms,
} from "./quoteDocumentLayout.mjs";
import { formatMoney } from "../utils/formatters.js";

// Espejo en RGB de los tokens --color-document-* (tokens.css): jsPDF no lee CSS.
const NAVY = [18, 55, 101];
const RED = [181, 34, 45];
const INK = [24, 35, 53];
const MUTED = [95, 107, 124];
const BORDER = [216, 222, 232];
const WHITE = [255, 255, 255];
const TINT = [221, 229, 241];
const PAGE_MARGIN = 16;
const PAGE_BOTTOM = 278;
const TOTALS_WIDTH = 76;
const TOTALS_ROW_HEIGHT = 6.4;
const TERMS_GAP = 6;

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

// Línea "Etiqueta: valor" alineada a la derecha, con la etiqueta en negrita y el
// valor normal (igual que el <strong> del HTML). Si el valor no cabe en
// maxWidth, se parte sin contar la etiqueta; ésta va solo en la primera línea,
// pegada al comienzo del valor. Devuelve la siguiente posición vertical.
export function drawRightLabeledLine(doc, label, value, right, y, maxWidth, lineHeight = 4.2) {
  const labelText = `${label}: `;
  doc.setFont("helvetica", "bold");
  const labelWidth = doc.getTextWidth(labelText);
  doc.setFont("helvetica", "normal");
  const lines = doc.splitTextToSize(String(value), maxWidth - labelWidth);
  let cursor = y;
  lines.forEach((line, index) => {
    doc.setFont("helvetica", "normal");
    doc.text(line, right, cursor, { align: "right" });
    if (index === 0) {
      const lineWidth = doc.getTextWidth(line);
      doc.setFont("helvetica", "bold");
      doc.text(labelText, right - lineWidth, cursor, { align: "right" });
      doc.setFont("helvetica", "normal");
    }
    cursor += lineHeight;
  });
  return cursor;
}

// Cabecera de las páginas siguientes a la primera.
function drawCompactHeader(doc, quote, company, logoDataUrl) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const top = 10;
  const bottom = 34;
  const brand = company.nombreComercial || company.razonSocial || "ValoraCloud";
  let textX = PAGE_MARGIN;

  if (hasText(logoDataUrl)) {
    try {
      const format = /^data:image\/jpe?g/i.test(logoDataUrl) ? "JPEG" : "PNG";
      const size = fitLogoSize(doc, logoDataUrl, 26, 13);
      doc.addImage(logoDataUrl, format, PAGE_MARGIN, top, size.width, size.height, undefined, "FAST");
      textX += size.width + 5;
    } catch {
      textX = PAGE_MARGIN;
    }
  }

  const rightColumnStart = pageWidth - PAGE_MARGIN - 52;
  doc.setTextColor(...NAVY);
  doc.setFont("helvetica", "bold");
  setFittedFontSize(doc, brand, 12, 9, rightColumnStart - textX - 5);
  doc.text(brand, textX, top + 5);

  const right = pageWidth - PAGE_MARGIN;
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text(`COTIZACIÓN Nº ${getQuoteDisplayNumber(quote, quote.id || "-")}`, right, top + 3, { align: "right" });

  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.65);
  doc.line(PAGE_MARGIN, bottom, pageWidth - PAGE_MARGIN, bottom);
  doc.setDrawColor(...RED);
  doc.setLineWidth(1.35);
  doc.line(PAGE_MARGIN, bottom, PAGE_MARGIN + 19, bottom);
  return bottom;
}

// Cabecera de la primera página: logo grande a la izquierda; número, fechas y
// datos fiscales de la empresa a la derecha. Todo dato vacío se omite.
function drawHeader(doc, quote, company, logoDataUrl) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const top = 13;
  const right = pageWidth - PAGE_MARGIN;
  const brand = company.nombreComercial || company.razonSocial || "ValoraCloud";
  const pendingEmission = quote.estado === "borrador" && !quote.fechaEmision;
  let leftEnd = top;
  let drewLogo = false;

  if (hasText(logoDataUrl)) {
    try {
      const format = /^data:image\/jpe?g/i.test(logoDataUrl) ? "JPEG" : "PNG";
      const size = fitLogoSize(doc, logoDataUrl, 62, 26);
      doc.addImage(logoDataUrl, format, PAGE_MARGIN, top, size.width, size.height, undefined, "FAST");
      leftEnd = top + size.height;
      drewLogo = true;
    } catch {
      drewLogo = false;
    }
  }
  if (!drewLogo) {
    doc.setTextColor(...NAVY);
    doc.setFont("helvetica", "bold");
    setFittedFontSize(doc, brand, 18, 11, 100);
    doc.text(brand, PAGE_MARGIN, top + 7);
    leftEnd = top + 10;
  }
  const leftLines = [
    company.razonSocial !== brand ? company.razonSocial : "",
    company.giro ? `Giro: ${company.giro}` : "",
  ].filter(hasText);
  doc.setTextColor(...MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  leftLines.forEach((line) => {
    leftEnd += 4.2;
    doc.text(String(line), PAGE_MARGIN, leftEnd, { maxWidth: 100 });
  });

  // Columna derecha: número (en dos líneas, el número nunca se parte), datos
  // fiscales de la empresa y, después, fecha de emisión y vigencia.
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("COTIZACIÓN", right, top + 2.5, { align: "right", charSpace: 0.4 });
  doc.setFontSize(14);
  doc.text(`Nº ${getQuoteDisplayNumber(quote, quote.id || "-")}`, right, top + 9, { align: "right" });

  const fiscal = company.identificadorFiscalValor || company.rut;
  const location = joinNonEmpty([company.ciudad, company.region], ", ");
  const companyLines = [
    [company.identificadorFiscalTipo || "Identificación fiscal", fiscal],
    ["Dirección", company.direccion],
    ["Ciudad", location],
  ].filter(([, value]) => hasText(value));
  doc.setTextColor(...INK);
  doc.setFontSize(8);
  let rightEnd = top + 9;
  rightEnd += 6;
  companyLines.forEach(([label, value]) => {
    rightEnd = drawRightLabeledLine(doc, label, value, right, rightEnd, 82);
  });

  const expiry = quote.fechaVencimiento || calculateQuoteExpiryDate(quote.fecha, quote.validezDias);
  const details = [
    ["Fecha de emisión", formatDate(quote.fechaEmision || quote.fecha)],
    [pendingEmission ? "Vigencia" : "Válida hasta", pendingEmission ? `${quote.validezDias || "-"} días desde la emisión` : formatDate(expiry)],
  ];
  rightEnd += 2;
  details.forEach(([label, value]) => {
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(label, right - 36, rightEnd, { align: "right" });
    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.text(String(value), right, rightEnd, { align: "right", maxWidth: 35 });
    rightEnd += 5;
  });

  return Math.max(leftEnd, rightEnd - 5, top + 24) + 4;
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

function drawBand(doc, title, x, y, width) {
  doc.setFillColor(...NAVY);
  doc.rect(x, y, width, 5.4, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...WHITE);
  doc.text(String(title).toUpperCase(), x + width / 2, y + 3.8, { align: "center" });
  return y + 5.4;
}

// Banda CLIENTE y datos del cliente (incluye el proyecto) en dos columnas.
function drawClientBlock(doc, quote, y) {
  const contentWidth = doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2;
  const client = quote.cliente || {};
  const rows = buildQuoteClientRows(client, client.proyecto || quote.trabajoTitulo);
  const columnWidth = (contentWidth - 8) / 2;
  const labelWidth = 24;
  let cursor = drawBand(doc, "Cliente", PAGE_MARGIN, y, contentWidth) + 5;
  for (let index = 0; index < rows.length; index += 2) {
    let rowHeight = 0;
    rows.slice(index, index + 2).forEach(([label, value], column) => {
      const x = PAGE_MARGIN + column * (columnWidth + 8);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.1);
      doc.setTextColor(...INK);
      doc.text(label, x + 1.5, cursor);
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(value, columnWidth - labelWidth - 1.5);
      doc.text(lines, x + labelWidth, cursor);
      rowHeight = Math.max(rowHeight, lines.length * 4.1);
    });
    cursor += Math.max(4.6, rowHeight + 0.5);
  }
  return cursor + 2;
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

function buildTotalsRows(quote) {
  return [
    ["Subtotal", money(quote.subtotal, quote)],
    ...(Number(quote.descuentoTotal) > 0 ? [["Descuento", `-${money(quote.descuentoTotal, quote)}`]] : []),
    ["Neto", money(quote.neto, quote)],
    [taxLabel(quote), money(quote.iva, quote)],
    ["TOTAL", money(quote.total, quote)],
  ];
}

// Recuadro de totales con el TOTAL resaltado.
function drawTotalsBox(doc, rows, x, y) {
  const height = rows.length * TOTALS_ROW_HEIGHT;
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.3);
  doc.rect(x, y, TOTALS_WIDTH, height);
  rows.forEach(([label, value], index) => {
    const isTotal = index === rows.length - 1;
    const rowY = y + index * TOTALS_ROW_HEIGHT;
    if (isTotal) {
      doc.setFillColor(...TINT);
      doc.rect(x, rowY, TOTALS_WIDTH, TOTALS_ROW_HEIGHT, "FD");
    }
    doc.setFont("helvetica", isTotal ? "bold" : "normal");
    doc.setFontSize(isTotal ? 10.5 : 8.3);
    doc.setTextColor(...(isTotal ? NAVY : INK));
    doc.text(label, x + 3, rowY + 4.4);
    doc.setFont("helvetica", "bold");
    doc.text(value, x + TOTALS_WIDTH - 3, rowY + 4.4, { align: "right" });
  });
  return height;
}

function layoutTerms(doc, terms, width) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.8);
  return terms.map((term, index) => ({
    number: `${index + 1}.`,
    lines: doc.splitTextToSize(String(term), width - 11),
  }));
}

function termsBoxHeight(layout) {
  return 5.4 + 3 + layout.reduce((height, item) => height + item.lines.length * 3.9 + 1.1, 0) + 2;
}

function drawTermsBox(doc, layout, x, y, width) {
  const height = termsBoxHeight(layout);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.3);
  doc.rect(x, y, width, height);
  let cursor = drawBand(doc, "Términos y condiciones", x, y, width) + 5;
  layout.forEach((item) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);
    doc.setTextColor(...INK);
    doc.text(item.number, x + 2.5, cursor);
    doc.text(item.lines, x + 8, cursor);
    cursor += item.lines.length * 3.9 + 1.1;
  });
  return height;
}

// Términos y condiciones numerados (izquierda) y totales (derecha). Si los
// términos no caben en una página, se imprimen a ancho completo tras los
// totales para poder paginarlos.
function drawSummary(doc, quote, y, onNewPage) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - PAGE_MARGIN * 2;
  const rows = buildTotalsRows(quote);
  const totalsHeight = rows.length * TOTALS_ROW_HEIGHT;
  const totalsX = pageWidth - PAGE_MARGIN - TOTALS_WIDTH;
  const terms = buildQuoteTerms(quote.condiciones);

  if (terms.length === 0) {
    const cursor = ensureSpace(doc, y, totalsHeight + 4, onNewPage);
    drawTotalsBox(doc, rows, totalsX, cursor);
    return cursor + totalsHeight + 8;
  }

  const termsWidth = contentWidth - TOTALS_WIDTH - TERMS_GAP;
  const layout = layoutTerms(doc, terms, termsWidth);
  const termsHeight = termsBoxHeight(layout);
  if (termsHeight <= PAGE_BOTTOM - 41) {
    const cursor = ensureSpace(doc, y, Math.max(termsHeight, totalsHeight) + 4, onNewPage);
    drawTermsBox(doc, layout, PAGE_MARGIN, cursor, termsWidth);
    drawTotalsBox(doc, rows, totalsX, cursor);
    return cursor + Math.max(termsHeight, totalsHeight) + 8;
  }

  let cursor = ensureSpace(doc, y, totalsHeight + 4, onNewPage);
  drawTotalsBox(doc, rows, totalsX, cursor);
  cursor += totalsHeight + 8;
  cursor = ensureSpace(doc, cursor, 20, onNewPage);
  cursor = drawBand(doc, "Términos y condiciones", PAGE_MARGIN, cursor, contentWidth) + 5;
  terms.forEach((term, index) => {
    cursor = drawWrappedParagraph(doc, `${index + 1}. ${term}`, cursor, onNewPage);
  });
  return cursor + 4;
}

function drawAcceptance(doc, quote, y, onNewPage) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - PAGE_MARGIN * 2;
  let cursor = ensureSpace(doc, y, 32, onNewPage);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.4);
  doc.setTextColor(...INK);
  const lines = doc.splitTextToSize(buildQuoteAcceptanceLine(quote.aceptacion), contentWidth);
  doc.text(lines, pageWidth / 2, cursor, { align: "center" });
  cursor += lines.length * 4.3 + 14;
  const labels = ["Nombre", getDefaultFiscalIdentifierLabel(quote.paisCodigo), "Fecha", "Firma"];
  const gap = 8;
  const fieldWidth = (contentWidth - gap * (labels.length - 1)) / labels.length;
  labels.forEach((label, index) => {
    const x = PAGE_MARGIN + index * (fieldWidth + gap);
    doc.setDrawColor(...MUTED);
    doc.setLineWidth(0.25);
    doc.line(x, cursor, x + fieldWidth, cursor);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.1);
    doc.setTextColor(...MUTED);
    doc.text(label, x, cursor + 4);
  });
  return cursor + 10;
}

// Pie centrado en cada página: invitación a contactar y contacto (solo si la
// empresa tiene datos de contacto), agradecimiento y número de página.
function drawFooter(doc, quote, company) {
  const pages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const brand = company.nombreComercial || company.razonSocial || "ValoraCloud";
  const contact = buildQuoteFooterContact(company);
  const lines = [
    ...(contact ? [[QUOTE_FOOTER_QUESTION, "normal"], [contact, "bold"]] : []),
    [QUOTE_FOOTER_THANKS, "bold"],
  ];
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.3);
    doc.line(PAGE_MARGIN, 281, pageWidth - PAGE_MARGIN, 281);
    doc.setFontSize(6.9);
    doc.setTextColor(...MUTED);
    lines.forEach(([text, weight], index) => {
      doc.setFont("helvetica", weight);
      doc.text(text, pageWidth / 2, 285 + index * 3.5, { align: "center", maxWidth: 150 });
    });
    doc.setFont("helvetica", "normal");
    doc.text(`Página ${page} de ${pages}`, pageWidth - PAGE_MARGIN, 292.5, { align: "right" });
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
  const drawPageHeader = () => drawCompactHeader(doc, quote, company, logoDataUrl);
  let y = drawHeader(doc, quote, company, logoDataUrl) + 3;
  y = drawClientBlock(doc, quote, y);

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
      fillColor: NAVY,
      fontStyle: "bold",
      fontSize: 6.8,
      textColor: WHITE,
    },
    columnStyles: table.columnStyles,
    willDrawPage: (data) => {
      if (data.pageNumber > 1) drawPageHeader();
    },
  });

  y = (doc.lastAutoTable?.finalY || y) + 7;
  const onNewPage = () => drawPageHeader();

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

  y = drawSummary(doc, quote, y, onNewPage);

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

  if (quote.aceptacion?.habilitada) {
    y = drawAcceptance(doc, quote, y, onNewPage);
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
