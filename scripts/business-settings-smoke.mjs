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
    rubroCodigo: "TECNOLOGIA_SOFTWARE",
    regionCodigo: "01",
  },
  TestHttpsError
);
assert.equal(quickBusiness.nombreComercial, "Mauricio SPA");
assert.equal(quickBusiness.rubroCodigo, "TECNOLOGIA_SOFTWARE");
assert.equal(quickBusiness.regionNombre, "Tarapacá");
assert.equal(quickBusiness.paisCodigo, "CL");
assert.equal(quickBusiness.monedaCodigo, "CLP");
assert.equal("comunaCodigo" in quickBusiness, false);

const profileWithoutOptionals = validateBusinessProfileInput(
  {
    nombreComercial: "Mauricio SPA",
    rubroCodigo: "TECNOLOGIA_SOFTWARE",
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
    rubroCodigo: "TECNOLOGIA_SOFTWARE",
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
        rubroCodigo: "TECNOLOGIA_SOFTWARE",
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
assert.equal("plazoEntregaCotizacion" in quoteSettings, false);
assert.equal("garantiaCotizacion" in quoteSettings, false);
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
