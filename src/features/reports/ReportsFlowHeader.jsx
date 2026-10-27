import React from "react";
import {TriangleAlert} from "lucide-react";
import {describeFlowSummary} from "../../domain/reportFlowOverview.mjs";
import useBusinessFormat from "../../hooks/useBusinessFormat";
import {formatMoney} from "../../utils/formatters";

// Cabecera grande de las pestañas Ventas y Compras (SPEC 025): "Vendí" / "Compré"
// con el total sin IVA y cuántas operaciones lo forman. Una por moneda. El total y
// el conteo llegan ya calculados (reportModel); este componente solo los presenta.
//
// `kind`: "sales" | "purchases". `note` es el subtítulo de la derecha (en Compras,
// "Las compras muestran egresos registrados del negocio."). Si hay documentos sin
// neto válido, una línea lo avisa: aportan 0 al total.
function ReportsFlowHeader({count, currency, kind = "sales", note = "", showCurrency = false, total, withoutNetCount = 0}) {
  const {locale} = useBusinessFormat();
  const summary = describeFlowSummary({kind, count, withoutNetCount});
  return <section className={`erp-card reports-flow-header reports-flow-header--${kind}`}>
    <div className="reports-flow-header__main">
      <div className="reports-flow-header__label">
        <h2 className="reports-flow-header__title">{summary.title}</h2>
        {showCurrency && <span className="reports-flow-header__currency">{currency}</span>}
      </div>
      <strong className="reports-flow-header__amount">{formatMoney(total, currency, locale)}</strong>
      <span className="reports-flow-header__caption">{summary.caption}</span>
    </div>
    {note && <p className="reports-flow-header__note">{note}</p>}
    {summary.withoutNetText && <p className="reports-flow-header__warning"><TriangleAlert size={14} aria-hidden="true" /><span>{summary.withoutNetText}</span></p>}
  </section>;
}

export default ReportsFlowHeader;
