import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  PRICE_POSITION,
  describeInternalPricePosition,
} from "../src/domain/marketPricePosition.mjs";

const require = createRequire(import.meta.url);
const {
  GENERIC_QUERY_WARNING,
  assessMarketResults,
  buildInventoryMarketQuery,
  extractMeasures,
} = require("../functions/marketReferences.js");

// Prueba pura (sin emulador) de la relevancia de referencias de mercado.

let counter = 0;
function result(title, price, extra = {}) {
  counter += 1;
  return {
    provider: "SERPER",
    externalId: `r${counter}`,
    title,
    merchant: "Tienda",
    priceRaw: String(price),
    price,
    currency: "CLP",
    url: `https://tienda.example/${counter}`,
    position: counter,
    ...extra,
  };
}

// Caso real: PR-0006 sin marca ni modelo, con código de barras.
const profile = {
  nombre: "PERFIL CUADRADO 40 X 40 DE 2,0 MM",
  codigoBarras: "7802900003401",
  precioInterno: 18371,
};

// --- Consulta: siempre incluye el nombre ---
assert.equal(
  buildInventoryMarketQuery(profile).query,
  "PERFIL CUADRADO 40 X 40 DE 2,0 MM 7802900003401"
);
assert.deepEqual(buildInventoryMarketQuery({ nombre: "Taladro", marca: "Marca Demo", modelo: "X20" }), {
  query: "Taladro Marca Demo X20",
  warnings: [],
});
assert.deepEqual(buildInventoryMarketQuery({ nombre: "Taladro inalámbrico" }), {
  query: "Taladro inalámbrico",
  warnings: [GENERIC_QUERY_WARNING],
});
assert.equal(
  buildInventoryMarketQuery({ nombre: "Taladro", marca: "taladro" }).query,
  "Taladro",
  "no repite partes iguales"
);
console.log("OK relevancia: la consulta siempre incluye el nombre del producto");

// --- Medidas ---
assert.deepEqual(extractMeasures("PERFIL CUADRADO 40 X 40 DE 2,0 MM").dimensions, [["40", "40"]]);
assert.deepEqual(extractMeasures("PERFIL CUADRADO 40 X 40 DE 2,0 MM").values, [{ number: "2", unit: "mm" }]);
assert.deepEqual(extractMeasures("Perfil 40x40x2mm").dimensions, [["40", "40", "2"]]);
assert.deepEqual(extractMeasures("Barra 6 metros").values, [{ number: "6", unit: "m" }]);
console.log("OK relevancia: lectura de medidas (40 X 40, 2,0 MM, 40x40x2mm)");

// --- Caso del perfil cuadrado: resultados irrelevantes → sin coincidencias ---
const irrelevant = [
  result("Picadora Vitromix de alimentos 1000 W", 54990),
  result("Pluscal comprimidos edulcorante 300 un", 2990),
  result("Detergente Omo líquido 3 L", 9990),
  result("Crema Nivea cuidado corporal 400 ml", 4590),
  result("Limpiavidrios Mr. Músculo 500 ml", 1390),
  result("Jabón Dove barra 90 g", 1290),
  result("Desodorante Rexona 150 ml", 3290),
];
const none = assessMarketResults(profile, irrelevant, "CLP");
assert.equal(none.status, "NONE");
assert.equal(none.confidence, "NONE");
assert.equal(none.summary, null);
assert.deepEqual(none.results, []);
assert.equal(none.totalFound, 7);
assert.equal(none.discardedCount, 7);
console.log("OK relevancia: perfil cuadrado con resultados irrelevantes → Sin coincidencias confiables (sin precios ni resumen)");

// --- Coincidencias reales mezcladas con ruido ---
const mixed = [
  ...irrelevant,
  result("Perfil Cuadrado Acero 40x40x2 mm Barra 6 m", 18500),
  result("Perfil cuadrado 40 x 40 mm espesor 2.0 mm", 19200),
  result("Perfiles Cuadrados 40x40x2mm", 20900),
  result("Perfil cuadrado 30x30x2 mm", 9800),
  result("Perfil redondo 40 mm", 7000),
  result("Perfil cuadrado 40x40x2 mm acero inoxidable", 240000),
];
const ok = assessMarketResults(profile, mixed, "CLP");
assert.equal(ok.status, "OK");
assert.equal(ok.confidence, "HIGH");
assert.equal(ok.results.length, 4, "solo los 4 perfiles de 40x40x2 pasan; 30x30 y redondo se descartan");
assert.ok(ok.results.every((entry) => /perfil/i.test(entry.title)));
assert.equal(ok.results.filter((entry) => entry.outlier).length, 1);
assert.equal(ok.results.find((entry) => entry.outlier).price, 240000);
assert.deepEqual(ok.summary, {
  count: 3,
  currency: "CLP",
  min: 18500,
  median: 19200,
  max: 20900,
  outliersExcluded: 1,
});
assert.ok(ok.summary.min > 1390, "el limpiavidrios ya no es el precio bajo");
assert.equal(ok.discardedCount, 9);
console.log("OK relevancia: filtra ruido, descarta medidas distintas y excluye el valor atípico del resumen");

// --- Pocas coincidencias: lista sin resumen ---
const few = assessMarketResults(
  profile,
  [...irrelevant, result("Perfil cuadrado 40x40x2 mm", 19000), result("Perfil cuadrado 40 x 40 x 2 mm", 20000)],
  "CLP"
);
assert.equal(few.status, "FEW");
assert.equal(few.confidence, "LOW");
assert.equal(few.summary, null);
assert.equal(few.results.length, 2);
console.log("OK relevancia: 1 o 2 coincidencias se listan sin resumen");

// --- Confianza sale de la coincidencia, no de tener código de barras ---
const medium = assessMarketResults(
  profile,
  [
    result("Perfil cuadrado 40x40 mm", 19000),
    result("Perfil cuadrado 40 x 40 mm", 20000),
    result("Perfil cuadrado 40x40", 21000),
  ],
  "CLP"
);
assert.equal(medium.status, "OK");
assert.equal(medium.confidence, "MEDIUM", "sin espesor declarado la coincidencia es media");
assert.ok(medium.results.every((entry) => entry.relevance.level === "MEDIA"));
console.log("OK relevancia: la confianza mide la coincidencia (medidas incompletas → Media)");

// --- Sin medidas en el nombre: manda el nombre; otras monedas no entran ---
const plain = { nombre: "Taladro inalámbrico", categoria: "Herramientas" };
const plainAssessment = assessMarketResults(
  plain,
  [
    result("Taladro Inalambrico 20V con batería", 59990),
    result("Taladros inalámbricos Herramientas 12V", 49990),
    result("Taladro inalámbrico percutor", 69990),
    result("Taladro inalámbrico USD", 70, { currency: "USD" }),
    result("Martillo de goma", 5990),
  ],
  "CLP"
);
assert.equal(plainAssessment.status, "OK");
assert.equal(plainAssessment.results.length, 3);
assert.equal(plainAssessment.results[0].title, "Taladros inalámbricos Herramientas 12V", "ordenado por relevancia (bono de categoría)");
console.log("OK relevancia: acentos, plurales, orden por relevancia y moneda distinta");

// --- Entradas vacías o raras ---
assert.equal(assessMarketResults(profile, [], "CLP").status, "NONE");
assert.equal(assessMarketResults(profile, undefined, "CLP").status, "NONE");
assert.equal(assessMarketResults({ nombre: "40 x 40" }, [result("Perfil 40x40", 100)], "CLP").status, "NONE");
console.log("OK relevancia: sin resultados o sin nombre evaluable → sin coincidencias");

// --- Posición del precio interno (cliente) ---
const summary = { min: 18500, median: 19200, max: 20900, currency: "CLP" };
assert.equal(describeInternalPricePosition(summary, 18371).position, PRICE_POSITION.BELOW);
assert.equal(describeInternalPricePosition(summary, 19000).position, PRICE_POSITION.WITHIN);
assert.equal(describeInternalPricePosition(summary, 25000).position, PRICE_POSITION.ABOVE);
const inside = describeInternalPricePosition(summary, 19700);
assert.ok(inside.internalPercent > 0 && inside.internalPercent < 100);
assert.ok(inside.differenceVsMedian > 0);
assert.equal(describeInternalPricePosition(summary, 5).internalPercent, 0);
assert.equal(describeInternalPricePosition(summary, 99999).internalPercent, 100);
assert.equal(describeInternalPricePosition(summary, null), null);
assert.equal(describeInternalPricePosition(null, 100), null);
assert.equal(describeInternalPricePosition({ min: 10, median: 10, max: 10 }, 10).internalPercent, 50);
console.log("OK relevancia: indicador de dónde cae tu precio interno");

console.log("MARKET_RELEVANCE_SMOKE_OK");
