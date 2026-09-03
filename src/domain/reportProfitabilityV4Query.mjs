// ETAPA 2 de REPORTES_RENTABILIDAD_V4 (docs/specs/018-reportes-rentabilidad-v4.md).
// Orquestación pura de la fuente de datos: validación de rango, paginación acotada
// de Ventas y concurrencia acotada para balances de Proyecto. Sin acceso remoto,
// sin cálculo económico: eso sigue siendo exclusivo de reportProfitabilityV4.mjs.

export const REPORT_SALES_QUERY_LIMITS = Object.freeze({
  MAX_RANGE_DAYS: 366,
  MAX_PAGE_SIZE: 250,
  MAX_TOTAL_DOCUMENTS: 5000,
});

// Mitigación temporal del patrón N+1 de balances de Proyecto (SPEC 018 §11.3).
// No resuelve el N+1: solo evita disparar todos los Callables a la vez.
// No se expone como configuración de producto.
export const REPORT_PROJECT_BALANCE_CONCURRENCY_V4 = 4;

export class ReportRangeError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReportRangeError";
  }
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDateKey(value) {
  const normalized = String(value || "").trim();
  if (!DATE_KEY_PATTERN.test(normalized)) return null;
  const millis = Date.parse(`${normalized}T00:00:00Z`);
  return Number.isFinite(millis) ? {key: normalized, millis} : null;
}

export function validateSalesDateRangeV4({from, to} = {}) {
  const start = parseDateKey(from);
  if (!start) {
    throw new ReportRangeError("La fecha inicial es obligatoria y debe tener formato AAAA-MM-DD.");
  }
  const end = parseDateKey(to);
  if (!end) {
    throw new ReportRangeError("La fecha final es obligatoria y debe tener formato AAAA-MM-DD.");
  }
  if (start.key > end.key) {
    throw new ReportRangeError("La fecha inicial no puede ser posterior a la fecha final.");
  }
  const dias = Math.round((end.millis - start.millis) / 86400000) + 1;
  if (dias > REPORT_SALES_QUERY_LIMITS.MAX_RANGE_DAYS) {
    throw new ReportRangeError(
      `El rango no puede superar ${REPORT_SALES_QUERY_LIMITS.MAX_RANGE_DAYS} días inclusivos.`
    );
  }
  return {from: start.key, to: end.key, dias};
}

export function clampSalesPageSize(pageSize) {
  const normalized = Number(pageSize);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return REPORT_SALES_QUERY_LIMITS.MAX_PAGE_SIZE;
  }
  return Math.min(Math.trunc(normalized), REPORT_SALES_QUERY_LIMITS.MAX_PAGE_SIZE);
}

// Orquesta páginas sucesivas mediante un cursor estable (fechaVenta DESC + id DESC),
// acotando la carga total a maxDocuments y detectando truncamiento explícito.
// `fetchPage` es inyectable: en producción consulta el backend documental; en
// pruebas puede ser un generador en memoria, sin ningún acceso remoto.
export async function loadSalesPagesBounded({
  fetchPage,
  from,
  to,
  pageSize = REPORT_SALES_QUERY_LIMITS.MAX_PAGE_SIZE,
  maxDocuments = REPORT_SALES_QUERY_LIMITS.MAX_TOTAL_DOCUMENTS,
} = {}) {
  if (typeof fetchPage !== "function") {
    throw new Error("fetchPage es obligatorio para paginar Ventas.");
  }
  const boundedPageSize = clampSalesPageSize(pageSize);
  const items = [];
  let cursor = null;
  let hasMoreFlag = false;
  let lastCursor = null;
  do {
    const page = await fetchPage({from, to, cursor, pageSize: boundedPageSize});
    const pageItems = Array.isArray(page?.items) ? page.items : [];
    items.push(...pageItems);
    hasMoreFlag = Boolean(page?.hasMore);
    lastCursor = page?.nextCursor || null;
    cursor = lastCursor;
  } while (hasMoreFlag && cursor && items.length < maxDocuments);

  const lecturaTruncada = (hasMoreFlag && items.length >= maxDocuments) || items.length > maxDocuments;
  const finalItems = items.slice(0, maxDocuments);

  return {
    items: finalItems,
    nextCursor: lecturaTruncada ? lastCursor : null,
    hasMore: lecturaTruncada,
    cantidadCargada: finalItems.length,
    lecturaTruncada,
    rango: {from, to},
  };
}

// Pool de concurrencia acotada, determinista y sin dependencias externas: N workers
// consumen un cursor compartido sobre `items`. El orden del resultado sigue siempre
// el orden de `items` (se escribe por índice, no por orden de resolución), y un
// error individual no interrumpe a los demás ni se convierte en un balance inventado.
export async function runProjectBalancesBounded(works, loadBalance, {concurrency = REPORT_PROJECT_BALANCE_CONCURRENCY_V4} = {}) {
  const list = Array.isArray(works) ? works : [];
  const results = new Array(list.length);
  const fallidos = [];
  let cursor = 0;

  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      const work = list[index];
      try {
        const balance = await loadBalance(work, index);
        results[index] = {...work, balance};
      } catch (error) {
        results[index] = {...work, balance: null};
        fallidos.push({
          trabajoId: String(work?.id || work?.trabajoId || ""),
          mensaje: String(error?.message || error || "Error desconocido"),
        });
      }
    }
  }

  const workerCount = list.length === 0 ? 0 : Math.max(1, Math.min(concurrency, list.length));
  await Promise.all(Array.from({length: workerCount}, () => worker()));

  return {proyectos: results, fallidos};
}

// Ejecuta la carga comercial y la carga de Proyectos como ramas independientes.
// Un rechazo total de Proyectos se degrada a metadata de error sin afectar Ventas.
// Un rechazo de Ventas se propaga: es la fuente autoritativa del bloque comercial
// y su fallo (por ejemplo, un rango inválido) no debe ocultarse.
export async function combineSalesAndProjectSources({loadSales, loadProjects}) {
  if (typeof loadSales !== "function" || typeof loadProjects !== "function") {
    throw new Error("loadSales y loadProjects son obligatorios.");
  }
  const [salesOutcome, projectsOutcome] = await Promise.allSettled([loadSales(), loadProjects()]);
  if (salesOutcome.status === "rejected") throw salesOutcome.reason;

  const projects = projectsOutcome.status === "fulfilled"
    ? {proyectos: [], fallidos: [], ...projectsOutcome.value, cargaFallida: false, error: null}
    : {
      proyectos: [],
      fallidos: [],
      cargaFallida: true,
      error: String(projectsOutcome.reason?.message || projectsOutcome.reason || "Error desconocido"),
    };

  return {sales: salesOutcome.value, projects};
}
