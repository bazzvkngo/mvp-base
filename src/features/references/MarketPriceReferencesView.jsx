import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ExternalLink, RefreshCw, SearchX } from "lucide-react";
import AppIcon from "../../components/ui/AppIcon";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import { describeInternalPricePosition } from "../../domain/marketPricePosition.mjs";
import { searchInventoryMarketReferences } from "../../services/marketReferenceService";
import { formatDate, formatMoney } from "../../utils/formatters";
import useBusinessFormat from "../../hooks/useBusinessFormat";
import "./market-references.css";

const MIN_MATCHES_FOR_SUMMARY = 3;

// La confianza mide cuánto coinciden los resultados con el producto (nombre,
// medidas y tipo), no cuántos resultados hay ni qué datos tiene el artículo.
const CONFIDENCE_LABELS = {
  HIGH: "Alta",
  MEDIUM: "Media",
  LOW: "Baja",
};

const RELEVANCE_BADGES = {
  ALTA: { label: "Relevancia alta", className: "ui-status-badge ui-status-badge--success" },
  MEDIA: { label: "Relevancia media", className: "ui-status-badge ui-status-badge--neutral" },
};

function PageHeader({ onBack, title, subtitle, actions }) {
  return (
    <header className="erp-page-header market-ref-header">
      <div className="erp-page-header__content">
        <button type="button" className="market-ref-back" onClick={onBack}>
          <AppIcon icon={ArrowLeft} size={16} /> Volver a Inventario
        </button>
        <h1 className="erp-page-header__title">{title}</h1>
        {subtitle && <p className="erp-page-header__description">{subtitle}</p>}
      </div>
      {actions}
    </header>
  );
}

function formatDifference(fraction) {
  if (fraction === null || fraction === undefined) return "";
  const percent = Math.round(Math.abs(fraction) * 100);
  if (percent === 0) return " y coincide con la mediana";
  return ` (${percent} % ${fraction > 0 ? "sobre" : "bajo"} la mediana)`;
}

function PriceSummary({ summary, item, resultsCount, discardedCount, businessLocale }) {
  const hasInternalPrice = item?.internalPrice !== null && item?.internalPrice !== undefined;
  const position = describeInternalPricePosition(summary, item?.internalPrice);
  const money = (value, currency = summary.currency) => formatMoney(value, currency, businessLocale);

  return (
    <>
      <dl className="market-ref-prices">
        <div className="market-ref-price">
          <dt>Precio bajo</dt>
          <dd>{money(summary.min)}</dd>
        </div>
        <div className="market-ref-price">
          <dt>Mediana</dt>
          <dd>{money(summary.median)}</dd>
        </div>
        <div className="market-ref-price">
          <dt>Precio alto</dt>
          <dd>{money(summary.max)}</dd>
        </div>
        {hasInternalPrice && (
          <div className="market-ref-price market-ref-price--own">
            <dt>Tu precio interno</dt>
            <dd>{money(item.internalPrice, item.currency)}</dd>
          </div>
        )}
      </dl>

      {position && (
        <div className="market-ref-range">
          <div
            className="market-ref-range__track"
            role="img"
            aria-label={`${position.label}. Rango de mercado de ${money(summary.min)} a ${money(summary.max)}.`}
          >
            <span className="market-ref-range__mark market-ref-range__mark--median" style={{ left: `${position.medianPercent}%` }} />
            <span className="market-ref-range__mark market-ref-range__mark--own" style={{ left: `${position.internalPercent}%` }} />
          </div>
          <p className="market-ref-range__legend">
            <span><i className="market-ref-range__swatch market-ref-range__swatch--median" /> Mediana</span>
            <span><i className="market-ref-range__swatch market-ref-range__swatch--own" /> Tu precio interno</span>
          </p>
          <p className="market-ref-position">
            {position.label}
            {formatDifference(position.differenceVsMedian)}.
          </p>
        </div>
      )}

      <p className="market-ref-basis">
        Calculado con {summary.count} coincidencias relevantes
        {summary.outliersExcluded > 0 ? ` (se excluyó ${summary.outliersExcluded} precio atípico)` : ""}
        {discardedCount > 0 ? `; ${discardedCount} de ${resultsCount + discardedCount} resultados se descartaron por no coincidir con el producto` : ""}.
      </p>
    </>
  );
}

function UnitsNote({ unit }) {
  return (
    <p className="market-ref-note">
      <span>
        <strong>Compara unidades.</strong>
        {unit ? ` Tu precio interno está en «${unit}».` : ""}
        {" "}Los comercios pueden vender por barra, caja o rollo: por ejemplo, una barra de 6 m frente a un
        precio por metro. Confirma la presentación en cada enlace antes de decidir un precio.
      </span>
    </p>
  );
}

function ResultCard({ result, businessLocale }) {
  const badge = RELEVANCE_BADGES[result.relevance?.level] || RELEVANCE_BADGES.MEDIA;
  return (
    <li className={`market-ref-result${result.outlier ? " market-ref-result--outlier" : ""}`}>
      <div>
        <h3 className="market-ref-result__title">{result.title}</h3>
        <p className="market-ref-result__merchant">{result.merchant}</p>
      </div>
      <strong className="market-ref-result__price">{formatMoney(result.price, result.currency, businessLocale)}</strong>
      <div className="market-ref-result__footer">
        <span className={badge.className}>{badge.label}</span>
        {result.outlier && (
          <span className="ui-status-badge ui-status-badge--warning">Precio atípico: fuera del resumen</span>
        )}
        <a className="market-ref-result__link" href={result.url} target="_blank" rel="noreferrer">
          Ver en {result.merchant} <AppIcon icon={ExternalLink} size={14} />
        </a>
      </div>
    </li>
  );
}

function MarketPriceReferencesView({ businessId, itemId }) {
  const { locale: businessLocale } = useBusinessFormat();
  const navigate = useNavigate();
  const goToInventory = () => navigate("/inventario");
  const [status, setStatus] = useState("loading");
  const [data, setData] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async ({ forceRefresh = false } = {}) => {
    if (!businessId || !itemId) return;
    if (forceRefresh) setRefreshing(true);
    else setStatus("loading");
    setErrorMessage("");
    try {
      const response = await searchInventoryMarketReferences(businessId, itemId, { forceRefresh });
      setData(response);
      setStatus("ready");
    } catch (error) {
      setErrorMessage(error?.message || "No fue posible consultar el mercado en este momento.");
      setStatus(error?.code === "functions/permission-denied" ? "denied" : "error");
    } finally {
      setRefreshing(false);
    }
  }, [businessId, itemId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = () => {
    if (data && data.cached === false) {
      load({ forceRefresh: true });
      return;
    }
    const confirmed = window.confirm(
      "Los precios en cache todavía están vigentes (hasta 24 horas). ¿Deseas forzar una nueva búsqueda en Google Shopping ahora?"
    );
    if (confirmed) load({ forceRefresh: true });
  };

  if (status === "loading") {
    return (
      <section className="erp-page">
        <PageHeader onBack={goToInventory} title="Referencias de mercado" subtitle="Consultando precios en Google Shopping…" />
        <LoadingState variant="page" label="Buscando precios…" />
      </section>
    );
  }

  if (status === "denied") {
    return (
      <section className="erp-page">
        <PageHeader onBack={goToInventory} title="Referencias de mercado" />
        <div className="erp-empty-state market-ref-state" role="alert">
          <AppIcon icon={AlertTriangle} size={28} />
          <p>{errorMessage}</p>
        </div>
      </section>
    );
  }

  if (status === "error") {
    return (
      <section className="erp-page">
        <PageHeader onBack={goToInventory} title="Referencias de mercado" />
        <div className="erp-empty-state market-ref-state" role="alert">
          <AppIcon icon={AlertTriangle} size={28} />
          <p>{errorMessage}</p>
          <Button type="button" variant="secondary" icon={RefreshCw} onClick={() => load()}>
            Reintentar
          </Button>
        </div>
      </section>
    );
  }

  const {
    item,
    results = [],
    summary,
    warnings = [],
    cached,
    actualizadoEn,
    confidence,
    query,
    discardedCount = 0,
    status: matchStatus,
  } = data || {};
  const hasMatches = results.length > 0;

  return (
    <section className="erp-page">
      <PageHeader
        onBack={goToInventory}
        title="Referencias de mercado"
        subtitle={item?.name}
        actions={
          <Button type="button" variant="secondary" icon={RefreshCw} loading={refreshing} onClick={handleRefresh}>
            {refreshing ? "Actualizando…" : "Forzar refresco"}
          </Button>
        }
      />

      <div className="erp-panel">
        <div className="erp-panel-header">
          <div>
            <h2 className="erp-panel-title">Resumen de precios</h2>
            <p className="market-ref-meta">
              <span>{cached ? "Resultados desde cache" : "Resultados recién consultados"}</span>
              {actualizadoEn && <span>Actualizado el {formatDate(actualizadoEn)}</span>}
              {hasMatches && confidence && (
                <span>Confianza de búsqueda: {CONFIDENCE_LABELS[confidence] || confidence}</span>
              )}
            </p>
          </div>
        </div>

        {query && <p className="market-ref-query">Búsqueda enviada: {query}</p>}

        {warnings.length > 0 && (
          <ul className="market-ref-warnings">
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        )}

        {matchStatus === "OK" && summary && (
          <>
            <PriceSummary
              summary={summary}
              item={item}
              resultsCount={results.length}
              discardedCount={discardedCount}
              businessLocale={businessLocale}
            />
            <UnitsNote unit={item?.unit} />
          </>
        )}

        {matchStatus === "FEW" && (
          <>
            <div className="market-ref-few" role="note">
              <strong>Pocas coincidencias</strong>
              <span>
                Solo {results.length === 1 ? "1 resultado coincide" : `${results.length} resultados coinciden`} con
                el producto. Se necesitan al menos {MIN_MATCHES_FOR_SUMMARY} para calcular un resumen de precios, así
                que no se muestra. Revisa cada resultado por separado.
              </span>
            </div>
            <UnitsNote unit={item?.unit} />
          </>
        )}

        {!hasMatches && (
          <div className="erp-empty-state market-ref-state">
            <AppIcon icon={SearchX} size={28} />
            <h3 className="market-ref-state__title">Sin coincidencias confiables</h3>
            <p>
              {discardedCount > 0
                ? `Google Shopping devolvió ${discardedCount} resultado${discardedCount === 1 ? "" : "s"}, pero ninguno coincide con el nombre y las medidas de este producto. Por eso no mostramos precios ni un resumen.`
                : "No encontramos resultados de mercado para este producto, así que no hay precios ni resumen que mostrar."}
            </p>
            <p>Revisa que el nombre del artículo incluya el tipo de producto y sus medidas, y vuelve a buscar con «Forzar refresco».</p>
          </div>
        )}
      </div>

      {hasMatches && (
        <div className="erp-panel">
          <h2 className="erp-panel-title">Coincidencias por relevancia</h2>
          <ul className="market-ref-results">
            {results.map((result) => (
              <ResultCard key={result.externalId || result.url} result={result} businessLocale={businessLocale} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default MarketPriceReferencesView;
