const CONFIG = Object.freeze({
  CL: {label: "RUT", type: "RUT"}, BO: {label: "NIT", type: "NIT"},
  BR: {label: "CNPJ/CPF", type: "CNPJ"}, PE: {label: "RUC", type: "RUC"},
  AR: {label: "CUIT", type: "CUIT"}, CO: {label: "NIT", type: "NIT"},
  EC: {label: "RUC", type: "RUC"}, PY: {label: "RUC", type: "RUC"},
  UY: {label: "RUT", type: "RUT"}, MX: {label: "RFC", type: "RFC"},
  OTHER: {label: "Identificación fiscal", type: "IDENTIFICACION_FISCAL"},
});

export const normalizeCountryCode = (value) => {
  const code = String(value || "").trim().toUpperCase();
  return CONFIG[code] ? code : "OTHER";
};
export const normalizeChileanRut = (value) => {
  const compact = String(value ?? "").toUpperCase().replace(/[^0-9K]/g, "");
  return compact.length < 2 ? compact : `${compact.slice(0, -1)}-${compact.slice(-1)}`;
};
export const formatChileanRut = (value) => {
  const normalized = normalizeChileanRut(value);
  const match = /^(\d+)-([\dK])$/.exec(normalized);
  return match ? `${match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${match[2]}` : normalized;
};
export const isValidChileanRut = (value) => {
  const normalized = normalizeChileanRut(value);
  if (!/^\d{7,8}-[\dK]$/.test(normalized)) return false;
  const [body, supplied] = normalized.split("-");
  let sum = 0; let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier; multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  return supplied === (remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder));
};
const normalizedValue = (countryCode, value) => normalizeCountryCode(countryCode) === "CL"
  ? normalizeChileanRut(value).replace("-", "")
  : String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const validCpf = (value) => {
  if (!/^\d{11}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  const digit = (length) => { let sum = 0; for (let i = 0; i < length; i += 1) sum += Number(value[i]) * (length + 1 - i); const r = (sum * 10) % 11; return r === 10 ? 0 : r; };
  return digit(9) === Number(value[9]) && digit(10) === Number(value[10]);
};
const validCnpj = (value) => {
  if (!/^\d{14}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  const digit = (length, weights) => { const sum = value.slice(0, length).split("").reduce((t, n, i) => t + Number(n) * weights[i], 0); return sum % 11 < 2 ? 0 : 11 - (sum % 11); };
  return digit(12, [5,4,3,2,9,8,7,6,5,4,3,2]) === Number(value[12]) && digit(13, [6,5,4,3,2,9,8,7,6,5,4,3,2]) === Number(value[13]);
};
const validPeruvianRuc = (value) => {
  if (!/^\d{11}$/.test(value)) return false;
  const sum = [5,4,3,2,7,6,5,4,3,2].reduce((t, w, i) => t + Number(value[i]) * w, 0);
  const remainder = 11 - (sum % 11); const digit = remainder === 10 ? 0 : remainder === 11 ? 1 : remainder;
  return digit === Number(value[10]);
};
export const isValidFiscalIdentifier = (countryCode, value) => {
  const country = normalizeCountryCode(countryCode); const normalized = normalizedValue(country, value);
  if (country === "CL") return isValidChileanRut(normalized);
  if (country === "BO") return /^\d{5,15}$/.test(normalized);
  if (country === "BR") return validCpf(normalized) || validCnpj(normalized);
  if (country === "PE") return validPeruvianRuc(normalized);
  return /^[A-Z0-9]{3,40}$/.test(normalized);
};
export const getFiscalIdentifierLabel = (countryCode) => CONFIG[normalizeCountryCode(countryCode)].label;
export const getFiscalIdentifierPlaceholder = (countryCode) => ({CL: "Ej.: 12.345.678-5", BO: "Ej.: 1234567", BR: "Ej.: 529.982.247-25", PE: "Ej.: 20100070970"})[normalizeCountryCode(countryCode)] || "Ej.: TAX-12345";
export const buildFiscalIdentifier = (countryCode, value) => {
  const paisCodigo = normalizeCountryCode(countryCode); const identificadorFiscalNormalizado = normalizedValue(paisCodigo, value);
  const identificadorFiscalTipo = paisCodigo === "BR" ? (identificadorFiscalNormalizado.length === 11 ? "CPF" : "CNPJ") : CONFIG[paisCodigo].type;
  let identificadorFiscalValor = String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  if (paisCodigo === "CL") identificadorFiscalValor = formatChileanRut(identificadorFiscalNormalizado);
  if (paisCodigo === "BR" && identificadorFiscalNormalizado.length === 11) identificadorFiscalValor = identificadorFiscalNormalizado.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  if (paisCodigo === "BR" && identificadorFiscalNormalizado.length === 14) identificadorFiscalValor = identificadorFiscalNormalizado.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  return {paisCodigo, identificadorFiscalTipo, identificadorFiscalValor, identificadorFiscalNormalizado};
};
export const formatFiscalIdentifierForDisplay = (countryCode, value) => {
  const country = normalizeCountryCode(countryCode);
  const normalized = normalizedValue(country, value);
  if (country === "CL") return formatChileanRut(normalized);
  if (country === "AR" && /^\d{11}$/.test(normalized)) {
    return normalized.replace(/^(\d{2})(\d{8})(\d)$/, "$1-$2-$3");
  }
  if (country === "BR" && /^\d{11}$/.test(normalized)) {
    return normalized.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  if (country === "BR" && /^\d{14}$/.test(normalized)) {
    return normalized.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  return String(value ?? "").trim();
};
export const adaptStoredFiscalIdentifier = (raw = {}, defaultCountry = "CL") => {
  const paisCodigo = normalizeCountryCode(raw.paisCodigo || defaultCountry);
  const value = raw.identificadorFiscalValor || raw.identificadorFiscalNormalizado || raw.rut || raw.rutNormalizado || "";
  const fiscal = buildFiscalIdentifier(paisCodigo, value);
  return {...fiscal, identificadorFiscalTipo: String(raw.identificadorFiscalTipo || fiscal.identificadorFiscalTipo).trim().toUpperCase(), rut: raw.rut || fiscal.identificadorFiscalValor, rutNormalizado: raw.rutNormalizado || (paisCodigo === "CL" ? normalizeChileanRut(value) : fiscal.identificadorFiscalNormalizado)};
};
