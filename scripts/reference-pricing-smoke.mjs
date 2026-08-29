import assert from "node:assert/strict";
import {
  buildValuationForItem,
  calculateReferenceAverage,
} from "../src/domain/pricing.js";
import {
  createQuoteItemFromValuation,
  normalizeQuoteItem,
} from "../src/domain/quoteItemFactory.js";

const inventoryProduct = {
  id: "product-1",
  codigoInterno: "PR-0001",
  tipoItem: "producto",
  nombre: "Producto de prueba",
  unidad: "unidad",
  costoBase: 50000,
  margenDeseado: 20,
  precioInterno: 100000,
  estado: "activo",
};

function activeReference(price) {
  return {
    itemId: inventoryProduct.id,
    nombreFuente: "Comercio de prueba",
    precioObservado: price,
    fechaConsulta: "2026-08-28",
    estado: "activa",
  };
}

function assertNewQuoteUsesCommercialPrice(references) {
  const valuation = buildValuationForItem(inventoryProduct, references);
  const quoteItem = createQuoteItemFromValuation(valuation);
  assert.equal(valuation.precioInterno, 100000);
  assert.equal(valuation.precioSugerido, 100000);
  assert.equal(quoteItem.precioUnitarioEditable, 100000);
  assert.equal(quoteItem.precioSugerido, 100000);
}

const initialReferences = [activeReference(250000)];
assert.equal(calculateReferenceAverage(initialReferences), 250000);
assertNewQuoteUsesCommercialPrice(initialReferences);

const updatedReferences = [activeReference(300000)];
assert.equal(calculateReferenceAverage(updatedReferences), 300000);
assertNewQuoteUsesCommercialPrice(updatedReferences);

assert.equal(calculateReferenceAverage([]), null);
assertNewQuoteUsesCommercialPrice([]);

for (const [tipoItem, precioInterno] of [
  ["servicio", 75000],
  ["actividad", 45000],
]) {
  const item = {
    ...inventoryProduct,
    id: `${tipoItem}-1`,
    tipoItem,
    nombre: `${tipoItem} de prueba`,
    precioInterno,
  };
  const quoteItem = createQuoteItemFromValuation(
    buildValuationForItem(item, [activeReference(999999)])
  );
  assert.equal(quoteItem.precioUnitarioEditable, precioInterno);
}

const legacyInventoryItem = {
  ...inventoryProduct,
  id: "legacy-1",
  costoBase: 80000,
  margenDeseado: 25,
  precioInterno: undefined,
};
assert.equal(
  createQuoteItemFromValuation(
    buildValuationForItem(legacyInventoryItem, [activeReference(300000)])
  ).precioUnitarioEditable,
  100000
);

const historicalQuoteItem = normalizeQuoteItem({
  lineaId: "historical-line-1",
  itemId: "historical-item-1",
  nombre: "Ítem histórico",
  tipoItem: "producto",
  unidad: "unidad",
  cantidad: 1,
  precioSugerido: 250000,
  precioUnitarioEditable: 250000,
  descuentoPorcentaje: 0,
});
assert.equal(historicalQuoteItem.precioSugerido, 250000);
assert.equal(historicalQuoteItem.precioUnitarioEditable, 250000);

console.log("REFERENCE_PRICING_SMOKE_OK");
