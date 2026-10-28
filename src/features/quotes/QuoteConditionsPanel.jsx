import React from "react";
import {ChevronDown, ChevronUp} from "lucide-react";
import AppIcon from "../../components/ui/AppIcon";
import Button from "../../components/ui/Button";

// Qué formato espera cada campo (quoteModel.mjs / quoteDocumentLayout.mjs):
// - garantía y alcance geográfico: una línea de texto; el PDF la imprime como un término numerado.
// - observaciones y exclusiones: texto libre; el PDF lo imprime como un solo término numerado.
// - otras condiciones: una condición por renglón; el PDF imprime cada renglón como un término numerado.
// - qué incluye: una línea por renglón; el PDF imprime cada renglón como viñeta.
// Los ejemplos de cada campo respetan ese formato.
const OPTIONAL_CONDITIONS = [
  {key: "garantia", label: "Garantía", multiline: false, placeholder: "Ej: 12 meses por defectos de fabricación"},
  {key: "alcanceGeografico", label: "Alcance geográfico", multiline: false, placeholder: "Ej: Región de Tarapacá"},
  {key: "observaciones", label: "Observaciones", multiline: true, placeholder: "Ej: Los precios no incluyen traslados fuera de la región"},
  {key: "exclusiones", label: "Exclusiones", multiline: true, placeholder: "Ej: No incluye obra civil ni permisos municipales"},
  {
    key: "terminosAdicionales",
    label: "Otras condiciones",
    multiline: true,
    placeholder: "Ej: Los materiales se facturan al confirmar\nLa instalación se agenda según disponibilidad",
    hint: "Una condición por línea; cada una sale numerada en el PDF.",
  },
];

const SCOPE_PLACEHOLDER = "Ej: Instalación completa\nMateriales incluidos\nPruebas de funcionamiento";

const hasText = (value) => Boolean(String(value ?? "").trim());

// Tres estados: cerrado ("+"), abierto sin contenido (borde de marca y flecha, sin ✓) y con contenido
// ("✓": sale en el PDF). Con contenido el campo siempre queda visible y el botón no lo oculta.
// El ✓ solo significa "tiene contenido", nunca "abierto".
function ConditionChip({active, controlsId, filled, label, locked, onClick}) {
  return (
    <button
      type="button"
      className={`quote-chip${active ? " quote-chip--active" : ""}${filled ? " quote-chip--filled" : ""}`}
      aria-pressed={active}
      aria-controls={controlsId}
      title={locked ? "Tiene contenido; sale en el PDF" : undefined}
      onClick={onClick}
    >
      {filled ? "✓" : active ? <AppIcon icon={ChevronDown} size={14} /> : "+"} {label}
    </button>
  );
}

function QuoteConditionsPanel({
  conditions,
  fieldErrors,
  isAdvancedScope,
  isEditMode,
  onAddScopeSection,
  onCondition,
  onField,
  onMoveScopeSection,
  onPlazoApply,
  onPrimaryScopeText,
  onRemoveScopeSection,
  onRestore,
  onUpdateScopeSection,
  plazoRangeDraft,
  plazoRangeOpen,
  plazoRangeShowError,
  plazoRangeValid,
  primaryScopeText,
  restoreDisabled,
  scopeHasContent,
  scopeOpen,
  scopeSections,
  setPlazoRangeDraft,
  setPlazoRangeOpen,
  setScopeOpen,
  taxName,
  taxRate,
  validezDias,
  afectaIva,
}) {
  const [opened, setOpened] = React.useState({});
  const fieldRefs = React.useRef({});
  const scopeRef = React.useRef(null);
  const pendingFocus = React.useRef("");
  const idPrefix = React.useId();

  React.useEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    pendingFocus.current = "";
    const target = key === "scope"
      ? scopeRef.current?.querySelector("input, textarea")
      : fieldRefs.current[key];
    target?.focus();
  });

  const toggleCondition = (key) => {
    const hasContent = hasText(conditions[key]);
    if (hasContent) {
      fieldRefs.current[key]?.focus();
      return;
    }
    const nextOpen = !opened[key];
    if (nextOpen) pendingFocus.current = key;
    setOpened((current) => ({...current, [key]: nextOpen}));
  };

  const toggleScope = () => {
    if (scopeHasContent) {
      scopeRef.current?.querySelector("input, textarea")?.focus();
      return;
    }
    if (!scopeOpen) pendingFocus.current = "scope";
    setScopeOpen(!scopeOpen);
  };

  const scopeActive = scopeOpen || scopeHasContent;
  const taxLabel = taxName || "IVA";
  const rateLabel = Number.isFinite(taxRate) ? ` ${Number(taxRate.toFixed(2))} %` : "";
  const scopeFieldId = `${idPrefix}-scope`;

  return (
    <section className="quote-workspace__panel quote-conditions no-print" aria-labelledby="quote-conditions-title">
      <header className="quote-conditions__head">
        <h2 id="quote-conditions-title">3 · Condiciones</h2>
        <p>
          {isEditMode ? "" : "Vienen de los valores de Empresa. "}
          Cambiarlas solo afecta a esta cotización.
        </p>
      </header>

      <div className="quote-conditions-primary__grid">
        <label className="quote-workspace__field">
          <span>Vigencia (días)</span>
          <input type="number" min="1" max="3650" value={validezDias} onChange={(event) => onField("validezDias", event.target.value)} />
        </label>
        <label className="quote-workspace__field">
          <span>Tratamiento tributario</span>
          <select value={afectaIva === false ? "exenta" : "afecta"} onChange={(event) => onField("afectaIva", event.target.value === "afecta")}>
            <option value="afecta">{`Afecta ${taxLabel}${rateLabel}`}</option>
            <option value="exenta">{`Exenta de ${taxLabel}`}</option>
          </select>
        </label>
        <label className="quote-workspace__field">
          <span>Forma de pago</span>
          <input value={conditions.formaPago} onChange={(event) => onCondition("formaPago", event.target.value)} placeholder="Ej: 50% al iniciar y 50% contra entrega" />
        </label>
        <div className="quote-workspace__field">
          <label className="quote-workspace__field">
            <span>Plazo de ejecución o entrega</span>
            <input value={conditions.plazoEntrega} onChange={(event) => onCondition("plazoEntrega", event.target.value)} placeholder="Ej: 10 días hábiles" />
          </label>
          {plazoRangeOpen ? (
            <div>
              <div className="quote-plazo-range">
                <input type="date" aria-label="Plazo desde" value={plazoRangeDraft.desde} onChange={(event) => setPlazoRangeDraft((current) => ({...current, desde: event.target.value}))} />
                <span aria-hidden="true">→</span>
                <input type="date" aria-label="Plazo hasta" min={plazoRangeDraft.desde || undefined} value={plazoRangeDraft.hasta} onChange={(event) => setPlazoRangeDraft((current) => ({...current, hasta: event.target.value}))} />
                <button type="button" disabled={!plazoRangeValid} onClick={onPlazoApply} className="quote-workspace__button quote-workspace__button--primary">Aceptar</button>
                <button type="button" onClick={() => setPlazoRangeOpen(false)} className="quote-workspace__button quote-workspace__button--secondary">Cancelar</button>
              </div>
              {plazoRangeShowError && (
                <span className="quote-conditions__error">La fecha "hasta" no puede ser anterior a "desde".</span>
              )}
            </div>
          ) : (
            <button type="button" onClick={() => setPlazoRangeOpen(true)} className="quote-workspace__link-button">Definir con fecha desde/hasta</button>
          )}
        </div>
      </div>

      <div className="quote-conditions__add">
        <p className="quote-conditions__add-title">Agregar a la propuesta</p>
        <div className="quote-chips">
          <ConditionChip active={scopeActive} controlsId={scopeFieldId} filled={scopeHasContent} label="Qué incluye" locked={scopeHasContent} onClick={toggleScope} />
          {OPTIONAL_CONDITIONS.map(({key, label}) => (
            <ConditionChip
              key={key}
              active={Boolean(opened[key]) || hasText(conditions[key])}
              controlsId={`${idPrefix}-${key}`}
              filled={hasText(conditions[key])}
              label={label}
              locked={hasText(conditions[key])}
              onClick={() => toggleCondition(key)}
            />
          ))}
        </div>
      </div>

      <div className="quote-conditions__fields">
        {scopeActive && (
          <div id={scopeFieldId} ref={scopeRef} className="quote-workspace__field">
            <span>Qué incluye esta propuesta</span>
            {isAdvancedScope ? (
              <div className="quote-scope-list">
                {scopeSections.map((section, index) => {
                  const errors = fieldErrors[`alcance.${index}.titulo`] || fieldErrors[`alcance.${index}.lineas`];
                  return (
                    <article key={section.id} className="quote-scope-card">
                      <div className="quote-scope-card__head">
                        <input value={section.titulo} onChange={(event) => onUpdateScopeSection(section.id, {titulo: event.target.value})} placeholder="Título del apartado" aria-label={`Título del apartado ${index + 1}`} />
                        <div className="quote-scope-card__actions">
                          <Button type="button" variant="secondary" icon={ChevronUp} className="quote-line__icon-button" aria-label="Subir apartado" disabled={index === 0} onClick={() => onMoveScopeSection(index, -1)} />
                          <Button type="button" variant="secondary" icon={ChevronDown} className="quote-line__icon-button" aria-label="Bajar apartado" disabled={index === scopeSections.length - 1} onClick={() => onMoveScopeSection(index, 1)} />
                          <Button type="button" variant="ghost-danger" onClick={() => onRemoveScopeSection(section.id)}>Eliminar</Button>
                        </div>
                      </div>
                      <textarea rows={4} value={(section.lineas || []).join("\n")} onChange={(event) => onUpdateScopeSection(section.id, {lineas: event.target.value.split(/\r?\n/)})} placeholder="Una línea descriptiva por renglón" aria-label={`Líneas del apartado ${index + 1}`} />
                      {errors && <span className="quote-conditions__error">{errors}</span>}
                    </article>
                  );
                })}
              </div>
            ) : (
              <textarea
                rows={4}
                value={primaryScopeText}
                onChange={(event) => onPrimaryScopeText(event.target.value)}
                placeholder={SCOPE_PLACEHOLDER}
                aria-label="Qué incluye esta propuesta"
              />
            )}
            <small className="quote-conditions__hint">Una línea por renglón; cada una sale como viñeta. Los apartados vacíos no aparecen en el PDF.</small>
            {isAdvancedScope ? (
              <button type="button" onClick={onAddScopeSection} className="quote-workspace__button quote-workspace__button--secondary quote-conditions__add-section">+ Agregar apartado</button>
            ) : (
              hasText(primaryScopeText) && (
                <button type="button" onClick={onAddScopeSection} className="quote-conditions__link">Dividir en apartados con título</button>
              )
            )}
          </div>
        )}

        {OPTIONAL_CONDITIONS.map(({key, label, multiline, placeholder, hint}) => {
          if (!opened[key] && !hasText(conditions[key])) return null;
          const fieldId = `${idPrefix}-${key}`;
          return (
            <label key={key} id={fieldId} className="quote-workspace__field">
              <span>{label}</span>
              {multiline ? (
                <textarea
                  ref={(node) => { fieldRefs.current[key] = node; }}
                  rows={Math.min(8, Math.max(3, String(conditions[key] || "").split(/\r?\n/).length + 1))}
                  value={conditions[key] || ""}
                  onChange={(event) => onCondition(key, event.target.value)}
                  placeholder={placeholder}
                />
              ) : (
                <input
                  ref={(node) => { fieldRefs.current[key] = node; }}
                  value={conditions[key] || ""}
                  onChange={(event) => onCondition(key, event.target.value)}
                  placeholder={placeholder}
                />
              )}
              {hint && <small className="quote-conditions__hint">{hint}</small>}
            </label>
          );
        })}
      </div>

      <footer className="quote-conditions__foot">
        <p>Solo lo que esté agregado aparece en el PDF.</p>
        <button type="button" className="quote-conditions__restore" disabled={restoreDisabled} onClick={onRestore}>Restaurar valores de Empresa</button>
      </footer>
    </section>
  );
}

export default QuoteConditionsPanel;
