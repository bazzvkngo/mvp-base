export const FINANCIAL_MODEL_VERSION = 1;
export const FINANCIAL_TIME_ZONE = "America/Santiago";

export const FINANCIAL_TYPES = Object.freeze([
  { id: "income", label: "Ingreso" },
  { id: "expense", label: "Egreso" },
]);

export const FINANCIAL_STATUSES = Object.freeze([
  { id: "paid", label: "Pagado" },
  { id: "pending", label: "Pendiente" },
]);

export const FINANCIAL_CATEGORIES = Object.freeze({
  income: [
    { id: "sales", label: "Ventas" },
    { id: "services", label: "Servicios" },
    { id: "deposits", label: "Abonos" },
    { id: "other_income", label: "Otros ingresos" },
  ],
  expense: [
    { id: "purchases", label: "Compras" },
    { id: "suppliers", label: "Proveedores" },
    { id: "transport", label: "Transporte" },
    { id: "utilities", label: "Servicios básicos" },
    { id: "payroll", label: "Remuneraciones" },
    { id: "rent", label: "Arriendo" },
    { id: "taxes", label: "Impuestos" },
    { id: "other_expense", label: "Otros gastos" },
  ],
});

export const PAYMENT_METHODS = Object.freeze([
  { id: "cash", label: "Efectivo" },
  { id: "debit_card", label: "Tarjeta de débito" },
  { id: "credit_card", label: "Tarjeta de crédito" },
  { id: "bank_transfer", label: "Transferencia" },
  { id: "other", label: "Otro" },
]);

export const FINANCIAL_SOURCE_TYPES = Object.freeze([
  "manual",
  "sale",
  "quote",
  "inventory",
]);

const TYPE_IDS = new Set(FINANCIAL_TYPES.map((item) => item.id));
const STATUS_IDS = new Set(FINANCIAL_STATUSES.map((item) => item.id));
const PAYMENT_METHOD_IDS = new Set(PAYMENT_METHODS.map((item) => item.id));
const SOURCE_IDS = new Set(FINANCIAL_SOURCE_TYPES);

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function safeText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CL")
    .replace(/\s+/g, " ")
    .trim();
}

export function isValidFinancialDate(value) {
  if (!DATE_KEY_PATTERN.test(String(value || ""))) return false;
  const [year, month, day] = String(value).split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function getCatalogLabel(items, id) {
  return items.find((item) => item.id === id)?.label || id || "Sin categoría";
}

export function getFinancialTypeLabel(id) {
  return getCatalogLabel(FINANCIAL_TYPES, id);
}

export function getFinancialStatusLabel(id) {
  return getCatalogLabel(FINANCIAL_STATUSES, id);
}

export function getPaymentMethodLabel(id) {
  return getCatalogLabel(PAYMENT_METHODS, id);
}

export function getFinancialCategoryLabel(type, id) {
  return getCatalogLabel(FINANCIAL_CATEGORIES[type] || [], id);
}

export function getFinancialCategories(type) {
  return FINANCIAL_CATEGORIES[type] || [];
}

export function getSantiagoDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FINANCIAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateKeyToUtcDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function utcDateToKey(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function addFinancialDays(dateKey, days) {
  const date = dateKeyToUtcDate(dateKey);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return utcDateToKey(date);
}

function startOfMonth(dateKey, monthOffset = 0) {
  const date = dateKeyToUtcDate(dateKey);
  date.setUTCMonth(date.getUTCMonth() + monthOffset, 1);
  return utcDateToKey(date);
}

function startOfWeek(dateKey) {
  const date = dateKeyToUtcDate(dateKey);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return addFinancialDays(dateKey, -mondayOffset);
}

function countInclusiveDays(start, end) {
  return (
    Math.round((dateKeyToUtcDate(end) - dateKeyToUtcDate(start)) / 86400000) + 1
  );
}

export function getFinancialPeriodRange(
  period = "month",
  custom = {},
  today = getSantiagoDateKey()
) {
  let start = today;
  let end = today;

  if (period === "week") start = startOfWeek(today);
  if (period === "month") start = startOfMonth(today);
  if (period === "three_months") start = startOfMonth(today, -2);
  if (period === "six_months") start = startOfMonth(today, -5);
  if (period === "year") start = `${today.slice(0, 4)}-01-01`;
  if (period === "custom") {
    start = isValidFinancialDate(custom.start) ? custom.start : today;
    end = isValidFinancialDate(custom.end) ? custom.end : today;
    if (start > end) [start, end] = [end, start];
  }

  return { start, end, period, days: countInclusiveDays(start, end) };
}

export function getPreviousFinancialPeriod(range) {
  const days = Math.max(Number(range?.days || 0), 1);
  const end = addFinancialDays(range.start, -1);
  const start = addFinancialDays(end, -(days - 1));
  return { start, end, days, period: "previous" };
}

export function normalizeFinancialMovementInput(
  input,
  { businessId, userId, allowAutomatic = false } = {}
) {
  const type = safeText(input?.type, 20);
  const status = safeText(input?.status, 20);
  const amount = Number(input?.amount);
  const date = safeText(input?.date, 10);
  const concept = safeText(input?.concept, 160);
  const categoryId = safeText(input?.categoryId, 60);
  const paymentMethodId = safeText(input?.paymentMethodId, 60);
  const counterpartyName = safeText(input?.counterpartyName, 160);
  const note = safeText(input?.note, 500);
  const reference = safeText(input?.reference, 120);
  const sourceType = safeText(input?.sourceType || "manual", 40);
  const sourceId = safeText(input?.sourceId, 160);

  if (!businessId) throw new Error("Selecciona un negocio activo.");
  if (!userId) throw new Error("Debes iniciar sesión.");
  if (!TYPE_IDS.has(type)) throw new Error("Selecciona un tipo de movimiento válido.");
  if (!STATUS_IDS.has(status)) throw new Error("Selecciona un estado válido.");
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("El monto debe ser un número entero mayor que cero.");
  }
  if (!isValidFinancialDate(date)) throw new Error("Ingresa una fecha válida.");
  if (!concept) throw new Error("Ingresa el concepto del movimiento.");
  if (!(FINANCIAL_CATEGORIES[type] || []).some((item) => item.id === categoryId)) {
    throw new Error("Selecciona una categoría válida para el tipo de movimiento.");
  }
  if (!PAYMENT_METHOD_IDS.has(paymentMethodId)) {
    throw new Error("Selecciona un método de pago válido.");
  }
  if (!SOURCE_IDS.has(sourceType)) throw new Error("El origen del movimiento no es válido.");
  if (!allowAutomatic && sourceType !== "manual") {
    throw new Error("Los movimientos automáticos no se crean desde este formulario.");
  }
  if (sourceType !== "manual" && !sourceId) {
    throw new Error("Los movimientos automáticos requieren un identificador de origen.");
  }

  const searchText = normalizeSearchText(
    [concept, counterpartyName, reference, note].filter(Boolean).join(" ")
  );

  return {
    modelVersion: FINANCIAL_MODEL_VERSION,
    businessId,
    type,
    status,
    amount,
    date,
    concept,
    categoryId,
    paymentMethodId,
    counterpartyName,
    note,
    reference,
    sourceType,
    sourceId: sourceType === "manual" ? "" : sourceId,
    searchText,
    createdBy: userId,
  };
}

export function adaptFinancialMovement(raw = {}) {
  return {
    ...raw,
    amount: Number.isSafeInteger(Number(raw.amount)) ? Number(raw.amount) : 0,
    sourceType: raw.sourceType || "manual",
    sourceId: raw.sourceId || "",
    searchText:
      raw.searchText ||
      normalizeSearchText(
        [raw.concept, raw.counterpartyName, raw.reference, raw.note]
          .filter(Boolean)
          .join(" ")
      ),
  };
}

export function getFinancialSourceDocumentId(sourceType, sourceId) {
  const normalizedType = safeText(sourceType, 40);
  const normalizedId = safeText(sourceId, 160);
  if (!SOURCE_IDS.has(normalizedType) || normalizedType === "manual" || !normalizedId) {
    throw new Error("El origen automático no es válido.");
  }
  return `${normalizedType}__${encodeURIComponent(normalizedId)}`;
}

export function filterFinancialMovements(movements, filters = {}) {
  const search = normalizeSearchText(filters.search);
  return movements.filter((movement) => {
    if (filters.start && movement.date < filters.start) return false;
    if (filters.end && movement.date > filters.end) return false;
    if (filters.type && movement.type !== filters.type) return false;
    if (filters.status && movement.status !== filters.status) return false;
    if (filters.categoryId && movement.categoryId !== filters.categoryId) return false;
    if (
      filters.paymentMethodId &&
      movement.paymentMethodId !== filters.paymentMethodId
    ) {
      return false;
    }
    if (search && !movement.searchText.includes(search)) return false;
    return true;
  });
}

export function summarizeFinancialMovements(movements) {
  return movements.reduce(
    (summary, movement) => {
      const amount = Number(movement.amount || 0);
      if (!Number.isFinite(amount) || amount <= 0) return summary;

      if (movement.type === "income" && movement.status === "paid") {
        summary.paidIncome += amount;
      }
      if (movement.type === "expense" && movement.status === "paid") {
        summary.paidExpense += amount;
      }
      if (movement.type === "income" && movement.status === "pending") {
        summary.receivable += amount;
      }
      if (movement.type === "expense" && movement.status === "pending") {
        summary.payable += amount;
      }
      summary.count += 1;
      return summary;
    },
    {
      paidIncome: 0,
      paidExpense: 0,
      netResult: 0,
      receivable: 0,
      payable: 0,
      count: 0,
    }
  );
}

export function withFinancialNetResult(summary) {
  return {
    ...summary,
    netResult: Number(summary?.paidIncome || 0) - Number(summary?.paidExpense || 0),
  };
}

export function getFinancialSummary(movements) {
  return withFinancialNetResult(summarizeFinancialMovements(movements));
}

export function compareFinancialSummaries(current, previous) {
  const keys = ["paidIncome", "paidExpense", "netResult", "receivable", "payable"];
  return Object.fromEntries(
    keys.map((key) => {
      const currentValue = Number(current?.[key] || 0);
      const previousValue = Number(previous?.[key] || 0);
      const absolute = currentValue - previousValue;
      return [
        key,
        {
          current: currentValue,
          previous: previousValue,
          absolute,
          percent: previousValue === 0 ? null : (absolute / Math.abs(previousValue)) * 100,
        },
      ];
    })
  );
}

export function aggregateFinancialByCategory(movements, type) {
  const totals = new Map();
  movements
    .filter((movement) => movement.type === type)
    .forEach((movement) => {
      totals.set(
        movement.categoryId,
        Number(totals.get(movement.categoryId) || 0) + Number(movement.amount || 0)
      );
    });
  return [...totals.entries()]
    .map(([id, value]) => ({
      id,
      label: getFinancialCategoryLabel(type, id),
      value,
    }))
    .sort((left, right) => right.value - left.value);
}

function getMonthKey(dateKey) {
  return dateKey.slice(0, 7);
}

export function aggregateFinancialTimeline(movements, range) {
  const useMonths = Number(range?.days || 0) > 62;
  const buckets = new Map();
  movements.forEach((movement) => {
    const key = useMonths ? getMonthKey(movement.date) : movement.date;
    const current = buckets.get(key) || { key, income: 0, expense: 0, net: 0 };
    if (movement.status === "paid" && movement.type === "income") {
      current.income += Number(movement.amount || 0);
    }
    if (movement.status === "paid" && movement.type === "expense") {
      current.expense += Number(movement.amount || 0);
    }
    current.net = current.income - current.expense;
    buckets.set(key, current);
  });
  return [...buckets.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  return /[";,\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildFinancialCsv(movements) {
  const header = [
    "Fecha",
    "Concepto",
    "Categoría",
    "Tipo",
    "Estado",
    "Método",
    "Contraparte",
    "Referencia",
    "Monto CLP",
    "Origen",
  ];
  const rows = movements.map((movement) => [
    movement.date,
    movement.concept,
    getFinancialCategoryLabel(movement.type, movement.categoryId),
    getFinancialTypeLabel(movement.type),
    getFinancialStatusLabel(movement.status),
    getPaymentMethodLabel(movement.paymentMethodId),
    movement.counterpartyName,
    movement.reference,
    Number(movement.amount || 0),
    movement.sourceType,
  ]);
  return `\ufeff${[header, ...rows]
    .map((row) => row.map(escapeCsvCell).join(";"))
    .join("\r\n")}`;
}
