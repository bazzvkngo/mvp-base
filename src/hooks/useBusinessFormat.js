import { createContext, createElement, useCallback, useContext, useMemo } from "react";
import { getCountryByCode, getDefaultLocaleForCountry } from "../domain/businessCatalog.js";
import { DEFAULT_CURRENCY, DEFAULT_LOCALE, formatBusinessMoney } from "../utils/formatters.js";

// Moneda y formato regional del negocio activo, para presentar montos que no
// traen su propio locale (los documentos guardan el suyo y siguen usándolo).
// Sin provider devuelve CLP/es-CL: exactamente el comportamiento anterior.
const DEFAULT_FORMAT = Object.freeze({ currency: DEFAULT_CURRENCY, locale: DEFAULT_LOCALE });
const BusinessFormatContext = createContext(DEFAULT_FORMAT);

export function resolveBusinessFormat(business) {
  if (!business) return DEFAULT_FORMAT;
  const country = getCountryByCode(business.paisCodigo);
  return {
    currency: String(business.monedaCodigo || country?.defaultCurrencyCode || DEFAULT_CURRENCY).toUpperCase(),
    locale: String(business.locale || getDefaultLocaleForCountry(business.paisCodigo) || DEFAULT_LOCALE),
  };
}

export function BusinessFormatProvider({ business, children }) {
  const { monedaCodigo, locale, paisCodigo } = business || {};
  const value = useMemo(
    () => resolveBusinessFormat(business ? { monedaCodigo, locale, paisCodigo } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Boolean(business), monedaCodigo, locale, paisCodigo]
  );
  return createElement(BusinessFormatContext.Provider, { value }, children);
}

export default function useBusinessFormat() {
  return useContext(BusinessFormatContext);
}

// Formatea un monto en la moneda del negocio activo (reemplazo de formatCLP).
export function useBusinessMoney() {
  const { currency, locale } = useBusinessFormat();
  return useCallback((value) => formatBusinessMoney(value, currency, locale), [currency, locale]);
}
