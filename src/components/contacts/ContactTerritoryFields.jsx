import React from "react";
import {
  CHILE_REGIONS,
  getCommuneByCode,
  getCommunesForRegion,
  getRegionByCode,
} from "../../domain/businessCatalog";
import {getContactRegionOptions, getContactTerritoryConfig} from "../../domain/contactTerritory.mjs";
import {getCountryFormCopy} from "../../domain/countryFormCopy.mjs";

// Valor de la opción que representa una región guardada antes como texto libre y que no está en el catálogo.
const LEGACY_REGION_VALUE = "__texto_anterior__";

function ContactTerritoryFields({
  Field,
  countryCode,
  errors,
  onChange,
  saving,
  setFieldRef,
  values,
}) {
  const config = getContactTerritoryConfig(countryCode);
  // Texto guía de los campos de texto (listas sin texto): Chile y Bolivia con ejemplo propio, el resto con la instrucción neutra.
  const copy = getCountryFormCopy(countryCode);
  const primaryHint = copy.territoryRegionExample || undefined;
  const secondaryHint = copy.territoryMunicipalityExample || undefined;
  const regionOptions = config.hasCatalog ? [] : getContactRegionOptions(countryCode);

  if (regionOptions.length) {
    // País con catálogo de departamentos (hoy Bolivia): lista para la región y texto libre para el municipio.
    const knownCode = regionOptions.some((region) => region.code === values.regionCodigo) ? values.regionCodigo : "";
    const legacyName = knownCode ? "" : String(values.regionNombre || "").trim();
    return <>
      <Field error={errors.regionNombre} field="regionNombre" label={config.primaryLabel}>
        <select
          ref={(node) => setFieldRef("regionNombre", node)}
          value={knownCode || (legacyName ? LEGACY_REGION_VALUE : "")}
          onChange={(event) => {
            const regionCodigo = event.target.value;
            if (regionCodigo === LEGACY_REGION_VALUE) return;
            const region = regionOptions.find((item) => item.code === regionCodigo);
            onChange({regionCodigo, regionNombre: region?.name || ""}, ["regionNombre"]);
          }}
        >
          <option value="">Sin especificar</option>
          {legacyName && <option value={LEGACY_REGION_VALUE}>{`${legacyName} (texto anterior)`}</option>}
          {regionOptions.map((region) => (
            <option key={region.code} value={region.code}>{region.name}</option>
          ))}
        </select>
      </Field>
      <Field error={errors.comunaNombre} field="comunaNombre" label={config.secondaryLabel}>
        <input
          ref={(node) => setFieldRef("comunaNombre", node)}
          value={values.comunaNombre}
          onChange={(event) => onChange({comunaNombre: event.target.value, comunaCodigo: ""}, ["comunaNombre"])}
          placeholder={secondaryHint}
        />
      </Field>
    </>;
  }

  if (config.hasCatalog) {
    const communes = getCommunesForRegion(values.regionCodigo);
    return <>
      <Field error={errors.regionCodigo} field="regionCodigo" label={config.primaryLabel}>
        <select
          ref={(node) => setFieldRef("regionCodigo", node)}
          value={values.regionCodigo}
          onChange={(event) => {
            const regionCodigo = event.target.value;
            const region = getRegionByCode(regionCodigo);
            onChange({
              regionCodigo,
              regionNombre: region?.name || "",
              comunaCodigo: "",
              comunaNombre: "",
            }, ["regionCodigo", "comunaCodigo"]);
          }}
        >
          <option value="">Sin especificar</option>
          {CHILE_REGIONS.map((region) => (
            <option key={region.code} value={region.code}>{region.name}</option>
          ))}
        </select>
      </Field>

      <Field error={errors.comunaCodigo} field="comunaCodigo" label={config.secondaryLabel}>
        <select
          ref={(node) => setFieldRef("comunaCodigo", node)}
          value={values.comunaCodigo}
          onChange={(event) => {
            const comunaCodigo = event.target.value;
            const commune = getCommuneByCode(values.regionCodigo, comunaCodigo);
            onChange({
              comunaCodigo,
              comunaNombre: commune?.name || "",
            }, ["comunaCodigo"]);
          }}
          disabled={!values.regionCodigo || saving}
        >
          <option value="">Sin especificar</option>
          {communes.map((commune) => (
            <option key={commune.code} value={commune.code}>{commune.name}</option>
          ))}
        </select>
      </Field>
    </>;
  }

  return <>
    <Field error={errors.regionNombre} field="regionNombre" label={config.primaryLabel}>
      <input
        ref={(node) => setFieldRef("regionNombre", node)}
        value={values.regionNombre}
        onChange={(event) => onChange({regionNombre: event.target.value, regionCodigo: ""}, ["regionNombre"])}
        placeholder={primaryHint}
      />
    </Field>
    <Field error={errors.comunaNombre} field="comunaNombre" label={config.secondaryLabel}>
      <input
        ref={(node) => setFieldRef("comunaNombre", node)}
        value={values.comunaNombre}
        onChange={(event) => onChange({comunaNombre: event.target.value, comunaCodigo: ""}, ["comunaNombre"])}
        placeholder={secondaryHint}
      />
    </Field>
  </>;
}

export default ContactTerritoryFields;
