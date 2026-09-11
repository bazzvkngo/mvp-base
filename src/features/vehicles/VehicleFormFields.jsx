import React from "react";
import {
  keepTextOnlyInput,
  normalizeVehiclePlate,
  VEHICLE_TYPES,
} from "../../domain/vehicleModel.mjs";

function VehicleField({children, error, field, label, optional = false, required = false}) {
  const errorId = `vehicle-${field}-error`;
  return (
    <label className="erp-field">
      <span className="erp-field__label">{label}{required ? " *" : optional ? " (opcional)" : ""}</span>
      {React.cloneElement(children, {
        "aria-describedby": error ? errorId : undefined,
        "aria-invalid": Boolean(error),
        required: required || undefined,
      })}
      {error && <span id={errorId} className="vehicle-field-error" role="alert">{error}</span>}
    </label>
  );
}

function VehicleFormFields({errors = {}, onChange, values}) {
  const field = (name, label, options = {}) => (
    <VehicleField key={name} field={name} label={label} error={errors[name]} {...options}>
      <input className="erp-control" value={values[name]} maxLength={options.maxLength || 120} placeholder={options.placeholder}
        onChange={(event) => onChange(
          name,
          name === "patente"
            ? normalizeVehiclePlate(event.target.value)
            : ["marca", "color"].includes(name)
              ? keepTextOnlyInput(event.target.value)
              : event.target.value
        )} />
    </VehicleField>
  );

  return (
    <div className="vehicle-form-grid">
      {field("patente", "Patente", {required: true, maxLength: 6, placeholder: "Ej.: ABCD12"})}
      {field("vin", "VIN", {optional: true, maxLength: 80})}
      {field("marca", "Marca", {required: true})}
      {field("modelo", "Modelo", {required: true})}
      <VehicleField field="anio" label="Año" error={errors.anio} required>
        <input className="erp-control" type="number" value={values.anio} min="1" max="9999" step="1"
          onChange={(event) => onChange("anio", event.target.value)} />
      </VehicleField>
      {field("color", "Color", {required: true})}
      <VehicleField field="tipo" label="Tipo" error={errors.tipo} required>
        <select className="erp-control" value={values.tipo} onChange={(event) => onChange("tipo", event.target.value)}>
          <option value="">Selecciona un tipo</option>
          {VEHICLE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
        </select>
      </VehicleField>
    </div>
  );
}

export default VehicleFormFields;
