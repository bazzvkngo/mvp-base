import { resolveDocumentCompany } from "./companySnapshot.mjs";
import {
  buildSenderDisplayName,
  resolveCopyPreview,
  resolveReplyToPreview,
} from "./emailReplyTo.mjs";

// Lo que se ve en el diálogo de envío de una orden de compra: remitente,
// Reply-To y copia salen de las mismas reglas que usa el servidor
// (functions/emailEnvelope.js, vía emailReplyTo.mjs). Funciones puras, sin red
// ni React. El correo real lo arma siempre el servidor.
const PAYMENT_LABELS = Object.freeze({
  contado: "Contado",
  transferencia: "Transferencia",
  credito: "Crédito",
  otro: "Otro",
});

function singleLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function joinNonEmpty(parts, separator) {
  return parts.filter((part) => String(part || "").trim()).join(separator);
}

export function buildPurchaseOrderEmailPreview({
  accountEmail = "",
  asunto = "",
  companyProfile = {},
  emailProveedor = "",
  enviarCopia = false,
  formatDate,
  formatMoney,
  mensaje = "",
  order = {},
} = {}) {
  const company = resolveDocumentCompany(order, companyProfile);
  const senderName =
    companyProfile?.nombreComercial ||
    companyProfile?.razonSocial ||
    company.nombreComercial ||
    company.razonSocial;
  const { replyTo, source } = resolveReplyToPreview({
    companyEmail: companyProfile?.email,
    accountEmail,
  });
  const summaryRows = [
    { label: "Orden de compra", value: singleLine(order.numero) || "—" },
    { label: "Total", value: formatMoney(order.total || 0, order.moneda || "CLP", order.locale || "es-CL") },
  ];
  if (order.condicionesPago) {
    summaryRows.push({
      label: "Condiciones",
      value: PAYMENT_LABELS[order.condicionesPago] || String(order.condicionesPago),
    });
  }
  if (order.fechaEntregaEstimada) {
    summaryRows.push({
      label: "Entrega estimada",
      value: formatDate(order.fechaEntregaEstimada, order.locale || "es-CL"),
    });
  }

  return {
    from: buildSenderDisplayName(senderName),
    replyTo,
    replyToSource: source,
    copyTo: resolveCopyPreview({
      sendCopy: enviarCopia === true && Boolean(accountEmail),
      accountEmail,
      to: emailProveedor,
    }),
    to: String(emailProveedor || "").trim(),
    subject: String(asunto || "").trim(),
    message: String(mensaje || "").trim(),
    brand: singleLine(company.nombreComercial || company.razonSocial),
    summaryRows,
    contact: joinNonEmpty([company.email, company.telefono, company.sitioWeb], " / "),
    address: joinNonEmpty([company.direccion, company.ciudad], " / "),
  };
}

// Texto de "Responder a" que ve quien envía: la dirección real y, si viene de la
// cuenta de quien envía y no de la empresa, de dónde sale.
export function describePurchaseOrderReplyTo({ replyTo, replyToSource }) {
  if (!replyTo) return "";
  return replyToSource === "cuenta" ? `${replyTo} (correo de tu cuenta)` : replyTo;
}
