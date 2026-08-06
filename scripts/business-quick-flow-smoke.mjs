import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeQuickBusinessPayload } from "../src/domain/businessQuickPayload.mjs";

const [onboarding, drawer, fields, formModel, app] = await Promise.all([
  readFile(new URL("../src/pages/OnboardingPage.jsx", import.meta.url), "utf8"),
  readFile(
    new URL("../src/components/AdditionalBusinessDrawer.jsx", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("../src/components/QuickBusinessFields.jsx", import.meta.url),
    "utf8"
  ),
  readFile(new URL("../src/domain/businessForm.js", import.meta.url), "utf8"),
  readFile(new URL("../src/app/App.jsx", import.meta.url), "utf8"),
]);

for (const field of ["nombreComercial", "rubroCodigo", "regionCodigo"]) {
  assert.match(fields, new RegExp(`field: ["']${field}["']`));
  assert.match(formModel, new RegExp(`["']${field}["']`));
}

for (const forbidden of [
  "rut",
  "comunaCodigo",
  "direccion",
  "telefono",
  "email",
  "razonSocial",
]) {
  assert.doesNotMatch(fields, new RegExp(`field: ["']${forbidden}["']`));
}

assert.match(onboarding, /<QuickBusinessFields/);
assert.match(drawer, /<QuickBusinessFields/);
assert.match(onboarding, /Crear mi negocio/);
assert.match(drawer, /Crear negocio/);
assert.deepEqual(
  normalizeQuickBusinessPayload({
    nombreComercial: "  Mauricio   SPA ",
    rubroCodigo: "TECNOLOGIA_SOFTWARE",
    rubroOtro: "",
    regionCodigo: "01",
    comunaCodigo: "",
    ciudad: "",
    rut: "",
    direccion: "",
    telefono: "",
  }),
  {
    nombreComercial: "Mauricio SPA",
    rubroCodigo: "TECNOLOGIA_SOFTWARE",
    regionCodigo: "01",
  }
);
assert.deepEqual(
  normalizeQuickBusinessPayload({
    nombreComercial: "Otro negocio",
    rubroCodigo: "OTRO",
    rubroOtro: "  Reparación   de drones  ",
    regionCodigo: "01",
  }),
  {
    nombreComercial: "Otro negocio",
    rubroCodigo: "OTRO",
    rubroOtro: "Reparación de drones",
    regionCodigo: "01",
  }
);
assert.match(onboarding, /setSubmitError\(getBusinessCreationErrorMessage\(error\)\)/);
assert.doesNotMatch(onboarding, /catch[\s\S]*setValues\(INITIAL_QUICK_BUSINESS_VALUES\)/);
assert.doesNotMatch(drawer, /catch[\s\S]*setValues\(INITIAL_QUICK_BUSINESS_VALUES\)/);
assert.match(app, /businessSession\?\.needsOnboarding/);
assert.match(app, /<Navigate to="\/dashboard" replace/);
assert.match(app, /key=\{businessId\}/);

console.log("BUSINESS_QUICK_FLOW_SMOKE_OK");
