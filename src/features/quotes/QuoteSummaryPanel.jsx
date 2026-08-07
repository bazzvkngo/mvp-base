import React from "react";
import { formatCLP } from "../../utils/formatters";

function SummaryRow({ label, strong, value }) {
  return <div className={strong ? "quote-summary__row quote-summary__row--total" : "quote-summary__row"}><span>{label}</span><strong>{value}</strong></div>;
}

function QuoteSummaryPanel({
  emailDisabled,
  emailHint,
  onClear,
  onDiscountChange,
  onDownloadPdf,
  onOpenEmail,
  onPreview,
  onSaveDraft,
  onSaveIssued,
  pdfActionLoading,
  quote,
  saveBlockedByClient,
  saving,
  totals,
  totalsError,
}) {
  return (
    <aside className="quote-workspace__aside no-print" aria-label="Resumen y acciones de la cotización">
      <section className="quote-workspace__panel quote-summary">
        <header className="quote-summary__header">
          <div><span className="quote-workspace__kicker">Resumen</span><h2>Totales</h2></div>
          <span className={`quote-workspace__status quote-workspace__status--${quote.estado}`}>{quote.estado === "emitida" ? "Emitida" : "Borrador"}</span>
        </header>
        <div className="quote-summary__amounts">
          <SummaryRow label="Subtotal" value={formatCLP(totals.subtotal)} />
          <label className="quote-summary__discount"><span>Descuento (CLP)</span><input type="number" min="0" placeholder="0" value={quote.descuento} onChange={onDiscountChange} /></label>
          {totals.descuentoItems > 0 && <SummaryRow label="Descuentos por línea" value={`-${formatCLP(totals.descuentoItems)}`} />}
          <SummaryRow label="Subtotal neto" value={formatCLP(totals.neto)} />
          <SummaryRow label={quote.afectaIva === false ? "IVA (exenta)" : "IVA 19%"} value={formatCLP(totals.iva)} />
          <SummaryRow label="Total" value={formatCLP(totals.total)} strong />
        </div>
        {totalsError && <p className="quote-workspace__message quote-workspace__message--error">{totalsError}</p>}
        <div className="quote-summary__actions">
          <button type="button" className="quote-workspace__button quote-workspace__button--primary" onClick={onSaveDraft} disabled={saving || saveBlockedByClient}>{saving ? "Guardando…" : "Guardar borrador"}</button>
          <button type="button" className="quote-workspace__button quote-workspace__button--secondary" onClick={onPreview} disabled={saving}>Previsualizar</button>
          <button type="button" className="quote-workspace__button quote-workspace__button--issued" onClick={onSaveIssued} disabled={saving || saveBlockedByClient}>Guardar como emitida</button>
          <button type="button" className="quote-workspace__button quote-workspace__button--secondary" onClick={onDownloadPdf} disabled={saving || pdfActionLoading}>{pdfActionLoading ? "Generando PDF…" : "Generar PDF"}</button>
          <button type="button" className="quote-workspace__button quote-workspace__button--secondary" onClick={onOpenEmail} disabled={emailDisabled}>Enviar por correo</button>
          {emailHint && <small className="quote-summary__hint">{emailHint}</small>}
          <button type="button" className="quote-summary__clear" onClick={onClear}>Limpiar cotización</button>
        </div>
      </section>
    </aside>
  );
}

export default QuoteSummaryPanel;
