import React from "react";
import {
  calculateSaleCommercialMarginV1,
  SALE_COMMERCIAL_MARGIN_STATUS as STATUS,
} from "../../domain/saleCommercialMargin.mjs";
import {
  BUSINESS_PERMISSIONS,
  hasBusinessPermission,
} from "../../domain/rbac.mjs";
import {formatMoney} from "../../utils/formatters";

const STATUS_CONTENT = Object.freeze({
  [STATUS.PENDING]: {
    label: "Pendiente",
    message: "La ganancia en productos estará disponible cuando la venta quede confirmada.",
  },
  [STATUS.CANCELED]: {
    label: "Anulada",
    message: "La venta está anulada y no aporta margen comercial.",
  },
  [STATUS.NOT_APPLICABLE]: {
    label: "No aplica",
    message: "Esta venta no contiene productos, así que no hay ganancia en productos que calcular. No se evalúa la rentabilidad de servicios o actividades.",
  },
  [STATUS.COMPLETE]: {
    label: "Todos los productos con costo",
  },
  [STATUS.PARTIAL]: {
    label: "Cobertura parcial",
    message: "Solo hay costo de compra confiable para una parte de los productos, así que no se calcula la ganancia. No se publica un margen parcial.",
  },
  [STATUS.UNAVAILABLE]: {
    label: "No disponible",
    message: "La venta no conserva evidencia histórica suficiente para calcular la ganancia de los productos.",
  },
  [STATUS.CURRENCY_MISMATCH]: {
    label: "No disponible",
    message: "El costo de compra y la venta declaran monedas diferentes, así que no se calcula la ganancia. No se hacen conversiones.",
  },
});

function formatPercentValue(value, locale) {
  return `${new Intl.NumberFormat(locale || "es-CL", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value)} %`;
}

function formatMarginPercentage(value, locale) {
  if (!Number.isFinite(value)) return "No disponible";
  return formatPercentValue(value, locale);
}

// Frase de resumen con los valores reales del cálculo. Si el porcentaje no se
// puede calcular (denominador cero) se omite; nunca se inventa un número.
function ProfitSentence({margin, money, locale}) {
  const profit = margin.margenBrutoProductos;
  const sold = <strong>{money(margin.ingresoNetoProductos)}</strong>;
  const percentage = Number.isFinite(margin.margenBrutoPct)
    ? ` (${formatPercentValue(Math.abs(margin.margenBrutoPct), locale)})`
    : "";
  if (!Number.isFinite(profit)) return <>Ganancia en productos no disponible.</>;
  if (profit > 0) {
    return <>Ganaste <strong>{money(profit)}</strong>{percentage} sobre {sold} vendidos en productos.</>;
  }
  if (profit < 0) {
    return <>Perdiste <strong>{money(Math.abs(profit))}</strong>{percentage} sobre {sold} vendidos en productos.</>;
  }
  return <>No hubo ganancia: vendiste {sold} en productos al mismo valor de su costo de compra.</>;
}

export default function SaleCommercialMarginPanel({role, sale}) {
  const canViewProfitability = hasBusinessPermission(
    role,
    BUSINESS_PERMISSIONS.PROFITABILITY_READ
  );
  if (!sale || !canViewProfitability) return null;

  const margin = calculateSaleCommercialMarginV1(sale);
  const content = STATUS_CONTENT[margin.estado] || STATUS_CONTENT[STATUS.UNAVAILABLE];
  const complete = margin.estado === STATUS.COMPLETE;
  const hasNonProductItems = (Array.isArray(sale.items) ? sale.items : [])
    .some((item) => item?.tipoItem !== "producto");
  const money = (value) => formatMoney(value, margin.moneda || sale.moneda, sale.locale);

  return (
    <section className="po-panel sale-commercial-margin" aria-labelledby="sale-commercial-margin-title">
      <header className="sale-commercial-margin__header">
        <div>
          <span className="po-kicker">Análisis comercial</span>
          <h2 id="sale-commercial-margin-title">Ganancia en productos</h2>
        </div>
        <span className={`sale-commercial-margin__status sale-commercial-margin__status--${margin.estado.toLowerCase()}`}>
          {content.label}
        </span>
      </header>

      {complete ? (
        <>
          <p className="sale-commercial-margin__summary">
            <ProfitSentence locale={sale.locale} margin={margin} money={money} />
            {hasNonProductItems && " Los servicios, actividades y horas no se incluyen."}
          </p>
          <dl className="sale-commercial-margin__metrics">
            <div>
              <dt>Vendido</dt>
              <dd>{money(margin.ingresoNetoProductos)}</dd>
            </div>
            <div>
              <dt>Costo de compra</dt>
              <dd>{money(margin.costoHistoricoProductos)}</dd>
            </div>
            <div className="sale-commercial-margin__primary-metric">
              <dt>Ganancia</dt>
              <dd>{money(margin.margenBrutoProductos)}</dd>
            </div>
            <div>
              <dt>Margen %</dt>
              <dd>{formatMarginPercentage(margin.margenBrutoPct, sale.locale)}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="sale-commercial-margin__summary">{content.message}</p>
      )}
    </section>
  );
}
