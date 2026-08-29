import React, {useEffect, useRef, useState} from "react";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {resolveDocumentCompany} from "../../domain/companySnapshot.mjs";
import {formatMoney} from "../../utils/formatters";
import {isValidPurchaseOrderEmail, isValidPurchaseOrderEmailMessage, isValidPurchaseOrderEmailSubject} from "../../services/purchaseOrderEmailService";

function buildInitialEmail({companyProfile = {}, order = {}}) {
  const company = resolveDocumentCompany(order, companyProfile);
  const companyName = company.nombreComercial || company.razonSocial || "Empresa compradora";
  const providerName = order.proveedorSnapshot?.razonSocial || "Proveedor";
  const responseInstruction = isValidPurchaseOrderEmail(company.email)
    ? "Por favor, responde este correo para confirmar la recepción de la orden o indicar cualquier observación."
    : "Por favor, confirma la recepción de la orden por el canal habitual o indica cualquier observación.";
  return {
    asunto: `Orden de compra ${order.numero || ""} | ${companyName}`.trim(),
    mensaje: `Estimado/a ${providerName}:\n\nAdjuntamos la orden de compra ${order.numero || ""} para su revisión.\n\n${responseInstruction}\n\nSaludos,\n${companyName}`,
  };
}

export default function SendPurchaseOrderEmailDialog({companyProfile, onClose, onSend, open, order, processing}) {
  const [email, setEmail] = useState("");
  const [asunto, setAsunto] = useState("");
  const [mensaje, setMensaje] = useState("");
  const inputRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const initial = buildInitialEmail({companyProfile, order});
    setEmail(order?.proveedorSnapshot?.email || "");
    setAsunto(initial.asunto);
    setMensaje(initial.mensaje);
  }, [companyProfile, open, order]);
  const validEmail = isValidPurchaseOrderEmail(email);
  const validSubject = isValidPurchaseOrderEmailSubject(asunto);
  const validMessage = isValidPurchaseOrderEmailMessage(mensaje);
  const valid = validEmail && validSubject && validMessage;
  const submit = (event) => {
    event.preventDefault();
    if (!processing && valid) onSend({emailProveedor: email.trim(), asunto: asunto.trim(), mensaje: mensaje.trim()});
  };
  const footer = (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={onClose}
        disabled={processing}
      >
        Cancelar
      </Button>
      <Button
        type="submit"
        form="send-purchase-order-email-form"
        disabled={processing || !valid}
      >
        {processing ? "Enviando..." : "Enviar por correo"}
      </Button>
    </>
  );
  return (
    <ResponsiveDialog
      className="quote-email-dialog"
      open={open}
      onClose={() => !processing && onClose()}
      initialFocusRef={inputRef}
      eyebrow="Emisión al proveedor"
      title={`Enviar ${order?.numero || "orden de compra"} por correo`}
      description="Se adjuntará el PDF profesional. La orden solo quedará emitida si el proveedor de correo confirma el envío."
      size="medium"
      footer={footer}
    >
      <form id="send-purchase-order-email-form" className="po-email-form" onSubmit={submit}>
        <label>Destinatario<input ref={inputRef} type="email" value={email} maxLength={180} autoComplete="email" disabled={processing} onChange={(event) => setEmail(event.target.value)} placeholder="proveedor@empresa.cl" /></label>
        <p>Por defecto se usa el correo guardado en el snapshot del proveedor. Un correo alternativo se utiliza solo para este envío y no modifica su ficha.</p>
        {email && !validEmail && <p className="po-email-form__error">Ingresa exactamente un correo válido, sin CC ni BCC.</p>}
        <label>Asunto<input type="text" value={asunto} maxLength={180} disabled={processing} onChange={(event) => setAsunto(event.target.value)} /></label>
        {!validSubject && <p className="po-email-form__error">Ingresa un asunto de hasta 180 caracteres y sin saltos de línea.</p>}
        <label>Mensaje<textarea value={mensaje} maxLength={2000} rows="6" disabled={processing} onChange={(event) => setMensaje(event.target.value)} /></label>
        {!validMessage && <p className="po-email-form__error">Ingresa un mensaje de hasta 2000 caracteres.</p>}
        <section className="po-email-summary" aria-label="Resumen de la orden">
          <div><span>Documento</span><strong>{order?.numero || "Orden de compra"}</strong></div>
          <div><span>Proveedor</span><strong>{order?.proveedorSnapshot?.razonSocial || "Proveedor"}</strong></div>
          <div><span>Total</span><strong>{formatMoney(order?.total || 0, order?.moneda || "CLP", order?.locale || "es-CL")}</strong></div>
        </section>
        <p className="po-email-attachment-note"><strong>Adjunto:</strong> se incluirá el PDF de la orden de compra.</p>
      </form>
    </ResponsiveDialog>
  );
}
