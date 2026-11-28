import React, {useId, useRef, useState} from "react";
import {Plus} from "lucide-react";
import Button from "../../../components/ui/Button";
import LoadingState from "../../../components/ui/LoadingState";
import StatusBadge from "../../../components/ui/StatusBadge";
import {guardarBoxVeterinario} from "../data/veterinaryDataService";
import {normalizeVeterinaryBoxName, VETERINARY_BOX_NAME_LIMIT} from "../domain/boxModel.mjs";
import VeterinaryField from "../VeterinaryField";

export const veterinaryBoxStatuses = {
  libre: {label: "Libre", variant: "success"},
  reservado: {label: "Reservado", variant: "warning"},
  en_uso: {label: "En uso", variant: "neutral"},
};

export default function VeterinaryBoxes({businessId, boxes, error, names, onOpenOrder}) {
  const titleId = useId();
  const addButton = useRef(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  function closeForm() {
    setEditing(false);
    setName("");
    setFormError("");
    addButton.current?.focus();
  }

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    const trimmed = normalizeVeterinaryBoxName(name);
    if (!trimmed) {
      setFormError("Escribe el nombre del box.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      await guardarBoxVeterinario(businessId, trimmed);
      closeForm();
      setNotice(`Se agregó ${trimmed}.`);
    } catch (failure) {
      const code = String(failure?.code ?? "").replace(/^functions\//, "");
      setFormError(["already-exists", "invalid-argument", "failed-precondition", "permission-denied"].includes(code)
        ? failure.message : "No se pudo agregar el box. Inténtalo nuevamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="erp-panel" aria-labelledby={titleId}>
      <div className="erp-panel-header">
        <h2 id={titleId} className="erp-panel-title">Boxes de atención</h2>
        <Button ref={addButton} type="button" variant="secondary" icon={Plus} aria-expanded={editing}
          disabled={Boolean(error) || !boxes} onClick={() => {
            if (saving) return;
            setNotice("");
            if (editing) closeForm();
            else setEditing(true);
          }}>Agregar box</Button>
      </div>
      {editing && (
        <form className="erp-form veterinary-box-board__form" onSubmit={save} noValidate>
          <VeterinaryField label="Nombre del box" required error={formError}>
            <input className="erp-control" type="text" placeholder="Ej. Box Cirugía" value={name} autoFocus
              maxLength={VETERINARY_BOX_NAME_LIMIT} disabled={saving} onChange={({target}) => {
                setName(target.value);
                setFormError("");
              }} />
          </VeterinaryField>
          <div className="veterinary-order-actions">
            <Button type="submit" loading={saving}>Guardar box</Button>
            <Button type="button" variant="secondary" disabled={saving} onClick={closeForm}>Cancelar</Button>
          </div>
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
      {error ? <p role="alert">{error}</p> : !boxes ? (
        <LoadingState variant="section" label="Cargando boxes de atención..." />
      ) : boxes.length === 0 ? (
        <p className="erp-secondary-text">Agrega el primer box para poder asignarlo a una orden.</p>
      ) : (
        <ul className="erp-metric-grid veterinary-box-board__cards" role="list">
          {boxes.map(({id, nombre, order, state}) => {
            const {label, variant} = veterinaryBoxStatuses[state];
            return (
              <li className="erp-metric-card veterinary-box-board__card" key={id}>
                <div className="veterinary-box-board__card-heading">
                  <h3 className="erp-panel-title">{nombre}</h3>
                  <StatusBadge variant={variant}>{label}</StatusBadge>
                </div>
                {order && (
                  <>
                    <dl className="veterinary-box-board__assignment">
                      <dt className="erp-secondary-text">Paciente</dt>
                      <dd>{names.get(order.pacienteId) || "Paciente asignado"}</dd>
                      <dt className="erp-secondary-text">Profesional</dt>
                      <dd>{order.profesionalNombre || (order.profesionalUid ? "Profesional asignado" : "Sin profesional asignado")}</dd>
                    </dl>
                    <Button type="button" variant="secondary" onClick={() => onOpenOrder(order)}
                      aria-label={`Ver orden de ${nombre}`}>Ver orden</Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
