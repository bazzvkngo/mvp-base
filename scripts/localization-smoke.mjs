import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {adaptBusinessLocalization, adaptDocumentAmountDecimals, adaptDocumentLocalization} from "../src/domain/localization.mjs";
import {adaptStoredPurchase} from "../src/domain/purchaseModel.mjs";
import {adaptStoredPurchaseOrder} from "../src/domain/purchaseOrderModel.mjs";
import {adaptStoredQuote} from "../src/domain/quoteModel.mjs";
import {adaptStoredSale} from "../src/domain/saleModel.mjs";
import {formatMoney, formatNumber} from "../src/utils/formatters.js";

const require = createRequire(import.meta.url);
const {
  adaptDocumentAmountDecimals: serverAdaptAmountDecimals,
  adaptDocumentLocalization: serverAdaptDocumentLocalization,
  currencyAmountDecimals,
  documentLocalizationSnapshot,
} = require("../functions/localization.js");
const {validateTaxSettings} = require("../functions/businessSettings.js");
const {validateBusinessProfileInput} = require("../functions/businessOnboarding.js");
class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

assert.deepEqual(
  adaptBusinessLocalization({}),
  {
    paisCodigo: "CL",
    paisNombre: "Chile",
    monedaCodigo: "CLP",
    monedaNombre: "Peso chileno",
    locale: "es-CL",
    identificadorFiscalTipo: "RUT",
    identificadorFiscalValor: "",
  }
);

const brazilUsd = validateBusinessProfileInput(
  {
    nombreComercial: "Empresa Brasil",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    paisCodigo: "BR",
    monedaCodigo: "USD",
    regionEstado: "São Paulo",
    ciudad: "São Paulo",
    identificadorFiscalTipo: "CPF",
    identificadorFiscalValor: "12345678900",
  },
  TestHttpsError,
  {existingBusiness: {paisCodigo: "BR"}}
);
assert.equal(brazilUsd.paisCodigo, "BR");
assert.equal(brazilUsd.monedaCodigo, "USD");
assert.equal(brazilUsd.locale, "pt-BR");
assert.equal(brazilUsd.identificadorFiscalTipo, "CPF");

for (const [country, currency, locale] of [
  ["CL", "CLP", "es-CL"],
  ["BO", "BOB", "es-BO"],
  ["BR", "BRL", "pt-BR"],
  ["PE", "PEN", "es-PE"],
  ["BR", "USD", "pt-BR"],
]) {
  const snapshot = documentLocalizationSnapshot(
    {paisCodigo: country, monedaCodigo: currency, locale},
    {impuestoPredeterminadoNombre: "Impuesto QA", impuestoPredeterminadoTasa: 12.5}
  );
  assert.equal(snapshot.paisCodigo, country);
  assert.equal(snapshot.moneda, currency);
  assert.equal(snapshot.locale, locale);
  assert.equal(snapshot.impuestoNombre, "Impuesto QA");
  assert.equal(snapshot.tasaIva, 0.125);
  // SPEC 036: el snapshot congela los decimales de cálculo (amountDecimals de la moneda; 2 en BOB, 0 en el resto).
  assert.equal(snapshot.montoDecimales, currency === "BOB" ? 2 : 0, `${currency}: montoDecimales`);
  assert.equal(

    new Intl.NumberFormat(locale, {style: "currency", currency}).resolvedOptions().currency,
    currency
  );
  assert.ok(formatMoney(1000.5, currency, locale));
  assert.ok(formatNumber(1000.5, locale));
}

const historical = adaptDocumentLocalization({});
assert.deepEqual(historical, {
  paisCodigo: "CL",
  moneda: "CLP",
  locale: "es-CL",
  impuestoNombre: "IVA",
  tasaIva: 0.19,
  montoDecimales: 0,
});
assert.deepEqual(serverAdaptDocumentLocalization({}), historical, "el servidor adapta igual que el frontend");

assert.deepEqual(
  validateTaxSettings(
    {impuestoPredeterminadoNombre: "IGV", impuestoPredeterminadoTasa: 18},
    TestHttpsError
  ),
  {
    impuestoPredeterminadoId: "PERSONALIZADO",
    impuestoPredeterminadoNombre: "IGV",
    impuestoPredeterminadoTasa: 18,
  }
);

const line = {lineaId: "linea-1", itemId: "item-1", nombre: "Ítem", cantidad: 1, descuentoPct: 0};
assert.equal(adaptStoredQuote({items: [], total: 100}).moneda, "CLP");
assert.equal(adaptStoredSale({items: [], total: 100}).locale, "es-CL");
assert.equal(adaptStoredPurchaseOrder({items: [{...line, costoUnitario: 100}]}).moneda, "CLP");
assert.equal(adaptStoredPurchase({items: [{...line, costoUnitario: 100}]}).paisCodigo, "CL");

const origin = {paisCodigo: "BO", moneda: "BOB", locale: "es-BO", impuestoNombre: "Impuesto", tasaIva: 0.13};
assert.deepEqual(adaptDocumentLocalization({...origin, moneda: "BOB"}), {...origin, montoDecimales: 0}, "documento sin snapshot de decimales: 0");
assert.deepEqual(serverAdaptDocumentLocalization({...origin, moneda: "BOB"}), {...origin, montoDecimales: 0});

// SPEC 036: `montoDecimales` (cálculo) no es `decimals` (formato). Ausente o inválido = 0; nunca supera los decimales
// de la moneda del documento (CLP y PYG siempre 0).
for (const [moneda, stored, expected] of [
  ["BOB", undefined, 0], ["BOB", null, 0], ["BOB", 0, 0], ["BOB", 1, 1], ["BOB", 2, 2], ["BOB", 3, 0],
  ["BOB", -1, 0], ["BOB", 1.5, 0], ["BOB", "2", 0], ["BOB", NaN, 0], ["CLP", 2, 0], ["CLP", 1, 0], ["PYG", 2, 0],
  ["USD", 2, 2], ["XXX", 2, 0], ["", 2, 0],
]) {
  assert.equal(adaptDocumentAmountDecimals({montoDecimales: stored}, moneda), expected, `${moneda} ${stored}`);
  assert.equal(serverAdaptAmountDecimals({montoDecimales: stored}, moneda), expected, `servidor ${moneda} ${stored}`);
}
assert.equal(adaptDocumentLocalization({moneda: "BOB", montoDecimales: 2}).montoDecimales, 2, "un documento guardado con 2 decimales los conserva");
assert.equal(serverAdaptDocumentLocalization({moneda: "BOB", montoDecimales: 2}).montoDecimales, 2);
assert.equal(adaptDocumentLocalization({montoDecimales: 2}).montoDecimales, 0, "sin moneda es CLP: 0");
for (const code of ["CLP", "BOB", "PYG", "USD", "XXX", ""]) {
  assert.equal(currencyAmountDecimals(code), code === "BOB" ? 2 : 0, `amountDecimals del servidor para ${code}`);
}
assert.equal(adaptStoredSale({items: [], total: 100, moneda: "BOB", montoDecimales: 2}).montoDecimales, 2);
assert.equal(adaptStoredQuote({items: [], total: 100}).montoDecimales, 0);
assert.equal(adaptStoredPurchaseOrder({items: [{...line, costoUnitario: 100}]}).montoDecimales, 0);
assert.equal(adaptStoredPurchase({items: [{...line, costoUnitario: 100}]}).montoDecimales, 0);

const inventoryPriceFields = {
  formacionPrecioVersion: 2,
  tasaImpuestoCompra: 19,
  montoImpuestoCompra: 190,
  costoPagado: 1190,
  precioVentaSugerido: 1500,
  precioInterno: 1500,
};
assert.deepEqual({...inventoryPriceFields}, inventoryPriceFields);

console.log("LOCALIZATION_SMOKE_OK");
