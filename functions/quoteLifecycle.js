const {SALES_WRITE_ROLES} = require("./rbac");
const QUOTE_LIFECYCLE_REQUEST_PATTERN = /^[A-Za-z0-9_-]{8,160}$/;
const {
  linkedWorkFields,
  writeQuoteResponseEvent,
} = require("./workPersistence");
const {createConfirmedSaleFromQuoteInTransaction} = require("./salePersistence");
const QUOTE_STATUSES = new Set([
  "borrador",
  "emitida",
  "aceptada",
  "rechazada",
  "vencida",
  "archivada",
]);

function safeText(value, maxLength = 2000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeLifecycleRequestId(value, HttpsError) {
  const requestId = safeText(value, 160);
  if (!QUOTE_LIFECYCLE_REQUEST_PATTERN.test(requestId)) {
    throw new HttpsError(
      "invalid-argument",
      "La operación requiere un requestId válido."
    );
  }
  return requestId;
}

function quoteOpportunityVersion(quote = {}) {
  const version = Number(quote.oportunidadVersion);
  return Number.isSafeInteger(version) && version > 0 ? version : 1;
}

function quoteHasActiveResponse(quote = {}) {
  if (!quote.respuestaCliente) return false;
  const responseVersion = Number(quote.respuestaOportunidadVersion);
  return Number.isSafeInteger(responseVersion)
    ? responseVersion === quoteOpportunityVersion(quote)
    : quoteOpportunityVersion(quote) === 1;
}

function quoteEventRef(quoteRef, eventId) {
  return quoteRef.collection("eventos").doc(eventId);
}

function buildQuoteEvent({
  businessId,
  eventType,
  FieldValue,
  medium = "sistema",
  quoteId,
  requestId,
  resultingStatus = "",
  previousStatus = "",
  recipient = "",
  uid = "",
  details = {},
}) {
  return {
    negocioId: businessId,
    cotizacionId: quoteId,
    tipo: eventType,
    estadoAnterior: previousStatus,
    estadoResultante: resultingStatus,
    medio: medium,
    destinatario: safeText(recipient, 240),
    uidUsuario: safeText(uid, 160),
    requestId: safeText(requestId, 160),
    detalle: details && typeof details === "object" ? details : {},
    creadoEn: FieldValue.serverTimestamp(),
  };
}

function assertTransitionAllowed(quote, targetStatus, HttpsError) {
  const currentStatus = safeText(quote.estado, 30) || "borrador";
  if (!QUOTE_STATUSES.has(targetStatus)) {
    throw new HttpsError("invalid-argument", "Estado de cotización inválido.");
  }
  if (currentStatus === targetStatus) return;

  const allowed = (
    (currentStatus === "borrador" && ["emitida", "archivada"].includes(targetStatus)) ||
    (currentStatus === "emitida" &&
      ["aceptada", "rechazada", "vencida", "archivada"].includes(targetStatus)) ||
    (["aceptada", "rechazada", "vencida"].includes(currentStatus) &&
      targetStatus === "archivada") ||
    (currentStatus === "archivada" && targetStatus === quote.estadoAnterior)
  );
  if (!allowed) {
    throw new HttpsError(
      "failed-precondition",
      "La transición solicitada requiere reabrir la cotización o no está permitida."
    );
  }
}

async function transitionQuoteStatusHandler(request, dependencies) {
  const {
    buildQuoteEmissionPatch,
    FieldValue,
    HttpsError,
    requireBusinessAccess,
  } = dependencies;
  if (!request?.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  const {businessId, businessRef, membership, uid} = await requireBusinessAccess(
    request,
    dependencies,
    {roles: SALES_WRITE_ROLES, requiresVerifiedBusiness: true}
  );
  const quoteId = safeText(request?.data?.quoteId, 160);
  const targetStatus = safeText(request?.data?.estado, 30).toLowerCase();
  const requestId = normalizeLifecycleRequestId(
    request?.data?.requestId,
    HttpsError
  );
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(quoteId)) {
    throw new HttpsError("invalid-argument", "Selecciona una cotización válida.");
  }

  const quoteRef = businessRef.collection("cotizaciones").doc(quoteId);
  const requestRef = businessRef.collection("quoteLifecycleRequests").doc(requestId);
  const eventRef = quoteEventRef(quoteRef, `estado__${requestId}`);
  const transitionNow = new Date(dependencies.now?.() || Date.now());
  let result;
  await businessRef.firestore.runTransaction(async (transaction) => {
    const [previousRequest, quoteSnapshot] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(quoteRef),
    ]);
    if (previousRequest.exists) {
      const stored = previousRequest.data() || {};
      if (
        stored.cotizacionId !== quoteId ||
        stored.accion !== "cambiar_estado" ||
        stored.estadoObjetivo !== targetStatus ||
        stored.uidUsuario !== uid
      ) {
        throw new HttpsError(
          "already-exists",
          "El requestId ya fue utilizado para otra operación."
        );
      }
      result = {...(stored.resultado || {}), idempotent: true};
      return;
    }
    if (!quoteSnapshot.exists) {
      throw new HttpsError("not-found", "No se encontró la cotización.");
    }
    const quote = quoteSnapshot.data() || {};
    if (quote.negocioId && quote.negocioId !== businessId) {
      throw new HttpsError("permission-denied", "No puedes modificar esta cotización.");
    }
    const workRef = quote.trabajoId
      ? businessRef.collection("trabajos").doc(safeText(quote.trabajoId, 160))
      : null;
    const workSnapshot = workRef ? await transaction.get(workRef) : null;
    if (workRef) linkedWorkFields(workSnapshot, businessId, HttpsError);
    const previousStatus = safeText(quote.estado, 30) || "borrador";
    assertTransitionAllowed(quote, targetStatus, HttpsError);
    if (previousStatus === targetStatus) {
      result = {
        estado: targetStatus,
        ...(quote.ventaId ? {
          ventaId: quote.ventaId,
          ventaNumero: quote.ventaNumero || "",
          ventaEstado: quote.ventaEstado || "confirmada",
        } : {}),
        idempotent: true,
      };
    } else {
      const acceptedSale = targetStatus === "aceptada"
        ? await createConfirmedSaleFromQuoteInTransaction({
            actor: {
              uid,
              nombre: membership?.nombre || membership?.correo || "Persona del equipo",
              correo: membership?.correo || "",
              origen: "aceptacion_manual",
            },
            businessId,
            businessRef,
            clock: transitionNow,
            dependencies,
            quote,
            quoteId,
            transaction,
          })
        : null;
      const patch = targetStatus === "emitida"
        ? buildQuoteEmissionPatch({
            channel: "manual",
            detectedBy: "confirmacion_usuario",
            FieldValue,
            now: transitionNow,
            quote,
          })
        : {estado: targetStatus};
      if (targetStatus === "archivada") patch.estadoAnterior = previousStatus;
      transaction.update(quoteRef, {
        ...patch,
        ...(acceptedSale?.quotePatch || {}),
        actualizadoEn: FieldValue.serverTimestamp(),
      });
      transaction.create(eventRef, buildQuoteEvent({
        businessId,
        eventType: "estado_cambiado",
        FieldValue,
        medium: "manual",
        quoteId,
        requestId,
        resultingStatus: targetStatus,
        previousStatus,
        uid,
      }));
      if (workRef && ["aceptada", "rechazada"].includes(targetStatus)) {
        writeQuoteResponseEvent(transaction, workRef, {
          actor: {nombre: "Persona del equipo"},
          actorUid: uid,
          businessId,
          eventKey: requestId,
          quoteId,
          quoteNumber: quote.numero,
          response: targetStatus,
          timestamp: FieldValue.serverTimestamp(),
        });
      }
      result = {
        estado: targetStatus,
        ...(acceptedSale ? {
          ventaId: acceptedSale.sale.id,
          ventaNumero: acceptedSale.sale.numero,
          ventaEstado: acceptedSale.sale.estado,
          estadoStock: acceptedSale.sale.estadoStock,
          alertasStock: acceptedSale.sale.alertasStock,
        } : {}),
        ...(patch.estadoAnterior ? {estadoAnterior: patch.estadoAnterior} : {}),
        ...(patch.canalEmision ? {
          canalEmision: patch.canalEmision,
          fechaEmision: transitionNow.toISOString(),
          fechaVencimiento: patch.fechaVencimiento,
        } : {}),
        idempotent: false,
      };
    }
    transaction.set(requestRef, {
      negocioId: businessId,
      cotizacionId: quoteId,
      accion: "cambiar_estado",
      estadoObjetivo: targetStatus,
      uidUsuario: uid,
      resultado: result,
      creadoEn: FieldValue.serverTimestamp(),
    });
  });
  return {success: true, quoteStatus: result};
}

module.exports = {
  buildQuoteEvent,
  normalizeLifecycleRequestId,
  quoteEventRef,
  quoteHasActiveResponse,
  quoteOpportunityVersion,
  transitionQuoteStatusHandler,
};
