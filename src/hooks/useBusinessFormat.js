import { createContext, createElement, useContext, useMemo } from "react";
import { getCountryByCode, getCurrencyAmountDecimals, getDefaultLocaleForCountry } from "../domain/businessCatalog.js";
import { normalizeCountryCode } from "../domain/fiscalIdentifier.mjs";
import { DEFAULT_CURRENCY, DEFAULT_LOCALE, formatBusinessMoney } from "../utils/formatters.js";

// Moneda y formato regional del negocio activo, para presentar montos que no
// traen su propio locale (los documentos guardan el suyo y siguen usándolo).
// Sin provider devuelve CLP/es-CL: exactamente el comportamiento anterior.
// `amountDecimals` son los decimales de CÁLCULO de los importes de la moneda (SPEC 036): con cuántos decimales se
// arma un borrador antes de que el documento exista (después manda el `montoDecimales` del documento). No es
// `decimals` del catálogo, que solo decide cómo se muestra el monto.
// `countryCode` es el país del negocio activo ("CL" sin provider o sin país), para los textos que cambian por país
// (countryFormCopy.mjs). No concede nada: solo decide qué texto se muestra.
const DEFAULT_FORMAT = Object.freeze({ currency: DEFAULT_CURRENCY, locale: DEFAULT_LOCALE, amountDecimals: 0, countryCode: "CL" });
const BusinessFormatContext = createContext(DEFAULT_FORMAT);

export function resolveBusinessFormat(business) {
  if (!business) return DEFAULT_FORMAT;
  const country = getCountryByCode(business.paisCodigo);
  const currency = String(business.monedaCodigo || country?.defaultCurrencyCode || DEFAULT_CURRENCY).toUpperCase();
  return {
    currency,
    locale: String(business.locale || getDefaultLocaleForCountry(business.paisCodigo) || DEFAULT_LOCALE),
    amountDecimals: getCurrencyAmountDecimals(currency),
    countryCode: business.paisCodigo ? normalizeCountryCode(business.paisCodigo) : "CL",
  };
}

export function BusinessFormatProvider({ business, children }) {
  const hasBusiness = Boolean(business);
  const { monedaCodigo, locale, paisCodigo } = business || {};
  const value = useMemo(
    () => resolveBusinessFormat(hasBusiness ? { monedaCodigo, locale, paisCodigo } : null),
    [hasBusiness, monedaCodigo, locale, paisCodigo]
  );
  return createElement(BusinessFormatContext.Provider, { value }, children);
}

export default function useBusinessFormat() {
  return useContext(BusinessFormatContext);
}

// Formatea un monto en la moneda del negocio activo (reemplazo de formatCLP). La función trae además
// `amountDecimals`: los decimales de cálculo de la moneda, para armar borradores (SPEC 036).
export function useBusinessMoney() {
  const { currency, locale, amountDecimals } = useBusinessFormat();
  return useMemo(() => {
    const format = (value) => formatBusinessMoney(value, currency, locale);
    format.amountDecimals = amountDecimals;
    return format;
  }, [currency, locale, amountDecimals]);
}
