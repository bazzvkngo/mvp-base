// Historial de la venta (solo presentación): cada evento sale de un campo que
// el documento ya guarda; si el campo no existe, el evento no aparece. Del
// actor solo se muestra "Tú" cuando el UID es el del usuario actual. El orden
// es el del ciclo de vida, no el de las fechas, porque un sello de tiempo
// recién escrito puede llegar sin resolver y el evento igual debe verse.
const ACCEPTANCE_ORIGIN_LABELS = {
  aceptacion_manual: "Registrada por el equipo",
  portal_publico: "Desde la propuesta pública",
};

export function eventDate(value) {
  if (!value) return null;
  let date = null;
  try {
    if (typeof value.toDate === "function") date = value.toDate();
    else if (value instanceof Date) date = value;
    else if (typeof value === "number" || typeof value === "string") date = new Date(value);
    else {
      const seconds = value.seconds ?? value._seconds;
      if (typeof seconds === "number") date = new Date(seconds * 1000);
    }
  } catch {
    return null;
  }
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

const productCountLabel = (count) => (count === 1 ? "1 producto" : `${count} productos`);

export function buildSaleTimeline(sale, currentUid = "") {
  if (!sale) return [];
  const events = [];
  const add = (key, title, source, uid, {detail = "", tone = ""} = {}) => events.push({
    key,
    title,
    date: eventDate(source),
    actor: currentUid && uid && uid === currentUid ? "Tú" : "",
    detail,
    tone,
  });
  // Una venta originada en una cotización nace confirmada en la misma
  // transacción de la aceptación (SPEC 007): creación, confirmación y
  // aceptación son un solo hecho y se muestran como uno.
  const fromQuote = Boolean(sale.cotizacionId && sale.aceptadaEn);
  if (sale.createdAt && !fromQuote) add("creada", "Venta creada", sale.createdAt, sale.creadoPorUid);
  if (fromQuote) {
    add(
      "aceptada",
      sale.cotizacionNumero ? `Cotización ${sale.cotizacionNumero} aceptada` : "Cotización aceptada",
      sale.aceptadaEn,
      sale.confirmadoPorUid,
      {detail: ACCEPTANCE_ORIGIN_LABELS[sale.origenAceptacion] || ""},
    );
  }
  if (sale.confirmedAt && !fromQuote) add("confirmada", "Venta confirmada", sale.confirmedAt, sale.confirmadoPorUid);
  if (sale.stockAplicadoAt) {
    const applied = Array.isArray(sale.efectosInventario) ? sale.efectosInventario.length : 0;
    add(
      "stock",
      sale.estadoStock === "parcial_pendiente" ? "Stock aplicado parcialmente" : "Stock aplicado",
      sale.stockAplicadoAt,
      sale.confirmadoPorUid,
      {detail: applied ? productCountLabel(applied) : ""},
    );
  }
  if (sale.cancelledAt || sale.motivoCancelacion) {
    add("cancelada", "Venta cancelada", sale.cancelledAt, sale.canceladoPorUid, {
      detail: sale.motivoCancelacion ? `Motivo: ${sale.motivoCancelacion}` : "",
      tone: "danger",
    });
  }
  if (sale.stockRevertidoEn) {
    const reverted = Array.isArray(sale.efectosInventarioReversa) ? sale.efectosInventarioReversa.length : 0;
    add("revertido", "Stock revertido", sale.stockRevertidoEn, sale.canceladoPorUid, {
      detail: reverted ? productCountLabel(reverted) : "",
    });
  }
  return events;
}
