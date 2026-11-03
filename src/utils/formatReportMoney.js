import { formatMoney } from "./formatters";

// Monto de Reportes con el signo menos delante ("-$100"). Intl con es-CL pone el
// signo después del símbolo ("$-100"); formatMoney es compartido y no se toca.
// Un valor que redondea a cero no lleva signo.
export function formatReportMoney(value, currency, locale) {
  const amount = Number(value || 0);
  const formatted = formatMoney(Math.abs(amount), currency, locale);
  return amount < 0 && /[1-9]/.test(formatted) ? `-${formatted}` : formatted;
}
