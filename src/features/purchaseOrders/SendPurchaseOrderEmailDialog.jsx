import React, {useEffect, useRef, useState} from "react";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {isValidPurchaseOrderEmail} from "../../services/purchaseOrderEmailService";

export default function SendPurchaseOrderEmailDialog({onClose, onSend, open, order, processing}) {
  const [email, setEmail] = useState("");
  const inputRef = useRef(null);
  useEffect(() => {
    if (open) setEmail(order?.proveedorSnapshot?.email || "");
  }, [open, order]);
  const valid = isValidPurchaseOrderEmail(email);
  const submit = (event) => {
    event.preventDefault();
    if (!processing && valid) onSend(email.trim());
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
        <label>Correo de destino<input ref={inputRef} type="email" value={email} maxLength={180} autoComplete="email" disabled={processing} onChange={(event) => setEmail(event.target.value)} placeholder="proveedor@empresa.cl" /></label>
        <p>Por defecto se usa el correo guardado en el snapshot del proveedor. Un correo alternativo se utiliza solo para este envío y no modifica su ficha.</p>
        {email && !valid && <p className="po-email-form__error">Ingresa exactamente un correo válido, sin CC ni BCC.</p>}
      </form>
    </ResponsiveDialog>
  );
}
