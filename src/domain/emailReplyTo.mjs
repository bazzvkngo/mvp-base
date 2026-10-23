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

// Sin Reply-To no se agrega nada: el correo ya indica una vez que la propuesta
// se revisa y responde desde el enlace, y repetirlo era el texto duplicado.
export function buildQuoteReplyLine(hasReplyTo) {
  return hasReplyTo
    ? "Si tienes consultas o necesitas ajustes, responde a este correo."
    : "";
}

const SENDER_SUFFIX = "(vía ValoraCloud)";
const SENDER_NAME_MAX = 60;
const FALLBACK_SENDER_NAME = "ValoraCloud";

// Espejo de sanitizeSenderName de functions/emailEnvelope.js.
export function sanitizeSenderName(value) {
  return String(value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]/g, " ")
    .replace(/["\u201c\u201d\u201e\u00ab\u00bb<>]/g, "")
    .split(String.fromCharCode(92))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SENDER_NAME_MAX)
    .trim();
}

// Nombre visible del remitente tal como lo arma el servidor. La dirección
// (dominio de envío) es un secreto del servidor y no se conoce aquí.
export function buildSenderDisplayName(businessName) {
  const name = sanitizeSenderName(businessName) || FALLBACK_SENDER_NAME;
  return `${name} ${SENDER_SUFFIX}`;
}

// Espejo de resolveReplyTo: contacto de la empresa, luego la cuenta verificada.
export function resolveReplyToPreview({ companyEmail, accountEmail } = {}) {
  const fromCompany = normalizeReplyAddress(companyEmail);
  if (fromCompany) return { replyTo: fromCompany, source: "empresa" };
  const fromAccount = normalizeReplyAddress(accountEmail);
  if (fromAccount) return { replyTo: fromAccount, source: "cuenta" };
  return { replyTo: "", source: "" };
}

// Espejo de resolveCopyRecipient: devuelve el correo en copia oculta o "".
export function resolveCopyPreview({ sendCopy, accountEmail, to } = {}) {
  if (sendCopy !== true) return "";
  const copy = normalizeReplyAddress(accountEmail);
  const destination = String(to || "").trim().toLowerCase();
  return !copy || copy === destination ? "" : copy;
}
