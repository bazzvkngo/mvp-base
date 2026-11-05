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

// Monto abreviado para los ejes de los gráficos ("$15 K", "-$1,5 M"). El sufijo
// compacto sale de Intl, que según el ICU del navegador puede dar "k" o "K" en
// el mismo eje; aquí se fuerza a mayúscula para que todas las marcas coincidan.
// Palabras como "mil" no se tocan: solo los sufijos de una o dos letras.
export function formatCompactMoney(value, currency = DEFAULT_CURRENCY, locale = DEFAULT_LOCALE) {
  const amount = Number(value);
  return new Intl.NumberFormat(safeLocale(locale), {
    style: "currency",
    currency: safeCurrency(currency),
    notation: "compact",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
    signDisplay: "negative",
  })
    .formatToParts(Number.isFinite(amount) ? amount : 0)
    .map((part) => (part.type === "compact" && part.value.trim().length <= 2 ? part.value.toUpperCase() : part.value))
    .join("");
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

// Fecha corta y legible para listas de avisos: "ahora", "hace 5 minutos",
// "hace 2 horas", "ayer", "anteayer", "hace 4 días" y, pasados 7 días, la fecha
// completa (formatDate). `now` (ms o Date) se inyecta para poder probarla sin
// depender del reloj. Si no hay fecha válida devuelve "-", como formatTimestamp.
const RELATIVE_MAX_DAYS = 7;

export function formatRelativeTimestamp(value, now = Date.now(), locale = DEFAULT_LOCALE) {
  if (!value) return "-";

  const date =
    typeof value?.toDate === "function"
      ? value.toDate()
      : value instanceof Date
      ? value
      : new Date(value);

  if (Number.isNaN(date.getTime())) return "-";

  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) return formatDate(date, locale);

  const formatter = new Intl.RelativeTimeFormat(safeLocale(locale), { numeric: "auto" });
  const minutes = Math.floor((nowMs - date.getTime()) / 60000);
  // Un reloj atrasado (fecha futura) cuenta como "ahora", no como "dentro de".
  if (minutes < 1) return formatter.format(0, "second");
  if (minutes < 60) return formatter.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatter.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  if (days <= RELATIVE_MAX_DAYS) return formatter.format(-days, "day");
  return formatDate(date, locale);
}
