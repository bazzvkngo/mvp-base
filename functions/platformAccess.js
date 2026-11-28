// Autoridad de plataforma: un único punto de verificación para todas las
// Functions de plataforma (platformAdmin.js y resolverVerificacionEmpresa).
//
// La fuente de verdad es el claim guardado en Firebase Auth
// (`authUser.customClaims`), no el claim del token de la sesión: así revocar
// el claim surte efecto de inmediato y no al vencer el token. Además se
// rechazan las cuentas suspendidas (Auth deshabilitado o `estadoPlataforma`).

const PLATFORM_SUPERADMIN = "PLATFORM_SUPERADMIN";
const ACTIVE_STATUS = "activo";
const SUSPENDED_STATUS = "suspendido";

function platformUserStatus(user = {}, authUser = null) {
  return user.estadoPlataforma === SUSPENDED_STATUS || authUser?.disabled
    ? SUSPENDED_STATUS
    : ACTIVE_STATUS;
}

async function requirePlatformSuperadmin(request, {auth, db, HttpsError}) {
  const uid = request?.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
  let authUser;
  try {
    authUser = await auth.getUser(uid);
  } catch (error) {
    if (String(error?.code || "").includes("user-not-found")) {
      throw new HttpsError("permission-denied", "Se requiere autoridad de plataforma.");
    }
    throw error;
  }
  if (authUser.customClaims?.platformRole !== PLATFORM_SUPERADMIN) {
    throw new HttpsError("permission-denied", "Se requiere autoridad de plataforma.");
  }
  const userSnapshot = await db.collection("usuarios").doc(uid).get();
  if (platformUserStatus(userSnapshot.data() || {}, authUser) !== ACTIVE_STATUS) {
    throw new HttpsError("permission-denied", "La cuenta de plataforma esta suspendida.");
  }
  return {uid, authUser};
}

module.exports = {
  ACTIVE_STATUS,
  PLATFORM_SUPERADMIN,
  SUSPENDED_STATUS,
  platformUserStatus,
  requirePlatformSuperadmin,
};
