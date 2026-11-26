import React from "react";
import Button from "../../components/ui/Button";
import {formatMoney} from "../../utils/formatters";

// Resumen de la compra (borrador). Mismo aspecto que el resumen del editor de Venta: título "Resumen", total destacado,
// botón principal alto y "Guardar cambios" como enlace. Los textos, los estados y los manejadores son los de siempre.
export default function PurchaseSummaryPanel({currency, disabled, isNew, locale, onCancel, onConfirm, onSave, processing, taxName = "IVA", taxRate = 19, totals}) {
  const money = (value) => formatMoney(value, currency, locale);
  const discounts = Number(totals.descuentoTotal || 0);
  return (
    <aside className="po-panel po-summary purchase-summary">
      <header className="po-summary__header"><h2>Resumen</h2></header>
      <div className="po-summary__amounts">
        <div><span>Subtotal</span><strong>{money(totals.subtotal)}</strong></div>
        <div><span>Descuentos</span><strong>{discounts > 0 ? `-${money(discounts)}` : money(0)}</strong></div>
        <div><span>Neto</span><strong>{money(totals.neto)}</strong></div>
        <div><span>{taxName} {taxRate}%</span><strong>{money(totals.iva)}</strong></div>
        <div className="po-summary__total"><span>Total</span><strong>{money(totals.total)}</strong></div>
      </div>
      {!disabled && (
        <div className="po-summary__actions">
          <Button type="button" className="purchase-summary__primary" disabled={processing} onClick={isNew ? onSave : onConfirm}>{processing ? "Procesando..." : isNew ? "Preparar compra" : "Confirmar compra"}</Button>
          {!isNew && <Button type="button" variant="ghost" className="purchase-summary__save" disabled={processing} onClick={onSave}>Guardar cambios</Button>}
          {onCancel && <div className="po-summary__danger"><Button type="button" variant="ghost-danger" disabled={processing} onClick={onCancel}>Cancelar compra</Button></div>}
        </div>
      )}
    </aside>
  );
}
