const SENDER_SUFFIX = "(vía ValoraCloud)";
const SENDER_NAME_MAX = 60;
const FALLBACK_SENDER_NAME = "ValoraCloud";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i.test(
    normalizeEmail(value)
  );
}

// Devuelve el correo en minúsculas o "" si no es una única dirección válida.
function normalizeReplyAddress(value) {
  if (
    typeof value !== "string" ||
    value.length > 180 ||
    /[\r\n,;<>"\s]/.test(value.trim())
  ) {
    return "";
  }
  const email = normalizeEmail(value);
  return isValidEmail(email) ? email : "";
}

// El correo de la cuenta solo sirve si el token lo declara verificado.
function resolveAccountEmail(token = {}) {
  if (!token || token.email_verified !== true) return "";
  return normalizeReplyAddress(token.email);
}

function resolveReplyTo({companyEmail, accountEmail} = {}) {
  const fromCompany = normalizeReplyAddress(companyEmail);
  if (fromCompany) return {replyTo: fromCompany, source: "empresa"};
  const fromAccount = normalizeReplyAddress(accountEmail);
  if (fromAccount) return {replyTo: fromAccount, source: "cuenta"};
  return {replyTo: "", source: ""};
}

function sanitizeSenderName(value) {
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

function extractSenderAddress(configuredFrom) {
  const raw = String(configuredFrom || "").trim();
  if (!raw || /[\r\n]/.test(raw)) return "";
  const angle = raw.match(/<([^<>]+)>\s*$/);
  const candidate = (angle ? angle[1] : raw).trim();
  return isValidEmail(candidate) ? candidate : "";
}

// "{nombre comercial} (vía ValoraCloud)" <dirección del dominio de envío>.
// Si el From configurado no trae una dirección válida se devuelve intacto,
// para no cambiar el comportamiento de una configuración ya existente.
function buildSenderFrom({configuredFrom, businessName} = {}) {
  const address = extractSenderAddress(configuredFrom);
  if (!address) return String(configuredFrom || "").trim();
  const name = sanitizeSenderName(businessName) || FALLBACK_SENDER_NAME;
  return `"${name} ${SENDER_SUFFIX}" <${address}>`;
}

function resolveCopyRecipient({sendCopy, accountEmail, to} = {}) {
  if (sendCopy !== true) return [];
  const copy = normalizeReplyAddress(accountEmail);
  if (!copy || copy === normalizeEmail(to)) return [];
  return [copy];
}

// Datos de entrega que el servidor decide. Nada de esto viene del cuerpo de la solicitud.
function buildDeliveryEnvelope({
  accountEmail,
  businessName,
  companyEmail,
  configuredFrom,
  sendCopy,
  to,
} = {}) {
  const {replyTo, source} = resolveReplyTo({companyEmail, accountEmail});
  const bcc = resolveCopyRecipient({sendCopy, accountEmail, to});
  return {
    from: buildSenderFrom({configuredFrom, businessName}),
    replyTo,
    replyToSource: source,
    ...(bcc.length ? {bcc} : {}),
  };
}

module.exports = {
  SENDER_SUFFIX,
  buildDeliveryEnvelope,
  buildSenderFrom,
  extractSenderAddress,
  normalizeReplyAddress,
  resolveAccountEmail,
  resolveCopyRecipient,
  resolveReplyTo,
  sanitizeSenderName,
};
