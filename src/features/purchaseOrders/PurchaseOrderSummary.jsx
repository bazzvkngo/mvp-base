import React from "react";
import Button from "../../components/ui/Button";
import {formatMoney} from "../../utils/formatters";

// Resumen de la orden de compra (borrador). Mismo aspecto que el resumen de Compra y de Venta: título "Resumen", total
// destacado y botón principal alto. Los textos de los botones, los importes y el manejador son los de siempre.
export default function PurchaseOrderSummary({currency, disabled, isNew, locale, onSave, saving, taxName = "IVA", taxRate = 19, totals}) {
  const money = (value) => formatMoney(value, currency, locale);
  const discountMoney = (value) => Number(value) > 0 ? `-${money(value)}` : money(0);
  return (
    <aside className="po-panel po-summary purchase-summary">
      <header className="po-summary__header"><h2>Resumen</h2></header>
      <div className="po-summary__amounts">
        <div><span>Subtotal</span><strong>{money(totals.subtotal)}</strong></div>
        <div><span>Descuentos</span><strong>{discountMoney(totals.descuentoTotal)}</strong></div>
        <div><span>Neto</span><strong>{money(totals.neto)}</strong></div>
        <div><span>{taxName} {taxRate}%</span><strong>{money(totals.iva)}</strong></div>
        <div className="po-summary__total"><span>Total</span><strong>{money(totals.total)}</strong></div>
      </div>
      {!disabled && (
        <div className="po-summary__actions">
          <Button type="button" className="purchase-summary__primary" disabled={saving} onClick={onSave}>{saving ? "Guardando..." : isNew ? "Crear orden de compra" : "Guardar cambios"}</Button>
        </div>
      )}
    </aside>
  );
}
