import React from "react";
import {getWorkClosedResultKind} from "../../domain/workModel.mjs";
import {ResultBadge} from "./WorkClosedProjects.jsx";

// Piezas del bloque "Balance y margen" de la ficha. Presentacionales: no calculan
// dinero; muestran lo que entrega obtenerBalanceTrabajo (functions/workBalance.js).

// Aclaración de cada cifra. Cada afirmación sale de functions/workBalance.js:
// - Ingresos: ventas con estado "confirmada" (:102), por su neto, que es sin IVA (:30-35,
//   :131-137; el neto lo calcula la Venta en functions/salePersistence.js:138-141).
// - Costos: materiales de la venta con costo disponible (:107, :139-141), salidas del proyecto
//   menos devoluciones (:142-145), horas hombre vigentes (:146-148) y gastos vigentes, directos
//   e indirectos (:103, :149-152); los gastos de tipo Material sin documento se dejan fuera cuando el proyecto
//   ya tiene materiales de inventario; con documento (tipoDocumento) siempre suman (:108-113).
// - Resultado: ingresos menos costos, solo con una venta confirmada (:175-178).
// - Margen: resultado dividido por los ingresos, solo con ingresos mayores que cero (:179).
export const WORK_BALANCE_HELP = Object.freeze({
  ingresos: "Suma de las ventas confirmadas de este trabajo, sin IVA. Las ventas que aún no están confirmadas no cuentan.",
  costos: "Suma de los materiales (los de la venta y los que se usaron en el trabajo, menos las devoluciones), las horas y los gastos, directos e indirectos. No incluye los registros anulados, los materiales de la venta sin costo disponible ni los gastos de tipo Material sin documento cuando el trabajo ya tiene materiales de inventario (con boleta o factura sí suman).",
  resultado: "Ingresos menos costos. Solo se calcula cuando hay una venta confirmada.",
  margen: "Resultado dividido por los ingresos, en porcentaje. Solo se calcula cuando hay ingresos.",
});

// Monto de gastos de tipo Material que el balance dejó fuera (gastosMaterialExcluido,
// workBalance.js:181, :213). Solo lo informa; no lo calcula. Sin monto, o con monedas
// incompatibles (el backend lo entrega en null), no hay aviso.
export function getExcludedMaterialExpense(balance) {
  if (!balance || balance.estado === "INCONSISTENTE_MONEDA") return null;
  const amount = Number(balance.gastosMaterialExcluido);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

// Cifra sin dato de una tarjeta del balance (Ingresos, Resultado, Margen): un guion y, debajo, una línea
// chica con el motivo. No inventa un valor: solo explica por qué no hay.
export function BalanceEmptyValue({reason}) {
  return (
    <>
      <span className="works-balance-empty"><span aria-hidden="true">—</span><span className="sr-only">Sin dato</span></span>
      <small className="works-balance-reason">{reason}</small>
    </>
  );
}

// Resultado del proyecto con "Ganó" / "Perdió" (misma insignia y misma regla que la vista
// Cerrados: getWorkClosedResultKind), color y signo. Con resultado 0, texto neutro y sin signo.
// Sin resultado (sin venta confirmada), solo el texto que ya entrega `money`.
export function WorkBalanceResult({balance, money}) {
  const kind = getWorkClosedResultKind(balance);
  if (kind === "no_disponible") return <>{money(balance?.resultado)}</>;
  const amount = money(balance.resultado);
  return (
    <span className={`works-balance-result works-balance-result--${kind}`}>
      <ResultBadge balance={balance} kind={kind} />
      <span className="works-balance-result__amount">{kind === "gano" ? `+${amount}` : amount}</span>
    </span>
  );
}
