"use strict";

const {importVeterinaryModel} = require("./veterinaryModels");

async function guardarAtencionVeterinariaHandler(request, {db, HttpsError, FieldValue, requireBusinessAccess}) {
  const {
    buildVeterinaryAttentionDraftPayload,
    buildVeterinaryAttentionMutationPayload,
  } = await importVeterinaryModel("attentionModel");
  const {buildVeterinaryClinicalClosureMutationPayload} = await importVeterinaryModel("clinicalClosureModel");
  const {uid, businessId, businessRef} = await requireBusinessAccess(
      request, {db, HttpsError}, {roles: ["OWNER", "ADMIN"], requiredVerticalModule: "veterinaria"},
  );
  const {citaId, operacion, atencion} = request.data;
  if (!["iniciar", "borrador", "cerrar"].includes(operacion) || typeof citaId !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(citaId)) {
    throw new HttpsError("invalid-argument", "Selecciona una cita y una operación válidas.");
  }
  const appointmentRef = businessRef.collection("citasVeterinarias").doc(citaId);
  const attentionRef = businessRef.collection("atencionesVeterinarias").doc(citaId);

  return db.runTransaction(async (tx) => {
    const [appointmentSnapshot, attentionSnapshot] = await tx.getAll(appointmentRef, attentionRef);
    const appointment = appointmentSnapshot.data();
    const existing = attentionSnapshot.data();
    if (!appointment || appointment.negocioId !== businessId) {
      throw new HttpsError("not-found", "La cita ya no está disponible.");
    }
    const {pacienteId} = appointment;
    if (existing && (existing.negocioId !== businessId || existing.pacienteId !== pacienteId || existing.citaId !== citaId)) {
      throw new HttpsError("failed-precondition", "La atención no coincide con la cita.");
    }
    if (existing && (
      (operacion !== "borrador" && existing.estado === "finalizada" && appointment.estado === "finalizada") ||
      (operacion === "iniciar" && existing.estado === "en_atencion" && appointment.estado === "en_atencion")
    )) return {atencionId: citaId};

    const stamp = FieldValue.serverTimestamp();
    const audit = {actualizadoEn: stamp, actualizadoPorUid: uid};
    if (operacion === "iniciar") {
      if (existing || appointment.estado !== "en_espera" || !appointment.recepcion?.horaLlegada || !appointment.triage?.prioridad) {
        throw new HttpsError("failed-precondition", "Registra la recepción y el triage antes de iniciar la atención.");
      }
      if (typeof pacienteId !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(pacienteId)) {
        throw new HttpsError("failed-precondition", "La cita no tiene un paciente válido.");
      }
      const patient = (await tx.get(businessRef.collection("pacientesVeterinarios").doc(pacienteId))).data();
      if (!patient || patient.negocioId !== businessId) {
        throw new HttpsError("failed-precondition", "El paciente no está disponible en esta empresa.");
      }
      tx.create(attentionRef, {
        ...audit, negocioId: businessId, citaId, pacienteId, estado: "en_atencion",
        iniciadaEn: stamp, iniciadoPorUid: uid, motivoConsulta: appointment.motivo ?? "",
        recepcion: appointment.recepcion, triage: appointment.triage,
      });
      tx.update(appointmentRef, {...audit, estado: "en_atencion"});
      return {atencionId: citaId};
    }
    if (operacion === "borrador") {
      if (existing?.estado !== "en_atencion" || appointment.estado !== "en_atencion") {
        throw new HttpsError("failed-precondition", "Solo puedes guardar el borrador de una atención abierta.");
      }
      let draft;
      try {
        draft = buildVeterinaryAttentionDraftPayload(atencion);
      } catch (error) {
        if (!error.fieldErrors) throw error;
        throw new HttpsError("invalid-argument", Object.values(error.fieldErrors).flat()[0], error.fieldErrors);
      }
      // Sin lista de ítems en la solicitud se conserva la del borrador anterior.
      tx.update(attentionRef, {borrador: {...draft, items: draft.items ?? existing.borrador?.items ?? []}, ...audit});
      return {atencionId: citaId};
    }
    if (existing?.estado !== "en_atencion" || appointment.estado !== "en_atencion") {
      throw new HttpsError("failed-precondition", "Inicia la atención antes de cerrarla.");
    }

    const references = await loadReferences(tx, businessRef, businessId, atencion?.items ?? [], HttpsError);
    let clinical;
    let closure;
    try {
      clinical = buildVeterinaryAttentionMutationPayload({
        ...atencion, citaId, pacienteId,
        servicios: references.filter((item) => item.tipoItem === "servicio"),
        productos: references.filter((item) => item.tipoItem === "producto"),
      });
      closure = buildVeterinaryClinicalClosureMutationPayload({
        citaId, pacienteId, resultadoClinico: atencion?.resultadoClinico,
      });
    } catch (error) {
      if (!error.fieldErrors) throw error;
      throw new HttpsError("invalid-argument", Object.values(error.fieldErrors).flat()[0], error.fieldErrors);
    }
    tx.update(attentionRef, {
      ...clinical, ...audit, resultadoClinico: closure.resultadoClinico,
      estado: "finalizada", finalizadaEn: stamp, finalizadoPorUid: uid,
      borrador: FieldValue.delete(),
    });
    tx.update(appointmentRef, {...audit, estado: "finalizada"});
    return {atencionId: citaId};
  });
}

async function loadReferences(tx, business, businessId, items, HttpsError) {
  const {buildVeterinaryInventoryReference} = await importVeterinaryModel("inventoryPharmacyIntegrationModel");
  if (!Array.isArray(items) || items.length > 100) {
    throw new HttpsError("invalid-argument", "Registra hasta 50 servicios y 50 productos.");
  }
  const ids = new Set();
  for (const item of items) {
    if (typeof item?.itemId !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(item.itemId) || ids.has(item.itemId)) {
      throw new HttpsError("invalid-argument", "Selecciona ítems de inventario válidos y sin duplicados.");
    }
    ids.add(item.itemId);
  }
  if (!items.length) return [];
  const snapshots = await tx.getAll(...items.map((item) => business.collection("inventario").doc(item.itemId)));
  return snapshots.map((snapshot, index) => {
    if (!snapshot.exists || snapshot.get("negocioId") !== businessId) {
      throw new HttpsError("failed-precondition", "El ítem no está disponible en el inventario de esta empresa.");
    }
    try {
      return buildVeterinaryInventoryReference({...snapshot.data(), id: snapshot.id}, items[index].cantidad);
    } catch (error) {
      throw new HttpsError("failed-precondition", error.message);
    }
  });
}

module.exports = {guardarAtencionVeterinariaHandler};
