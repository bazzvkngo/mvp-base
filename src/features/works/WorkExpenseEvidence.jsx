import React, {useRef, useState} from "react";
import Button from "../../components/ui/Button";
import {getWorkExpenseEvidenceTypeLabel, MAX_WORK_EXPENSE_EVIDENCE_FILES, validateWorkExpenseEvidenceSelection, WORK_EXPENSE_EVIDENCE_TYPES} from "../../domain/workModel.mjs";

// SPEC 020 ETAPA 4: control de evidencia documental de un gasto, integrado
// dentro del gasto ya existente en FinancialSection (WorksPage.jsx) — no es
// un módulo de gastos nuevo. Presentacional/controlado: recibe las
// evidencias ya cargadas del gasto y delega la subida real a `onUpload`,
// resuelto por WorksPage.jsx (mismo patrón de callbacks ya usado por
// WorkTaskBoard) — este componente no importa ningún servicio remoto propio
// ni el SDK de almacenamiento (workModel.mjs, de donde vienen sus helpers,
// tampoco lo hace), para poder probarse vía SSR igual que WorkQuoteSelector/
// WorkTaskBoard. La validación de aquí es sólo UX: Storage Rules +
// adjuntarEvidenciaGastoTrabajo siguen siendo la autoridad.

export default function WorkExpenseEvidence({canAttach = false, entries = [], onOpen, onUpload, processing = false}) {
  const inputRef = useRef(null);
  const [selectionError, setSelectionError] = useState("");
  const atLimit = entries.length >= MAX_WORK_EXPENSE_EVIDENCE_FILES;

  const handleFile = (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    const validation = validateWorkExpenseEvidenceSelection(file, entries.length);
    if (!validation.ok) { setSelectionError(validation.reason); return; }
    setSelectionError("");
    onUpload(file);
  };

  return (
    <div className="works-expense-evidence">
      {entries.length > 0 && (
        <ul className="works-expense-evidence__list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button type="button" onClick={() => onOpen(entry.storagePath)}>{entry.nombreArchivo}</button>
              <small>{getWorkExpenseEvidenceTypeLabel(entry.tipoMime)}</small>
            </li>
          ))}
        </ul>
      )}
      {!entries.length && <small className="works-empty-copy">Sin evidencia adjunta.</small>}
      {canAttach && (
        atLimit
          ? <small className="works-field-error">Se alcanzó el máximo de {MAX_WORK_EXPENSE_EVIDENCE_FILES} archivos.</small>
          : <label className="works-expense-evidence__upload">
              <input
                ref={inputRef}
                type="file"
                accept={WORK_EXPENSE_EVIDENCE_TYPES.join(",")}
                disabled={Boolean(processing)}
                onChange={handleFile}
                hidden
              />
              <Button type="button" variant="secondary" disabled={Boolean(processing)} onClick={() => inputRef.current?.click()}>
                {processing ? "Subiendo..." : "Adjuntar evidencia"}
              </Button>
              {selectionError && <small className="works-field-error">{selectionError}</small>}
            </label>
      )}
    </div>
  );
}
