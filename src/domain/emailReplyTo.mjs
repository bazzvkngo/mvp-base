// Espejo en el cliente de la regla del servidor (functions/emailEnvelope.js):
// sirve solo para redactar el texto por defecto del correo. El Reply-To real
// lo decide siempre el servidor.
const EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i;

export function normalizeReplyAddress(value) {
  if (typeof value !== "string" || value.length > 180) return "";
  const email = value.trim();
  if (/[\r\n,;<>"\s]/.test(email)) return "";
  return EMAIL_PATTERN.test(email) ? email.toLowerCase() : "";
}

export function resolveReplyToHint({ companyEmail, accountEmail } = {}) {
  return normalizeReplyAddress(companyEmail) || normalizeReplyAddress(accountEmail);
}

export function buildQuoteReplyLine(hasReplyTo) {
  return hasReplyTo
    ? "Si tienes consultas o necesitas ajustes, responde a este correo."
    : "Puedes responder la propuesta desde el enlace.";
}
