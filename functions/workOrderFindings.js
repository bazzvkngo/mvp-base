"use strict";

// Hallazgos de la ejecución (prototipo «Panel del Taller»): observaciones fuera del motivo de ingreso.
// Son observaciones, no trabajos: solo un Owner o Administrador puede convertirlas en trabajo, cuando el
// cliente decide hacerlo. La foto es opcional; si se adjunta, se trata como las demás fotos del taller (JPEG sin
// metadatos, guardada solo desde el servidor, sellada con fecha y usuario). No contiene montos.

const {createHash} = require("node:crypto");
const {requireTallerAccess, assertFreshTallerAccess} = require("./tallerAccess");
const {
  appendPlanningEvent, assertWorkOperator, diagnosisActor, identifier, requestIdentifier,
  assertPlanningOrder, assertPlanningItem, invalidateWorkOrderScope, assertStoredWorkOrder, text,
} = require("./workOrderPersistence");
const {decodePhoto} = require("./workOrderReceptionPhotos");

const OPERATIONS = new Set(["reportar", "listar", "foto", "convertir"]);
const INPUT_FIELDS = new Set([
  "businessId", "otId", "operacion", "requestId", "descripcion", "urgente", "imagen", "hallazgoId", "itemId",
]);
const MAX_DESCRIPTION = 500;

function fail(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

function photoPath(businessId, otId, findingId, hash) {
  return `negocios/${businessId}/ordenesTrabajo/${otId}/hallazgos/${findingId}-${hash.slice(0, 16)}.jpg`;
}

function assertFinding(snapshot, businessId, otId, HttpsError) {
  const finding = snapshot.data() || {};
  if (!snapshot.exists || finding.hallazgoId !== snapshot.id || finding.negocioId !== businessId || finding.otId !== otId) {
    fail(HttpsError, "not-found", "No se encontró el hallazgo.");
  }
  return finding;
}

function publicFinding(id, finding) {
  return {
    hallazgoId: id, descripcion: finding.descripcion, urgente: finding.urgente === true,
    reportadoPorNombre: finding.reportadoPorNombre || "Usuario no disponible",
    creadoEn: finding.creadoEn?.toMillis?.() || null,
    tieneFoto: Boolean(finding.foto?.hash), convertido: Boolean(finding.servicioOtId), servicioOtId: finding.servicioOtId || null,
  };
}

async function hallazgosOTHandler(request, dependencies) {
  const {db, bucket, FieldValue, HttpsError} = dependencies;
  const data = request?.data || {};
  if (Object.keys(data).some((key) => !INPUT_FIELDS.has(key)) || !OPERATIONS.has(data.operacion)) {
    fail(HttpsError, "invalid-argument", "La solicitud de hallazgo no es válida.");
  }
  const operation = data.operacion;
  const capability = operation === "convertir" ? "manage" : operation === "reportar" ? "operate" : "read";
  const context = await requireTallerAccess(request, dependencies, capability);
  const otId = identifier(data.otId, "La orden de trabajo", HttpsError);
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const findings = orderRef.collection("hallazgos");

  if (operation === "listar") {
    assertStoredWorkOrder(await orderRef.get(), context.businessId, HttpsError);
    const snapshot = await findings.get();
    return {hallazgos: snapshot.docs
      .filter((entry) => (entry.data() || {}).negocioId === context.businessId && (entry.data() || {}).otId === otId)
      .map((entry) => publicFinding(entry.id, entry.data()))
      .sort((a, b) => (b.creadoEn || 0) - (a.creadoEn || 0))};
  }

  if (operation === "foto") {
    const findingId = identifier(data.hallazgoId, "El hallazgo", HttpsError);
    assertStoredWorkOrder(await orderRef.get(), context.businessId, HttpsError);
    const finding = assertFinding(await findings.doc(findingId).get(), context.businessId, otId, HttpsError);
    if (!finding.foto?.hash) fail(HttpsError, "not-found", "La foto no está disponible.");
    const [bytes] = await bucket.file(photoPath(context.businessId, otId, findingId, finding.foto.hash)).download();
    return {hallazgoId: findingId, imagen: bytes.toString("base64"),
      subidaPorNombre: finding.foto.subidaPorNombre || "", subidaEn: finding.foto.subidaEn?.toMillis?.() || null};
  }

  if (operation === "convertir") {
    const findingId = identifier(data.hallazgoId, "El hallazgo", HttpsError);
    const itemId = identifier(data.itemId, "El servicio de Inventario", HttpsError);
    const serviceId = requestIdentifier(data.requestId, HttpsError);
    const serviceRef = orderRef.collection("servicios").doc(serviceId);
    const findingRef = findings.doc(findingId);
    const itemRef = context.businessRef.collection("inventario").doc(itemId);
    const actorSnapshot = await diagnosisActor(dependencies, context.uid);
    return db.runTransaction(async (transaction) => {
      await assertFreshTallerAccess(transaction, context, dependencies, "manage");
      const [orderSnapshot, findingSnapshot, serviceSnapshot, itemSnapshot] = await Promise.all([
        transaction.get(orderRef), transaction.get(findingRef), transaction.get(serviceRef), transaction.get(itemRef),
      ]);
      const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
      const finding = assertFinding(findingSnapshot, context.businessId, otId, HttpsError);
      if (finding.servicioOtId) {
        if (finding.servicioOtId === serviceId) return {servicioOtId: serviceId, sinCambios: true};
        fail(HttpsError, "failed-precondition", "Este hallazgo ya se convirtió en un trabajo.");
      }
      if (serviceSnapshot.exists) fail(HttpsError, "already-exists", "Esta solicitud de servicio ya fue utilizada.");
      assertPlanningOrder(order, HttpsError);
      assertPlanningItem(itemSnapshot, context.businessId, itemId, "servicio", HttpsError);
      const timestamp = FieldValue.serverTimestamp();
      transaction.create(serviceRef, {
        servicioOtId: serviceId, negocioId: context.businessId, otId, itemId,
        estado: "pendiente", precioUnitario: null, servicioSnapshot: null, productos: [],
        repuestosModo: null, fotos: {}, origenHallazgoId: findingId,
        creadoPorUid: context.uid, creadoEn: timestamp, actualizadoPorUid: context.uid, actualizadoEn: timestamp,
      });
      transaction.update(findingRef, {servicioOtId: serviceId, convertidoEn: timestamp,
        convertidoPorUid: context.uid, convertidoPorNombre: actorSnapshot.nombre});
      invalidateWorkOrderScope(transaction, orderRef, order, context, actorSnapshot, timestamp);
      appendPlanningEvent(transaction, orderRef, {businessId: context.businessId, actorUid: context.uid,
        actorSnapshot, timestamp, type: "hallazgo_convertido", detail: {hallazgoId: findingId, servicioOtId: serviceId}});
      return {servicioOtId: serviceId, sinCambios: false};
    });
  }

  // reportar
  const description = text(data.descripcion, "La descripción del hallazgo", MAX_DESCRIPTION, HttpsError, {required: true});
  if (typeof data.urgente !== "boolean") fail(HttpsError, "invalid-argument", "Indica si el hallazgo es urgente o recomendado.");
  const findingId = requestIdentifier(data.requestId, HttpsError);
  const hasPhoto = data.imagen !== undefined && data.imagen !== null && data.imagen !== "";
  const bytes = hasPhoto ? decodePhoto(data.imagen, HttpsError) : null;
  const hash = bytes ? createHash("sha256").update(bytes).digest("hex") : null;
  const findingRef = findings.doc(findingId);
  const preliminary = await orderRef.get();
  assertWorkOperator(context.membership, assertStoredWorkOrder(preliminary, context.businessId, HttpsError), context.uid, HttpsError);
  const actorSnapshot = await diagnosisActor(dependencies, context.uid);
  const file = bytes ? bucket.file(photoPath(context.businessId, otId, findingId, hash)) : null;
  if (file) await file.save(bytes, {resumable: false, contentType: "image/jpeg", metadata: {metadata: {sha256: hash}}});
  try {
    return await db.runTransaction(async (transaction) => {
      const membership = await assertFreshTallerAccess(transaction, context, dependencies, "operate");
      const [orderSnapshot, existing] = await Promise.all([transaction.get(orderRef), transaction.get(findingRef)]);
      const order = assertStoredWorkOrder(orderSnapshot, context.businessId, HttpsError);
      assertWorkOperator(membership, order, context.uid, HttpsError);
      if (existing.exists) {
        const stored = existing.data() || {};
        if (stored.reportadoPorUid !== context.uid || (stored.foto?.hash || null) !== hash) {
          fail(HttpsError, "already-exists", "Esta solicitud de hallazgo ya fue utilizada.");
        }
        return {hallazgoId: findingId, sinCambios: true};
      }
      if (order.estado !== "en_reparacion" || order.estadoAprobacion !== "aprobada") {
        fail(HttpsError, "failed-precondition", "Los hallazgos se reportan durante la ejecución.");
      }
      const timestamp = FieldValue.serverTimestamp();
      transaction.create(findingRef, {
        hallazgoId: findingId, negocioId: context.businessId, otId, descripcion: description, urgente: data.urgente,
        foto: bytes ? {hash, bytes: bytes.length, subidaPorUid: context.uid, subidaPorNombre: actorSnapshot.nombre, subidaEn: timestamp} : null,
        reportadoPorUid: context.uid, reportadoPorNombre: actorSnapshot.nombre, creadoEn: timestamp, servicioOtId: null,
      });
      transaction.update(orderRef, {actualizadoPorUid: context.uid, actualizadoEn: timestamp});
      appendPlanningEvent(transaction, orderRef, {businessId: context.businessId, actorUid: context.uid,
        actorSnapshot, timestamp, type: "hallazgo_reportado", detail: {hallazgoId: findingId, urgente: data.urgente}});
      return {hallazgoId: findingId, sinCambios: false};
    });
  } catch (error) {
    const stored = (await findingRef.get()).data() || {};
    if (file && stored.foto?.hash !== hash) await file.delete({ignoreNotFound: true});
    throw error;
  }
}

module.exports = {hallazgosOTHandler};
