import React, {useEffect, useMemo, useRef, useState} from "react";
import {Link} from "react-router-dom";
import Button from "./Button";
import ResponsiveDialog from "./ResponsiveDialog";

// Selector en línea de la contraparte de un documento (hoy: proveedor de Compra). Mismo patrón que el cliente de
// Venta: tarjeta de la contraparte elegida con "Cambiar", buscador por nombre o identificación fiscal, línea
// "Tienes N … activos" con el enlace "Ver todos los …" (abre la lista completa en una ventana) y, sin registros, un
// aviso con enlace a su módulo. Solo presentación: la lista, el filtro y `onChange` los entrega la pantalla.
// - parties: lista completa (el componente muestra solo los activos).
// - noun: {singular, plural, pluralTitle, route, purpose} para armar los textos ("proveedor", "proveedores"...).
// - getId/getName/getFiscal/getContact: lectura de cada campo; getFiscal y getContact devuelven texto ya listo.
//   getOptionFiscal (opcional, por defecto getFiscal) es el identificador que se muestra en las opciones de la lista.
// - matches(party, search): filtro de búsqueda del dominio.
// - fiscalLabel: etiqueta del identificador fiscal del país, para la línea guía.
// - originalSnapshot / historicalNote: dato congelado del documento guardado, si coincide con la selección.
const INLINE_RESULTS_LIMIT = 6;

const countText = (count, noun) => (count === 1 ? `1 ${noun.singular} activo` : `${count} ${noun.plural} activos`);

function PartyDialog({getContact, getId, getName, getOptionFiscal, matches, noun, onClose, onPick, open, parties}) {
  const [search, setSearch] = useState("");
  const visible = useMemo(() => parties.filter((party) => party.estado === "activo" && matches(party, search)), [matches, parties, search]);
  const close = () => { onClose(); setSearch(""); };

  return (
    <ResponsiveDialog open={open} onClose={close} title={`Seleccionar ${noun.singular}`} description={`Solo se muestran ${noun.plural} activos del negocio.`} size="medium">
      <div className="ui-party-dialog">
        <input className="ui-party__search" aria-label={`Buscar ${noun.singular}`} placeholder="Buscar por nombre o identificación fiscal" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="ui-party-dialog__list">
          {visible.map((party) => (
            <button type="button" className="ui-party-dialog__option" key={getId(party)} onClick={() => { onPick(getId(party)); setSearch(""); }}>
              <strong>{getName(party)}</strong>
              <span>{getOptionFiscal(party) || "Sin identificación fiscal"} · {getContact(party) || "Sin contacto"}</span>
            </button>
          ))}
          {!visible.length && <p className="ui-party__empty">No hay {noun.plural} activos coincidentes.</p>}
        </div>
      </div>
    </ResponsiveDialog>
  );
}

export default function InlinePartySelector({
  disabled = false,
  fiscalLabel,
  getContact,
  getFiscal,
  getId,
  getName,
  getOptionFiscal = getFiscal,
  historicalNote = "Snapshot histórico conservado",
  matches,
  noun,
  onChange,
  originalSnapshot,
  parties,
  value,
}) {
  const [changing, setChanging] = useState(false);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const searchRef = useRef(null);
  const changeRef = useRef(null);
  const restoreFocus = useRef(false);
  const selected = parties.find((party) => getId(party) === value);
  const historical = Boolean(value) && getId(originalSnapshot || {}) === value;
  const display = historical ? originalSnapshot : selected;
  const visible = useMemo(() => parties.filter((party) => party.estado === "activo" && matches(party, search)), [matches, parties, search]);
  const activeCount = parties.filter((party) => party.estado === "activo").length;
  const noParties = activeCount === 0;
  // No se dibuja ninguna lista hasta que se escribe: solo el buscador y cuántos registros hay.
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
    <div className="ui-party">
      {display && !picking && (
        <div className="ui-party__selected">
          <div className="ui-party__info">
            <strong className="ui-party__name">{getName(display)}</strong>
            <span>{getFiscal(display)}</span>
            <span>{getContact(display) || "Sin contacto informado"}</span>
            {historical && <em className="ui-party__snapshot">{historicalNote}</em>}
          </div>
          {!disabled && <Button ref={changeRef} type="button" variant="secondary" className="ui-party__change" onClick={() => setChanging(true)}>Cambiar {noun.singular}</Button>}
        </div>
      )}
      {!display && disabled && <p className="ui-party__empty">Selecciona un {noun.singular} activo.</p>}
      {picking && noParties && (
        <div className="ui-party__none">
          <strong>Aún no tienes {noun.plural}</strong>
          <p>Crea uno en {noun.pluralTitle} para poder {noun.purpose}.</p>
          <Link className="ui-party__link" to={noun.route}>Ir a {noun.pluralTitle}</Link>
          {display && <button type="button" className="ui-party__cancel" onClick={finish}>Cancelar</button>}
        </div>
      )}
      {picking && !noParties && (
        <div className="ui-party__picker">
          <input ref={searchRef} className="ui-party__search" type="search" aria-label={`Buscar ${noun.singular}`} placeholder="Buscar por nombre o identificación fiscal" value={search} onChange={(event) => setSearch(event.target.value)} />
          <p className="sr-only" aria-live="polite">{searching ? (visible.length === 0 ? "Sin resultados" : visible.length === 1 ? "1 resultado" : `${visible.length} resultados`) : ""}</p>
          {!searching && (
            <div className="ui-party__count">
              <p className="ui-party__more">Tienes {countText(activeCount, noun)} · escribe un nombre o {fiscalLabel} para buscar</p>
              <button type="button" className="ui-party__all" aria-haspopup="dialog" aria-expanded={dialogOpen} onClick={() => setDialogOpen(true)}>Ver todos los {noun.plural}</button>
            </div>
          )}
          {searching && (
            <div className="ui-party__list">
              {visible.slice(0, INLINE_RESULTS_LIMIT).map((party) => (
                <button type="button" className="ui-party__option" key={getId(party)} onClick={() => { onChange(getId(party)); finish(); }}>
                  <strong>{getName(party)}</strong>
                  <span>{getOptionFiscal(party) || "Sin identificación fiscal"} · {getContact(party) || "Sin contacto"}</span>
                </button>
              ))}
              {!visible.length && <p className="ui-party__empty">No hay {noun.plural} activos coincidentes.</p>}
            </div>
          )}
          {searching && visible.length > INLINE_RESULTS_LIMIT && <p className="ui-party__more">Mostrando {INLINE_RESULTS_LIMIT} de {visible.length} · sigue escribiendo para afinar</p>}
          {display && <button type="button" className="ui-party__cancel" onClick={finish}>Cancelar</button>}
        </div>
      )}
      <PartyDialog getContact={getContact} getId={getId} getName={getName} getOptionFiscal={getOptionFiscal} matches={matches} noun={noun} open={dialogOpen} onClose={() => setDialogOpen(false)} onPick={(id) => { onChange(id); setDialogOpen(false); finish(); }} parties={parties} />
    </div>
  );
}
