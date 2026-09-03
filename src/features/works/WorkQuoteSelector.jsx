import React, {useMemo, useState} from "react";
import {Search} from "lucide-react";
import AppIcon from "../../components/ui/AppIcon";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {normalizeWorkSearch} from "../../domain/workModel.mjs";
import {formatMoney} from "../../utils/formatters.js";

// Selector buscable de la Cotización asociada a un Proyecto (PROJECTS_V3
// ETAPA 1, SPEC 019). Presentacional/controlado: recibe `options` ya
// calculadas por getEligibleWorkQuoteOptions (mismo arreglo que hoy consume
// el <select> que reemplaza) y filtra en memoria, sin ninguna consulta
// remota nueva. La búsqueda usa exclusivamente los campos reales ya
// expuestos por adaptStoredQuote: numero, clienteNombre, clienteRut y
// proyectoNombre. No existe un campo "descripción" a nivel de Cotización.

// Lógica pura de búsqueda, exportada para poder probarse sin renderizar el
// diálogo (ResponsiveDialog usa createPortal/document, no disponible en SSR).
export function getWorkQuoteSearchText({quote}) {
  return [quote.numero, quote.clienteNombre, quote.cliente?.empresa, quote.clienteRut, quote.proyectoNombre]
    .filter(Boolean)
    .join(" ");
}

export function filterWorkQuoteOptions(options, search) {
  const list = Array.isArray(options) ? options : [];
  const query = normalizeWorkSearch(search);
  if (!query) return list;
  return list.filter((option) => normalizeWorkSearch(getWorkQuoteSearchText(option)).includes(query));
}

export function getWorkQuoteSummaryLabel({quote}, currencyCode) {
  const clientName = quote.clienteNombre || quote.cliente?.empresa || "Cliente sin nombre";
  return `${quote.numero || "COT"} · ${clientName} · ${formatMoney(quote.total, quote.moneda || currencyCode)}`;
}

export default function WorkQuoteSelector({currencyCode, disabled, loading = false, onChange, options, value}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = useMemo(() => options.find(({quote}) => quote.id === value) || null, [options, value]);
  const visible = useMemo(() => filterWorkQuoteOptions(options, search), [options, search]);

  const pick = (quoteId) => { onChange(quoteId); setOpen(false); setSearch(""); };

  return (
    <div className="works-quote-selector">
      <div className="works-quote-selector__summary">
        {selected
          ? <strong>{getWorkQuoteSummaryLabel(selected, currencyCode)}</strong>
          : <span className="works-empty-copy">{disabled ? "Vínculo comercial existente" : "Sin cotización asociada"}</span>}
      </div>
      {!disabled && (
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          {selected ? "Cambiar cotización" : "Seleccionar cotización"}
        </Button>
      )}

      <ResponsiveDialog
        open={open}
        onClose={() => setOpen(false)}
        size="medium"
        title="Seleccionar cotización"
        description="Sólo se muestran cotizaciones aceptadas con venta confirmada, elegibles para este proyecto."
      >
        <div className="works-quote-selector__picker">
          <label className="works-search-control">
            <AppIcon icon={Search} size={18} />
            <input
              aria-label="Buscar cotización"
              className="erp-control"
              placeholder="Buscar por número, cliente o proyecto"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="works-quote-selector__list">
            {value && (
              <button type="button" className="works-quote-selector__clear" onClick={() => pick("")}>
                Sin cotización asociada
              </button>
            )}
            {loading && <p className="works-empty-copy">Cargando cotizaciones...</p>}
            {!loading && visible.map((option) => (
              <button type="button" key={option.quote.id} onClick={() => pick(option.quote.id)}>
                <strong>{option.quote.numero || "COT"}</strong>
                <span>{option.quote.clienteNombre || option.quote.cliente?.empresa || "Cliente sin nombre"} · {formatMoney(option.quote.total, option.quote.moneda || currencyCode)}</span>
              </button>
            ))}
            {!loading && !visible.length && (
              <p className="works-empty-copy">
                {options.length ? "No hay cotizaciones que coincidan con la búsqueda." : "No hay cotizaciones elegibles para vincular."}
              </p>
            )}
          </div>
        </div>
      </ResponsiveDialog>
    </div>
  );
}
