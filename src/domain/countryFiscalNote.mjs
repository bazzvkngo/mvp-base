import { getCountryByCode } from "./businessCatalog.js";

// Impuestos propios de un país que ValoraCloud no calcula. Solo se nombran los que se verificaron:
// hoy no existe ningún cálculo del IT de Bolivia (el sistema calcula únicamente el impuesto base).
const OWN_TAX_EXAMPLES = Object.freeze({ BO: "el IT" });

// Nota del alta de empresa para un país distinto de Chile: qué se calcula (el impuesto base con la tasa
// del catálogo, la misma que usan cotizaciones, ventas, compras y órdenes de compra) y qué no se incluye
// (la facturación, que ValoraCloud no emite, y los impuestos propios del país). Chile y los países sin
// impuesto base configurado no llevan nota.
export function getCountryFiscalNote(countryCode) {
  const country = getCountryByCode(countryCode);
  const tax = country?.baseTax;
  if (
    !country ||
    country.code === "CL" ||
    tax?.configured !== true ||
    !Number.isFinite(Number(tax.rate))
  ) {
    return "";
  }
  const example = OWN_TAX_EXAMPLES[country.code];
  return (
    `ValoraCloud calcula el ${tax.name} con la tasa de ${country.name} (${tax.rate} %). ` +
    `La facturación y los impuestos propios de ${country.name}` +
    `${example ? `, como ${example},` : ""} no están incluidos.`
  );
}
