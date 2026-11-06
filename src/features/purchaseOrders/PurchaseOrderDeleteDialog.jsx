import React, {useEffect, useRef, useState} from "react";
import {sileo} from "sileo";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {
  DELETE_CONFIRMATION_WORD,
  getPurchaseOrderDeleteErrorMessage,
  isDeleteConfirmed,
} from "../../domain/purchaseOrderModel.mjs";
import {eliminarOrdenCompra} from "../../services/purchaseOrderService";
import "./purchase-order-delete.css";

// Diálogo de eliminación permanente de una orden de compra (SPEC 005, enmienda 2026-11-06).
// Lo comparten la página de detalle y la lista. Quien lo usa decide cuándo se abre y qué pasa
// después de eliminar (onDeleted); aquí viven la palabra «permanente», la guarda contra doble
// envío, el estado de carga y el mensaje de error. La autoridad es la Function eliminarOrdenCompra.
export default function PurchaseOrderDeleteDialog({businessId, onClose, onDeleted, open, order}) {
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const guard = useRef(false);

  // Cada vez que se abre, parte limpio (sin palabra, sin error de un intento anterior).
  useEffect(() => {
    if (!open) return;
    setConfirmation("");
    setError("");
    setDeleting(false);
  }, [open, order?.id]);

  const close = () => {
    if (deleting) return;
    onClose();
  };

  // Si el backend rechaza, se muestra su mensaje tal cual (o uno genérico si es un error técnico) y la orden queda intacta.
  const confirm = async () => {
    if (!order || guard.current || deleting || !isDeleteConfirmed(confirmation)) return;
    guard.current = true;
    setDeleting(true);
    setError("");
    try {
      await eliminarOrdenCompra(businessId, order.id, confirmation);
      sileo.success({
        title: `Orden ${order.numero} eliminada`,
        description: "Se eliminó para siempre. Su número no se vuelve a usar.",
      });
      onDeleted(order);
    } catch (failure) {
      setError(getPurchaseOrderDeleteErrorMessage(failure));
      setDeleting(false);
    } finally {
      guard.current = false;
    }
  };

  return (
    <ResponsiveDialog
      description={order ? `Vas a eliminar la orden ${order.numero}.` : ""}
      eyebrow="Orden de compra"
      footer={(
        <>
          <Button type="button" variant="secondary" disabled={deleting} onClick={close}>Volver</Button>
          <Button type="button" variant="danger" loading={deleting} disabled={!isDeleteConfirmed(confirmation)} onClick={confirm}>
            {deleting ? "Eliminando..." : "Eliminar permanentemente"}
          </Button>
        </>
      )}
      onClose={close}
      open={open && Boolean(order)}
      size="small"
      title="Eliminar orden de compra"
    >
      <div className="purchase-order-delete">
        <p className="purchase-order-delete__warning">Se eliminará la orden {order?.numero} con sus ítems e historial. No se puede deshacer.</p>
        <p className="purchase-order-delete__hint">El número no se reutiliza: quedará un hueco en la numeración.</p>
        <label className="erp-field purchase-order-delete__field">
          <span>Para confirmar, escribe <strong>{DELETE_CONFIRMATION_WORD}</strong></span>
          <input
            className="erp-control"
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={confirmation}
            disabled={deleting}
            onChange={(event) => setConfirmation(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                confirm();
              }
            }}
          />
        </label>
        {error && <div className="po-message po-message--error" role="alert">{error}</div>}
      </div>
    </ResponsiveDialog>
  );
}
