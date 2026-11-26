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
    rubroCodigo: "OTRO_SERVICIO_PROYECTOS",
    regionCodigo: "01",
  },
  TestHttpsError
);
assert.equal(quickBusiness.nombreComercial, "Mauricio SPA");
assert.equal(quickBusiness.rubroCodigo, "OTRO_SERVICIO_PROYECTOS");
assert.equal(quickBusiness.regionNombre, "Tarapacá");
assert.equal(quickBusiness.paisCodigo, "CL");
assert.equal(quickBusiness.monedaCodigo, "CLP");
assert.equal("comunaCodigo" in quickBusiness, false);
const firstBusinessWithoutRegion = validateBusinessCreationInput(
  {
    nombreComercial: "Bagner Servicios Integrales",
    rubroCodigo: "OTRO_SERVICIO_PROYECTOS",
  },
  TestHttpsError,
  {regionRequired: false}
);
assert.equal(firstBusinessWithoutRegion.regionCodigo, "");
assert.equal(firstBusinessWithoutRegion.regionNombre, "");
// Paraguay queda cerrado para empresas nuevas (las existentes siguen: ver más abajo).
rejectsWithCode(
  () => validateBusinessCreationInput(
    {nombreComercial: "Servicios Paraguay", rubroCodigo: "OTRO_SERVICIO_PROYECTOS", paisCodigo: "PY"},
    TestHttpsError,
    {regionRequired: false}
  ),
  "invalid-argument"
);
// Empresas nuevas: solo Chile y Bolivia (Bolivia piloto con montos enteros, acta 7.6.1 opción (a)).
for (const [paisCodigo, monedaCodigo] of [
  ["CL", "CLP"],
  ["BO", "BOB"],
]) {
  const business = validateBusinessCreationInput(
    {
      nombreComercial: "Negocio " + paisCodigo,
      rubroCodigo: "OTRO_SERVICIO_PROYECTOS",
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
// Países cerrados para empresas nuevas (sin OTHER, que es heredado): Paraguay se cerró al abrir Bolivia.
const decimalCountries = catalogJson.countries.filter((country) => country.code !== "OTHER" && country.selectableForNewBusiness === false);
assert.deepEqual(decimalCountries.map((country) => country.code), ["BR", "PE", "AR", "CO", "EC", "PY", "UY", "MX"]);
assert.ok(currencyDecimalsByCode.get("BOB") > 0, "Bolivia se abre con moneda de 2 decimales y dinero entero redondeado");
const creationAttempt = (paisCodigo) => () => validateBusinessCreationInput(
  {nombreComercial: "Negocio " + paisCodigo, rubroCodigo: "OTRO_SERVICIO_PROYECTOS", paisCodigo, monedaCodigo: "USD"},
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
const paraguayCatalogEntry = catalogJson.countries.find((country) => country.code === "PY");
assert.equal(paraguayCatalogEntry.selectableForNewBusiness, false);
try {
  paraguayCatalogEntry.selectableForNewBusiness = true;
  const reactivated = creationAttempt("PY")();
  assert.equal(reactivated.paisCodigo, "PY");
  assert.equal(reactivated.monedaCodigo, "PYG");
  delete paraguayCatalogEntry.selectableForNewBusiness;
  assert.equal(creationAttempt("PY")().paisCodigo, "PY");
} finally {
  paraguayCatalogEntry.selectableForNewBusiness = false;
}
assert.throws(creationAttempt("PY"), (error) => error?.code === "invalid-argument");

// Región por país (Bolivia: departamentos del catálogo). createFirstBusiness es tolerante: sin región pasa,
// pero lo enviado se valida contra el catálogo del país.
const bolivianFirst = (extra, options = {regionRequired: false}) => validateBusinessCreationInput(
  {nombreComercial: "Taller La Paz", rubroCodigo: "TALLER_AUTOMOTRIZ", paisCodigo: "BO", ...extra},
  TestHttpsError,
  options
);
const boliviaLaPaz = bolivianFirst({regionCodigo: "LP"});
assert.equal(boliviaLaPaz.paisCodigo, "BO");
assert.equal(boliviaLaPaz.monedaCodigo, "BOB");
assert.equal(boliviaLaPaz.locale, "es-BO");
assert.equal(boliviaLaPaz.identificadorFiscalTipo, "NIT");
assert.equal(boliviaLaPaz.regionCodigo, "LP");
assert.equal(boliviaLaPaz.regionNombre, "La Paz");
assert.equal(boliviaLaPaz.regionEstado, "La Paz");
assert.equal("comunaCodigo" in boliviaLaPaz, false);
for (const department of catalogJson.territoriesByCountry.BO.regions) {
  const created = bolivianFirst({regionCodigo: department.code});
  assert.equal(created.regionNombre, department.name, department.code);
}
assert.equal(bolivianFirst({regionCodigo: "lp"}).regionCodigo, "LP", "el código se acepta en minúsculas");
assert.equal(bolivianFirst({regionEstado: "potosi"}).regionCodigo, "PO", "el nombre coincide con el catálogo (sin tildes)");
const boliviaWithoutRegion = bolivianFirst({});
assert.equal(boliviaWithoutRegion.regionCodigo, "");
assert.equal(boliviaWithoutRegion.regionNombre, "");
for (const invalidRegion of [{regionCodigo: "XX"}, {regionCodigo: "13"}, {regionEstado: "Florida"}]) {
  assert.throws(
    () => bolivianFirst(invalidRegion),
    (error) => error?.code === "invalid-argument" && error.message === "Selecciona un departamento válido.",
    JSON.stringify(invalidRegion)
  );
}
rejectsWithCode(() => bolivianFirst({}, {}), "invalid-argument");
// Un código de Bolivia no vale en Chile y Chile no cambia: región de la lista, comuna opcional.
rejectsWithCode(
  () => validateBusinessCreationInput({nombreComercial: "Chile", rubroCodigo: "TALLER_AUTOMOTRIZ", regionCodigo: "LP"}, TestHttpsError, {regionRequired: false}),
  "invalid-argument"
);
const chileMetropolitana = validateBusinessCreationInput({nombreComercial: "Chile", rubroCodigo: "TALLER_AUTOMOTRIZ", regionCodigo: "13"}, TestHttpsError, {regionRequired: false});
assert.equal(chileMetropolitana.regionNombre, "Metropolitana de Santiago");
assert.equal(chileMetropolitana.paisCodigo, "CL");
// Perfil de una empresa boliviana: región del catálogo; una región antigua en texto libre se conserva si no cambia.
const boliviaProfile = (profile, existingBusiness) => validateBusinessProfileInput(
  {nombreComercial: "Taller La Paz", rubroCodigo: "TALLER_AUTOMOTRIZ", paisCodigo: "BO", ...profile},
  TestHttpsError,
  {existingBusiness: {paisCodigo: "BO", rubroCodigo: "TALLER_AUTOMOTRIZ", ...existingBusiness}}
);
assert.equal(boliviaProfile({regionCodigo: "SC", ciudad: "Santa Cruz de la Sierra"}).regionNombre, "Santa Cruz");
assert.equal(boliviaProfile({regionCodigo: "SC", ciudad: "Montero"}).ciudad, "Montero");
rejectsWithCode(() => boliviaProfile({}), "invalid-argument");
rejectsWithCode(() => boliviaProfile({regionEstado: "Florida"}), "invalid-argument");
const legacyBolivianProfile = boliviaProfile(
  {regionEstado: "Santa Cruz de la Sierra"},
  {regionEstado: "Santa Cruz de la Sierra", regionCodigo: ""}
);
assert.equal(legacyBolivianProfile.regionNombre, "Santa Cruz de la Sierra");
assert.equal(legacyBolivianProfile.regionCodigo, "");
rejectsWithCode(
  () => boliviaProfile({regionEstado: "Otra ciudad"}, {regionEstado: "Santa Cruz de la Sierra"}),
  "invalid-argument"
);
// Los rubros retirados no se crean pero un negocio existente los conserva.
rejectsWithCode(
  () => validateBusinessCreationInput({nombreComercial: "Oculto", rubroCodigo: "SEGURIDAD_TELECOMUNICACIONES", regionCodigo: "13"}, TestHttpsError),
  "invalid-argument"
);
assert.equal(
  validateBusinessProfileInput(
    {nombreComercial: "Oculto", rubroCodigo: "SEGURIDAD_TELECOMUNICACIONES", regionCodigo: "13"},
    TestHttpsError,
    {existingBusiness: {rubroCodigo: "SEGURIDAD_TELECOMUNICACIONES", rubroNombre: "Seguridad electrónica y telecomunicaciones"}}
  ).rubroCodigo,
  "SEGURIDAD_TELECOMUNICACIONES"
);
for (const code of ["TECNOLOGIA_INFORMATICA", "ELECTRICIDAD_ENERGIA_CLIMATIZACION", "INGENIERIA_CONSULTORIA"]) {
  assert.equal(
    validateBusinessCreationInput({nombreComercial: "Seleccionable", rubroCodigo: code, regionCodigo: "13"}, TestHttpsError).rubroCodigo,
    code
  );
}
// Las empresas ya creadas en esos países siguen funcionando: editar su perfil conserva el país y no pasa por la selección de países nuevos.
for (const country of decimalCountries) {
  const profile = validateBusinessProfileInput(
    {nombreComercial: "Empresa existente " + country.code, rubroCodigo: "OTRO_SERVICIO_PROYECTOS", paisCodigo: country.code, regionEstado: "Región", monedaCodigo: country.defaultCurrencyCode},
    TestHttpsError,
    {existingBusiness: {paisCodigo: country.code}}
  );
  assert.equal(profile.paisCodigo, country.code);
  assert.equal(profile.monedaCodigo, country.defaultCurrencyCode);
}
rejectsWithCode(
  () => validateBusinessProfileInput(
    {nombreComercial: "Cambio de país", rubroCodigo: "OTRO_SERVICIO_PROYECTOS", paisCodigo: "PY", regionEstado: "Asunción"},
    TestHttpsError,
    {existingBusiness: {paisCodigo: "CL"}}
  ),
  "invalid-argument"
);
rejectsWithCode(
  () => validateBusinessCreationInput(
    {
      nombreComercial: "Alta no soportada",
      rubroCodigo: "OTRO_SERVICIO_PROYECTOS",
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
        rubroCodigo: "OTRO_SERVICIO_PROYECTOS",
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
    rubroCodigo: "OTRO_SERVICIO_PROYECTOS",
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
      rubroCodigo: "OTRO_SERVICIO_PROYECTOS",
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
    rubroCodigo: "OTRO_SERVICIO_PROYECTOS",
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
    rubroCodigo: "OTRO_SERVICIO_PROYECTOS",
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
        rubroCodigo: "OTRO_SERVICIO_PROYECTOS",
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
