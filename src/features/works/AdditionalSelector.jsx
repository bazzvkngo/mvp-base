import React from "react";
import {formatMoney} from "../../utils/formatters.js";

// SPEC 020 ETAPA 5: selector de adicionales pendientes de un Proyecto, para
// incorporarlos como líneas al crear una Venta nueva vinculada a ese mismo
// Proyecto (src/pages/NewSalePage.jsx). Presentacional/controlado, mismo
// patrón de callbacks ya usado por WorkQuoteSelector/WorkAdditionalsSection:
// recibe `additionals` ya acotados (sólo PENDIENTE_COBRO del Proyecto
// correcto, cargados por el padre) y notifica selección vía `onToggle` — este
// componente no importa ningún servicio remoto propio. A diferencia de
// WorkQuoteSelector no hay búsqueda por texto ("NO query por tecla"): la
// lista de adicionales pendientes de un Proyecto es acotada por diseño, así
// que un listado simple de checkboxes es suficiente.

const ADDITIONAL_ITEM_TYPE_LABELS = Object.freeze({producto: "Producto", servicio: "Servicio", actividad: "Actividad"});

export function getWorkAdditionalOptionLabel(additional, currencyFallback) {
  const name = additional?.itemSnapshot?.nombre || "Ítem sin nombre";
  const type = ADDITIONAL_ITEM_TYPE_LABELS[additional?.tipoItem] || "Ítem";
  const unit = additional?.itemSnapshot?.unidad || "unidad";
  const price = formatMoney(additional?.precioUnitario, additional?.moneda || currencyFallback);
  return `${name} · ${type} · ${Number(additional?.cantidad || 0)} ${unit} × ${price}`;
}

export default function AdditionalSelector({additionals = [], currency, loading = false, onToggle, selectedIds = []}) {
  const selected = new Set(selectedIds);

  return (
    <section className="sale-additional-selector">
      <header>
        <h4>Adicionales pendientes del proyecto</h4>
        <span>Selecciona los que quieras incorporar a esta venta</span>
      </header>
      {loading && <p className="po-empty">Cargando adicionales...</p>}
      {!loading && !additionals.length && <p className="po-empty">Este proyecto no tiene adicionales pendientes de cobro.</p>}
      {!loading && additionals.length > 0 && (
        <ul className="sale-additional-selector__list">
          {additionals.map((additional) => (
            <li key={additional.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.has(additional.id)}
                  onChange={() => onToggle(additional)}
                />
                <span>{getWorkAdditionalOptionLabel(additional, currency)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
