import React, {useMemo, useState} from "react";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";

const searchable = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export default function SaleClientSelector({clients, disabled, onChange, originalSnapshot, value}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = clients.find((client) => client.clienteId === value);
  const historical = originalSnapshot?.clienteId === value;
  const display = historical ? originalSnapshot : selected;
  const visible = useMemo(() => clients.filter((client) => client.estado === "activo" && searchable(`${client.nombreRazonSocial} ${client.rut}`).includes(searchable(search))), [clients, search]);

  return (
    <div className="sale-context-client">
      <div className="sale-context-client__content">
        <span className="po-kicker">Cliente</span>
        {display ? (
          <>
            <strong className="sale-context-client__name">{display.nombreRazonSocial}</strong>
            <div className="sale-context-client__metadata">
              <span>{display.identificadorFiscalTipo || "Identificación fiscal"} {display.identificadorFiscalValor || display.rut || "no informada"}</span>
              <span>{display.personaContacto || display.email || "Sin contacto informado"}</span>
            </div>
            {historical && <em className="sale-context-client__snapshot">Snapshot histórico conservado</em>}
          </>
        ) : <p>Selecciona un cliente activo.</p>}
      </div>
      {!disabled && <button type="button" className="po-button po-button--secondary sale-context-client__action" onClick={() => setOpen(true)}>{display ? "Cambiar cliente" : "Seleccionar cliente"}</button>}

      <ResponsiveDialog open={open} onClose={() => setOpen(false)} title="Seleccionar cliente" description="Solo se muestran clientes activos del negocio." size="medium">
        <div className="po-selector">
          <input aria-label="Buscar cliente" placeholder="Buscar por nombre o identificación fiscal" value={search} onChange={(event) => setSearch(event.target.value)} />
          <div className="po-selector__list">
            {visible.map((client) => <button type="button" key={client.clienteId} onClick={() => { onChange(client.clienteId); setOpen(false); setSearch(""); }}><strong>{client.nombreRazonSocial}</strong><span>{client.identificadorFiscalValor || client.rut || "Sin identificación fiscal"} · {client.email || client.telefono || "Sin contacto"}</span></button>)}
            {!visible.length && <p>No hay clientes activos coincidentes.</p>}
          </div>
        </div>
      </ResponsiveDialog>
    </div>
  );
}
