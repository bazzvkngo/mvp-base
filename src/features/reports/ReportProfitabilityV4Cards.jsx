import React from "react";
import {RefreshCw} from "lucide-react";
import {
  REPORT_PROFITABILITY_COVERAGE as COVERAGE,
  REPORT_SALE_PROJECT_SEGMENT as SEGMENT,
} from "../../domain/reportProfitabilityV4.mjs";
import {formatMoney} from "../../utils/formatters";

// Presentación pura de REPORTES_RENTABILIDAD_V4 (ETAPA 3): recibe el estado ya
// resuelto por useReportProfitabilityV4 (ver ReportProfitabilityV4Section.jsx) como
// props. No importa el service ni Firebase, para poder renderizarse en SSR/pruebas
// sin depender del entorno de emuladores.

function money(value, currency) {
  return value == null ? "—" : formatMoney(value, currency);
}

function percent(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toLocaleString("es-CL", {maximumFractionDigits: 2})} %`;
}

function coverageLabel(estado) {
  switch (estado) {
    case COVERAGE.COMPLETE: return "Completa";
    case COVERAGE.PARTIAL: return "Parcial";
    case COVERAGE.UNAVAILABLE: return "No disponible";
    case COVERAGE.NOT_APPLICABLE: return "No aplica (sólo servicios)";
    default: return "Sin datos";
  }
}

function SalesCurrencyGroup({group}) {
  const m = group.metricas;
  const c = group.coberturaMargen;
  const withProject = group.segmentos[SEGMENT.WITH_PROJECT];
  const withoutProject = group.segmentos[SEGMENT.WITHOUT_PROJECT];
  return (
    <article className="reports-v4-currency-group" key={group.moneda || "sin-moneda"}>
      <header>
        <span>{group.moneda || "Moneda no declarada"}</span>
        <span className={`reports-v4-badge reports-v4-badge--${c.estado.toLowerCase()}`}>
          Cobertura {coverageLabel(c.estado)}
        </span>
      </header>

      <dl className="reports-v4-metrics">
        <div>
          <dt>Ventas netas consideradas</dt>
          <dd>{money(m.ventasNetasConfirmadasConocidas, group.moneda)}</dd>
          {!m.ventasNetasEsTotal && <small>Cifra parcial: no todas las ventas confirmadas declaran un neto válido.</small>}
        </div>
        <div>
          <dt>Ingreso neto de productos cubierto</dt>
          <dd>{money(m.ingresoNetoProductosCubiertos, group.moneda)}</dd>
        </div>
        <div>
          <dt>Costo histórico cubierto</dt>
          <dd>{money(m.costoHistoricoProductosCubiertos, group.moneda)}</dd>
        </div>
        <div className="reports-v4-metrics__primary">
          <dt>Margen bruto de productos cubierto</dt>
          <dd>{money(m.margenBrutoProductosCubiertos, group.moneda)}</dd>
        </div>
        <div>
          <dt>Margen bruto % ponderado</dt>
          <dd>{percent(m.margenBrutoProductosPct)}</dd>
        </div>
      </dl>

      <p className="reports-v4-coverage-line">
        {group.conteos.ventasCompletas} de {group.conteos.ventasConProductos} ventas de productos con información
        económica completa
        {group.conteos.ventasParciales > 0 && `, ${group.conteos.ventasParciales} parcial(es)`}
        {group.conteos.ventasNoDisponibles > 0 && `, ${group.conteos.ventasNoDisponibles} sin información`}
        {group.conteos.ventasMonedaInconsistente > 0 && `, ${group.conteos.ventasMonedaInconsistente} con moneda inconsistente`}
        {group.conteos.ventasSoloServicios > 0 && `. ${group.conteos.ventasSoloServicios} venta(s) sólo de servicios/actividades (sin costo ni margen).`}
        {!m.margenCubiertoEsTotal && c.estado !== COVERAGE.NOT_APPLICABLE && (
          <strong> El margen mostrado corresponde sólo a las ventas cubiertas; no es un total definitivo.</strong>
        )}
      </p>

      <div className="reports-v4-segments">
        <div>
          <span>Con Proyecto</span>
          <strong>{money(withProject.metricas.margenBrutoProductosCubiertos, group.moneda)}</strong>
          <small>{withProject.conteos.ventasConfirmadas} venta(s)</small>
        </div>
        <div>
          <span>Sin Proyecto</span>
          <strong>{money(withoutProject.metricas.margenBrutoProductosCubiertos, group.moneda)}</strong>
          <small>{withoutProject.conteos.ventasConfirmadas} venta(s)</small>
        </div>
      </div>
      <small className="reports-v4-note">
        La segmentación es informativa: no se suma al resultado de Proyectos.
      </small>
    </article>
  );
}

export function SalesCommercialMarginV4Card({commercial, canView, onRetry}) {
  if (!canView) return null;

  return (
    <section className="erp-card reports-v4-commercial">
      <div className="reports-section-heading">
        <div>
          <span>Análisis comercial</span>
          <h2>Margen comercial de Ventas</h2>
          <p>Margen bruto de productos vendidos, derivado de Margen Comercial V1. No incluye servicios, HH ni gastos.</p>
        </div>
      </div>

      {commercial.status === "loading" && <div className="reports-v4-state">Calculando margen comercial…</div>}

      {commercial.status === "error" && (
        <div className="reports-v4-state reports-v4-state--error" role="alert">
          <span>{commercial.error}</span>
          {onRetry && <button type="button" className="reports-v4-retry" onClick={onRetry}><RefreshCw size={14} /> Reintentar</button>}
        </div>
      )}

      {commercial.status === "ready" && (
        <>
          {commercial.meta?.lecturaTruncada && (
            <p className="reports-v4-warning" role="alert">
              Se alcanzó el límite de seguridad de lectura ({commercial.meta.cantidadCargada} ventas). El resultado no
              representa necesariamente el total del período: reduce el rango de fechas para verlo completo.
            </p>
          )}
          {commercial.bloque.cobertura.estado === COVERAGE.EMPTY && (
            <div className="reports-v4-empty">No hay ventas confirmadas en el rango seleccionado.</div>
          )}
          {commercial.bloque.cobertura.estado !== COVERAGE.EMPTY && (
            <div className="reports-v4-currency-groups">
              {commercial.bloque.grupos.map((group) => <SalesCurrencyGroup group={group} key={group.moneda || "sin-moneda"} />)}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function ProjectProfitabilityV4Summary({projects, canView}) {
  if (!canView) return null;

  if (projects.status === "loading") {
    return <p className="reports-v4-projects-summary reports-v4-state">Calculando cobertura de balances de Proyecto…</p>;
  }
  if (projects.status === "error") {
    return (
      <p className="reports-v4-projects-summary reports-v4-warning" role="alert">
        No fue posible cargar los balances de Proyecto ({projects.error}). El resumen comercial de Ventas no se ve
        afectado.
      </p>
    );
  }

  const bloque = projects.bloque;
  const fallidos = projects.meta?.fallidos?.length || 0;

  return (
    <div className="reports-v4-projects-summary">
      <div className="reports-v4-projects-counts">
        <span>{bloque.conteos.proyectosRecibidos} proyecto(s) analizados</span>
        <span>{bloque.conteos.completos} con balance completo</span>
        <span className="reports-positive">{bloque.conteos.conGanancia} con ganancia</span>
        <span className="reports-negative">{bloque.conteos.conPerdida} con pérdida</span>
        <span>{bloque.conteos.neutros} en equilibrio</span>
        {bloque.conteos.parciales > 0 && <span>{bloque.conteos.parciales} con información parcial</span>}
        {bloque.conteos.noDisponibles > 0 && <span>{bloque.conteos.noDisponibles} sin información disponible</span>}
      </div>
      {fallidos > 0 && (
        <p className="reports-v4-note">
          {fallidos} balance(s) de Proyecto no pudieron cargarse y no se incluyen en este resumen.
        </p>
      )}
      <p className="reports-v4-note">
        Este bloque usa el balance autoritativo actual de cada Proyecto. No se combina con el margen comercial de
        Ventas: son bases económicas distintas.
      </p>
    </div>
  );
}
