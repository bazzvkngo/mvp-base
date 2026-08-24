import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BUSINESS_COMPLETION_WEIGHTS,
  getBusinessCompletionStatus,
} from "../src/domain/businessCompletion.mjs";

assert.equal(
  Object.values(BUSINESS_COMPLETION_WEIGHTS).reduce((sum, weight) => sum + weight, 0),
  100
);

const initialProfile = {
  nombreComercial: "Bagner Servicios Integrales",
  rubroCodigo: "SERVICIOS_TECNICOS_MANTENCION",
  paisCodigo: "CL",
  monedaCodigo: "CLP",
  locale: "es-CL",
  verificacionEmpresa: { estado: "NO_VERIFICADA" },
};
const initial = getBusinessCompletionStatus(initialProfile);
assert.equal(initial.percent, 25);
assert.equal(initial.label, "Configuración inicial");
assert.equal(initial.verificationStatus, "NO_VERIFICADA");
assert.equal(initial.nextRecommendedAction.id, "fiscalIdentity");

const fiscal = getBusinessCompletionStatus({
  ...initialProfile,
  razonSocial: "Bagner Servicios Integrales SpA",
  identificadorFiscalValor: "12.345.678-5",
});
assert.equal(fiscal.percent, 40);
assert.equal(fiscal.label, "Perfil en progreso");

const completeProfile = {
  ...initialProfile,
  razonSocial: "Bagner Servicios Integrales SpA",
  identificadorFiscalValor: "12.345.678-5",
  email: "contacto@bagner.test",
  direccion: "Avenida Uno 123",
  regionCodigo: "13",
  comunaCodigo: "13101",
  logoPath: "negocios/business-a/logo.png",
};
const profileReady = getBusinessCompletionStatus(completeProfile);
assert.equal(profileReady.percent, 70);
assert.equal(profileReady.label, "Empresa casi lista");
const unverifiedEmail = getBusinessCompletionStatus(completeProfile, {
  ownerEmailVerified: false,
  verificationStatus: "VERIFICADA",
});
assert.equal(unverifiedEmail.percent, 90);
assert.notEqual(unverifiedEmail.percent, 100);

const pendingVerification = getBusinessCompletionStatus(completeProfile, {
  ownerEmailVerified: true,
  verificationStatus: "PENDIENTE",
});
assert.equal(pendingVerification.percent, 80);
assert.notEqual(pendingVerification.percent, 100);

const complete = getBusinessCompletionStatus(completeProfile, {
  ownerEmailVerified: true,
  verificationStatus: "VERIFICADA",
});
assert.equal(complete.percent, 100);
assert.equal(complete.label, "Empresa completa y verificada");
assert.equal(complete.pendingItems.length, 0);

const otherBusiness = getBusinessCompletionStatus({
  ...initialProfile,
  nombreComercial: "Empresa B",
  telefono: "+56 9 1111 1111",
});
assert.equal(otherBusiness.percent, 35);
assert.equal(initial.percent, 25);

const legacy = getBusinessCompletionStatus({
  nombreComercial: "Empresa legacy",
  rubroNombre: "Rubro histórico",
  paisCodigo: "CL",
  monedaCodigo: "CLP",
  locale: "es-CL",
  razonSocial: "Empresa Legacy Ltda.",
  rut: "11.111.111-1",
  telefono: "+56 2 2222 2222",
  direccion: "Calle Legacy 10",
  region: "Metropolitana",
  ciudad: "Santiago",
  logoUrl: "https://example.test/logo.png",
  verificacionEmpresa: { estado: "VERIFICADA" },
}, { ownerEmailVerified: true });
assert.equal(legacy.percent, 100);

const [layout, company, activation, hook, sessionBackend] = await Promise.all([
  readFile(new URL("../src/layout/AppLayout.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/company/CompanyConfig.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/InitialBusinessActivationPage.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/hooks/useBusinessCompletionStatus.js", import.meta.url), "utf8"),
  readFile(new URL("../functions/businessOnboarding.js", import.meta.url), "utf8"),
]);
assert.match(layout, /\["OWNER", "ADMIN"\]\.includes/);
assert.match(layout, /businessCompletionStatus\.percent/);
assert.match(layout, /ownerEmailVerified = negocioActivo\?\.ownerEmailVerified === true/);
assert.doesNotMatch(
  layout,
  /ownerEmailVerified = negocioActivo\?\.role === "OWNER"/
);
assert.match(layout, /<Outlet context=\{\{ businessCompletionStatus \}\}/);
assert.match(company, /<BusinessCompletionCard/);
assert.match(activation, /<BusinessCompletionCard/);
assert.match(activation, /useBusinessCompletionStatus/);
assert.match(hook, /getBusinessCompletionStatus/);
assert.match(hook, /subscribeToCompanyProfile/);
assert.match(sessionBackend, /auth\.getUser\(ownerUid\)/);
assert.match(sessionBackend, /ownerEmailVerified/);

console.log("BUSINESS_COMPLETION_SMOKE_OK");
