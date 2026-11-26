"use strict";

const {requireVeterinaryProfessionalAccess} = require("./veterinaryProfessionalAccess");

async function listarCatalogoVeterinarioParaAtencionHandler(request, dependencies) {
  const {HttpsError} = dependencies;
  const {assignedOnly, businessId, businessRef, uid} = await requireVeterinaryProfessionalAccess(request, dependencies);
  const atencionId = request.data?.atencionId;
  if (typeof atencionId !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(atencionId)) {
    throw new HttpsError("invalid-argument", "Selecciona una orden de atención válida.");
  }
  const attention = (await businessRef.collection("atencionesVeterinarias").doc(atencionId).get()).data();
  if (attention?.negocioId !== businessId || (assignedOnly && attention.profesionalUid !== uid)) {
    throw new HttpsError("not-found", "La atención no está disponible.");
  }
  if (attention.estado !== "en_atencion") {
    throw new HttpsError("failed-precondition", "Abre la atención para consultar el catálogo clínico.");
  }
  const inventory = await businessRef.collection("inventario").where("negocioId", "==", businessId)
      .select("nombre", "tipoItem", "unidadStock", "unidad", "estado").get();
  const items = inventory.docs.flatMap((item) => {
    const {nombre, tipoItem, unidadStock, unidad, estado = "activo"} = item.data();
    if (estado !== "activo" || !["producto", "servicio"].includes(tipoItem) || typeof nombre !== "string") return [];
    return [{id: item.id, nombre, tipoItem, unidad: unidadStock || unidad || "unidad", estado}];
  });
  return {items};
}

module.exports = {listarCatalogoVeterinarioParaAtencionHandler};
