import React, {useState} from "react";
import Button from "../../components/ui/Button";
import StatusBadge from "../../components/ui/StatusBadge";
import {formatMoney} from "../../utils/formatters.js";

// SPEC 020 ETAPA 4: sección aditiva de Adicionales facturables dentro de la
// ficha de Proyecto ya existente (mismo patrón visual/estructural que
// FinancialSection en WorksPage.jsx: works-detail-section, works-cost-form,
// works-cost-list, works-annul-form — sin CSS nuevo). Presentacional/
// controlado: recibe los adicionales ya cargados/adaptados y delega la
// creación/anulación a `onCreate`/`onAnnul`, resueltos por WorksPage.jsx
// (mismo patrón de callbacks ya usado por WorkTaskBoard con
// onRequestTaskState) — este componente no importa ningún servicio remoto
// propio, para poder probarse vía SSR igual que WorkQuoteSelector/WorkTaskBoard.
//
// Alcance explícito de ETAPA 4: crear/ver/anular un adicional PENDIENTE_COBRO.
// No hay ningún control para incorporarlo a una Venta ni para forzar su
// estado: ese estado siempre viene del backend autoritativo de ETAPA 2/3.

const ADDITIONAL_ITEM_TYPE_LABELS = Object.freeze({producto: "Producto", servicio: "Servicio", actividad: "Actividad"});
const ADDITIONAL_STATUS_LABELS = Object.freeze({
  PENDIENTE_COBRO: "Pendiente de cobro",
  INCORPORADO_A_VENTA: "Incorporado a venta",
  ANULADO: "Anulado",
});
const ADDITIONAL_STATUS_VARIANTS = Object.freeze({
  PENDIENTE_COBRO: "warning",
  INCORPORADO_A_VENTA: "success",
  ANULADO: "neutral",
});

export function getAdditionalItemTypeLabel(tipoItem) {
  return ADDITIONAL_ITEM_TYPE_LABELS[tipoItem] || "Ítem";
}

export function getAdditionalStatusLabel(estado) {
  return ADDITIONAL_STATUS_LABELS[estado] || estado || "Sin estado";
}

export function getAdditionalStatusVariant(estado) {
  return ADDITIONAL_STATUS_VARIANTS[estado] || "neutral";
}

// Un adicional PENDIENTE_COBRO nunca es ingreso realizado (SPEC 020 §7/§12):
// esta función existe únicamente para que la UI nunca lo trate como tal por
// accidente — no calcula ningún monto, sólo documenta el invariante.
export function isAdditionalRealizedIncome() {
  return false;
}

export function canSubmitAdditionalDraft(draft = {}) {
  const cantidad = Number(draft.cantidad);
  const precioUnitario = draft.precioUnitario === "" || draft.precioUnitario == null ? NaN : Number(draft.precioUnitario);
  return Boolean(String(draft.itemId || "").trim())
    && Number.isFinite(cantidad) && cantidad > 0
    && Number.isFinite(precioUnitario) && precioUnitario >= 0;
}

export function canAnnulAdditional(additional, {canManage = false} = {}) {
  return Boolean(canManage) && additional?.estado === "PENDIENTE_COBRO";
}

function additionalTaskLabel(tasks, tareaId) {
  if (!tareaId) return "Proyecto completo";
  return (tasks || []).find((task) => task.id === tareaId)?.titulo || "Tarea no disponible";
}

const EMPTY_DRAFT = Object.freeze({itemId: "", cantidad: "", precioUnitario: ""});

export default function WorkAdditionalsSection({
  additionals = [],
  canManage = false,
  catalogItems = [],
  currency,
  loading = false,
  onAnnul,
  onCreate,
  onCreateSale,
  processing = "",
  readOnly = false,
  role,
  tasks = [],
}) {
  const [draft, setDraft] = useState({...EMPTY_DRAFT});
  const [annulReasons, setAnnulReasons] = useState({});
  const canOperate = canManage || ["TECNICO", "MEMBER"].includes(role);

  const submitCreate = (event) => {
    event.preventDefault();
    if (!canSubmitAdditionalDraft(draft)) return;
    Promise.resolve(onCreate({itemId: draft.itemId, cantidad: draft.cantidad, precioUnitario: draft.precioUnitario})).then((success) => {
      if (success) setDraft({...EMPTY_DRAFT});
    });
  };

  const submitAnnul = (event, additionalId) => {
    event.preventDefault();
    const reason = String(annulReasons[additionalId] || "").trim();
    if (!reason) return;
    Promise.resolve(onAnnul(additionalId, reason)).then((success) => {
      if (success) setAnnulReasons((current) => ({...current, [additionalId]: ""}));
    });
  };

  const hasPending = additionals.some((entry) => entry.estado === "PENDIENTE_COBRO");

  return (
    <section className="works-detail-section works-financial-file" aria-label="Adicionales facturables">
      <div className="works-section-heading">
        <div><h3>Adicionales facturables</h3><span>Moneda {currency}</span></div>
        {onCreateSale && hasPending && (
          <Button type="button" variant="secondary" onClick={onCreateSale}>Nueva venta</Button>
        )}
      </div>
      <p className="works-financial-note">
        Un adicional pendiente de cobro no es ingreso del proyecto: sólo se refleja en el balance cuando se incorpore a una Venta confirmada.
      </p>

      {canOperate && !readOnly && (
        <form className="works-cost-form" onSubmit={submitCreate}>
          <select
            aria-label="Ítem del catálogo"
            className="erp-control"
            required
            value={draft.itemId}
            onChange={(event) => setDraft((current) => ({...current, itemId: event.target.value}))}
          >
            <option value="">Selecciona un ítem del catálogo</option>
            {catalogItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nombre} · {getAdditionalItemTypeLabel(item.tipoItem)}{item.codigoInterno ? ` · ${item.codigoInterno}` : ""}
              </option>
            ))}
          </select>
          <input
            aria-label="Cantidad"
            className="erp-control"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={draft.cantidad}
            onChange={(event) => setDraft((current) => ({...current, cantidad: event.target.value}))}
            placeholder="Cantidad"
          />
          <input
            aria-label="Precio unitario"
            className="erp-control"
            type="number"
            min="0"
            step="0.01"
            required
            value={draft.precioUnitario}
            onChange={(event) => setDraft((current) => ({...current, precioUnitario: event.target.value}))}
            placeholder={`Precio unitario (${currency})`}
          />
          <Button type="submit" disabled={Boolean(processing) || !canSubmitAdditionalDraft(draft)}>
            Registrar adicional
          </Button>
          {!catalogItems.length && (
            <small className="works-field-error">No hay ítems activos en el catálogo para registrar un adicional.</small>
          )}
        </form>
      )}

      {loading ? <p>Cargando adicionales...</p> : (
        <div className="works-cost-list">
          {additionals.map((entry) => {
            const annullable = canAnnulAdditional(entry, {canManage});
            return (
              <article key={entry.id} className={entry.estado === "ANULADO" ? "is-annulled" : ""}>
                <div>
                  <strong>{entry.itemSnapshot?.nombre || "Ítem sin nombre"}</strong>
                  <span>
                    {getAdditionalItemTypeLabel(entry.tipoItem)} · {entry.cantidad} {entry.itemSnapshot?.unidad || "unidad"} × {formatMoney(entry.precioUnitario, entry.moneda || currency)}
                  </span>
                  <small>
                    <StatusBadge variant={getAdditionalStatusVariant(entry.estado)}>{getAdditionalStatusLabel(entry.estado)}</StatusBadge>
                    {" · "}{additionalTaskLabel(tasks, entry.tareaId)}
                  </small>
                  {entry.descripcion && <p>{entry.descripcion}</p>}
                  {entry.estado === "ANULADO" && entry.motivoAnulacion && <small>Anulado: {entry.motivoAnulacion}</small>}
                </div>
                {annullable && !readOnly && (
                  <form className="works-annul-form" onSubmit={(event) => submitAnnul(event, entry.id)}>
                    <input
                      aria-label="Motivo de anulación"
                      className="erp-control"
                      maxLength="1000"
                      required
                      value={annulReasons[entry.id] || ""}
                      onChange={(event) => setAnnulReasons((current) => ({...current, [entry.id]: event.target.value}))}
                      placeholder="Motivo de anulación"
                    />
                    <Button type="submit" variant="ghost-danger" disabled={Boolean(processing)}>Anular</Button>
                  </form>
                )}
              </article>
            );
          })}
          {!additionals.length && <p className="works-empty-copy">Aún no se han registrado adicionales.</p>}
        </div>
      )}
    </section>
  );
}
