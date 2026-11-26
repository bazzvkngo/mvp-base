import React from "react";
import { ChevronDown } from "lucide-react";
import {
  NEW_BUSINESS_COUNTRIES,
  getRegionLabel,
  getRegionsForCountry,
  hasRegionCatalog,
} from "../domain/businessCatalog";
import { getCountryFiscalNote } from "../domain/countryFiscalNote.mjs";
import { resolveFormCountryCode } from "../domain/businessForm";
import BusinessCategoryPicker from "./BusinessCategoryPicker";
import AppIcon from "./ui/AppIcon";
import Notice from "./ui/Notice";

function FieldMessage({ error, help = null, id }) {
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

// Bloque con título para el cajón de negocio adicional (patrón .business-drawer-section de layout.css).
// Solo agrupa visualmente: el orden del DOM y de tabulación es el mismo que sin agrupar.
function QuickBusinessGroup({ children, id, title }) {
  return (
    <div className="business-drawer-section" role="group" aria-labelledby={id}>
      <div className="business-drawer-section__header">
        <h3 id={id}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

const BUSINESS_GROUP_FIELDS = ["nombreComercial", "rubroCodigo"];
const LOCATION_GROUP_FIELDS = ["paisCodigo", "regionCodigo"];

function QuickBusinessFields({
  countryHint = "",
  disabled = false,
  errors,
  grouped = false,
  idPrefix,
  onBlur,
  onChange,
  setFieldRef,
  showCountry = false,
  showRegion = true,
  values,
}) {
  // La región depende del país (se limpia al cambiarlo). Sin país en los valores
  // (negocio adicional) es Chile. Un país sin catálogo no pide región de lista.
  const regionCountryCode = resolveFormCountryCode(values);
  const regionLabel = getRegionLabel(regionCountryCode);
  const showRegionField = showRegion && hasRegionCatalog(regionCountryCode);

  // Bajo el país queda solo la línea corta ("Bolivia · BOB"). La nota fiscal va en un aviso a
  // todo el ancho debajo de la grilla.
  const fiscalNote = getCountryFiscalNote(values.paisCodigo);
  const hasCountryNotes = Boolean(fiscalNote);
  const countryNotesId = `${idPrefix}-country-notes`;
  const getCountryHelp = () => (countryHint ? <span>{countryHint}</span> : "");

  const visibleFields = [
    {
      field: "nombreComercial",
      label: "Nombre del negocio",
      control: (
        <input
          type="text"
          autoComplete="organization"
          maxLength="120"
          placeholder="Escribe el nombre de tu negocio"
        />
      ),
    },
    {
      field: "rubroCodigo",
      label: "Rubro principal",
      category: true,
    },
    {
      field: "paisCodigo",
      label: "País",
      control: (
        <select>
          <option value="">Selecciona el país de tu negocio</option>
          {NEW_BUSINESS_COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
        </select>
      ),
    },
    {
      field: "regionCodigo",
      label: regionLabel,
      control: (
        <select>
          <option value="">
            {regionCountryCode === "CL" ? "Selecciona una región" : `Selecciona un ${regionLabel.toLowerCase()}`}
          </option>
          {getRegionsForCountry(regionCountryCode).map((region) => (
            <option key={region.code} value={region.code}>
              {region.name}
            </option>
          ))}
        </select>
      ),
    },
  ]
    .filter(({ field }) => showCountry || field !== "paisCodigo")
    .filter(({ field }) => showRegionField || field !== "regionCodigo");

  const renderField = ({ category, field, label, control }) => {
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
          placeholder="Selecciona un rubro"
          disabled={disabled}
          error={errors.rubroCodigo}
          errorId={messageId}
          onChange={({ code, customName }) =>
            onChange({ rubroCodigo: code, rubroOtro: customName })
          }
          onTouched={(patch) => onBlur(field, patch)}
        />
        <FieldMessage
          id={messageId}
          error={errors.rubroCodigo}
          help="Elige la actividad que mejor representa tu servicio principal. Define los módulos que verás en el menú."
        />
      </div>
      );
    }
    const isSelect = control.type === "select";
    const controlElement = React.cloneElement(control, {
      ref: (node) => setFieldRef?.(field, node),
      id: controlId,
      name: field,
      value: values[field],
      onChange: (event) => onChange(field, event.target.value),
      onBlur: () => onBlur(field),
      disabled,
      required: true,
      "aria-invalid": Boolean(errors[field]),
      "aria-describedby":
        field === "paisCodigo" && hasCountryNotes
          ? `${messageId} ${countryNotesId}`
          : messageId,
      // Marca el estado "sin elegir" para pintar el texto guía en tono atenuado, como el selector de rubro.
      "data-empty": isSelect && !values[field] ? "true" : undefined,
    });
    return (
    <div className="quick-business-field" key={field}>
      <label htmlFor={controlId}>
        {label}<span aria-hidden="true"> *</span>
      </label>
      {isSelect ? (
        // Flecha propia (la misma del selector de rubro) en lugar de la nativa; el select sigue siendo el nativo.
        <span className={disabled ? "quick-business-select quick-business-select--disabled" : "quick-business-select"}>
          {controlElement}
          <span className="quick-business-select__icon">
            <AppIcon icon={ChevronDown} size={18} />
          </span>
        </span>
      ) : controlElement}
      <FieldMessage
        id={messageId}
        error={errors[field]}
        help={field === "paisCodigo" ? getCountryHelp() : ""}
      />
    </div>
    );
  };

  const countryNotice = hasCountryNotes && (
    <CountryNotice countryNotesId={countryNotesId} fiscalNote={fiscalNote} />
  );

  if (grouped) {
    const fieldsOf = (names) => visibleFields.filter(({ field }) => names.includes(field));
    const businessFields = fieldsOf(BUSINESS_GROUP_FIELDS);
    const locationFields = fieldsOf(LOCATION_GROUP_FIELDS);
    return (
      <>
        {businessFields.length > 0 && (
          <QuickBusinessGroup id={`${idPrefix}-group-business`} title="Datos del negocio">
            <div className="quick-business-fields">{businessFields.map(renderField)}</div>
          </QuickBusinessGroup>
        )}
        {locationFields.length > 0 && (
          <QuickBusinessGroup id={`${idPrefix}-group-location`} title="Ubicación">
            <div className="quick-business-fields">{locationFields.map(renderField)}</div>
            {countryNotice}
          </QuickBusinessGroup>
        )}
      </>
    );
  }

  return (
    <>
    <div className="quick-business-fields">
      {visibleFields.map(renderField)}
    </div>
    {countryNotice}
    </>
  );
}

// Aviso del sistema de diseño (<Notice variant="info">) con la nota fiscal del país; va siempre debajo de la grilla.
function CountryNotice({ countryNotesId, fiscalNote }) {
  return (
    <Notice variant="info" id={countryNotesId} className="quick-business-notes">
      {fiscalNote && <p>{fiscalNote}</p>}
    </Notice>
  );
}

export default QuickBusinessFields;
