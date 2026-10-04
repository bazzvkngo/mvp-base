import {calculateOperationalNetProfit} from "../../domain/operationalNetProfit.mjs";
import {calculateSaleProductLineMarginsV1} from "../../domain/saleCommercialMargin.mjs";

// Datos de los gráficos de Ganancias (SPEC 022 §6.5.1-§6.5.3). No hay fórmula
// propia: la evolución mensual y el margen por cliente invocan
// calculateOperationalNetProfit sobre particiones disjuntas (por mes y por
// cliente), así que sus barras suman exactamente la ganancia del período.

export const OTHER_BUCKET_ID = "__otros__";
const MAX_RANKED_BARS = 8;
const UNASSIGNED_CLIENT_ID = "__sin_cliente__";

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function lastDayOfMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, "0");
}

// Tramos mensuales del rango: el primero y el último pueden ser parciales.
export function monthSegments(start, end) {
  const segments = [];
  let month = start.slice(0, 7);
  const lastMonth = end.slice(0, 7);
  while (month <= lastMonth) {
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-${lastDayOfMonth(month)}`;
    segments.push({mes: month, desde: monthStart < start ? start : monthStart, hasta: monthEnd > end ? end : monthEnd});
    const [year, monthNumber] = month.split("-").map(Number);
    month = monthNumber === 12 ? `${year + 1}-01` : `${year}-${String(monthNumber + 1).padStart(2, "0")}`;
  }
  return segments;
}

function byCurrency(result, currency) {
  return (result?.grupos || []).filter((group) => group.moneda && (!currency || currency === "todos" || group.moneda === currency));
}

// §6.5.1: una barra por mes con sus dos componentes; un mes con cobertura
// parcial queda marcado.
export function buildMonthlyOperationalProfit({sales, projectBalances, range, salesTruncated = false, projectsError = false, currency}) {
  const series = new Map();
  const segments = monthSegments(range.start, range.end);
  segments.forEach((segment, index) => {
    const result = calculateOperationalNetProfit({sales, projectBalances, period: {desde: segment.desde, hasta: segment.hasta}, salesTruncated, projectsError});
    byCurrency(result, currency).forEach((group) => {
      if (!series.has(group.moneda)) {
        series.set(group.moneda, segments.map((entry) => ({mes: entry.mes, margenVentas: 0, resultadoProyectos: 0, ganancia: 0, parcial: false})));
      }
      series.get(group.moneda)[index] = {
        mes: segment.mes,
        margenVentas: group.componentes.ventasSinProyecto.margenBrutoProductos,
        resultadoProyectos: group.componentes.proyectos.resultado,
        ganancia: group.gananciaNetaOperacional ?? 0,
        parcial: group.cobertura === "PARCIAL",
      };
    });
  });
  return [...series.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([moneda, months]) => ({moneda, meses: months}));
}

// Agrupa barras ordenadas por magnitud: las primeras se muestran y el resto
// se suma en "Otros", para que el total no cambie.
function rankWithOther(entries, otherLabel) {
  const sorted = [...entries].sort((left, right) => Math.abs(right.valor) - Math.abs(left.valor) || left.nombre.localeCompare(right.nombre));
  if (sorted.length <= MAX_RANKED_BARS) return sorted;
  const visible = sorted.slice(0, MAX_RANKED_BARS - 1);
  const rest = sorted.slice(MAX_RANKED_BARS - 1);
  return [...visible, {id: OTHER_BUCKET_ID, nombre: `${otherLabel} (${rest.length})`, valor: roundMoney(rest.reduce((sum, entry) => sum + entry.valor, 0))}];
}

function clientKey(record) {
  const id = String(record?.clienteId || "").trim();
  return id || UNASSIGNED_CLIENT_ID;
}

function clientName(record) {
  return String(record?.clienteSnapshot?.nombreRazonSocial || "").trim();
}

// §6.5.2: Ventas sin Proyecto por cliente de la Venta y Proyectos por cliente
// del Proyecto. Un Proyecto o Venta sin cliente va a "Sin cliente asignado".
export function buildClientOperationalProfit({sales, projectBalances, range, currency}) {
  const clients = new Map();
  const touch = (record) => {
    const key = clientKey(record);
    if (!clients.has(key)) clients.set(key, {sales: [], projects: [], nombre: key === UNASSIGNED_CLIENT_ID ? "Sin cliente asignado" : ""});
    const client = clients.get(key);
    if (!client.nombre) client.nombre = clientName(record);
    return client;
  };
  (sales || []).filter((sale) => !String(sale?.trabajoId || "").trim()).forEach((sale) => touch(sale).sales.push(sale));
  (projectBalances || []).forEach((project) => touch(project).projects.push(project));

  const perCurrency = new Map();
  clients.forEach((client, key) => {
    const result = calculateOperationalNetProfit({sales: client.sales, projectBalances: client.projects, period: {desde: range.start, hasta: range.end}});
    byCurrency(result, currency).forEach((group) => {
      if (group.gananciaNetaOperacional == null) return;
      if (!perCurrency.has(group.moneda)) perCurrency.set(group.moneda, []);
      perCurrency.get(group.moneda).push({id: key, nombre: client.nombre || "Cliente histórico", valor: group.gananciaNetaOperacional});
    });
  });
  return [...perCurrency.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([moneda, entries]) => ({moneda, barras: rankWithOther(entries, "Otros clientes")}));
}

// Mismo criterio que el término de productos de la ganancia: Venta sin
// Proyecto, dentro del rango y con neto válido; la salida por línea sólo
// existe para Margen V1 COMPLETO.
function contributesProductMargin(sale, range) {
  const date = String(sale?.fechaVenta || "").slice(0, 10);
  const net = sale?.neto;
  return !String(sale?.trabajoId || "").trim() && date >= range.start && date <= range.end &&
    typeof net === "number" && Number.isFinite(net) && net >= 0;
}

// §6.5.3: margen bruto por producto (itemId) de Ventas sin Proyecto.
export function buildProductGrossMargin({sales, range, currency}) {
  const perCurrency = new Map();
  (sales || []).filter((sale) => contributesProductMargin(sale, range)).forEach((sale) => {
    const detail = calculateSaleProductLineMarginsV1(sale);
    if (!detail.lineas || !detail.moneda || (currency && currency !== "todos" && detail.moneda !== currency)) return;
    const names = new Map((sale.items || []).map((item) => [String(item?.lineaId || ""), String(item?.nombre || item?.inventarioSnapshot?.nombre || "").trim()]));
    if (!perCurrency.has(detail.moneda)) perCurrency.set(detail.moneda, new Map());
    const items = perCurrency.get(detail.moneda);
    detail.lineas.forEach((line) => {
      if (!items.has(line.itemId)) items.set(line.itemId, {id: line.itemId, nombre: names.get(line.lineaId) || "Producto histórico", cents: 0});
      items.get(line.itemId).cents += Math.round(line.margenBruto * 100);
    });
  });
  return [...perCurrency.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([moneda, items]) => ({
    moneda,
    barras: rankWithOther([...items.values()].map((item) => ({id: item.id, nombre: item.nombre, valor: item.cents / 100})), "Otros productos"),
  }));
}
