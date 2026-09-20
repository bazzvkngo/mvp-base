import React from "react";
import {RefreshCw} from "lucide-react";
import Button from "../../../components/ui/Button";
import LoadingState from "../../../components/ui/LoadingState";
import {formatMoney} from "../../../utils/formatters";

// Vista dedicada a Inventario. La consulta del catálogo completo se dispara
// una sola vez, sólo al entrar en esta vista (ver ReportsPage), para no pagar
// el costo de esa lectura en cada carga de /reportes. Sólo se muestran
// métricas ya respaldadas por el Core (getInventoryMetrics / top-valor /
// distribución por categoría): ningún indicador de velocidad de salida ni
// estimación a futuro que el modelo actual no soporte.
function ReportsInventarioView({categories, error, metrics, onRetry, status, topValue}) {
  if (status === "no_permission") {
    return <div className="erp-card reports-simple-state">Tu perfil no incluye acceso a Inventario.</div>;
  }
  if (status === "loading" || status === "idle") {
    return <LoadingState variant="section" label="Cargando inventario..." />;
  }
  if (status === "error") {
    return <div className="erp-card reports-simple-state reports-simple-state--error" role="alert">
      <span>{error || "No fue posible cargar el inventario."}</span>
      <Button variant="secondary" onClick={onRetry}><RefreshCw size={16} /> Reintentar</Button>
    </div>;
  }

  const hasValue = metrics.byCurrency.length > 0;

  return <>
    <div className="reports-simple-currencies">
      <section className="reports-simple-currency-group">
        <div className="reports-simple-metrics reports-simple-metrics--3col">
          <article className="reports-simple-card"><div className="reports-simple-card__top"><span className="reports-simple-card__title">Productos activos</span></div><strong className="reports-simple-card__amount">{metrics.activeCount}</strong><small>Ítems tipo producto, estado activo</small></article>
          <article className="reports-simple-card"><div className="reports-simple-card__top"><span className="reports-simple-card__title">Con stock bajo</span></div><strong className="reports-simple-card__amount">{metrics.lowStockCount}</strong><small>Stock igual o menor al mínimo definido</small></article>
          <article className="reports-simple-card"><div className="reports-simple-card__top"><span className="reports-simple-card__title">Cobertura de costo</span></div><strong className="reports-simple-card__amount">{Math.round(metrics.coverage)}%</strong><small>Productos con costo válido para valorizar</small></article>
        </div>
      </section>
      {hasValue && metrics.byCurrency.map((group) => (
        <section className="reports-simple-currency-group" key={group.currency}>
          <h2>{group.currency}</h2>
          <div className="reports-simple-metrics reports-simple-metrics--3col">
            <article className="reports-simple-card reports-simple-card--result"><div className="reports-simple-card__top"><span className="reports-simple-card__title">Valor de inventario</span></div><strong className="reports-simple-card__amount">{formatMoney(group.total, group.currency)}</strong><small>Suma de costo × stock de productos con costo válido</small></article>
          </div>
        </section>
      ))}
    </div>
    {!hasValue && <p className="reports-empty-note">No hay productos con costo válido para valorizar el inventario en ninguna moneda.</p>}
    {metrics.coverage < 100 && metrics.activeCount > 0 && (
      <p className="reports-simple-project-note">Algunos productos activos no tienen costo o stock válido y no se incluyen en el valor de inventario.</p>
    )}

    <section className="erp-card reports-detail-section">
      <div className="reports-section-heading"><div><span>Detalle</span><h2>Productos con mayor valor</h2><p>Costo × stock de cada producto, agrupado por moneda.</p></div></div>
      {!topValue.length ? <p className="reports-empty-note">Sin productos con valor calculable.</p> : (
        <div className="reports-top-list-groups">{[...new Set(topValue.map((entry) => entry.currency))].map((currency) => (
          <article className="reports-top-list-group" key={currency}>
            <h4>{currency}</h4>
            <div className="reports-top-list-table-wrap"><table className="reports-top-list-table">
              <thead><tr><th>Producto</th><th>Categoría</th><th>Stock</th><th>Valor</th></tr></thead>
              <tbody>{topValue.filter((entry) => entry.currency === currency).map((entry) => <tr key={entry.id}>
                <td>{entry.nombre}</td><td>{entry.categoria}</td><td>{entry.stock}</td><td>{formatMoney(entry.value, currency)}</td>
              </tr>)}</tbody>
            </table></div>
          </article>
        ))}</div>
      )}
    </section>

    <section className="erp-card reports-detail-section">
      <div className="reports-section-heading"><div><span>Detalle</span><h2>Distribución por categoría</h2><p>Cantidad de productos y valor acumulado por categoría, agrupado por moneda.</p></div></div>
      {!categories.length ? <p className="reports-empty-note">Sin categorías con valor calculable.</p> : (
        <div className="reports-top-list-table-wrap"><table className="reports-top-list-table">
          <thead><tr><th>Categoría</th><th>Moneda</th><th>Productos</th><th>Valor</th></tr></thead>
          <tbody>{categories.map((entry) => <tr key={`${entry.currency}-${entry.categoria}`}>
            <td>{entry.categoria}</td><td>{entry.currency}</td><td>{entry.count}</td><td>{formatMoney(entry.value, entry.currency)}</td>
          </tr>)}</tbody>
        </table></div>
      )}
    </section>
  </>;
}

export default ReportsInventarioView;
