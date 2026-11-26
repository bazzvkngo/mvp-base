"use strict";

// Reglas puras de la entrega del vehículo (sin dependencias de Firestore): las usan la Function de fotos
// de entrega y la transición «registrar entrega». La entrega deja evidencia: siete fotos selladas (las
// mismas zonas de la recepción), quién retira el vehículo y su conformidad. Sin montos.
const {RECEPTION_PHOTO_ZONE_DEFINITIONS} = require("./workOrderReceptionPhotoZones");
const {formatChileanRut, isValidChileanRut, normalizeCountryCode} = require("./fiscalIdentifier");

const DELIVERY_PHOTO_ZONES = Object.freeze(RECEPTION_PHOTO_ZONE_DEFINITIONS.map(({id, label}) => ({id, label})));
const DELIVERY_FIELDS = new Set(["receptorNombre", "receptorDocumento", "observaciones", "conforme"]);
const MAX_NAME = 120;
const MAX_NOTES = 1000;

function deliveryZone(zoneId) {
  return DELIVERY_PHOTO_ZONES.find((zone) => zone.id === zoneId) || null;
}

function deliveryPhotoPath(businessId, otId, zoneId, hash) {
  return `negocios/${businessId}/ordenesTrabajo/${otId}/entrega/${zoneId}-${hash.slice(0, 16)}.jpg`;
}

// Zonas sin foto de entrega (se exigen todas para registrar la entrega).
function missingDeliveryZones(acta = {}) {
  const photos = acta.fotos && typeof acta.fotos === "object" ? acta.fotos : {};
  return DELIVERY_PHOTO_ZONES.filter((zone) => !photos[zone.id]?.hash).map((zone) => zone.label);
}

function cleanText(value, label, maxLength, HttpsError, required) {
  if (value == null) value = "";
  if (typeof value !== "string") throw new HttpsError("invalid-argument", `${label} debe ser texto.`);
  const normalized = value.trim().replace(/\s+/g, " ");
  if (required && !normalized) throw new HttpsError("invalid-argument", `${label} es obligatorio.`);
  if (normalized.length > maxLength) throw new HttpsError("invalid-argument", `${label} no puede superar ${maxLength} caracteres.`);
  return normalized;
}

// Documento de identidad de una persona (quien entrega o retira): RUT válido en Chile; texto acotado en otros países.
function normalizePersonDocument(value, countryCode, HttpsError) {
  let document = cleanText(value, "El documento de identidad", 20, HttpsError, true);
  if (normalizeCountryCode(countryCode) === "CL") {
    if (!isValidChileanRut(document)) throw new HttpsError("invalid-argument", "Ingresa un RUT válido, por ejemplo 12.345.678-5.");
    document = formatChileanRut(document);
  }
  return document;
}

// Datos de quien retira el vehículo. En Chile el documento es un RUT válido; en otros países, texto libre acotado.
function normalizeDeliveryInput(raw, countryCode, HttpsError) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpsError("invalid-argument", "Registra los datos de quien retira el vehículo.");
  }
  const unknown = Object.keys(raw).find((field) => !DELIVERY_FIELDS.has(field));
  if (unknown) throw new HttpsError("invalid-argument", `El campo ${unknown} no está admitido en la entrega.`);
  if (raw.conforme !== true) {
    throw new HttpsError("invalid-argument", "Confirma que el cliente revisó el vehículo y lo recibe.");
  }
  const receptorNombre = cleanText(raw.receptorNombre, "El nombre de quien retira", MAX_NAME, HttpsError, true);
  const receptorDocumento = normalizePersonDocument(raw.receptorDocumento, countryCode, HttpsError);
  return {receptorNombre, receptorDocumento, observaciones: cleanText(raw.observaciones, "Las observaciones", MAX_NOTES, HttpsError, false),
    conforme: true};
}

module.exports = {
  DELIVERY_PHOTO_ZONES, cleanText, deliveryPhotoPath, deliveryZone, missingDeliveryZones, normalizeDeliveryInput,
  normalizePersonDocument,
};
