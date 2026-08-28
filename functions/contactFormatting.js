const {normalizeCountryCode} = require("./fiscalIdentifier");

const MAX_CONTACT_PHONE_LENGTH = 30;

function getChileanNationalPhoneDigits(value) {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (raw.startsWith("+56") || (digits.startsWith("56") && digits.length > 9)) {
    return digits.slice(2);
  }
  if (digits.startsWith("0") && digits.length > 9) return digits.slice(1);
  return digits;
}

function formatChileanNationalPhone(nationalDigits) {
  if (!nationalDigits) return "";
  return [
    "+56",
    nationalDigits.slice(0, 1),
    nationalDigits.slice(1, 5),
    nationalDigits.slice(5, 9),
    nationalDigits.slice(9),
  ].filter(Boolean).join(" ");
}

function normalizeContactPhone(value, countryCode = "CL") {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const country = normalizeCountryCode(countryCode);
  if (country === "CL") {
    const nationalDigits = getChileanNationalPhoneDigits(raw);
    return /^[2-9]\d{8}$/.test(nationalDigits)
      ? formatChileanNationalPhone(nationalDigits)
      : "";
  }
  if (!/^[+\d\s().-]+$/.test(raw)) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 15) return "";
  return `${raw.startsWith("+") ? "+" : ""}${digits}`;
}

function getContactPhoneError(value, countryCode = "CL") {
  if (!String(value ?? "").trim() || normalizeContactPhone(value, countryCode)) {
    return "";
  }
  return normalizeCountryCode(countryCode) === "CL"
    ? "Ingresa un teléfono chileno válido, por ejemplo +56 9 6123 4587."
    : "Ingresa un teléfono válido con código de país cuando corresponda.";
}

module.exports = {
  MAX_CONTACT_PHONE_LENGTH,
  getContactPhoneError,
  normalizeContactPhone,
};
