import React, {useEffect, useMemo, useRef, useState} from "react";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";

const searchable = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Editor de la venta (borrador): el cliente se elige en línea, sin diálogo. Misma lista de
// clientes activos, mismo filtro y mismo onChange que la versión con diálogo.
function InlineSaleClientSelector({clients, disabled, onChange, originalSnapshot, value}) {
  const [changing, setChanging] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef(null);
  const changeRef = useRef(null);
  const restoreFocus = useRef(false);
  const selected = clients.find((client) => client.clienteId === value);
  const historical = originalSnapshot?.clienteId === value;
  const display = historical ? originalSnapshot : selected;
  const visible = useMemo(() => clients.filter((client) => client.estado === "activo" && searchable(`${client.nombreRazonSocial} ${client.rut}`).includes(searchable(search))), [clients, search]);
  const picking = !disabled && (!display || changing);

  useEffect(() => {
    if (changing) searchRef.current?.focus();
  }, [changing]);

  useEffect(() => {
    if (!picking && restoreFocus.current) {
      restoreFocus.current = false;
      changeRef.current?.focus();
    }
  }, [picking]);

  const finish = () => {
    restoreFocus.current = true;
    setChanging(false);
    setSearch("");
  };

  return (
    <div className="sale-client">
      {display && !picking && (
        <div className="sale-client__selected">
          <div className="sale-client__info">
            <strong className="sale-client__name">{display.nombreRazonSocial}</strong>
            <span>{display.identificadorFiscalTipo || "Identificación fiscal"} {display.identificadorFiscalValor || display.rut || "no informada"}</span>
            <span>{display.personaContacto || display.email || "Sin contacto informado"}</span>
            {historical && <em className="sale-context-client__snapshot">Snapshot histórico conservado</em>}
          </div>
          {!disabled && <Button ref={changeRef} type="button" variant="secondary" className="sale-client__change" onClick={() => setChanging(true)}>Cambiar cliente</Button>}
        </div>
      )}
      {!display && disabled && <p className="sale-client__empty">Selecciona un cliente activo.</p>}
      {picking && (
        <div className="sale-client__picker">
          <input ref={searchRef} className="sale-client__search" type="search" aria-label="Buscar cliente" placeholder="Buscar por nombre o identificación fiscal" value={search} onChange={(event) => setSearch(event.target.value)} />
          <div className="sale-client__list">
            {visible.map((client) => (
              <button type="button" className="sale-client__option" key={client.clienteId} onClick={() => { onChange(client.clienteId); finish(); }}>
                <strong>{client.nombreRazonSocial}</strong>
                <span>{client.identificadorFiscalValor || client.rut || "Sin identificación fiscal"} · {client.email || client.telefono || "Sin contacto"}</span>
              </button>
            ))}
            {!visible.length && <p className="sale-client__empty">No hay clientes activos coincidentes.</p>}
          </div>
          {display && <button type="button" className="sale-client__cancel" onClick={finish}>Cancelar</button>}
        </div>
      )}
    </div>
  );
}

export default function SaleClientSelector({inline = false, ...props}) {
  return inline ? <InlineSaleClientSelector {...props} /> : <DialogSaleClientSelector {...props} />;
}

function DialogSaleClientSelector({clients, disabled, onChange, originalSnapshot, value}) {
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
