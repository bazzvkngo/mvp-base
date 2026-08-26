const VERIFIED_STATE = "VERIFICADA";

function normalizeBusinessVerificationState(business = {}) {
  const state = String(business.verificacionEmpresa?.estado || "")
    .trim()
    .toUpperCase();
  if (state === "EN_REVISION") return "PENDIENTE";
  return ["NO_VERIFICADA", "PENDIENTE", VERIFIED_STATE, "RECHAZADA"].includes(state)
    ? state
    : "NO_VERIFICADA";
}

function assertBusinessCanOperate(
  business = {},
  taxSettings = {},
  HttpsError
) {
  if (normalizeBusinessVerificationState(business) !== VERIFIED_STATE) {
    throw new HttpsError(
      "failed-precondition",
      "Verifica tu empresa para comenzar a operar."
    );
  }
  if (taxSettings.configuracionTributariaBaseCompleta !== true) {
    throw new HttpsError(
      "failed-precondition",
      "La configuración tributaria base del país requiere revisión de plataforma antes de operar."
    );
  }
}

module.exports = {
  VERIFIED_STATE,
  assertBusinessCanOperate,
  normalizeBusinessVerificationState,
};
