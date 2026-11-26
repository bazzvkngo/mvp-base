"use strict";

// Fotos «antes» y «después» de un trabajo de la ejecución (prototipo «Panel del Taller»). Son opcionales.
// Mismo patrón que las fotos de recepción: JPEG en base64 a una Function, sin metadatos, guardado en Storage
// solo desde el servidor y sellado con fecha y usuario (no se reemplaza ni se quita).

const {createHash} = require("node:crypto");
const {requireTallerAccess, assertFreshTallerAccess} = require("./tallerAccess");
const {
  appendPlanningEvent, assertWorkOperator, diagnosisActor, identifier,
} = require("./workOrderPersistence");
const {decodePhoto} = require("./workOrderReceptionPhotos");

const MOMENTS = new Set(["antes", "despues"]);
const MOMENT_LABELS = {antes: "antes", despues: "después"};
const OPERATIONS = new Set(["subir", "leer"]);
const INPUT_FIELDS = new Set(["businessId", "otId", "servicioOtId", "operacion", "momento", "imagen"]);

function fail(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

function photoPath(businessId, otId, serviceId, moment, hash) {
  return `negocios/${businessId}/ordenesTrabajo/${otId}/servicios/${serviceId}/${moment}-${hash.slice(0, 16)}.jpg`;
}

function assertRecords(orderSnapshot, serviceSnapshot, businessId, otId, serviceId, HttpsError) {
  const order = orderSnapshot.data() || {};
  const service = serviceSnapshot.data() || {};
  if (!orderSnapshot.exists || order.otId !== orderSnapshot.id || order.negocioId !== businessId) {
    fail(HttpsError, "not-found", "No se encontró la orden de trabajo.");
  }
  if (!serviceSnapshot.exists || service.servicioOtId !== serviceId || service.negocioId !== businessId ||
      service.otId !== otId) {
    fail(HttpsError, "not-found", "No se encontró el trabajo de la orden.");
  }
  return {order, service};
}

// Las fotos se agregan mientras la OT está en ejecución y el trabajo no está terminado.
function assertPhotosOpen(order, service, HttpsError) {
  if (order.estado !== "en_reparacion" || order.estadoAprobacion !== "aprobada") {
    fail(HttpsError, "failed-precondition", "Las fotos del trabajo se registran durante la ejecución.");
  }
  if (service.estado === "completado") {
    fail(HttpsError, "failed-precondition", "Este trabajo está terminado. Un Owner o Administrador debe reabrirlo para agregar fotos.");
  }
}

async function fotosServicioOTHandler(request, dependencies) {
  const {db, bucket, FieldValue, HttpsError} = dependencies;
  const data = request?.data || {};
  if (Object.keys(data).some((key) => !INPUT_FIELDS.has(key)) || !OPERATIONS.has(data.operacion) ||
      !MOMENTS.has(data.momento)) {
    fail(HttpsError, "invalid-argument", "La solicitud de foto no es válida.");
  }
  const context = await requireTallerAccess(request, dependencies, data.operacion === "leer" ? "read" : "operate");
  const otId = identifier(data.otId, "La orden de trabajo", HttpsError);
  const serviceId = identifier(data.servicioOtId, "El servicio de la OT", HttpsError);
  const moment = data.momento;
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const serviceRef = orderRef.collection("servicios").doc(serviceId);

  if (data.operacion === "leer") {
    const {service} = assertRecords(await orderRef.get(), await serviceRef.get(), context.businessId, otId, serviceId, HttpsError);
    const photo = service.fotos?.[moment];
    if (!photo?.hash) fail(HttpsError, "not-found", "La foto no está disponible.");
    const [bytes] = await bucket.file(photoPath(context.businessId, otId, serviceId, moment, photo.hash)).download();
    return {momento: moment, imagen: bytes.toString("base64")};
  }

  const bytes = decodePhoto(data.imagen, HttpsError);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const sealedMessage = `La foto «${MOMENT_LABELS[moment]}» de este trabajo ya fue registrada y no se puede modificar.`;
  const initial = assertRecords(await orderRef.get(), await serviceRef.get(), context.businessId, otId, serviceId, HttpsError);
  assertWorkOperator(context.membership, initial.order, context.uid, HttpsError);
  const existing = initial.service.fotos?.[moment];
  if (existing?.hash) {
    if (existing.hash === hash) return {momento: moment, sinCambios: true};
    fail(HttpsError, "failed-precondition", sealedMessage);
  }
  assertPhotosOpen(initial.order, initial.service, HttpsError);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);

  const file = bucket.file(photoPath(context.businessId, otId, serviceId, moment, hash));
  await file.save(bytes, {resumable: false, contentType: "image/jpeg", metadata: {metadata: {sha256: hash, momento: moment}}});
  try {
    return await db.runTransaction(async (transaction) => {
      const membership = await assertFreshTallerAccess(transaction, context, dependencies, "operate");
      const {order, service} = assertRecords(await transaction.get(orderRef), await transaction.get(serviceRef),
        context.businessId, otId, serviceId, HttpsError);
      assertWorkOperator(membership, order, context.uid, HttpsError);
      const current = service.fotos?.[moment];
      if (current?.hash) {
        if (current.hash === hash) return {momento: moment, sinCambios: true};
        fail(HttpsError, "failed-precondition", sealedMessage);
      }
      assertPhotosOpen(order, service, HttpsError);
      const timestamp = FieldValue.serverTimestamp();
      transaction.update(serviceRef, {
        [`fotos.${moment}`]: {hash, bytes: bytes.length, subidaPorUid: context.uid,
          subidaPorNombre: actorSnapshot.nombre, subidaEn: timestamp},
      });
      transaction.update(orderRef, {actualizadoPorUid: context.uid, actualizadoEn: timestamp});
      appendPlanningEvent(transaction, orderRef, {businessId: context.businessId, actorUid: context.uid,
        actorSnapshot, timestamp, type: "foto_servicio_registrada", detail: {servicioOtId: serviceId, momento: moment}});
      return {momento: moment, sinCambios: false, subidaPorNombre: actorSnapshot.nombre};
    });
  } catch (error) {
    const stored = (await serviceRef.get()).data() || {};
    if (stored.fotos?.[moment]?.hash !== hash) await file.delete({ignoreNotFound: true});
    throw error;
  }
}

module.exports = {fotosServicioOTHandler};
