import React from "react";
import { CHILE_REGIONS } from "../domain/businessCatalog";
import BusinessCategoryPicker from "./BusinessCategoryPicker";

function FieldMessage({ error, help = "", id }) {
  return (
    <div className="quick-business-field__message">
      {error ? (
        <p id={id} className="quick-business-field__error" role="alert">
          {error}
        </p>
      ) : help ? <p id={id} className="quick-business-field__hint">{help}</p> : null}
    </div>
  );
}

function QuickBusinessFields({
  disabled = false,
  errors,
  idPrefix,
  onBlur,
  onChange,
  setFieldRef,
  values,
}) {
  return (
    <div className="quick-business-fields">
      {[
        {
          field: "nombreComercial",
          label: "Nombre del negocio",
          control: (
            <input
              type="text"
              autoComplete="organization"
              maxLength="120"
              placeholder="Ej. Servicios Técnicos Andes"
            />
          ),
        },
        {
          field: "rubroCodigo",
          label: "Rubro principal",
          category: true,
        },
        {
          field: "regionCodigo",
          label: "Región",
          control: (
            <select>
              <option value="">Selecciona una región</option>
              {CHILE_REGIONS.map((region) => (
                <option key={region.code} value={region.code}>
                  {region.name}
                </option>
              ))}
            </select>
          ),
        },
      ].map(({ category, field, label, control }) => {
        const controlId = `${idPrefix}-${field}`;
        const messageId = `${controlId}-message`;
        if (category) {
          return (
            <div className="quick-business-field" key={field}>
              <label htmlFor={controlId}>
                {label}<span aria-hidden="true"> *</span>
              </label>
              <BusinessCategoryPicker
                ref={(node) => setFieldRef?.(field, node)}
                id={controlId}
                value={values.rubroCodigo}
                customValue={values.rubroOtro}
                disabled={disabled}
                error={errors.rubroCodigo}
                errorId={messageId}
                onChange={({ code, customName }) =>
                  onChange({ rubroCodigo: code, rubroOtro: customName })
                }
                onTouched={(patch) => onBlur(field, patch)}
              />
              <FieldMessage id={messageId} error={errors.rubroCodigo} help="Selecciona la actividad que mejor representa los servicios de tu empresa." />
            </div>
          );
        }
        return (
          <div className="quick-business-field" key={field}>
            <label htmlFor={controlId}>
              {label}<span aria-hidden="true"> *</span>
            </label>
            {React.cloneElement(control, {
              ref: (node) => setFieldRef?.(field, node),
              id: controlId,
              name: field,
              value: values[field],
              onChange: (event) => onChange(field, event.target.value),
              onBlur: () => onBlur(field),
              disabled,
              required: true,
              "aria-invalid": Boolean(errors[field]),
              "aria-describedby": messageId,
            })}
            <FieldMessage id={messageId} error={errors[field]} />
          </div>
        );
      })}
    </div>
  );
}

export default QuickBusinessFields;
