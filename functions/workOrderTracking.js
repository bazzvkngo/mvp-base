"use strict";

// Seguimiento público del Taller (prototipo «Panel del Taller», etapa 5).
// - `seguimientoOT` (personal del taller): entrega el enlace único de la OT (con el ingreso aprobado y la
//   ejecución iniciada) y la dirección pública de consulta con patente + RUT (/seguimiento).
// - `consultarSeguimientoTaller` (público, sin sesión): abre la vista con el enlace.
// - `buscarSeguimientoTaller` (público, sin sesión): patente + RUT en /seguimiento (toda la plataforma), con
//   límite de intentos por IP y por patente. El RUT puede ser el del titular de la OT o el de quien entregó el vehículo.
// Los tokens y contadores viven en colecciones que solo toca el servidor. La vista pública no incluye montos,
// técnico, plaza, fotos ni datos personales; el enlace deja de funcionar al entregar o anular la OT.

const {requireTallerAccess} = require("./tallerAccess");
const {identifier} = require("./workOrderPersistence");
const {
  MAX_BUSINESSES_PER_PLATE, PLATE_INDEX_COLLECTION, attemptKey, buildPublicView, canShareTrackingLink, createTokenMaterial,
  isBlocked, isVisibleOrder, normalizeDocument, normalizePlate, plateIndexId, registerFailure, validTokenHash,
} = require("./workOrderTrackingRules");

const TOKENS = "tallerSeguimientoTokens";
const ATTEMPTS = "tallerSeguimientoIntentos";
const INACTIVE_LINK = "Este enlace ya no está activo.";
const NOT_FOUND = "No encontramos un vehículo en el taller con esos datos.";
const TOO_MANY = "Demasiados intentos. Intenta nuevamente en unos minutos.";

// Misma dirección pública que las propuestas de cotización (functions/quotePublicProposal.js); en emuladores,
// localhost. Se replica aquí para no cargar el módulo de cotizaciones en el Taller.
const PUBLIC_BASE_URL = "https://valoracloud.bagner.cl";
const EMULATOR_PUBLIC_BASE_URL = "http://localhost:5173";

function getPublicBaseUrl(env = process.env) {
  if (env.FUNCTIONS_EMULATOR !== "true" && !env.FIRESTORE_EMULATOR_HOST) return PUBLIC_BASE_URL;
  const configured = String(env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configured) ? configured : EMULATOR_PUBLIC_BASE_URL;
}

function fail(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

function trackingUrls(token) {
  const base = getPublicBaseUrl().replace(/\/+$/, "");
  return {url: `${base}/seguimiento/${token}`, urlConsulta: `${base}/seguimiento`};
}

// Registra la patente en el índice de la consulta pública (patente + RUT en /seguimiento). Se llama dentro de
// una transacción, después de las lecturas. Una entrada vieja no expone nada: la consulta siempre revisa la OT.
function indexPlateForTracking(transaction, {db, FieldValue}, plate, businessId) {
  const normalized = normalizePlate(plate);
  if (!normalized || typeof businessId !== "string" || !businessId) return;
  transaction.set(db.collection(PLATE_INDEX_COLLECTION).doc(plateIndexId(normalized)), {
    negocios: FieldValue.arrayUnion(businessId), actualizadoEn: FieldValue.serverTimestamp(),
  }, {merge: true});
}

function businessIsActive(snapshot) {
  const data = snapshot?.data?.() || {};
  return Boolean(snapshot?.exists) && data.estado === "activo" && !data.eliminadoEn;
}

// ---------- Personal del taller ----------

async function seguimientoOTHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const data = request?.data || {};
  if (Object.keys(data).some((key) => !["businessId", "otId", "operacion"].includes(key)) || data.operacion !== "enlace") {
    fail(HttpsError, "invalid-argument", "La solicitud de seguimiento no es válida.");
  }
  const context = await requireTallerAccess(request, dependencies, "operate");
  const otId = identifier(data.otId, "La orden de trabajo", HttpsError);
  const orderRef = context.businessRef.collection("ordenesTrabajo").doc(otId);
  const linkRef = orderRef.collection("seguimiento").doc("enlace");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const material = createTokenMaterial();
    try {
      return await db.runTransaction(async (transaction) => {
        const [orderSnapshot, linkSnapshot] = await transaction.getAll(orderRef, linkRef);
        const order = orderSnapshot.data() || {};
        if (!orderSnapshot.exists || order.negocioId !== context.businessId) fail(HttpsError, "not-found", "No se encontró la orden de trabajo.");
        if (!canShareTrackingLink(order)) {
          fail(HttpsError, "failed-precondition", "El enlace de seguimiento se activa cuando el ingreso está aprobado y comenzó la ejecución.");
        }
        const vehicle = order.vehiculoId
          ? await transaction.get(context.businessRef.collection("vehiculos").doc(order.vehiculoId)) : null;
        const timestamp = FieldValue.serverTimestamp();
        // OT recibidas antes del índice de patentes: quedan disponibles en la consulta pública al compartir el enlace.
        indexPlateForTracking(transaction, dependencies, vehicle?.data()?.patente, context.businessId);
        let token = linkSnapshot.data()?.token;
        if (!linkSnapshot.exists || typeof token !== "string") {
          token = material.token;
          transaction.create(db.collection(TOKENS).doc(material.tokenHash), {
            negocioId: context.businessId, otId, estado: "activo", creadoPorUid: context.uid, creadoEn: timestamp,
          });
          transaction.create(linkRef, {negocioId: context.businessId, otId, token, tokenHash: material.tokenHash,
            creadoPorUid: context.uid, creadoEn: timestamp});
        }
        return {...trackingUrls(token), activo: true};
      });
    } catch (error) {
      // Colisión improbable de token: se reintenta con otro.
      if (error?.code === 6 || /already exists/i.test(String(error?.message))) continue;
      throw error;
    }
  }
  fail(HttpsError, "aborted", "No se pudo preparar el seguimiento. Intenta nuevamente.");
}

// ---------- Vista pública (compartida por ambos ingresos) ----------

async function loadPublicView(db, businessId, otId, {linkOnly = false} = {}) {
  const businessRef = db.collection("negocios").doc(businessId);
  const orderRef = businessRef.collection("ordenesTrabajo").doc(otId);
  const [business, profile, orderSnapshot] = await db.getAll(businessRef, businessRef.collection("empresa").doc("perfil"), orderRef);
  const order = orderSnapshot.data() || {};
  if (!businessIsActive(business) || !orderSnapshot.exists || order.negocioId !== businessId || !isVisibleOrder(order)) return null;
  // Por enlace solo se ve desde el inicio de la ejecución hasta la entrega.
  if (linkOnly && !canShareTrackingLink(order)) return null;
  const [vehicle, servicesSnapshot, findingsSnapshot] = await Promise.all([
    order.vehiculoId ? businessRef.collection("vehiculos").doc(order.vehiculoId).get() : null,
    orderRef.collection("servicios").get(),
    orderRef.collection("hallazgos").get(),
  ]);
  const services = servicesSnapshot.docs.map((doc) => doc.data()).filter((service) => service.negocioId === businessId && service.otId === otId);
  const itemIds = [...new Set(services.map((service) => service.itemId).filter((id) => typeof id === "string" && id))];
  const items = itemIds.length ? await db.getAll(...itemIds.map((id) => businessRef.collection("inventario").doc(id))) : [];
  const names = new Map(items.filter((item) => item.exists).map((item) => [item.id, item.data()?.nombre]));
  return buildPublicView({
    business: business.data(), profile: profile.exists ? profile.data() : {}, order,
    vehicle: vehicle?.exists ? vehicle.data() : {},
    services: services.map((service) => ({...service, nombre: names.get(service.itemId) || service.servicioSnapshot?.nombre})),
    findings: findingsSnapshot.docs.map((doc) => doc.data()).filter((finding) => finding.negocioId === businessId && finding.otId === otId),
  });
}

async function consultarSeguimientoTallerHandler(request, dependencies) {
  const {db, HttpsError} = dependencies;
  const data = request?.data || {};
  const tokenHash = Object.keys(data).every((key) => key === "token") ? validTokenHash(data.token) : "";
  if (!tokenHash) fail(HttpsError, "not-found", INACTIVE_LINK);
  const tokenRef = db.collection(TOKENS).doc(tokenHash);
  const tokenSnapshot = await tokenRef.get();
  const tokenData = tokenSnapshot.data() || {};
  if (!tokenSnapshot.exists || tokenData.estado !== "activo" || typeof tokenData.negocioId !== "string" || typeof tokenData.otId !== "string") {
    fail(HttpsError, "not-found", INACTIVE_LINK);
  }
  const view = await loadPublicView(db, tokenData.negocioId, tokenData.otId, {linkOnly: true});
  if (!view) {
    // La OT se entregó, se anuló o el taller dejó de operar: el enlace queda inactivo para siempre.
    await tokenRef.set({estado: "inactivo", inactivadoEn: dependencies.FieldValue.serverTimestamp()}, {merge: true});
    fail(HttpsError, "not-found", INACTIVE_LINK);
  }
  return {seguimiento: view};
}

// ---------- Consulta con patente + RUT ----------

function requestIp(request) {
  const forwarded = String(request?.rawRequest?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return String(request?.rawRequest?.ip || forwarded || "sin-ip").slice(0, 80);
}

// Consulta pública de toda la plataforma: la patente lleva, por el índice, a los talleres donde el vehículo fue
// recibido; en cada uno se busca la OT abierta del vehículo y el RUT debe ser el del titular de la OT o el de quien
// entregó el vehículo. Límite: 3 fallos en 15 minutos bloquean la IP y la patente por 15 minutos.
async function buscarSeguimientoTallerHandler(request, dependencies) {
  const {db, HttpsError} = dependencies;
  const data = request?.data || {};
  if (Object.keys(data).some((key) => !["patente", "rut"].includes(key))) {
    fail(HttpsError, "invalid-argument", "La consulta no es válida.");
  }
  const plate = normalizePlate(data.patente);
  if (!plate || typeof data.rut !== "string" || !data.rut.trim()) fail(HttpsError, "invalid-argument", "Completa la patente y el RUT.");

  const now = Date.now();
  const ipRef = db.collection(ATTEMPTS).doc(attemptKey("ip", requestIp(request)));
  const plateRef = db.collection(ATTEMPTS).doc(attemptKey("patente", plate));
  const indexRef = db.collection(PLATE_INDEX_COLLECTION).doc(plateIndexId(plate));

  const outcome = await db.runTransaction(async (transaction) => {
    const [ipSnapshot, plateSnapshot, indexSnapshot] = await transaction.getAll(ipRef, plateRef, indexRef);
    if (isBlocked(ipSnapshot.data(), now) || isBlocked(plateSnapshot.data(), now)) return {status: "blocked"};
    const businessIds = (Array.isArray(indexSnapshot.data()?.negocios) ? indexSnapshot.data().negocios : [])
      .filter((id) => typeof id === "string" && id).slice(0, MAX_BUSINESSES_PER_PLATE);
    let match = null;
    for (const businessId of businessIds) {
      const businessRef = db.collection("negocios").doc(businessId);
      const [business, plateKey] = await transaction.getAll(businessRef, businessRef.collection("vehiclePlateKeys").doc(plate));
      const vehiculoId = plateKey.data()?.vehiculoId;
      if (!businessIsActive(business) || plateKey.data()?.negocioId !== businessId || typeof vehiculoId !== "string") continue;
      const country = business.data()?.paisCodigo || "CL";
      const document = normalizeDocument(data.rut, country);
      const orders = await transaction.get(businessRef.collection("ordenesTrabajo").where("vehiculoId", "==", vehiculoId));
      const active = orders.docs.map((doc) => ({id: doc.id, ...doc.data()}))
        .filter((order) => order.negocioId === businessId && isVisibleOrder(order))
        .sort((a, b) => (b.creadoEn?.toMillis?.() || 0) - (a.creadoEn?.toMillis?.() || 0));
      for (const order of active) {
        const [client, person] = await transaction.getAll(
          businessRef.collection("clientes").doc(String(order.clienteId || "-")),
          businessRef.collection("ordenesTrabajo").doc(order.id).collection("recepcionActa").doc("persona"));
        const clientData = client.data() || {};
        const candidates = [
          client.exists && clientData.negocioId === businessId
            ? clientData.identificadorFiscalNormalizado || clientData.identificadorFiscalValor || clientData.rut : "",
          person.exists ? person.data()?.documento : "",
        ].map((value) => normalizeDocument(value, country)).filter(Boolean);
        if (document && candidates.includes(document)) { match = {businessId, otId: order.id}; break; }
      }
      if (match) break;
    }
    if (match) {
      transaction.delete(ipRef);
      transaction.delete(plateRef);
      return {status: "found", ...match};
    }
    let blocked = false;
    for (const [ref, snapshot] of [[ipRef, ipSnapshot], [plateRef, plateSnapshot]]) {
      const {bloqueado, ...next} = registerFailure(snapshot.data(), now);
      transaction.set(ref, next);
      blocked = blocked || bloqueado;
    }
    return {status: blocked ? "blocked" : "missing"};
  });

  if (outcome.status === "blocked") fail(HttpsError, "resource-exhausted", TOO_MANY);
  if (outcome.status !== "found") fail(HttpsError, "not-found", NOT_FOUND);
  const view = await loadPublicView(db, outcome.businessId, outcome.otId);
  if (!view) fail(HttpsError, "not-found", NOT_FOUND);
  return {seguimiento: view};
}

module.exports = {
  buscarSeguimientoTallerHandler, consultarSeguimientoTallerHandler, indexPlateForTracking, seguimientoOTHandler,
  TRACKING_COLLECTIONS: Object.freeze({TOKENS, ATTEMPTS, PLATES: PLATE_INDEX_COLLECTION}),
};
