import React from "react";
import {Ellipsis} from "lucide-react";
import AppIcon from "../../components/ui/AppIcon";
import {formatMoney} from "../../utils/formatters";

export default function SaleSummaryPanel({
  currency,
  disabled,
  hasInsufficientStock = false,
  locale,
  onCancel,
  onConfirm,
  onSave,
  processing,
  totals,
  taxName = "IVA",
  taxRate = 19,
}) {
  const money = (value) => formatMoney(value, currency, locale);
  return (
    <aside className="po-panel po-summary sale-summary">
      <header className="po-summary__header">
        <span className="po-kicker">Resumen</span>
        <h2>Totales</h2>
      </header>
      <div className="po-summary__amounts">
        <div><span>Subtotal</span><strong>{money(totals.subtotal)}</strong></div>
        <div><span>Descuentos</span><strong>{Number(totals.descuentoTotal) > 0 ? `-${money(totals.descuentoTotal)}` : money(0)}</strong></div>
        <div><span>Neto</span><strong>{money(totals.neto)}</strong></div>
        <div><span>{totals.afectaIva ? `${taxName} ${taxRate}%` : `${taxName} · Exenta`}</span><strong>{money(totals.iva)}</strong></div>
        <div className="po-summary__total"><span>Total</span><strong>{money(totals.total)}</strong></div>
      </div>
      {!disabled && (
        <div className="po-summary__actions">
          {hasInsufficientStock && (
            <p className="sale-confirm-blocked" role="alert">
              No puedes confirmar esta venta porque uno o más productos no tienen stock suficiente.
            </p>
          )}
          <button
            type="button"
            className="po-button po-button--primary sale-confirm-button"
            disabled={processing || hasInsufficientStock}
            onClick={onConfirm}
          >
            Confirmar venta
          </button>
          <button type="button" className="po-button po-button--secondary" disabled={processing} onClick={onSave}>
            Guardar cambios
          </button>
          <p className="sale-action-help">
            Al confirmar se registrará la venta y se descontará el stock de los productos correspondientes.
          </p>
          {onCancel && (
            <details className="sale-more-actions">
              <summary><span>Más acciones</span><AppIcon icon={Ellipsis} size={17} /></summary>
              <button type="button" disabled={processing} onClick={onCancel}>Cancelar venta</button>
            </details>
          )}
        </div>
      )}
    </aside>
  );
}
