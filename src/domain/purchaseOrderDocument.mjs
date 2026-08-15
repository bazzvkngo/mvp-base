import {jsPDF} from "jspdf";
import {autoTable} from "jspdf-autotable";
import {adaptStoredPurchaseOrder} from "./purchaseOrderModel.mjs";

const NAVY = [7, 40, 93];
const RED = [210, 36, 48];
const INK = [20, 31, 50];
const MUTED = [79, 93, 117];
const LIGHT = [244, 247, 251];
const BORDER = [211, 220, 233];
const MARGIN = 14;

const hasText = (value) => Boolean(String(value ?? "").trim());
const join = (values) => values.filter(hasText).join(" · ");
const money = (value) => new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
}).format(Number(value) || 0);
const statusLabel = (value) => ({borrador: "Pendiente", emitida: "Emitida", cancelada: "Cancelada"})[value] || "Pendiente";
const paymentLabel = (value) => ({contado: "Contado", transferencia: "Transferencia", credito: "Crédito", otro: "Otro"})[value] || value;

export function getPurchaseOrderPdfFileName(order) {
  const number = String(order?.numero || "Orden-de-compra")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `${number || "Orden-de-compra"}.pdf`;
}

function drawHeader(doc, order, company, logoDataUrl = "", compact = false) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const top = compact ? 10 : 13;
  let textX = MARGIN;
  if (hasText(logoDataUrl)) {
    try {
      const format = /^data:image\/jpe?g/i.test(logoDataUrl) ? "JPEG" : "PNG";
      doc.addImage(logoDataUrl, format, MARGIN, top, 31, 17, undefined, "FAST");
      textX += 36;
    } catch {
      textX = MARGIN;
    }
  }
  const brand = company.nombreComercial || company.razonSocial || "Empresa compradora";
  doc.setTextColor(...NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(compact ? 12 : 17);
  doc.text(brand, textX, top + 5, {maxWidth: 102});
  if (!compact) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    [
      company.razonSocial !== brand ? company.razonSocial : "",
      join([company.rut ? `RUT ${company.rut}` : "", company.giro]),
      join([company.direccion, company.comunaNombre || company.comuna, company.regionNombre || company.region]),
      join([company.email, company.telefono]),
    ].filter(hasText).forEach((line, index) => doc.text(line, textX, top + 11 + index * 4, {maxWidth: 108}));
  }
  const right = pageWidth - MARGIN;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...INK);
  doc.setFontSize(compact ? 10 : 15);
  doc.text("ORDEN DE COMPRA", right, top + 4, {align: "right"});
  doc.setTextColor(...RED);
  doc.setFontSize(compact ? 9 : 11);
  doc.text(order.numero || "OC por asignar", right, top + 11, {align: "right"});
  if (!compact) {
    doc.setTextColor(...NAVY);
    doc.setFontSize(8);
    doc.text(statusLabel(order.estado), right, top + 18, {align: "right"});
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "normal");
    doc.text(`Fecha ${order.fechaEmision || "-"}`, right, top + 24, {align: "right"});
  }
  const y = compact ? 36 : 50;
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.8);
  doc.line(MARGIN, y, right, y);
  doc.setDrawColor(...RED);
  doc.setLineWidth(1.8);
  doc.line(MARGIN, y, MARGIN + 22, y);
  return y;
}

function drawProvider(doc, order, y) {
  const provider = order.proveedorSnapshot || {};
  const width = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const height = 34;
  doc.setFillColor(...LIGHT);
  doc.setDrawColor(...BORDER);
  doc.roundedRect(MARGIN, y, width, height, 1.5, 1.5, "FD");
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.setFontSize(8);
  doc.text("PROVEEDOR", MARGIN + 4, y + 6);
  doc.text("ENTREGA Y CONDICIONES", MARGIN + width / 2 + 4, y + 6);
  doc.setDrawColor(...BORDER);
  doc.line(MARGIN + width / 2, y + 4, MARGIN + width / 2, y + height - 4);
  const left = [
    provider.razonSocial,
    provider.rut ? `RUT ${provider.rut}` : "",
    join([provider.personaContacto, provider.email, provider.telefono]),
    join([provider.direccion, provider.comunaNombre, provider.regionNombre]),
  ].filter(hasText);
  const right = [
    order.fechaEntregaEstimada ? `Entrega estimada: ${order.fechaEntregaEstimada}` : "Entrega estimada: no informada",
    order.direccionEntrega ? `Dirección: ${order.direccionEntrega}` : "Dirección: no informada",
    order.condicionesPago ? `Pago: ${paymentLabel(order.condicionesPago)}` : "Pago: no informado",
    "Moneda: CLP",
  ];
  doc.setTextColor(...INK);
  doc.setFontSize(7.6);
  left.forEach((line, index) => {
    doc.setFont("helvetica", index === 0 ? "bold" : "normal");
    doc.text(line, MARGIN + 4, y + 12 + index * 4.3, {maxWidth: width / 2 - 9});
  });
  doc.setFont("helvetica", "normal");
  right.forEach((line, index) => doc.text(line, MARGIN + width / 2 + 4, y + 12 + index * 4.3, {maxWidth: width / 2 - 9}));
  return y + height + 7;
}

function drawTotals(doc, order, y) {
  const rows = [
    ["Subtotal", money(order.subtotal)],
    ["Descuentos", Number(order.descuentoTotal) > 0 ? `-${money(order.descuentoTotal)}` : money(0)],
    ["Neto", money(order.neto)],
    ["IVA 19%", money(order.iva)],
    ["TOTAL", money(order.total)],
  ];
  const width = 76;
  const height = 43;
  const x = doc.internal.pageSize.getWidth() - MARGIN - width;
  if (y + height > 276) {
    doc.addPage();
    y = 44;
  }
  doc.setFillColor(...LIGHT);
  doc.setDrawColor(...BORDER);
  doc.roundedRect(x, y, width, height, 1.5, 1.5, "FD");
  rows.forEach(([label, value], index) => {
    const total = index === rows.length - 1;
    const rowY = y + 7 + index * 7.5;
    if (total) {
      doc.setFillColor(...NAVY);
      doc.rect(x, rowY - 5.5, width, 8, "F");
      doc.setTextColor(255, 255, 255);
    } else {
      doc.setTextColor(...INK);
    }
    doc.setFont("helvetica", total ? "bold" : "normal");
    doc.setFontSize(total ? 9.5 : 8.3);
    doc.text(label, x + 4, rowY);
    doc.text(value, x + width - 4, rowY, {align: "right"});
  });
  return y + height + 8;
}

function drawNotes(doc, order, y) {
  const entries = [
    ["Condiciones", paymentLabel(order.condicionesPago)],
    ["Observaciones", order.observaciones],
  ].filter(([, value]) => hasText(value));
  entries.forEach(([label, value]) => {
    const lines = doc.splitTextToSize(String(value), 178);
    if (y + 11 + lines.length * 4 > 278) {
      doc.addPage();
      y = 44;
    }
    doc.setTextColor(...NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text(label.toUpperCase(), MARGIN, y);
    doc.setTextColor(...INK);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(lines, MARGIN, y + 5);
    y += 10 + lines.length * 4;
  });
}

function drawFooter(doc, company) {
  const pages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const brand = company.nombreComercial || company.razonSocial || "Empresa compradora";
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...BORDER);
    doc.line(MARGIN, 284, pageWidth - MARGIN, 284);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.setTextColor(...MUTED);
    doc.text(join([company.email, company.telefono]) || brand, MARGIN, 289, {maxWidth: 75});
    doc.text(`${brand} · ValoraCloud`, pageWidth / 2, 289, {align: "center"});
    doc.text(`Página ${page} de ${pages}`, pageWidth - MARGIN, 289, {align: "right"});
  }
}

export function buildPurchaseOrderPdfDocument({order: rawOrder, companyProfile = {}, logoDataUrl = ""}) {
  const order = adaptStoredPurchaseOrder(rawOrder || {});
  const company = companyProfile || {};
  const doc = new jsPDF({unit: "mm", format: "a4", orientation: "portrait"});
  let y = drawHeader(doc, order, company, logoDataUrl) + 7;
  y = drawProvider(doc, order, y);
  autoTable(doc, {
    startY: y,
    margin: {left: MARGIN, right: MARGIN, top: 42, bottom: 20},
    head: [["Código", "Producto, servicio o actividad", "Cant.", "Costo unitario", "Desc.", "Total"]],
    body: order.items.map((item) => [
      item.codigo || "-",
      `${item.nombre}${item.descripcion ? `\n${item.descripcion}` : ""}`,
      `${item.cantidad} ${item.unidad || ""}`,
      money(item.costoUnitario),
      item.descuentoPct ? `${item.descuentoPct}%` : "-",
      money(item.totalLinea),
    ]),
    theme: "grid",
    showHead: "everyPage",
    rowPageBreak: "avoid",
    styles: {cellPadding: 2.2, font: "helvetica", fontSize: 7.4, lineColor: BORDER, lineWidth: 0.25, overflow: "linebreak", textColor: INK, valign: "top"},
    headStyles: {fillColor: NAVY, fontStyle: "bold", fontSize: 7.1, textColor: 255},
    alternateRowStyles: {fillColor: LIGHT},
    columnStyles: {0: {cellWidth: 19}, 1: {cellWidth: "auto"}, 2: {cellWidth: 22, halign: "right"}, 3: {cellWidth: 27, halign: "right"}, 4: {cellWidth: 15, halign: "right"}, 5: {cellWidth: 27, halign: "right"}},
    willDrawPage: (data) => {
      if (data.pageNumber > 1) drawHeader(doc, order, company, logoDataUrl, true);
    },
  });
  y = (doc.lastAutoTable?.finalY || y) + 7;
  y = drawTotals(doc, order, y);
  drawNotes(doc, order, y);
  drawFooter(doc, company);
  doc.setProperties({title: `Orden de compra ${order.numero}`, subject: order.proveedorSnapshot?.razonSocial || "Orden de compra", author: company.nombreComercial || company.razonSocial || "ValoraCloud", creator: "ValoraCloud"});
  return {doc, fileName: getPurchaseOrderPdfFileName(order), order};
}

export function buildPurchaseOrderPdfBase64(options) {
  const result = buildPurchaseOrderPdfDocument(options);
  return {
    fileName: result.fileName,
    contentType: "application/pdf",
    contentBase64: result.doc.output("datauristring").split(",")[1] || "",
  };
}
