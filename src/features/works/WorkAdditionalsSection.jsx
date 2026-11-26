import React, {useState} from "react";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import StatusBadge from "../../components/ui/StatusBadge";
import {CostField, WorkFormError} from "./WorkCostParts.jsx";
import WorkAnnulForm from "./WorkAnnulForm.jsx";
import useWorkFormSubmit from "./useWorkFormSubmit.js";
import {getWorkAdditionalCatalogPrice} from "../../domain/workModel.mjs";
import {formatMoney} from "../../utils/formatters.js";
import useBusinessFormat from "../../hooks/useBusinessFormat";

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

// Mismos máximos que exige crearAdicionalTrabajo en el backend (normalizeAdditionalInput, functions/workPersistence.js).
export const WORK_ADDITIONAL_MAX_QUANTITY = 999999999.99;
export const WORK_ADDITIONAL_MAX_PRICE = 999999999999.99;
const formatLimit = (value) => value.toLocaleString("es-CL", {maximumFractionDigits: 2, minimumFractionDigits: 2});

// Mensajes bajo cada campo cuando el valor pasa del máximo; vacío si no hay nada que avisar.
export function getAdditionalDraftErrors(draft = {}) {
  const errors = {};
  if (Number(draft.cantidad) > WORK_ADDITIONAL_MAX_QUANTITY) errors.cantidad = `La cantidad no puede superar ${formatLimit(WORK_ADDITIONAL_MAX_QUANTITY)}.`;
  if (Number(draft.precioUnitario) > WORK_ADDITIONAL_MAX_PRICE) errors.precioUnitario = `El precio unitario no puede superar ${formatLimit(WORK_ADDITIONAL_MAX_PRICE)}.`;
  return errors;
}

export const ADDITIONAL_NO_SALE_PRICE_MESSAGE = "Este ítem no tiene precio de venta. Pide a un administrador que lo defina.";

// Sin gestión (TECNICO/MEMBER) el precio no se negocia: `requireCatalogPrice` exige que el ítem tenga precio de
// venta (`catalogPrice`, de getWorkAdditionalCatalogPrice) y que el borrador lo lleve tal cual. El backend
// (crearAdicionalTrabajo) vuelve a validarlo; esto solo evita enviar algo que se sabe rechazado.
export function canSubmitAdditionalDraft(draft = {}, {catalogPrice = null, requireCatalogPrice = false} = {}) {
  const cantidad = Number(draft.cantidad);
  const precioUnitario = draft.precioUnitario === "" || draft.precioUnitario == null ? NaN : Number(draft.precioUnitario);
  return Boolean(String(draft.itemId || "").trim())
    && Number.isFinite(cantidad) && cantidad > 0
    && Number.isFinite(precioUnitario) && precioUnitario >= 0
    && (!requireCatalogPrice || (catalogPrice != null && precioUnitario === catalogPrice))
    && Object.keys(getAdditionalDraftErrors(draft)).length === 0;
}

export function canAnnulAdditional(additional, {canManage = false} = {}) {
  return Boolean(canManage) && additional?.estado === "PENDIENTE_COBRO";
}

function additionalTaskLabel(tasks, tareaId) {
  if (!tareaId) return "Trabajo completo";
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
  const { locale: businessLocale } = useBusinessFormat();
  const [draft, setDraft] = useState({...EMPTY_DRAFT});
  const createForm = useWorkFormSubmit({prefix: "additional-create"});
  const draftErrors = getAdditionalDraftErrors(draft);
  const canOperate = canManage || ["TECNICO", "MEMBER"].includes(role);
  // Propietario y administrador ajustan el precio; el resto trabaja con el precio de venta del ítem, solo lectura.
  const priceLocked = !canManage;
  const catalogPrice = getWorkAdditionalCatalogPrice(catalogItems.find((item) => item.id === draft.itemId));
  const draftOptions = {catalogPrice, requireCatalogPrice: priceLocked};
  const missingSalePrice = priceLocked && Boolean(draft.itemId) && catalogPrice == null;

  const selectItem = (itemId) => setDraft((current) => {
    const price = getWorkAdditionalCatalogPrice(catalogItems.find((item) => item.id === itemId));
    return {...current, itemId, precioUnitario: price != null ? String(price) : priceLocked ? "" : current.precioUnitario};
  });

  const submitCreate = (event) => {
    event.preventDefault();
    if (!canSubmitAdditionalDraft(draft, draftOptions)) return;
    const payload = {itemId: draft.itemId, cantidad: draft.cantidad, precioUnitario: draft.precioUnitario};
    // requestId estable en los reintentos y error del backend dentro del formulario (useWorkFormSubmit).
    createForm.submit(payload, (requestId, onError) => onCreate(payload, {requestId, onError})).then((success) => {
      if (success) setDraft({...EMPTY_DRAFT});
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
        Un adicional pendiente de cobro no es ingreso del trabajo: solo se refleja en el balance cuando se incorpore a una Venta confirmada.
      </p>

      {canOperate && !readOnly && (
        <form className="works-cost-form" onChange={createForm.clearError} onSubmit={submitCreate}>
          <CostField className="works-cost-field--wide" label="Ítem">
            <select
              className="erp-control"
              required
              value={draft.itemId}
              onChange={(event) => selectItem(event.target.value)}
            >
              <option value="">Selecciona un ítem del catálogo</option>
              {catalogItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nombre} · {getAdditionalItemTypeLabel(item.tipoItem)}{item.codigoInterno ? ` · ${item.codigoInterno}` : ""}
                </option>
              ))}
            </select>
          </CostField>
          <CostField label="Cantidad">
            <input
              className="erp-control"
              type="number"
              min="0.01"
              max={WORK_ADDITIONAL_MAX_QUANTITY}
              step="0.01"
              required
              aria-invalid={draftErrors.cantidad ? "true" : undefined}
              value={draft.cantidad}
              onChange={(event) => setDraft((current) => ({...current, cantidad: event.target.value}))}
              placeholder="0"
            />
            {draftErrors.cantidad && <small className="works-field-error">{draftErrors.cantidad}</small>}
          </CostField>
          <CostField label="Precio unitario">
            <input
              className="erp-control"
              type="number"
              min="0"
              max={WORK_ADDITIONAL_MAX_PRICE}
              step="0.01"
              required
              readOnly={priceLocked}
              aria-invalid={draftErrors.precioUnitario || missingSalePrice ? "true" : undefined}
              value={draft.precioUnitario}
              onChange={(event) => setDraft((current) => ({...current, precioUnitario: event.target.value}))}
              placeholder="0"
            />
            {draftErrors.precioUnitario && <small className="works-field-error">{draftErrors.precioUnitario}</small>}
            {missingSalePrice && <small className="works-field-error">{ADDITIONAL_NO_SALE_PRICE_MESSAGE}</small>}
            {priceLocked && !missingSalePrice && <small className="works-cost-hint">Precio de venta del ítem en {currency}. Solo un administrador puede cambiarlo.</small>}
          </CostField>
          <WorkFormError error={createForm.error} noticeRef={createForm.noticeRef} title="No se pudo registrar el adicional" />
          <Button type="submit" loading={processing === "additional-new"} disabled={(Boolean(processing) && processing !== "additional-new") || !canSubmitAdditionalDraft(draft, draftOptions)}>
            Registrar adicional
          </Button>
          {!catalogItems.length && (
            <small className="works-field-error">No hay ítems activos en el catálogo para registrar un adicional.</small>
          )}
        </form>
      )}

      {loading ? <LoadingState variant="section" label="Cargando adicionales..." /> : (
        <div className="works-cost-list">
          {additionals.map((entry) => {
            const annullable = canAnnulAdditional(entry, {canManage});
            return (
              <article key={entry.id} className={entry.estado === "ANULADO" ? "is-annulled" : ""}>
                <div>
                  <strong>{entry.itemSnapshot?.nombre || "Ítem sin nombre"}</strong>
                  <span>
                    {getAdditionalItemTypeLabel(entry.tipoItem)} · {entry.cantidad} {entry.itemSnapshot?.unidad || "unidad"} × {formatMoney(entry.precioUnitario, entry.moneda || currency, businessLocale)}
                  </span>
                  <small>
                    <StatusBadge variant={getAdditionalStatusVariant(entry.estado)}>{getAdditionalStatusLabel(entry.estado)}</StatusBadge>
                    {" · "}{additionalTaskLabel(tasks, entry.tareaId)}
                  </small>
                  {entry.descripcion && <p>{entry.descripcion}</p>}
                  {entry.estado === "ANULADO" && entry.motivoAnulacion && <small>Anulado: {entry.motivoAnulacion}</small>}
                </div>
                {annullable && !readOnly && (
                  <WorkAnnulForm
                    label="Motivo de anulación"
                    onAnnul={(motivo, requestId, onError) => onAnnul(entry.id, motivo, {requestId, onError})}
                    prefix="additional-annul"
                    processing={processing}
                    processingKey={`additional-annul-${entry.id}`}
                    submitLabel="Anular"
                    submitVariant="ghost-danger"
                    visibleLabel={false}
                  />
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
