import {resolveReportCurrency} from "./reportModel.mjs";

// SPEC 025 (Ventas y Compras visuales): helpers puros de presentación que comparten
// las pestañas Ventas y Compras de Reportes: la cabecera "Vendí" / "Compré", las
// operaciones más recientes (orden por fecha y límite de filas) y los porcentajes
// de las barras. Solo presentan lo que ya calculan reportModel y los servicios: no
// definen ninguna fórmula económica. Lo único que se calcula aquí son proporciones
// entre cifras que ya existen (un importe sobre el total del que forma parte).

export const DEFAULT_ROW_LIMIT = 5;

function text(value) {
  return String(value ?? "").trim();
}

function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

// Mismo criterio que reportModel.safeAmount: un número finito, y 0 si no lo es.
function safeAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function percentText(value, locale) {
  return `${new Intl.NumberFormat(locale, {minimumFractionDigits: 0, maximumFractionDigits: 1}).format(value)} %`;
}

// --- Cabecera ----------------------------------------------------------------

const FLOW_KINDS = Object.freeze({
  sales: Object.freeze({title: "Vendí", singular: "venta", plural: "ventas"}),
  purchases: Object.freeze({title: "Compré", singular: "compra", plural: "compras"}),
});

// Rótulos de la cabecera. Las cifras van sin IVA (SPEC 025). `withoutNetText` solo
// existe si hay documentos sin neto válido: esos aportan 0 al total, y sin este
// aviso un total bajo parecería un error.
export function describeFlowSummary({kind = "sales", count = 0, withoutNetCount = 0} = {}) {
  const flow = FLOW_KINDS[kind] || FLOW_KINDS.sales;
  const documents = Math.max(0, Math.trunc(finiteOrNull(count) ?? 0));
  const withoutNet = Math.max(0, Math.trunc(finiteOrNull(withoutNetCount) ?? 0));
  const countText = `${documents} ${documents === 1 ? `${flow.singular} confirmada` : `${flow.plural} confirmadas`}`;
  return {
    title: flow.title,
    noun: {singular: flow.singular, plural: flow.plural},
    count: documents,
    countText,
    caption: `${countText} · sin IVA`,
    withoutNet,
    withoutNetText: withoutNet > 0
      ? `${withoutNet} ${withoutNet === 1 ? `${flow.singular} sin neto válido no suma` : `${flow.plural} sin neto válido no suman`} en este total.`
      : null,
  };
}

// Documentos sin neto válido de una moneda: aportan 0 al total (mismo criterio que
// reportModel.hasValidNet: un número finito ≥ 0, nunca se sustituye por `total`).
// reportModel solo entrega la cuenta de todas las monedas juntas; con varias monedas
// cada cabecera necesita la suya.
export function countWithoutNet(documents, {currency = null, fallbackCurrency = "CLP"} = {}) {
  return (Array.isArray(documents) ? documents : [])
    .filter((record) => !currency || resolveReportCurrency(record, fallbackCurrency) === currency)
    .filter((record) => !(typeof record?.neto === "number" && Number.isFinite(record.neto) && record.neto >= 0))
    .length;
}

// --- Operaciones: orden por fecha y límite de filas ---------------------------

function dateKey(value) {
  return text(value).slice(0, 10);
}

// Las más recientes primero, por la fecha del documento (los servicios devuelven
// las listas por última actualización, no por fecha). Desempata por número
// (descendente, comparando los dígitos como números) y por id; sin fecha va al
// final. No modifica la lista original.
export function sortByDateDesc(documents, dateField) {
  return [...(Array.isArray(documents) ? documents : [])].sort((left, right) => {
    const leftDate = dateKey(left?.[dateField]);
    const rightDate = dateKey(right?.[dateField]);
    if (leftDate !== rightDate) {
      if (!leftDate) return 1;
      if (!rightDate) return -1;
      return leftDate < rightDate ? 1 : -1;
    }
    return text(right?.numero).localeCompare(text(left?.numero), "es", {numeric: true}) ||
      text(right?.id || right?.ventaId || right?.compraId).localeCompare(text(left?.id || left?.ventaId || left?.compraId), "es", {numeric: true});
  });
}

// Filas visibles según el límite y si se pidió ver todas. `hidden` es lo que falta
// mostrar; `limited` dice si hay algo que ocultar (si no, no hace falta botón).
export function limitRows(rows, {limit = DEFAULT_ROW_LIMIT, expanded = false} = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const max = Math.max(1, Math.trunc(finiteOrNull(limit) ?? DEFAULT_ROW_LIMIT));
  const limited = list.length > max;
  const visible = limited && !expanded ? list.slice(0, max) : list;
  return {rows: visible, total: list.length, shown: visible.length, hidden: list.length - visible.length, limit: max, limited, expanded: Boolean(expanded) && limited};
}

// Textos de "Mostrando X de N" y del botón. `noun` = {singular, plural}, ambos
// sustantivos femeninos (ventas, compras). Sin nada que ocultar no hay textos.
export function describeRowsShown(view, noun = {singular: "operación", plural: "operaciones"}) {
  if (!view?.limited) return {status: null, toggleLabel: null};
  const name = view.total === 1 ? noun.singular : noun.plural;
  return view.expanded
    ? {status: `Mostrando las ${view.total} ${name}`, toggleLabel: `Ver solo las ${view.limit} más recientes`}
    : {status: `Mostrando ${view.shown} de ${view.total} ${name}`, toggleLabel: `Ver todas (${view.total})`};
}

// --- Barras de porcentaje -------------------------------------------------------

// Filas para barras: `share` es el importe sobre `total` (el todo del que forma
// parte; el texto "43,6 %") y `fraction` el largo de la barra respecto de la
// mayor (0 a 1). `others` es lo que no está en las filas, para que se vea que el
// resto existe. Sin un total válido no hay barras. Las entradas ya vienen
// ordenadas de mayor a menor desde reportModel; aquí se ordenan por si acaso y se
// descartan las de importe 0.
export function buildShareBars(entries, {total, limit = DEFAULT_ROW_LIMIT, locale = "es-CL", othersCount = null} = {}) {
  const whole = finiteOrNull(total);
  const list = (Array.isArray(entries) ? entries : [])
    .map((entry) => ({...entry, amount: finiteOrNull(entry?.total ?? entry?.amount)}))
    .filter((entry) => entry.amount !== null && entry.amount > 0)
    .sort((left, right) => right.amount - left.amount)
    .slice(0, Math.max(1, Math.trunc(finiteOrNull(limit) ?? DEFAULT_ROW_LIMIT)));
  if (whole === null || whole <= 0 || !list.length) return {show: false, total: whole, rows: [], others: null};

  const largest = list[0].amount;
  const rows = list.map((entry) => {
    const share = roundTo((entry.amount / whole) * 100, 1);
    return {...entry, share, shareText: percentText(share, locale), fraction: roundTo(entry.amount / largest, 4)};
  });
  const remaining = roundTo(whole - list.reduce((sum, entry) => sum + entry.amount, 0), 2);
  const others = remaining > 0
    ? {
      amount: remaining,
      share: roundTo((remaining / whole) * 100, 1),
      shareText: percentText(roundTo((remaining / whole) * 100, 1), locale),
      // Largo de la barra respecto de la mayor, sin pasar de 1 (el resto puede sumar más que la primera fila).
      fraction: Math.min(1, roundTo(remaining / largest, 4)),
      count: finiteOrNull(othersCount),
    }
    : null;
  return {show: true, total: whole, rows, others};
}

// Cantidad con su unidad ("2 unidades", "2 horas", "1 caja"). Solo pluraliza las
// palabras completas: una abreviatura (hasta 3 letras, o con dígitos, punto,
// barra o espacio) se deja tal cual ("2 kg", "3 m2").
export function describeQuantity(quantity, unit, locale = "es-CL") {
  const amount = finiteOrNull(quantity);
  if (amount === null) return "";
  const name = text(unit) || "unidad";
  const formatted = new Intl.NumberFormat(locale, {maximumFractionDigits: 2}).format(amount);
  let word = name;
  if (amount !== 1 && /^[a-záéíóúüñ]{4,}$/i.test(name)) {
    if (/[aeiouáéíóú]$/i.test(name)) word = `${name}s`;
    else if (!/[sx]$/i.test(name)) word = `${name}es`;
  }
  return `${formatted} ${word}`;
}

// Barras por producto o servicio sobre el ranking que ya llega (`entries`, de
// getTopSalesProducts). Agrega lo que el ranking no trae:
//  - el total de todas las líneas de la moneda (`linesTotal`), que es el todo de los
//    porcentajes: sumar solo el top 5 daría 100 % aunque haya más productos;
//  - el tipo (producto, servicio, actividad) y la unidad de cada ítem, desde las líneas;
//  - `hasGeneralDiscount`: el total de una línea (`totalLinea`) es después del
//    descuento de la línea pero ANTES del descuento general de la venta, así que
//    con descuento general las líneas suman más que el neto de la venta.
// Misma regla de agrupación que el ranking (itemId, o código, o "sin-identificar")
// y mismo universo (las ventas confirmadas de la moneda).
export function describeProductBars({entries = [], documents = [], currency = null, fallbackCurrency = "CLP", limit = DEFAULT_ROW_LIMIT, locale = "es-CL"} = {}) {
  const inCurrency = (Array.isArray(documents) ? documents : [])
    .filter((record) => !currency || resolveReportCurrency(record, fallbackCurrency) === currency);
  let linesTotal = 0;
  let hasGeneralDiscount = false;
  const meta = new Map();
  inCurrency.forEach((record) => {
    if (safeAmount(record?.descuento) > 0) hasGeneralDiscount = true;
    (Array.isArray(record?.items) ? record.items : []).forEach((line) => {
      linesTotal += safeAmount(line?.totalLinea);
      const id = text(line?.itemId) || text(line?.codigo) || "sin-identificar";
      const entry = meta.get(id) || {tipoItem: "", unidad: "", mixedType: false};
      const type = text(line?.tipoItem).toLowerCase();
      if (type) {
        if (!entry.tipoItem) entry.tipoItem = type;
        else if (entry.tipoItem !== type) entry.mixedType = true;
      }
      if (!entry.unidad) entry.unidad = text(line?.unidad);
      meta.set(id, entry);
    });
  });
  linesTotal = roundTo(linesTotal, 2);

  const listed = (Array.isArray(entries) ? entries : []).map((entry) => {
    const info = meta.get(text(entry?.id)) || {tipoItem: "", unidad: "", mixedType: false};
    return {
      ...entry,
      tipoItem: info.mixedType ? null : info.tipoItem || null,
      unidad: info.unidad || null,
      quantityText: describeQuantity(entry?.quantity, info.unidad, locale),
    };
  });
  const bars = buildShareBars(listed, {total: linesTotal, limit, locale, othersCount: Math.max(0, meta.size - Math.min(listed.length, limit))});
  return {...bars, linesTotal, hasGeneralDiscount};
}
