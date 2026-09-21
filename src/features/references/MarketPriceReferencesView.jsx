import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ExternalLink, RefreshCw, ShoppingBag, Star } from "lucide-react";
import AppIcon from "../../components/ui/AppIcon";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import { searchInventoryMarketReferences } from "../../services/marketReferenceService";
import { formatDate, formatMoney } from "../../utils/formatters";

const CONFIDENCE_LABELS = {
  HIGH: "Alta",
  MEDIUM: "Media",
  LOW: "Baja",
};

function PageHeader({ onBack, title, subtitle, actions }) {
  return (
    <header className="erp-page-header" style={styles.header}>
      <div className="erp-page-header__content">
        <button type="button" style={styles.backButton} onClick={onBack}>
          <AppIcon icon={ArrowLeft} size={16} /> Volver a Inventario
        </button>
        <h1 className="erp-page-header__title">{title}</h1>
        {subtitle && <p className="erp-page-header__description">{subtitle}</p>}
      </div>
      {actions}
    </header>
  );
}

function MarketPriceReferencesView({ businessId, itemId }) {
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
        <div className="erp-empty-state" role="alert" style={styles.stateBlock}>
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
        <div className="erp-empty-state" role="alert" style={styles.stateBlock}>
          <AppIcon icon={AlertTriangle} size={28} />
          <p>{errorMessage}</p>
          <Button type="button" variant="secondary" icon={RefreshCw} onClick={() => load()}>
            Reintentar
          </Button>
        </div>
      </section>
    );
  }

  const { item, results = [], summary, warnings = [], cached, actualizadoEn, confidence } = data || {};

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
            <p className="erp-secondary-text">
              {cached ? "Resultados desde cache" : "Resultados recién consultados"}
              {actualizadoEn ? ` · Actualizado el ${formatDate(actualizadoEn)}` : ""}
              {confidence ? ` · Confianza de búsqueda: ${CONFIDENCE_LABELS[confidence] || confidence}` : ""}
            </p>
          </div>
        </div>

        {warnings.length > 0 && (
          <ul style={styles.warningsBox}>
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        )}

        {summary ? (
          <dl className="erp-meta-grid">
            <div className="erp-meta">
              <dt className="erp-meta__label">Precio bajo</dt>
              <dd className="erp-meta__value">{formatMoney(summary.min, summary.currency)}</dd>
            </div>
            <div className="erp-meta">
              <dt className="erp-meta__label">Precio medio</dt>
              <dd className="erp-meta__value">{formatMoney(summary.median, summary.currency)}</dd>
            </div>
            <div className="erp-meta">
              <dt className="erp-meta__label">Precio alto</dt>
              <dd className="erp-meta__value">{formatMoney(summary.max, summary.currency)}</dd>
            </div>
            {item?.internalPrice != null && (
              <div className="erp-meta">
                <dt className="erp-meta__label">Tu precio interno</dt>
                <dd className="erp-meta__value">{formatMoney(item.internalPrice, item.currency)}</dd>
              </div>
            )}
          </dl>
        ) : (
          <div className="erp-empty-state" style={styles.stateBlock}>
            <AppIcon icon={ShoppingBag} size={28} />
            <p>No encontramos resultados de mercado para este producto.</p>
          </div>
        )}
      </div>

      {results.length > 0 && (
        <div className="erp-panel">
          <h2 className="erp-panel-title">Comercios encontrados</h2>
          <div className="erp-card-list" style={styles.resultsList}>
            {results.map((result) => (
              <article className="erp-record-card" key={result.externalId || result.url}>
                <div className="erp-record-card__header" style={styles.priceRow}>
                  <div>
                    <h3 className="erp-record-card__title">{result.merchant}</h3>
                    <p className="erp-record-card__subtitle">{result.title}</p>
                  </div>
                  <strong>{formatMoney(result.price, result.currency)}</strong>
                </div>
                {result.rating != null && (
                  <p style={styles.ratingText}>
                    <AppIcon icon={Star} size={13} /> {result.rating}
                    {result.ratingCount != null ? ` (${result.ratingCount})` : ""}
                  </p>
                )}
                <a style={styles.merchantLink} href={result.url} target="_blank" rel="noreferrer">
                  Ver en {result.merchant} <AppIcon icon={ExternalLink} size={14} />
                </a>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

const styles = {
  header: {
    alignItems: "flex-start",
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "4px",
    padding: "18px",
  },
  backButton: {
    alignItems: "center",
    background: "transparent",
    border: 0,
    color: "#0f766e",
    cursor: "pointer",
    display: "inline-flex",
    fontSize: "13px",
    fontWeight: 700,
    gap: "6px",
    marginBottom: "8px",
    padding: 0,
  },
  stateBlock: {
    display: "grid",
    gap: "10px",
    justifyItems: "center",
    padding: "28px 14px",
    textAlign: "center",
  },
  warningsBox: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: "4px",
    color: "#92400e",
    display: "grid",
    fontSize: "13px",
    gap: "4px",
    margin: "0 0 14px",
    padding: "10px 12px",
  },
  priceRow: {
    alignItems: "flex-start",
    gap: "10px",
    justifyContent: "space-between",
  },
  resultsList: {
    display: "grid",
    gap: "10px",
  },
  merchantLink: {
    alignItems: "center",
    color: "#0f766e",
    display: "inline-flex",
    fontSize: "13px",
    fontWeight: 700,
    gap: "4px",
    marginTop: "8px",
    textDecoration: "none",
  },
  ratingText: {
    alignItems: "center",
    color: "#64748b",
    display: "flex",
    fontSize: "13px",
    gap: "4px",
    margin: "8px 0 0",
  },
};

export default MarketPriceReferencesView;
