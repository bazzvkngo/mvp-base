// Recuperación de cuenta desde la consola de plataforma (/admin/usuarios/:uid).
//
// Tres Functions, todas con `requirePlatformSuperadmin`, motivo obligatorio,
// operación idempotente por `requestId` y un evento en
// `usuarios/{uid}/eventosPlataforma`:
//   - restablecerContrasenaUsuarioPlataforma: envía el enlace al correo del
//     usuario. El enlace nunca se devuelve ni se muestra al superadmin.
//   - cambiarCorreoUsuarioPlataforma: cambia el correo en Auth y en
//     `usuarios/{uid}`, lo deja sin verificar, revoca las sesiones y avisa al
//     correo anterior.
//   - editarUsuarioPlataforma: edita solo nombres, apellidos y teléfono.
//
// Se bloquea la acción si el objetivo es otro superadmin, la propia cuenta o
// una cuenta sin proveedor de contraseña (por ejemplo, solo Google).

const {createHash} = require("node:crypto");
const {normalizeReplyAddress} = require("./emailEnvelope");
const {
  PLATFORM_SUPERADMIN,
  requirePlatformSuperadmin,
} = require("./platformAccess");

const PASSWORD_PROVIDER = "password";
const OPERATIONS_COLLECTION = "platformUserRecoveryRequests";
const OPERATION_LEASE_MS = 60 * 1000;
const RESET_EVENT = "USUARIO_RESTABLECIMIENTO_ENVIADO";
const EMAIL_EVENT = "USUARIO_CORREO_CAMBIADO";
const PROFILE_EVENT = "USUARIO_PERFIL_EDITADO";
// Lista blanca de campos editables: clave -> longitud máxima.
const EDITABLE_PROFILE_FIELDS = {nombres: 120, apellidos: 160, telefonoPersonal: 40};

function fail(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

function text(value, max = 180) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function uidValue(value, HttpsError) {
  const normalized = text(value, 160);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(normalized)) {
    fail(HttpsError, "invalid-argument", "El usuario no es valido.");
  }
  return normalized;
}

function operationId(value, HttpsError) {
  const normalized = text(value, 120);
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(normalized)) {
    fail(HttpsError, "invalid-argument", "No se pudo validar la operacion.");
  }
  return normalized;
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function nowMs(dependencies) {
  return dependencies.now?.() ?? Date.now();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[char]);
}

function maskEmail(email) {
  const [local = "", domain = ""] = String(email || "").split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

function hasPasswordProvider(authUser) {
  return (authUser?.providerData || []).some(
    (provider) => provider?.providerId === PASSWORD_PROVIDER
  );
}

// Validaciones comunes a las tres acciones. Devuelve el actor, el objetivo y
// los datos de la operación. No escribe nada.
async function prepareRecovery(request, dependencies) {
  const {auth, HttpsError} = dependencies;
  const actor = await requirePlatformSuperadmin(request, dependencies);
  const uid = uidValue(request?.data?.uid, HttpsError);
  const requestId = operationId(request?.data?.requestId, HttpsError);
  const reason = text(request?.data?.motivo, 1000);
  if (!reason) fail(HttpsError, "invalid-argument", "Indica el motivo de la accion.");
  if (uid === actor.uid) {
    fail(HttpsError, "failed-precondition", "No puedes usar la recuperacion de cuenta sobre tu propia cuenta.");
  }
  let targetAuth;
  try {
    targetAuth = await auth.getUser(uid);
  } catch (error) {
    if (String(error?.code || "").includes("user-not-found")) {
      fail(HttpsError, "not-found", "No se encontro el usuario.");
    }
    throw error;
  }
  if (targetAuth.customClaims?.platformRole === PLATFORM_SUPERADMIN) {
    fail(HttpsError, "failed-precondition", "Las cuentas Administrador no se recuperan desde este panel.");
  }
  if (!hasPasswordProvider(targetAuth)) {
    fail(
      HttpsError,
      "failed-precondition",
      "La cuenta entra solo con Google u otro proveedor externo. Su acceso se recupera con ese proveedor."
    );
  }
  return {actor, uid, requestId, reason, targetAuth};
}

// Reserva la operación por `requestId`. Devuelve `{completed: true, stored}`
// si ya terminó, o `{completed: false, stored}` si hay que ejecutarla (nueva,
// fallida o abandonada). Una operación en curso y reciente se rechaza.
async function reserveOperation(dependencies, {
  operationRef, actor, uid, action, requestFingerprint, extra = {},
}) {
  const {db, FieldValue, HttpsError} = dependencies;
  const startedAt = nowMs(dependencies);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(operationRef);
    if (snapshot.exists) {
      const stored = snapshot.data() || {};
      if (
        stored.uidUsuario !== uid ||
        stored.creadoPorUid !== actor.uid ||
        stored.accion !== action ||
        stored.fingerprint !== requestFingerprint
      ) {
        fail(HttpsError, "already-exists", "La operacion ya fue utilizada con otros datos.");
      }
      if (stored.estado === "COMPLETADA") return {completed: true, stored};
      if (
        stored.estado === "EN_PROCESO" &&
        startedAt - Number(stored.iniciadoEnMs || 0) < OPERATION_LEASE_MS
      ) {
        fail(HttpsError, "aborted", "La operacion ya esta en curso. Espera unos segundos.");
      }
      transaction.update(operationRef, {
        estado: "EN_PROCESO",
        iniciadoEnMs: startedAt,
        actualizadoEn: FieldValue.serverTimestamp(),
      });
      return {completed: false, stored};
    }
    const stored = {
      uidUsuario: uid,
      accion: action,
      estado: "EN_PROCESO",
      creadoPorUid: actor.uid,
      fingerprint: requestFingerprint,
      iniciadoEnMs: startedAt,
      ...extra,
    };
    transaction.create(operationRef, {
      ...stored,
      creadoEn: FieldValue.serverTimestamp(),
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    return {completed: false, stored};
  });
}

async function markFailed(dependencies, operationRef, error) {
  try {
    await operationRef.set({
      estado: "FALLIDA",
      ultimoError: text(error?.message, 500),
      actualizadoEn: dependencies.FieldValue.serverTimestamp(),
    }, {merge: true});
  } catch {
    // La operación queda EN_PROCESO y se reanuda al vencer el arrendamiento.
  }
}

// Configuración de envío. En emulador el correo se simula (no sale de la
// máquina), igual que cotizaciones y órdenes de compra.
function deliveryConfig(dependencies) {
  if (dependencies.isEmulatorEnvironment?.() === true) return {simulated: true};
  const apiKey = dependencies.getResendApiKey?.();
  const from = dependencies.getEmailSender?.();
  if (!apiKey || !from || typeof dependencies.sendEmail !== "function") return null;
  return {simulated: false, apiKey, from};
}

async function deliver(dependencies, config, message) {
  if (config.simulated) return "simulado";
  await dependencies.sendEmail({
    apiKey: config.apiKey,
    from: config.from,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
  return "enviado";
}

function passwordResetMessage({to, link}) {
  const subject = "Restablece tu contraseña de ValoraCloud";
  const intro = "Un administrador de ValoraCloud te envía este enlace para que definas una contraseña nueva.";
  const outro = "Si no esperabas este correo, puedes ignorarlo: tu contraseña actual no cambia hasta que uses el enlace.";
  return {
    to,
    subject,
    text: `${intro}\n\n${link}\n\n${outro}`,
    html: `<p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(link)}">Definir una contraseña nueva</a></p><p>${escapeHtml(outro)}</p>`,
  };
}

function emailChangedNoticeMessage({to, newEmail}) {
  const subject = "El correo de tu cuenta de ValoraCloud fue cambiado";
  const body = `Un administrador de ValoraCloud cambió el correo de acceso de tu cuenta a ${maskEmail(newEmail)}. ` +
    "Tus sesiones abiertas se cerraron. Si no solicitaste este cambio, comunícate con el soporte de ValoraCloud cuanto antes.";
  return {to, subject, text: body, html: `<p>${escapeHtml(body)}</p>`};
}

async function restablecerContrasenaUsuarioPlataformaHandler(request, dependencies) {
  const {auth, db, FieldValue, HttpsError} = dependencies;
  const {actor, uid, requestId, reason, targetAuth} = await prepareRecovery(request, dependencies);
  const email = text(targetAuth.email, 320);
  if (!email) fail(HttpsError, "failed-precondition", "La cuenta no tiene un correo registrado.");
  const config = deliveryConfig(dependencies);
  if (!config) fail(HttpsError, "failed-precondition", "El envio de correo no esta configurado.");

  const operationRef = db.collection(OPERATIONS_COLLECTION).doc(requestId);
  const eventRef = db.collection("usuarios").doc(uid).collection("eventosPlataforma").doc(requestId);
  const reservation = await reserveOperation(dependencies, {
    operationRef,
    actor,
    uid,
    action: "RESTABLECER_CONTRASENA",
    requestFingerprint: fingerprint({uid, action: "RESTABLECER_CONTRASENA", reason}),
  });
  if (reservation.completed) {
    return {uid, enviado: true, envio: reservation.stored.envio || "enviado", idempotent: true};
  }

  let delivery;
  try {
    const link = await auth.generatePasswordResetLink(email);
    delivery = await deliver(dependencies, config, passwordResetMessage({to: email, link}));
  } catch (error) {
    await markFailed(dependencies, operationRef, error);
    fail(HttpsError, "unavailable", "No fue posible enviar el correo de restablecimiento. Intenta nuevamente.");
  }

  const timestamp = FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.create(eventRef, {
    uidUsuario: uid,
    tipo: RESET_EVENT,
    motivo: reason,
    envio: delivery,
    creadoPorUid: actor.uid,
    creadoEn: timestamp,
  });
  batch.set(operationRef, {estado: "COMPLETADA", envio: delivery, completadaEn: timestamp, actualizadoEn: timestamp}, {merge: true});
  await batch.commit();
  return {uid, enviado: true, envio: delivery, idempotent: false};
}

async function cambiarCorreoUsuarioPlataformaHandler(request, dependencies) {
  const {auth, db, FieldValue, HttpsError} = dependencies;
  const {actor, uid, requestId, reason, targetAuth} = await prepareRecovery(request, dependencies);
  const newEmail = normalizeReplyAddress(request?.data?.correoNuevo);
  if (!newEmail) fail(HttpsError, "invalid-argument", "Ingresa un correo nuevo valido.");

  const operationRef = db.collection(OPERATIONS_COLLECTION).doc(requestId);
  const userRef = db.collection("usuarios").doc(uid);
  const eventRef = userRef.collection("eventosPlataforma").doc(requestId);
  const resuming = (await operationRef.get()).exists;

  // Una operación nueva debe cambiar a un correo libre. Al reanudar, Auth puede
  // tener ya el correo nuevo porque el paso anterior sí llegó a completarse.
  if (!resuming) {
    if (normalizeReplyAddress(targetAuth.email) === newEmail) {
      fail(HttpsError, "failed-precondition", "El correo nuevo es igual al actual.");
    }
    try {
      await auth.getUserByEmail(newEmail);
      fail(HttpsError, "already-exists", "Ese correo ya esta en uso por otra cuenta.");
    } catch (error) {
      if (!String(error?.code || "").includes("user-not-found")) throw error;
    }
  }

  const reservation = await reserveOperation(dependencies, {
    operationRef,
    actor,
    uid,
    action: "CAMBIAR_CORREO",
    requestFingerprint: fingerprint({uid, action: "CAMBIAR_CORREO", reason, newEmail}),
    extra: {correoAnterior: text(targetAuth.email, 320), correoNuevo: newEmail},
  });
  const previousEmail = text(reservation.stored.correoAnterior, 320);
  if (reservation.completed) {
    return {uid, correo: newEmail, avisoCorreoAnterior: reservation.stored.avisoCorreoAnterior || "no_enviado", idempotent: true};
  }

  try {
    if (normalizeReplyAddress(targetAuth.email) !== newEmail) {
      await auth.updateUser(uid, {email: newEmail, emailVerified: false});
    }
    await auth.revokeRefreshTokens(uid);
  } catch (error) {
    await markFailed(dependencies, operationRef, error);
    if (String(error?.code || "").includes("email-already-exists")) {
      fail(HttpsError, "already-exists", "Ese correo ya esta en uso por otra cuenta.");
    }
    throw error;
  }

  await db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    const timestamp = FieldValue.serverTimestamp();
    transaction.set(userRef, {
      email: newEmail,
      actualizadoEn: timestamp,
      ...(userSnapshot.exists ? {} : {creadoEn: timestamp}),
    }, {merge: true});
    transaction.create(eventRef, {
      uidUsuario: uid,
      tipo: EMAIL_EVENT,
      correoAnterior: previousEmail,
      correoNuevo: newEmail,
      motivo: reason,
      creadoPorUid: actor.uid,
      creadoEn: timestamp,
    });
    transaction.set(operationRef, {estado: "COMPLETADA", completadaEn: timestamp, actualizadoEn: timestamp}, {merge: true});
  });

  // El aviso al correo anterior no revierte el cambio: se informa su resultado.
  let notice = "fallido";
  const config = deliveryConfig(dependencies);
  if (previousEmail && config) {
    try {
      notice = await deliver(dependencies, config, emailChangedNoticeMessage({to: previousEmail, newEmail}));
    } catch {
      notice = "fallido";
    }
  } else if (previousEmail) {
    notice = "no_configurado";
  }
  await Promise.all([
    operationRef.set({avisoCorreoAnterior: notice}, {merge: true}),
    eventRef.set({avisoCorreoAnterior: notice}, {merge: true}),
  ]);
  return {uid, correo: newEmail, avisoCorreoAnterior: notice, idempotent: false};
}

function profileChanges(rawChanges, HttpsError) {
  if (!rawChanges || typeof rawChanges !== "object" || Array.isArray(rawChanges)) {
    fail(HttpsError, "invalid-argument", "Indica los cambios del perfil.");
  }
  const keys = Object.keys(rawChanges);
  if (!keys.length) fail(HttpsError, "invalid-argument", "Indica los cambios del perfil.");
  const changes = {};
  for (const key of keys) {
    if (!Object.hasOwn(EDITABLE_PROFILE_FIELDS, key)) {
      fail(HttpsError, "invalid-argument", "El perfil incluye campos que no se pueden editar.");
    }
    changes[key] = text(rawChanges[key], EDITABLE_PROFILE_FIELDS[key]);
  }
  if ("nombres" in changes && !changes.nombres) {
    fail(HttpsError, "invalid-argument", "El nombre no puede quedar vacio.");
  }
  return changes;
}

async function editarUsuarioPlataformaHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const {actor, uid, requestId, reason} = await prepareRecovery(request, dependencies);
  const changes = profileChanges(request?.data?.cambios, HttpsError);
  const operationRef = db.collection(OPERATIONS_COLLECTION).doc(requestId);
  const profileRef = db.collection("usuarios").doc(uid).collection("cuenta").doc("perfil");
  const eventRef = db.collection("usuarios").doc(uid).collection("eventosPlataforma").doc(requestId);
  const requestFingerprint = fingerprint({uid, action: "EDITAR_PERFIL", reason, changes});

  return db.runTransaction(async (transaction) => {
    const [operation, profileSnapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(profileRef),
    ]);
    if (operation.exists) {
      const stored = operation.data() || {};
      if (
        stored.uidUsuario !== uid ||
        stored.creadoPorUid !== actor.uid ||
        stored.accion !== "EDITAR_PERFIL" ||
        stored.fingerprint !== requestFingerprint
      ) {
        fail(HttpsError, "already-exists", "La operacion ya fue utilizada con otros datos.");
      }
      return {uid, camposModificados: stored.camposModificados || [], idempotent: true};
    }
    const current = profileSnapshot.data() || {};
    const changedFields = Object.keys(changes).filter(
      (field) => text(current[field], EDITABLE_PROFILE_FIELDS[field]) !== changes[field]
    );
    if (!changedFields.length) {
      fail(HttpsError, "failed-precondition", "No hay cambios para guardar.");
    }
    const timestamp = FieldValue.serverTimestamp();
    const patch = {uid, actualizadoEn: timestamp};
    const audit = {};
    changedFields.forEach((field) => {
      patch[field] = changes[field] || FieldValue.delete();
      audit[field] = {anterior: text(current[field], EDITABLE_PROFILE_FIELDS[field]), nuevo: changes[field]};
    });
    transaction.set(profileRef, patch, {merge: true});
    transaction.create(eventRef, {
      uidUsuario: uid,
      tipo: PROFILE_EVENT,
      camposModificados: changedFields,
      cambios: audit,
      motivo: reason,
      creadoPorUid: actor.uid,
      creadoEn: timestamp,
    });
    transaction.create(operationRef, {
      uidUsuario: uid,
      accion: "EDITAR_PERFIL",
      estado: "COMPLETADA",
      camposModificados: changedFields,
      creadoPorUid: actor.uid,
      fingerprint: requestFingerprint,
      creadoEn: timestamp,
      actualizadoEn: timestamp,
    });
    return {uid, camposModificados: changedFields, idempotent: false};
  });
}

module.exports = {
  EMAIL_EVENT,
  OPERATIONS_COLLECTION,
  PROFILE_EVENT,
  RESET_EVENT,
  cambiarCorreoUsuarioPlataformaHandler,
  editarUsuarioPlataformaHandler,
  restablecerContrasenaUsuarioPlataformaHandler,
};
