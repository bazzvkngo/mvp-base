import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { adaptStoredPurchaseOrder } from "./purchaseOrderModel.mjs";
import { resolveDocumentCompany } from "./companySnapshot.mjs";
import { formatMoney } from "../utils/formatters.js";

const NAVY = [18, 55, 101];
const RED = [181, 34, 45];
const INK = [24, 35, 53];
const MUTED = [95, 107, 124];
const BORDER = [216, 222, 232];
const MARGIN = 16;
const PAGE_BOTTOM = 278;

function hasText(value) {
  return Boolean(String(value ?? "").trim());
}

function joinNonEmpty(values, separator = " · ") {
  return values.filter(hasText).join(separator);
}

function money(value, order) {
  return formatMoney(value, order?.moneda, order?.locale);
}

function formatDate(value) {
  const text = String(value || "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? text || "-" : date.toLocaleDateString("es-CL");
}

function statusLabel(value) {
  return ({
    borrador: "Pendiente",
    emitida: "Emitida",
    cancelada: "Cancelada",
  })[value] || "Pendiente";
}

function paymentLabel(value) {
  return ({
    contado: "Contado",
    transferencia: "Transferencia",
    credito: "Crédito",
    otro: "Otro",
  })[value] || value;
}

function taxLabel(order) {
  const rate = new Intl.NumberFormat(order.locale || "es-CL", {
    maximumFractionDigits: 2,
  }).format(Number(order.tasaIva || 0) * 100);
  return `${order.impuestoNombre || "Impuesto"} ${rate}%`;
}

export function getPurchaseOrderPdfFileName(order) {
  const number = String(order?.numero || "Orden-de-compra")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `${number || "Orden-de-compra"}.pdf`;
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

function drawHeader(doc, order, company, logoDataUrl = "", { compact = false } = {}) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const top = compact ? 10 : 13;
  const bottom = compact ? 34 : 57;
  const brand = company.nombreComercial || company.razonSocial || "Empresa compradora";
  let textX = MARGIN;

  if (hasText(logoDataUrl)) {
    try {
      const format = /^data:image\/jpe?g/i.test(logoDataUrl) ? "JPEG" : "PNG";
      const size = fitLogoSize(doc, logoDataUrl, compact ? 26 : 34, compact ? 13 : 21);
      doc.addImage(logoDataUrl, format, MARGIN, top, size.width, size.height, undefined, "FAST");
      textX += size.width + 5;
    } catch {
      textX = MARGIN;
    }
  }

  const rightColumnStart = pageWidth - MARGIN - (compact ? 61 : 66);
  doc.setTextColor(...NAVY);
  doc.setFont("helvetica", "bold");
  setFittedFontSize(doc, brand, compact ? 12 : 17, compact ? 9 : 11, rightColumnStart - textX - 5);
  doc.text(brand, textX, top + 5);

  if (!compact) {
    const fiscal = company.identificadorFiscalValor || company.rut;
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    [
      company.razonSocial !== brand ? company.razonSocial : "",
      joinNonEmpty([
        fiscal ? `${company.identificadorFiscalTipo || "Identificación fiscal"} ${fiscal}` : "",
        company.giro ? `Giro: ${company.giro}` : "",
      ]),
      joinNonEmpty([
        company.direccion,
        company.comunaNombre || company.ciudad,
        company.regionNombre || company.region,
      ]),
      joinNonEmpty([company.email, company.telefono]),
    ].filter(hasText).slice(0, 4).forEach((line, index) => {
      doc.text(String(line), textX, top + 11 + index * 4.2, { maxWidth: 110 });
    });
  }

  const right = pageWidth - MARGIN;
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(compact ? 9.5 : 11);
  doc.text("ORDEN DE COMPRA", right, top + 3, { align: "right" });
  doc.setTextColor(...RED);
  doc.setFontSize(compact ? 9 : 13);
  doc.text(order.numero || "OC por asignar", right, top + (compact ? 9 : 10), { align: "right" });

  if (!compact) {
    [
      ["Fecha de emisión", order.fechaEmision ? formatDate(order.fechaEmision) : "-"],
      ["Estado", statusLabel(order.estado)],
      ["Moneda", order.moneda || "CLP"],
    ].forEach(([label, value], index) => {
      const rowY = top + 18 + index * 5;
      doc.setTextColor(...MUTED);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.3);
      doc.text(label, right - 32, rowY, { align: "right" });
      doc.setTextColor(...INK);
      doc.setFont("helvetica", "bold");
      doc.text(String(value), right, rowY, { align: "right", maxWidth: 31 });
    });
  }

  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.65);
  doc.line(MARGIN, bottom, right, bottom);
  doc.setDrawColor(...RED);
  doc.setLineWidth(1.35);
  doc.line(MARGIN, bottom, MARGIN + 19, bottom);
  return bottom;
}

function drawSectionHeading(doc, title, y, x = MARGIN, width = null) {
  const lineWidth = width || doc.internal.pageSize.getWidth() - MARGIN * 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.2);
  doc.setTextColor(...NAVY);
  doc.text(String(title).toUpperCase(), x, y);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.35);
  doc.line(x, y + 2.3, x + lineWidth, y + 2.3);
  return y + 7;
}

function drawDetailLine(doc, { label = "", value = "", x, y, width, bold = false }) {
  if (!hasText(value)) return y;
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(bold ? 9.2 : 8.1);
  doc.setTextColor(...(bold ? INK : MUTED));
  const content = label ? `${label}: ${value}` : String(value);
  const lines = doc.splitTextToSize(content, width);
  doc.text(lines, x, y);
  return y + Math.max(4.3, lines.length * 4.1);
}

function drawProvider(doc, order, y) {
  const provider = order.proveedorSnapshot || {};
  const contentWidth = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const columnWidth = (contentWidth - 10) / 2;
  let cursor = drawSectionHeading(doc, "Proveedor", y);
  let leftY = cursor;
  let rightY = cursor;
  leftY = drawDetailLine(doc, { value: provider.razonSocial || "Proveedor no seleccionado", x: MARGIN, y: leftY, width: columnWidth, bold: true });
  leftY = drawDetailLine(doc, {
    label: provider.identificadorFiscalTipo || "Identificación fiscal",
    value: provider.identificadorFiscalValor || provider.rut,
    x: MARGIN,
    y: leftY,
    width: columnWidth,
  });
  leftY = drawDetailLine(doc, { label: "Contacto", value: provider.personaContacto, x: MARGIN, y: leftY, width: columnWidth });
  rightY = drawDetailLine(doc, { value: joinNonEmpty([provider.email, provider.telefono]), x: MARGIN + columnWidth + 10, y: rightY, width: columnWidth });
  rightY = drawDetailLine(doc, { value: joinNonEmpty([provider.direccion, provider.comunaNombre, provider.regionNombre], ", "), x: MARGIN + columnWidth + 10, y: rightY, width: columnWidth });
  return Math.max(leftY, rightY) + 3;
}

function definitionHeight(doc, entries, width) {
  return entries.reduce((height, [, value]) => {
    const lines = doc.splitTextToSize(String(value), width);
    return height + 4 + Math.max(1, lines.length) * 3.8 + 2;
  }, 0);
}

function drawDefinitions(doc, entries, x, y, width) {
  let cursor = y;
  entries.forEach(([label, value]) => {
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.1);
    doc.text(label, x, cursor);
    cursor += 3.6;
    doc.setTextColor(...INK);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.1);
    const lines = doc.splitTextToSize(String(value), width);
    doc.text(lines, x, cursor);
    cursor += Math.max(1, lines.length) * 3.8 + 2.2;
  });
  return cursor;
}

function drawCommercialDetails(doc, order, y, onNewPage) {
  const provider = order.proveedorSnapshot || {};
  const paymentTerms = order.condicionesPago || provider.condicionesPago;
  const creditDays = Number(provider.diasCredito);
  const delivery = [
    ["Dirección de entrega", order.direccionEntrega],
    ["Fecha o plazo esperado", order.fechaEntregaEstimada ? formatDate(order.fechaEntregaEstimada) : ""],
  ].filter(([, value]) => hasText(value));
  const conditions = [
    ["Condiciones de pago", paymentLabel(paymentTerms)],
    [
      "Plazo de pago",
      creditDays > 0 && !String(paymentTerms || "").includes(String(creditDays))
        ? `${creditDays} días`
        : "",
    ],
    ["Observaciones", order.observaciones],
  ].filter(([, value]) => hasText(value));
  if (delivery.length === 0 && conditions.length === 0) return y;

  const contentWidth = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const gap = delivery.length > 0 && conditions.length > 0 ? 10 : 0;
  const columnWidth = gap ? (contentWidth - gap) / 2 : contentWidth;
  const blockHeight = 10 + Math.max(
    delivery.length ? definitionHeight(doc, delivery, columnWidth) : 0,
    conditions.length ? definitionHeight(doc, conditions, columnWidth) : 0
  );
  let cursor = ensureSpace(doc, y, Math.min(blockHeight, PAGE_BOTTOM - 41), onNewPage);
  const startY = cursor;
  let bottom = cursor;

  if (delivery.length > 0) {
    const width = conditions.length > 0 ? columnWidth : contentWidth;
    const detailsY = drawSectionHeading(doc, "Entrega", startY, MARGIN, width);
    bottom = Math.max(bottom, drawDefinitions(doc, delivery, MARGIN, detailsY, width));
  }
  if (conditions.length > 0) {
    const x = delivery.length > 0 ? MARGIN + columnWidth + gap : MARGIN;
    const width = delivery.length > 0 ? columnWidth : contentWidth;
    const detailsY = drawSectionHeading(doc, "Condiciones", startY, x, width);
    bottom = Math.max(bottom, drawDefinitions(doc, conditions, x, detailsY, width));
  }
  return bottom + 3;
}

function ensureSpace(doc, y, required, onNewPage) {
  if (y + required <= PAGE_BOTTOM) return y;
  doc.addPage();
  onNewPage();
  return 41;
}

function drawTotals(doc, order, y, onNewPage) {
  const rows = [
    ["Subtotal", money(order.subtotal, order)],
    ...(Number(order.descuentoTotal) > 0 ? [["Descuentos", `-${money(order.descuentoTotal, order)}`]] : []),
    ["Neto", money(order.neto, order)],
    [taxLabel(order), money(order.iva, order)],
    ["TOTAL", money(order.total, order)],
  ];
  const width = 76;
  const height = rows.length * 6.7 + 4;
  const cursor = ensureSpace(doc, y, height + 4, onNewPage);
  const x = doc.internal.pageSize.getWidth() - MARGIN - width;

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

function drawFooter(doc, company) {
  const pages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const brand = company.nombreComercial || company.razonSocial || "Empresa compradora";
  const contact = joinNonEmpty([company.responsable, company.telefono, company.email]);
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, 284, pageWidth - MARGIN, 284);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.7);
    doc.setTextColor(...MUTED);
    doc.text(contact || `${brand} · ValoraCloud`, MARGIN, 289, { maxWidth: 128 });
    doc.text(`Página ${page} de ${pages}`, pageWidth - MARGIN, 289, { align: "right" });
  }
}

function buildTableDefinition(order) {
  const showCode = order.items.some((item) => hasText(item.codigo));
  const showUnit = order.items.some((item) => hasText(item.unidad));
  const showDiscount = order.items.some((item) => Number(item.descuentoPct) > 0);
  const columns = [
    ...(showCode ? [{ key: "code", header: "Código", width: 21 }] : []),
    { key: "item", header: "Producto o servicio", width: "auto" },
    ...(showUnit ? [{ key: "unit", header: "Unidad", width: 15 }] : []),
    { key: "quantity", header: "Cantidad", width: 15, numeric: true },
    { key: "cost", header: "Costo unitario", width: 25, numeric: true },
    ...(showDiscount ? [{ key: "discount", header: "Descuento", width: 18, numeric: true }] : []),
    { key: "total", header: "Total", width: 27, numeric: true },
  ];
  const valueFor = (item, key) => ({
    code: item.codigo || "-",
    item: `${item.nombre}${item.descripcion ? `\n${item.descripcion}` : ""}`,
    unit: item.unidad || "-",
    quantity: String(item.cantidad),
    cost: money(item.costoUnitario, order),
    discount: item.descuentoPct ? `${item.descuentoPct}%` : "-",
    total: money(item.totalLinea, order),
  })[key];
  return {
    head: [columns.map((column) => column.header)],
    body: order.items.map((item) => columns.map((column) => valueFor(item, column.key))),
    columnStyles: Object.fromEntries(columns.map((column, index) => [
      index,
      {
        cellWidth: column.width,
        ...(column.numeric ? { halign: "right" } : {}),
      },
    ])),
  };
}

export function buildPurchaseOrderPdfDocument({ order: rawOrder, companyProfile = {}, logoDataUrl = "" }) {
  const order = adaptStoredPurchaseOrder(rawOrder || {});
  const company = resolveDocumentCompany(order, companyProfile);
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const drawCompactHeader = () => drawHeader(doc, order, company, logoDataUrl, { compact: true });
  let y = drawHeader(doc, order, company, logoDataUrl) + 8;
  y = drawProvider(doc, order, y);
  y = drawCommercialDetails(doc, order, y, drawCompactHeader);

  const table = buildTableDefinition(order);
  autoTable(doc, {
    startY: y + 2,
    margin: { left: MARGIN, right: MARGIN, top: 40, bottom: 20 },
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
  drawTotals(doc, order, y, drawCompactHeader);
  drawFooter(doc, company);
  doc.setProperties({
    title: `Orden de compra ${order.numero}`,
    subject: order.proveedorSnapshot?.razonSocial || "Orden de compra",
    author: company.nombreComercial || company.razonSocial || "ValoraCloud",
    creator: "ValoraCloud",
  });
  return { doc, fileName: getPurchaseOrderPdfFileName(order), order };
}

export function buildPurchaseOrderPdfBase64(options) {
  const result = buildPurchaseOrderPdfDocument(options);
  return {
    fileName: result.fileName,
    contentType: "application/pdf",
    contentBase64: result.doc.output("datauristring").split(",")[1] || "",
  };
}
