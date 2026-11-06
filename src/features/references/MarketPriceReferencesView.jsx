import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ExternalLink, RefreshCw, Search, SearchX } from "lucide-react";
import AppIcon from "../../components/ui/AppIcon";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import { describeMarketCacheAge } from "../../domain/marketCacheAge.mjs";
import { describeInternalPricePosition } from "../../domain/marketPricePosition.mjs";
import { searchInventoryMarketReferences } from "../../services/marketReferenceService";
import { formatMoney } from "../../utils/formatters";
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

function ResultCard({ result, businessLocale, TitleTag = "h3" }) {
  const badge = RELEVANCE_BADGES[result.relevance?.level] || RELEVANCE_BADGES.MEDIA;
  return (
    <li className={`market-ref-result${result.outlier ? " market-ref-result--outlier" : ""}`}>
      <div>
        <TitleTag className="market-ref-result__title">{result.title}</TitleTag>
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

// Estado y carga compartidos por la página y el diálogo. Abrir llama a la
// Function con cacheOnly: muestra los precios guardados de las últimas 24
// horas y, si no hay, la Function responde NO_CACHE sin buscar. Solo el botón
// «Buscar precios» (mode "search") y «Forzar refresco» (mode "force")
// consultan a Google Shopping.
function useMarketReferences(businessId, itemId) {
  const [status, setStatus] = useState("loading");
  const [data, setData] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async ({ mode = "cache" } = {}) => {
    if (!businessId || !itemId) return;
    if (mode === "cache") setStatus("loading");
    else setRefreshing(true);
    setErrorMessage("");
    try {
      const response = await searchInventoryMarketReferences(businessId, itemId, {
        forceRefresh: mode === "force",
        cacheOnly: mode === "cache",
      });
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

  // Siempre pide confirmación: cada búsqueda nueva gasta cuota del proveedor,
  // también cuando los precios que se ven acaban de buscarse.
  const handleRefresh = () => {
    const confirmed = window.confirm(
      data?.cached
        ? "Los precios guardados todavía están vigentes (hasta 24 horas). ¿Deseas forzar una nueva búsqueda en Google Shopping? Gasta una búsqueda de tu cuota."
        : "Estos precios se acaban de buscar. ¿Deseas buscar otra vez en Google Shopping? Gasta una búsqueda de tu cuota."
    );
    if (confirmed) load({ mode: "force" });
  };

  const handleSearch = () => load({ mode: "search" });

  return { status, data, errorMessage, refreshing, load, handleRefresh, handleSearch };
}

function RefreshButton({ refreshing, onClick }) {
  return (
    <Button type="button" variant="secondary" icon={RefreshCw} loading={refreshing} onClick={onClick}>
      {refreshing ? "Actualizando…" : "Forzar refresco"}
    </Button>
  );
}

// Contenido sin marco: lo envuelven la página (con su encabezado) y el
// diálogo. `variant="page"` conserva paneles y títulos de la página;
// `variant="dialog"` usa bloques sin borde y un nivel de título más.
function MarketReferencesContent({ state, variant = "dialog" }) {
  const { locale: businessLocale } = useBusinessFormat();
  const { status, data, errorMessage, refreshing, load, handleRefresh, handleSearch } = state;
  const isPage = variant === "page";
  const panelClass = isPage ? "erp-panel" : "market-ref-block";
  const SectionTitle = isPage ? "h2" : "h3";
  const ResultTitleTag = isPage ? "h3" : "h4";

  if (status === "loading") {
    return (
      <>
        <LoadingState variant={isPage ? "page" : "section"} label="Revisando precios guardados…" />
        <p className="market-ref-loading-note">
          Solo se revisan los precios guardados de las últimas 24 horas. No se hace ninguna búsqueda nueva.
        </p>
      </>
    );
  }

  if (status === "denied") {
    return (
      <div className="erp-empty-state market-ref-state" role="alert">
        <AppIcon icon={AlertTriangle} size={28} />
        <p>{errorMessage}</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="erp-empty-state market-ref-state" role="alert">
        <AppIcon icon={AlertTriangle} size={28} />
        <p>{errorMessage}</p>
        <Button type="button" variant="secondary" icon={RefreshCw} onClick={() => load()}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (data?.status === "NO_CACHE") {
    return (
      <div className="erp-empty-state market-ref-state">
        <AppIcon icon={Search} size={28} />
        <SectionTitle className="market-ref-state__title">Aún no hay precios guardados</SectionTitle>
        <p>
          «Buscar precios» consulta Google Shopping una vez y guarda el resultado 24 horas. Abrir esta ventana
          no gasta búsquedas.
        </p>
        {data.query && <p className="market-ref-state__query">Se buscará: {data.query}</p>}
        <Button type="button" icon={Search} loading={refreshing} onClick={handleSearch}>
          {refreshing ? "Buscando…" : "Buscar precios"}
        </Button>
      </div>
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
  const cacheAge = cached ? describeMarketCacheAge(actualizadoEn) : "";

  return (
    <>
      <div className={panelClass}>
        <div className="erp-panel-header">
          <div>
            <SectionTitle className="erp-panel-title">Resumen de precios</SectionTitle>
            <p className="market-ref-meta">
              <span>
                {cached
                  ? `Precios guardados${cacheAge ? ` · Actualizado ${cacheAge}` : ""}`
                  : "Búsqueda recién realizada en Google Shopping"}
              </span>
              {hasMatches && confidence && (
                <span>Confianza de búsqueda: {CONFIDENCE_LABELS[confidence] || confidence}</span>
              )}
            </p>
            <p className="market-ref-cache-note">
              {cached
                ? "Abrir esta ventana no gasta búsquedas: solo «Forzar refresco» vuelve a buscar."
                : "Estos precios se guardan 24 horas: volver a abrir esta ventana no gasta otra búsqueda."}
            </p>
          </div>
          {hasMatches && <RefreshButton refreshing={refreshing} onClick={handleRefresh} />}
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
            <h4 className="market-ref-state__title">Sin coincidencias confiables</h4>
            <p>
              {discardedCount > 0
                ? `Google Shopping devolvió ${discardedCount} resultado${discardedCount === 1 ? "" : "s"}, pero ninguno coincide con suficiente seguridad con este producto. Por eso no mostramos precios ni un resumen.`
                : "No encontramos resultados de mercado para este producto, así que no hay precios ni resumen que mostrar."}
            </p>
            <p>
              No encontramos productos que coincidan con suficiente seguridad. Puedes probar con «Forzar refresco»
              o ajustar el nombre del ítem.
            </p>
            <RefreshButton refreshing={refreshing} onClick={handleRefresh} />
          </div>
        )}
      </div>

      {hasMatches && (
        <div className={panelClass}>
          <SectionTitle className="erp-panel-title">Coincidencias por relevancia</SectionTitle>
          <ul className="market-ref-results">
            {results.map((result) => (
              <ResultCard
                key={result.externalId || result.url}
                result={result}
                businessLocale={businessLocale}
                TitleTag={ResultTitleTag}
              />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

// Vista de página (ruta /inventario/:itemId/referencias).
function MarketPriceReferencesView({ businessId, itemId }) {
  const navigate = useNavigate();
  const state = useMarketReferences(businessId, itemId);
  const subtitle = state.status === "loading"
    ? "Revisando precios guardados…"
    : state.data?.item?.name;

  return (
    <section className="erp-page">
      <PageHeader
        onBack={() => navigate("/inventario")}
        title="Referencias de mercado"
        subtitle={subtitle}
      />
      <MarketReferencesContent state={state} variant="page" />
    </section>
  );
}

function MarketReferencesDialogBody({ businessId, itemId }) {
  const state = useMarketReferences(businessId, itemId);
  return <MarketReferencesContent state={state} variant="dialog" />;
}

// Diálogo para abrir las referencias desde la lista de Inventario. El cuerpo
// solo se monta con el diálogo abierto, así que no consulta nada mientras está
// cerrado. El foco de vuelta lo gestiona quien lo abre (restoreFocus=false).
export function MarketReferencesDialog({ businessId, item, onClose }) {
  return (
    <ResponsiveDialog
      className="market-ref-dialog"
      open={Boolean(item)}
      onClose={onClose}
      restoreFocus={false}
      eyebrow="Inventario"
      title="Referencias de mercado"
      description={item?.nombre}
      footer={<Button type="button" onClick={onClose}>Cerrar</Button>}
    >
      {item && <MarketReferencesDialogBody key={item.id} businessId={businessId} itemId={item.id} />}
    </ResponsiveDialog>
  );
}

export default MarketPriceReferencesView;
