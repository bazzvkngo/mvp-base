"use strict";

// Fotos de recepción del Taller (prototipo «Panel del Taller»): seis zonas exteriores con registro
// de daños y el tablero. Patrón de fotos clínicas veterinarias: la imagen llega como JPEG en base64
// a una Function, se valida y se guarda en Storage solo desde el servidor (las reglas no abren esta
// ruta al cliente). Se eliminan los metadatos (EXIF, comentarios) antes de guardar.
// Cada foto queda sellada con fecha y usuario: no se reemplaza ni se quita.

const {createHash} = require("node:crypto");
const {isVeterinaryJpeg} = require("./veterinaryJpeg");
const {requireTallerAccess, assertFreshTallerAccess} = require("./tallerAccess");
const {appendPlanningEvent, diagnosisActor, identifier} = require("./workOrderPersistence");
const {RECEPTION_PHOTO_ZONES, receptionPhotoZone} = require("./workOrderReceptionPhotoZones");

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_DAMAGE_MARKS = 20;
const LOCKED_ORDER_STATES = new Set(["pendiente_entrega", "cerrada", "cancelada"]);
const OPERATIONS = new Set(["subir", "leer"]);
const INPUT_FIELDS = new Set(["businessId", "otId", "operacion", "zona", "imagen", "danos"]);

function fail(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

// Copia el JPEG sin segmentos APP1–APP15 (EXIF, XMP, ICC, etc.) ni comentarios (COM).
// Conserva APP0 (JFIF), tablas, cuadro y los datos de imagen desde SOS hasta el final.
function stripJpegMetadata(bytes) {
  const parts = [bytes.subarray(0, 2)];
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return null;
    const marker = bytes[pos + 1];
    if (marker === 0xda) {
      parts.push(bytes.subarray(pos));
      return Buffer.concat(parts);
    }
    const length = bytes.readUInt16BE(pos + 2);
    const end = pos + 2 + length;
    if (length < 2 || end > bytes.length) return null;
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) parts.push(bytes.subarray(pos, end));
    pos = end;
  }
  return null;
}

function photoPath(businessId, otId, zona, hash) {
  return `negocios/${businessId}/ordenesTrabajo/${otId}/recepcion/${zona}-${hash.slice(0, 16)}.jpg`;
}

function assertOrder(snapshot, businessId, HttpsError) {
  if (!snapshot.exists) fail(HttpsError, "not-found", "No se encontró la orden de trabajo.");
  const order = snapshot.data() || {};
  if (order.otId !== snapshot.id || order.negocioId !== businessId) {
    fail(HttpsError, "not-found", "No se encontró la orden de trabajo.");
  }
  return order;
}

// Las fotos se toman en la recepción; después de aprobar el ingreso ya no se agregan.
function assertPhotosOpen(order, HttpsError) {
  if (LOCKED_ORDER_STATES.has(order.estado) || order.estadoAprobacion === "aprobada") {
    fail(HttpsError, "failed-precondition", "Las fotos de recepción solo se registran antes de aprobar el ingreso.");
  }
}

function decodePhoto(imagen, HttpsError) {
  if (typeof imagen !== "string" || imagen.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(imagen)) {
    fail(HttpsError, "invalid-argument", "La foto debe ser un JPEG de hasta 2 MiB.");
  }
  const bytes = Buffer.from(imagen, "base64");
  if (bytes.length > MAX_PHOTO_BYTES || !isVeterinaryJpeg(bytes)) {
    fail(HttpsError, "invalid-argument", "La foto debe ser un JPEG válido de hasta 2 MiB.");
  }
  const clean = stripJpegMetadata(bytes);
  if (!clean || !isVeterinaryJpeg(clean)) {
    fail(HttpsError, "invalid-argument", "La foto debe ser un JPEG válido de hasta 2 MiB.");
  }
  return clean;
}

// Daños de una zona exterior: «sin daños», o al menos una marca sobre la foto con su nota.
// Las posiciones van de 0 a 1 respecto del ancho y alto de la foto.
function normalizeDamages(zone, raw, HttpsError) {
  if (!zone.damages) {
    if (raw !== undefined && raw !== null) fail(HttpsError, "invalid-argument", "El tablero no registra daños.");
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof raw.conDanos !== "boolean" ||
      Object.keys(raw).some((key) => !["conDanos", "marcas"].includes(key))) {
    fail(HttpsError, "invalid-argument", "Indica si la zona tiene daños.");
  }
  const marcas = raw.marcas === undefined ? [] : raw.marcas;
  if (!Array.isArray(marcas) || marcas.length > MAX_DAMAGE_MARKS) {
    fail(HttpsError, "invalid-argument", `Puedes marcar hasta ${MAX_DAMAGE_MARKS} daños por zona.`);
  }
  if (!raw.conDanos) {
    if (marcas.length) fail(HttpsError, "invalid-argument", "Una zona sin daños no lleva marcas.");
    return {conDanos: false, marcas: []};
  }
  if (!marcas.length) fail(HttpsError, "invalid-argument", "Marca al menos un daño sobre la foto.");
  return {conDanos: true, marcas: marcas.map((mark) => {
    if (!mark || typeof mark !== "object" || Object.keys(mark).some((key) => !["x", "y", "nota"].includes(key)) ||
        ![mark.x, mark.y].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1)) {
      fail(HttpsError, "invalid-argument", "Cada daño necesita una posición válida sobre la foto.");
    }
    const nota = typeof mark.nota === "string" ? mark.nota.trim().replace(/\s+/g, " ") : "";
    if (!nota || nota.length > 200) fail(HttpsError, "invalid-argument", "Escribe una nota de hasta 200 caracteres en cada daño.");
    return {x: Math.round(mark.x * 10000) / 10000, y: Math.round(mark.y * 10000) / 10000, nota};
  })};
}

function sameDamages(stored, damages) {
  return JSON.stringify({conDanos: stored?.conDanos, marcas: stored?.marcas}) ===
    JSON.stringify({conDanos: damages.conDanos, marcas: damages.marcas});
}

async function fotosRecepcionOTHandler(request, dependencies) {
  const {db, bucket, FieldValue, HttpsError} = dependencies;
  const data = request?.data || {};
  if (Object.keys(data).some((key) => !INPUT_FIELDS.has(key)) || !OPERATIONS.has(data.operacion)) {
    fail(HttpsError, "invalid-argument", "La solicitud de foto no es válida.");
  }
  const zone = receptionPhotoZone(data.zona);
  if (!zone || !RECEPTION_PHOTO_ZONES.includes(data.zona)) {
    fail(HttpsError, "invalid-argument", "Selecciona una zona del vehículo válida.");
  }
  const capability = data.operacion === "leer" ? "read" : "operate";
  const context = await requireTallerAccess(request, dependencies, capability);
  const otId = identifier(data.otId, "La orden de trabajo", HttpsError);
  const zona = zone.id;
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);

  if (data.operacion === "leer") {
    const order = assertOrder(await orderRef.get(), context.businessId, HttpsError);
    const photo = order.fotosRecepcion?.[zona];
    if (!photo?.hash) fail(HttpsError, "not-found", "La foto no está disponible.");
    const [bytes] = await bucket.file(photoPath(context.businessId, otId, zona, photo.hash)).download();
    return {zona, imagen: bytes.toString("base64")};
  }

  // subir: la zona se fotografía una sola vez y queda sellada.
  const damages = normalizeDamages(zone, data.danos, HttpsError);
  const bytes = decodePhoto(data.imagen, HttpsError);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const sealedMessage = `La foto de «${zone.label}» ya fue registrada y no se puede modificar.`;
  const initial = assertOrder(await orderRef.get(), context.businessId, HttpsError);
  const existing = initial.fotosRecepcion?.[zona];
  if (existing?.hash) {
    if (existing.hash === hash && sameDamages(existing, damages)) return {zona, sinCambios: true};
    fail(HttpsError, "failed-precondition", sealedMessage);
  }
  assertPhotosOpen(initial, HttpsError);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);

  const file = bucket.file(photoPath(context.businessId, otId, zona, hash));
  await file.save(bytes, {
    resumable: false,
    contentType: "image/jpeg",
    metadata: {metadata: {sha256: hash, zona}},
  });
  try {
    return await db.runTransaction(async (transaction) => {
      await assertFreshTallerAccess(transaction, context, dependencies, "operate");
      const order = assertOrder(await transaction.get(orderRef), context.businessId, HttpsError);
      const current = order.fotosRecepcion?.[zona];
      if (current?.hash) {
        if (current.hash === hash && sameDamages(current, damages)) return {zona, sinCambios: true};
        fail(HttpsError, "failed-precondition", sealedMessage);
      }
      assertPhotosOpen(order, HttpsError);
      const timestamp = FieldValue.serverTimestamp();
      transaction.update(orderRef, {
        [`fotosRecepcion.${zona}`]: {hash, bytes: bytes.length, subidaPorUid: context.uid,
          subidaPorNombre: actorSnapshot.nombre, subidaEn: timestamp, ...damages},
        actualizadoPorUid: context.uid, actualizadoEn: timestamp,
      });
      appendPlanningEvent(transaction, orderRef, {businessId: context.businessId, actorUid: context.uid,
        actorSnapshot, timestamp, type: "foto_recepcion_registrada",
        detail: {zona, ...(zone.damages ? {conDanos: damages.conDanos, cantidadDanos: damages.marcas.length} : {})}});
      return {zona, sinCambios: false, subidaPorNombre: actorSnapshot.nombre};
    });
  } catch (error) {
    // La OT no aceptó la foto: se borra el archivo recién guardado para no dejar huérfanos.
    const stored = (await orderRef.get()).data() || {};
    if (stored.fotosRecepcion?.[zona]?.hash !== hash) await file.delete({ignoreNotFound: true});
    throw error;
  }
}

module.exports = {
  MAX_DAMAGE_MARKS,
  decodePhoto,
  MAX_PHOTO_BYTES,
  RECEPTION_PHOTO_ZONES,
  fotosRecepcionOTHandler,
  stripJpegMetadata,
};
