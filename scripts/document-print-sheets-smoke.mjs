import assert from "node:assert/strict";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";
import {
  DOCUMENT_NET_SUBTOTAL_LABEL,
  buildDocumentFooterParts,
  buildNetTotalsRows,
  getLegalNameBelowTitle,
} from "../src/domain/documentPrintLayout.mjs";
import {buildPurchaseOrderPdfDocument} from "../src/domain/purchaseOrderDocument.mjs";
import {buildQuotePdfDocument} from "../src/domain/quoteDocument.mjs";
import {formatMoney} from "../src/utils/formatters.js";

// Hojas imprimibles de Venta, Compra, Orden de compra y Cotización (vista previa e impresión).
// Fija solo presentación:
//  - el nombre de la empresa aparece una sola vez en el pie;
//  - la razón social bajo el título solo si es distinta del título (sin diferenciar mayúsculas ni espacios);
//  - sin descuentos hay una sola fila "Subtotal (neto)" y ninguna fila "Neto"; con descuentos se mantienen
//    Subtotal, Descuentos y Neto. IVA y Total no cambian.
// Se comprueba en BOB (es-BO) y en CLP (es-CL).

// --- Helper puro ---
assert.equal(getLegalNameBelowTitle({razonSocial: "QA Taller Bolivia S.R.L."}, "QA Taller Bolivia S.R.L."), "");
assert.equal(getLegalNameBelowTitle({razonSocial: "qa  taller bolivia s.r.l."}, " QA Taller Bolivia S.R.L. "), "", "sin diferenciar mayúsculas ni espacios");
assert.equal(getLegalNameBelowTitle({razonSocial: "QA Taller Bolivia Spa"}, "QA Taller Bolivia S.R.L."), "QA Taller Bolivia Spa");
assert.equal(getLegalNameBelowTitle({}, "Marca"), "");
assert.deepEqual(buildDocumentFooterParts({}, "Marca"), {left: "Marca", right: "ValoraCloud"});
assert.deepEqual(buildDocumentFooterParts({telefono: "700", email: "a@b.bo"}, "Marca"), {left: "700 · a@b.bo", right: "Marca · ValoraCloud"});
assert.deepEqual(buildDocumentFooterParts({telefono: "700"}, "ValoraCloud"), {left: "700", right: "ValoraCloud"});
assert.deepEqual(buildNetTotalsRows({subtotal: 100, descuentoTotal: 0, neto: 100}).map((row) => row.label), [DOCUMENT_NET_SUBTOTAL_LABEL]);
assert.deepEqual(buildNetTotalsRows({subtotal: 100, descuentoTotal: 10, neto: 90}).map((row) => row.label), ["Subtotal", "Descuentos", "Neto"]);
assert.deepEqual(buildNetTotalsRows({subtotal: 100, descuentoTotal: 10, neto: 90, discountLabel: "Descuento"}).map((row) => row.label), ["Subtotal", "Descuento", "Neto"]);
assert.deepEqual(buildNetTotalsRows({subtotal: 100, descuentoTotal: 0, neto: 90}).map((row) => row.label), ["Subtotal", "Neto"], "dato inconsistente: no se oculta ninguna cifra");

// --- Render real de las cuatro hojas ---
const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
let SalePrintView; let PurchasePrintView; let PurchaseOrderPrintView; let QuotePrintView;
try {
  SalePrintView = (await vite.ssrLoadModule("/src/features/sales/SalePrintView.jsx")).default;
  PurchasePrintView = (await vite.ssrLoadModule("/src/features/purchases/PurchasePrintView.jsx")).default;
  PurchaseOrderPrintView = (await vite.ssrLoadModule("/src/features/purchaseOrders/PurchaseOrderPrintView.jsx")).default;
  QuotePrintView = (await vite.ssrLoadModule("/src/features/quotes/QuotePrintView.jsx")).default;
} finally {
  await vite.close();
}

const BRAND = "QA Taller Bolivia S.R.L.";
const CURRENCIES = [
  {moneda: "BOB", locale: "es-BO", paisCodigo: "BO", unit: 1000.5, rate: 0.13, taxName: "IVA"},
  {moneda: "CLP", locale: "es-CL", paisCodigo: "CL", unit: 1000, rate: 0.19, taxName: "IVA"},
];
const round = (value) => Math.round(value * 100) / 100;

// Montos coherentes: 2 unidades al precio base; con descuento, 10 % de la línea.
const amounts = (currency, withDiscount) => {
  const subtotal = round(currency.unit * 2);
  const descuentoTotal = withDiscount ? round(subtotal * 0.1) : 0;
  const neto = round(subtotal - descuentoTotal);
  const iva = round(neto * currency.rate);
  return {subtotal, descuentoTotal, neto, iva, total: round(neto + iva), descuentoPct: withDiscount ? 10 : 0};
};

const company = (overrides = {}) => ({
  nombreComercial: BRAND,
  razonSocial: "QA Taller Bolivia Spa",
  identificadorFiscalTipo: "NIT",
  identificadorFiscalValor: "1023456789",
  ...overrides,
});

const fixtures = {
  venta: (currency, withDiscount, empresa) => {
    const a = amounts(currency, withDiscount);
    return {
      moneda: currency.moneda, locale: currency.locale, paisCodigo: currency.paisCodigo, empresaSnapshot: empresa,
      numero: "V-000001", estado: "borrador", afectaIva: true, tasaIva: currency.rate, impuestoNombre: currency.taxName,
      clienteSnapshot: {nombreRazonSocial: "Cliente Prueba"},
      items: [{lineaId: "l1", nombre: "Servicio", cantidad: 2, precioUnitario: currency.unit, descuentoPct: a.descuentoPct, totalLinea: round(a.subtotal - a.descuentoTotal)}],
      subtotal: a.subtotal, descuentoTotal: a.descuentoTotal, neto: a.neto, iva: a.iva, total: a.total,
    };
  },
  compra: (currency, withDiscount, empresa) => {
    const a = amounts(currency, withDiscount);
    return {
      moneda: currency.moneda, locale: currency.locale, paisCodigo: currency.paisCodigo, empresaSnapshot: empresa,
      numero: "C-000001", estado: "borrador", tipoDocumento: "sin_documento", tasaIva: currency.rate, impuestoNombre: currency.taxName,
      proveedorSnapshot: {razonSocial: "Proveedor Prueba"},
      items: [{lineaId: "l1", nombre: "Insumo", cantidad: 2, costoUnitario: currency.unit, descuentoPct: a.descuentoPct, totalLinea: round(a.subtotal - a.descuentoTotal)}],
      subtotal: a.subtotal, descuentoTotal: a.descuentoTotal, neto: a.neto, iva: a.iva, total: a.total,
    };
  },
  ordenCompra: (currency, withDiscount, empresa) => {
    const a = amounts(currency, withDiscount);
    return {
      moneda: currency.moneda, locale: currency.locale, paisCodigo: currency.paisCodigo, empresaSnapshot: empresa,
      numero: "OC-000001", estado: "borrador", tasaIva: currency.rate, impuestoNombre: currency.taxName,
      proveedorSnapshot: {razonSocial: "Proveedor Prueba"},
      items: [{lineaId: "l1", nombre: "Insumo", cantidad: 2, costoUnitario: currency.unit, descuentoPct: a.descuentoPct, totalLinea: round(a.subtotal - a.descuentoTotal)}],
      subtotal: a.subtotal, descuentoTotal: a.descuentoTotal, neto: a.neto, iva: a.iva, total: a.total,
    };
  },
  cotizacion: (currency, withDiscount, empresa) => {
    const a = amounts(currency, withDiscount);
    return {
      moneda: currency.moneda, locale: currency.locale, paisCodigo: currency.paisCodigo, empresaSnapshot: empresa,
      numero: "COT-000001", estado: "borrador", afectaIva: true, tasaIva: currency.rate, impuestoNombre: currency.taxName,
      cliente: {nombre: "Cliente Prueba"},
      items: [{lineaId: "l1", nombre: "Servicio", cantidad: 2, precioUnitario: currency.unit, descuentoPorcentaje: a.descuentoPct, tipo: "servicio"}],
      subtotal: a.subtotal, descuentoItems: a.descuentoTotal, descuento: 0, descuentoTotal: a.descuentoTotal, neto: a.neto, iva: a.iva, total: a.total,
    };
  },
};

const sheets = {
  venta: (doc, empresa) => React.createElement(SalePrintView, {sale: doc, company: empresa}),
  compra: (doc, empresa) => React.createElement(PurchasePrintView, {purchase: doc, company: empresa}),
  ordenCompra: (doc, empresa) => React.createElement(PurchaseOrderPrintView, {order: doc, company: empresa}),
  cotizacion: (doc, empresa) => React.createElement(QuotePrintView, {quote: doc, companyProfile: empresa}),
};

const render = (sheet, currency, withDiscount, empresa) =>
  renderToStaticMarkup(sheets[sheet](fixtures[sheet](currency, withDiscount, empresa), empresa));
const footerOf = (markup) => markup.match(/<footer>([\s\S]*?)<\/footer>/)?.[1] ?? "";
const occurrences = (text, needle) => text.split(needle).length - 1;
const textOf = (markup) => markup.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");
// Solo el bloque de totales: arranca en la primera fila de Subtotal y excluye el título del documento.
const rowLabels = (markup) => {
  const rows = [...markup.matchAll(/<div[^>]*><span>([^<]+)<\/span><strong>([^<]+)<\/strong><\/div>/g)].map(([, label, value]) => [label, value]);
  return rows.slice(rows.findIndex(([label]) => /^Subtotal/.test(label)));
};

for (const sheet of Object.keys(sheets)) {
  for (const currency of CURRENCIES) {
    const where = `${sheet} ${currency.moneda}`;
    const money = (value) => formatMoney(value, currency.moneda, currency.locale);

    // Totales sin descuentos: una sola fila "Subtotal (neto)", sin fila "Neto" ni "Descuentos".
    const plain = amounts(currency, false);
    const noDiscount = render(sheet, currency, false, company());
    const plainRows = rowLabels(noDiscount).map(([label]) => label);
    assert.ok(plainRows.includes(DOCUMENT_NET_SUBTOTAL_LABEL), `${where}: fila Subtotal (neto)`);
    assert.ok(!plainRows.includes("Neto"), `${where}: sin fila Neto cuando no hay descuento`);
    assert.ok(!plainRows.includes("Subtotal"), `${where}: sin fila Subtotal aparte cuando no hay descuento`);
    assert.ok(!plainRows.some((label) => /^Descuentos?$/.test(label)), `${where}: sin fila de descuentos cuando no hay descuento`);
    assert.deepEqual(rowLabels(noDiscount).find(([label]) => label === DOCUMENT_NET_SUBTOTAL_LABEL)?.[1], money(plain.neto), `${where}: monto de Subtotal (neto)`);
    assert.equal(plainRows.filter((label) => new RegExp(`^${currency.taxName} `).test(label)).length, 1, `${where}: una fila de impuesto`);
    assert.deepEqual(rowLabels(noDiscount).find(([label]) => /^IVA /.test(label))?.[1], money(plain.iva), `${where}: monto de IVA`);
    assert.deepEqual(rowLabels(noDiscount).find(([label]) => label === "Total")?.[1], money(plain.total), `${where}: monto de Total`);

    // Totales con descuentos: Subtotal, Descuentos y Neto como siempre.
    const discounted = amounts(currency, true);
    const withDiscount = render(sheet, currency, true, company());
    const discountRows = rowLabels(withDiscount);
    const labels = discountRows.map(([label]) => label);
    const discountLabel = sheet === "cotizacion" ? "Descuento" : "Descuentos";
    assert.ok(!labels.includes(DOCUMENT_NET_SUBTOTAL_LABEL), `${where}: con descuento no hay Subtotal (neto)`);
    assert.deepEqual(labels.slice(0, 3), ["Subtotal", discountLabel, "Neto"], `${where}: Subtotal, Descuentos y Neto con descuento`);
    assert.equal(discountRows[0][1], money(discounted.subtotal), `${where}: monto de Subtotal`);
    assert.equal(discountRows[1][1], `-${money(discounted.descuentoTotal)}`, `${where}: monto de descuentos`);
    assert.equal(discountRows[2][1], money(discounted.neto), `${where}: monto de Neto`);
    assert.equal(discountRows.find(([label]) => label === "Total")?.[1], money(discounted.total), `${where}: monto de Total con descuento`);

    // Razón social: solo si es distinta del título (sin diferenciar mayúsculas ni espacios).
    const distinct = render(sheet, currency, false, company());
    assert.ok(textOf(distinct.split("<footer")[0]).includes("|QA Taller Bolivia Spa|"), `${where}: razón social distinta se muestra bajo el título`);
    for (const legalName of [BRAND, BRAND.toUpperCase(), `  ${BRAND.replace(/ /g, "   ")} `]) {
      const same = render(sheet, currency, false, company({razonSocial: legalName}));
      const lines = textOf(same.split("<footer")[0]).split("|").map((line) => line.trim().toLowerCase().replace(/\s+/g, " "));
      assert.equal(lines.filter((line) => line === BRAND.toLowerCase()).length, 1, `${where}: razón social igual al título no se repite ("${legalName.trim()}")`);
    }

    // Pie (la cotización tiene su propio pie, sin nombre de empresa: no se toca).
    if (sheet !== "cotizacion") {
      const noContact = footerOf(render(sheet, currency, false, company()));
      assert.equal(occurrences(noContact, BRAND), 1, `${where}: nombre de la empresa una sola vez en el pie`);
      assert.match(noContact, new RegExp(`<span>${BRAND.replace(/\./g, "\\.")}</span><span>ValoraCloud</span>`), `${where}: nombre a la izquierda y solo ValoraCloud a la derecha`);
      const withContact = footerOf(render(sheet, currency, false, company({telefono: "70012345", email: "contacto@qa.bo"})));
      assert.equal(occurrences(withContact, BRAND), 1, `${where}: con contacto, el nombre sigue una sola vez en el pie`);
      assert.match(withContact, /<span>70012345 · contacto@qa\.bo<\/span>/, `${where}: contacto a la izquierda`);
      assert.ok(withContact.endsWith(`${BRAND} · ValoraCloud</span>`), `${where}: nombre y ValoraCloud a la derecha`);
    }
  }
}

// --- PDF de la orden de compra: mismas reglas de razón social y totales ---
const pdfTexts = (build) => [...build().doc.output().matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)]
  .map(([, text]) => text.replace(/\\(\d{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8))).replace(/\\([()\\])/g, "$1"));
for (const currency of CURRENCIES) {
  const orderPdf = (withDiscount, empresa = company()) => pdfTexts(() => buildPurchaseOrderPdfDocument({order: fixtures.ordenCompra(currency, withDiscount, empresa)}));
  const plain = orderPdf(false);
  assert.ok(plain.includes(DOCUMENT_NET_SUBTOTAL_LABEL), `PDF orden de compra ${currency.moneda}: Subtotal (neto)`);
  assert.ok(!plain.includes("Neto") && !plain.includes("Subtotal"), `PDF orden de compra ${currency.moneda}: sin fila Neto ni Subtotal aparte`);
  assert.ok(plain.includes("QA Taller Bolivia Spa"), `PDF orden de compra ${currency.moneda}: razón social distinta`);
  const withDiscount = orderPdf(true);
  assert.ok(["Subtotal", "Descuentos", "Neto"].every((label) => withDiscount.includes(label)), `PDF orden de compra ${currency.moneda}: Subtotal, Descuentos y Neto con descuento`);
  assert.ok(!withDiscount.includes(DOCUMENT_NET_SUBTOTAL_LABEL));
  assert.ok(!orderPdf(false, company({razonSocial: BRAND.toUpperCase()})).includes(BRAND.toUpperCase()), `PDF orden de compra ${currency.moneda}: razón social igual no se repite`);
}

// --- El PDF de la cotización es el adjunto del correo: no cambia con esta tarea ---
const quotePdf = pdfTexts(() => buildQuotePdfDocument({quote: fixtures.cotizacion(CURRENCIES[0], false, company())}));
assert.ok(quotePdf.includes("Subtotal") && quotePdf.includes("Neto"), "el PDF adjunto de la cotización conserva Subtotal y Neto");
assert.ok(!quotePdf.includes(DOCUMENT_NET_SUBTOTAL_LABEL), "el PDF adjunto de la cotización no usa Subtotal (neto)");

console.log("document-print-sheets-smoke OK");
