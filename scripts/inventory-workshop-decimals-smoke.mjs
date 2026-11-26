import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { buildFinancialCsv, adaptFinancialMovement, normalizeFinancialMovementInput } from "../src/domain/financialMovement.mjs";
import {
  INVENTORY_PRICE_FORMATION_VERSION,
  LEGACY_PURCHASE_TAX_PRICE_FORMATION_VERSION,
  adaptInventoryItem,
  buildInventoryPayload,
  calculateInventoryPriceFormation,
  calculateInventoryPriceWithTax,
  filterInventoryItems,
  validateInventoryDraft,
} from "../src/domain/inventoryMvp.mjs";
import { isMoneyAmount, mulRound, sumMoney } from "../src/domain/money.mjs";
import {
  SALE_COMMERCIAL_MARGIN_STATUS as STATUS,
  calculateSaleCommercialMarginV1,
  calculateSaleProductLineMarginsV1,
} from "../src/domain/saleCommercialMargin.mjs";
import { calculateWorkOrderProductLineTotal, calculateWorkOrderScopeTotal } from "../src/domain/workOrderModel.mjs";

// SPEC 036, entrega C: inventario, OT del taller, margen y movimientos financieros con decimales por moneda.
// El catálogo sigue con amountDecimals 0 (BOB incluido): los modelos reciben `decimals` 2 directamente, y los handlers
// que leen el catálogo se prueban poniendo BOB en 2 solo dentro de este proceso (el JSON del disco no cambia).
// Con 0 decimales todo se compara contra las fórmulas LEGACY congeladas aquí, copiadas literalmente de antes de la entrega.
const require = createRequire(import.meta.url);
const catalog = require("../functions/businessCatalog.json");
const serverInventory = require("../functions/inventoryModel.js");
const serverAcquisition = require("../functions/inventoryAcquisition.js");
const serverWorkOrder = require("../functions/workOrderPersistence.js");

const setBobDecimals = (decimals) => {
  catalog.currencies.find((currency) => currency.code === "BOB").amountDecimals = decimals;
};
setBobDecimals(0);

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Generador pseudoaleatorio determinista (mulberry32).
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = makeRandom(36_003);
const pick = (list) => list[Math.floor(random() * list.length)];
const int = (min, max) => min + Math.floor(random() * (max - min + 1));
// Costos de todo tipo: enteros, centavos y hasta 3 decimales (los empates dependen del punto flotante).
const randomMoney = () => pick([
  () => int(0, 2_000_000),
  () => int(0, 2_000_000) / 100,
  () => int(0, 200_000) / 1000,
  () => int(1, 50) + 0.5,
])();
const RATES = [0, 7, 10, 10.5, 13, 16, 18, 19, 21, 100];
const randomMargin = () => pick([() => int(0, 400), () => int(0, 4000) / 10, () => int(0, 40_000) / 100])();

// ===========================================================================================================
// 1. Con 0 decimales: formación de precio contra la fórmula LEGACY congelada (servidor y frontend)
// ===========================================================================================================
const legacyFormationV3 = (cost, rate, markup) => {
  const monto = Math.round(cost * rate / 100);
  return { monto, pagado: cost + monto, sugerido: Math.round(cost * (1 + markup / 100)) };
};
const legacyFormationV2 = (cost, rate, markup) => ({
  monto: Math.round(cost * rate / 100),
  pagado: Math.round(cost * (1 + rate / 100)),
  sugerido: Math.round(cost * (1 + rate / 100) * (1 + markup / 100)),
});
{
  let compared = 0;
  for (let index = 0; index < 150_000; index += 1) {
    const cost = randomMoney();
    const rate = pick(RATES);
    const markup = randomMargin();
    const expected = legacyFormationV3(cost, rate, markup);
    const server = serverInventory.calculateInventoryPriceFormation({
      costoBase: cost, impuestoId: "IVA_GENERAL", tasaNegocio: rate, margenDeseado: markup, precioManual: false,
    });
    const serverZero = serverInventory.calculateInventoryPriceFormation({
      costoBase: cost, impuestoId: "IVA_GENERAL", tasaNegocio: rate, margenDeseado: markup, precioManual: false, decimals: 0,
    });
    assert.deepEqual(server, serverZero, "servidor: decimals ausente = 0");
    assert.equal(server.montoImpuestoCompra, expected.monto, `servidor monto ${cost} ${rate}`);
    assert.equal(server.costoPagado, expected.pagado, `servidor pagado ${cost} ${rate}`);
    assert.equal(server.precioVentaSugerido, expected.sugerido, `servidor sugerido ${cost} ${markup}`);
    assert.equal(server.precioInterno, expected.sugerido);

    const item = { costoBase: cost, tasaImpuestoCompra: rate, margenDeseado: markup, formacionPrecioVersion: INVENTORY_PRICE_FORMATION_VERSION };
    for (const front of [calculateInventoryPriceFormation(item), calculateInventoryPriceFormation(item, 0)]) {
      assert.equal(front.montoImpuestoCompra, expected.monto, `front monto ${cost} ${rate}`);
      assert.equal(front.costoPagado, expected.pagado);
      assert.equal(front.precioVentaSugerido, expected.sugerido);
    }
    const legacyV2 = legacyFormationV2(cost, rate, markup);
    const v2 = calculateInventoryPriceFormation({ ...item, formacionPrecioVersion: LEGACY_PURCHASE_TAX_PRICE_FORMATION_VERSION }, 0);
    assert.deepEqual([v2.montoImpuestoCompra, v2.costoPagado, v2.precioVentaSugerido], [legacyV2.monto, legacyV2.pagado, legacyV2.sugerido], "v2 legado");
    // Precio con IVA (informativo): misma fórmula que Ventas.
    const legacyWithTax = cost + Math.round((cost * rate) / 100);
    assert.equal(calculateInventoryPriceWithTax(cost, rate), legacyWithTax);
    assert.equal(calculateInventoryPriceWithTax(cost, rate, 0), legacyWithTax);
    compared += 1;
  }
  assert.equal(compared, 150_000);
  console.log("OK inventario con 0 decimales: servidor y frontend dan la fórmula legacy en 150.000 casos");
}

// ===========================================================================================================
// 2. Con 0 decimales: validaciones del servidor y del formulario no ganan límites nuevos
// ===========================================================================================================
const serverItem = (overrides = {}) => ({
  tipoItem: "producto", areaId: "area_informatica", categoriaId: "cat_hardware", nombre: "Notebook corporativo", unidad: "unidad",
  costoBase: 500000, margenDeseado: 20, precioInterno: 600000, marca: "Lenovo", modelo: "T14", barcode: "", stock: 4, stockMinimo: 1,
  ...overrides,
});
{
  for (let index = 0; index < 30_000; index += 1) {
    const cost = randomMoney();
    const markup = randomMargin();
    const legacyPrice = Math.round(cost + (cost * markup) / 100);
    const input = serverItem({ costoBase: cost, margenDeseado: markup });
    assert.equal(serverInventory.validateInventoryItemInput(input, HttpsError).precioInterno, legacyPrice, `precio ${cost} ${markup}`);
    assert.equal(serverInventory.validateInventoryItemInput(input, HttpsError, { decimals: 0 }).precioInterno, legacyPrice);
  }
  // Chile acepta lo mismo que antes: costos y precios manuales con cualquier cantidad de decimales, sin error nuevo.
  for (const value of [3.5, 3.505, 0.1234567, 10, 999999999.99]) {
    assert.equal(serverInventory.validateInventoryItemInput(serverItem({ costoBase: value }), HttpsError).costoBase, value);
    assert.equal(
      serverInventory.validateInventoryItemInput(serverItem({ costoBase: value, precioManual: true, precioInterno: value }), HttpsError).precioInterno,
      value
    );
  }
  // Formulario: sin decimals no hay validación de decimales, y el precio calculado es el de siempre.
  const draft = { tipoItem: "producto", nombre: "X", unidad: "unidad", costoBase: "3,505", margenDeseado: "30", stock: "1", stockMinimo: "0", precioManual: "" };
  assert.deepEqual(validateInventoryDraft(draft), {});
  assert.deepEqual(validateInventoryDraft(draft, {}), {});
  assert.deepEqual(validateInventoryDraft(draft, 7), {}, "un segundo argumento que no es objeto se ignora");
  for (let index = 0; index < 20_000; index += 1) {
    // Costos escritos como en el formulario (hasta 2 decimales): "123.456" se leería como miles, no como decimales.
    const cost = pick([() => int(0, 2_000_000), () => int(0, 200_000_00) / 100])();
    const markup = int(0, 400);
    const payload = buildInventoryPayload({ ...draft, costoBase: String(cost), margenDeseado: String(markup) }, []);
    assert.equal(payload.precioInterno, Math.round(cost + (cost * markup) / 100), `payload ${cost} ${markup}`);
  }
  console.log("OK inventario con 0 decimales: validaciones y precio del payload idénticos, sin límites nuevos");
}

// ===========================================================================================================
// 3. Con 2 decimales: precios y costos de Inventario (Bs 3,50), contra un oráculo en centavos enteros
// ===========================================================================================================
{
  // Ejemplo del enunciado: repuesto a Bs 3,50 con recargo 30 % e IVA 13 %.
  const formation = serverInventory.calculateInventoryPriceFormation({
    costoBase: 3.5, impuestoId: "IVA_GENERAL", tasaNegocio: 13, margenDeseado: 30, precioManual: false, decimals: 2,
  });
  assert.equal(formation.montoImpuestoCompra, 0.46, "13 % de 3,50 = 0,455 → 0,46 (el empate sube)");
  assert.equal(formation.costoPagado, 3.96);
  assert.equal(formation.precioVentaSugerido, 4.55, "3,50 + 30 % = 4,55, no 5");
  assert.equal(formation.precioInterno, 4.55);
  // Con 0 decimales ese mismo repuesto sigue redondeándose al entero, como hoy.
  assert.equal(serverInventory.calculateInventoryPriceFormation({
    costoBase: 3.5, impuestoId: "IVA_GENERAL", tasaNegocio: 13, margenDeseado: 30, precioManual: false,
  }).precioVentaSugerido, 5);
  // Exento: sin IVA de compra. Precio manual: se conserva tal cual.
  const exempt = serverInventory.calculateInventoryPriceFormation({
    costoBase: 3.5, impuestoId: "IVA_EXENTO", tasaNegocio: 13, margenDeseado: 10, precioManual: false, decimals: 2,
  });
  assert.deepEqual([exempt.tasaImpuestoCompra, exempt.montoImpuestoCompra, exempt.costoPagado, exempt.precioInterno], [0, 0, 3.5, 3.85]);
  assert.equal(serverInventory.calculateInventoryPriceFormation({
    costoBase: 3.5, impuestoId: "IVA_GENERAL", tasaNegocio: 13, margenDeseado: 30, precioManual: true, precioInterno: 4.99, decimals: 2,
  }).precioInterno, 4.99);

  // Oráculo: centavos enteros con el empate hacia arriba (misma regla que Math.round).
  for (let index = 0; index < 60_000; index += 1) {
    const cents = int(0, 2_000_000_000);
    const rate = pick([0, 7, 10, 13, 16, 18, 19, 21, 100]);
    const markup = int(0, 400);
    const montoCents = Math.floor((cents * rate + 50) / 100);
    const sugeridoCents = Math.floor((cents * (100 + markup) + 50) / 100);
    const cost = cents / 100;
    const server = serverInventory.calculateInventoryPriceFormation({
      costoBase: cost, impuestoId: "IVA_GENERAL", tasaNegocio: rate, margenDeseado: markup, precioManual: false, decimals: 2,
    });
    assert.equal(server.montoImpuestoCompra, montoCents / 100, `monto ${cost} ${rate}`);
    assert.equal(server.costoPagado, (cents + montoCents) / 100, `pagado ${cost} ${rate}`);
    assert.equal(server.precioVentaSugerido, sugeridoCents / 100, `sugerido ${cost} ${markup}`);
    // El frontend da exactamente lo mismo que el servidor.
    const front = calculateInventoryPriceFormation({
      costoBase: cost, tasaImpuestoCompra: rate, margenDeseado: markup, formacionPrecioVersion: INVENTORY_PRICE_FORMATION_VERSION,
    }, 2);
    assert.deepEqual(
      [front.montoImpuestoCompra, front.costoPagado, front.precioVentaSugerido],
      [server.montoImpuestoCompra, server.costoPagado, server.precioVentaSugerido],
      `paridad ${cost} ${rate} ${markup}`
    );
    assert.ok(isMoneyAmount(server.precioVentaSugerido, 2) && isMoneyAmount(server.costoPagado, 2));
  }
  // Precio con IVA informativo: 4,55 + 13 % (0,5915 → 0,59) = 5,14.
  assert.equal(calculateInventoryPriceWithTax(4.55, 13, 2), 5.14);
  assert.equal(calculateInventoryPriceWithTax(4.55, 13), 4.55 + Math.round(4.55 * 13 / 100), "con 0 decimales, la fórmula de siempre");
  assert.equal(calculateInventoryPriceWithTax(4.55, null, 2), null);

  // Validación del servidor: hasta 2 decimales para el costo y el precio de venta manual.
  const decimals = 2;
  assert.equal(serverInventory.validateInventoryItemInput(serverItem({ costoBase: 3.5, margenDeseado: 30 }), HttpsError, { decimals }).precioInterno, 4.55);
  assert.throws(
    () => serverInventory.validateInventoryItemInput(serverItem({ costoBase: 3.505 }), HttpsError, { decimals }),
    (error) => error.code === "invalid-argument" && /costo base admite hasta 2 decimales/.test(error.message)
  );
  assert.throws(
    () => serverInventory.validateInventoryItemInput(serverItem({ precioManual: true, precioInterno: 4.555 }), HttpsError, { decimals }),
    (error) => error.code === "invalid-argument" && /precio de venta admite hasta 2 decimales/.test(error.message)
  );
  assert.equal(
    serverInventory.validateInventoryItemInput(serverItem({ precioManual: true, precioInterno: 4.99 }), HttpsError, { decimals }).precioInterno,
    4.99
  );
  assert.throws(
    () => serverInventory.validateInventoryItemInput(serverItem({ costoBase: 1e15 }), HttpsError, { decimals }),
    (error) => error.code === "invalid-argument",
    "con decimales el importe en centavos debe ser un entero seguro"
  );
  // Un precio manual que no se usa no se valida (precioManual false: se ignora el precio enviado).
  assert.doesNotThrow(() => serverInventory.validateInventoryItemInput(serverItem({ precioManual: false, precioInterno: 4.555 }), HttpsError, { decimals }));

  // Formulario: mismas reglas, con el mensaje por campo.
  const draft = { tipoItem: "producto", nombre: "X", unidad: "unidad", costoBase: "3,50", margenDeseado: "30", stock: "1", stockMinimo: "0", precioManual: "" };
  assert.deepEqual(validateInventoryDraft(draft, { decimals }), {});
  assert.match(validateInventoryDraft({ ...draft, costoBase: "3,505" }, { decimals }).costoBase, /costo base admite hasta 2 decimales/);
  assert.match(validateInventoryDraft({ ...draft, precioManual: "4,555" }, { decimals }).precioManual, /precio de venta admite hasta 2 decimales/);
  assert.equal(buildInventoryPayload(draft, [], { decimals }).precioInterno, 4.55);
  assert.equal(buildInventoryPayload(draft, []).precioInterno, 5, "sin decimales, el payload redondea como siempre");
  assert.equal(buildInventoryPayload({ ...draft, precioManual: "4,99" }, [], { decimals }).precioInterno, 4.99);
  assert.throws(() => buildInventoryPayload({ ...draft, costoBase: "3,505" }, [], { decimals }), /admite hasta 2 decimales/);

  // Lo que se ve en la lista: con 2 decimales el precio no se redondea al entero; con 0 se redondea, como hoy.
  const stored = {
    id: "i1", tipoItem: "producto", nombre: "Repuesto", unidad: "unidad", costoBase: 3.5, margenDeseado: 30, precioInterno: 4.55,
    formacionPrecioVersion: INVENTORY_PRICE_FORMATION_VERSION, tasaImpuestoCompra: 13, stock: 1, estado: "activo",
  };
  assert.equal(adaptInventoryItem(stored, { decimals: 2 }).precioEfectivo, 4.55);
  assert.equal(adaptInventoryItem(stored, { decimals: 2 }).precioCalculado, 4.55);
  assert.equal(adaptInventoryItem(stored).precioEfectivo, 5);
  assert.equal(adaptInventoryItem(stored, { decimals: 0 }).precioEfectivo, 5);
  const legacyStored = { ...stored, formacionPrecioVersion: undefined, tasaImpuestoCompra: undefined };
  assert.equal(adaptInventoryItem(legacyStored, { decimals: 2 }).precioEfectivo, 4.55, "ítem sin formación v3");
  assert.equal(adaptInventoryItem(legacyStored).precioEfectivo, 5);
  // `.map(adaptInventoryItem)` le pasa el índice como segundo argumento: no debe leerse como decimales.
  assert.deepEqual([stored, stored, stored].map(adaptInventoryItem).map((entry) => entry.precioEfectivo), [5, 5, 5]);
  assert.deepEqual(filterInventoryItems([stored], { decimals: 2 }).map((entry) => entry.precioEfectivo), [4.55]);
  assert.deepEqual(filterInventoryItems([stored], {}).map((entry) => entry.precioEfectivo), [5]);
  console.log("OK inventario con 2 decimales: Bs 3,50 + 30 % = 4,55; servidor ≡ frontend; validación hasta 2 decimales");
}

// ===========================================================================================================
// 4. Costo promedio (inventoryAcquisition.js): con centavos funciona, y no cambió con 0 decimales
// ===========================================================================================================
{
  const state = (stock, average) => ({
    stock, value: stock * average, average, currency: "BOB", referenceCost: average,
  });
  // 3 unidades a Bs 3,50 = 10,50; entran 2 a Bs 4,25 = 8,50 → 19,00 / 5 = 3,80.
  const base = serverAcquisition.resolveInventoryEconomicState({
    item: { stock: 3, costoPromedio: 3.5, costoPromedioMoneda: "BOB", costoBase: 3.5 }, operationCurrency: "BOB",
  });
  assert.equal(base.value, 10.5);
  assert.equal(base.average, 3.5);
  const acquired = serverAcquisition.applyInventoryAcquisition(base, {
    cantidad: 2, costoUnitario: 4.25, descuentoPct: 0, tasaImpuestoCompra: 0, tratamientoIvaCompra: "exento",
  });
  assert.equal(acquired.amounts.costoInventarioTotal, 8.5);
  assert.equal(acquired.next.value, 19);
  assert.equal(acquired.next.stock, 5);
  assert.equal(acquired.next.average, 3.8, "costo promedio con centavos: 19,00 / 5 = 3,80");
  assert.equal(serverAcquisition.calculateWeightedAverage({
    stockAnterior: 3, costoPromedioAnterior: 3.5, cantidadEntrada: 2, costoEntrada: 4.25,
  }), 3.8);
  // Con IVA de crédito fiscal el inventario entra por el neto, también en centavos.
  const taxed = serverAcquisition.applyInventoryAcquisition(state(0, 0), {
    cantidad: 3, costoUnitario: 3.5, descuentoPct: 10, tasaImpuestoCompra: 13, tratamientoIvaCompra: "credito_fiscal",
  });
  assert.equal(taxed.amounts.costoUnitarioNeto, 3.15);
  assert.equal(taxed.amounts.costoInventarioTotal, 9.45, "3 × 3,15 neto");
  assert.equal(taxed.amounts.impuestoCompraUnitario, 0.4095);
  assert.equal(taxed.next.average, 3.15);
  // Salida valorizada al promedio: 2 de 5 a 3,80 = 7,60; queda 11,40 / 3 = 3,80.
  const out = serverAcquisition.applyInventoryCostedOutflow(acquired.next, { cantidad: 2, costoUnitario: acquired.next.average });
  assert.equal(out.costoTotal, 7.6);
  assert.equal(out.next.value, 11.4);
  assert.equal(out.next.average, 3.8);
  // Al vaciar el saldo, el valor residual sale completo, sin dejar centavos colgados.
  const closeOut = serverAcquisition.applyInventoryCostedOutflow(out.next, { cantidad: 3, costoUnitario: 3.8 });
  assert.equal(closeOut.next.value, 0);
  assert.equal(closeOut.next.stock, 0);
  // Limitación conocida (riesgo para la entrega D): el valor del inventario se redondea con la fórmula legacy
  // `(x + EPSILON) * 100`, que en los empates al tercer decimal (cantidad fraccionaria, o descuento × cantidad) puede
  // diferir un centavo del redondeo decimal exacto (p. ej. 10 × 0,2975 = 2,975 sale 2,97 y no 2,98). El smoke fija la
  // cota: la diferencia nunca supera un centavo. Corregirlo exige pasar `montoDecimales` por los puntos de llamada de
  // compras, recepciones, ventas y proyectos, que esta entrega no toca.
  for (let cents = 1; cents <= 400; cents += 1) {
    for (const [quantity, discount] of [[10, 15], [3, 5], [2.5, 0], [0.5, 0], [7, 10]]) {
      const exactUnits = Math.round(cents * (100 - discount)) * quantity / 100; // centavos, sin redondear
      const exact = Math.floor(exactUnits + 0.5) / 100;
      const got = serverAcquisition.calculateAcquisitionAmounts({
        cantidad: quantity, costoUnitario: cents / 100, descuentoPct: discount, tratamientoIvaCompra: "exento",
      }).costoInventarioTotal;
      assert.ok(Math.abs(got - exact) < 0.0100001, `${quantity} × ${cents / 100} (-${discount} %): ${got} vs ${exact}`);
    }
  }
  // Con 0 decimales (CLP, enteros) el resultado es el de siempre.
  const clp = serverAcquisition.resolveInventoryEconomicState({
    item: { stock: 10, costoPromedio: 1000, costoPromedioMoneda: "CLP", costoBase: 1000 }, operationCurrency: "CLP",
  });
  const clpIn = serverAcquisition.applyInventoryAcquisition(clp, { cantidad: 5, costoUnitario: 1300, descuentoPct: 0, tasaImpuestoCompra: 0, tratamientoIvaCompra: "exento" });
  assert.deepEqual([clpIn.next.value, clpIn.next.stock, clpIn.next.average], [16500, 15, 1100]);
  console.log("OK costo promedio: centavos exactos (19,00 / 5 = 3,80) y CLP sin cambios; inventoryAcquisition.js no se modificó");
}

// ===========================================================================================================
// 5. OT del taller: total con 0 decimales contra la fórmula legacy; con 2 decimales, repuestos a Bs 3,50
// ===========================================================================================================
{
  const legacyScopeTotal = (scope) => {
    let total = 0;
    for (const service of scope) {
      if (!Number.isFinite(service?.precioUnitario)) return null;
      total += service.precioUnitario;
      for (const product of service.productos || []) {
        if (!Number.isFinite(product?.precioUnitario) || !Number.isFinite(product?.cantidad)) return null;
        total += Math.round(product.precioUnitario * product.cantidad);
      }
    }
    return Number.isSafeInteger(total) ? total : null;
  };
  for (let index = 0; index < 60_000; index += 1) {
    const scope = Array.from({ length: int(1, 4) }, () => ({
      precioUnitario: int(0, 500_000),
      productos: Array.from({ length: int(0, 4) }, () => ({
        precioUnitario: pick([() => int(0, 100_000), () => int(0, 10_000_000) / 100, () => int(1, 9999) / 1000])(),
        cantidad: pick([() => int(1, 20), () => int(1, 4000) / 1000, () => 0.5])(),
      })),
    }));
    const expected = legacyScopeTotal(scope);
    assert.equal(calculateWorkOrderScopeTotal(scope), expected, JSON.stringify(scope));
    assert.equal(calculateWorkOrderScopeTotal(scope, 0), expected);
    scope.forEach((service) => service.productos.forEach((product) => {
      assert.equal(calculateWorkOrderProductLineTotal(product, 0), product.precioUnitario * product.cantidad, "la línea sin decimales es precio × cantidad");
    }));
  }
  // Casos de borde de la fórmula legacy.
  assert.equal(calculateWorkOrderScopeTotal([]), 0);
  assert.equal(calculateWorkOrderScopeTotal([], 2), 0);
  assert.equal(calculateWorkOrderScopeTotal([{ precioUnitario: null, productos: [] }], 2), null);
  assert.equal(calculateWorkOrderScopeTotal([{ precioUnitario: 100, productos: [{ precioUnitario: 5, cantidad: undefined }] }], 2), null);
  assert.equal(calculateWorkOrderScopeTotal([{ precioUnitario: 1e16, productos: [] }]), null, "0 decimales: entero seguro");
  assert.equal(calculateWorkOrderScopeTotal([{ precioUnitario: 1e14, productos: [] }], 2), null, "2 decimales: centavos seguros");

  // Ejemplo del enunciado: servicio Bs 50 + 3 repuestos a Bs 3,50 y 2 a Bs 1,25.
  const scope = [
    { precioUnitario: 50, productos: [{ precioUnitario: 3.5, cantidad: 3 }, { precioUnitario: 1.25, cantidad: 2 }] },
    { precioUnitario: 20.4, productos: [] },
  ];
  assert.equal(calculateWorkOrderScopeTotal(scope, 2), 83.4, "50 + 10,50 + 2,50 + 20,40");
  // Con 0 decimales cada línea de producto se redondea al entero (3 × 3,50 = 10,50 → 11) y un precio de servicio con
  // decimales no suma un total entero seguro, así que no hay total (null), exactamente como hoy.
  assert.equal(calculateWorkOrderScopeTotal(scope, 0), null);
  assert.equal(calculateWorkOrderScopeTotal([{ precioUnitario: 50, productos: scope[0].productos }, { precioUnitario: 20, productos: [] }], 0), 50 + 11 + 3 + 20);
  assert.equal(calculateWorkOrderProductLineTotal({ precioUnitario: 3.5, cantidad: 3 }, 2), 10.5);
  assert.equal(calculateWorkOrderProductLineTotal({ precioUnitario: 3.5, cantidad: 3 }, 0), 10.5, "0 decimales: la pantalla de aprobación muestra el producto sin redondear");
  // Cantidad fraccionaria (hasta 3 decimales) y empates: 1,005 → 1,01; 0,1 + 0,2 exacto.
  assert.equal(calculateWorkOrderScopeTotal([{ precioUnitario: 0, productos: [{ precioUnitario: 2.01, cantidad: 0.5 }] }], 2), 1.01);
  assert.equal(calculateWorkOrderScopeTotal([{ precioUnitario: 0.1, productos: [{ precioUnitario: 0.2, cantidad: 1 }] }], 2), 0.3);
  assert.equal(calculateWorkOrderScopeTotal([{ precioUnitario: 0, productos: Array.from({ length: 1000 }, () => ({ precioUnitario: 0.07, cantidad: 1 }))}], 2), 70);
  // Oráculo en centavos para escopes aleatorios con 2 decimales.
  for (let index = 0; index < 20_000; index += 1) {
    const services = Array.from({ length: int(1, 3) }, () => ({
      precioUnitario: int(0, 5_000_000) / 100,
      productos: Array.from({ length: int(0, 3) }, () => ({ precioUnitario: int(1, 100_000) / 100, cantidad: int(1, 3000) / 1000 })),
    }));
    let cents = 0;
    services.forEach((service) => {
      cents += Math.round(service.precioUnitario * 100);
      service.productos.forEach((product) => {
        // precio (centavos) × cantidad (milésimas) / 1000, empate hacia arriba, en enteros.
        const priceCents = Math.round(product.precioUnitario * 100);
        const milli = Math.round(product.cantidad * 1000);
        cents += Math.floor((priceCents * milli + 500) / 1000);
      });
    });
    assert.equal(calculateWorkOrderScopeTotal(services, 2), cents / 100, JSON.stringify(services));
  }

  // Servidor: el precio congelado respeta los decimales de la OT (Math.round con 0, decimal exacto con 2).
  const coreSnapshot = (precioInterno) => ({
    exists: true, id: "core-p1", data: () => ({ negocioId: "b1", tipoItem: "producto", estado: "activo", precioInterno, nombre: "Repuesto", codigoInterno: "P1", unidad: "unidad" }),
  });
  const freeze = (price, decimals) => serverWorkOrder.freezeCoreItem(coreSnapshot(price), "b1", "core-p1", "producto", HttpsError, decimals).precioUnitario;
  for (let index = 0; index < 20_000; index += 1) {
    const price = randomMoney();
    assert.equal(freeze(price), Math.round(price), `congelado ${price}`);
    assert.equal(freeze(price, 0), Math.round(price));
  }
  assert.equal(freeze(3.5, 2), 3.5);
  assert.equal(freeze(3.5, 0), 4);
  assert.equal(freeze(4.555, 2), 4.56);
  assert.equal(freeze(1.005, 2), 1.01);
  assert.throws(() => freeze(1e15, 2), (error) => error.code === "failed-precondition");
  assert.throws(() => freeze(NaN, 2), (error) => error.code === "failed-precondition");
  assert.throws(() => freeze(-1, 2), (error) => error.code === "failed-precondition");
  console.log("OK OT: total y precio congelado idénticos a la fórmula legacy con 0 decimales; 2 decimales exactos en centavos");
}

// ===========================================================================================================
// 6. OT del taller: la Function guarda `montoDecimales` solo si es > 0 y lo deriva del catálogo (Firestore en memoria)
// ===========================================================================================================
{
  const DELETE = Symbol("delete");
  const FieldValue = { serverTimestamp: () => "ts", delete: () => DELETE };
  const makeStore = (seed) => {
    const store = new Map(Object.entries(seed));
    let counter = 0;
    const snapshot = (path) => ({ exists: store.has(path), id: path.split("/").at(-1), data: () => store.get(path) });
    const documentRef = (path) => ({
      path, id: path.split("/").at(-1),
      collection: (name) => collectionRef(`${path}/${name}`),
      get: async () => snapshot(path),
    });
    const collectionRef = (path) => ({ doc: (id) => documentRef(`${path}/${id || `auto${(counter += 1)}`}`) });
    const transaction = {
      get: async (reference) => snapshot(reference.path),
      getAll: async (...references) => references.map((reference) => snapshot(reference.path)),
      create: (reference, data) => store.set(reference.path, data),
      set: (reference, data) => store.set(reference.path, data),
      update: (reference, data) => {
        const next = { ...store.get(reference.path) };
        Object.entries(data).forEach(([key, value]) => { if (value === DELETE) delete next[key]; else next[key] = value; });
        store.set(reference.path, next);
      },
    };
    return {
      store,
      db: { collection: (name) => collectionRef(name), runTransaction: async (callback) => callback(transaction) },
    };
  };
  const createOrder = async (business, businessId = "b1") => {
    const { store, db } = makeStore({
      [`negocios/${businessId}`]: business,
      [`membresias/${businessId}__u1`]: { uid: "u1", negocioId: businessId, estado: "activo", rol: "OWNER" },
      "usuarios/u1": {},
      [`negocios/${businessId}/configuracion/impuestos`]: {},
      [`negocios/${businessId}/vehiculos/v1`]: { vehiculoId: "v1", negocioId: businessId, clienteId: "c1" },
      [`negocios/${businessId}/clientes/c1`]: { clienteId: "c1", negocioId: businessId },
    });
    const dependencies = {
      db, FieldValue, HttpsError,
      auth: { getUser: async () => ({ email: "usuario@example.test" }) },
      requireBusinessAccess: async () => ({
        uid: "u1", businessId, membership: { rol: "OWNER" },
        businessRef: db.collection("negocios").doc(businessId),
        businessSnapshot: { data: () => business },
        membershipRef: db.collection("membresias").doc(`${businessId}__u1`),
      }),
    };
    const response = await serverWorkOrder.crearOrdenTrabajoHandler(
      { data: { ordenTrabajo: { vehiculoId: "v1" }, requestId: "request-12345678" } }, dependencies
    );
    const stored = [...store.entries()].find(([path]) => path.startsWith(`negocios/${businessId}/ordenesTrabajo/`) && !path.includes("/historial/"));
    assert.ok(stored, "la OT se guardó");
    // Reintento idempotente con la misma solicitud: no duplica y devuelve la misma OT.
    const retry = await serverWorkOrder.crearOrdenTrabajoHandler(
      { data: { ordenTrabajo: { vehiculoId: "v1" }, requestId: "request-12345678" } }, dependencies
    );
    assert.equal(retry.sinCambios, true);
    return { response, order: stored[1] };
  };
  const clBusiness = { estado: "activo", paisCodigo: "CL", monedaCodigo: "CLP", contratoJurisdiccionalVersion: 1, verificacionEmpresa: { estado: "VERIFICADA" } };
  const boBusiness = { estado: "activo", paisCodigo: "BO", monedaCodigo: "BOB", contratoJurisdiccionalVersion: 1, verificacionEmpresa: { estado: "VERIFICADA" } };

  // Hoy (catálogo en 0): ni Chile ni Bolivia guardan el campo.
  const cl = await createOrder(clBusiness);
  assert.equal(cl.order.moneda, "CLP");
  assert.equal("montoDecimales" in cl.order, false, "CLP: la OT queda sin montoDecimales, como hoy");
  assert.equal("montoDecimales" in cl.response.ordenTrabajo, false);
  const boZero = await createOrder(boBusiness);
  assert.equal("montoDecimales" in boZero.order, false, "BOB con amountDecimals 0: sin el campo");

  // Con el interruptor en 2 (solo en este proceso): BOB lo guarda, derivado del catálogo; CLP sigue sin él.
  setBobDecimals(2);
  try {
    const bo = await createOrder(boBusiness);
    assert.equal(bo.order.moneda, "BOB");
    assert.equal(bo.order.montoDecimales, 2, "BOB con 2 decimales: la OT congela montoDecimales 2");
    assert.equal(bo.response.ordenTrabajo.montoDecimales, 2);
    assert.equal("montoDecimales" in (await createOrder(clBusiness)).order, false, "CLP no gana el campo");
    // El payload del cliente no puede fijarlo: el campo no está admitido.
    assert.throws(
      () => serverWorkOrder.normalizeWorkOrderInput({ vehiculoId: "v1", montoDecimales: 2 }, HttpsError),
      (error) => error.code === "invalid-argument" && /montoDecimales.*no está admitido/.test(error.message)
    );

    // Catálogo de precios vigentes: usa los decimales de la moneda del negocio (3,50 sigue siendo 3,50).
    const catalogFor = (business) => serverWorkOrder.listarCatalogoTallerHandler({ data: { businessId: "b1" } }, {
      db: {}, HttpsError,
      requireBusinessAccess: async () => ({
        membership: { rol: "OWNER" }, businessId: "b1", businessSnapshot: { data: () => business },
        businessRef: { collection: () => ({ where: () => ({ get: async () => ({ docs: [
          { id: "p1", data: () => ({ negocioId: "b1", tipoItem: "producto", estado: "activo", nombre: "Repuesto", precioInterno: 3.5, stock: 4 }) },
        ] }) }) }) },
      }),
    });
    assert.equal((await catalogFor(boBusiness)).items[0].precioEfectivo, 3.5, "BOB con 2 decimales");
    assert.equal((await catalogFor(clBusiness)).items[0].precioEfectivo, 4, "CLP: Math.round, como siempre");
  } finally {
    setBobDecimals(0);
  }
  assert.equal(serverWorkOrder.workOrderAmountDecimals({ moneda: "BOB" }, "BOB"), 0, "una OT sin montoDecimales sigue entera");
  assert.equal(serverWorkOrder.workOrderAmountDecimals({ moneda: "BOB", montoDecimales: 2 }, "BOB"), 2, "el documento manda");
  assert.equal(serverWorkOrder.workOrderAmountDecimals({ moneda: "BOB", montoDecimales: 2 }, "CLP"), 0, "si la moneda cambió, sale del catálogo");
  assert.equal(serverWorkOrder.workOrderAmountDecimals({ moneda: null }, null), 0);
  assert.equal(serverWorkOrder.workOrderAmountDecimals({ moneda: "CLP", montoDecimales: 2 }, "CLP"), 0, "CLP nunca pasa de 0 decimales");
  setBobDecimals(2);
  try {
    assert.equal(serverWorkOrder.workOrderAmountDecimals({ moneda: null }, "BOB"), 2, "sin moneda guardada sale del catálogo");
    assert.equal(serverWorkOrder.workOrderAmountDecimals({ moneda: "BOB" }, "BOB"), 0, "OT anterior (sin snapshot) sigue entera aunque el catálogo ya sea 2");
  } finally {
    setBobDecimals(0);
  }
  console.log("OK OT: montoDecimales solo si > 0, derivado del catálogo y nunca del cliente; OT anterior sigue entera");
}

// ===========================================================================================================
// 7. Margen comercial: escala por los decimales de la venta
// ===========================================================================================================
{
  const sale = (overrides = {}) => ({
    ventaId: "v1", estado: "confirmada", moneda: "BOB", montoDecimales: 2, descuento: 0, neto: 17.5,
    items: [{ lineaId: "p1", itemId: "i1", tipoItem: "producto", cantidad: 5, precioUnitario: 3.5, descuentoPct: 0 }],
    efectosInventario: [{ movimientoId: "m1", lineaId: "p1", itemId: "i1", cantidad: 5, costoUnitario: 2.37, costoTotal: 11.85, costoHistoricoDisponible: true, moneda: "BOB" }],
    ...overrides,
  });
  // 5 × 3,50 = 17,50 de ingreso; costo 5 × 2,37 = 11,85; margen 5,65 (32,29 %).
  const margin = calculateSaleCommercialMarginV1(sale());
  assert.equal(margin.estado, STATUS.COMPLETE);
  assert.deepEqual(
    [margin.ingresoNetoProductos, margin.costoHistoricoProductos, margin.margenBrutoProductos, margin.margenBrutoPct],
    [17.5, 11.85, 5.65, 32.29]
  );
  const detail = calculateSaleProductLineMarginsV1(sale());
  assert.deepEqual(
    [detail.lineas[0].ingresoNeto, detail.lineas[0].costoHistorico, detail.lineas[0].margenBruto],
    [17.5, 11.85, 5.65]
  );
  // Costo repartido en varios efectos: se suma en centavos, sin deriva de punto flotante (0,1 + 0,2).
  const split = calculateSaleCommercialMarginV1(sale({
    neto: 0.5,
    items: [{ lineaId: "p1", itemId: "i1", tipoItem: "producto", cantidad: 5, precioUnitario: 0.1, descuentoPct: 0 }],
    efectosInventario: [
      { movimientoId: "m1", lineaId: "p1", itemId: "i1", cantidad: 2, costoUnitario: 0.05, costoTotal: 0.1, moneda: "BOB" },
      { movimientoId: "m2", lineaId: "p1", itemId: "i1", cantidad: 3, costoUnitario: 0.0667, costoTotal: 0.2, moneda: "BOB" },
    ],
  }));
  assert.equal(split.costoHistoricoProductos, 0.3);
  assert.equal(split.margenBrutoProductos, 0.2);
  // Con 0 decimales (CLP o BOB sin snapshot) todo igual que antes: costo en centavos, margen entero.
  const clp = calculateSaleCommercialMarginV1({
    ventaId: "v2", estado: "confirmada", moneda: "CLP", descuento: 0, neto: 10000,
    items: [{ lineaId: "p1", itemId: "i1", tipoItem: "producto", cantidad: 4, precioUnitario: 2500, descuentoPct: 0 }],
    efectosInventario: [{ movimientoId: "m1", lineaId: "p1", itemId: "i1", cantidad: 4, costoUnitario: 1234.567, costoTotal: 4938.268, moneda: "CLP" }],
  });
  assert.deepEqual([clp.costoHistoricoProductos, clp.margenBrutoProductos, clp.margenBrutoPct], [4938.27, 5061.73, 50.62]);
  const clpDetail = calculateSaleProductLineMarginsV1({
    ventaId: "v2", estado: "confirmada", moneda: "CLP", descuento: 0, neto: 10000,
    items: [{ lineaId: "p1", itemId: "i1", tipoItem: "producto", cantidad: 4, precioUnitario: 2500, descuentoPct: 0 }],
    efectosInventario: [{ movimientoId: "m1", lineaId: "p1", itemId: "i1", cantidad: 4, costoUnitario: 1234.567, costoTotal: 4938.268, moneda: "CLP" }],
  });
  assert.deepEqual([clpDetail.lineas[0].costoHistorico, clpDetail.lineas[0].margenBruto], [4938.27, 5061.73]);
  // La escala sale de los decimales de la venta: nunca menor que centavos y sin cifras fijas en el código.
  const source = await readFile("src/domain/saleCommercialMargin.mjs", "utf8");
  assert.match(source, /function moneyScale\(decimals = 0\)/);
  assert.doesNotMatch(source, /const toCents = /, "sin toCents fijo en 100");
  assert.doesNotMatch(source, /\* 100\)\s*-\s*costCents/, "sin escala fija en el margen por línea");
  console.log("OK margen: costo y margen en centavos con 2 decimales; CLP sin cambios; sin toCents fijo");
}

// ===========================================================================================================
// 8. Movimientos financieros: modelo, adaptador, CSV, diálogo y reglas
// ===========================================================================================================
{
  const input = (amount, overrides = {}) => ({
    type: "income", status: "paid", amount, date: "2026-11-20", concept: "Venta", categoryId: "sales", paymentMethodId: "cash", ...overrides,
  });
  const normalize = (amount, options = {}) => normalizeFinancialMovementInput(input(amount), { businessId: "b1", userId: "u1", ...options });
  // Con 0 decimales: exactamente la validación y el mensaje de siempre.
  for (const amount of [1, 1000, 130000, Number.MAX_SAFE_INTEGER]) {
    assert.equal(normalize(amount).amount, amount);
    assert.equal(normalize(amount, { amountDecimals: 0 }).amount, amount);
  }
  for (const amount of [0, -1, 1.5, 10.25, NaN, Infinity, Number.MAX_SAFE_INTEGER + 2]) {
    assert.throws(() => normalize(amount), /El monto debe ser un número entero mayor que cero\./, `0 decimales: ${amount}`);
    assert.throws(() => normalize(amount, { amountDecimals: 0 }), /El monto debe ser un número entero mayor que cero\./);
  }
  // Con 2 decimales: hasta 2 decimales, mayor que cero, dentro del rango seguro de centavos.
  assert.equal(normalize(10.5, { amountDecimals: 2 }).amount, 10.5);
  assert.equal(normalize(3.5, { amountDecimals: 2 }).amount, 3.5);
  assert.equal(normalize(0.01, { amountDecimals: 2 }).amount, 0.01);
  assert.equal(normalize(130000, { amountDecimals: 2 }).amount, 130000);
  for (const amount of [0, -0.01, 10.555, 0.001, NaN, Infinity, 1e14]) {
    assert.throws(() => normalize(amount, { amountDecimals: 2 }), /mayor que cero, con hasta 2 decimales\./, `2 decimales: ${amount}`);
  }
  // Un valor inválido de decimales cuenta como 0 (nunca abre límites).
  assert.throws(() => normalize(10.5, { amountDecimals: 9 }), /entero/);
  assert.throws(() => normalize(10.5, { amountDecimals: "2" }), /entero/);

  // Adaptador: enteros como siempre; con decimales, el monto guardado se lee tal cual.
  assert.equal(adaptFinancialMovement({ amount: 1000 }).amount, 1000);
  assert.equal(adaptFinancialMovement({ amount: 10.5 }).amount, 10.5);
  assert.equal(adaptFinancialMovement({ amount: "10.5" }).amount, 10.5);
  for (const bad of [undefined, null, "", NaN, Infinity, "abc", Number.MAX_SAFE_INTEGER + 2]) {
    assert.equal(adaptFinancialMovement({ amount: bad }).amount, 0, `monto inválido: ${bad}`);
  }

  // CSV: con 0 decimales, el número de siempre; con 2, coma decimal y siempre los decimales de la moneda.
  const movements = [
    { date: "2026-11-20", concept: "Venta", type: "income", status: "paid", categoryId: "sales", paymentMethodId: "cash", counterpartyName: "", reference: "", amount: 1000, sourceType: "manual" },
    { date: "2026-11-21", concept: "Repuesto", type: "expense", status: "paid", categoryId: "purchases", paymentMethodId: "cash", counterpartyName: "", reference: "", amount: 10.5, sourceType: "manual" },
    { date: "2026-11-22", concept: "Servicio", type: "income", status: "pending", categoryId: "services", paymentMethodId: "cash", counterpartyName: "", reference: "", amount: 3, sourceType: "manual" },
  ];
  const amountColumn = (csv) => csv.slice(1).split("\r\n").slice(1).map((row) => row.split(";")[8]);
  assert.deepEqual(amountColumn(buildFinancialCsv(movements.slice(0, 1), "CLP")), ["1000"], "CLP: igual que antes");
  assert.equal(buildFinancialCsv(movements.slice(0, 1), "CLP"), buildFinancialCsv(movements.slice(0, 1), "CLP", { amountDecimals: 0 }));
  // Las celdas con coma salen entrecomilladas (CSV válido): Excel las lee como número con coma decimal.
  assert.deepEqual(amountColumn(buildFinancialCsv(movements, "BOB", { amountDecimals: 2 })), ['"1000,00"', '"10,50"', '"3,00"']);
  assert.deepEqual(amountColumn(buildFinancialCsv(movements, "BOB")), ["1000", '"10,5"', "3"], "un monto con decimales no se trunca aunque el interruptor esté en 0");
  assert.match(buildFinancialCsv(movements, "BOB", { amountDecimals: 2 }).split("\r\n")[0], /;Monto BOB;/);

  // Diálogo y reglas (texto fuente).
  const dialog = await readFile("src/components/finance/FinancialMovementDialog.jsx", "utf8");
  assert.match(dialog, /const \{ currency, amountDecimals \} = useBusinessFormat\(\);/);
  assert.match(dialog, /const moneyStep = amountDecimals > 0 \? String\(10 \*\* -amountDecimals\) : "1";/, 'paso "1" con 0 decimales, como hoy');
  assert.match(dialog, /min=\{moneyStep\}\s+step=\{moneyStep\}/);
  assert.match(dialog, /inputMode=\{amountDecimals > 0 \? "decimal" : "numeric"\}/);
  const financeService = await readFile("src/services/financialService.js", "utf8");
  assert.match(financeService, /createFinancialMovement\(businessId, input, \{ amountDecimals = 0 \} = \{\}\)/);
  assert.match(financeService, /updateFinancialMovement\(businessId, movementId, input, \{ amountDecimals = 0 \} = \{\}\)/);
  assert.equal((financeService.match(/amountDecimals \}/g) || []).length, 2, "create y update pasan amountDecimals al modelo");
  const financePage = await readFile("src/pages/FinancePage.jsx", "utf8");
  assert.match(financePage, /const \{ currency: businessCurrency, amountDecimals \} = useBusinessFormat\(\);/);
  assert.match(financePage, /createFinancialMovement\(businessId, payload, \{ amountDecimals \}\)/);
  assert.match(financePage, /updateFinancialMovement\(businessId, dialogState\.movement\.id, payload, \{ amountDecimals \}\)/);
  assert.match(financePage, /buildFinancialCsv\(filteredItems, businessCurrency, \{ amountDecimals \}\)/);

  const rules = await readFile("firestore.rules", "utf8");
  const structure = rules.slice(rules.indexOf("function hasValidFinancialMovementStructure"), rules.indexOf("function isAllowedFinancialMovementCreate"));
  assert.doesNotMatch(structure, /amount is int/, "las reglas ya no exigen un entero");
  assert.match(structure, /request\.resource\.data\.amount is number\s+&& request\.resource\.data\.amount > 0\s+&& request\.resource\.data\.amount <= 9007199254740991/);
  assert.doesNotMatch(structure, /get\(|exists\(/, "la regla no lee el negocio por movimiento");
  assert.equal((structure.match(/"amount"/g) || []).length, 2, "amount sigue en hasAll y hasOnly");
  console.log("OK movimientos financieros: 0 decimales idéntico; 2 decimales exactos; reglas aceptan número positivo con tope");
}

// ===========================================================================================================
// 9. Pantallas: moneyStep en el inventario, decimales hacia el modelo, ApprovalPanel y Functions sin Math.round suelto
// ===========================================================================================================
{
  const manager = await readFile("src/features/inventory/InventoryManager.jsx", "utf8");
  assert.match(manager, /const amountDecimals = formatBusinessAmount\.amountDecimals;/);
  assert.match(manager, /const moneyStep = amountDecimals > 0 \? String\(10 \*\* -amountDecimals\) : "any";/, 'paso "any" con 0 decimales, como hoy');
  assert.equal((manager.match(/step=\{moneyStep\} value=\{draft\.costoBase\}/g) || []).length, 2, "costo: producto y servicio/actividad");
  assert.match(manager, /step=\{moneyStep\} value=\{draft\.precioManual\}/);
  assert.doesNotMatch(manager, /step="any" value=\{draft\.(costoBase|precioManual)\}/);
  // Cantidad y porcentaje conservan su paso actual.
  assert.match(manager, /step="any" value=\{draft\.margenDeseado\}/);
  assert.match(manager, /step="any" value=\{draft\.stock\}/);
  assert.match(manager, /validateInventoryDraft\(\{\.\.\.draft, codigoSolicitado: ""\}, \{decimals: amountDecimals\}\)/);
  assert.match(manager, /allowRequestedCode: false,\s+decimals: amountDecimals,/);
  assert.match(manager, /\}, amountDecimals\);/, "la formación de precio del borrador usa los decimales");
  assert.match(manager, /filterInventoryItems\(items, \{\.\.\.filters, decimals: amountDecimals\}\)/);
  // Con 0 decimales la llamada es la de siempre (los smokes del formulario fijan ese texto); con decimales, la misma más el paso.
  assert.match(manager, /amountDecimals === 0\s+\? calculateInventoryPriceWithTax\(effectivePrice, businessTaxRate\)\s+: calculateInventoryPriceWithTax\(effectivePrice, businessTaxRate, amountDecimals\)/);
  assert.doesNotMatch(manager, /adaptInventoryItem\((rawItem|item)\)/, "toda adaptación de precios recibe los decimales");
  assert.doesNotMatch(manager, /adaptInventoryItem\(editingItem\)\.precio/, "ni el precio sugerido del ítem editado");

  const approval = await readFile("src/features/workOrders/ApprovalPanel.jsx", "utf8");
  assert.match(approval, /adaptDocumentAmountDecimals\(summary, summary\.moneda\)/);
  assert.match(approval, /calculateWorkOrderScopeTotal\(summary\.alcance, decimals\)/);
  assert.match(approval, /calculateWorkOrderProductLineTotal\(product, decimals\)/);

  // Functions: toda redondeo de precio de las áreas de la entrega pasa por una rama de 0 decimales o por el helper.
  const workOrderSource = await readFile("functions/workOrderPersistence.js", "utf8");
  assert.match(workOrderSource, /\.\.\.\(montoDecimales > 0 \? \{montoDecimales\} : \{\}\)/);
  assert.match(workOrderSource, /decimals === 0 \? Math\.round\(item\.precioInterno\) : roundMoney\(item\.precioInterno, decimals\)/);
  assert.match(workOrderSource, /decimals === 0 \? Math\.round\(price\) : roundMoney\(price, decimals\)/);
  assert.match(workOrderSource, /action === "enviar" && decimals !== storedDecimals/);
  const inventorySource = await readFile("functions/inventoryModel.js", "utf8");
  assert.equal((inventorySource.match(/businessAmountDecimals\(businessContext\)/g) || []).length, 3, "crear, editar e importar leen los decimales del negocio");
  assert.doesNotMatch(inventorySource, /decimals:\s*request\.data/, "los decimales nunca salen del payload");
  const acquisitionSource = await readFile("functions/inventoryAcquisition.js", "utf8");
  assert.doesNotMatch(acquisitionSource, /require\("\.\/money"\)/, "inventoryAcquisition.js no cambió: ya trabaja con centavos");
  console.log("OK pantallas y Functions: moneyStep, decimales al modelo y decimales siempre derivados en el servidor");
}

console.log("OK entrega C: inventario, OT, margen y movimientos con decimales por moneda");
