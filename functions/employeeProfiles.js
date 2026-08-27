"use strict";

const crypto = require("node:crypto");
const {BUSINESS_MODULES} = require("./rbac");

const ACTIVE_STATUS = "activo";
const MANAGEMENT_ROLES = Object.freeze(["OWNER", "ADMIN"]);

function safeText(value, maxLength = 180) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function validateProfileId(value, HttpsError) {
  const profileId = safeText(value, 160);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(profileId)) {
    throw new HttpsError("invalid-argument", "Selecciona un perfil válido.");
  }
  return profileId;
}

function normalizedName(value) {
  return safeText(value, 80).toLocaleLowerCase("es");
}

function profileNameKey(value) {
  return crypto.createHash("sha256").update(normalizedName(value)).digest("hex");
}

function validateProfileInput(data, HttpsError) {
  const nombre = safeText(data?.nombre, 80);
  const descripcion = safeText(data?.descripcion, 300);
  const modulos = [...new Set((Array.isArray(data?.modulos) ? data.modulos : [])
    .map((moduleId) => safeText(moduleId, 40))
    .filter((moduleId) => BUSINESS_MODULES.includes(moduleId)))];
  if (nombre.length < 2) {
    throw new HttpsError("invalid-argument", "Ingresa un nombre para el perfil.");
  }
  if (!modulos.length) {
    throw new HttpsError("invalid-argument", "Selecciona al menos un módulo.");
  }
  if (modulos.length !== new Set(data?.modulos || []).size) {
    throw new HttpsError("invalid-argument", "La selección de módulos no es válida.");
  }
  return {nombre, descripcion, modulos};
}

function validateManagementSnapshots(businessSnapshot, actorSnapshot, context, HttpsError) {
  const actor = actorSnapshot.data() || {};
  if (!businessSnapshot.exists || businessSnapshot.data()?.estado !== ACTIVE_STATUS ||
      businessSnapshot.data()?.eliminadoEn) {
    throw new HttpsError("failed-precondition", "La empresa ya no está disponible.");
  }
  if (!actorSnapshot.exists || actor.uid !== context.uid ||
      actor.negocioId !== context.businessId || actor.estado !== ACTIVE_STATUS ||
      !MANAGEMENT_ROLES.includes(actor.rol) || actor.profileId) {
    throw new HttpsError("permission-denied", "No puedes administrar perfiles de esta empresa.");
  }
}

function profileDto(snapshot) {
  const data = snapshot.data() || {};
  return {
    id: snapshot.id,
    negocioId: data.negocioId,
    nombre: data.nombre,
    descripcion: data.descripcion || "",
    modulos: data.modulos || [],
    estado: data.estado,
    creadoPorUid: data.creadoPorUid || "",
  };
}

async function listarPerfilesEmpleadosHandler(request, {db, HttpsError, requireBusinessAccess}) {
  const context = await requireBusinessAccess(
    request,
    {db, HttpsError},
    {roles: ["OWNER", "ADMIN", "MEMBER"], moduleId: "empleados"}
  );
  const snapshot = await db.collection("negocios").doc(context.businessId)
    .collection("perfilesEmpleados").where("estado", "==", ACTIVE_STATUS).get();
  return {
    perfiles: snapshot.docs
      .filter((item) => item.data()?.negocioId === context.businessId)
      .map(profileDto)
      .sort((left, right) => left.nombre.localeCompare(right.nombre, "es")),
  };
}

async function crearPerfilEmpleadoHandler(
  request,
  {db, HttpsError, FieldValue, requireBusinessAccess}
) {
  const context = await requireBusinessAccess(
    request, {db, HttpsError}, {roles: MANAGEMENT_ROLES}
  );
  const input = validateProfileInput(request?.data, HttpsError);
  const profileRef = db.collection("negocios").doc(context.businessId)
    .collection("perfilesEmpleados").doc();
  const nameRef = db.collection("negocios").doc(context.businessId)
    .collection("perfilesEmpleadosNombres").doc(profileNameKey(input.nombre));

  await db.runTransaction(async (transaction) => {
    const [businessSnapshot, actorSnapshot, nameSnapshot] = await Promise.all([
      transaction.get(context.businessRef),
      transaction.get(context.membershipRef),
      transaction.get(nameRef),
    ]);
    validateManagementSnapshots(businessSnapshot, actorSnapshot, context, HttpsError);
    if (nameSnapshot.exists) {
      throw new HttpsError("already-exists", "Ya existe un perfil con ese nombre.");
    }
    const now = FieldValue.serverTimestamp();
    transaction.create(profileRef, {
      negocioId: context.businessId,
      ...input,
      estado: ACTIVE_STATUS,
      creadoPorUid: context.uid,
      actualizadoPorUid: context.uid,
      creadoEn: now,
      actualizadoEn: now,
    });
    transaction.create(nameRef, {negocioId: context.businessId, profileId: profileRef.id});
  });
  return {perfil: {id: profileRef.id, negocioId: context.businessId, ...input, estado: ACTIVE_STATUS}};
}

async function actualizarPerfilEmpleadoHandler(
  request,
  {db, HttpsError, FieldValue, requireBusinessAccess}
) {
  const context = await requireBusinessAccess(
    request, {db, HttpsError}, {roles: MANAGEMENT_ROLES}
  );
  const profileId = validateProfileId(request?.data?.profileId, HttpsError);
  const input = validateProfileInput(request?.data, HttpsError);
  const baseRef = db.collection("negocios").doc(context.businessId);
  const profileRef = baseRef.collection("perfilesEmpleados").doc(profileId);
  await db.runTransaction(async (transaction) => {
    const [businessSnapshot, actorSnapshot, profileSnapshot] = await Promise.all([
      transaction.get(context.businessRef),
      transaction.get(context.membershipRef),
      transaction.get(profileRef),
    ]);
    validateManagementSnapshots(businessSnapshot, actorSnapshot, context, HttpsError);
    const current = profileSnapshot.data() || {};
    if (!profileSnapshot.exists || current.negocioId !== context.businessId ||
        current.estado !== ACTIVE_STATUS) {
      throw new HttpsError("not-found", "No se encontró el perfil indicado.");
    }
    const oldNameRef = baseRef.collection("perfilesEmpleadosNombres")
      .doc(profileNameKey(current.nombre));
    const newNameRef = baseRef.collection("perfilesEmpleadosNombres")
      .doc(profileNameKey(input.nombre));
    if (oldNameRef.id !== newNameRef.id) {
      const newNameSnapshot = await transaction.get(newNameRef);
      if (newNameSnapshot.exists) {
        throw new HttpsError("already-exists", "Ya existe un perfil con ese nombre.");
      }
      transaction.delete(oldNameRef);
      transaction.create(newNameRef, {negocioId: context.businessId, profileId});
    }
    transaction.update(profileRef, {
      ...input,
      actualizadoPorUid: context.uid,
      actualizadoEn: FieldValue.serverTimestamp(),
    });
  });
  return {perfil: {id: profileId, negocioId: context.businessId, ...input, estado: ACTIVE_STATUS}};
}

async function eliminarPerfilEmpleadoHandler(
  request,
  {db, HttpsError, FieldValue, requireBusinessAccess}
) {
  const context = await requireBusinessAccess(
    request, {db, HttpsError}, {roles: MANAGEMENT_ROLES}
  );
  const profileId = validateProfileId(request?.data?.profileId, HttpsError);
  const assignedSnapshot = await db.collection("membresias")
    .where("profileId", "==", profileId).get();
  const assignedCount = assignedSnapshot.docs.filter((snapshot) =>
    snapshot.data()?.negocioId === context.businessId
  ).length;
  if (assignedCount) {
    throw new HttpsError(
      "failed-precondition",
      `No puedes eliminar este perfil: está asignado a ${assignedCount} ${assignedCount === 1 ? "persona" : "personas"}.`
    );
  }
  const baseRef = db.collection("negocios").doc(context.businessId);
  const profileRef = baseRef.collection("perfilesEmpleados").doc(profileId);
  await db.runTransaction(async (transaction) => {
    const [businessSnapshot, actorSnapshot, profileSnapshot] = await Promise.all([
      transaction.get(context.businessRef),
      transaction.get(context.membershipRef),
      transaction.get(profileRef),
    ]);
    validateManagementSnapshots(businessSnapshot, actorSnapshot, context, HttpsError);
    const current = profileSnapshot.data() || {};
    if (!profileSnapshot.exists || current.negocioId !== context.businessId ||
        current.estado !== ACTIVE_STATUS) {
      throw new HttpsError("not-found", "No se encontró el perfil indicado.");
    }
    transaction.update(profileRef, {
      estado: "inactivo",
      eliminadoPorUid: context.uid,
      eliminadoEn: FieldValue.serverTimestamp(),
      actualizadoPorUid: context.uid,
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    transaction.delete(baseRef.collection("perfilesEmpleadosNombres")
      .doc(profileNameKey(current.nombre)));
  });
  return {profileId, eliminado: true};
}

module.exports = {
  actualizarPerfilEmpleadoHandler,
  crearPerfilEmpleadoHandler,
  eliminarPerfilEmpleadoHandler,
  listarPerfilesEmpleadosHandler,
  profileDto,
  validateProfileId,
};
