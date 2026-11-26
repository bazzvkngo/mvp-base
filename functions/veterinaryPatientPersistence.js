"use strict";

const {createHash} = require("node:crypto");
const hash = (value) => createHash("sha256").update(value).digest("hex");

const {isVeterinaryJpeg} = require("./veterinaryJpeg");
const {importVeterinaryModel} = require("./veterinaryModels");

const MAX_PROFILE_PHOTO_BYTES = 192 * 1024;

function documentId(value, HttpsError) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) {
    throw new HttpsError("invalid-argument", "Identificador de paciente o tutor inválido.");
  }
  return value;
}

function validateProfilePhoto(value, HttpsError) {
  if (value === undefined || value === null) return value;
  const errorMessage = "La foto de perfil debe ser un JPEG válido de hasta 192 KiB.";
  if (typeof value !== "string" || value.length > Math.ceil(MAX_PROFILE_PHOTO_BYTES / 3) * 4) {
    throw new HttpsError("invalid-argument", errorMessage);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > MAX_PROFILE_PHOTO_BYTES || bytes.toString("base64") !== value || !isVeterinaryJpeg(bytes)) {
    throw new HttpsError("invalid-argument", errorMessage);
  }
  return value;
}

async function guardarPacienteVeterinarioHandler(request, {db, HttpsError, FieldValue, requireBusinessAccess}) {
  const {buildVeterinaryPatientMutationPayload, normalizeVeterinaryMicrochip} = await importVeterinaryModel("patientModel");
  const {uid, businessId, businessRef} = await requireBusinessAccess(
      request, {db, HttpsError}, {roles: ["OWNER", "ADMIN"], requiredVerticalModule: "veterinaria"},
  );
  const {operacion, pacienteId, paciente, requestId, version} = request.data;
  if (!["crear", "editar"].includes(operacion) || !paciente || typeof paciente !== "object" || Array.isArray(paciente)) {
    throw new HttpsError("invalid-argument", "Selecciona una operación y completa los datos del paciente.");
  }

  const requestKey = documentId(requestId, HttpsError);
  if (operacion === "editar" && (!Number.isSafeInteger(version) || version < 0)) {
    throw new HttpsError("invalid-argument", "La versión del paciente es inválida.");
  }

  let payload;
  try {
    payload = buildVeterinaryPatientMutationPayload(paciente);
  } catch (error) {
    if (error.code !== "veterinary-patient/invalid-data") throw error;
    throw new HttpsError("invalid-argument", error.message, error.fieldErrors);
  }
  const id = documentId(pacienteId, HttpsError);
  const fotoPerfil = validateProfilePhoto(request.data.fotoPerfil, HttpsError);
  // JSON.stringify omite undefined, así que las solicitudes previas conservan su huella.
  const fingerprint = hash(JSON.stringify({operacion, id, version: operacion === "editar" ? version : null, payload, fotoPerfil}));
  const receipt = businessRef.collection("solicitudesPacientesVeterinarios").doc(hash(JSON.stringify([uid, requestKey])));
  const chips = businessRef.collection("microchipsVeterinarios");
  const tutorId = documentId(payload.tutorClienteId, HttpsError);
  const patientRef = businessRef.collection("pacientesVeterinarios").doc(id);
  const tutorRef = businessRef.collection("clientes").doc(tutorId);

  const nextChip = payload.microchip;
  const nextRef = nextChip ? chips.doc(nextChip) : null;
  return db.runTransaction(async (transaction) => {
    const [previous, existing, tutor, reservation] = await transaction.getAll(
        receipt, patientRef, tutorRef, ...(nextRef ? [nextRef] : []),
    );
    if (previous.exists) {
      if (previous.get("fingerprint") !== fingerprint) {
        throw new HttpsError("already-exists", "El requestId ya se usó con otros datos.");
      }
      return previous.get("resultado");
    }
    const currentVersion = existing.get("version") ?? 0;
    if (operacion === "crear" && existing.exists) {
      throw new HttpsError("already-exists", "Ya existe un paciente con este identificador.");
    }
    if (operacion === "editar" && (!existing.exists || existing.get("negocioId") !== businessId)) {
      throw new HttpsError("not-found", "El paciente ya no está disponible.");
    }

    if (operacion === "editar" && currentVersion !== version) {
      throw new HttpsError("aborted", "Otro usuario modificó el paciente. Revisa la ficha actualizada antes de guardar.");
    }

    if (!tutor.exists || tutor.get("negocioId") !== businessId || tutor.get("estado") === "archivado") {
      throw new HttpsError("failed-precondition", "Selecciona un tutor activo de esta empresa.");
    }
    const oldChip = normalizeVeterinaryMicrochip(existing.get("microchip"));
    const previousRef = oldChip && oldChip !== nextChip && /^[A-Z0-9]+$/.test(oldChip) ? chips.doc(oldChip) : null;
    const previousReservation = previousRef ? await transaction.get(previousRef) : null;
    if (reservation?.exists && reservation.get("pacienteId") !== id) {
      throw new HttpsError("already-exists", "El microchip ya pertenece a otro paciente de esta empresa.");
    }
    if (nextRef && !reservation.exists) {
      transaction.create(nextRef, {pacienteId: id});
    }
    if (previousReservation?.get("pacienteId") === id) transaction.delete(previousRef);
    const timestamp = FieldValue.serverTimestamp();
    const update = {...payload, version: currentVersion + 1, actualizadoEn: timestamp, actualizadoPorUid: uid};
    if (operacion === "crear") {
      transaction.create(patientRef, {
        ...update, negocioId: businessId, estado: "activo", creadoEn: timestamp, creadoPorUid: uid,
      });
    } else {
      transaction.update(patientRef, update);
    }
    const photoRef = patientRef.collection("perfil").doc("foto");
    if (typeof fotoPerfil === "string") {
      transaction.set(photoRef, {imagen: fotoPerfil, actualizadoEn: timestamp});
    } else if (operacion === "editar" && fotoPerfil === null) {
      transaction.delete(photoRef);
    }
    const resultado = {pacienteId: id};
    transaction.create(receipt, {fingerprint, resultado, creadoEn: timestamp});
    return resultado;
  });
}

module.exports = {guardarPacienteVeterinarioHandler};
