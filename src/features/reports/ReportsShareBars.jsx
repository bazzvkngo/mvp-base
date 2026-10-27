import React from "react";
import useBusinessFormat from "../../hooks/useBusinessFormat";
import {formatMoney} from "../../utils/formatters";

// Barras de porcentaje de Ventas ("¿De dónde vienen mis ventas?") y de Compras
// ("¿A quién le compré?"): una fila por producto o proveedor, con su barra de un solo
// color, su importe y su porcentaje. Solo CSS y tokens, sin librería de gráficos.
// Los números llegan calculados (buildShareBars / describeProductBars); este
// componente solo los presenta. La barra es decorativa (aria-hidden): el nombre, el
// importe y el porcentaje de cada fila dicen lo mismo en texto, y lo que distingue a
// un servicio de un producto también va en texto, no en el color.
//
// `bars`: resultado de buildShareBars; `subtitle(row)`: segunda línea de la fila;
// `othersLabel`: nombre de la fila "otros"; `note`: línea al pie (p. ej. el aviso del
// descuento general). Sin barras que mostrar no dibuja nada: el vacío lo dice la pestaña.
function ReportsShareBars({bars, currency, kind = "sales", note = "", othersLabel = "Otros", showCurrency = false, subtitle = () => "", title}) {
  const {locale} = useBusinessFormat();
  if (!bars?.show || !bars.rows.length) return null;
  const rows = bars.others ? [...bars.rows, {id: "__otros__", name: othersLabel, amount: bars.others.amount, shareText: bars.others.shareText, fraction: bars.others.fraction, others: true, sub: bars.others.count ? `${bars.others.count} más` : ""}] : bars.rows;
  return <section className={`erp-card reports-share-bars reports-share-bars--${kind}`}>
    <div className="reports-share-bars__heading">
      <h2>{title}</h2>
      {showCurrency && <span>{currency}</span>}
    </div>
    <ul className="reports-share-bars__list">
      {rows.map((row) => {
        const sub = row.others ? row.sub : subtitle(row);
        return <li className={row.others ? "reports-share-bars__row reports-share-bars__row--others" : "reports-share-bars__row"} key={row.id}>
          <div className="reports-share-bars__name">
            <strong>{row.name}</strong>
            {sub && <small>{sub}</small>}
          </div>
          <div className="reports-share-bars__track" aria-hidden="true"><span className="reports-share-bars__fill" style={{width: `${row.fraction * 100}%`}} /></div>
          <div className="reports-share-bars__value">
            <strong>{formatMoney(row.amount, currency, locale)}</strong>
            <span>{row.shareText}</span>
          </div>
        </li>;
      })}
    </ul>
    {note && <p className="reports-share-bars__note">{note}</p>}
  </section>;
}

export default ReportsShareBars;
