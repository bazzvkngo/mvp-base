// Eliminación permanente de una orden de compra que nunca se envió.
//
// Es la única vía de borrado de órdenes de compra: firestore.rules mantiene
// create/update/delete en false y esta Function usa Admin SDK. Solo OWNER y
// ADMIN activos del negocio pueden usarla y la palabra de confirmación se exige
// también en el backend (SPEC 005, enmienda 2026-11-06).
//
// Alcance: un borrador, o una orden cancelada que nunca se emitió. Una orden
// emitida alguna vez no se elimina, aunque después se haya cancelado: una orden
// cancelada no guarda su estado anterior, así que "nunca se emitió" se prueba
// por la ausencia de todo rastro de emisión (ver findEmissionTrace).
//
// Una sola transacción: lee la orden, su intento de correo y todas las
// colecciones que pueden referenciarla; si nada bloquea, borra la orden, sus
// solicitudes idempotentes y su intento de correo. La orden es el punto de
// serialización frente a quien la emite, la cancela o crea una recepción: todas
// esas Functions la leen dentro de su propia transacción, así que no puede
// quedar una recepción apuntando a una orden inexistente. El envío por correo
// ocurre fuera de la transacción, por eso un intento en "enviando" bloquea.
//
// Numeración: el contador purchaseOrderCounters/{año} NO se toca. El número
// eliminado no se reutiliza y queda un hueco en la secuencia (aceptado, igual
// que en cotizaciones).
const {BUSINESS_MANAGEMENT_ROLES} = require("./rbac");

const DELETE_CONFIRMATION_WORD = "permanente";
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,160}$/;
// Tope de documentos contados por consulta; solo afecta al mensaje de rechazo.
const DEPENDENCY_COUNT_LIMIT = 50;
// Una transacción admite 500 escrituras; se deja margen.
const MAX_DELETED_DOCUMENTS = 450;

// Colecciones que referencian la orden por ordenCompraId. Cualquiera, en
// cualquier estado, bloquea. Las tres primeras son datos de negocio; el resto
// es red de seguridad (solo existen si hubo una recepción o una compra).
const DEPENDENCIES = Object.freeze([
  {
    collection: "recepciones",
    field: "ordenCompraId",
    singular: "recepción",
    plural: "recepciones",
  },
  {
    collection: "compras",
    field: "ordenCompraId",
    singular: "compra",
    plural: "compras",
  },
  {
    collection: "adquisicionesInventario",
    field: "ordenCompraId",
    singular: "adquisición de inventario",
    plural: "adquisiciones de inventario",
  },
  {
    collection: "movimientosInventario",
    field: "ordenCompraId",
    singular: "movimiento de inventario",
    plural: "movimientos de inventario",
  },
  {
    collection: "receptionCreateRequests",
    field: "ordenCompraId",
    singular: "solicitud de recepción",
    plural: "solicitudes de recepción",
  },
  {
    collection: "purchaseOrderConversionRequests",
    field: "ordenCompraId",
    singular: "solicitud de conversión a compra",
    plural: "solicitudes de conversión a compra",
  },
  {
    // Otras órdenes creadas a partir de esta (duplicadas desde ella).
    collection: "purchaseOrderDuplicateRequests",
    field: "ordenCompraOrigenId",
    singular: "orden creada a partir de esta",
    plural: "órdenes creadas a partir de esta",
  },
]);

function safeText(value, maxLength = 2000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== "" && value !== false;
}

function isDeleteConfirmed(value) {
  return safeText(value, 100).toLowerCase() === DELETE_CONFIRMATION_WORD;
}

function reject(HttpsError, message, details) {
  throw new HttpsError("failed-precondition", message, details);
}

// Rastro de que la orden se emitió o se envió alguna vez. Son campos que
// transitionOrder (emitir/reenviar), la confirmación del proveedor y el envío
// por correo escriben y que nunca se borran. Un envío fallido o simulado
// (estadoEnvioCorreo "error" o "simulado") no entregó nada y no cuenta.
function findEmissionTrace(order) {
  if (order.estado === "emitida") return true;
  if (
    hasValue(order.emitidaEn) ||
    hasValue(order.emitidaPorUid) ||
    hasValue(order.canalEmision) ||
    hasValue(order.destinatarioEmision)
  ) {
    return true;
  }
  if (
    Number(order.cantidadEnvios || 0) > 0 ||
    hasValue(order.ultimoEnvioEn) ||
    hasValue(order.reenviadaEn)
  ) {
    return true;
  }
  const response = order.respuestaProveedor || {};
  if (
    hasValue(response.fecha) ||
    (hasValue(response.estado) && response.estado !== "pendiente")
  ) {
    return true;
  }
  return order.enviadoPorCorreo === true ||
    order.estadoEnvioCorreo === "enviado";
}

// Vínculos que la propia orden guarda con recepciones o compras.
function hasOrderLinks(order) {
  return hasValue(order.compraId) ||
    (Array.isArray(order.comprasDesdeRecepciones) &&
      order.comprasDesdeRecepciones.length > 0) ||
    hasValue(order.estadoRecepcion) ||
    hasValue(order.recepcionResumen);
}

function buildBlockedMessage(found) {
  const parts = found.map(({cantidad, limitado, singular, plural}) => {
    if (limitado) return `${cantidad} o más ${plural}`;
    return `${cantidad} ${cantidad === 1 ? singular : plural}`;
  });
  return "No se puede eliminar la orden de compra porque tiene registros " +
    `asociados: ${parts.join(", ")}. Si ya no la necesitas, cancélala.`;
}

async function eliminarOrdenCompraHandler(
  request,
  {db, HttpsError, requireBusinessAccess}
) {
  const context = await requireBusinessAccess(
    request,
    {db, HttpsError},
    {roles: BUSINESS_MANAGEMENT_ROLES, requiresVerifiedBusiness: true}
  );
  const orderId = safeText(request?.data?.ordenCompraId, 160);
  if (!ID_PATTERN.test(orderId)) {
    throw new HttpsError("invalid-argument", "Selecciona una orden de compra válida.");
  }
  if (!isDeleteConfirmed(request?.data?.confirmacion)) {
    throw new HttpsError(
      "invalid-argument",
      `Escribe «${DELETE_CONFIRMATION_WORD}» para confirmar la eliminación.`
    );
  }

  const {businessId, businessRef} = context;
  const orderRef = businessRef.collection("ordenesCompra").doc(orderId);
  const attemptRef = businessRef.collection("purchaseOrderEmailAttempts").doc(orderId);
  const createRequestsQuery = businessRef.collection("purchaseOrderCreateRequests")
    .where("ordenCompraId", "==", orderId)
    .limit(MAX_DELETED_DOCUMENTS + 1);
  const copyRequestsQuery = businessRef.collection("purchaseOrderDuplicateRequests")
    .where("ordenCompraId", "==", orderId)
    .limit(MAX_DELETED_DOCUMENTS + 1);
  const dependencyQueries = DEPENDENCIES.map((dependency) => ({
    dependency,
    query: businessRef.collection(dependency.collection)
      .where(dependency.field, "==", orderId)
      .select()
      .limit(DEPENDENCY_COUNT_LIMIT),
  }));

  return db.runTransaction(async (transaction) => {
    const [
      orderSnapshot,
      attemptSnapshot,
      createRequestsSnapshot,
      copyRequestsSnapshot,
      ...dependencySnapshots
    ] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(attemptRef),
      transaction.get(createRequestsQuery),
      transaction.get(copyRequestsQuery),
      ...dependencyQueries.map(({query}) => transaction.get(query)),
    ]);
    if (!orderSnapshot.exists) {
      throw new HttpsError("not-found", "No se encontró la orden de compra.");
    }
    const order = orderSnapshot.data() || {};
    if (order.negocioId && order.negocioId !== businessId) {
      throw new HttpsError("permission-denied", "No puedes eliminar esta orden de compra.");
    }

    // 1. Estado y rastro de emisión: solo órdenes nunca enviadas.
    if (order.estado === "emitida") {
      reject(
        HttpsError,
        "La orden ya fue emitida y no puede eliminarse. Si ya no la necesitas, cancélala."
      );
    }
    if (!["borrador", "cancelada"].includes(order.estado)) {
      reject(
        HttpsError,
        "Solo se pueden eliminar órdenes pendientes de envío o canceladas que nunca se enviaron."
      );
    }

    // 2. Envío por correo en curso o ya realizado (ocurre fuera de la transacción).
    const attempt = attemptSnapshot.exists ? attemptSnapshot.data() || {} : {};
    const mailState = attempt.estado || order.estadoEnvioCorreo || "";
    if (mailState === "enviando" || order.estadoEnvioCorreo === "enviando") {
      reject(
        HttpsError,
        "Hay un envío por correo en curso para esta orden. Espera unos segundos e inténtalo de nuevo."
      );
    }
    if (mailState === "enviado" || findEmissionTrace(order)) {
      reject(
        HttpsError,
        "La orden ya se envió al proveedor y no puede eliminarse. Si ya no la necesitas, cancélala."
      );
    }

    // 3. Recepciones, compras y demás registros que la referencian.
    const found = [];
    dependencyQueries.forEach(({dependency}, index) => {
      const snapshot = dependencySnapshots[index];
      if (snapshot.size === 0) return;
      found.push({
        coleccion: dependency.collection,
        cantidad: snapshot.size,
        limitado: snapshot.size >= DEPENDENCY_COUNT_LIMIT,
        singular: dependency.singular,
        plural: dependency.plural,
      });
    });
    if (hasOrderLinks(order)) {
      found.push({
        coleccion: "ordenesCompra",
        cantidad: 1,
        limitado: false,
        singular: "vínculo con recepciones o compras guardado en la orden",
        plural: "vínculos con recepciones o compras guardados en la orden",
      });
    }
    if (found.length > 0) {
      reject(
        HttpsError,
        buildBlockedMessage(found),
        {
          dependencias: found.map(({coleccion, cantidad, limitado}) => ({
            coleccion,
            cantidad,
            limitado,
          })),
        }
      );
    }

    // 4. Se borra la orden, sus solicitudes idempotentes y su intento de correo.
    const ownedRequests = [
      ...createRequestsSnapshot.docs,
      ...copyRequestsSnapshot.docs,
    ];
    const deletions = [
      orderRef,
      ...ownedRequests.map((doc) => doc.ref),
      ...(attemptSnapshot.exists ? [attemptRef] : []),
    ];
    if (deletions.length > MAX_DELETED_DOCUMENTS) {
      reject(HttpsError, "La orden tiene demasiados registros para eliminarla de una vez.");
    }
    deletions.forEach((ref) => transaction.delete(ref));

    return {
      success: true,
      ordenCompraId: orderId,
      numero: safeText(order.numero, 120),
      solicitudesEliminadas: ownedRequests.length,
      intentoCorreoEliminado: attemptSnapshot.exists,
    };
  });
}

module.exports = {
  DELETE_CONFIRMATION_WORD,
  DEPENDENCIES,
  eliminarOrdenCompraHandler,
  findEmissionTrace,
  hasOrderLinks,
  isDeleteConfirmed,
};
