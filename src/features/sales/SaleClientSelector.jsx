import React, {useEffect, useMemo, useRef, useState} from "react";
import {Link} from "react-router-dom";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";

// En el modo en línea se dibujan solo los primeros resultados; el resto se alcanza escribiendo.
const INLINE_RESULTS_LIMIT = 6;

const searchable = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Editor de la venta (borrador): el cliente se elige en línea, sin diálogo. Misma lista de
// clientes activos, mismo filtro y mismo onChange que la versión con diálogo.
function InlineSaleClientSelector({clients, disabled, onChange, originalSnapshot, value}) {
  const [changing, setChanging] = useState(false);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const searchRef = useRef(null);
  const changeRef = useRef(null);
  const restoreFocus = useRef(false);
  const selected = clients.find((client) => client.clienteId === value);
  const historical = originalSnapshot?.clienteId === value;
  const display = historical ? originalSnapshot : selected;
  const visible = useMemo(() => clients.filter((client) => client.estado === "activo" && searchable(`${client.nombreRazonSocial} ${client.rut}`).includes(searchable(search))), [clients, search]);
  const activeCount = clients.filter((client) => client.estado === "activo").length;
  const noClients = activeCount === 0;
  // En línea no se dibuja ninguna lista hasta que se escribe: solo el buscador y cuántos clientes hay.
  const searching = search.trim().length > 0;
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
      {picking && noClients && (
        <div className="sale-client__none">
          <strong>Aún no tienes clientes</strong>
          <p>Crea uno en Clientes para poder vender.</p>
          <Link className="sale-client__link" to="/clientes">Ir a Clientes</Link>
          {display && <button type="button" className="sale-client__cancel" onClick={finish}>Cancelar</button>}
        </div>
      )}
      {picking && !noClients && (
        <div className="sale-client__picker">
          <input ref={searchRef} className="sale-client__search" type="search" aria-label="Buscar cliente" placeholder="Buscar por nombre o identificación fiscal" value={search} onChange={(event) => setSearch(event.target.value)} />
          <p className="sr-only" aria-live="polite">{searching ? (visible.length === 0 ? "Sin resultados" : visible.length === 1 ? "1 resultado" : `${visible.length} resultados`) : ""}</p>
          {!searching && (
            <div className="sale-client__count">
              <p className="sale-client__more">Tienes {activeCount === 1 ? "1 cliente activo" : `${activeCount} clientes activos`} · escribe un nombre o RUT para buscar</p>
              <button type="button" className="sale-client__all" aria-haspopup="dialog" aria-expanded={dialogOpen} onClick={() => setDialogOpen(true)}>Ver todos los clientes</button>
            </div>
          )}
          {searching && (
            <div className="sale-client__list">
              {visible.slice(0, INLINE_RESULTS_LIMIT).map((client) => (
                <button type="button" className="sale-client__option" key={client.clienteId} onClick={() => { onChange(client.clienteId); finish(); }}>
                  <strong>{client.nombreRazonSocial}</strong>
                  <span>{client.identificadorFiscalValor || client.rut || "Sin identificación fiscal"} · {client.email || client.telefono || "Sin contacto"}</span>
                </button>
              ))}
              {!visible.length && <p className="sale-client__empty">No hay clientes activos coincidentes.</p>}
            </div>
          )}
          {searching && visible.length > INLINE_RESULTS_LIMIT && <p className="sale-client__more">Mostrando {INLINE_RESULTS_LIMIT} de {visible.length} · sigue escribiendo para afinar</p>}
          {display && <button type="button" className="sale-client__cancel" onClick={finish}>Cancelar</button>}
        </div>
      )}
      <SaleClientDialog clients={clients} open={dialogOpen} onClose={() => setDialogOpen(false)} onPick={(clienteId) => { onChange(clienteId); setDialogOpen(false); finish(); }} />
    </div>
  );
}

export default function SaleClientSelector({inline = false, ...props}) {
  return inline ? <InlineSaleClientSelector {...props} /> : <DialogSaleClientSelector {...props} />;
}

// Ventana con la lista completa de clientes activos y su buscador. La usan el selector con diálogo y el
// enlace "Ver todos los clientes" del selector en línea: misma lista, mismo filtro.
function SaleClientDialog({clients, onClose, onPick, open}) {
  const [search, setSearch] = useState("");
  const visible = useMemo(() => clients.filter((client) => client.estado === "activo" && searchable(`${client.nombreRazonSocial} ${client.rut}`).includes(searchable(search))), [clients, search]);
  const close = () => { onClose(); setSearch(""); };

  return (
    <ResponsiveDialog open={open} onClose={close} title="Seleccionar cliente" description="Solo se muestran clientes activos del negocio." size="medium">
      <div className="po-selector">
        <input aria-label="Buscar cliente" placeholder="Buscar por nombre o identificación fiscal" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="po-selector__list">
          {visible.map((client) => <button type="button" key={client.clienteId} onClick={() => { onPick(client.clienteId); setSearch(""); }}><strong>{client.nombreRazonSocial}</strong><span>{client.identificadorFiscalValor || client.rut || "Sin identificación fiscal"} · {client.email || client.telefono || "Sin contacto"}</span></button>)}
          {!visible.length && <p>No hay clientes activos coincidentes.</p>}
        </div>
      </div>
    </ResponsiveDialog>
  );
}

function DialogSaleClientSelector({clients, disabled, onChange, originalSnapshot, value}) {
  const [open, setOpen] = useState(false);
  const selected = clients.find((client) => client.clienteId === value);
  const historical = originalSnapshot?.clienteId === value;
  const display = historical ? originalSnapshot : selected;

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

      <SaleClientDialog clients={clients} open={open} onClose={() => setOpen(false)} onPick={(clienteId) => { onChange(clienteId); setOpen(false); }} />
    </div>
  );
}
