"use strict";

const {createHash} = require("node:crypto");
const {importVeterinaryModel} = require("./veterinaryModels");
const {requireVeterinaryProfessionalAccess} = require("./veterinaryProfessionalAccess");

function veterinaryBoxId(key) {
  // Debe coincidir con las reservas de box creadas antes del catálogo.
  return createHash("sha256").update(JSON.stringify(key)).digest("hex");
}

async function guardarBoxVeterinarioHandler(request, dependencies) {
  const {db, HttpsError, FieldValue} = dependencies;
  const {assignedOnly, businessId, businessRef, uid} = await requireVeterinaryProfessionalAccess(request, dependencies);
  if (assignedOnly) throw new HttpsError("permission-denied", "Tu perfil no puede administrar los boxes de atención.");

  const {normalizeVeterinaryBoxName, veterinaryBoxKey, VETERINARY_BOX_NAME_LIMIT} = await importVeterinaryModel("boxModel");
  const nombre = normalizeVeterinaryBoxName(request.data?.nombre);
  if (!nombre || nombre.length > VETERINARY_BOX_NAME_LIMIT) {
    throw new HttpsError("invalid-argument", "Ingresa un nombre de hasta " + VETERINARY_BOX_NAME_LIMIT + " caracteres.");
  }
  const boxId = veterinaryBoxId(veterinaryBoxKey(nombre));
  const boxRef = businessRef.collection("boxesVeterinarios").doc(boxId);

  await db.runTransaction(async (tx) => {
    if ((await tx.get(boxRef)).exists) {
      throw new HttpsError("already-exists", "Ya existe un box con ese nombre.");
    }
    const stamp = FieldValue.serverTimestamp();
    tx.create(boxRef, {
      negocioId: businessId, nombre, creadoEn: stamp, actualizadoEn: stamp, creadoPorUid: uid, actualizadoPorUid: uid,
    });
  });
  return {boxId};
}

module.exports = {guardarBoxVeterinarioHandler, veterinaryBoxId};
