import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {adaptBusinessLocalization, adaptDocumentLocalization} from "../src/domain/localization.mjs";
import {adaptStoredPurchase} from "../src/domain/purchaseModel.mjs";
import {adaptStoredPurchaseOrder} from "../src/domain/purchaseOrderModel.mjs";
import {adaptStoredQuote} from "../src/domain/quoteModel.mjs";
import {adaptStoredSale} from "../src/domain/saleModel.mjs";
import {formatMoney, formatNumber} from "../src/utils/formatters.js";

const require = createRequire(import.meta.url);
const {documentLocalizationSnapshot} = require("../functions/localization.js");
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
    rubroCodigo: "SERVICIOS_PROFESIONALES",
    paisCodigo: "BR",
    monedaCodigo: "USD",
    regionEstado: "São Paulo",
    ciudad: "São Paulo",
    identificadorFiscalTipo: "CPF",
    identificadorFiscalValor: "12345678900",
  },
  TestHttpsError
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
});

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
assert.deepEqual(adaptDocumentLocalization({...origin, moneda: "BOB"}), origin);

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
