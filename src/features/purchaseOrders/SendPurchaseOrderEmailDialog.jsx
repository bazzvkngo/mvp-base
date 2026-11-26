import React, {useEffect, useMemo, useState} from "react";
import DocumentEmailDialog from "../../components/ui/DocumentEmailDialog";
import DocumentEmailPreview from "../../components/ui/DocumentEmailPreview";
import {resolveDocumentCompany} from "../../domain/companySnapshot.mjs";
import {resolveReplyToHint} from "../../domain/emailReplyTo.mjs";
import {getPurchaseOrderPdfFileName} from "../../domain/purchaseOrderDocument.mjs";
import {
  buildPurchaseOrderEmailPreview,
  describePurchaseOrderReplyTo,
} from "../../domain/purchaseOrderEmailPreview.mjs";
import {getVerifiedAccountEmail} from "../../services/senderAccount";
import {formatDate, formatMoney} from "../../utils/formatters";
import {isValidPurchaseOrderEmail, isValidPurchaseOrderEmailMessage, isValidPurchaseOrderEmailSubject} from "../../services/purchaseOrderEmailService";

function buildInitialEmail({accountEmail = "", companyProfile = {}, order = {}}) {
  const company = resolveDocumentCompany(order, companyProfile);
  const companyName = company.nombreComercial || company.razonSocial || "Empresa compradora";
  const providerName = order.proveedorSnapshot?.razonSocial || "Proveedor";
  const responseInstruction = resolveReplyToHint({companyEmail: companyProfile?.email, accountEmail})
    ? "Por favor, responde este correo para confirmar la recepción de la orden o indicar cualquier observación."
    : "Por favor, confirma la recepción de la orden por el canal habitual o indica cualquier observación.";
  return {
    asunto: `Orden de compra ${order.numero || ""} | ${companyName}`.trim(),
    mensaje: `Estimado/a ${providerName}:\n\nAdjuntamos la orden de compra ${order.numero || ""} para su revisión.\n\n${responseInstruction}\n\nSaludos,\n${companyName}`,
  };
}

// Motivo visible cuando el botón principal está deshabilitado.
function getDisabledReason({email, validEmail, validSubject, validMessage}) {
  if (!email.trim()) return "Escribe un correo para enviar";
  if (!validEmail) return "Corrige el correo del destinatario para enviar";
  if (!validSubject) return "Escribe el asunto para enviar";
  if (!validMessage) return "Escribe el mensaje para enviar";
  return "";
}

// A la orden de compra no se responde desde un enlace: el proveedor recibe el correo
// con el PDF adjunto y responde por correo. La estructura es la del diálogo compartido.
export default function SendPurchaseOrderEmailDialog({companyProfile, onClose, onSend, open, order, processing}) {
  const accountEmail = getVerifiedAccountEmail();
  // Valores iniciales ya al abrir (el efecto de abajo los repone cada vez que se abre) para no
  // mostrar un instante el formulario vacío y con el botón deshabilitado.
  const initialEmail = () => (open && order ? buildInitialEmail({accountEmail, companyProfile, order}) : {asunto: "", mensaje: ""});
  const [email, setEmail] = useState(() => (open && order ? order.proveedorSnapshot?.email || "" : ""));
  const [asunto, setAsunto] = useState(() => initialEmail().asunto);
  const [mensaje, setMensaje] = useState(() => initialEmail().mensaje);
  const [enviarCopia, setEnviarCopia] = useState(false);
  const savedEmail = order?.proveedorSnapshot?.email || "";
  useEffect(() => {
    if (!open) return;
    const initial = buildInitialEmail({accountEmail, companyProfile, order});
    setEmail(order?.proveedorSnapshot?.email || "");
    setAsunto(initial.asunto);
    setMensaje(initial.mensaje);
    setEnviarCopia(false);
  }, [accountEmail, companyProfile, open, order]);
  const validEmail = isValidPurchaseOrderEmail(email);
  const validSubject = isValidPurchaseOrderEmailSubject(asunto);
  const validMessage = isValidPurchaseOrderEmailMessage(mensaje);
  const valid = validEmail && validSubject && validMessage;
  const preview = useMemo(() => buildPurchaseOrderEmailPreview({
    accountEmail,
    asunto,
    companyProfile,
    emailProveedor: email,
    enviarCopia,
    formatDate,
    formatMoney,
    mensaje,
    order: order || {},
  }), [accountEmail, asunto, companyProfile, email, enviarCopia, mensaje, order]);
  const submit = () => {
    if (!processing && valid) onSend({emailProveedor: email.trim(), asunto: asunto.trim(), mensaje: mensaje.trim(), enviarCopia: Boolean(accountEmail) && enviarCopia});
  };
  const providerName = order?.proveedorSnapshot?.razonSocial || "Proveedor";
  const orderNumber = order?.numero || "Orden de compra";
  return (
    <DocumentEmailDialog
      accountEmail={accountEmail}
      asunto={asunto}
      asuntoError={validSubject ? "" : "Ingresa un asunto de hasta 180 caracteres y sin saltos de línea."}
      attachmentName={getPurchaseOrderPdfFileName(order)}
      copyTo={preview.copyTo}
      description="Se adjuntará el PDF de la orden. Quedará emitida solo si el correo se envía correctamente."
      disabled={!valid}
      disabledReason={getDisabledReason({email, validEmail, validSubject, validMessage})}
      documentName={order?.numero || "orden de compra"}
      eyebrow="Emisión al proveedor"
      from={preview.from}
      mensaje={mensaje}
      mensajeError={validMessage ? "" : "Ingresa un mensaje de hasta 2000 caracteres."}
      note={{
        title: preview.replyTo
          ? "El proveedor responderá por correo a la dirección de arriba."
          : "El proveedor responderá por correo.",
      }}
      onAsuntoChange={setAsunto}
      onClose={onClose}
      onMensajeChange={setMensaje}
      onSendCopyChange={setEnviarCopia}
      onSubmit={submit}
      open={open}
      previewContent={(
        <DocumentEmailPreview
          address={preview.address}
          brand={preview.brand}
          contact={preview.contact}
          documentTitle="Orden de compra"
          from={preview.from}
          message={preview.message}
          note="El detalle completo se encuentra en el PDF adjunto."
          replyTo={describePurchaseOrderReplyTo(preview)}
          subject={preview.subject}
          summaryRows={preview.summaryRows}
          to={preview.to}
        />
      )}
      processing={processing}
      recipient={{
        defaultValue: savedEmail,
        error: email && !validEmail ? "Ingresa un solo correo válido." : "",
        onChange: setEmail,
        value: email,
      }}
      replyTo={describePurchaseOrderReplyTo(preview)}
      replyToWarning="Tu empresa no tiene un correo configurado: el proveedor no podrá responder a tu correo."
      resetKey={order?.id}
      savedEmailLabel="Volver al correo del proveedor"
      sendCopy={enviarCopia}
      simulationText="No se enviará un correo real. La orden quedará pendiente de envío."
      submitLabel="Enviar por correo"
      submittingLabel="Enviando..."
      summaryRows={[
        {label: "Orden de compra", value: orderNumber},
        {label: "Proveedor", value: providerName},
        {label: "Total", value: formatMoney(order?.total || 0, order?.moneda || "CLP", order?.locale || "es-CL")},
      ]}
    />
  );
}
