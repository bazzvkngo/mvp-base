const WORK_BALANCE_MODEL_VERSION = 3;
const {BALANCE_READ_ROLES: BALANCE_ROLES} = require("./rbac");
const PROJECT_MOVEMENT_TYPES = new Set(["SALIDA_PROYECTO", "DEVOLUCION_PROYECTO"]);
const MONTHLY_AMOUNT_FIELDS = ["ingresoNeto", "materialesVenta", "materialesAdicionales", "horasHombre", "gastosDirectos", "gastosIndirectos"];

function fail(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

function identifier(value, label, HttpsError) {
  const normalized = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(normalized)) fail(HttpsError, "invalid-argument", `${label} no es válido.`);
  return normalized;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function currency(value, fallback = "") {
  const normalized = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : fallback;
}

function amount(value) {
  const normalized = Number(value || 0);
  return Number.isFinite(normalized) && normalized >= 0 ? roundMoney(normalized) : 0;
}

// SPEC 022 §7.1: el ingreso del balance es el neto (sin IVA) ya persistido por
// la Venta. Un neto ausente o inválido nunca se reemplaza por `total`.
function saleNetAmount(sale) {
  const value = sale?.neto;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? roundMoney(value) : null;
}

// SPEC 022 §5.1: mismo formato AAAA-MM-DD que validan los escritores
// (optionalDate en workPersistence, date en salePersistence), sin zona horaria.
function recordMonth(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(new Date(`${normalized}T12:00:00Z`).getTime())) return null;
  return normalized.slice(0, 7);
}

function monthlyBucket(months, month, currencyCode) {
  const key = `${month}::${currencyCode}`;
  if (!months.has(key)) months.set(key, {mes: month, moneda: currencyCode, ...Object.fromEntries(MONTHLY_AMOUNT_FIELDS.map((field) => [field, 0]))});
  return months.get(key);
}

function balanceBucket(buckets, currencyCode) {
  if (!buckets.has(currencyCode)) {
    buckets.set(currencyCode, {
      moneda: currencyCode,
      valorComercial: 0,
      materialesVenta: 0,
      materialesAdicionales: 0,
      materiales: 0,
      horasHombre: 0,
      gastosDirectos: 0,
      gastosIndirectos: 0,
    });
  }
  return buckets.get(currencyCode);
}

function saleMaterialEffects(sales = [], baseCurrency = "CLP") {
  const seen = new Set();
  return sales.flatMap((sale) => {
    const lines = new Map((Array.isArray(sale.items) ? sale.items : []).map((line) => [String(line?.lineaId || ""), line]));
    return (Array.isArray(sale.efectosInventario) ? sale.efectosInventario : []).flatMap((effect, index) => {
      const line = lines.get(String(effect?.lineaId || ""));
      if (line && line.tipoItem !== "producto") return [];
      const quantity = Number(effect?.cantidad);
      if (!Number.isFinite(quantity) || quantity <= 0) return [];
      const key = `${sale.ventaId || sale.id || "venta"}::${effect?.movimientoId || effect?.lineaId || index}`;
      if (seen.has(key)) return [];
      seen.add(key);
      const unitCost = Number(effect?.costoUnitario);
      const totalCost = Number(effect?.costoTotal);
      const costAvailable = effect?.costoHistoricoDisponible !== false && Number.isFinite(unitCost) && unitCost >= 0 && Number.isFinite(totalCost) && totalCost >= 0;
      return [{
        ...effect,
        ventaId: String(sale.ventaId || sale.id || ""),
        ventaNumero: String(sale.numero || ""),
        mesVenta: recordMonth(sale.fechaVenta),
        cantidad: quantity,
        moneda: currency(effect?.moneda, currency(sale.moneda, baseCurrency)),
        costoUnitario: costAvailable ? roundMoney(unitCost) : null,
        costoTotal: costAvailable ? roundMoney(totalCost) : null,
        costoHistoricoDisponible: costAvailable,
      }];
    });
  });
}

function calculateWorkBalance({business = {}, expenses = [], labor = [], materialMovements = [], quotes = [], sales = [], work = {}} = {}) {
  const businessId = String(work.negocioId || "").trim();
  const workId = String(work.trabajoId || work.id || "").trim();
  const baseCurrency = currency(work.moneda, currency(business.monedaCodigo || business.moneda, "CLP"));
  const validForWork = (record) => (!record.negocioId || record.negocioId === businessId) && (!record.trabajoId || record.trabajoId === workId);
  const confirmedSales = sales.filter((sale) => validForWork(sale) && sale.estado === "confirmada");
  const activeExpenses = expenses.filter((expense) => validForWork(expense) && expense.estado !== "anulado");
  const activeLabor = labor.filter((entry) => validForWork(entry) && entry.estado !== "anulado");
  const projectMaterials = materialMovements.filter((movement) => validForWork(movement) && PROJECT_MOVEMENT_TYPES.has(movement.tipo));
  const materialsFromSales = saleMaterialEffects(confirmedSales, baseCurrency);
  const availableSaleMaterials = materialsFromSales.filter((entry) => entry.costoHistoricoDisponible);
  const hasMaterialLedger = materialsFromSales.length > 0 || projectMaterials.some((movement) => movement.tipo === "SALIDA_PROYECTO");
  const includedExpenses = activeExpenses.filter((expense) => !(hasMaterialLedger && String(expense.categoria || "").toUpperCase() === "MATERIAL"));
  const excludedMaterialExpenses = activeExpenses.filter((expense) => hasMaterialLedger && String(expense.categoria || "").toUpperCase() === "MATERIAL");
  const buckets = new Map();
  const months = new Map();
  let undatedRecords = 0;
  balanceBucket(buckets, baseCurrency);

  // SPEC 022 §5.3: el acumulado y el desglose mensual se alimentan con el mismo
  // importe en el mismo paso, así que sólo pueden diferir por registros sin
  // fecha válida, que aportan al acumulado pero a ningún mes.
  const addAmount = (currencyCode, month, monthlyField, accumulatedFields, value) => {
    const bucket = balanceBucket(buckets, currencyCode);
    accumulatedFields.forEach((field) => { bucket[field] += value; });
    if (month) monthlyBucket(months, month, currencyCode)[monthlyField] += value;
  };
  const datedMonth = (value) => {
    const month = recordMonth(value);
    if (!month) undatedRecords += 1;
    return month;
  };
  const salesWithoutValidNet = confirmedSales.filter((sale) => saleNetAmount(sale) === null).length;

  confirmedSales.forEach((sale) => {
    const saleCurrency = currency(sale.moneda, baseCurrency);
    const month = datedMonth(sale.fechaVenta);
    const net = saleNetAmount(sale);
    if (net === null) balanceBucket(buckets, saleCurrency);
    else addAmount(saleCurrency, month, "ingresoNeto", ["valorComercial"], net);
  });
  // Los materiales de la Venta van al mes de la Venta: su costo se congela al confirmarla.
  availableSaleMaterials.forEach((entry) => {
    addAmount(entry.moneda, entry.mesVenta, "materialesVenta", ["materialesVenta", "materiales"], amount(entry.costoTotal));
  });
  projectMaterials.forEach((movement) => {
    const multiplier = movement.tipo === "DEVOLUCION_PROYECTO" ? -1 : 1;
    addAmount(currency(movement.moneda, baseCurrency), datedMonth(movement.fecha), "materialesAdicionales", ["materialesAdicionales", "materiales"], multiplier * amount(movement.costoTotal));
  });
  activeLabor.forEach((entry) => {
    addAmount(currency(entry.moneda, baseCurrency), datedMonth(entry.fecha), "horasHombre", ["horasHombre"], amount(entry.total));
  });
  includedExpenses.forEach((expense) => {
    const field = expense.clasificacionCosto === "INDIRECTO" || String(expense.categoria || "").toUpperCase() === "ADMINISTRATIVO" ? "gastosIndirectos" : "gastosDirectos";
    addAmount(currency(expense.moneda, baseCurrency), datedMonth(expense.fecha), field, [field], amount(expense.monto));
  });

  const breakdown = [...buckets.values()].map((bucket) => {
    const normalized = Object.fromEntries(Object.entries(bucket).map(([key, value]) => [key, key === "moneda" ? value : roundMoney(value)]));
    return {...normalized, costoTotal: roundMoney(normalized.materiales + normalized.horasHombre + normalized.gastosDirectos + normalized.gastosIndirectos)};
  });
  const monthlyBreakdown = [...months.values()]
    .sort((left, right) => left.mes.localeCompare(right.mes) || left.moneda.localeCompare(right.moneda))
    .map((entry) => {
      const normalized = Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, MONTHLY_AMOUNT_FIELDS.includes(key) ? roundMoney(value) : value]));
      const monthCost = roundMoney(normalized.materialesVenta + normalized.materialesAdicionales + normalized.horasHombre + normalized.gastosDirectos + normalized.gastosIndirectos);
      return {...normalized, costoTotal: monthCost, resultado: roundMoney(normalized.ingresoNeto - monthCost)};
    });
  const usedCurrencies = [
    ...confirmedSales.map((sale) => currency(sale.moneda, baseCurrency)),
    ...availableSaleMaterials.map((entry) => entry.moneda),
    ...projectMaterials.map((movement) => currency(movement.moneda, baseCurrency)),
    ...activeLabor.map((entry) => currency(entry.moneda, baseCurrency)),
    ...includedExpenses.map((expense) => currency(expense.moneda, baseCurrency)),
  ];
  const incompatibleCurrencies = [...new Set(usedCurrencies.filter((currencyCode) => currencyCode !== baseCurrency))].sort();
  const isConsistent = incompatibleCurrencies.length === 0;
  const base = breakdown.find((bucket) => bucket.moneda === baseCurrency) || balanceBucket(new Map(), baseCurrency);
  const hasRevenue = confirmedSales.length > 0;
  const commercialValue = hasRevenue ? roundMoney(base.valorComercial) : null;
  const totalCost = roundMoney(base.materiales + base.horasHombre + base.gastosDirectos + base.gastosIndirectos);
  const result = hasRevenue ? roundMoney(commercialValue - totalCost) : null;
  const profitability = hasRevenue && commercialValue > 0 ? Math.round((result / commercialValue) * 10000) / 100 : null;
  const rejectedQuotes = quotes.filter((quote) => validForWork(quote) && quote.estado === "rechazada").length;
  const excludedMaterialAmount = excludedMaterialExpenses.filter((expense) => currency(expense.moneda, baseCurrency) === baseCurrency).reduce((sum, expense) => sum + amount(expense.monto), 0);
  const aggregates = isConsistent ? {
    valorComercial: commercialValue,
    materialesVenta: roundMoney(base.materialesVenta),
    materialesAdicionales: roundMoney(base.materialesAdicionales),
    materiales: roundMoney(base.materiales),
    horasHombre: roundMoney(base.horasHombre),
    gastosDirectos: roundMoney(base.gastosDirectos),
    gastosIndirectos: roundMoney(base.gastosIndirectos),
    costoTotal: totalCost,
    resultado: result,
    rentabilidadPct: profitability,
  } : {
    valorComercial: null,
    materialesVenta: null,
    materialesAdicionales: null,
    materiales: null,
    horasHombre: null,
    gastosDirectos: null,
    gastosIndirectos: null,
    costoTotal: null,
    resultado: null,
    rentabilidadPct: null,
  };
  return {
    modeloBalanceVersion: WORK_BALANCE_MODEL_VERSION,
    trabajoId: workId,
    moneda: baseCurrency,
    estado: !isConsistent ? "INCONSISTENTE_MONEDA" : hasRevenue ? "COMPLETO" : "PARCIAL_SIN_VENTA",
    consistenteMoneda: isConsistent,
    monedasIncompatibles: incompatibleCurrencies,
    ...aggregates,
    gastosMaterialExcluido: isConsistent ? roundMoney(excludedMaterialAmount) : null,
    reglaMateriales: hasMaterialLedger ? "INVENTARIO_AUTORITATIVO" : "GASTO_MATERIAL_LEGACY",
    desglosePorMoneda: breakdown,
    desglosePorMes: monthlyBreakdown,
    fuentes: {
      ventasConfirmadas: confirmedSales.length,
      ventasSinNetoValido: salesWithoutValidNet,
      registrosSinFecha: undatedRecords,
      cotizacionesRechazadas: rejectedQuotes,
      movimientosMaterialesVenta: materialsFromSales.length,
      materialesVentaSinCosto: materialsFromSales.filter((entry) => !entry.costoHistoricoDisponible).length,
      movimientosMateriales: projectMaterials.length,
      horasHombreVigentes: activeLabor.length,
      gastosVigentes: activeExpenses.length,
      gastosMaterialExcluidos: excludedMaterialExpenses.length,
    },
  };
}

function documents(snapshot) {
  return snapshot.docs.map((document) => ({id: document.id, ...document.data()}));
}

async function loadWorkBalanceDocuments(context, workId) {
  const workRef = context.businessRef.collection("trabajos").doc(workId);
  const [workSnapshot, businessSnapshot, expensesSnapshot, laborSnapshot, materialSnapshot, salesSnapshot, quotesSnapshot] = await Promise.all([
    workRef.get(),
    context.businessRef.get(),
    workRef.collection("gastos").get(),
    workRef.collection("horasHombre").get(),
    context.businessRef.collection("movimientosInventario").where("trabajoId", "==", workId).get(),
    context.businessRef.collection("ventas").where("trabajoId", "==", workId).get(),
    context.businessRef.collection("cotizaciones").where("trabajoId", "==", workId).get(),
  ]);
  return {
    workSnapshot,
    businessSnapshot,
    expenses: documents(expensesSnapshot),
    labor: documents(laborSnapshot),
    materialMovements: documents(materialSnapshot),
    sales: documents(salesSnapshot),
    quotes: documents(quotesSnapshot),
  };
}

async function obtenerBalanceTrabajoHandler(request, dependencies) {
  const {db, HttpsError} = dependencies;
  const context = await dependencies.requireBusinessAccess(request, {db, HttpsError}, {roles: BALANCE_ROLES});
  const workId = identifier(request?.data?.trabajoId, "El trabajo", HttpsError);
  const loaded = dependencies.loadWorkBalanceDocuments
    ? await dependencies.loadWorkBalanceDocuments(context, workId)
    : await loadWorkBalanceDocuments(context, workId);
  if (!loaded.workSnapshot?.exists) fail(HttpsError, "not-found", "No se encontró el trabajo.");
  const work = loaded.workSnapshot.data() || {};
  if (work.negocioId !== context.businessId) fail(HttpsError, "permission-denied", "El trabajo no pertenece al negocio.");
  if (!loaded.businessSnapshot?.exists) fail(HttpsError, "failed-precondition", "El negocio seleccionado no está disponible.");
  return {...calculateWorkBalance({...loaded, business: loaded.businessSnapshot.data() || {}, work}), calculadoEn: new Date().toISOString()};
}

module.exports = {
  BALANCE_ROLES,
  WORK_BALANCE_MODEL_VERSION,
  calculateWorkBalance,
  obtenerBalanceTrabajoHandler,
};
