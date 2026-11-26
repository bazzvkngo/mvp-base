import React, {useEffect, useMemo, useRef, useState} from "react";
import InlinePartySelector from "../../components/ui/InlinePartySelector";
import LoadingState from "../../components/ui/LoadingState";
import Notice from "../../components/ui/Notice";
import {filterSelectableClients, matchesClientSearch} from "../../domain/clientModel.mjs";
import {getClientFiscalListLabel} from "../../domain/countryFormCopy.mjs";
import useBusinessFormat from "../../hooks/useBusinessFormat";
import {getClientErrorMessage, listarClientes} from "../../services/clientService";

// Cliente de la cotización: el mismo selector en línea que usan Compras y Órdenes de compra (InlinePartySelector), con
// los datos del cliente. Solo presentación: la lista (listarClientes), el filtro (filterSelectableClients /
// matchesClientSearch), el aviso de disponibilidad y el `onChange(client | null)` son los de siempre.
// No reemplaza a features/clients/ClientSelector, que sigue siendo el de Taller (propietario del vehículo).
const NOUN = Object.freeze({singular: "cliente", plural: "clientes", pluralTitle: "Clientes", route: "/clientes", purpose: "cotizar"});
const HISTORICAL_NOTE = "Datos del cliente guardados en la cotización";
const getId = (client) => client?.clienteId;
const getName = (client) => client?.nombreRazonSocial || client?.empresa || "Cliente sin nombre";
const getFiscal = (client) => {
  const value = client?.identificadorFiscalValor || client?.rut || "";
  return `${client?.identificadorFiscalTipo || "Identificación fiscal"} ${value || "no informada"}`.trim();
};
const getContact = (client) => client?.personaContacto || client?.email || client?.telefono || "";
const getOptionFiscal = (client) => client?.identificadorFiscalValor || client?.rut || "";

// Parte de presentación: el selector en línea con la lista de clientes activos que recibe.
export function QuoteClientPicker({clients, onChange, originalSnapshot, snapshot, value}) {
  const fiscalLabel = getClientFiscalListLabel(useBusinessFormat().countryCode);
  // Cotización antigua con los datos de un cliente pero sin vínculo: no hay "cliente elegido" que mostrar, pero el dato
  // histórico no debe desaparecer de la pantalla.
  const legacyName = !value && (snapshot?.nombreRazonSocial || snapshot?.empresa);
  // Dato congelado de la cotización: el guardado al abrirla si coincide con la selección y, si el cliente elegido ya no
  // está entre los activos, la copia que lleva la cotización (así la pantalla nunca queda sin cliente con uno elegido).
  const known = clients.some((client) => client.clienteId === value);
  const frozen = originalSnapshot?.clienteId === value ? originalSnapshot : (value && !known && snapshot?.clienteId === value ? snapshot : undefined);
  return (
    <>
      {legacyName && <p className="ui-party__more">Cliente histórico no vinculado: {legacyName}. Elige un cliente registrado para vincularlo.</p>}
      <InlinePartySelector
        fiscalLabel={fiscalLabel}
        getContact={getContact}
        getFiscal={getFiscal}
        getId={getId}
        getName={getName}
        getOptionFiscal={getOptionFiscal}
        historicalNote={HISTORICAL_NOTE}
        matches={matchesClientSearch}
        noun={NOUN}
        onChange={(clienteId) => {
          const client = clients.find((entry) => entry.clienteId === clienteId);
          if (client) onChange?.(client);
        }}
        originalSnapshot={frozen}
        parties={clients}
        value={value}
      />
    </>
  );
}

export default function QuoteClientSelector({businessId, onAvailabilityChange, onChange, originalSnapshot, snapshot, value}) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(Boolean(businessId));
  const [error, setError] = useState("");
  const previousBusinessId = useRef(businessId);

  useEffect(() => {
    let cancelled = false;
    const businessChanged = previousBusinessId.current !== businessId;
    previousBusinessId.current = businessId;
    setClients([]);
    setError("");
    if (businessChanged) onChange?.(null);
    if (!businessId) {
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    listarClientes(businessId)
      .then((items) => { if (!cancelled) setClients(items); })
      .catch((loadError) => { if (!cancelled) setError(getClientErrorMessage(loadError)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [businessId, onChange]);

  const activeClients = useMemo(() => filterSelectableClients(clients, businessId), [businessId, clients]);

  useEffect(() => {
    onAvailabilityChange?.({error, hasActiveClients: activeClients.length > 0, loading});
  }, [activeClients.length, error, loading, onAvailabilityChange]);

  if (loading) return <LoadingState variant="inline" label="Cargando clientes activos…" />;
  if (error) return <Notice variant="error">{error}</Notice>;

  return <QuoteClientPicker clients={activeClients} onChange={onChange} originalSnapshot={originalSnapshot} snapshot={snapshot} value={value} />;
}
