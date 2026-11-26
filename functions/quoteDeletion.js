// Eliminación definitiva de una cotización en borrador que nunca se emitió.
//
// Es la única vía de borrado de cotizaciones: firestore.rules mantiene
// create/update/delete en false y esta Function usa Admin SDK. Solo
// OWNER/ADMIN activos del negocio pueden usarla y se exige escribir la palabra
// de confirmación también en el backend. Queda un hueco en la numeración
// (aceptado): el contador no se retrocede.
const {BUSINESS_MANAGEMENT_ROLES} = require("./rbac");

const DELETE_CONFIRMATION_WORD = "permanente";
// Una transacción admite 500 escrituras; se deja margen para el proyecto.
const MAX_DELETED_DOCUMENTS = 450;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,160}$/;
const PUBLIC_TOKEN_COLLECTION = "quotePublicTokens";

function safeText(value, maxLength = 2000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== "" && value !== false;
}

function isDeleteConfirmed(value) {
  return safeText(value, 100).toLowerCase() === DELETE_CONFIRMATION_WORD;
}

function reject(HttpsError, message) {
  throw new HttpsError("failed-precondition", message);
}

// Motivos por los que un borrador ya no se puede eliminar. Devuelve el primer
// mensaje aplicable o "" si la cotización sigue siendo un borrador limpio.
function findDeletionBlocker(quote, {envioExists, saleExists, tokenExists}) {
  if ((quote.estado || "borrador") !== "borrador") {
    return "Solo se pueden eliminar cotizaciones pendientes que nunca se emitieron.";
  }
  if (hasValue(quote.fechaEmision) || hasValue(quote.canalEmision)) {
    return "La cotización ya fue emitida y no puede eliminarse.";
  }
  if (hasValue(quote.ventaId) || saleExists) {
    return "La cotización tiene una venta asociada y no puede eliminarse.";
  }
  if (hasValue(quote.respuestaCliente) || hasValue(quote.respuestaClienteEn)) {
    return "La cotización tiene una respuesta del cliente y no puede eliminarse.";
  }
  if (
    envioExists ||
    hasValue(quote.fechaEnvioCorreo) ||
    hasValue(quote.estadoEnvioCorreo)
  ) {
    return "La cotización tiene envíos registrados y no puede eliminarse.";
  }
  if (
    tokenExists ||
    hasValue(quote.tokenPublicoHash) ||
    hasValue(quote.tokenWhatsappHash) ||
    hasValue(quote.propuestaPublicaCreadaEn) ||
    hasValue(quote.whatsappPreparadoEn)
  ) {
    return "La cotización tiene un enlace público emitido y no puede eliminarse.";
  }
  return "";
}

async function deleteQuoteDraftHandler({
  request,
  db,
  FieldValue,
  HttpsError,
  requireBusinessAccess,
}) {
  const {businessId, businessRef, membership, uid} = await requireBusinessAccess(
    request,
    {db, HttpsError},
    {roles: BUSINESS_MANAGEMENT_ROLES, requiresVerifiedBusiness: true}
  );
  const quoteId = safeText(request?.data?.quoteId, 160);
  if (!ID_PATTERN.test(quoteId)) {
    throw new HttpsError("invalid-argument", "Selecciona una cotización válida.");
  }
  if (!isDeleteConfirmed(request?.data?.confirmacion)) {
    throw new HttpsError(
      "invalid-argument",
      `Escribe «${DELETE_CONFIRMATION_WORD}» para confirmar la eliminación.`
    );
  }

  const quoteRef = businessRef.collection("cotizaciones").doc(quoteId);
  const envioRef = businessRef.collection("enviosCotizaciones").doc(quoteId);
  const saleRef = businessRef.collection("ventas").doc(`cotizacion__${quoteId}`);
  const eventsQuery = quoteRef.collection("eventos").limit(MAX_DELETED_DOCUMENTS + 1);
  const createRequestsQuery = businessRef.collection("quoteCreateRequests")
    .where("quoteId", "==", quoteId);
  const copyRequestsQuery = businessRef.collection("quoteDuplicateRequests")
    .where("quoteId", "==", quoteId);
  const originRequestsQuery = businessRef.collection("quoteDuplicateRequests")
    .where("cotizacionOrigenId", "==", quoteId).limit(1);
  const lifecycleRequestsQuery = businessRef.collection("quoteLifecycleRequests")
    .where("cotizacionId", "==", quoteId);
  const tokensQuery = db.collection(PUBLIC_TOKEN_COLLECTION)
    .where("cotizacionId", "==", quoteId);

  return db.runTransaction(async (transaction) => {
    const quoteSnapshot = await transaction.get(quoteRef);
    if (!quoteSnapshot.exists) {
      throw new HttpsError("not-found", "No se encontró la cotización.");
    }
    const quote = quoteSnapshot.data() || {};
    if (quote.negocioId && quote.negocioId !== businessId) {
      throw new HttpsError("permission-denied", "No puedes eliminar esta cotización.");
    }
    const trabajoId = hasValue(quote.trabajoId) ? safeText(quote.trabajoId, 160) : "";
    const workRef = ID_PATTERN.test(trabajoId)
      ? businessRef.collection("trabajos").doc(trabajoId)
      : null;
    const linkRef = workRef ? workRef.collection("vinculos").doc(`cotizacion__${quoteId}`) : null;

    const [
      envioSnapshot,
      saleSnapshot,
      eventsSnapshot,
      createRequestsSnapshot,
      copyRequestsSnapshot,
      originRequestsSnapshot,
      lifecycleRequestsSnapshot,
      tokensSnapshot,
      workSnapshot,
      linkSnapshot,
    ] = await Promise.all([
      transaction.get(envioRef),
      transaction.get(saleRef),
      transaction.get(eventsQuery),
      transaction.get(createRequestsQuery),
      transaction.get(copyRequestsQuery),
      transaction.get(originRequestsQuery),
      transaction.get(lifecycleRequestsQuery),
      transaction.get(tokensQuery),
      workRef ? transaction.get(workRef) : Promise.resolve(null),
      linkRef ? transaction.get(linkRef) : Promise.resolve(null),
    ]);

    const blocker = findDeletionBlocker(quote, {
      envioExists: envioSnapshot.exists,
      saleExists: saleSnapshot.exists,
      tokenExists: tokensSnapshot.docs.some((token) => {
        const data = token.data() || {};
        return !data.negocioId || data.negocioId === businessId;
      }),
    });
    if (blocker) reject(HttpsError, blocker);
    if (!originRequestsSnapshot.empty) {
      reject(
        HttpsError,
        "Otra cotización se creó a partir de esta y no puede eliminarse."
      );
    }
    if (workSnapshot?.exists && (workSnapshot.data() || {}).negocioId !== businessId) {
      throw new HttpsError("permission-denied", "El proyecto no pertenece al negocio.");
    }

    const ownedRequestDocs = [
      ...createRequestsSnapshot.docs,
      ...copyRequestsSnapshot.docs,
      ...lifecycleRequestsSnapshot.docs,
    ];
    const deletions = [quoteRef, ...eventsSnapshot.docs.map((d) => d.ref), ...ownedRequestDocs.map((d) => d.ref)];
    if (deletions.length > MAX_DELETED_DOCUMENTS) {
      reject(HttpsError, "La cotización tiene demasiados registros para eliminarla de una vez.");
    }
    deletions.forEach((ref) => transaction.delete(ref));

    // Proyecto: solo se retira el vínculo y se deja constancia en su historial.
    // Gastos, horas, adicionales e inventario no se tocan.
    let linkRemoved = false;
    if (workSnapshot?.exists) {
      const timestamp = FieldValue.serverTimestamp();
      if (linkSnapshot?.exists) {
        transaction.delete(linkRef);
        transaction.update(workRef, {
          cotizacionesVinculadas: Math.max(
            0,
            Number((workSnapshot.data() || {}).cotizacionesVinculadas || 0) - 1
          ),
          actualizadoEn: timestamp,
        });
        linkRemoved = true;
      }
      const eventRef = workRef.collection("historial").doc(`cotizacion_eliminada__${quoteId}`);
      transaction.set(eventRef, {
        eventoId: eventRef.id,
        negocioId: businessId,
        trabajoId,
        tipo: "cotizacion_eliminada",
        fecha: timestamp,
        actorUid: uid,
        actorSnapshot: {
          nombre: safeText(membership?.nombre || membership?.correo, 200) || "Persona del equipo",
          correo: safeText(membership?.correo, 240),
        },
        detalle: {
          documentoId: quoteId,
          numero: safeText(quote.numero, 120),
          estado: "borrador",
          total: Number(quote.total || 0),
        },
      });
    }

    return {
      success: true,
      quoteId,
      numero: safeText(quote.numero, 120),
      documentosEliminados: deletions.length,
      vinculoProyectoRetirado: linkRemoved,
    };
  });
}

module.exports = {
  DELETE_CONFIRMATION_WORD,
  deleteQuoteDraftHandler,
  findDeletionBlocker,
  isDeleteConfirmed,
};
