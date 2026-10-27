import React, {useEffect, useMemo, useRef, useState} from "react";
import {Link} from "react-router-dom";
import {Search, UserRoundSearch} from "lucide-react";
import AppIcon from "../../components/ui/AppIcon";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {filterSelectableClients} from "../../domain/clientModel.mjs";
import {
  getClientErrorMessage,
  listarClientes,
} from "../../services/clientService";

const SEARCH_MAX_LENGTH = 200;

function clientName(client) {
  return client?.nombreRazonSocial || client?.empresa || "Cliente sin nombre";
}

// Con `inline` el buscador y la lista van en la propia tarjeta (sin diálogo); es opcional y sin él el
// componente se comporta exactamente como siempre: mismo filtro, mismo onChange(client).
function ClientSelector({
  businessId,
  inline = false,
  onAvailabilityChange,
  onChange,
  snapshot,
  value,
}) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(Boolean(businessId));
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [changing, setChanging] = useState(false);
  const searchInputRef = useRef(null);
  const changeButtonRef = useRef(null);
  const restoreFocusRef = useRef(false);
  const previousBusinessIdRef = useRef(businessId);

  useEffect(() => {
    let cancelled = false;
    const businessChanged = previousBusinessIdRef.current !== businessId;
    previousBusinessIdRef.current = businessId;

    setClients([]);
    setError("");
    setOpen(false);
    setSearch("");
    setChanging(false);
    if (businessChanged) onChange?.(null);

    if (!businessId) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    listarClientes(businessId)
      .then((items) => {
        if (!cancelled) setClients(items);
      })
      .catch((loadError) => {
        if (!cancelled) setError(getClientErrorMessage(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [businessId, onChange]);

  const activeClients = useMemo(
    () => filterSelectableClients(clients, businessId),
    [businessId, clients]
  );
  const visibleClients = useMemo(
    () => filterSelectableClients(clients, businessId, search),
    [businessId, clients, search]
  );

  useEffect(() => {
    onAvailabilityChange?.({
      error,
      hasActiveClients: activeClients.length > 0,
      loading,
    });
  }, [activeClients.length, error, loading, onAvailabilityChange]);

  const hasHistoricalSnapshot = !value && Boolean(
    snapshot?.nombreRazonSocial || snapshot?.empresa || snapshot?.rut
  );
  const hasSelection = Boolean(value) || hasHistoricalSnapshot;
  const picking = inline && (!hasSelection || changing);

  const finishInlinePicking = () => {
    restoreFocusRef.current = true;
    setChanging(false);
    setSearch("");
  };

  const selectClient = (client) => {
    onChange?.(client);
    setOpen(false);
    setSearch("");
    if (inline) finishInlinePicking();
  };

  useEffect(() => {
    if (changing) searchInputRef.current?.focus();
  }, [changing]);

  useEffect(() => {
    if (!picking && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      changeButtonRef.current?.focus();
    }
  }, [picking]);

  return (
    <div className={inline ? "client-selector client-selector--inline" : "client-selector"}>
      {picking ? (
        <div className="client-selector__inline-picker">
          <label className="client-selector__search">
            <span className="sr-only">Buscar cliente</span>
            <div>
              <AppIcon icon={Search} size={18} />
              <input
                ref={searchInputRef}
                type="search"
                value={search}
                maxLength={SEARCH_MAX_LENGTH}
                disabled={!businessId || loading || Boolean(error)}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && hasSelection) finishInlinePicking();
                }}
                placeholder="Buscar cliente por nombre o RUT"
              />
            </div>
          </label>
          {visibleClients.length > 0 ? (
            <div className="client-selector__results" role="list">
              {visibleClients.map((client) => (
                <div key={client.clienteId} role="listitem">
                  <button
                    type="button"
                    className="client-selector__result"
                    aria-pressed={client.clienteId === value}
                    onClick={() => selectClient(client)}
                  >
                    <strong>{clientName(client)}</strong>
                    <span>{client.identificadorFiscalValor || client.rut}</span>
                    <small>{client.email || client.telefono || "Sin datos de contacto"}</small>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            !loading && !error && activeClients.length > 0 && (
              <p className="client-selector__status">No encontramos coincidencias.</p>
            )
          )}
          {hasSelection && (
            <Button type="button" variant="ghost" onClick={finishInlinePicking}>
              Cancelar
            </Button>
          )}
        </div>
      ) : hasSelection ? (
        <div className="client-selector__summary">
          <div>
            <div className="client-selector__heading">
              <strong>{clientName(snapshot)}</strong>
              <span className={value ? "client-selector__badge" : "client-selector__badge client-selector__badge--legacy"}>
                {value ? "Cliente registrado" : "Cliente histórico no vinculado"}
              </span>
            </div>
            <p>{snapshot?.identificadorFiscalValor || snapshot?.rut || "Sin identificación fiscal"}</p>
            <p>
              {[snapshot?.email, snapshot?.telefono].filter(Boolean).join(" · ") ||
                "Sin datos de contacto"}
            </p>
            <p>
              {[
                snapshot?.direccion,
                snapshot?.comunaNombre || snapshot?.ciudad,
                snapshot?.regionNombre,
              ].filter(Boolean).join(", ") || "Sin dirección"}
            </p>
          </div>
          <Button
            ref={changeButtonRef}
            type="button"
            variant="secondary"
            onClick={() => (inline ? setChanging(true) : setOpen(true))}
          >
            Cambiar cliente
          </Button>
        </div>
      ) : (
        <div className="client-selector__empty-selection">
          <AppIcon icon={UserRoundSearch} size={24} />
          <div>
            <strong>Selecciona un cliente registrado</strong>
            <p>La cotización guardará una copia histórica de sus datos.</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={!businessId || loading || Boolean(error)}
            onClick={() => setOpen(true)}
          >
            Seleccionar cliente
          </Button>
        </div>
      )}

      {loading && <LoadingState variant="inline" label="Cargando clientes activos…" />}
      {error && <p className="client-selector__status client-selector__status--error" role="alert">{error}</p>}
      {!loading && !error && activeClients.length === 0 && (
        <p className="client-selector__status">
          No hay clientes activos. <Link to="/clientes">Ir a Clientes</Link>
        </p>
      )}

      {!inline && <ResponsiveDialog
        open={open}
        onClose={() => setOpen(false)}
        initialFocusRef={searchInputRef}
        size="medium"
        eyebrow="Cotización"
        title="Seleccionar cliente"
        description="Busca por nombre o identificación fiscal. Solo se muestran clientes activos del negocio actual."
      >
        <label className="client-selector__search">
          <span>Buscar cliente</span>
          <div>
            <AppIcon icon={Search} size={18} />
            <input
              ref={searchInputRef}
              type="search"
              value={search}
              maxLength={SEARCH_MAX_LENGTH}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nombre o identificación fiscal"
            />
          </div>
        </label>

        {visibleClients.length > 0 ? (
          <div className="client-selector__results" role="list">
            {visibleClients.map((client) => (
              <div key={client.clienteId} role="listitem">
                <button
                  type="button"
                  className="client-selector__result"
                  aria-pressed={client.clienteId === value}
                  onClick={() => selectClient(client)}
                >
                  <strong>{clientName(client)}</strong>
                  <span>{client.identificadorFiscalValor || client.rut}</span>
                  <small>{client.email || client.telefono || "Sin datos de contacto"}</small>
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="client-selector__no-results" role="status">
            <p>{search ? "No encontramos coincidencias." : "No hay clientes activos."}</p>
            <Link to="/clientes" onClick={() => setOpen(false)}>Ir a Clientes</Link>
          </div>
        )}
      </ResponsiveDialog>}
    </div>
  );
}

export default ClientSelector;
