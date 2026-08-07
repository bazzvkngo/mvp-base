import React, {useEffect, useMemo, useState} from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  Download,
  Landmark,
  ReceiptText,
  ShoppingCart,
  Truck,
  UsersRound,
  WalletCards,
} from "lucide-react";
import {useNavigate, useSearchParams} from "react-router-dom";
import DashboardDonutChart from "../components/DashboardDonutChart";
import {
  FinancialCategoryChart,
  FinancialStatusChart,
  FinancialTimelineChart,
} from "../components/finance/FinancialCharts";
import FinancialMetricCard from "../components/finance/FinancialMetricCard";
import FinancialPeriodSelector from "../components/finance/FinancialPeriodSelector";
import Button from "../components/ui/Button";
import {
  aggregateFinancialByCategory,
  aggregateFinancialTimeline,
  buildFinancialCsv,
  getFinancialPeriodRange,
  getSantiagoDateKey,
} from "../domain/financialMovement.mjs";
import {
  REPORT_TABS,
  aggregateOperationalTimeline,
  buildReportCsv,
  filterInventoryMovements,
  filterPurchases,
  filterQuotes,
  filterSales,
  getInventoryMetrics,
  getPurchaseMetrics,
  getQuoteMetrics,
  getSalesMetrics,
} from "../domain/reportModel.mjs";
import useFinancialMovements from "../hooks/useFinancialMovements";
import {loadReportData} from "../services/reportService";
import {formatCLP, formatDate, formatPercent} from "../utils/formatters";

const PERIOD_OPTIONS = [
  {id: "week", label: "Esta semana"},
  {id: "month", label: "Este mes"},
  {id: "three_months", label: "Últimos 3 meses"},
  {id: "six_months", label: "Últimos 6 meses"},
  {id: "year", label: "Este año"},
  {id: "custom", label: "Periodo personalizado"},
];
const VALID_PERIODS = new Set(PERIOD_OPTIONS.map((option) => option.id));
const TABS = [
  ["summary", "Resumen"],
  ["sales", "Ventas"],
  ["purchases", "Compras"],
  ["inventory", "Inventario"],
  ["quotes", "Cotizaciones"],
  ["finances", "Finanzas"],
];
const DOCUMENT_STATUS_OPTIONS = [
  ["todos", "Todos los estados"],
  ["borrador", "Borrador"],
  ["confirmada", "Confirmada"],
  ["cancelada", "Cancelada"],
];
const QUOTE_STATUS_OPTIONS = [
  ["todos", "Todos los estados"],
  ["borrador", "Borrador"],
  ["emitida", "Emitida"],
  ["aceptada", "Aceptada"],
  ["rechazada", "Rechazada"],
  ["vencida", "Vencida"],
  ["archivada", "Archivada"],
];
const QUOTE_CHART = [
  ["borrador", "Borrador", "#94a3b8"],
  ["emitida", "Emitida", "#38bdf8"],
  ["aceptada", "Aceptada", "#0f766e"],
  ["rechazada", "Rechazada", "#dc2626"],
  ["vencida", "Vencida", "#d97706"],
  ["archivada", "Archivada", "#64748b"],
];
const STATUS_LABELS = {
  borrador: "Borrador",
  confirmada: "Confirmada",
  cancelada: "Cancelada",
  emitida: "Emitida",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  vencida: "Vencida",
  archivada: "Archivada",
};

function downloadCsv(csv, filename) {
  const blob = new Blob([csv], {type: "text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function ReportMetricCard({icon, label, note, tone = "neutral", value}) {
  return (
    <article className={`financial-metric-card financial-metric-card--${tone}`}>
      <div className="financial-metric-card__heading">
        {icon && <span className="financial-metric-card__icon">{React.createElement(icon, {size: 19})}</span>}
        <span className="financial-metric-card__label">{label}</span>
      </div>
      <strong className="financial-metric-card__value">{value}</strong>
      {note && <span className="financial-metric-card__note">{note}</span>}
    </article>
  );
}

function Status({value}) {
  return <span className={`report-status report-status--${value}`}>{STATUS_LABELS[value] || value || "—"}</span>;
}

function ReportFilters({search, status, statusOptions, onSearch, onStatus, placeholder}) {
  return (
    <div className="erp-filters report-filters no-print">
      <label className="erp-field">
        <span className="erp-field__label">Buscar</span>
        <input className="erp-control" value={search} onChange={(event) => onSearch(event.target.value)} placeholder={placeholder} />
      </label>
      <label className="erp-field">
        <span className="erp-field__label">Estado</span>
        <select className="erp-control" value={status} onChange={(event) => onStatus(event.target.value)}>
          {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
    </div>
  );
}

function OperationalTimeline({items, emptyMessage}) {
  if (!items.length) return <div className="financial-chart-empty">{emptyMessage}</div>;
  const maximum = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="report-timeline" role="img" aria-label={items.map((item) => `${item.key}: ${formatCLP(item.value)}`).join(". ")}>
      {items.map((item) => (
        <div className="report-timeline__row" key={item.key}>
          <span>{item.key}</span>
          <div><i style={{width: `${Math.max((item.value / maximum) * 100, 3)}%`}} /></div>
          <strong>{formatCLP(item.value)}</strong>
          <small>{item.count} doc.</small>
        </div>
      ))}
    </div>
  );
}

function EmptyRow({columns, children}) {
  return <tr><td className="report-table-empty" colSpan={columns}>{children}</td></tr>;
}

function SalesReport({items, metrics, timeline, navigate, search, status, setParam}) {
  return (
    <div className="report-section-stack">
      <section className="financial-metric-grid report-four-metrics">
        <FinancialMetricCard icon={ShoppingCart} label="Total vendido" value={metrics.total} tone="income" note="Sólo ventas confirmadas" />
        <ReportMetricCard icon={ReceiptText} label="Ventas confirmadas" value={metrics.count.toLocaleString("es-CL")} note="Actividad real del periodo" />
        <FinancialMetricCard icon={Landmark} label="Ticket promedio" value={metrics.average} tone="net" note="Total confirmado ÷ cantidad" />
        <ReportMetricCard icon={UsersRound} label="Clientes distintos" value={metrics.distinctCustomers.toLocaleString("es-CL")} note="Asociados a ventas confirmadas" />
      </section>
      <section className="erp-panel financial-chart-panel">
        <div className="financial-chart-panel__header"><h2>Evolución de ventas confirmadas</h2><p>Según fecha comercial de la venta.</p></div>
        <OperationalTimeline items={timeline} emptyMessage="No hay ventas confirmadas en este periodo." />
      </section>
      <section className="erp-panel report-documents-panel">
        <div className="financial-chart-panel__header"><h2>Documentos del periodo</h2><p>Los filtros del listado no alteran las métricas confirmadas.</p></div>
        <ReportFilters search={search} status={status} statusOptions={DOCUMENT_STATUS_OPTIONS} placeholder="Número o cliente" onSearch={(value) => setParam("q", value)} onStatus={(value) => setParam("status", value === "todos" ? "" : value)} />
        <div className="erp-table-region report-table-region"><table className="erp-table report-table"><thead><tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Estado</th><th>Total</th><th>Detalle</th></tr></thead><tbody>
          {items.map((sale) => <tr key={sale.id}><td><strong>{sale.numero || "—"}</strong></td><td>{formatDate(sale.fechaVenta)}</td><td><strong>{sale.clienteSnapshot?.nombreRazonSocial || "Sin cliente"}</strong><small>{sale.clienteSnapshot?.rut || ""}</small></td><td><Status value={sale.estado} /></td><td>{formatCLP(sale.total)}</td><td><button className="report-detail-button" type="button" onClick={() => navigate(`/ventas/${sale.id}`)}>Ver</button></td></tr>)}
          {!items.length && <EmptyRow columns={6}>No hay ventas para estos filtros.</EmptyRow>}
        </tbody></table></div>
      </section>
    </div>
  );
}

function PurchasesReport({items, metrics, timeline, navigate, search, status, setParam}) {
  return (
    <div className="report-section-stack">
      <section className="financial-metric-grid report-four-metrics">
        <FinancialMetricCard icon={Truck} label="Total comprado" value={metrics.total} tone="expense" note="Sólo compras confirmadas" />
        <ReportMetricCard icon={ReceiptText} label="Compras confirmadas" value={metrics.count.toLocaleString("es-CL")} note="Actividad real del periodo" />
        <FinancialMetricCard icon={Landmark} label="Compra promedio" value={metrics.average} tone="net" note="Total confirmado ÷ cantidad" />
        <ReportMetricCard icon={UsersRound} label="Proveedores distintos" value={metrics.distinctProviders.toLocaleString("es-CL")} note="Asociados a compras confirmadas" />
      </section>
      <section className="erp-panel financial-chart-panel">
        <div className="financial-chart-panel__header"><h2>Evolución de compras confirmadas</h2><p>Según fecha comercial de la compra.</p></div>
        <OperationalTimeline items={timeline} emptyMessage="No hay compras confirmadas en este periodo." />
      </section>
      <section className="erp-panel report-documents-panel">
        <div className="financial-chart-panel__header"><h2>Documentos del periodo</h2><p>Los filtros del listado no alteran las métricas confirmadas.</p></div>
        <ReportFilters search={search} status={status} statusOptions={DOCUMENT_STATUS_OPTIONS} placeholder="Número o proveedor" onSearch={(value) => setParam("q", value)} onStatus={(value) => setParam("status", value === "todos" ? "" : value)} />
        <div className="erp-table-region report-table-region"><table className="erp-table report-table"><thead><tr><th>Número</th><th>Fecha</th><th>Proveedor</th><th>Estado</th><th>Total</th><th>Detalle</th></tr></thead><tbody>
          {items.map((purchase) => <tr key={purchase.id}><td><strong>{purchase.numero || "—"}</strong></td><td>{formatDate(purchase.fechaCompra)}</td><td><strong>{purchase.proveedorSnapshot?.razonSocial || "Sin proveedor"}</strong><small>{purchase.proveedorSnapshot?.rut || ""}</small></td><td><Status value={purchase.estado} /></td><td>{formatCLP(purchase.total)}</td><td><button className="report-detail-button" type="button" onClick={() => navigate(`/compras/${purchase.id}`)}>Ver</button></td></tr>)}
          {!items.length && <EmptyRow columns={6}>No hay compras para estos filtros.</EmptyRow>}
        </tbody></table></div>
      </section>
    </div>
  );
}

function StatisticsPage({businessId}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const today = getSantiagoDateKey();
  const period = VALID_PERIODS.has(searchParams.get("period")) ? searchParams.get("period") : "month";
  const defaultRange = getFinancialPeriodRange("month", {}, today);
  const customStart = searchParams.get("from") || defaultRange.start;
  const customEnd = searchParams.get("to") || defaultRange.end;
  const activeTab = REPORT_TABS.includes(searchParams.get("tab")) ? searchParams.get("tab") : "summary";
  const status = searchParams.get("status") || "todos";
  const search = searchParams.get("q") || "";
  const movementType = searchParams.get("movement") || "todos";
  const range = useMemo(() => getFinancialPeriodRange(period, {start: customStart, end: customEnd}, today), [customEnd, customStart, period, today]);
  const financial = useFinancialMovements(businessId, range);
  const [reportState, setReportState] = useState({data: {sales: [], purchases: [], quotes: [], inventory: [], inventoryMovements: []}, loading: true, error: ""});
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    let active = true;
    setReportState((current) => ({...current, loading: true, error: ""}));
    loadReportData(businessId)
      .then((data) => active && setReportState({data, loading: false, error: ""}))
      .catch((error) => active && setReportState((current) => ({...current, loading: false, error: error?.message || "No pudimos cargar los datos de Reportes."})));
    return () => { active = false; };
  }, [businessId]);

  const setParam = (name, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    setSearchParams(next, {replace: true});
    setFeedback("");
  };
  const selectTab = (tab) => {
    const next = new URLSearchParams(searchParams);
    if (tab === "summary") next.delete("tab");
    else next.set("tab", tab);
    next.delete("status");
    next.delete("q");
    next.delete("movement");
    setSearchParams(next, {replace: true});
    setFeedback("");
  };

  const {sales, purchases, quotes, inventory, inventoryMovements} = reportState.data;
  const salesMetrics = useMemo(() => getSalesMetrics(sales, range), [range, sales]);
  const purchaseMetrics = useMemo(() => getPurchaseMetrics(purchases, range), [purchases, range]);
  const quoteMetrics = useMemo(() => getQuoteMetrics(quotes, range), [quotes, range]);
  const inventoryMetrics = useMemo(() => getInventoryMetrics(inventory), [inventory]);
  const filteredSales = useMemo(() => filterSales(sales, {range, status, search}), [range, sales, search, status]);
  const filteredPurchases = useMemo(() => filterPurchases(purchases, {range, status, search}), [purchases, range, search, status]);
  const filteredQuotes = useMemo(() => filterQuotes(quotes, {range, status, search}), [quotes, range, search, status]);
  const filteredMovements = useMemo(() => filterInventoryMovements(inventoryMovements, {range, type: movementType}), [inventoryMovements, movementType, range]);
  const salesTimeline = useMemo(() => aggregateOperationalTimeline(salesMetrics.confirmed, {range, dateField: "fechaVenta"}), [range, salesMetrics.confirmed]);
  const purchaseTimeline = useMemo(() => aggregateOperationalTimeline(purchaseMetrics.confirmed, {range, dateField: "fechaCompra"}), [purchaseMetrics.confirmed, range]);
  const financialTimeline = useMemo(() => aggregateFinancialTimeline(financial.items, range), [financial.items, range]);
  const paidFinancial = useMemo(() => financial.items.filter((movement) => movement.status === "paid"), [financial.items]);
  const incomeCategories = useMemo(() => aggregateFinancialByCategory(paidFinancial, "income"), [paidFinancial]);
  const expenseCategories = useMemo(() => aggregateFinancialByCategory(paidFinancial, "expense"), [paidFinancial]);
  const quoteChartItems = QUOTE_CHART.map(([id, label, color]) => ({label, color, value: quoteMetrics.counts[id]}));

  const exportActive = () => {
    const shared = {sales: salesMetrics, purchases: purchaseMetrics, quotes: quoteMetrics, inventory: inventoryMetrics, financial: financial.summary};
    const csv = activeTab === "finances"
      ? buildFinancialCsv(financial.items)
      : buildReportCsv(activeTab, {...shared, items: activeTab === "sales" ? filteredSales : activeTab === "purchases" ? filteredPurchases : activeTab === "inventory" ? filteredMovements : filteredQuotes});
    downloadCsv(csv, `valoracloud-reporte-${activeTab}-${businessId}-${range.start}-${range.end}.csv`);
    setFeedback("CSV generado con los datos visibles de la pestaña activa.");
  };

  return (
    <section className="erp-page statistics-page reports-page">
      <div className="financial-page-heading">
        <div className="erp-page-intro"><p>Información operacional consolidada del negocio activo. Reportes no reemplaza la contabilidad formal.</p></div>
        <div className="financial-page-actions no-print"><Button variant="secondary" icon={Download} onClick={exportActive} disabled={reportState.loading || (["summary", "finances"].includes(activeTab) && financial.loading)}>Exportar CSV</Button></div>
      </div>
      <div className="financial-period-bar">
        <FinancialPeriodSelector period={period} customStart={customStart} customEnd={customEnd} options={PERIOD_OPTIONS} onPeriodChange={(value) => setParam("period", value === "month" ? "" : value)} onCustomStartChange={(value) => setParam("from", value)} onCustomEndChange={(value) => setParam("to", value)} idPrefix="reports-period" />
        <span className="financial-period-bar__caption">{formatDate(range.start)} al {formatDate(range.end)} · America/Santiago</span>
      </div>
      <div className="financial-tabs statistics-tabs" role="tablist" aria-label="Secciones de Reportes">
        {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={activeTab === id} className={activeTab === id ? "financial-tab is-active" : "financial-tab"} onClick={() => selectTab(id)}>{label}</button>)}
      </div>
      {feedback && <div className="financial-feedback" role="status">{feedback}</div>}
      {reportState.error && <div className="financial-feedback financial-feedback--error" role="alert">{reportState.error}</div>}
      {(activeTab === "summary" || activeTab === "finances") && financial.error && <div className="financial-feedback financial-feedback--error" role="alert">{financial.error}</div>}
      {reportState.loading && <div className="financial-inline-loading" role="status">Cargando información operacional del negocio activo...</div>}
      {!reportState.loading && !reportState.error && activeTab === "summary" && financial.loading && <div className="financial-inline-loading" role="status">Cargando resumen financiero registrado...</div>}

      {!reportState.loading && !reportState.error && !financial.loading && activeTab === "summary" && (
        <div className="report-section-stack">
          <section className="financial-metric-grid report-summary-metrics">
            <FinancialMetricCard icon={ShoppingCart} label="Total vendido" value={salesMetrics.total} tone="income" note={`${salesMetrics.count} ventas confirmadas`} />
            <FinancialMetricCard icon={Truck} label="Total comprado" value={purchaseMetrics.total} tone="expense" note={`${purchaseMetrics.count} compras confirmadas`} />
            <ReportMetricCard icon={ReceiptText} label="Cotizaciones" value={quoteMetrics.count.toLocaleString("es-CL")} note={`${quoteMetrics.counts.aceptada} aceptadas · ${quoteMetrics.conversion === null ? "sin base" : formatPercent(quoteMetrics.conversion)}`} />
            <ReportMetricCard icon={Boxes} label="Productos activos" value={inventoryMetrics.activeProducts.length.toLocaleString("es-CL")} note={`${inventoryMetrics.lowStockProducts.length} con stock bajo`} />
            <FinancialMetricCard icon={Landmark} label="Resultado financiero" value={financial.summary.netResult} tone={financial.summary.netResult < 0 ? "expense" : "net"} note="Movimientos financieros registrados" />
          </section>
          <div className="financial-data-note">Ventas y compras no alimentan Finanzas automáticamente. No se calcula utilidad, margen ni ganancia con estas cifras.</div>
          <div className="statistics-overview-grid">
            <section className="erp-panel statistics-compact-panel"><div><h2>Actividad comercial</h2><p>Documentos confirmados del periodo.</p></div><strong>{salesMetrics.count + purchaseMetrics.count}</strong><span>{salesMetrics.count} ventas · {purchaseMetrics.count} compras</span></section>
            <section className="erp-panel statistics-compact-panel"><div><h2>Conversión de cotizaciones</h2><p>Estado actual de cotizaciones fechadas en el periodo.</p></div><strong>{quoteMetrics.conversion === null ? "—" : formatPercent(quoteMetrics.conversion)}</strong><span>Aceptadas ÷ aceptadas + rechazadas</span></section>
          </div>
        </div>
      )}

      {!reportState.loading && !reportState.error && activeTab === "sales" && <SalesReport items={filteredSales} metrics={salesMetrics} timeline={salesTimeline} navigate={navigate} search={search} status={status} setParam={setParam} />}
      {!reportState.loading && !reportState.error && activeTab === "purchases" && <PurchasesReport items={filteredPurchases} metrics={purchaseMetrics} timeline={purchaseTimeline} navigate={navigate} search={search} status={status} setParam={setParam} />}

      {!reportState.loading && !reportState.error && activeTab === "inventory" && (
        <div className="report-section-stack">
          <div className="financial-data-note"><strong>Estado actual del inventario.</strong> El periodo sólo se aplica a los movimientos y no reconstruye stock histórico.</div>
          <section className="financial-metric-grid report-four-metrics">
            <ReportMetricCard icon={Boxes} label="Productos activos" value={inventoryMetrics.activeProducts.length.toLocaleString("es-CL")} note="No incluye servicios ni actividades" />
            <ReportMetricCard icon={Boxes} label="Stock bajo" value={inventoryMetrics.lowStockProducts.length.toLocaleString("es-CL")} tone="pending" note="Stock actual ≤ stock mínimo" />
            <ReportMetricCard icon={Landmark} label="Cobertura de costos" value={formatPercent(inventoryMetrics.coverage)} note={`${inventoryMetrics.coveredProducts.length} de ${inventoryMetrics.activeProducts.length} productos`} />
            <ReportMetricCard icon={Landmark} label="Valorización actual" value={inventoryMetrics.inventoryValue === null ? "No disponible" : formatCLP(inventoryMetrics.inventoryValue)} tone="net" note={inventoryMetrics.inventoryValue === null ? "Cobertura de costos incompleta" : "Costo base × stock actual"} />
          </section>
          {inventoryMetrics.inventoryValue === null && inventoryMetrics.activeProducts.length > 0 && <div className="financial-data-note">La valorización total no se considera suficientemente confiable porque existen productos sin costo mayor que cero o sin stock válido.</div>}
          <div className="statistics-overview-grid">
            <section className="erp-panel"><div className="financial-chart-panel__header"><h2>Productos con stock bajo</h2><p>Estado actual; se muestran hasta 10 productos.</p></div>{inventoryMetrics.lowStockProducts.length ? <div className="statistics-low-stock-list">{inventoryMetrics.lowStockProducts.slice(0, 10).map((item) => <div key={item.id}><strong>{item.nombre}</strong><span>Stock {Number(item.stock)} · Mínimo {Number(item.stockMinimo)}</span></div>)}</div> : <div className="report-empty-compact">No hay alertas de stock.</div>}</section>
            <section className="erp-panel report-documents-panel"><div className="financial-chart-panel__header"><h2>Últimos movimientos del periodo</h2><p>Entradas por compra y salidas por venta.</p></div><div className="erp-filters report-movement-filter no-print"><label className="erp-field"><span className="erp-field__label">Tipo de movimiento</span><select className="erp-control" value={movementType} onChange={(event) => setParam("movement", event.target.value === "todos" ? "" : event.target.value)}><option value="todos">Entradas y salidas</option><option value="entrada_compra">Entradas por compra</option><option value="salida_venta">Salidas por venta</option></select></label></div><div className="erp-table-region report-table-region"><table className="erp-table report-table report-movement-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Producto</th><th>Cantidad</th><th>Documento/origen</th></tr></thead><tbody>{filteredMovements.slice(0, 25).map((movement) => <tr key={movement.id}><td>{formatDate(movement.date)}</td><td><span className={`report-movement-type report-movement-type--${movement.type}`}>{movement.type === "entrada_compra" ? "Entrada" : "Salida"}</span></td><td><strong>{movement.productName}</strong></td><td>{movement.quantity.toLocaleString("es-CL")} {movement.unit}</td><td>{movement.sourceId ? <button className="report-detail-button" type="button" onClick={() => navigate(movement.type === "entrada_compra" ? `/compras/${movement.sourceId}` : `/ventas/${movement.sourceId}`)}>{movement.documentNumber || "Ver origen"}</button> : movement.documentNumber || "—"}</td></tr>)}{!filteredMovements.length && <EmptyRow columns={5}>No hay movimientos para estos filtros.</EmptyRow>}</tbody></table></div></section>
          </div>
        </div>
      )}

      {!reportState.loading && !reportState.error && activeTab === "quotes" && (
        <div className="report-section-stack">
          <div className="financial-data-note">Las cotizaciones no son ingresos. Los estados corresponden al estado actual de documentos fechados en el periodo, no a la fecha de la transición.</div>
          <section className="financial-metric-grid report-quote-metrics">
            <ReportMetricCard icon={ReceiptText} label="Cotizaciones" value={quoteMetrics.count.toLocaleString("es-CL")} note="Fechadas en el periodo" />
            <ReportMetricCard label="Emitidas" value={quoteMetrics.counts.emitida.toLocaleString("es-CL")} note={formatCLP(quoteMetrics.amounts.emitida)} />
            <ReportMetricCard label="Aceptadas" value={quoteMetrics.counts.aceptada.toLocaleString("es-CL")} tone="income" note={formatCLP(quoteMetrics.amounts.aceptada)} />
            <ReportMetricCard label="Rechazadas" value={quoteMetrics.counts.rechazada.toLocaleString("es-CL")} tone="expense" note={formatCLP(quoteMetrics.amounts.rechazada)} />
            <ReportMetricCard label="Vencidas" value={quoteMetrics.counts.vencida.toLocaleString("es-CL")} tone="pending" note={formatCLP(quoteMetrics.amounts.vencida)} />
            <ReportMetricCard label="Conversión" value={quoteMetrics.conversion === null ? "Sin base" : formatPercent(quoteMetrics.conversion)} note="Aceptadas ÷ aceptadas + rechazadas" />
          </section>
          <div className="statistics-module-grid"><section className="erp-panel"><div className="financial-chart-panel__header"><h2>Cotizaciones por estado actual</h2><p>Incluye todos los estados del periodo seleccionado.</p></div><DashboardDonutChart ariaLabel="Cotizaciones por estado actual" emptyMessage="Sin cotizaciones en el periodo" items={quoteChartItems} /><dl className="statistics-definition-list report-quote-amounts">{QUOTE_CHART.map(([id, label]) => <div key={id}><dt>Monto {label.toLocaleLowerCase("es-CL")}</dt><dd>{formatCLP(quoteMetrics.amounts[id])}</dd></div>)}</dl></section><section className="erp-panel report-documents-panel"><div className="financial-chart-panel__header"><h2>Documentos del periodo</h2><p>Montos cotizados; no representan ingresos.</p></div><ReportFilters search={search} status={status} statusOptions={QUOTE_STATUS_OPTIONS} placeholder="Número o cliente" onSearch={(value) => setParam("q", value)} onStatus={(value) => setParam("status", value === "todos" ? "" : value)} /><div className="erp-table-region report-table-region"><table className="erp-table report-table"><thead><tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Estado actual</th><th>Monto</th></tr></thead><tbody>{filteredQuotes.map((quote) => <tr key={quote.id}><td><strong>{quote.numero || "—"}</strong></td><td>{formatDate(quote.fecha)}</td><td><strong>{quote.clienteNombre || "Sin cliente"}</strong><small>{quote.clienteRut || ""}</small></td><td><Status value={quote.estado} /></td><td>{formatCLP(quote.total)}</td></tr>)}{!filteredQuotes.length && <EmptyRow columns={5}>No hay cotizaciones para estos filtros.</EmptyRow>}</tbody></table></div></section></div>
        </div>
      )}

      {activeTab === "finances" && (
        <div className="report-section-stack">
          <div className="financial-data-note"><strong>Movimientos financieros registrados.</strong> No representan automáticamente el total vendido ni comprado.</div>
          {financial.loading ? <div className="financial-inline-loading" role="status">Cargando movimientos financieros...</div> : <><section className="financial-metric-grid"><FinancialMetricCard icon={ArrowDownLeft} label="Ingresos pagados" value={financial.summary.paidIncome} tone="income" /><FinancialMetricCard icon={ArrowUpRight} label="Egresos pagados" value={financial.summary.paidExpense} tone="expense" /><FinancialMetricCard icon={Landmark} label="Resultado neto" value={financial.summary.netResult} tone={financial.summary.netResult < 0 ? "expense" : "net"} /><FinancialMetricCard icon={ReceiptText} label="Por cobrar" value={financial.summary.receivable} tone="pending" /><FinancialMetricCard icon={WalletCards} label="Por pagar" value={financial.summary.payable} tone="pending" /></section><div className="statistics-chart-grid"><section className="erp-panel financial-chart-panel"><div className="financial-chart-panel__header"><h2>Evolución financiera</h2><p>Sólo movimientos pagados del periodo.</p></div><FinancialTimelineChart data={financialTimeline} /></section><section className="erp-panel financial-chart-panel"><div className="financial-chart-panel__header"><h2>Pagados y pendientes</h2><p>Movimientos efectivamente registrados.</p></div><FinancialStatusChart movements={financial.items} /></section><section className="erp-panel financial-chart-panel"><div className="financial-chart-panel__header"><h2>Ingresos por categoría</h2><p>Sólo ingresos pagados.</p></div><FinancialCategoryChart data={incomeCategories} label="Ingresos pagados" /></section><section className="erp-panel financial-chart-panel"><div className="financial-chart-panel__header"><h2>Egresos por categoría</h2><p>Sólo egresos pagados.</p></div><FinancialCategoryChart data={expenseCategories} label="Egresos pagados" /></section></div></>}
        </div>
      )}
    </section>
  );
}

export default StatisticsPage;
