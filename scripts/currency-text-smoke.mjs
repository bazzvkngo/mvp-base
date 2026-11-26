import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { buildQuoteEmailPreview } from "../src/domain/quoteEmailTemplate.mjs";
import { formatBusinessMoney } from "../src/utils/formatters.js";

// Moneda en textos (acta 7.6.1, opción (a)): los textos que muestran montos usan la moneda de la
// empresa. Esta prueba congela las fórmulas ANTERIORES (fijas en CLP / es-CL) y exige que con CLP el
// resultado sea idéntico, y que con BOB el texto use Bs y no el formato chileno.
const require = createRequire(import.meta.url);
const { formatMoneyText } = require("../functions/localization.js");

// --- Fórmulas anteriores, copiadas tal cual (no tocar: son la referencia de "CLP no cambia") ---
const oldServerFormat = (value) =>
  Number(value || 0).toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
  });
const oldEditorMoney = (value) => `$${Math.round(Number(value || 0)).toLocaleString("es-CL")}`;
const oldCatalogMoney = (value) => `$${Number(value || 0).toLocaleString("es-CL")}`;
const oldApprovalAmount = (value, currency) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency }).format(value);
const oldPriceLabel = (value, currency) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: currency || "CLP", maximumFractionDigits: 0 }).format(value);

const clpValues = [0, 1, 9, 10, 99, 100, 999, 1000, 1234, 12345, 123456, 1190000, 99999999, null, undefined, "", "5000"];

for (const value of clpValues) {
  // Servidor: correo de cotización.
  assert.equal(formatMoneyText(value, "CLP", "es-CL"), oldServerFormat(value), `servidor CLP ${value}`);
  assert.equal(formatMoneyText(value), oldServerFormat(value), `servidor sin moneda ni locale ${value}`);
  assert.equal(formatMoneyText(value, "", ""), oldServerFormat(value), `servidor con textos vacíos ${value}`);
  // Frontend: editores, catálogos y paneles de Taller.
  assert.equal(formatBusinessMoney(value, "CLP", "es-CL"), oldEditorMoney(value), `editor CLP ${value}`);
  assert.equal(formatBusinessMoney(value, "CLP", "es-CL"), oldCatalogMoney(value), `catálogo CLP ${value}`);
  assert.equal(formatBusinessMoney(Number(value || 0), "CLP", "es-CL"), oldApprovalAmount(Number(value || 0), "CLP"), `aprobación CLP ${value}`);
  assert.equal(formatBusinessMoney(Number(value || 0), "CLP", "es-CL"), oldPriceLabel(Number(value || 0), "CLP"), `precio Taller CLP ${value}`);
}
// Redondeo del editor anterior (Math.round) con decimales positivos.
for (const value of [0.4, 0.5, 1.5, 1234.4, 1234.5, 1234.6]) {
  assert.equal(formatBusinessMoney(value, "CLP", "es-CL"), oldEditorMoney(value), `redondeo CLP ${value}`);
}

// --- Bolivia: moneda de la empresa (BOB, es-BO). SPEC 036: el formato muestra siempre los decimales de la
// moneda (`decimals` = 2: "Bs 11,00" y "Bs 10,50"), aunque los montos se sigan calculando enteros mientras
// `amountDecimals` sea 0 (hoy BOB calcula con 2). Sin símbolo chileno. ---
const bob = formatMoneyText(11, "BOB", "es-BO");
assert.match(bob, /^Bs\s?11,00$/);
assert.match(formatMoneyText(1234567, "BOB", "es-BO"), /^Bs\s?1\.234\.567,00$/);
assert.match(formatMoneyText(10.5, "BOB", "es-BO"), /^Bs\s?10,50$/);
assert.match(formatMoneyText(0, "BOB", "es-BO"), /^Bs\s?0,00$/);
assert.match(formatMoneyText(null, "BOB", "es-BO"), /^Bs\s?0,00$/);
for (const value of [0, 0.4, 1, 10.5, 10.555, 1234.5, 99999999.99]) {
  assert.equal(formatBusinessMoney(value, "BOB", "es-BO"), formatMoneyText(value, "BOB", "es-BO"), `BOB ${value}: pantalla = correo`);
  assert.equal(formatBusinessMoney(value, "BOB", "es-BO"), new Intl.NumberFormat("es-BO", { style: "currency", currency: "BOB" }).format(value), `BOB ${value}: igual al formato de moneda de Intl`);
}
// Otras monedas con decimales (USD) y sin ellos (PYG): mínimo = máximo de la moneda. CLP no cambia.
assert.match(formatBusinessMoney(7, "USD", "es-EC"), /7,00/);
assert.match(formatMoneyText(7, "USD", "es-EC"), /7,00/);
assert.equal(formatBusinessMoney(7000, "PYG", "es-PY"), new Intl.NumberFormat("es-PY", { style: "currency", currency: "PYG", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(7000));
assert.equal(formatMoneyText(7000, "PYG", "es-PY"), formatBusinessMoney(7000, "PYG", "es-PY"));
assert.doesNotMatch(formatBusinessMoney(1234.5, "CLP", "es-CL"), /,/, "CLP sin decimales");
assert.doesNotMatch(formatMoneyText(1234.5, "CLP", "es-CL"), /,/, "CLP sin decimales en el servidor");
assert.notEqual(bob, oldServerFormat(11));
assert.equal(formatBusinessMoney(11, "BOB", "es-BO"), bob, "el correo del servidor y la pantalla muestran el mismo monto");
assert.equal(formatBusinessMoney(1234567, "BOB", "es-BO"), formatMoneyText(1234567, "BOB", "es-BO"));
for (const text of [bob, formatBusinessMoney(11, "BOB", "es-BO")]) {
  assert.doesNotMatch(text, /CLP/);
}
// Moneda desconocida o código inválido: cae en CLP/es-CL, como antes.
assert.equal(formatMoneyText(5000, "no", "zz_ZZ"), formatMoneyText(5000, "no", "es-CL"));

// --- Vista previa del correo (frontend) con la moneda de la cotización ---
const previewFor = (quote) =>
  buildQuoteEmailPreview({
    quote,
    companyProfile: { nombreComercial: "Taller Andino", email: "taller@example.com" },
    quoteNumber: "COT-1",
    emailCliente: "cliente@example.com",
    asunto: "Cotización",
    mensaje: "Hola",
    formatMoney: formatBusinessMoney,
    formatDate: (value) => String(value),
  }).summary.total;
assert.equal(previewFor({ total: 1190000 }), oldServerFormat(1190000), "cotización sin moneda: CLP como siempre");
assert.equal(previewFor({ total: 1190000, moneda: "CLP", locale: "es-CL" }), oldServerFormat(1190000));
assert.equal(previewFor({ total: 11, moneda: "BOB", locale: "es-BO" }), formatMoneyText(11, "BOB", "es-BO"), "la vista previa coincide con el correo real");

// --- Fuentes: no queda el formato fijo en los textos que muestran montos ---
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const indexSource = await read("functions/index.js");
assert.doesNotMatch(indexSource, /formatCurrencyClp/);
assert.match(indexSource, /formatMoneyText\(quote\.total, quote\.moneda, quote\.locale\)/);
for (const path of [
  "src/features/sales/SaleItemsEditor.jsx",
  "src/components/ui/InventoryCatalogDialog.jsx",
  "src/components/ui/DocumentItemsEditor.jsx",
  "src/features/purchaseOrders/PurchaseOrderCatalogDialog.jsx",
  "src/pages/PurchaseOrdersPage.jsx",
]) {
  const source = await read(path);
  assert.doesNotMatch(source, /\$\$\{Math\.round\(Number\(value \|\| 0\)\)\.toLocaleString\("es-CL"\)\}/, `${path}: sin "$" fijo`);
  assert.doesNotMatch(source, /<span>\$\{Number\(item\.costoBase/, `${path}: sin "$" fijo en el catálogo`);
  assert.match(source, /useBusinessMoney\(\)/, `${path}: usa la moneda de la empresa`);
}
for (const path of ["src/features/workOrders/ApprovalPanel.jsx", "src/features/workOrders/ServicePlanningPanel.jsx"]) {
  const source = await read(path);
  assert.doesNotMatch(source, /new Intl\.NumberFormat\("es-CL"/, `${path}: sin es-CL fijo`);
  assert.match(source, /formatBusinessMoney/, `${path}: usa el formato de la empresa`);
}
const financeDialog = await read("src/components/finance/FinancialMovementDialog.jsx");
assert.doesNotMatch(financeDialog, /Monto CLP/);
assert.match(financeDialog, /Monto \{currency\}/);

// --- Aviso de redondeo al entero: retirado en la entrega D de la SPEC 036 (BOB calcula con 2 decimales) ---
for (const path of ["src/domain/amountRounding.mjs", "src/components/AmountRoundingNotice.jsx"]) {
  assert.equal(existsSync(path), false, `${path}: eliminado`);
}
for (const path of [
  "src/features/sales/SaleSummaryPanel.jsx",
  "src/features/quotes/QuoteSummaryPanel.jsx",
  "src/features/purchases/PurchaseSummaryPanel.jsx",
  "src/components/QuickBusinessFields.jsx",
  "src/styles/components.css",
]) {
  const source = await read(path);
  assert.doesNotMatch(source, /AmountRounding|amountRounding|getAmountRoundingNote|ui-amount-rounding-notice|se redondean al entero/, `${path}: sin restos del aviso`);
}

console.log("CURRENCY_TEXT_SMOKE_OK", JSON.stringify({ clpValues: clpValues.length, bob }));
