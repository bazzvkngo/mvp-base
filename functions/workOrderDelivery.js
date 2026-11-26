"use strict";

// Entrega del vehículo con trazabilidad (prototipo «Panel del Taller» + requisito legal del usuario):
// siete fotos de entrega, selladas con fecha y usuario, para comparar cómo llegó y cómo se retira el
// vehículo; el acta con quién retira (nombre y documento) la lee solo el Owner/Administrador; y el contacto
// rápido con el cliente (llamar o WhatsApp). Las fotos y el acta viven en una subcolección que solo toca
// el servidor. Sin montos.

const {createHash} = require("node:crypto");
const {requireTallerAccess, assertFreshTallerAccess, hasTallerCapability} = require("./tallerAccess");
const {
  appendPlanningEvent, assertWorkOperator, canOperateWorks, diagnosisActor, identifier, assertStoredWorkOrder,
} = require("./workOrderPersistence");
const {decodePhoto} = require("./workOrderReceptionPhotos");
const {
  DELIVERY_PHOTO_ZONES, deliveryPhotoPath, deliveryZone, missingDeliveryZones,
} = require("./workOrderDeliveryRules");
const {normalizeContactPhone} = require("./contactFormatting");

const OPERATIONS = new Set(["subir", "leer", "estado", "acta", "contacto", "ingreso"]);
const INPUT_FIELDS = new Set(["businessId", "otId", "operacion", "zona", "imagen"]);

function fail(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

// Las fotos de entrega se toman cuando el vehículo está listo para retirar.
function assertDeliveryOpen(order, HttpsError) {
  if (order.estado !== "pendiente_entrega") {
    fail(HttpsError, "failed-precondition", "Las fotos de entrega se registran cuando el vehículo está pendiente de entrega.");
  }
}

function photosView(acta) {
  const photos = acta?.fotos || {};
  return DELIVERY_PHOTO_ZONES.map((zone) => ({
    zona: zone.id, etiqueta: zone.label, completa: Boolean(photos[zone.id]?.hash),
    subidaPorNombre: photos[zone.id]?.subidaPorNombre || "", subidaEn: photos[zone.id]?.subidaEn?.toMillis?.() || null,
  }));
}

async function entregaOTHandler(request, dependencies) {
  const {db, bucket, FieldValue, HttpsError} = dependencies;
  const data = request?.data || {};
  if (Object.keys(data).some((key) => !INPUT_FIELDS.has(key)) || !OPERATIONS.has(data.operacion)) {
    fail(HttpsError, "invalid-argument", "La solicitud de entrega no es válida.");
  }
  const operation = data.operacion;
  const context = await requireTallerAccess(request, dependencies, ["subir", "contacto"].includes(operation) ? "operate" : "read");
  const otId = identifier(data.otId, "La orden de trabajo", HttpsError);
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const actaRef = orderRef.collection("entrega").doc("acta");
  const readOrder = async () => assertStoredWorkOrder(await orderRef.get(), context.businessId, HttpsError);

  if (operation === "estado") {
    await readOrder();
    const snapshot = await actaRef.get();
    const acta = snapshot.exists ? snapshot.data() : {};
    return {fotos: photosView(acta), faltantes: missingDeliveryZones(acta),
      entregada: Boolean(acta.entregadaEn), receptorNombre: acta.receptorNombre || null,
      entregadaPorNombre: acta.entregadaPorNombre || null, entregadaEn: acta.entregadaEn?.toMillis?.() || null,
      conObservaciones: Boolean(acta.observaciones)};
  }

  if (operation === "acta") {
    // Contiene el documento de quien retira: solo Owner/Administrador.
    if (!hasTallerCapability(context.membership, "manage")) {
      fail(HttpsError, "permission-denied", "Solo el Owner o el Administrador pueden ver el acta de entrega.");
    }
    await readOrder();
    const snapshot = await actaRef.get();
    if (!snapshot.exists || !snapshot.data().entregadaEn) fail(HttpsError, "not-found", "La entrega aún no se registra.");
    const acta = snapshot.data();
    return {receptorNombre: acta.receptorNombre, receptorDocumento: acta.receptorDocumento,
      observaciones: acta.observaciones || "", conforme: acta.conforme === true,
      entregadaPorNombre: acta.entregadaPorNombre, entregadaEn: acta.entregadaEn?.toMillis?.() || null};
  }

  if (operation === "ingreso") {
    // Quién dejó el vehículo en el taller, con su documento: solo Owner/Administrador.
    if (!hasTallerCapability(context.membership, "manage")) {
      fail(HttpsError, "permission-denied", "Solo el Owner o el Administrador pueden ver el documento de quien entregó el vehículo.");
    }
    await readOrder();
    const snapshot = await orderRef.collection("recepcionActa").doc("persona").get();
    if (!snapshot.exists) fail(HttpsError, "not-found", "La recepción no registra quién entregó el vehículo.");
    const person = snapshot.data();
    return {nombre: person.nombre || "", documento: person.documento || ""};
  }

  if (operation === "contacto") {
    // Teléfono del cliente: solo Owner/Administrador o el responsable de la OT.
    const order = await readOrder();
    if (!canOperateWorks(context.membership, order, context.uid)) {
      fail(HttpsError, "permission-denied", "Solo el responsable, el Administrador o el Owner pueden contactar al cliente.");
    }
    const clientId = identifier(order.clienteId, "El cliente", HttpsError);
    const client = await context.businessRef.collection("clientes").doc(clientId).get();
    const stored = client.data() || {};
    if (!client.exists || stored.negocioId !== context.businessId) fail(HttpsError, "not-found", "No se encontró el cliente de la orden.");
    const country = context.businessSnapshot?.data()?.paisCodigo || "CL";
    const phone = normalizeContactPhone(stored.telefono, country);
    return {nombre: String(stored.nombreRazonSocial || "Cliente"), telefono: phone || null,
      telefonoInternacional: phone ? phone.replace(/\D/g, "") : null};
  }

  const zone = deliveryZone(data.zona);
  if (!zone) fail(HttpsError, "invalid-argument", "La zona de la foto no es válida.");

  if (operation === "leer") {
    await readOrder();
    const snapshot = await actaRef.get();
    const photo = snapshot.exists ? snapshot.data().fotos?.[zone.id] : null;
    if (!photo?.hash) fail(HttpsError, "not-found", "La foto no está disponible.");
    const [bytes] = await bucket.file(deliveryPhotoPath(context.businessId, otId, zone.id, photo.hash)).download();
    return {zona: zone.id, imagen: bytes.toString("base64"), subidaPorNombre: photo.subidaPorNombre || "",
      subidaEn: photo.subidaEn?.toMillis?.() || null};
  }

  // subir: JPEG sin metadatos; sellada (no se reemplaza ni se quita).
  const bytes = decodePhoto(data.imagen, HttpsError);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const sealedMessage = `La foto de entrega «${zone.label}» ya fue registrada y no se puede modificar.`;
  const initialOrder = await readOrder();
  assertWorkOperator(context.membership, initialOrder, context.uid, HttpsError);
  assertDeliveryOpen(initialOrder, HttpsError);
  const initialActa = await actaRef.get();
  const existing = initialActa.exists ? initialActa.data().fotos?.[zone.id] : null;
  if (existing?.hash) {
    if (existing.hash === hash) return {zona: zone.id, sinCambios: true};
    fail(HttpsError, "failed-precondition", sealedMessage);
  }
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  const file = bucket.file(deliveryPhotoPath(context.businessId, otId, zone.id, hash));
  await file.save(bytes, {resumable: false, contentType: "image/jpeg", metadata: {metadata: {sha256: hash, zona: zone.id}}});
  try {
    return await db.runTransaction(async (transaction) => {
      const membership = await assertFreshTallerAccess(transaction, context, dependencies, "operate");
      const [orderSnapshot, actaSnapshot] = await Promise.all([transaction.get(orderRef), transaction.get(actaRef)]);
      const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
      assertWorkOperator(membership, order, context.uid, HttpsError);
      assertDeliveryOpen(order, HttpsError);
      const current = actaSnapshot.exists ? actaSnapshot.data().fotos?.[zone.id] : null;
      if (current?.hash) {
        if (current.hash === hash) return {zona: zone.id, sinCambios: true};
        fail(HttpsError, "failed-precondition", sealedMessage);
      }
      const timestamp = FieldValue.serverTimestamp();
      const photo = {hash, bytes: bytes.length, subidaPorUid: context.uid, subidaPorNombre: actorSnapshot.nombre, subidaEn: timestamp};
      if (actaSnapshot.exists) transaction.update(actaRef, {[`fotos.${zone.id}`]: photo});
      else transaction.create(actaRef, {negocioId: context.businessId, otId, fotos: {[zone.id]: photo}});
      transaction.update(orderRef, {actualizadoPorUid: context.uid, actualizadoEn: timestamp});
      appendPlanningEvent(transaction, orderRef, {businessId: context.businessId, actorUid: context.uid, actorSnapshot, timestamp,
        type: "foto_entrega_registrada", detail: {zona: zone.id}});
      return {zona: zone.id, sinCambios: false, subidaPorNombre: actorSnapshot.nombre};
    });
  } catch (error) {
    const stored = (await actaRef.get()).data() || {};
    if (stored.fotos?.[zone.id]?.hash !== hash) await file.delete({ignoreNotFound: true});
    throw error;
  }
}

module.exports = {entregaOTHandler};
