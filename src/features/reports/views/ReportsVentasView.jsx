import React from "react";
import {ArrowRight} from "lucide-react";
import Button from "../../../components/ui/Button";
import {countWithoutNet, describeProductBars} from "../../../domain/reportFlowOverview.mjs";
import {formatMoney} from "../../../utils/formatters";
import useBusinessFormat from "../../../hooks/useBusinessFormat";
import FoldedEntityTable from "../FoldedEntityTable";
import FoldedTimeline from "../FoldedTimeline";
import LimitedOperationsTable from "../LimitedOperationsTable";
import ReportsFlowHeader from "../ReportsFlowHeader";
import ReportsShareBars from "../ReportsShareBars";

// Segunda línea de cada fila de las barras: la cantidad con su unidad y, si no es un
// producto, de qué tipo es (servicio, actividad): el tipo va en texto, no en el color.
function productSubtitle(row) {
  const kind = row.tipoItem && row.tipoItem !== "producto" ? row.tipoItem : "";
  return [row.quantityText, kind].filter(Boolean).join(" · ");
}

// Vista dedicada a Ventas (SPEC 025, visual): la cabecera "Vendí" por moneda, de dónde
// vienen las ventas (barras por producto sobre el ranking que ya llega), las últimas
// ventas y, plegados, los principales clientes y la evolución. Reutiliza exactamente
// los datos ya calculados por el contenedor (summary.sales, salesTimeline,
// topSalesClients/Products). El margen comercial vive en Ganancia (SPEC 022 §6.4). No
// recalcula ni redefine ninguna fórmula económica.
function ReportsVentasView({canOpenSales, fallbackCurrency = "CLP", navigate, salesTimeline, summary, topSalesClients, topSalesProducts}) {
  const { locale: businessLocale } = useBusinessFormat();
  // Solo las ventas confirmadas del período (summary.sales.confirmed), no todas las
  // cargadas: de ahí salen los porcentajes de las barras y el tipo y la unidad de cada línea.
  const confirmed = summary.sales.confirmed;
  const hasSales = confirmed.length > 0;
  const showCurrency = summary.currencies.length > 1;
  return <>
    {summary.currencies.map((group) => {
      const bars = describeProductBars({
        currency: group.currency, documents: confirmed, fallbackCurrency, locale: businessLocale,
        entries: topSalesProducts.find((entry) => entry.currency === group.currency)?.entries || [],
      });
      return <React.Fragment key={group.currency}>
        <ReportsFlowHeader count={group.sales.count} currency={group.currency} kind="sales" showCurrency={showCurrency} total={group.sales.total} withoutNetCount={countWithoutNet(confirmed, {currency: group.currency, fallbackCurrency})} />
        <ReportsShareBars bars={bars} currency={group.currency} kind="sales" note={bars.hasGeneralDiscount ? "Los montos por producto van antes del descuento general de la venta." : ""} othersLabel="Otros productos" showCurrency={showCurrency} subtitle={productSubtitle} title="¿De dónde vienen mis ventas?" />
      </React.Fragment>;
    })}

    {/* Único mensaje de vacío de la pestaña: los $0 de la cabecera no se repiten en otras secciones. */}
    {!hasSales && <div className="erp-card reports-simple-state"><span>Aún no hay ventas confirmadas en este período.</span>{canOpenSales && <Button type="button" variant="secondary" onClick={() => navigate("/ventas")}>Ir a Ventas<ArrowRight size={14} /></Button>}</div>}

    <LimitedOperationsTable
      columns={["Número", "Fecha", "Cliente", "Moneda", "Neto", "Total"]}
      dateField="fechaVenta"
      noun={{singular: "venta", plural: "ventas"}}
      onOpen={canOpenSales ? () => navigate("/ventas") : null}
      openLabel="Ir a Ventas"
      renderRow={(sale) => <tr key={sale.id || sale.ventaId || sale.numero}>
        <td>{sale.numero || "Venta"}</td>
        <td>{String(sale.fechaVenta || "").slice(0, 10)}</td>
        <td>{sale.clienteSnapshot?.nombreRazonSocial || "Cliente histórico"}</td>
        <td>{sale.moneda || sale.monedaCodigo || "CLP"}</td>
        <td>{Number.isFinite(sale.neto) ? formatMoney(sale.neto, sale.moneda || sale.monedaCodigo || "CLP", businessLocale) : "—"}</td>
        <td>{formatMoney(sale.total, sale.moneda || sale.monedaCodigo || "CLP", businessLocale)}</td>
      </tr>}
      rows={confirmed}
      title="Últimas ventas"
    />

    {hasSales && summary.currencies.map((group) => <React.Fragment key={group.currency}>
      <FoldedEntityTable
        columns={["Cliente", "Ventas", "Monto"]}
        currency={group.currency}
        groups={topSalesClients}
        label={`Ver los principales clientes${showCurrency ? ` en ${group.currency}` : ""}`}
        renderRow={(entry) => <tr key={entry.id}><td>{entry.name}</td><td>{entry.count}</td><td>{formatMoney(entry.total, group.currency, businessLocale)}</td></tr>}
      />
      <FoldedTimeline currency={group.currency} items={salesTimeline} showCurrency={showCurrency} />
    </React.Fragment>)}
  </>;
}

export default ReportsVentasView;
