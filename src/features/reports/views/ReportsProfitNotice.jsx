import React from "react";
import {ChevronDown, TriangleAlert} from "lucide-react";
import Button from "../../../components/ui/Button";
import {formatMoney} from "../../../utils/formatters";

// Aviso único de la ganancia (SPEC 025, Resumen visual). Reemplaza la línea de
// cobertura y los avisos sueltos de Proyectos del mes: todo lo que conviene
// revisar para no malinterpretar la ganancia vive en un solo chip pegado a la
// tarjeta "Me quedó". Las líneas las decide buildProfitNoticeLines (reglas y
// permisos); este componente solo las presenta, sin calcular nada.
//
// El chip es siempre visible cuando hay algo que avisar: si la ganancia es
// parcial dice "Parcial · N cosas por revisar", y el detalle de cada línea se abre
// con el chip (<details>, sin JavaScript y accesible con teclado). Sin líneas no
// se dibuja nada.
//
// `lines`: solo las de placement "profit". `onOpenDetail("ganancias")` abre el
// estado del sistema; `onNavigate("/ventas")` lleva a Ventas.
function ReportsProfitNotice({currency, lines, locale, onNavigate, onOpenDetail, variant = "card"}) {
  if (!Array.isArray(lines) || !lines.length) return null;
  const partial = lines.some((line) => line.key === "partial");
  const count = lines.length;
  const review = `${count} ${count === 1 ? "cosa" : "cosas"} por revisar`;

  return <details className={`reports-profit-notice reports-profit-notice--${variant}${partial ? " reports-profit-notice--partial" : ""}`}>
    <summary className="reports-profit-notice__chip">
      <TriangleAlert size={14} aria-hidden="true" />
      <span>{partial ? `Parcial · ${review}` : review}</span>
      <ChevronDown className="reports-profit-notice__chevron" size={14} aria-hidden="true" />
    </summary>
    <ul className="reports-profit-notice__list">
      {lines.map((line) => <li key={line.key}>
        {line.key === "services" ? <p>
          Hay {formatMoney(line.amount, currency, locale)} en servicios vendidos sin proyecto, y no entran en la ganancia. Vincúlalos a un proyecto para saber si ganas o pierdes con ellos.
        </p> : <p>{line.text}{line.detail ? ` ${line.detail}` : ""}</p>}
        {line.action?.id === "system-state" && <Button type="button" variant="secondary" onClick={() => onOpenDetail("ganancias")}>{line.action.label}</Button>}
        {line.action?.id === "sales" && <Button type="button" variant="secondary" onClick={() => onNavigate("/ventas")}>{line.action.label}</Button>}
      </li>)}
    </ul>
  </details>;
}

export default ReportsProfitNotice;
