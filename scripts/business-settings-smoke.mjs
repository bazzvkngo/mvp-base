import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  validateBusinessCreationInput,
  validateBusinessProfileInput,
} = require("../functions/businessOnboarding.js");
const {
  validateInventorySettings,
  validatePersonalProfile,
  validateQuoteSettings,
  validateTaxSettings,
} = require("../functions/businessSettings.js");

class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function rejectsWithCode(callback, code) {
  assert.throws(callback, (error) => error?.code === code);
}

const quickBusiness = validateBusinessCreationInput(
  {
    nombreComercial: "Mauricio SPA",
    rubroCodigo: "TECNOLOGIA_INFORMATICA",
    regionCodigo: "01",
  },
  TestHttpsError
);
assert.equal(quickBusiness.nombreComercial, "Mauricio SPA");
assert.equal(quickBusiness.rubroCodigo, "TECNOLOGIA_INFORMATICA");
assert.equal(quickBusiness.regionNombre, "Tarapacá");
assert.equal(quickBusiness.paisCodigo, "CL");
assert.equal(quickBusiness.monedaCodigo, "CLP");
assert.equal("comunaCodigo" in quickBusiness, false);
const firstBusinessWithoutRegion = validateBusinessCreationInput(
  {
    nombreComercial: "Bagner Servicios Integrales",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
  },
  TestHttpsError,
  {regionRequired: false}
);
assert.equal(firstBusinessWithoutRegion.regionCodigo, "");
assert.equal(firstBusinessWithoutRegion.regionNombre, "");
const paraguayanFirstBusiness = validateBusinessCreationInput(
  {
    nombreComercial: "Servicios Paraguay",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    paisCodigo: "PY",
  },
  TestHttpsError,
  {regionRequired: false}
);
assert.equal(paraguayanFirstBusiness.paisCodigo, "PY");
assert.equal(paraguayanFirstBusiness.monedaCodigo, "PYG");
assert.equal(paraguayanFirstBusiness.regionEstado, "");
// Protección temporal (dinero entero): solo se crean empresas en países cuya moneda no tiene decimales.
for (const [paisCodigo, monedaCodigo] of [
  ["CL", "CLP"],
  ["PY", "PYG"],
]) {
  const business = validateBusinessCreationInput(
    {
      nombreComercial: "Negocio " + paisCodigo,
      rubroCodigo: "INGENIERIA_CONSULTORIA",
      paisCodigo,
      monedaCodigo: "USD",
    },
    TestHttpsError,
    {regionRequired: false}
  );
  assert.equal(business.paisCodigo, paisCodigo);
  assert.equal(business.monedaCodigo, monedaCodigo);
}
const catalogJson = require("../functions/businessCatalog.json");
const currencyDecimalsByCode = new Map(catalogJson.currencies.map((currency) => [currency.code, currency.decimals]));
const decimalCountries = catalogJson.countries.filter((country) => country.code !== "OTHER" && currencyDecimalsByCode.get(country.defaultCurrencyCode) > 0);
assert.deepEqual(decimalCountries.map((country) => country.code), ["BO", "BR", "PE", "AR", "CO", "EC", "UY", "MX"]);
const creationAttempt = (paisCodigo) => () => validateBusinessCreationInput(
  {nombreComercial: "Negocio " + paisCodigo, rubroCodigo: "INGENIERIA_CONSULTORIA", paisCodigo, monedaCodigo: "USD"},
  TestHttpsError,
  {regionRequired: false}
);
let legacyCountryMessage;
try { creationAttempt("OTHER")(); } catch (error) { legacyCountryMessage = error.message; }
assert.equal(legacyCountryMessage, "Selecciona un país válido.");
for (const country of decimalCountries) {
  assert.throws(
    creationAttempt(country.code),
    (error) => error?.code === "invalid-argument" && error.message === legacyCountryMessage,
    country.code + " (" + country.defaultCurrencyCode + ", " + currencyDecimalsByCode.get(country.defaultCurrencyCode) + " decimales) se rechaza al crear con el mismo mensaje que OTHER"
  );
}
// Reactivar un país es solo cambiar el flag del catálogo (se muta en memoria y se restaura): sin tocar código.
const boliviaCatalogEntry = catalogJson.countries.find((country) => country.code === "BO");
assert.equal(boliviaCatalogEntry.selectableForNewBusiness, false);
try {
  boliviaCatalogEntry.selectableForNewBusiness = true;
  const reactivated = creationAttempt("BO")();
  assert.equal(reactivated.paisCodigo, "BO");
  assert.equal(reactivated.monedaCodigo, "BOB");
  delete boliviaCatalogEntry.selectableForNewBusiness;
  assert.equal(creationAttempt("BO")().paisCodigo, "BO");
} finally {
  boliviaCatalogEntry.selectableForNewBusiness = false;
}
assert.throws(creationAttempt("BO"), (error) => error?.code === "invalid-argument");
// Las empresas ya creadas en esos países siguen funcionando: editar su perfil conserva el país y no pasa por la selección de países nuevos.
for (const country of decimalCountries) {
  const profile = validateBusinessProfileInput(
    {nombreComercial: "Empresa existente " + country.code, rubroCodigo: "INGENIERIA_CONSULTORIA", paisCodigo: country.code, regionEstado: "Región", monedaCodigo: country.defaultCurrencyCode},
    TestHttpsError,
    {existingBusiness: {paisCodigo: country.code}}
  );
  assert.equal(profile.paisCodigo, country.code);
  assert.equal(profile.monedaCodigo, country.defaultCurrencyCode);
}
rejectsWithCode(
  () => validateBusinessProfileInput(
    {nombreComercial: "Cambio de país", rubroCodigo: "INGENIERIA_CONSULTORIA", paisCodigo: "BO", regionEstado: "La Paz"},
    TestHttpsError,
    {existingBusiness: {paisCodigo: "CL"}}
  ),
  "invalid-argument"
);
rejectsWithCode(
  () => validateBusinessCreationInput(
    {
      nombreComercial: "Alta no soportada",
      rubroCodigo: "INGENIERIA_CONSULTORIA",
      paisCodigo: "OTHER",
    },
    TestHttpsError,
    {regionRequired: false}
  ),
  "invalid-argument"
);
rejectsWithCode(
  () =>
    validateBusinessCreationInput(
      {
        nombreComercial: "Negocio adicional",
        rubroCodigo: "INGENIERIA_CONSULTORIA",
      },
      TestHttpsError
    ),
  "invalid-argument"
);
rejectsWithCode(
  () => validateBusinessCreationInput({nombreComercial: "Legacy", rubroCodigo: "TECNOLOGIA_SOFTWARE", regionCodigo: "01"}, TestHttpsError),
  "invalid-argument"
);
const fallbackBusiness = validateBusinessCreationInput(
  {nombreComercial: "Servicios varios", rubroCodigo: "OTRO_SERVICIO_PROYECTOS", regionCodigo: "01"},
  TestHttpsError
);
assert.equal(fallbackBusiness.rubroNombre, "Otro servicio por proyectos");

const preservedLegacyProfile = validateBusinessProfileInput(
  {nombreComercial: "Empresa histórica", rubroCodigo: "RUBRO_HISTORICO", rubroNombre: "Oficio histórico", regionCodigo: "01"},
  TestHttpsError,
  {existingBusiness: {rubroCodigo: "RUBRO_HISTORICO", rubroNombre: "Oficio histórico"}}
);
assert.equal(preservedLegacyProfile.rubroCodigo, "RUBRO_HISTORICO");
assert.equal(preservedLegacyProfile.rubroNombre, "Oficio histórico");

const preservedLegacyCountryProfile = validateBusinessProfileInput(
  {
    nombreComercial: "Empresa exterior histórica",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    paisCodigo: "OTHER",
    monedaCodigo: "EUR",
    locale: "es",
    regionEstado: "Exterior",
    telefono: "+00 123456",
  },
  TestHttpsError,
  {existingBusiness: {paisCodigo: "OTHER"}}
);
assert.equal(preservedLegacyCountryProfile.paisCodigo, "OTHER");
assert.equal(preservedLegacyCountryProfile.monedaCodigo, "EUR");
assert.equal(preservedLegacyCountryProfile.telefono, "+00 123456");
rejectsWithCode(
  () => validateBusinessProfileInput(
    {
      nombreComercial: "Empresa nueva",
      rubroCodigo: "INGENIERIA_CONSULTORIA",
      paisCodigo: "OTHER",
      monedaCodigo: "USD",
      regionEstado: "Exterior",
    },
    TestHttpsError,
    {existingBusiness: {paisCodigo: "CL"}}
  ),
  "invalid-argument"
);

const profileWithoutOptionals = validateBusinessProfileInput(
  {
    nombreComercial: "Mauricio SPA",
    rubroCodigo: "TECNOLOGIA_INFORMATICA",
    regionCodigo: "01",
    comunaCodigo: "",
  },
  TestHttpsError
);
assert.equal(profileWithoutOptionals.comunaCodigo, undefined);
assert.equal(profileWithoutOptionals.rut, "");

const profileWithRut = validateBusinessProfileInput(
  {
    nombreComercial: "Mauricio SPA",
    rubroCodigo: "TECNOLOGIA_INFORMATICA",
    regionCodigo: "01",
    rut: "1.000.005-k",
  },
  TestHttpsError
);
assert.equal(profileWithRut.rut, "1000005-K");
rejectsWithCode(
  () =>
    validateBusinessProfileInput(
      {
        nombreComercial: "Mauricio SPA",
        rubroCodigo: "TECNOLOGIA_INFORMATICA",
        regionCodigo: "01",
        rut: "12.345.678-9",
      },
      TestHttpsError
    ),
  "invalid-argument"
);

assert.deepEqual(validateTaxSettings({ impuestoPredeterminadoId: "IVA_GENERAL" }, TestHttpsError), {
  impuestoPredeterminadoId: "IVA_GENERAL",
  impuestoPredeterminadoNombre: "IVA general",
  impuestoPredeterminadoTasa: 19,
});
assert.equal(
  validateTaxSettings({ impuestoPredeterminadoId: "SIN_IMPUESTO" }, TestHttpsError)
    .impuestoPredeterminadoTasa,
  0
);
rejectsWithCode(
  () => validateTaxSettings({ impuestoPredeterminadoId: "IVA_10" }, TestHttpsError),
  "invalid-argument"
);

assert.deepEqual(
  validateInventorySettings(
    { alertasStockBajo: true, umbralStockBajo: 4, permitirStockNegativo: true },
    TestHttpsError
  ),
  { alertasStockBajo: true, umbralStockBajo: 4, permitirStockNegativo: true }
);
rejectsWithCode(
  () => validateInventorySettings({ umbralStockBajo: -1 }, TestHttpsError),
  "invalid-argument"
);

const quoteSettings = validateQuoteSettings(
  {
    condicionesPago: "Transferencia",
    validezCotizacionDias: 21,
    notaFinalCotizacion: "Gracias.",
    plazoEntregaCotizacion: "No debe persistirse como ajuste de empresa",
    garantiaCotizacion: "Tampoco",
  },
  TestHttpsError
);
assert.equal(quoteSettings.validezCotizacionDias, 21);
assert.equal(quoteSettings.notaFinalCotizacion, "Gracias.");
assert.equal(quoteSettings.plazoEntregaCotizacion, "No debe persistirse como ajuste de empresa");
assert.equal(quoteSettings.garantiaCotizacion, "Tampoco");
rejectsWithCode(
  () => validateQuoteSettings({ validezCotizacionDias: 0 }, TestHttpsError),
  "invalid-argument"
);

assert.deepEqual(
  validatePersonalProfile(
    { nombres: "Mauricio", apellidos: "", tipoDocumento: "", numeroDocumento: "" },
    TestHttpsError
  ),
  { nombres: "Mauricio" }
);
rejectsWithCode(
  () => validatePersonalProfile({ nombres: "", tipoDocumento: "RUT" }, TestHttpsError),
  "invalid-argument"
);

console.log("OK: validaciones de configuración empresarial y perfil personal.");
