// Eliminación permanente de un proveedor que nunca tuvo movimientos.
//
// Es la única vía de borrado de proveedores: firestore.rules mantiene
// create/update/delete en false y esta Function usa Admin SDK. Solo OWNER y
// ADMIN activos del negocio pueden usarla y la palabra de confirmación se exige
// también en el backend (SPEC 004, enmienda 2026-11-05).
//
// Una sola transacción: lee el proveedor, su reserva fiscal y todas las
// colecciones que pueden referenciarlo; si no hay dependencias borra el
// proveedor, libera la reserva fiscal y retira sus solicitudes de creación.
// El documento del proveedor es el punto de serialización frente a quien crea
// una orden de compra o una compra: todas esas Functions lo leen dentro de su
// propia transacción, así que no puede quedar un documento apuntando a un
// proveedor inexistente.
const {BUSINESS_MANAGEMENT_ROLES} = require("./rbac");
const {
  adaptStoredFiscalIdentifier,
  getFiscalReservationKey,
} = require("./fiscalIdentifier");
const {
  assertReservationOwner,
  assertStoredProvider,
  validateProviderId,
} = require("./providerPersistence");

const DELETE_CONFIRMATION_WORD = "permanente";
// Tope de documentos contados por consulta; solo afecta al mensaje de rechazo.
const DEPENDENCY_COUNT_LIMIT = 50;
const CREATE_REQUESTS_LIMIT = 100;

// Cada dependencia se busca por el id directo y por el id dentro de la copia
// histórica (proveedorSnapshot), porque los documentos antiguos pueden traer
// solo uno de los dos.
const DEPENDENCIES = Object.freeze([
  {
    collection: "ordenesCompra",
    fields: ["proveedorId", "proveedorSnapshot.proveedorId"],
    singular: "orden de compra",
    plural: "órdenes de compra",
  },
  {
    collection: "compras",
    fields: ["proveedorId", "proveedorSnapshot.proveedorId"],
    singular: "compra",
    plural: "compras",
  },
  {
    collection: "recepciones",
    fields: ["proveedorId", "proveedorSnapshot.proveedorId"],
    singular: "recepción",
    plural: "recepciones",
  },
  {
    collection: "adquisicionesInventario",
    fields: ["proveedorId", "proveedorSnapshot.proveedorId"],
    singular: "adquisición de inventario",
    plural: "adquisiciones de inventario",
  },
  {
    collection: "inventario",
    fields: ["ultimoProveedor.proveedorId"],
    singular: "producto de inventario que lo registra como último proveedor",
    plural: "productos de inventario que lo registran como último proveedor",
  },
]);

function isDeleteConfirmed(value) {
  return String(value ?? "").trim().toLowerCase() === DELETE_CONFIRMATION_WORD;
}

function buildBlockedMessage(found) {
  const parts = found.map(({cantidad, limitado, singular, plural}) => {
    if (limitado) return `${cantidad} o más ${plural}`;
    return `${cantidad} ${cantidad === 1 ? singular : plural}`;
  });
  return "No se puede eliminar el proveedor porque tiene movimientos: " +
    `${parts.join(", ")}. Archívalo para dejar de usarlo.`;
}

async function eliminarProveedorHandler(
  request,
  {db, HttpsError, requireBusinessAccess}
) {
  const context = await requireBusinessAccess(
    request,
    {db, HttpsError},
    {roles: BUSINESS_MANAGEMENT_ROLES}
  );
  const proveedorId = validateProviderId(request?.data?.proveedorId, HttpsError);
  if (!isDeleteConfirmed(request?.data?.confirmacion)) {
    throw new HttpsError(
      "invalid-argument",
      `Escribe «${DELETE_CONFIRMATION_WORD}» para confirmar la eliminación.`
    );
  }

  const {businessId, businessRef} = context;
  const proveedorRef = businessRef.collection("proveedores").doc(proveedorId);
  const requestsQuery = businessRef.collection("providerCreateRequests")
    .where("proveedorId", "==", proveedorId)
    .limit(CREATE_REQUESTS_LIMIT);
  const dependencyQueries = DEPENDENCIES.map((dependency) => ({
    dependency,
    queries: dependency.fields.map((field) =>
      businessRef.collection(dependency.collection)
        .where(field, "==", proveedorId)
        .select()
        .limit(DEPENDENCY_COUNT_LIMIT)
    ),
  }));

  return db.runTransaction(async (transaction) => {
    const [providerSnapshot, requestsSnapshot, ...dependencySnapshots] =
      await Promise.all([
        transaction.get(proveedorRef),
        transaction.get(requestsQuery),
        ...dependencyQueries.map(({queries}) =>
          Promise.all(queries.map((query) => transaction.get(query)))
        ),
      ]);
    const stored = assertStoredProvider(providerSnapshot, businessId, HttpsError);

    const found = [];
    dependencyQueries.forEach(({dependency}, index) => {
      const snapshots = dependencySnapshots[index];
      const ids = new Set(snapshots.flatMap((snapshot) => snapshot.docs.map((doc) => doc.id)));
      if (ids.size === 0) return;
      found.push({
        coleccion: dependency.collection,
        cantidad: ids.size,
        limitado: snapshots.some((snapshot) => snapshot.size >= DEPENDENCY_COUNT_LIMIT),
        singular: dependency.singular,
        plural: dependency.plural,
      });
    });
    if (found.length > 0) {
      throw new HttpsError(
        "failed-precondition",
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

    const fiscal = adaptStoredFiscalIdentifier(
      stored,
      context.businessSnapshot.data()?.paisCodigo
    );
    const reservationKey = getFiscalReservationKey(
      fiscal.paisCodigo,
      fiscal.identificadorFiscalNormalizado
    );
    if (!reservationKey) {
      throw new HttpsError(
        "failed-precondition",
        "La identificación fiscal almacenada del proveedor es inválida."
      );
    }
    const reservationRef = businessRef
      .collection("providerRutKeys")
      .doc(reservationKey);
    const reservationSnapshot = await transaction.get(reservationRef);
    assertReservationOwner(
      reservationSnapshot,
      {proveedorId, businessId, fiscal},
      HttpsError
    );

    transaction.delete(proveedorRef);
    transaction.delete(reservationRef);
    requestsSnapshot.docs.forEach((doc) => transaction.delete(doc.ref));

    return {
      success: true,
      proveedorId,
      reservaLiberada: true,
      solicitudesEliminadas: requestsSnapshot.size,
    };
  });
}

module.exports = {
  DELETE_CONFIRMATION_WORD,
  DEPENDENCIES,
  eliminarProveedorHandler,
  isDeleteConfirmed,
};
