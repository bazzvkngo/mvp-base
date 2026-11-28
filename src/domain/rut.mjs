// Funciones puras para el RUT chileno en la interfaz: clave de búsqueda, coincidencia tolerante y
// formato mientras se escribe. Reutiliza normalizar, formatear y validar de fiscalIdentifier.mjs (que
// sigue siendo la fuente única del módulo 11); aquí solo se suma lo que faltaba para buscar y teclear.
import {
  formatChileanRut,
  isValidChileanRut,
  normalizeChileanRut,
  normalizeCountryCode,
} from "./fiscalIdentifier.mjs";

export {formatChileanRut, isValidChileanRut, normalizeChileanRut};

// Un RUT chileno tiene de 7 a 8 dígitos de cuerpo más el dígito verificador: 8 o 9 caracteres.
const MIN_COMPLETE_LENGTH = 8;
const MAX_SIGNIFICANT_LENGTH = 9;
const SIGNIFICANT = /[0-9K]/;

export const RUT_CHECK_DIGIT_MESSAGE = "El dígito verificador no corresponde a este RUT. Revisa el número.";

// Solo dígitos y K en mayúscula, sin puntos, guion ni espacios. Sirve para comparar el mismo RUT guardado
// con cualquier formato.
export function rutSearchKey(value) {
  return String(value ?? "").toUpperCase().replace(/[^0-9K]/g, "");
}

// Un texto buscado "parece RUT" si empieza con un dígito y solo trae dígitos, puntos, guiones, espacios
// y, a lo sumo, una K final. Así "Karla" o "Juan 5" nunca se reducen a "K" ni a "5".
export function isRutSearchQuery(value) {
  return /^\d[\d.\-\s]*[\dkK]?$/.test(String(value ?? "").trim());
}

// ¿El texto buscado corresponde a alguno de los identificadores fiscales guardados? Busca por "contiene"
// sobre la clave de solo dígitos y K, de modo que no importa cómo estén escritos ni el buscado ni el guardado.
export function matchesRutSearch(search, ...storedValues) {
  if (!isRutSearchQuery(search)) return false;
  const key = rutSearchKey(search);
  if (!key) return false;
  return storedValues.some((stored) => rutSearchKey(stored).includes(key));
}

export function normalizeSearchText(value) {
  return String(value ?? "")
    .slice(0, 500)
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("es-CL");
}

// Coincidencia de una búsqueda con una ficha: la búsqueda por texto (nombre, correo, teléfono…) y la de
// RUT se SUMAN; ninguna reemplaza a la otra. Sin texto buscado, todo coincide.
export function matchesSearchOrRut(search, textValues = [], fiscalValues = []) {
  const query = normalizeSearchText(search);
  if (!query) return true;
  if (textValues.some((value) => normalizeSearchText(value).includes(query))) return true;
  return matchesRutSearch(search, ...fiscalValues);
}

// Estado de un RUT escrito: vacío, incompleto (todavía se está escribiendo), válido o con dígito
// verificador incorrecto. No bloquea nada por sí solo; cada formulario decide qué hacer con el estado.
export function getRutStatus(value) {
  const key = rutSearchKey(value);
  if (!key) return "empty";
  if (key.length < MIN_COMPLETE_LENGTH) return "incomplete";
  return isValidChileanRut(key) ? "valid" : "invalid";
}

// Mensaje claro para el dígito verificador; vacío si el RUT está vacío, incompleto o es válido.
export function getRutCheckDigitMessage(value) {
  return getRutStatus(value) === "invalid" ? RUT_CHECK_DIGIT_MESSAGE : "";
}

function cleanSignificant(characters) {
  const upper = characters.toUpperCase();
  // La K solo puede ser el dígito verificador: una K con algo después se descarta.
  const last = upper.length - 1;
  return [...upper].filter((character, index) => SIGNIFICANT.test(character) && (character !== "K" || index === last))
    .join("")
    .slice(0, MAX_SIGNIFICANT_LENGTH);
}

function buildRut(significant) {
  if (significant.length < 2) return significant;
  const body = significant.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${body}-${significant.slice(-1)}`;
}

function caretAfter(formatted, significantCount) {
  if (significantCount <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < formatted.length; index += 1) {
    if (SIGNIFICANT.test(formatted[index])) seen += 1;
    if (seen === significantCount) return index + 1;
  }
  return formatted.length;
}

// Formato "12.345.678-5" mientras se escribe, cuidando el cursor. Recibe lo que quedó en el campo tras la
// edición (`raw`), dónde quedó el cursor (`caret`) y el valor anterior (`previous`). Devuelve el texto
// formateado y la nueva posición del cursor, medida en dígitos: así escribir o pegar en medio no lo manda
// al final. Si el usuario borró solo un punto o el guion, se borra el dígito anterior en vez de quedar
// atascado (el formato lo volvería a poner).
export function formatRutInput(raw, caret = String(raw ?? "").length, previous = "") {
  const text = String(raw ?? "");
  const position = Math.max(0, Math.min(caret ?? text.length, text.length));
  let significant = text.slice(0, position).toUpperCase().replace(/[^0-9K]/g, "");
  const after = text.slice(position).toUpperCase().replace(/[^0-9K]/g, "");

  const previousText = String(previous ?? "");
  const removedOnlySeparator = previousText.length > text.length
    && buildRut(cleanSignificant(significant + after)) === previousText;
  if (removedOnlySeparator && significant.length > 0) significant = significant.slice(0, -1);

  const cleaned = cleanSignificant(significant + after);
  const value = buildRut(cleaned);
  return {value, caret: caretAfter(value, Math.min(significant.length, cleaned.length))};
}

// Formato en vivo solo para Chile; en otros países el texto se deja tal cual (NIT, CI, etc.).
export function formatFiscalIdInput(countryCode, raw, caret, previous) {
  if (normalizeCountryCode(countryCode) !== "CL") {
    const value = String(raw ?? "");
    return {value, caret: caret ?? value.length};
  }
  return formatRutInput(raw, caret, previous);
}
