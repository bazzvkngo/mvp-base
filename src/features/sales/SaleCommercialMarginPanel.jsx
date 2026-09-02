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
    message: "El margen comercial estará disponible cuando la venta quede confirmada.",
  },
  [STATUS.CANCELED]: {
    label: "Anulada",
    message: "La venta está anulada y no aporta margen comercial.",
  },
  [STATUS.NOT_APPLICABLE]: {
    label: "No aplica",
    message: "Esta venta no contiene productos. V1 no calcula rentabilidad de servicios o actividades.",
  },
  [STATUS.COMPLETE]: {
    label: "Completo",
  },
  [STATUS.PARTIAL]: {
    label: "Cobertura parcial",
    message: "Sólo existe costo histórico confiable para una parte de los productos. No se publica un margen parcial.",
  },
  [STATUS.UNAVAILABLE]: {
    label: "No disponible",
    message: "La venta no conserva evidencia histórica suficiente para calcular el margen de productos.",
  },
  [STATUS.CURRENCY_MISMATCH]: {
    label: "No disponible",
    message: "El costo histórico y la venta declaran monedas diferentes. V1 no realiza conversiones.",
  },
});

function formatMarginPercentage(value, locale) {
  if (!Number.isFinite(value)) return "No disponible";
  return `${new Intl.NumberFormat(locale || "es-CL", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value)} %`;
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
          <h2 id="sale-commercial-margin-title">Margen comercial</h2>
        </div>
        <span className={`sale-commercial-margin__status sale-commercial-margin__status--${margin.estado.toLowerCase()}`}>
          {content.label}
        </span>
      </header>

      {complete ? (
        <>
          <dl className="sale-commercial-margin__metrics">
            <div>
              <dt>Ingreso neto de productos</dt>
              <dd>{money(margin.ingresoNetoProductos)}</dd>
            </div>
            <div>
              <dt>Costo histórico de productos</dt>
              <dd>{money(margin.costoHistoricoProductos)}</dd>
            </div>
            <div className="sale-commercial-margin__primary-metric">
              <dt>Margen bruto de productos</dt>
              <dd>{money(margin.margenBrutoProductos)}</dd>
            </div>
            <div>
              <dt>Margen porcentual</dt>
              <dd>{formatMarginPercentage(margin.margenBrutoPct, sale.locale)}</dd>
            </div>
          </dl>
          {hasNonProductItems && (
            <p className="sale-commercial-margin__note">
              Considera sólo productos. No evalúa la rentabilidad de servicios, actividades, horas ni gastos.
            </p>
          )}
        </>
      ) : (
        <p className="sale-commercial-margin__notice">{content.message}</p>
      )}
    </section>
  );
}
