import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  getCurrencyAmountDecimals,
  getCurrencyPluralName,
  CURRENCIES,
} from "../src/domain/businessCatalog.js";
import {
  aggregateFinancialByCategory,
  aggregateFinancialTimeline,
  compareFinancialSummaries,
  getFinancialSummary,
  summarizeFinancialMovements,
} from "../src/domain/financialMovement.mjs";
import { sumMoney } from "../src/domain/money.mjs";
import {
  aggregateOperationalTimeline,
  getPurchaseMetrics,
  getSalesMetrics,
  getTopSalesClients,
  groupAmountsByCurrency,
} from "../src/domain/reportModel.mjs";
import { aggregateCommercialSalesV4 } from "../src/domain/reportProfitabilityV4.mjs";
import { calculatePurchaseTotals } from "../src/domain/purchaseModel.mjs";
import { calculateSaleCommercialMarginV1 } from "../src/domain/saleCommercialMargin.mjs";
import { calculateSaleTotals } from "../src/domain/saleModel.mjs";

// SPEC 036, entrega D: BOB calcula con 2 decimales y el aviso de redondeo se retiró. Esta prueba cubre lo que no tiene
// emuladores: la verificación server-side de inventario con el contexto REAL de requireOperationalBusinessAccess,
// las sumas de Finanzas, la consistencia de los reportes con datos en BOB y el rollback a 0.
const require = createRequire(import.meta.url);
const catalog = require("../functions/businessCatalog.json");
const localization = require("../functions/localization.js");
const serverInventory = require("../functions/inventoryModel.js");
const { requireOperationalBusinessAccess } = require("../functions/businessOnboarding.js");

const setBobDecimals = (decimals) => {
  catalog.currencies.find((currency) => currency.code === "BOB").amountDecimals = decimals;
};

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

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
const random = makeRandom(36_004);
const int = (min, max) => min + Math.floor(random() * (max - min + 1));
const pick = (list) => list[Math.floor(random() * list.length)];

// ===========================================================================================================
// 1. Catálogo: BOB en 2, el resto en 0; rollback documentado
// ===========================================================================================================
{
  for (const currency of catalog.currencies) {
    assert.equal(currency.amountDecimals, currency.code === "BOB" ? 2 : 0, `${currency.code}: amountDecimals`);
    assert.equal(getCurrencyAmountDecimals(currency.code), currency.amountDecimals);
    assert.equal(localization.currencyAmountDecimals(currency.code), currency.amountDecimals);
  }
  assert.equal(catalog.currencies.find((currency) => currency.code === "BOB").decimals, 2, "el formato de BOB ya era 2");
  assert.equal(catalog.schemaVersion, 6, "el esquema no cambió: solo cambió un valor de BOB");
  // Rollback: volver BOB a 0 devuelve el cálculo entero (y el snapshot de los documentos nuevos).
  setBobDecimals(0);
  try {
    assert.equal(localization.currencyAmountDecimals("BOB"), 0);
    assert.equal(getCurrencyAmountDecimals("BOB"), 0);
    assert.equal(localization.documentLocalizationSnapshot({ paisCodigo: "BO", monedaCodigo: "BOB", contratoJurisdiccionalVersion: 1 }, {}).montoDecimales, 0);
  } finally {
    setBobDecimals(2);
  }
  assert.equal(localization.documentLocalizationSnapshot({ paisCodigo: "BO", monedaCodigo: "BOB", contratoJurisdiccionalVersion: 1 }, {}).montoDecimales, 2);
  assert.equal(localization.documentLocalizationSnapshot({ paisCodigo: "CL", monedaCodigo: "CLP", contratoJurisdiccionalVersion: 1 }, {}).montoDecimales, 0, "Chile sigue en 0");
  console.log("OK catálogo: BOB en 2 decimales, el resto en 0, esquema sin cambios y rollback a 0");
}

// ===========================================================================================================
// 2. Aviso de redondeo retirado y onboarding de Chile idéntico
// ===========================================================================================================
{
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
    assert.doesNotMatch(await readFile(path, "utf8"), /AmountRounding|amountRounding|getAmountRoundingNote|ui-amount-rounding-notice|se redondean al entero/, `${path}: sin restos`);
  }
  // Ningún archivo del proyecto (fuera de pruebas y docs) importa ya los módulos eliminados.
  const { readdir } = await import("node:fs/promises");
  const walk = async (directory) => (await Promise.all((await readdir(directory, { withFileTypes: true })).map(async (entry) => {
    if (entry.name === "node_modules") return [];
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(path) : [path];
  }))).flat();
  const leftovers = [];
  for (const path of [...await walk("src"), ...await walk("functions")].filter((file) => /\.(jsx?|mjs|cjs|css|json)$/.test(file))) {
    if (/amountRounding|AmountRoundingNotice/.test(await readFile(path, "utf8"))) leftovers.push(path);
  }
  assert.deepEqual(leftovers, [], "sin referencias a los módulos eliminados");
  console.log("OK aviso de redondeo retirado: módulos eliminados y sin restos en src ni functions");
}

// ===========================================================================================================
// 3. Textos de moneda en Finanzas
// ===========================================================================================================
{
  assert.equal(getCurrencyPluralName("CLP"), "pesos chilenos", "Chile: el texto de siempre");
  assert.equal(getCurrencyPluralName("BOB"), "bolivianos");
  assert.equal(getCurrencyPluralName("bob"), "bolivianos");
  for (const currency of CURRENCIES) {
    assert.notEqual(getCurrencyPluralName(currency.code), currency.code, `${currency.code}: tiene nombre en plural`);
  }
  assert.equal(getCurrencyPluralName("XXX"), "XXX", "una moneda desconocida usa su código");
  const dialog = await readFile("src/components/finance/FinancialMovementDialog.jsx", "utf8");
  assert.doesNotMatch(dialog, /pesos chilenos/, "el diálogo ya no fija la moneda");
  assert.match(dialog, /description=\{`Los montos se registran en \$\{getCurrencyPluralName\(currency\)\} y los pendientes no afectan el resultado neto\.`\}/);
  console.log("OK Finanzas: el diálogo usa la moneda del negocio (Chile conserva «pesos chilenos»)");
}

// ===========================================================================================================
// 4. Sumas de Finanzas: 0 decimales idéntico al `+=` de hoy; 2 decimales exactos
// ===========================================================================================================
{
  const legacySummarize = (movements) => movements.reduce((summary, movement) => {
    const amount = Number(movement.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return summary;
    if (movement.type === "income" && movement.status === "paid") summary.paidIncome += amount;
    if (movement.type === "expense" && movement.status === "paid") summary.paidExpense += amount;
    if (movement.type === "income" && movement.status === "pending") summary.receivable += amount;
    if (movement.type === "expense" && movement.status === "pending") summary.payable += amount;
    summary.count += 1;
    return summary;
  }, { paidIncome: 0, paidExpense: 0, netResult: 0, receivable: 0, payable: 0, count: 0 });
  const legacyTimeline = (movements, range) => {
    const useMonths = Number(range?.days || 0) > 62;
    const buckets = new Map();
    movements.forEach((movement) => {
      const key = useMonths ? movement.date.slice(0, 7) : movement.date;
      const current = buckets.get(key) || { key, income: 0, expense: 0, net: 0 };
      if (movement.status === "paid" && movement.type === "income") current.income += Number(movement.amount || 0);
      if (movement.status === "paid" && movement.type === "expense") current.expense += Number(movement.amount || 0);
      current.net = current.income - current.expense;
      buckets.set(key, current);
    });
    return [...buckets.values()].sort((left, right) => left.key.localeCompare(right.key));
  };
  const movement = (type, status, amount, date = "2026-11-20", categoryId = type === "income" ? "sales" : "purchases") => ({ type, status, amount, date, categoryId });
  const randomMovements = (count, makeAmount) => Array.from({ length: count }, () =>
    movement(pick(["income", "expense"]), pick(["paid", "pending"]), makeAmount(), `2026-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`, pick(["sales", "services", "purchases", "rent"])));
  for (let round = 0; round < 400; round += 1) {
    const items = randomMovements(int(0, 60), () => pick([() => int(1, 5_000_000), () => 0, () => -3, () => int(1, 200_000_00) / 100])());
    const legacy = legacySummarize(items);
    legacy.netResult = Number(legacy.paidIncome || 0) - Number(legacy.paidExpense || 0);
    assert.deepEqual(summarizeFinancialMovements(items), legacySummarize(items), "sin decimales: la suma de siempre");
    assert.deepEqual(summarizeFinancialMovements(items, 0), legacySummarize(items));
    assert.deepEqual(getFinancialSummary(items), legacy);
    assert.deepEqual(getFinancialSummary(items, 0), legacy);
    for (const range of [{ days: 30 }, { days: 200 }]) {
      assert.deepEqual(aggregateFinancialTimeline(items, range), legacyTimeline(items, range), "línea de tiempo idéntica con 0 decimales");
      assert.deepEqual(aggregateFinancialTimeline(items, range, 0), legacyTimeline(items, range));
    }
  }
  // Con 2 decimales: la suma exacta en centavos (nada de 0,1 + 0,2).
  assert.deepEqual(getFinancialSummary([movement("income", "paid", 0.1), movement("income", "paid", 0.2)], 2).paidIncome, 0.3);
  assert.equal(getFinancialSummary([movement("income", "paid", 0.1), movement("income", "paid", 0.2)]).paidIncome, 0.1 + 0.2, "el 0 decimales conserva el += de hoy");
  const cents = (value) => Math.round(value * 100);
  for (let round = 0; round < 600; round += 1) {
    const items = randomMovements(int(1, 80), () => int(1, 9_000_000) / 100);
    const oracle = { paidIncome: 0, paidExpense: 0, receivable: 0, payable: 0 };
    items.forEach((item) => {
      const key = item.type === "income" ? (item.status === "paid" ? "paidIncome" : "receivable") : (item.status === "paid" ? "paidExpense" : "payable");
      oracle[key] += cents(item.amount);
    });
    const summary = getFinancialSummary(items, 2);
    for (const key of ["paidIncome", "paidExpense", "receivable", "payable"]) assert.equal(summary[key], oracle[key] / 100, key);
    assert.equal(summary.netResult, (oracle.paidIncome - oracle.paidExpense) / 100, "resultado neto en centavos");
    assert.equal(summary.count, items.length);
    const timeline = aggregateFinancialTimeline(items, { days: 365 }, 2);
    assert.equal(sumMoney(timeline.map((bucket) => bucket.income), 2), oracle.paidIncome / 100, "la línea de tiempo suma lo mismo que el resumen");
    assert.equal(sumMoney(timeline.map((bucket) => bucket.net), 2), (oracle.paidIncome - oracle.paidExpense) / 100);
    const byCategory = aggregateFinancialByCategory(items, "income", 2);
    assert.equal(sumMoney(byCategory.map((entry) => entry.value), 2), (oracle.paidIncome + oracle.receivable) / 100, "las categorías suman todo el ingreso");
  }
  const comparison = compareFinancialSummaries({ paidIncome: 0.3 }, { paidIncome: 0.1 }, 2);
  assert.equal(comparison.paidIncome.absolute, 0.2, "0,3 − 0,1 = 0,2 y no 0,19999999999999998");
  assert.equal(compareFinancialSummaries({ paidIncome: 0.3 }, { paidIncome: 0.1 }).paidIncome.absolute, 0.3 - 0.1, "0 decimales: la resta de siempre");
  const hook = await readFile("src/hooks/useFinancialMovements.js", "utf8");
  assert.match(hook, /getFinancialSummary\(state\.items, amountDecimals\)/);
  console.log("OK sumas de Finanzas: idénticas con 0 decimales y exactas en centavos con 2");
}

// ===========================================================================================================
// 5. Reportes con datos en BOB: ventas, compras, margen y finanzas suman lo mismo, sin deriva
// ===========================================================================================================
{
  const range = { start: "2026-01-01", end: "2026-12-31", days: 365 };
  const bobSale = (index) => {
    const lines = Array.from({ length: int(1, 4) }, () => ({ cantidad: int(1, 12), precioUnitario: int(1, 50_000) / 100, descuentoPct: pick([0, 0, 5, 10]) }));
    const totals = calculateSaleTotals(lines, 0, { tasaIva: 0.13, montoDecimales: 2 });
    return {
      ventaId: `v${index}`, estado: "confirmada", moneda: "BOB", montoDecimales: 2, fechaVenta: `2026-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`,
      clienteId: `c${int(1, 4)}`, clienteSnapshot: { nombreRazonSocial: "Cliente" }, descuento: 0,
      items: lines.map((line, position) => ({ lineaId: `l${position}`, itemId: `i${position}`, tipoItem: "producto", ...line })),
      subtotal: totals.subtotal, neto: totals.neto, iva: totals.iva, total: totals.total,
      efectosInventario: lines.map((line, position) => {
        const costoUnitario = int(1, Math.max(1, Math.round(line.precioUnitario * 100))) / 100;
        return { movimientoId: `m${index}-${position}`, lineaId: `l${position}`, itemId: `i${position}`, cantidad: line.cantidad, costoUnitario, costoTotal: Math.round(costoUnitario * line.cantidad * 100) / 100, costoHistoricoDisponible: true, moneda: "BOB" };
      }),
    };
  };
  const sales = Array.from({ length: 300 }, (_, index) => bobSale(index));
  const centsOf = (value) => Math.round(value * 100);
  const netCents = sales.reduce((total, sale) => total + centsOf(sale.neto), 0);
  // Cada documento está bien formado (neto + IVA = total, en centavos).
  sales.forEach((sale) => assert.equal(centsOf(sale.neto) + centsOf(sale.iva), centsOf(sale.total), `${sale.ventaId}: neto + IVA = total`));

  const metrics = getSalesMetrics(sales, range, { fallbackCurrency: "BOB" });
  assert.equal(metrics.count, sales.length);
  assert.equal(metrics.total, netCents / 100, "el total de ventas es la suma exacta de los netos");
  assert.equal(metrics.totalsByCurrency[0].total, netCents / 100);
  assert.equal(metrics.average, metrics.total / sales.length);
  assert.equal(Number(metrics.total.toFixed(2)), metrics.total, "el total cae en centavos exactos, sin deriva");
  // Línea de tiempo y ranking: cada total en centavos y todos suman el total del período.
  const timeline = aggregateOperationalTimeline(metrics.confirmed, { range, dateField: "fechaVenta", fallbackCurrency: "BOB" });
  timeline.forEach((entry) => assert.equal(Number(entry.value.toFixed(2)), entry.value, `${entry.key}: en centavos exactos, sin deriva`));
  assert.equal(sumMoney(timeline.map((entry) => entry.value), 2), netCents / 100, "la línea de tiempo suma el total de ventas");
  const top = getTopSalesClients(metrics.confirmed, { fallbackCurrency: "BOB", limit: 10 });
  assert.equal(sumMoney(top[0].entries.map((entry) => entry.total), 2), netCents / 100, "el ranking de clientes suma el total");
  assert.equal(groupAmountsByCurrency(sales, { amountField: "total", fallbackCurrency: "BOB" })[0].total, sumMoney(sales.map((sale) => sale.total), 2), "con IVA también");

  // Margen: ingreso neto de productos − costo histórico = margen, en centavos, por venta y agregado.
  let marginCents = 0;
  let revenueCents = 0;
  let costCents = 0;
  sales.forEach((sale) => {
    const margin = calculateSaleCommercialMarginV1(sale);
    assert.equal(margin.estado, "COMPLETO", `${sale.ventaId}: margen completo`);
    assert.equal(centsOf(margin.ingresoNetoProductos) - centsOf(margin.costoHistoricoProductos), centsOf(margin.margenBrutoProductos), `${sale.ventaId}: ingreso − costo = margen`);
    marginCents += centsOf(margin.margenBrutoProductos);
    revenueCents += centsOf(margin.ingresoNetoProductos);
    costCents += centsOf(margin.costoHistoricoProductos);
  });
  assert.equal(revenueCents, netCents, "el ingreso de productos es el neto de las ventas (todo son productos)");
  const aggregate = aggregateCommercialSalesV4(sales);
  const group = aggregate.grupos[0].metricas;
  assert.equal(aggregate.grupos[0].moneda, "BOB");
  assert.equal(group.ingresoNetoProductosCubiertos, revenueCents / 100);
  assert.equal(group.costoHistoricoProductosCubiertos, costCents / 100);
  assert.equal(group.margenBrutoProductosCubiertos, marginCents / 100, "el margen agregado es la suma de los márgenes de cada venta");
  assert.equal(group.ventasNetasConfirmadasConocidas, netCents / 100);

  // Compras: el neto y el total del período, sumas exactas.
  const bobPurchase = (index) => {
    const lines = Array.from({ length: int(1, 4) }, () => ({ cantidad: int(1, 20), costoUnitario: int(1, 30_000) / 100, descuentoPct: pick([0, 0, 5]) }));
    const totals = calculatePurchaseTotals(lines, { tasaIva: 0.13, montoDecimales: 2 });
    return { compraId: `p${index}`, estado: "confirmada", moneda: "BOB", montoDecimales: 2, fechaCompra: `2026-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`, neto: totals.neto, iva: totals.iva, total: totals.total };
  };
  const purchases = Array.from({ length: 200 }, (_, index) => bobPurchase(index));
  const purchaseMetrics = getPurchaseMetrics(purchases, range, { fallbackCurrency: "BOB" });
  const purchaseNet = purchases.reduce((total, purchase) => total + centsOf(purchase.neto), 0);
  const purchaseGroup = groupAmountsByCurrency(purchases, { amountField: "neto", fallbackCurrency: "BOB" })[0];
  assert.equal(purchaseGroup.total, purchaseNet / 100, "el total de compras es la suma exacta de los netos");
  assert.equal(purchaseMetrics.total, purchaseNet / 100, "getPurchaseMetrics da el mismo total");
  purchases.forEach((purchase) => assert.equal(centsOf(purchase.neto) + centsOf(purchase.iva), centsOf(purchase.total), `${purchase.compraId}: neto + IVA = total`));

  // Chile: los reportes no cambian (las sumas de enteros ya eran exactas y no se tocan).
  const clpSales = Array.from({ length: 200 }, (_, index) => ({ ventaId: `c${index}`, estado: "confirmada", moneda: "CLP", fechaVenta: "2026-05-10", neto: int(1000, 900_000), total: 0 }));
  const clpMetrics = getSalesMetrics(clpSales, range, { fallbackCurrency: "CLP" });
  assert.equal(clpMetrics.total, clpSales.reduce((total, sale) => total + sale.neto, 0), "CLP: la suma de siempre");
  assert.equal(clpMetrics.average, clpMetrics.total / clpSales.length);
  // Una moneda sin decimales de cálculo no se redondea ni siquiera si un dato antiguo trajera decimales: se suma como hoy.
  const dirty = [{ moneda: "CLP", neto: 0.1 }, { moneda: "CLP", neto: 0.2 }];
  assert.equal(groupAmountsByCurrency(dirty, { amountField: "neto" })[0].total, 0.1 + 0.2, "CLP no se limpia: idéntico a hoy");
  assert.equal(groupAmountsByCurrency([{ moneda: "BOB", neto: 0.1 }, { moneda: "BOB", neto: 0.2 }], { amountField: "neto" })[0].total, 0.3, "BOB sí");
  console.log("OK reportes con datos en BOB: ventas, compras, margen y finanzas son consistentes en centavos; Chile sin cambios");
}

// ===========================================================================================================
// 6. Verificación server-side de inventario en un negocio BOB, con el contexto REAL de requireOperationalBusinessAccess
// ===========================================================================================================
{
  class Snapshot {
    constructor(id, value) {
      this.id = id;
      this.value = value;
      this.exists = value !== undefined;
    }

    data() {
      return this.value === undefined ? undefined : structuredClone(this.value);
    }
  }
  class DocumentReference {
    constructor(db, path) {
      this.db = db;
      this.path = path;
      this.id = path.split("/").at(-1);
    }

    collection(name) {
      return new CollectionReference(this.db, `${this.path}/${name}`);
    }

    async get() {
      return new Snapshot(this.id, this.db.documents.get(this.path));
    }
  }
  class CollectionReference {
    constructor(db, path) {
      this.db = db;
      this.path = path;
    }

    doc(id) {
      return new DocumentReference(this.db, `${this.path}/${id || `auto_${++this.db.autoId}`}`);
    }

    async get() {
      const prefix = `${this.path}/`;
      const docs = [...this.db.documents.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        .map(([path, value]) => new Snapshot(path.slice(prefix.length), value));
      return { docs, size: docs.length };
    }
  }
  class Firestore {
    constructor() {
      this.documents = new Map();
      this.autoId = 0;
      this.queue = Promise.resolve();
    }

    collection(name) {
      return new CollectionReference(this, name);
    }

    seed(path, value) {
      this.documents.set(path, structuredClone(value));
    }

    matching(prefix) {
      return [...this.documents.entries()].filter(([path]) => path.startsWith(prefix));
    }

    runTransaction(callback) {
      const operation = this.queue.then(async () => {
        const working = new Map([...this.documents.entries()].map(([path, value]) => [path, structuredClone(value)]));
        const transaction = {
          get: async (reference) => new Snapshot(reference.id, working.has(reference.path) ? structuredClone(working.get(reference.path)) : undefined),
          getAll: async (...references) => references.map((reference) => new Snapshot(reference.id, working.has(reference.path) ? structuredClone(working.get(reference.path)) : undefined)),
          set: (reference, value, options = {}) => {
            const current = working.get(reference.path) || {};
            working.set(reference.path, options.merge ? { ...current, ...structuredClone(value) } : structuredClone(value));
          },
          create: (reference, value) => working.set(reference.path, structuredClone(value)),
          update: (reference, value) => working.set(reference.path, { ...working.get(reference.path), ...structuredClone(value) }),
          delete: (reference) => working.delete(reference.path),
        };
        const result = await callback(transaction);
        this.documents = working;
        return result;
      });
      this.queue = operation.then(() => undefined, () => undefined);
      return operation;
    }
  }
  const FieldValue = { serverTimestamp: () => ({ __serverTimestamp: true }), delete: () => ({ __delete: true }) };

  const seedBusiness = (db, businessId, business) => {
    db.seed(`negocios/${businessId}`, { estado: "activo", contratoJurisdiccionalVersion: 1, verificacionEmpresa: { estado: "VERIFICADA" }, ...business });
    db.seed(`membresias/${businessId}__owner-1`, { uid: "owner-1", negocioId: businessId, estado: "activo", rol: "OWNER" });
    db.seed("usuarios/owner-1", {});
    db.seed(`negocios/${businessId}/configuracion/impuestos`, {});
    db.seed(`negocios/${businessId}/configuracion/inventario`, {});
  };
  const BOLIVIA = { paisCodigo: "BO", monedaCodigo: "BOB" };
  const CHILE = { paisCodigo: "CL", monedaCodigo: "CLP" };
  const makeDeps = (db) => ({ db, HttpsError, FieldValue, requireBusinessAccess: requireOperationalBusinessAccess });
  const request = (businessId, data) => ({ auth: { uid: "owner-1" }, data: { businessId, ...data } });
  const product = (overrides = {}) => ({ tipoItem: "producto", nombre: "Repuesto", unidad: "unidad", costoBase: 3.5, margenDeseado: 30, precioInterno: 0, stock: 4, stockMinimo: 1, ...overrides });
  const rejects = (promise, pattern) => assert.rejects(promise, (error) => error?.code === "invalid-argument" && pattern.test(error.message));

  const db = new Firestore();
  seedBusiness(db, "bo-1", BOLIVIA);
  seedBusiness(db, "cl-1", CHILE);
  const deps = makeDeps(db);

  // La forma real del contexto: la que devuelve requireOperationalBusinessAccess, sin dobles.
  const context = await requireOperationalBusinessAccess(request("bo-1", {}), { db, HttpsError }, { roles: ["OWNER"] });
  assert.equal(typeof context.businessSnapshot?.data, "function", "businessSnapshot es un snapshot con data()");
  assert.equal(context.businessSnapshot.data().monedaCodigo, "BOB");
  assert.equal(context.businessRef.path, "negocios/bo-1");
  assert.equal(serverInventory.businessAmountDecimals(context), 2, "los decimales salen de context.businessSnapshot.data().monedaCodigo");
  const chileContext = await requireOperationalBusinessAccess(request("cl-1", {}), { db, HttpsError }, { roles: ["OWNER"] });
  assert.equal(serverInventory.businessAmountDecimals(chileContext), 0);
  assert.equal(serverInventory.businessAmountDecimals({}), 0, "sin snapshot (contexto de respaldo): 0, como siempre");

  // Crear.
  await rejects(
    serverInventory.createInventoryItemWithCodeHandler(request("bo-1", { requestId: "create-bo-bad-0001", item: product({ costoBase: 3.505 }) }), deps),
    /costo base admite hasta 2 decimales/
  );
  assert.equal(db.matching("negocios/bo-1/inventario/").length, 0, "el costo inválido no guarda nada");
  const created = await serverInventory.createInventoryItemWithCodeHandler(request("bo-1", { requestId: "create-bo-good-001", item: product({ costoBase: 3.5 }) }), deps);
  const stored = db.documents.get(`negocios/bo-1/inventario/${created.itemId}`);
  assert.equal(stored.costoBase, 3.5);
  assert.equal(stored.precioInterno, 4.55, "3,50 + 30 % = 4,55 (no 5)");
  assert.equal(stored.precioVentaSugerido, 4.55);
  assert.equal(stored.montoImpuestoCompra, 0.46, "IVA de compra 13 % de 3,50 = 0,455 → 0,46");
  assert.equal(stored.costoPagado, 3.96);
  await rejects(
    serverInventory.createInventoryItemWithCodeHandler(request("bo-1", { requestId: "create-bo-bad-0002", item: product({ precioManual: true, precioInterno: 4.555 }) }), deps),
    /precio de venta admite hasta 2 decimales/
  );
  const manual = await serverInventory.createInventoryItemWithCodeHandler(request("bo-1", { requestId: "create-bo-manual-1", item: product({ precioManual: true, precioInterno: 4.99 }) }), deps);
  assert.equal(db.documents.get(`negocios/bo-1/inventario/${manual.itemId}`).precioInterno, 4.99);

  // Editar.
  await rejects(
    serverInventory.updateInventoryItemHandler(request("bo-1", { itemId: created.itemId, requestId: "update-bo-bad-0001", item: product({ costoBase: 3.505, margenDeseado: 40 }) }), deps),
    /costo base admite hasta 2 decimales/
  );
  assert.equal(db.documents.get(`negocios/bo-1/inventario/${created.itemId}`).costoBase, 3.5, "la edición inválida no cambia nada");
  await serverInventory.updateInventoryItemHandler(request("bo-1", { itemId: created.itemId, requestId: "update-bo-good-0001", item: product({ costoBase: 3.5, margenDeseado: 40 }) }), deps);
  const edited = db.documents.get(`negocios/bo-1/inventario/${created.itemId}`);
  assert.equal(edited.precioInterno, 4.9, "3,50 + 40 % = 4,90");
  assert.equal(edited.precioVentaSugerido, 4.9);

  // Importar planilla.
  await rejects(
    serverInventory.confirmInventoryImportV2Handler(request("bo-1", { requestId: "import-bo-bad-0001", rows: [{ rowId: "row-1", item: product({ nombre: "Importado", costoBase: 3.505 }) }] }), deps),
    /Fila 1: El costo base admite hasta 2 decimales/
  );
  const imported = await serverInventory.confirmInventoryImportV2Handler(request("bo-1", { requestId: "import-bo-good-0001", rows: [{ rowId: "row-1", item: product({ nombre: "Importado", costoBase: 3.5 }) }] }), deps);
  assert.equal(imported.total, 1);
  const importedItem = db.matching("negocios/bo-1/inventario/").map(([, value]) => value).find((value) => value.nombre === "Importado");
  assert.equal(importedItem.costoBase, 3.5);
  assert.equal(importedItem.precioInterno, 4.55);

  // Chile conserva exactamente lo que aceptaba: 3,505 se guarda y el precio se redondea al entero.
  const clItem = await serverInventory.createInventoryItemWithCodeHandler(request("cl-1", { requestId: "create-cl-0000001", item: product({ costoBase: 3.505 }) }), deps);
  const clStored = db.documents.get(`negocios/cl-1/inventario/${clItem.itemId}`);
  assert.equal(clStored.costoBase, 3.505);
  assert.equal(clStored.precioInterno, 5, "Chile: Math.round, como siempre");
  assert.equal(clStored.montoImpuestoCompra, Math.round(3.505 * 19 / 100));

  // Rollback: con BOB en 0 el mismo negocio vuelve a calcular entero (y acepta 3,505 como Chile).
  setBobDecimals(0);
  try {
    const rolled = await serverInventory.createInventoryItemWithCodeHandler(request("bo-1", { requestId: "create-bo-rollback1", item: product({ costoBase: 3.505 }) }), deps);
    const rolledStored = db.documents.get(`negocios/bo-1/inventario/${rolled.itemId}`);
    assert.equal(rolledStored.costoBase, 3.505);
    assert.equal(rolledStored.precioInterno, 5);
  } finally {
    setBobDecimals(2);
  }

  // Los tres handlers obtienen los decimales de la misma forma, a partir del contexto que devuelve requireBusinessAccess.
  const source = await readFile("functions/inventoryModel.js", "utf8");
  assert.equal((source.match(/const decimals = businessAmountDecimals\(businessContext\);/g) || []).length, 3, "crear, editar e importar");
  assert.equal((source.match(/const businessContext =\s+await resolveBusinessContext\(/g) || []).length + (source.match(/const businessContext = await resolveBusinessContext\(/g) || []).length >= 3, true);
  console.log("OK inventario server-side en un negocio BOB: rechaza 3,505 y acepta 3,50 al crear, editar e importar; Chile y rollback sin cambios");
}

console.log("OK entrega D: BOB con 2 decimales, aviso retirado, sumas y reportes consistentes");
