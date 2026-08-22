const COUNTRY_CONFIG = Object.freeze({
  CL: {label: "RUT", type: "RUT"},
  BO: {label: "NIT", type: "NIT"},
  BR: {label: "CNPJ/CPF", type: "CNPJ"},
  PE: {label: "RUC", type: "RUC"},
  AR: {label: "CUIT", type: "CUIT"},
  CO: {label: "NIT", type: "NIT"},
  EC: {label: "RUC", type: "RUC"},
  PY: {label: "RUC", type: "RUC"},
  UY: {label: "RUT", type: "RUT"},
  MX: {label: "RFC", type: "RFC"},
  OTHER: {label: "Identificación fiscal", type: "IDENTIFICACION_FISCAL"},
});

function normalizeCountryCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return COUNTRY_CONFIG[code] ? code : "OTHER";
}

function normalizeChileanRut(value) {
  const compact = String(value ?? "").toUpperCase().replace(/[^0-9K]/g, "");
  if (compact.length < 2) return compact;
  return `${compact.slice(0, -1)}-${compact.slice(-1)}`;
}

function formatChileanRut(value) {
  const normalized = normalizeChileanRut(value);
  const match = /^(\d+)-([\dK])$/.exec(normalized);
  if (!match) return normalized;
  return `${match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${match[2]}`;
}

function isValidChileanRut(value) {
  const normalized = normalizeChileanRut(value);
  if (!/^\d{7,8}-[\dK]$/.test(normalized)) return false;
  const [body, suppliedDigit] = normalized.split("-");
  let sum = 0;
  let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  const expectedDigit = remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder);
  return suppliedDigit === expectedDigit;
}

function isValidCpf(value) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  const digit = (length) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(value[index]) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(value[9]) && digit(10) === Number(value[10]);
}

function isValidCnpj(value) {
  if (!/^\d{14}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  const calculate = (length, weights) => {
    const sum = value.slice(0, length).split("").reduce((total, item, index) => total + Number(item) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = calculate(12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calculate(13, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(value[12]) && second === Number(value[13]);
}

function isValidPeruvianRuc(value) {
  if (!/^\d{11}$/.test(value)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
  const remainder = 11 - (sum % 11);
  const digit = remainder === 10 ? 0 : remainder === 11 ? 1 : remainder;
  return digit === Number(value[10]);
}

function normalizedValue(countryCode, value) {
  const country = normalizeCountryCode(countryCode);
  if (country === "CL") return normalizeChileanRut(value).replace("-", "");
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isValidFiscalIdentifier(countryCode, value) {
  const country = normalizeCountryCode(countryCode);
  const normalized = normalizedValue(country, value);
  if (country === "CL") return isValidChileanRut(normalized);
  if (country === "BO") return /^\d{5,15}$/.test(normalized);
  if (country === "BR") return isValidCpf(normalized) || isValidCnpj(normalized);
  if (country === "PE") return isValidPeruvianRuc(normalized);
  return /^[A-Z0-9]{3,40}$/.test(normalized);
}

function formatFiscalIdentifier(countryCode, value) {
  const country = normalizeCountryCode(countryCode);
  const normalized = normalizedValue(country, value);
  if (country === "CL") return formatChileanRut(normalized);
  if (country === "BR" && normalized.length === 11) return normalized.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  if (country === "BR" && normalized.length === 14) return normalized.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

function getFiscalIdentifierType(countryCode, value) {
  const country = normalizeCountryCode(countryCode);
  if (country === "BR") return normalizedValue(country, value).length === 11 ? "CPF" : "CNPJ";
  return COUNTRY_CONFIG[country].type;
}

function getFiscalIdentifierLabel(countryCode) {
  return COUNTRY_CONFIG[normalizeCountryCode(countryCode)].label;
}

function buildFiscalIdentifier(countryCode, value) {
  const paisCodigo = normalizeCountryCode(countryCode);
  const identificadorFiscalNormalizado = normalizedValue(paisCodigo, value);
  return {
    paisCodigo,
    identificadorFiscalTipo: getFiscalIdentifierType(paisCodigo, identificadorFiscalNormalizado),
    identificadorFiscalValor: formatFiscalIdentifier(paisCodigo, identificadorFiscalNormalizado),
    identificadorFiscalNormalizado,
  };
}

function adaptStoredFiscalIdentifier(raw = {}, defaultCountry = "CL") {
  const paisCodigo = normalizeCountryCode(raw.paisCodigo || defaultCountry);
  const value = raw.identificadorFiscalValor || raw.identificadorFiscalNormalizado || raw.rut || raw.rutNormalizado || "";
  const fiscal = buildFiscalIdentifier(paisCodigo, value);
  return {
    ...fiscal,
    identificadorFiscalTipo: String(raw.identificadorFiscalTipo || fiscal.identificadorFiscalTipo).trim().toUpperCase(),
  };
}

function getFiscalReservationKey(countryCode, normalized) {
  const country = normalizeCountryCode(countryCode);
  const value = normalizedValue(country, normalized);
  return country === "CL" ? value : `${country}__${value}`;
}

function fiscalSnapshotFields(raw = {}, defaultCountry = "CL") {
  const fiscal = adaptStoredFiscalIdentifier(raw, defaultCountry);
  return fiscal.identificadorFiscalNormalizado ? fiscal : {};
}

module.exports = {
  adaptStoredFiscalIdentifier,
  buildFiscalIdentifier,
  formatChileanRut,
  formatFiscalIdentifier,
  fiscalSnapshotFields,
  getFiscalIdentifierLabel,
  getFiscalIdentifierType,
  getFiscalReservationKey,
  isValidChileanRut,
  isValidFiscalIdentifier,
  normalizeChileanRut,
  normalizeCountryCode,
  normalizedValue,
};
