"use strict";

const {
  assertCurrentVeterinaryGrant,
  getVeterinaryProfessionalGrantRefs,
  requireVeterinaryProfessionalAccess,
} = require("./veterinaryProfessionalAccess");
const {assertBusinessModuleEnabled} = require("./moduleAccess");

const assignedStatuses = {
  citasVeterinarias: ["agendada", "confirmada", "en_espera", "en_atencion", "finalizada", "completada"],
  atencionesVeterinarias: ["en_espera", "en_atencion", "finalizada"],
};
const patientFields = [
  "nombre", "especie", "raza", "sexo", "fechaNacimiento", "edadEstimada",
  "peso", "color", "microchip", "estado", "alergias", "antecedentes", "observaciones",
];
const clinicalFields = [
  "pacienteId", "estado", "motivoConsulta", "diagnostico", "tratamiento", "indicaciones",
  "resultadoClinico", "profesionalNombre",
];
const validId = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const rows = (value) => Array.isArray(value) ? value.filter((row) => row && typeof row === "object") : [];
const pickFields = (data, fields) => Object.fromEntries(fields
    .filter((key) => data[key] !== undefined)
    .map((key) => [key, data[key]]));

async function assignedPatientIds(businessRef, businessId, uid, pacienteId, transaction) {
  const snapshots = await Promise.all(Object.entries(assignedStatuses).map(async ([name, statuses]) => {
    let assignment = businessRef.collection(name)
        .where("negocioId", "==", businessId)
        .where("profesionalUid", "==", uid);
    if (pacienteId) assignment = assignment.where("pacienteId", "==", pacienteId);
    assignment = assignment.select("pacienteId", "estado");
    const snapshot = transaction ? await transaction.get(assignment) : await assignment.get();
    return snapshot.docs.filter((document) => statuses.includes(document.get("estado")));
  }));
  return new Set(snapshots.flat().map((document) => document.get("pacienteId")).filter(validId));
}

async function canReadVeterinaryPatient(businessRef, businessId, pacienteId, uid) {
  if (!validId(pacienteId)) return false;
  const [patientIds, patient] = await Promise.all([
    assignedPatientIds(businessRef, businessId, uid, pacienteId),
    businessRef.collection("pacientesVeterinarios").doc(pacienteId).get(),
  ]);
  return patient.get("negocioId") === businessId && patientIds.has(pacienteId);
}

function serializeDate(value) {
  const date = value?.toDate?.() ?? value;
  if (!date) return null;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function clinicalHistoryEntry(document, professionalUid) {
  const data = document.data();
  const items = (entries) => rows(entries).map((item) => pickFields(item, ["itemId", "nombre", "cantidad", "unidad"]));
  const controlFields = data.profesionalUid === professionalUid ? ["citaId", "fecha", "hora"] : ["fecha", "hora"];
  return {
    id: document.id,
    ...pickFields(data, clinicalFields),
    ...(data.control && {control: pickFields(data.control, controlFields)}),
    ...(data.derivacion && {derivacion: pickFields(data.derivacion, ["tipo", "profesionalNombre"])}),
    iniciadaEn: serializeDate(data.iniciadaEn),
    finalizadaEn: serializeDate(data.finalizadaEn),
    servicios: items(data.servicios),
    productos: items(data.productos),
    recetas: rows(data.recetas).map((prescription) => ({
      ...pickFields(prescription, ["recetaId", "profesionalNombre", "indicaciones"]),
      emitidaEn: serializeDate(prescription.emitidaEn),
      medicamentos: rows(prescription.medicamentos).map((medication) =>
        pickFields(medication, ["nombre", "dosis", "frecuencia", "duracion", "instrucciones"]),
      ),
    })),
    fotosClinicas: rows(data.fotosClinicas).map((photo) =>
      pickFields(photo, ["fotoId", "vista", "giro", "marcas", "revision"]),
    ),
  };
}

async function consultarPacientesVeterinariosAsignadosHandler(request, {db, HttpsError, requireBusinessAccess}) {
  const context = await requireVeterinaryProfessionalAccess(
      request, {db, HttpsError, requireBusinessAccess},
  );
  const {businessId, businessRef, uid, assignedOnly} = context;
  if (!assignedOnly) throw new HttpsError("permission-denied", "Esta consulta requiere un perfil veterinario.");
  const {pacienteId, soloFoto = false} = request.data;
  if (typeof soloFoto !== "boolean" || ((soloFoto || pacienteId !== undefined) && !validId(pacienteId))) {
    throw new HttpsError("invalid-argument", "Selecciona un paciente válido.");
  }
  const patientsRef = businessRef.collection("pacientesVeterinarios");

  return db.runTransaction(async (transaction) => {
    const [business, membership, profile] = await transaction.getAll(
        businessRef, ...getVeterinaryProfessionalGrantRefs(context),
    );
    assertBusinessModuleEnabled(business, "veterinaria", HttpsError);
    assertCurrentVeterinaryGrant({...context, HttpsError}, membership.data(), profile.data());
    const assigned = await assignedPatientIds(businessRef, businessId, uid, pacienteId, transaction);
    if (pacienteId === undefined) {
      if (!assigned.size) return {patients: []};
      const snapshots = await transaction.getAll(
          ...[...assigned].map((id) => patientsRef.doc(id)),
          {fieldMask: ["nombre", "negocioId"]},
      );
      return {
        patients: snapshots.filter((patient) => patient.get("negocioId") === businessId).map((patient) => ({
          id: patient.id, nombre: patient.get("nombre") ?? "",
        })),
      };
    }
    if (!assigned.has(pacienteId)) {
      throw new HttpsError("permission-denied", "Este paciente no está asociado a tus citas u órdenes.");
    }
    const patientRef = patientsRef.doc(pacienteId);
    const [patient, photo] = await transaction.getAll(patientRef, patientRef.collection("perfil").doc("foto"));
    if (patient.get("negocioId") !== businessId) {
      throw new HttpsError("permission-denied", "Este paciente no está asociado a tus citas u órdenes.");
    }
    const fotoPerfil = photo.exists ? {imagen: photo.get("imagen")} : null;
    if (soloFoto) return {fotoPerfil};
    const history = await transaction.get(businessRef.collection("atencionesVeterinarias")
        .where("negocioId", "==", businessId).where("pacienteId", "==", pacienteId).where("estado", "==", "finalizada"));
    return {
      patient: {
        id: patient.id,
        ...pickFields(patient.data(), patientFields),
        ...(fotoPerfil ? {fotoPerfil} : {}),
      },
      attentions: history.docs.map((document) => clinicalHistoryEntry(document, uid)).sort((left, right) =>
        (right.finalizadaEn || right.iniciadaEn || "").localeCompare(left.finalizadaEn || left.iniciadaEn || ""),
      ),
    };
  }, {readOnly: true});
}

module.exports = {canReadVeterinaryPatient, consultarPacientesVeterinariosAsignadosHandler};
