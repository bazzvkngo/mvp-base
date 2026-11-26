import React from "react";
import Button from "../../components/ui/Button";
import Notice from "../../components/ui/Notice";
import { formatMoney } from "../../utils/formatters";

// Resumen de la cotización (borrador). Mismo aspecto que el resumen de Compras y Ventas: título "Resumen", total
// destacado y botón principal alto. Lo propio de la cotización se conserva: el descuento global, los descuentos por línea,
// el subtotal neto y el motivo cuando el botón está deshabilitado ("Falta: cliente"). Los cálculos vienen de la página.
function SummaryRow({ label, strong, value }) {
  return <div className={strong ? "po-summary__total" : undefined}><span>{label}</span><strong>{value}</strong></div>;
}

function QuoteSummaryPanel({
  currency,
  locale,
  isEditMode,
  onDiscountChange,
  onSave,
  quote,
  saveBlocked,
  saveBlockedReason,
  saving,
  savingEstado,
  totals,
  totalsError,
  taxName,
  taxRate,
}) {
  const money = (value) => formatMoney(value, currency, locale);
  const creating = savingEstado === "borrador";
  return (
    <aside className="po-panel po-summary purchase-summary quote-summary no-print" aria-label="Resumen y acciones de la cotización">
      <header className="po-summary__header"><h2>Resumen</h2></header>
      <div className="po-summary__amounts">
        <SummaryRow label="Subtotal" value={money(totals.subtotal)} />
        <div className="quote-summary__discount">
          <label htmlFor="quote-global-discount">Descuento ({currency || "CLP"})</label>
          <input id="quote-global-discount" className="ui-doc-line__input" type="number" min="0" placeholder="0" value={quote.descuento} onChange={onDiscountChange} />
        </div>
        {totals.descuentoItems > 0 && <SummaryRow label="Descuentos por línea" value={`-${money(totals.descuentoItems)}`} />}
        <SummaryRow label="Subtotal neto" value={money(totals.neto)} />
        <SummaryRow label={quote.afectaIva === false ? `${taxName || "Impuesto"} (exenta)` : `${taxName || "IVA"} ${taxRate}%`} value={money(totals.iva)} />
        <SummaryRow label="Total" value={money(totals.total)} strong />
      </div>
      {totalsError && <Notice variant="error">{totalsError}</Notice>}
      <div className="po-summary__actions">
        <Button type="button" className="purchase-summary__primary" loading={creating} disabled={saving || saveBlocked} onClick={onSave} aria-describedby={saveBlockedReason ? "quote-save-blocked-reason" : undefined}>
          {creating ? (isEditMode ? "Guardando..." : "Creando...") : (isEditMode ? "Guardar cambios" : "Crear cotización")}
        </Button>
        {saveBlockedReason && <p id="quote-save-blocked-reason" className="quote-summary__hint quote-summary__hint--blocked">{saveBlockedReason}</p>}
        {!isEditMode && <p className="quote-summary__hint">El número se asignará al crear la cotización.</p>}
      </div>
    </aside>
  );
}

export default QuoteSummaryPanel;
