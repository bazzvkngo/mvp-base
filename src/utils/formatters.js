import { getCurrencyByCode } from "../domain/businessCatalog.js";

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

// Reemplaza al antiguo formatCLP: moneda y locale del negocio activo. Como
// máximo muestra los decimales que el catálogo define para la moneda, y como
// mínimo ninguno: no agrega ",00" a montos que el sistema guarda enteros
// (los centavos quedan para la SPEC de decimales). Con CLP es idéntico a
// formatCLP.
export function formatBusinessMoney(value, currency = DEFAULT_CURRENCY, locale = DEFAULT_LOCALE) {
  const code = safeCurrency(currency);
  const catalogDecimals = getCurrencyByCode(code)?.decimals;
  const options = { style: "currency", currency: code };
  if (Number.isInteger(catalogDecimals)) {
    options.minimumFractionDigits = 0;
    options.maximumFractionDigits = catalogDecimals;
  }
  return new Intl.NumberFormat(safeLocale(locale), options).format(Number(value || 0));
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

// Extraída de QuoteHistoryPage.jsx (mismo comportamiento, sin cambios):
// fecha + hora, para Timestamp de Firestore, Date o cualquier valor que
// Date acepte. A diferencia de formatDate, no trata las fechas-solo-día
// ("YYYY-MM-DD") como UTC-mediodía, porque ningún llamador de esta función
// las usa así.
export function formatTimestamp(value, locale = DEFAULT_LOCALE) {
  if (!value) return "-";

  const date =
    typeof value?.toDate === "function"
      ? value.toDate()
      : value instanceof Date
      ? value
      : new Date(value);

  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat(safeLocale(locale), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
