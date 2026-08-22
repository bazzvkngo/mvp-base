const WORK_BALANCE_MODEL_VERSION = 1;
const {BALANCE_READ_ROLES: BALANCE_ROLES} = require("./rbac");
const PROJECT_MOVEMENT_TYPES = new Set(["SALIDA_PROYECTO", "DEVOLUCION_PROYECTO"]);

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

function balanceBucket(buckets, currencyCode) {
  if (!buckets.has(currencyCode)) {
    buckets.set(currencyCode, {
      moneda: currencyCode,
      valorComercial: 0,
      materiales: 0,
      horasHombre: 0,
      gastosDirectos: 0,
      gastosIndirectos: 0,
    });
  }
  return buckets.get(currencyCode);
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
  const hasMaterialLedger = projectMaterials.some((movement) => movement.tipo === "SALIDA_PROYECTO");
  const includedExpenses = activeExpenses.filter((expense) => !(hasMaterialLedger && String(expense.categoria || "").toUpperCase() === "MATERIAL"));
  const excludedMaterialExpenses = activeExpenses.filter((expense) => hasMaterialLedger && String(expense.categoria || "").toUpperCase() === "MATERIAL");
  const buckets = new Map();
  balanceBucket(buckets, baseCurrency);

  confirmedSales.forEach((sale) => {
    balanceBucket(buckets, currency(sale.moneda, baseCurrency)).valorComercial += amount(sale.total);
  });
  projectMaterials.forEach((movement) => {
    const multiplier = movement.tipo === "DEVOLUCION_PROYECTO" ? -1 : 1;
    balanceBucket(buckets, currency(movement.moneda, baseCurrency)).materiales += multiplier * amount(movement.costoTotal);
  });
  activeLabor.forEach((entry) => {
    balanceBucket(buckets, currency(entry.moneda, baseCurrency)).horasHombre += amount(entry.total);
  });
  includedExpenses.forEach((expense) => {
    const bucket = balanceBucket(buckets, currency(expense.moneda, baseCurrency));
    if (expense.clasificacionCosto === "INDIRECTO" || String(expense.categoria || "").toUpperCase() === "ADMINISTRATIVO") bucket.gastosIndirectos += amount(expense.monto);
    else bucket.gastosDirectos += amount(expense.monto);
  });

  const breakdown = [...buckets.values()].map((bucket) => {
    const normalized = Object.fromEntries(Object.entries(bucket).map(([key, value]) => [key, key === "moneda" ? value : roundMoney(value)]));
    return {...normalized, costoTotal: roundMoney(normalized.materiales + normalized.horasHombre + normalized.gastosDirectos + normalized.gastosIndirectos)};
  });
  const usedCurrencies = [
    ...confirmedSales.map((sale) => currency(sale.moneda, baseCurrency)),
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
    materiales: roundMoney(base.materiales),
    horasHombre: roundMoney(base.horasHombre),
    gastosDirectos: roundMoney(base.gastosDirectos),
    gastosIndirectos: roundMoney(base.gastosIndirectos),
    costoTotal: totalCost,
    resultado: result,
    rentabilidadPct: profitability,
  } : {
    valorComercial: null,
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
    fuentes: {
      ventasConfirmadas: confirmedSales.length,
      cotizacionesRechazadas: rejectedQuotes,
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
