import React from "react";
import {formatMoney} from "../../utils/formatters";

export default function PurchaseOrderSummary({currency, disabled, isNew, locale, onSave, saving, taxName = "IVA", taxRate = 19, totals}) {
  const money = (value) => formatMoney(value, currency, locale);
  const discountMoney = (value) => Number(value) > 0 ? `-${money(value)}` : money(0);
  return (
    <aside className="po-panel po-summary">
      <header className="po-summary__header"><span className="po-kicker">Resumen</span><h2>Totales</h2></header>
      <div className="po-summary__amounts">
        <div><span>Subtotal</span><strong>{money(totals.subtotal)}</strong></div>
        <div><span>Descuentos</span><strong>{discountMoney(totals.descuentoTotal)}</strong></div>
        <div><span>Neto</span><strong>{money(totals.neto)}</strong></div>
        <div><span>{taxName} {taxRate}%</span><strong>{money(totals.iva)}</strong></div>
        <div className="po-summary__total"><span>Total</span><strong>{money(totals.total)}</strong></div>
      </div>
      {!disabled && (
        <div className="po-summary__actions">
          <button type="button" className="po-button po-button--primary" disabled={saving} onClick={onSave}>{saving ? "Guardando..." : isNew ? "Crear orden de compra" : "Guardar cambios"}</button>
        </div>
      )}
    </aside>
  );
}
