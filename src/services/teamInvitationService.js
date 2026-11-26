import {httpsCallable} from "firebase/functions";
import {assertCloudFunctionAllowed} from "../config/firebaseEnvironment.mjs";
import {auth, getFirebaseFunctions} from "../firebase/firebaseConfig.js";
import {normalizeBusinessMemberEmail} from "../domain/businessMemberModel.mjs";
import {adaptMyInvitationsResponse} from "../domain/teamInvitationModel.mjs";
import {INVITATIONS_LOAD_LIMITS} from "../domain/invitationsLoader.mjs";

const functions = getFirebaseFunctions("us-central1");

export function createRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return `invitation-${globalThis.crypto.randomUUID()}`;
  }
  return `invitation-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function call(name, data, operation, options) {
  assertCloudFunctionAllowed(operation);
  return httpsCallable(functions, name, options)(data);
}

// user.reload() no renueva el token: si la persona acaba de verificar su
// correo, el backend todavía ve el token anterior. Se renueva una vez.
async function refreshTokenIfEmailVerified() {
  const user = auth.currentUser;
  if (!user || user.emailVerified !== true) return false;
  await user.getIdToken(true);
  return true;
}

export async function invitarMiembroNegocio(businessId, {correo, rol, profileId = "", requestId}) {
  const response = await call(
    "invitarMiembroNegocio",
    {
      businessId,
      correo: normalizeBusinessMemberEmail(correo),
      rol,
      profileId,
      requestId: requestId || createRequestId(),
    },
    "invitar usuarios"
  );
  return response.data || {};
}

export async function listarInvitacionesNegocio(businessId) {
  const response = await call("listarInvitacionesNegocio", {businessId}, "consultar invitaciones");
  return response.data?.invitaciones || [];
}

export async function revocarInvitacionNegocio(businessId, invitacionId) {
  const response = await call(
    "revocarInvitacionNegocio",
    {businessId, invitacionId},
    "revocar invitaciones"
  );
  return response.data || {};
}

// El tope total lo impone quien llama (createInvitationsLoader corta a TIMEOUT_MS y aborta `signal`). Aquí
// solo se evita encadenar trabajo después del corte y se le pasa al SDK el tiempo que queda: la opción
// `timeout` de httpsCallable cubre únicamente la petición HTTP, no la obtención del token ni la renovación
// con getIdToken(true) ni la segunda llamada, por eso no basta por sí sola.
export async function listarMisInvitaciones({signal, timeoutMs = INVITATIONS_LOAD_LIMITS.TIMEOUT_MS} = {}) {
  const deadline = Date.now() + timeoutMs;
  const options = () => ({timeout: Math.max(1, deadline - Date.now())});
  const stopIfCut = () => {
    if (signal?.aborted) throw new Error("La consulta de invitaciones se canceló.");
  };
  let response = await call("listarMisInvitaciones", {}, "consultar tus invitaciones", options());
  stopIfCut();
  if (response.data?.requiereVerificacion === true && await refreshTokenIfEmailVerified()) {
    stopIfCut();
    response = await call("listarMisInvitaciones", {}, "consultar tus invitaciones", options());
  }
  return adaptMyInvitationsResponse(response.data);
}

export async function responderInvitacion({invitacionId, accion, motivo = "", requestId}) {
  const data = {invitacionId, accion, motivo, requestId: requestId || createRequestId()};
  try {
    const response = await call("responderInvitacion", data, "responder invitaciones");
    return response.data || {};
  } catch (error) {
    const notVerified = String(error?.code || "").endsWith("failed-precondition") &&
      /^Verifica tu correo/i.test(String(error?.message || ""));
    if (!notVerified || !await refreshTokenIfEmailVerified()) throw error;
    const response = await call("responderInvitacion", data, "responder invitaciones");
    return response.data || {};
  }
}
