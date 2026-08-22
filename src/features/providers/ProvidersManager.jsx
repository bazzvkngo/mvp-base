import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
  Archive,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Truck,
} from "lucide-react";
import AppIcon from "../../components/ui/AppIcon";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import StatusBadge from "../../components/ui/StatusBadge";
import {
  canManageProviders,
  canReadProviders,
  matchesProviderSearch,
} from "../../domain/providerModel.mjs";
import {getFiscalIdentifierLabel} from "../../domain/fiscalIdentifier.mjs";
import {
  actualizarProveedor,
  archivarProveedor,
  crearProveedor,
  getProviderErrorMessage,
  listarProveedores,
  reactivarProveedor,
} from "../../services/providerService";
import ProviderFormDialog from "./ProviderFormDialog";

const PAYMENT_LABELS = {
  contado: "Contado",
  transferencia: "Transferencia",
  credito: "Crédito",
  otro: "Otro",
};

function contactSummary(provider) {
  return provider.personaContacto || provider.email || provider.telefono || "Sin datos de contacto";
}

function locationSummary(provider) {
  return [provider.direccion, provider.comunaNombre, provider.regionNombre]
    .filter(Boolean)
    .join(", ") || "Sin ubicación";
}

function paymentSummary(provider) {
  if (!provider.condicionesPago) return "Sin condiciones";
  const label = PAYMENT_LABELS[provider.condicionesPago] || provider.condicionesPago;
  return provider.condicionesPago === "credito"
    ? `${label} · ${provider.diasCredito || 0} días`
    : label;
}

function ProviderActions({canManage, onArchive, onEdit, onReactivate, provider}) {
  if (!canManage) return <span className="client-readonly-label">Solo lectura</span>;
  return (
    <div className="client-row-actions">
      {provider.estado === "activo" ? (
        <>
          <button type="button" onClick={() => onEdit(provider)} aria-label={`Editar a ${provider.razonSocial}`} title="Editar proveedor">
            <AppIcon icon={Pencil} size={17} />
          </button>
          <button type="button" onClick={() => onArchive(provider)} aria-label={`Archivar a ${provider.razonSocial}`} title="Archivar proveedor">
            <AppIcon icon={Archive} size={17} />
          </button>
        </>
      ) : (
        <button type="button" onClick={() => onReactivate(provider)} aria-label={`Reactivar a ${provider.razonSocial}`} title="Reactivar proveedor">
          <AppIcon icon={RotateCcw} size={17} />
        </button>
      )}
    </div>
  );
}

function ProvidersManager({businessId, countryCode = "CL", role}) {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [feedbackIsError, setFeedbackIsError] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [formState, setFormState] = useState({open: false, provider: null});
  const [confirmation, setConfirmation] = useState(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const loadSequenceRef = useRef(0);
  const canRead = canReadProviders(role);
  const canManage = canManageProviders(role);
  const fiscalLabel = getFiscalIdentifierLabel(countryCode);

  const loadProviders = useCallback(async () => {
    const loadSequence = ++loadSequenceRef.current;
    setProviders([]);
    setLoadError("");
    if (!businessId || !canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const nextProviders = await listarProveedores(businessId);
      if (loadSequence !== loadSequenceRef.current) return;
      setProviders(nextProviders);
    } catch (error) {
      if (loadSequence !== loadSequenceRef.current) return;
      setLoadError(getProviderErrorMessage(error));
    } finally {
      if (loadSequence === loadSequenceRef.current) setLoading(false);
    }
  }, [businessId, canRead]);

  useEffect(() => {
    loadProviders();
    return () => {
      loadSequenceRef.current += 1;
    };
  }, [loadProviders]);

  const visibleProviders = useMemo(
    () => providers.filter(
      (provider) =>
        (!statusFilter || provider.estado === statusFilter) &&
        matchesProviderSearch(provider, search)
    ),
    [providers, search, statusFilter]
  );

  const openCreate = () => {
    setFeedback("");
    setFeedbackIsError(false);
    setFormState({open: true, provider: null});
  };

  const openEdit = (provider) => {
    setFeedback("");
    setFeedbackIsError(false);
    setFormState({open: true, provider});
  };

  const saveProvider = async (payload) => {
    if (formState.provider) {
      await actualizarProveedor(
        businessId,
        formState.provider.proveedorId,
        payload
      );
      setFeedback("Proveedor actualizado correctamente.");
    } else {
      await crearProveedor(businessId, payload);
      setFeedback("Proveedor creado correctamente.");
    }
    setFeedbackIsError(false);
    await loadProviders();
  };

  const confirmStatusChange = async () => {
    if (!confirmation || changingStatus) return;
    setChangingStatus(true);
    setFeedback("");
    setFeedbackIsError(false);
    try {
      if (confirmation.action === "archive") {
        await archivarProveedor(businessId, confirmation.provider.proveedorId);
        setFeedback(`Proveedor archivado. Su ${fiscalLabel} continúa reservado.`);
      } else {
        await reactivarProveedor(businessId, confirmation.provider.proveedorId);
        setFeedback("Proveedor reactivado correctamente.");
      }
      setConfirmation(null);
      await loadProviders();
    } catch (error) {
      setFeedback(getProviderErrorMessage(error));
      setFeedbackIsError(true);
      setConfirmation(null);
    } finally {
      setChangingStatus(false);
    }
  };

  if (!businessId || !canRead) {
    return (
      <section className="erp-page clients-page">
        <div className="erp-empty-state" role="alert">
          No tienes permisos para consultar proveedores en el negocio activo.
        </div>
      </section>
    );
  }

  const hasFilters = Boolean(search.trim() || statusFilter);
  const confirmationIsArchive = confirmation?.action === "archive";

  return (
    <section className="erp-page clients-page providers-page">
      <div className="erp-module-intro">
        <div className="erp-page-intro">
          <p>Mantén una ficha única por {fiscalLabel} para cada proveedor del negocio activo.</p>
        </div>
        {canManage && <Button icon={Plus} onClick={openCreate}>Nuevo proveedor</Button>}
      </div>

      {!canManage && (
        <div className="client-message client-message--warning" role="status">
          Tu rol MEMBER tiene acceso de lectura. OWNER o ADMIN deben crear y modificar proveedores.
        </div>
      )}
      {feedback && (
        <div className={`client-message${feedbackIsError ? " client-message--error" : ""}`} role={feedbackIsError ? "alert" : "status"} aria-live="polite">
          {feedback}
        </div>
      )}
      {loadError && (
        <div className="client-message client-message--error" role="alert">
          <span>{loadError}</span>
          <Button type="button" variant="secondary" icon={RefreshCw} onClick={loadProviders}>Reintentar</Button>
        </div>
      )}

      <section className="erp-panel" aria-labelledby="providers-list-title">
        <div className="erp-panel-header clients-panel-header">
          <div>
            <h2 id="providers-list-title" className="erp-panel-title">Proveedores registrados</h2>
            <p className="erp-secondary-text">
              {hasFilters
                ? `${visibleProviders.length} de ${providers.length} proveedores`
                : `${providers.length} ${providers.length === 1 ? "proveedor" : "proveedores"}`}
            </p>
          </div>
        </div>

        <div className="erp-filters clients-filters no-print">
          <label className="erp-field clients-search-field">
            <span className="erp-field__label">Buscar por nombre o {fiscalLabel}</span>
            <span className="clients-search-control">
              <AppIcon icon={Search} size={18} />
              <input className="erp-control" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={200} placeholder="Ej.: Acme o identificación fiscal" />
            </span>
          </label>
          <label className="erp-field">
            <span className="erp-field__label">Estado</span>
            <select className="erp-control" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">Todos</option>
              <option value="activo">Activos</option>
              <option value="archivado">Archivados</option>
            </select>
          </label>
        </div>

        {loading ? (
          <div className="erp-empty-state" role="status">Cargando proveedores del negocio activo...</div>
        ) : !loadError && visibleProviders.length === 0 ? (
          <div className="erp-empty-state clients-empty-state">
            <AppIcon icon={Truck} size={28} />
            <h3>{hasFilters ? "No hay coincidencias" : "No hay proveedores registrados"}</h3>
            <p>
              {hasFilters
                ? `Prueba con otro nombre, ${fiscalLabel} o estado.`
                : canManage
                  ? "Crea el primer proveedor para comenzar tu registro comercial."
                  : "OWNER o ADMIN pueden registrar el primer proveedor."}
            </p>
            {!hasFilters && canManage && <Button type="button" icon={Plus} onClick={openCreate}>Crear primer proveedor</Button>}
          </div>
        ) : !loadError ? (
          <>
            <div className="erp-table-region erp-desktop-only">
              <table className="erp-table clients-table providers-table">
                <thead><tr><th>Proveedor</th><th>Contacto</th><th>Ubicación</th><th>Condiciones</th><th>Estado</th><th className="clients-actions-column">Acciones</th></tr></thead>
                <tbody>
                  {visibleProviders.map((provider) => (
                    <tr key={provider.proveedorId}>
                      <td>
                        <strong className="clients-table__name">{provider.razonSocial}</strong>
                        <span className="clients-table__secondary">{provider.identificadorFiscalValor || provider.rut}{provider.nombreFantasia ? ` · ${provider.nombreFantasia}` : ""}</span>
                      </td>
                      <td><span>{contactSummary(provider)}</span>{provider.email && <span className="clients-table__secondary">{provider.email}</span>}{provider.telefono && <span className="clients-table__secondary">{provider.telefono}</span>}</td>
                      <td>{locationSummary(provider)}</td>
                      <td>{paymentSummary(provider)}</td>
                      <td><StatusBadge variant={provider.estado === "activo" ? "success" : "neutral"}>{provider.estado === "activo" ? "Activo" : "Archivado"}</StatusBadge></td>
                      <td className="clients-actions-column">
                        <ProviderActions canManage={canManage} provider={provider} onArchive={(item) => setConfirmation({provider: item, action: "archive"})} onEdit={openEdit} onReactivate={(item) => setConfirmation({provider: item, action: "reactivate"})} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="erp-card-list erp-mobile-only">
              {visibleProviders.map((provider) => (
                <article className="erp-record-card client-card" key={provider.proveedorId}>
                  <header className="erp-record-card__header">
                    <div><h3 className="erp-record-card__title">{provider.razonSocial}</h3><span className="clients-table__secondary">{provider.identificadorFiscalValor || provider.rut}{provider.nombreFantasia ? ` · ${provider.nombreFantasia}` : ""}</span></div>
                    <StatusBadge variant={provider.estado === "activo" ? "success" : "neutral"}>{provider.estado === "activo" ? "Activo" : "Archivado"}</StatusBadge>
                  </header>
                  <dl className="client-card__details">
                    <div><dt>Contacto</dt><dd>{contactSummary(provider)}</dd></div>
                    <div><dt>Ubicación</dt><dd>{locationSummary(provider)}</dd></div>
                    <div><dt>Condiciones</dt><dd>{paymentSummary(provider)}</dd></div>
                  </dl>
                  <ProviderActions canManage={canManage} provider={provider} onArchive={(item) => setConfirmation({provider: item, action: "archive"})} onEdit={openEdit} onReactivate={(item) => setConfirmation({provider: item, action: "reactivate"})} />
                </article>
              ))}
            </div>
          </>
        ) : null}
      </section>

      <ProviderFormDialog countryCode={countryCode} provider={formState.provider} onClose={() => setFormState({open: false, provider: null})} onSubmit={saveProvider} open={formState.open} />

      <ResponsiveDialog
        description={confirmationIsArchive
          ? "El proveedor dejará de estar disponible para nuevas operaciones, pero su información histórica se conservará."
          : "El proveedor volverá a estar disponible para las operaciones del negocio."}
        footer={(
          <>
            <Button type="button" variant="secondary" disabled={changingStatus} onClick={() => setConfirmation(null)}>Cancelar</Button>
            <Button type="button" variant={confirmationIsArchive ? "danger" : "primary"} disabled={changingStatus} onClick={confirmStatusChange}>
              {changingStatus ? "Procesando..." : confirmationIsArchive ? "Archivar proveedor" : "Reactivar proveedor"}
            </Button>
          </>
        )}
        onClose={() => {if (!changingStatus) setConfirmation(null);}}
        open={Boolean(confirmation)}
        size="small"
        title={confirmationIsArchive ? "Archivar proveedor" : "Reactivar proveedor"}
      >
        <p className="client-confirmation-copy">{confirmation?.provider.razonSocial}</p>
      </ResponsiveDialog>
    </section>
  );
}

export default ProvidersManager;
