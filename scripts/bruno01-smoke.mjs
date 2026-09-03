import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {
  canAccessBusinessPathForVerification,
  canBusinessOperate,
  filterNavigationForBusinessVerification,
} from "../src/domain/businessOperations.mjs";

const require = createRequire(import.meta.url);
const {
  assertProtectedBusinessFieldsUnchanged,
  getJurisdictionContract,
} = require("../functions/businessJurisdiction.js");
const {assertBusinessCanOperate} = require("../functions/businessOperations.js");
const {validateBusinessCreationInput} = require("../functions/businessOnboarding.js");
const {documentLocalizationSnapshot} = require("../functions/localization.js");

class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const chile = getJurisdictionContract("CL");
assert.deepEqual(
  {
    paisCodigo: chile.paisCodigo,
    monedaCodigo: chile.monedaCodigo,
    locale: chile.locale,
    identificadorFiscalTipo: chile.identificadorFiscalTipo,
    impuestoPredeterminadoId: chile.impuestoPredeterminadoId,
    impuestoPredeterminadoNombre: chile.impuestoPredeterminadoNombre,
    impuestoPredeterminadoTasa: chile.impuestoPredeterminadoTasa,
  },
  {
    paisCodigo: "CL",
    monedaCodigo: "CLP",
    locale: "es-CL",
    identificadorFiscalTipo: "RUT",
    impuestoPredeterminadoId: "IVA_GENERAL",
    impuestoPredeterminadoNombre: "IVA",
    impuestoPredeterminadoTasa: 19,
  }
);
const peru = getJurisdictionContract("PE");
assert.equal(peru.monedaCodigo, "PEN");
assert.equal(peru.locale, "es-PE");
assert.equal(peru.identificadorFiscalTipo, "RUC");
assert.equal(peru.impuestoPredeterminadoTasa, 18);
const brazil = getJurisdictionContract("BR");
assert.equal(brazil.configuracionTributariaBaseCompleta, false);
assert.equal(brazil.impuestoPredeterminadoTasa, null);

const created = validateBusinessCreationInput({
  nombreComercial: "Empresa Chile",
  rubroCodigo: "INGENIERIA_CONSULTORIA",
  paisCodigo: "CL",
  monedaCodigo: "USD",
  locale: "en-US",
  identificadorFiscalTipo: "RFC",
  impuestoPredeterminadoTasa: 0,
}, TestHttpsError, {regionRequired: false});
assert.equal(created.monedaCodigo, "CLP");
assert.equal(created.locale, "es-CL");
assert.equal(created.identificadorFiscalTipo, "RUT");

const canonicalBusiness = {
  contratoJurisdiccionalVersion: 1,
  paisCodigo: "CL",
  paisNombre: "Chile",
  monedaCodigo: "CLP",
  monedaNombre: "Peso chileno",
  locale: "es-CL",
  identificadorFiscalTipo: "RUT",
  verificacionEmpresa: {estado: "NO_VERIFICADA"},
};
assert.doesNotThrow(() => assertProtectedBusinessFieldsUnchanged(
  {paisCodigo: "CL", monedaCodigo: "CLP", locale: "es-CL"},
  canonicalBusiness,
  {},
  TestHttpsError
));
for (const patch of [
  {paisCodigo: "PE"},
  {monedaCodigo: "USD"},
  {locale: "en-US"},
  {identificadorFiscalTipo: "RFC"},
  {identificadorFiscalValor: "76.000.000-0"},
  {impuestoPredeterminadoTasa: 12},
]) {
  assert.throws(
    () => assertProtectedBusinessFieldsUnchanged(
      patch,
      canonicalBusiness,
      {},
      TestHttpsError
    ),
    (error) => error?.code === "failed-precondition"
  );
}

const configuredTax = {configuracionTributariaBaseCompleta: true};
for (const role of ["OWNER", "ADMIN"]) {
  for (const state of ["NO_VERIFICADA", "PENDIENTE", "EN_REVISION", "RECHAZADA"]) {
  assert.throws(
    () => assertBusinessCanOperate(
      {rol: role, verificacionEmpresa: {estado: state}},
      configuredTax,
      TestHttpsError
    ),
    (error) => error?.code === "failed-precondition"
  );
  }
}
assert.doesNotThrow(() => assertBusinessCanOperate(
  {verificacionEmpresa: {estado: "VERIFICADA"}},
  configuredTax,
  TestHttpsError
));
assert.throws(
  () => assertBusinessCanOperate(
    {verificacionEmpresa: {estado: "VERIFICADA"}},
    {configuracionTributariaBaseCompleta: false},
    TestHttpsError
  ),
  (error) => error?.code === "failed-precondition"
);
assert.throws(
  () => assertBusinessCanOperate(
    {verificacionEmpresa: {estado: "NO_VERIFICADA"}},
    configuredTax,
    TestHttpsError
  ),
  (error) => error?.code === "failed-precondition"
);

const businessPaths = [
  "/reportes",
  "/finanzas",
  "/trabajos",
  "/inventario",
  "/clientes",
  "/cotizaciones/nueva",
  "/ventas",
  "/proveedores",
  "/ordenes-compra",
  "/recepciones",
  "/compras",
  "/empleados",
  "/referencias",
];
for (const state of ["NO_VERIFICADA", "PENDIENTE", "EN_REVISION", "RECHAZADA"]) {
  const activeBusiness = {id: `business-${state}`, verificacionEmpresa: {estado: state}};
  assert.equal(canBusinessOperate(activeBusiness), false);
  assert.equal(canAccessBusinessPathForVerification(activeBusiness, "/empresa"), true);
  assert.equal(canAccessBusinessPathForVerification(activeBusiness, "/cuenta/"), true);
  businessPaths.forEach((path) => {
    assert.equal(canAccessBusinessPathForVerification(activeBusiness, path), false);
  });
}
const verifiedBusiness = {id: "business-verified", verificacionEmpresa: {estado: "VERIFICADA"}};
assert.equal(canBusinessOperate(verifiedBusiness), true);
assert.equal(canBusinessOperate({...verifiedBusiness, puedeOperar: true}), true);
assert.equal(canBusinessOperate({...verifiedBusiness, puedeOperar: false}), false);
businessPaths.forEach((path) => {
  assert.equal(canAccessBusinessPathForVerification(verifiedBusiness, path), true);
});
const restrictedNavigation = filterNavigationForBusinessVerification([
  {label: "Inicio", items: [{to: "/reportes"}]},
  {label: "Gestión", items: [{to: "/empresa"}, {to: "/empleados"}]},
  {label: "Cuenta", items: [{to: "/cuenta"}]},
], {verificacionEmpresa: {estado: "EN_REVISION"}});
assert.deepEqual(
  restrictedNavigation.flatMap((section) => section.items.map((item) => item.to)),
  ["/empresa", "/cuenta"]
);
assert.equal(
  canAccessBusinessPathForVerification(
    {id: "business-unverified", verificacionEmpresa: {estado: "NO_VERIFICADA"}},
    "/ventas"
  ),
  false
);
assert.equal(
  canAccessBusinessPathForVerification(verifiedBusiness, "/ventas"),
  true
);

assert.deepEqual(documentLocalizationSnapshot({
  ...canonicalBusiness,
  monedaCodigo: "USD",
  locale: "en-US",
}, {
  impuestoPredeterminadoNombre: "Alterado",
  impuestoPredeterminadoTasa: 1,
}), {
  paisCodigo: "CL",
  moneda: "CLP",
  locale: "es-CL",
  impuestoNombre: "IVA",
  tasaIva: 0.19,
});
assert.equal(documentLocalizationSnapshot({
  contratoJurisdiccionalVersion: 1,
  paisCodigo: "BR",
}, {}).tasaIva, null);

const operationFiles = [
  "quotePersistence.js",
  "salePersistence.js",
  "purchaseOrderPersistence.js",
  "receptionPersistence.js",
  "purchasePersistence.js",
  "workPersistence.js",
  "inventoryModel.js",
];
for (const filename of operationFiles) {
  const source = await readFile(new URL(`../functions/${filename}`, import.meta.url), "utf8");
  assert.match(source, /requiresVerifiedBusiness:\s*true/);
}
const [
  companyUi,
  verificationBackend,
  businessJurisdiction,
  platformAdminService,
  platformAdminPages,
  app,
  operationGate,
  appLayout,
  initialActivation,
  functionsIndex,
  rules,
  storageRules,
  businessOnboarding,
  verificationService,
  businessCompletion,
] = await Promise.all([
  readFile(new URL("../src/features/company/CompanyConfig.jsx", import.meta.url), "utf8"),
  readFile(new URL("../functions/businessVerification.js", import.meta.url), "utf8"),
  readFile(new URL("../functions/businessJurisdiction.js", import.meta.url), "utf8"),
  readFile(new URL("../src/services/platformAdminService.js", import.meta.url), "utf8"),
  readFile(new URL("../src/platform/PlatformAdminPages.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/App.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/BusinessOperationGate.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/layout/AppLayout.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/InitialBusinessActivationPage.jsx", import.meta.url), "utf8"),
  readFile(new URL("../functions/index.js", import.meta.url), "utf8"),
  readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
  readFile(new URL("../storage.rules", import.meta.url), "utf8"),
  readFile(new URL("../functions/businessOnboarding.js", import.meta.url), "utf8"),
  readFile(new URL("../src/services/businessVerificationService.js", import.meta.url), "utf8"),
  readFile(new URL("../src/domain/businessCompletion.mjs", import.meta.url), "utf8"),
]);
assert.doesNotMatch(companyUi, /name="paisCodigo"/);
assert.doesNotMatch(companyUi, /name="monedaCodigo"/);
assert.doesNotMatch(companyUi, /Guardar impuestos/);
assert.match(companyUi, /Identificador fiscal declarado/);
const ownerVerificationUi = companyUi.slice(
  companyUi.indexOf("function BusinessVerificationSection"),
  companyUi.indexOf("function TaxSection")
);
assert.doesNotMatch(ownerVerificationUi, /razonSocial/);
assert.doesNotMatch(companyUi, /Acción reservada al OWNER/i);
assert.match(companyUi, /https:\/\/www\.empresa\.com/);
assert.match(ownerVerificationUi, /label="País"/);
assert.match(ownerVerificationUi, /label="Tipo de identificación fiscal"/);
assert.match(ownerVerificationUi, /Documento de respaldo/);
assert.match(ownerVerificationUi, /Adjunta un documento que permita acreditar la empresa o tu relación con ella/);
assert.match(ownerVerificationUi, /Seleccionar archivo/);
assert.match(companyUi, /No pudimos subir el documento\. Intenta nuevamente\./);
assert.match(ownerVerificationUi, /getPersonalProfile/);
assert.match(ownerVerificationUi, /currentUserEmail/);
assert.doesNotMatch(ownerVerificationUi, /Observaciones[\s\S]{0,80}optional/);
assert.match(verificationBackend, /identificadorFiscalValor: requestData\.identificadorFiscalValor/);
assert.match(verificationBackend, /razonSocialVerificada: officialLegalName/);
assert.match(verificationBackend, /razonSocial: officialLegalName/);
assert.match(verificationBackend, /officialLegalName: decision === "APROBAR"/);
assert.doesNotMatch(verificationBackend, /requestData\.razonSocial/);
assert.match(businessJurisdiction, /"razonSocial"/);
assert.match(platformAdminService, /razonSocialOficial/);
assert.match(platformAdminPages, /Razón social oficial/);
// El envío es una única expresión ternaria (antes eran dos ramas if/else
// separadas): al aprobar se envía el nombre recortado, al rechazar se envía
// vacío. Se verifica ambas ramas en una sola aserción sobre la forma actual.
assert.match(platformAdminPages, /razonSocialOficial: approving \? officialLegalName\.trim\(\) : ""/);
assert.match(app, /BusinessOperationGate/);
assert.match(app, /unverifiedSetupAccess/);
assert.match(operationGate, /Navigate to="\/empresa\?seccion=verificacion" replace/);
assert.match(appLayout, /filterNavigationForBusinessVerification/);
assert.match(appLayout, /onAddBusiness=\{businessVerified \?/);
assert.match(appLayout, /observedBusinessProfile/);
assert.match(appLayout, /normalizeBusinessVerificationState/);
assert.match(companyUi, /ACTIVATION_SECTION_IDS/);
assert.match(companyUi, /Empresa no verificada/);
assert.doesNotMatch(companyUi, /Empresa pendiente de verificación/);
assert.doesNotMatch(companyUi, /Pendiente de verificación/);
assert.match(businessCompletion, /Correo del propietario verificado/);
assert.match(companyUi, /<h1>Empresa<\/h1>/);
assert.doesNotMatch(companyUi, /OWNER · Puede editar/);
for (const label of [
  "Razón social",
  "Giro",
  "Comuna \/ ciudad",
  "Código postal",
  "Dirección comercial",
  "Teléfono comercial",
  "Correo comercial",
  "Sitio web",
]) {
  assert.doesNotMatch(companyUi, new RegExp(`label="${label}"[^>]*optional`));
}
assert.doesNotMatch(initialActivation, /Hacerlo después/);
assert.match(initialActivation, /\/empresa\?seccion=verificacion/);
for (const dependencies of [
  "clientPersistenceDependencies",
  "providerPersistenceDependencies",
  "businessMembershipDependencies",
  "inventoryModelDependencies",
  "operationalBusinessSettingsDependencies",
]) {
  assert.match(functionsIndex, new RegExp(`${dependencies}[\\s\\S]{0,240}requireOperationalBusinessAccess`));
}
assert.match(functionsIndex, /await requireOperationalBusinessAccess\(request, \{db, HttpsError\}\)/);
assert.match(functionsIndex, /firebasestorage\.app/);
assert.match(functionsIndex, /initializeApp\(\{storageBucket: FIREBASE_STORAGE_BUCKET\}\)/);
assert.match(businessOnboarding, /puedeOperar: verificationState === VERIFICATION_STATES\.VERIFIED/);
assert.match(storageRules, /businessVerificationRequests\/\$\(requestId\)/);
assert.match(storageRules, /allow delete: if resource != null/);
assert.match(verificationService, /await deleteObject\(evidence\.reference\)/);
assert.match(rules, /function canOperateBusiness\(businessId\)/);
assert.match(rules, /function canOperateActiveBusiness\(uid\)/);
assert.match(rules, /function hasSetupBusinessRole\(businessId, roles\)/);

console.log("BRUNO01_SMOKE_OK");
