// Reglas de presentación de la "Recuperación de cuenta" de la ficha del usuario.
// Son solo ayudas de interfaz: la autoridad real (bloqueos, motivo, auditoría)
// vive en functions/platformUsersAdmin.js.

export const RECOVERY_EVENT_TYPES = Object.freeze({
  reset: "USUARIO_RESTABLECIMIENTO_ENVIADO",
  email: "USUARIO_CORREO_CAMBIADO",
  profile: "USUARIO_PERFIL_EDITADO",
});

const PROFILE_FIELD_LABELS = Object.freeze({
  nombres: "Nombres",
  apellidos: "Apellidos",
  telefonoPersonal: "Teléfono",
});

const NOTICE_FAILED_STATES = new Set(["fallido", "no_configurado"]);

// Motivo por el que la recuperación no está disponible, o "" si lo está.
export function accountRecoveryBlock({usuario, isOwnAccount = false} = {}) {
  if (isOwnAccount) return "Tu propia cuenta no se recupera desde aquí.";
  if (usuario?.esSuperadmin === true) return "Las cuentas Administrador no se recuperan desde este panel.";
  if (!(usuario?.proveedores || []).includes("password")) {
    return "Esta cuenta entra solo con Google u otro proveedor externo. Su acceso se recupera con ese proveedor.";
  }
  return "";
}

// Solo los campos que cambiaron respecto de la ficha, ya recortados.
export function profileChanges(usuario = {}, draft = {}) {
  const changes = {};
  for (const field of Object.keys(PROFILE_FIELD_LABELS)) {
    const next = String(draft[field] ?? "").trim().replace(/\s+/g, " ");
    const current = String(usuario[field] ?? "").trim().replace(/\s+/g, " ");
    if (next !== current) changes[field] = next;
  }
  return changes;
}

export function profileFieldLabel(field) {
  return PROFILE_FIELD_LABELS[field] || field;
}

// Aviso que el superadmin debe ver si el correo anterior no quedó notificado.
// Devuelve null cuando el aviso salió bien (o se simuló en emulador).
export function previousEmailNotice(result = {}, previousEmail = "") {
  const state = String(result?.avisoCorreoAnterior || "");
  if (!state || state === "enviado" || state === "simulado") return null;
  const target = previousEmail ? ` (${previousEmail})` : "";
  if (state === "no_configurado") {
    return {
      title: "No se avisó al correo anterior",
      text: `El correo se cambió, pero el envío de avisos no está configurado, así que el correo anterior${target} no fue notificado. Avísale a la persona por otro medio.`,
    };
  }
  if (NOTICE_FAILED_STATES.has(state)) {
    return {
      title: "No se avisó al correo anterior",
      text: `El correo se cambió, pero no se pudo enviar el aviso al correo anterior${target}. Avísale a la persona por otro medio.`,
    };
  }
  return {
    title: "No se pudo confirmar el aviso al correo anterior",
    text: `El correo se cambió, pero no se pudo confirmar que el correo anterior${target} fuera notificado.`,
  };
}

// Línea de resumen de un evento del usuario en el historial de la ficha.
export function userEventSummary(event = {}, stateLabel = (value) => value) {
  if (event.tipo === RECOVERY_EVENT_TYPES.email) {
    return `${event.correoAnterior || "Sin registro"} → ${event.correoNuevo || "Sin registro"}`;
  }
  if (event.tipo === RECOVERY_EVENT_TYPES.profile) {
    const fields = (event.camposModificados || []).map(profileFieldLabel).join(", ");
    return fields ? `Campos: ${fields}` : "Datos del perfil";
  }
  if (event.tipo === RECOVERY_EVENT_TYPES.reset) return "Enlace enviado al correo del usuario";
  return `${stateLabel(event.estadoAnterior)} → ${stateLabel(event.estadoResultante)}`;
}

// Texto de error para una acción de recuperación. Los mensajes del servidor de
// estas Functions ya son aptos para mostrar.
export function recoveryErrorMessage(error, fallback) {
  const code = String(error?.code || "");
  if (code.includes("permission-denied")) return "No tienes autorización para esta acción.";
  if (/(failed-precondition|invalid-argument|already-exists|aborted|unavailable)/.test(code) && error?.message) {
    return String(error.message);
  }
  return fallback;
}
