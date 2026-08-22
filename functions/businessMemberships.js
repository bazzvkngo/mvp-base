const {
  ASSIGNABLE_BUSINESS_ROLES,
  BUSINESS_ROLES,
} = require("./rbac");
const MANAGEABLE_ROLES = ASSIGNABLE_BUSINESS_ROLES;
const MEMBERSHIP_STATUSES = Object.freeze(["activo", "inactivo"]);
const ACTIVE_STATUS = "activo";
const DIRECTORY_BATCH_SIZE = 100;

function safeText(value, maxLength = 180) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function validateEmail(value, HttpsError) {
  const email = safeText(value, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "Ingresa un correo válido.");
  }
  return email;
}

function validateUid(value, HttpsError) {
  const uid = safeText(value, 160);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(uid)) {
    throw new HttpsError("invalid-argument", "Selecciona un miembro válido.");
  }
  return uid;
}

function membershipDocumentId(businessId, uid) {
  return `${businessId}__${uid}`;
}

function isCanonicalMembership(snapshot, businessId) {
  const membership = snapshot.data() || {};
  return snapshot.id === membershipDocumentId(businessId, membership.uid) &&
    membership.negocioId === businessId &&
    BUSINESS_ROLES.includes(membership.rol) &&
    MEMBERSHIP_STATUSES.includes(membership.estado);
}

function validateActorSnapshot(snapshot, context, HttpsError) {
  const actor = snapshot.data() || {};
  if (
    !snapshot.exists ||
    snapshot.id !== membershipDocumentId(context.businessId, context.uid) ||
    actor.uid !== context.uid ||
    actor.negocioId !== context.businessId ||
    actor.estado !== ACTIVE_STATUS ||
    actor.rol !== "OWNER"
  ) {
    throw new HttpsError(
      "permission-denied",
      "Solo el propietario puede administrar miembros."
    );
  }
}

function validateBusinessSnapshot(snapshot, HttpsError) {
  if (
    !snapshot.exists ||
    snapshot.data()?.estado !== ACTIVE_STATUS ||
    snapshot.data()?.eliminadoEn
  ) {
    throw new HttpsError(
      "failed-precondition",
      "El negocio seleccionado ya no está disponible."
    );
  }
}

function timestampToIso(value) {
  if (!value) return null;
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function memberName(profile, authUser) {
  const profileName = [profile?.nombres, profile?.apellidos]
    .map((part) => safeText(part, 160))
    .filter(Boolean)
    .join(" ");
  return profileName || safeText(authUser?.displayName, 240) || "Sin nombre registrado";
}

function chunks(values, size = DIRECTORY_BATCH_SIZE) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function getAuthUsersByUid(auth, uids) {
  const usersByUid = new Map();
  for (const batch of chunks(uids)) {
    const result = await auth.getUsers(batch.map((uid) => ({uid})));
    result.users.forEach((user) => usersByUid.set(user.uid, user));
  }
  return usersByUid;
}

async function getProfilesByUid(db, uids) {
  const profilesByUid = new Map();
  for (const batch of chunks(uids)) {
    const refs = batch.map((uid) =>
      db.collection("usuarios").doc(uid).collection("cuenta").doc("perfil")
    );
    const snapshots = await db.getAll(...refs);
    snapshots.forEach((snapshot, index) => {
      profilesByUid.set(batch[index], snapshot.data() || {});
    });
  }
  return profilesByUid;
}

function directoryMember(snapshot, authUser, profile) {
  const membership = snapshot.data() || {};
  return {
    uid: membership.uid,
    nombre: memberName(profile, authUser),
    correo: safeText(authUser?.email, 320),
    rol: membership.rol,
    estado: membership.estado,
    fechaIncorporacion: timestampToIso(membership.creadoEn),
  };
}

async function listarMiembrosNegocioHandler(
  request,
  {db, auth, HttpsError, requireBusinessAccess}
) {
  let context = await requireBusinessAccess(
    request, {db, HttpsError}, {roles: ["OWNER", "ADMIN", "MEMBER"]}
  );
  const membershipsSnapshot = await db
    .collection("membresias")
    .where("negocioId", "==", context.businessId)
    .get();

  context = await requireBusinessAccess(
    request, {db, HttpsError}, {roles: ["OWNER", "ADMIN", "MEMBER"]}
  );
  const canSeeInactive = context.membership.rol === "OWNER";
  const memberships = membershipsSnapshot.docs.filter((snapshot) =>
    isCanonicalMembership(snapshot, context.businessId) &&
    (canSeeInactive || snapshot.data()?.estado === ACTIVE_STATUS)
  );
  const uids = memberships.map((snapshot) => snapshot.data().uid);
  const [authUsers, profiles] = await Promise.all([
    getAuthUsersByUid(auth, uids),
    getProfilesByUid(db, uids),
  ]);
  const roleOrder = {
    OWNER: 0, ADMIN: 1, VENTAS: 2, COMPRAS: 3, TECNICO: 4, FINANZAS: 5, MEMBER: 6,
  };
  const members = memberships
    .map((snapshot) => {
      const uid = snapshot.data().uid;
      return directoryMember(snapshot, authUsers.get(uid), profiles.get(uid));
    })
    .sort((left, right) =>
      Number(right.estado === ACTIVE_STATUS) - Number(left.estado === ACTIVE_STATUS) ||
      roleOrder[left.rol] - roleOrder[right.rol] ||
      left.nombre.localeCompare(right.nombre, "es")
    );
  return {miembros: members};
}

async function asociarUsuarioExistenteHandler(
  request,
  {db, auth, HttpsError, FieldValue, requireBusinessAccess}
) {
  const context = await requireBusinessAccess(
    request,
    {db, HttpsError},
    {roles: ["OWNER"]}
  );
  const email = validateEmail(request?.data?.correo, HttpsError);
  const role = safeText(request?.data?.rol || "TECNICO", 20).toUpperCase();
  if (!MANAGEABLE_ROLES.includes(role)) {
    throw new HttpsError("invalid-argument", "Selecciona un rol V1 válido.");
  }
  let authUser;
  try {
    authUser = await auth.getUserByEmail(email);
  } catch (error) {
    if (String(error?.code || "").includes("user-not-found")) {
      throw new HttpsError(
        "not-found",
        "No existe una cuenta de ValoraCloud con ese correo."
      );
    }
    throw error;
  }
  if (authUser.disabled) {
    throw new HttpsError(
      "failed-precondition",
      "La cuenta de usuario está deshabilitada."
    );
  }

  const targetUid = validateUid(authUser.uid, HttpsError);
  const targetRef = db
    .collection("membresias")
    .doc(membershipDocumentId(context.businessId, targetUid));

  await db.runTransaction(async (transaction) => {
    const [businessSnapshot, actorSnapshot, targetSnapshot] = await Promise.all([
      transaction.get(context.businessRef),
      transaction.get(context.membershipRef),
      transaction.get(targetRef),
    ]);
    validateBusinessSnapshot(businessSnapshot, HttpsError);
    validateActorSnapshot(actorSnapshot, context, HttpsError);
    if (targetSnapshot.exists) {
      const existing = targetSnapshot.data() || {};
      if (!isCanonicalMembership(targetSnapshot, context.businessId)) {
        throw new HttpsError(
          "failed-precondition",
          "La membresía existente es inconsistente y requiere revisión."
        );
      }
      throw new HttpsError(
        "already-exists",
        existing.estado === ACTIVE_STATUS
          ? "La cuenta ya tiene acceso activo a esta empresa."
          : "La cuenta ya está asociada. Reactívala desde el directorio."
      );
    }
    const now = FieldValue.serverTimestamp();
    transaction.create(targetRef, {
      negocioId: context.businessId,
      uid: targetUid,
      rol: role,
      estado: ACTIVE_STATUS,
      creadoPorUid: context.uid,
      actualizadoPorUid: context.uid,
      creadoEn: now,
      actualizadoEn: now,
    });
  });

  return {
    miembro: {uid: targetUid, rol: role, estado: ACTIVE_STATUS},
  };
}

async function actualizarMembresiaNegocioHandler(
  request,
  {db, auth, HttpsError, FieldValue, requireBusinessAccess}
) {
  const context = await requireBusinessAccess(
    request,
    {db, HttpsError},
    {roles: ["OWNER"]}
  );
  const targetUid = validateUid(request?.data?.miembroUid, HttpsError);
  const role = safeText(request?.data?.rol, 20).toUpperCase();
  const status = safeText(request?.data?.estado, 20).toLowerCase();
  if (!MANAGEABLE_ROLES.includes(role) && role !== "MEMBER") {
    throw new HttpsError(
      "invalid-argument",
      "Selecciona un rol V1 válido."
    );
  }
  if (!MEMBERSHIP_STATUSES.includes(status)) {
    throw new HttpsError(
      "invalid-argument",
      "El estado debe ser activo o inactivo."
    );
  }
  if (status === ACTIVE_STATUS) {
    try {
      const authUser = await auth.getUser(targetUid);
      if (authUser.disabled) {
        throw new HttpsError(
          "failed-precondition",
          "La cuenta de usuario está deshabilitada."
        );
      }
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (String(error?.code || "").includes("user-not-found")) {
        throw new HttpsError(
          "failed-precondition",
          "La cuenta de usuario ya no está disponible."
        );
      }
      throw error;
    }
  }

  const targetRef = db
    .collection("membresias")
    .doc(membershipDocumentId(context.businessId, targetUid));
  await db.runTransaction(async (transaction) => {
    const [businessSnapshot, actorSnapshot, targetSnapshot] = await Promise.all([
      transaction.get(context.businessRef),
      transaction.get(context.membershipRef),
      transaction.get(targetRef),
    ]);
    validateBusinessSnapshot(businessSnapshot, HttpsError);
    validateActorSnapshot(actorSnapshot, context, HttpsError);
    if (!targetSnapshot.exists || !isCanonicalMembership(targetSnapshot, context.businessId)) {
      throw new HttpsError("not-found", "No se encontró la membresía indicada.");
    }
    const target = targetSnapshot.data() || {};
    if (target.rol === "OWNER") {
      throw new HttpsError(
        "failed-precondition",
        "La membresía OWNER no puede modificarse en este módulo."
      );
    }
    if (role === "MEMBER" && target.rol !== "MEMBER") {
      throw new HttpsError(
        "invalid-argument",
        "MEMBER sólo puede conservarse en membresías legacy existentes."
      );
    }
    if (target.rol === role && target.estado === status) return;

    const now = FieldValue.serverTimestamp();
    transaction.update(targetRef, {
      rol: role,
      estado: status,
      actualizadoPorUid: context.uid,
      actualizadoEn: now,
      ...(status === "inactivo"
        ? {desactivadoPorUid: context.uid, desactivadoEn: now}
        : {
            desactivadoPorUid: FieldValue.delete(),
            desactivadoEn: FieldValue.delete(),
          }),
    });
  });

  return {miembro: {uid: targetUid, rol: role, estado: status}};
}

module.exports = {
  ACTIVE_STATUS,
  BUSINESS_ROLES,
  MANAGEABLE_ROLES,
  MEMBERSHIP_STATUSES,
  actualizarMembresiaNegocioHandler,
  asociarUsuarioExistenteHandler,
  listarMiembrosNegocioHandler,
  membershipDocumentId,
};
