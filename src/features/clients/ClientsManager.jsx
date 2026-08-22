import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  UsersRound,
} from "lucide-react";
import AppIcon from "../../components/ui/AppIcon";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import StatusBadge from "../../components/ui/StatusBadge";
import { matchesClientSearch } from "../../domain/clientModel.mjs";
import {getFiscalIdentifierLabel} from "../../domain/fiscalIdentifier.mjs";
import {
  actualizarCliente,
  archivarCliente,
  crearCliente,
  getClientErrorMessage,
  listarClientes,
  reactivarCliente,
} from "../../services/clientService";
import ClientFormDialog from "./ClientFormDialog";

const READ_ROLES = new Set(["OWNER", "ADMIN", "VENTAS", "MEMBER"]);
const WRITE_ROLES = new Set(["OWNER", "ADMIN", "VENTAS"]);

function contactSummary(client) {
  return client.email || client.telefono || "Sin datos de contacto";
}

function locationSummary(client) {
  return [client.direccion, client.comunaNombre, client.regionNombre]
    .filter(Boolean)
    .join(", ") || "Sin ubicación";
}

function ClientActions({canManage, client, onArchive, onEdit, onReactivate}) {
  if (!canManage) return <span className="client-readonly-label">Solo lectura</span>;
  return (
    <div className="client-row-actions">
      {client.estado === "activo" ? (
        <>
          <button
            type="button"
            onClick={() => onEdit(client)}
            aria-label={`Editar a ${client.nombreRazonSocial}`}
            title="Editar cliente"
          >
            <AppIcon icon={Pencil} size={17} />
          </button>
          <button
            type="button"
            onClick={() => onArchive(client)}
            aria-label={`Archivar a ${client.nombreRazonSocial}`}
            title="Archivar cliente"
          >
            <AppIcon icon={Archive} size={17} />
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => onReactivate(client)}
          aria-label={`Reactivar a ${client.nombreRazonSocial}`}
          title="Reactivar cliente"
        >
          <AppIcon icon={RotateCcw} size={17} />
        </button>
      )}
    </div>
  );
}

function ClientsManager({businessId, countryCode = "CL", role}) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [feedbackIsError, setFeedbackIsError] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [formState, setFormState] = useState({open: false, client: null});
  const [confirmation, setConfirmation] = useState(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const canRead = READ_ROLES.has(role);
  const canManage = WRITE_ROLES.has(role);
  const fiscalLabel = getFiscalIdentifierLabel(countryCode);

  const loadClients = useCallback(async () => {
    if (!businessId || !canRead) {
      setClients([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      setClients(await listarClientes(businessId));
    } catch (error) {
      setLoadError(getClientErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [businessId, canRead]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const visibleClients = useMemo(
    () =>
      clients.filter(
        (client) =>
          (!statusFilter || client.estado === statusFilter) &&
          matchesClientSearch(client, search)
      ),
    [clients, search, statusFilter]
  );

  const openCreate = () => {
    setFeedback("");
    setFeedbackIsError(false);
    setFormState({open: true, client: null});
  };

  const openEdit = (client) => {
    setFeedback("");
    setFeedbackIsError(false);
    setFormState({open: true, client});
  };

  const saveClient = async (payload) => {
    if (formState.client) {
      await actualizarCliente(
        businessId,
        formState.client.clienteId,
        payload
      );
      setFeedback("Cliente actualizado correctamente.");
    } else {
      await crearCliente(businessId, payload);
      setFeedback("Cliente creado correctamente.");
    }
    setFeedbackIsError(false);
    await loadClients();
  };

  const confirmStatusChange = async () => {
    if (!confirmation || changingStatus) return;
    setChangingStatus(true);
    setFeedback("");
    setFeedbackIsError(false);
    try {
      if (confirmation.action === "archive") {
        await archivarCliente(businessId, confirmation.client.clienteId);
        setFeedback(`Cliente archivado. Su ${fiscalLabel} continúa reservado.`);
      } else {
        await reactivarCliente(businessId, confirmation.client.clienteId);
        setFeedback("Cliente reactivado correctamente.");
      }
      setConfirmation(null);
      await loadClients();
    } catch (error) {
      setFeedback(getClientErrorMessage(error));
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
          No tienes permisos para consultar clientes en el negocio activo.
        </div>
      </section>
    );
  }

  const hasFilters = Boolean(search.trim() || statusFilter);
  const confirmationIsArchive = confirmation?.action === "archive";

  return (
    <section className="erp-page clients-page">
      <div className="erp-module-intro">
        <div className="erp-page-intro">
          <p>
            Mantén una ficha única por {fiscalLabel} para cada cliente del negocio activo.
          </p>
        </div>
        {canManage && (
          <Button icon={Plus} onClick={openCreate}>
            Nuevo cliente
          </Button>
        )}
      </div>

      {!canManage && (
        <div className="client-message client-message--warning" role="status">
          Tu rol MEMBER tiene acceso de lectura. OWNER o ADMIN deben crear y
          modificar clientes.
        </div>
      )}
      {feedback && (
        <div
          className={`client-message${feedbackIsError ? " client-message--error" : ""}`}
          role={feedbackIsError ? "alert" : "status"}
          aria-live="polite"
        >
          {feedback}
        </div>
      )}
      {loadError && (
        <div className="client-message client-message--error" role="alert">
          <span>{loadError}</span>
          <Button
            type="button"
            variant="secondary"
            icon={RefreshCw}
            onClick={loadClients}
          >
            Reintentar
          </Button>
        </div>
      )}

      <section className="erp-panel" aria-labelledby="clients-list-title">
        <div className="erp-panel-header clients-panel-header">
          <div>
            <h2 id="clients-list-title" className="erp-panel-title">
              Clientes registrados
            </h2>
            <p className="erp-secondary-text">
              {hasFilters
                ? `${visibleClients.length} de ${clients.length} clientes`
                : `${clients.length} ${clients.length === 1 ? "cliente" : "clientes"}`}
            </p>
          </div>
        </div>

        <div className="erp-filters clients-filters no-print">
          <label className="erp-field clients-search-field">
            <span className="erp-field__label">Buscar por nombre o {fiscalLabel}</span>
            <span className="clients-search-control">
              <AppIcon icon={Search} size={18} />
              <input
                className="erp-control"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                maxLength={200}
                placeholder="Ej.: Acme o 12.345.678-5"
              />
            </span>
          </label>
          <label className="erp-field">
            <span className="erp-field__label">Estado</span>
            <select
              className="erp-control"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">Todos</option>
              <option value="activo">Activos</option>
              <option value="archivado">Archivados</option>
            </select>
          </label>
        </div>

        {loading ? (
          <div className="erp-empty-state" role="status">
            Cargando clientes del negocio activo...
          </div>
        ) : !loadError && visibleClients.length === 0 ? (
          <div className="erp-empty-state clients-empty-state">
            <AppIcon icon={UsersRound} size={28} />
            <h3>{hasFilters ? "No hay coincidencias" : "Aún no hay clientes"}</h3>
            <p>
              {hasFilters
                ? `Prueba con otro nombre, ${fiscalLabel} o estado.`
                : canManage
                  ? "Crea el primer cliente para comenzar tu registro comercial."
                  : "OWNER o ADMIN pueden registrar el primer cliente."}
            </p>
            {!hasFilters && canManage && (
              <Button type="button" icon={Plus} onClick={openCreate}>
                Crear primer cliente
              </Button>
            )}
          </div>
        ) : !loadError ? (
          <>
            <div className="erp-table-region erp-desktop-only">
              <table className="erp-table clients-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Contacto</th>
                    <th>Ubicación</th>
                    <th>Estado</th>
                    <th className="clients-actions-column">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleClients.map((client) => (
                    <tr key={client.clienteId}>
                      <td>
                        <strong className="clients-table__name">
                          {client.nombreRazonSocial}
                        </strong>
                        <span className="clients-table__secondary">
                          {client.tipoCliente === "persona" ? "Persona" : "Empresa"} · {client.identificadorFiscalValor || client.rut}
                        </span>
                      </td>
                      <td>
                        <span>{contactSummary(client)}</span>
                        {client.email && client.telefono && (
                          <span className="clients-table__secondary">
                            {client.telefono}
                          </span>
                        )}
                      </td>
                      <td>{locationSummary(client)}</td>
                      <td>
                        <StatusBadge
                          variant={client.estado === "activo" ? "success" : "neutral"}
                        >
                          {client.estado === "activo" ? "Activo" : "Archivado"}
                        </StatusBadge>
                      </td>
                      <td className="clients-actions-column">
                        <ClientActions
                          canManage={canManage}
                          client={client}
                          onArchive={(item) => setConfirmation({client: item, action: "archive"})}
                          onEdit={openEdit}
                          onReactivate={(item) => setConfirmation({client: item, action: "reactivate"})}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="erp-card-list erp-mobile-only">
              {visibleClients.map((client) => (
                <article className="erp-record-card client-card" key={client.clienteId}>
                  <header className="erp-record-card__header">
                    <div>
                      <h3 className="erp-record-card__title">
                        {client.nombreRazonSocial}
                      </h3>
                      <span className="clients-table__secondary">
                        {client.tipoCliente === "persona" ? "Persona" : "Empresa"} · {client.identificadorFiscalValor || client.rut}
                      </span>
                    </div>
                    <StatusBadge
                      variant={client.estado === "activo" ? "success" : "neutral"}
                    >
                      {client.estado === "activo" ? "Activo" : "Archivado"}
                    </StatusBadge>
                  </header>
                  <dl className="client-card__details">
                    <div><dt>Contacto</dt><dd>{contactSummary(client)}</dd></div>
                    <div><dt>Ubicación</dt><dd>{locationSummary(client)}</dd></div>
                  </dl>
                  <ClientActions
                    canManage={canManage}
                    client={client}
                    onArchive={(item) => setConfirmation({client: item, action: "archive"})}
                    onEdit={openEdit}
                    onReactivate={(item) => setConfirmation({client: item, action: "reactivate"})}
                  />
                </article>
              ))}
            </div>
          </>
        ) : null}
      </section>

      <ClientFormDialog
        client={formState.client}
        countryCode={countryCode}
        onClose={() => setFormState({open: false, client: null})}
        onSubmit={saveClient}
        open={formState.open}
      />

      <ResponsiveDialog
        description={
          confirmationIsArchive
            ? `El cliente dejará de estar activo, pero su ${fiscalLabel} seguirá reservado.`
            : "El cliente volverá a estar disponible para las operaciones del negocio."
        }
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={changingStatus}
              onClick={() => setConfirmation(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant={confirmationIsArchive ? "danger" : "primary"}
              disabled={changingStatus}
              onClick={confirmStatusChange}
            >
              {changingStatus
                ? "Procesando..."
                : confirmationIsArchive
                  ? "Archivar cliente"
                  : "Reactivar cliente"}
            </Button>
          </>
        }
        onClose={() => {
          if (!changingStatus) setConfirmation(null);
        }}
        open={Boolean(confirmation)}
        size="small"
        title={confirmationIsArchive ? "Archivar cliente" : "Reactivar cliente"}
      >
        <p className="client-confirmation-copy">
          {confirmation?.client.nombreRazonSocial}
        </p>
      </ResponsiveDialog>
    </section>
  );
}

export default ClientsManager;
