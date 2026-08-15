export const DEFAULT_CURRENCY = "CLP";
export const DEFAULT_LOCALE = "es-CL";

function safeLocale(locale) {
  try {
    return Intl.getCanonicalLocales(String(locale || DEFAULT_LOCALE))[0] || DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

function safeCurrency(currency) {
  const normalized = String(currency || DEFAULT_CURRENCY).trim().toUpperCase();
  try {
    new Intl.NumberFormat(DEFAULT_LOCALE, { style: "currency", currency: normalized });
    return normalized;
  } catch {
    return DEFAULT_CURRENCY;
  }
}

export function formatMoney(value, currency = DEFAULT_CURRENCY, locale = DEFAULT_LOCALE) {
  return new Intl.NumberFormat(safeLocale(locale), {
    style: "currency",
    currency: safeCurrency(currency),
  }).format(Number(value || 0));
}

export function formatNumber(value, locale = DEFAULT_LOCALE, options = {}) {
  return new Intl.NumberFormat(safeLocale(locale), options).format(Number(value || 0));
}

export function formatCLP(value) {
  return formatMoney(value, DEFAULT_CURRENCY, DEFAULT_LOCALE);
}

export function formatPercent(value, decimals = 1) {
  const n = Number(value || 0);
  const formatted = n.toLocaleString("es-CL", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  });
  return `${formatted} %`;
}

export function formatDate(value, locale = DEFAULT_LOCALE) {
  if (!value) return "-";

  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : typeof value?.toDate === "function"
      ? value.toDate()
      : value instanceof Date
        ? value
        : new Date(value);

  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat(safeLocale(locale), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
