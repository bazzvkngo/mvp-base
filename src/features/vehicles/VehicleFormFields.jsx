import React from "react";
import {
  keepTextOnlyInput,
  keepVehicleYearInput,
  MAX_VEHICLE_YEAR,
  MIN_VEHICLE_YEAR,
  normalizeVehiclePlate,
  VEHICLE_TYPES,
} from "../../domain/vehicleModel.mjs";
import {getCountryFormCopy} from "../../domain/countryFormCopy.mjs";

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

function VehicleFormFields({countryCode = "CL", errors = {}, onChange, values}) {
  const copy = getCountryFormCopy(countryCode);
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
      {field("patente", "Patente", {required: true, maxLength: 8, placeholder: copy.vehiclePlateExample})}
      {field("vin", "VIN", {optional: true, maxLength: 80, placeholder: copy.vehicleVinExample})}
      {field("marca", "Marca", {required: true, placeholder: copy.vehicleBrandExample})}
      {field("modelo", "Modelo", {required: true, placeholder: copy.vehicleModelExample})}
      <VehicleField field="anio" label="Año" error={errors.anio} required>
        <input className="erp-control" type="text" inputMode="numeric" pattern="[0-9]{4}" maxLength={4}
          value={values.anio} placeholder={`${MIN_VEHICLE_YEAR}–${MAX_VEHICLE_YEAR}`}
          onChange={(event) => onChange("anio", keepVehicleYearInput(event.target.value))} />
      </VehicleField>
      {field("color", "Color", {required: true, maxLength: 80, placeholder: copy.vehicleColorExample})}
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
