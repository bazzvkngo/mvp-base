import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeQuickBusinessPayload } from "../src/domain/businessQuickPayload.mjs";
import { resolveInitialActivationRoute } from "../src/domain/initialActivationNavigation.mjs";
import { filterNavigationSections } from "../src/domain/rbac.mjs";

const [
  onboarding,
  drawer,
  fields,
  formModel,
  app,
  companyConfig,
  businessService,
  appLayout,
  navigation,
  activation,
  componentStyles,
] = await Promise.all([
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
  readFile(
    new URL("../src/features/company/CompanyConfig.jsx", import.meta.url),
    "utf8"
  ),
  readFile(new URL("../src/services/businessService.js", import.meta.url), "utf8"),
  readFile(new URL("../src/layout/AppLayout.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/navigation.js", import.meta.url), "utf8"),
  readFile(
    new URL("../src/pages/InitialBusinessActivationPage.jsx", import.meta.url),
    "utf8"
  ),
  readFile(new URL("../src/styles/components.css", import.meta.url), "utf8"),
]);

for (const field of [
  "nombreComercial",
  "rubroCodigo",
  "paisCodigo",
  "regionCodigo",
]) {
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
assert.match(onboarding, /showCountry/);
assert.match(onboarding, /showRegion=\{false\}/);
assert.match(fields, /NEW_BUSINESS_COUNTRIES/);
assert.doesNotMatch(fields, /COUNTRIES\.filter/);
assert.match(onboarding, /ONBOARDING_BUSINESS_FIELD_ORDER/);
assert.match(onboarding, /Ingresa lo esencial/);
assert.match(onboarding, /selectedCountry\.name/);
assert.match(onboarding, /selectedCurrency\.code/);
assert.doesNotMatch(onboarding, /más adelante/);
assert.doesNotMatch(onboarding, /onboarding-form__footnote/);
assert.match(drawer, /<QuickBusinessFields/);
assert.match(onboarding, /Crear mi negocio/);
assert.match(fields, /placeholder="Escribe el nombre de tu negocio"/);
assert.match(drawer, /Crear negocio/);
assert.deepEqual(
  normalizeQuickBusinessPayload({
    nombreComercial: "  Bagner   Servicios Integrales ",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    rubroOtro: "",
    regionCodigo: "",
    paisCodigo: "BO",
  }),
  {
    nombreComercial: "Bagner Servicios Integrales",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    paisCodigo: "BO",
  }
);
assert.deepEqual(
  normalizeQuickBusinessPayload({
    nombreComercial: "  Mauricio   SPA ",
    rubroCodigo: "SOFTWARE_SOLUCIONES_DIGITALES",
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
    rubroCodigo: "SOFTWARE_SOLUCIONES_DIGITALES",
    regionCodigo: "01",
  }
);
assert.deepEqual(
  normalizeQuickBusinessPayload({
    nombreComercial: "Otro negocio",
    rubroCodigo: "OTRO_SERVICIO_PROYECTOS",
    rubroOtro: "",
    regionCodigo: "01",
  }),
  {
    nombreComercial: "Otro negocio",
    rubroCodigo: "OTRO_SERVICIO_PROYECTOS",
    regionCodigo: "01",
  }
);
assert.match(onboarding, /setSubmitError\(getBusinessCreationErrorMessage\(error\)\)/);
assert.doesNotMatch(onboarding, /catch[\s\S]*setValues\(INITIAL_QUICK_BUSINESS_VALUES\)/);
assert.doesNotMatch(drawer, /catch[\s\S]*setValues\(INITIAL_QUICK_BUSINESS_VALUES\)/);
assert.match(app, /businessSession\?\.needsOnboarding/);
assert.match(app, /resolveInitialActivationRoute/);
assert.match(app, /onFirstBusinessCreated=\{handleFirstBusinessCreated\}/);
assert.match(activation, /Tu negocio ya está creado/);
assert.match(activation, /Completar y verificar empresa/);
assert.doesNotMatch(activation, /Hacerlo después/);
assert.match(activation, /useBusinessCompletionStatus/);
assert.match(activation, /BusinessCompletionCard/);
assert.match(activation, /finish\("\/empresa\?seccion=verificacion"\)/);
assert.match(activation, /onFinish\?\.\(path\)/);
assert.doesNotMatch(activation, /useNavigate|navigate\(/);
assert.deepEqual(
  resolveInitialActivationRoute({
    activeBusinessId: "business-1",
    destination: "",
    initialBusinessId: "business-1",
    pathname: "/onboarding",
  }),
  { status: "prompt", destination: "" }
);
assert.deepEqual(
  resolveInitialActivationRoute({
    activeBusinessId: "business-1",
    destination: "/empresa",
    initialBusinessId: "business-1",
    pathname: "/onboarding",
  }),
  { status: "redirect", destination: "/empresa" }
);
assert.deepEqual(
  resolveInitialActivationRoute({
    activeBusinessId: "business-1",
    destination: "/empresa",
    initialBusinessId: "business-1",
    pathname: "/empresa",
  }),
  { status: "settled", destination: "/empresa" }
);
assert.deepEqual(
  resolveInitialActivationRoute({
    activeBusinessId: "business-1",
    destination: "/reportes",
    initialBusinessId: "business-1",
    pathname: "/onboarding",
  }),
  { status: "redirect", destination: "/reportes" }
);
assert.deepEqual(
  resolveInitialActivationRoute({
    activeBusinessId: "business-1",
    destination: "",
    initialBusinessId: "",
    pathname: "/empresa",
  }),
  { status: "inactive", destination: "" }
);
assert.match(
  app,
  /initialActivationRoute\.status === "redirect"[\s\S]*?<Navigate to=\{initialActivationRoute\.destination\} replace \/>[\s\S]*?!canAccessBusinessPath/
);
assert.match(app, /path="\/login"[\s\S]*?Navigate to=\{safeLanding\} replace/);
assert.match(app, /path="\/onboarding" element=\{<Navigate to=\{safeLanding\} replace \/>\}/);
assert.match(app, /path="\/" element=\{<Navigate to=\{safeLanding\} replace \/>\}/);
assert.match(app, /path="\/dashboard" element=\{<Navigate to=\{safeLanding\} replace \/>\}/);
assert.match(app, /path="\/resumen" element=\{<Navigate to=\{safeLanding\} replace \/>\}/);
assert.match(
  appLayout,
  /navigate\(canBusinessOperate\(nextBusiness\)[\s\S]*?getDefaultBusinessPath\(nextBusiness\)[\s\S]*?"\/empresa\?seccion=verificacion"/
);
assert.match(componentStyles, /\.activation-checklist li:last-child:nth-child\(odd\)[\s\S]*?grid-column: 1 \/ -1/);
assert.match(componentStyles, /@media \(max-width: 640px\)[\s\S]*?\.activation-checklist li:last-child:nth-child\(odd\)[\s\S]*?grid-column: auto/);
assert.doesNotMatch(navigation, /to: "\/dashboard"/);
const sidebarRoutes = [...navigation.matchAll(/\bto: "(\/[^\"]+)"/g)].map(
  ([, route]) => route
);
assert.deepEqual(sidebarRoutes, [
  "/reportes",
  "/clientes",
  "/cotizaciones",
  "/ventas",
  "/trabajos",
  "/inventario",
  "/proveedores",
  "/ordenes-compra",
  "/recepciones",
  "/compras",
  "/empresa",
  "/empleados",
  "/cuenta",
]);
assert.doesNotMatch(navigation, /label: "Análisis"/);
assert.deepEqual(
  [...navigation.matchAll(/\blabel: "(Inicio|Operación|Comercial|Abastecimiento|Gestión|Cuenta)"/g)]
    .map(([, label]) => label),
  ["Inicio", "Comercial", "Operación", "Abastecimiento", "Gestión", "Cuenta"]
);
const sidebarSections = [{ items: sidebarRoutes.map((to) => ({ to })) }];
const visibleRoutesFor = (role) =>
  filterNavigationSections(sidebarSections, role).flatMap((section) =>
    section.items.map((item) => item.to)
  );
assert.deepEqual(visibleRoutesFor("OWNER"), sidebarRoutes);
assert.deepEqual(visibleRoutesFor("VENTAS"), [
  "/clientes",
  "/cotizaciones",
  "/ventas",
  "/inventario",
  "/cuenta",
]);
assert.deepEqual(visibleRoutesFor("COMPRAS"), [
  "/inventario",
  "/proveedores",
  "/ordenes-compra",
  "/recepciones",
  "/compras",
  "/cuenta",
]);
assert.deepEqual(visibleRoutesFor("TECNICO"), [
  "/trabajos",
  "/inventario",
  "/cuenta",
]);
assert.deepEqual(visibleRoutesFor("FINANZAS"), [
  "/reportes",
  "/ventas",
  "/inventario",
  "/ordenes-compra",
  "/recepciones",
  "/compras",
  "/cuenta",
]);
assert.match(app, /key=\{businessId\}/);
assert.match(companyConfig, /ownerOnly: true/);
assert.match(companyConfig, /<LockedSetting[\s\S]*?label="País"/);
assert.match(companyConfig, /confirmation\.trim\(\) === expectedName/);
assert.match(companyConfig, /Confirmar eliminación/);
assert.doesNotMatch(companyConfig, /Eliminar definitivamente/);
assert.match(companyConfig, /Empresa verificada/);
assert.match(companyConfig, /Este dato forma parte de la verificación\. Si cambia, ValoraCloud solicitará una nueva revisión\./);
assert.match(companyConfig, /estado === BUSINESS_VERIFICATION_STATES\.PENDING && \(\s*<p className="settings-message settings-message--warning"/);
assert.match(companyConfig, /Resumen tributario protegido/);
assert.match(companyConfig, /Pago y validez/);
assert.match(companyConfig, /Entrega y garantía/);
assert.match(companyConfig, /Condiciones generales/);
assert.match(companyConfig, /Notas del documento/);
assert.match(businessService, /httpsCallable\(functions, "deleteBusiness"\)/);
assert.doesNotMatch(drawer, /onLimitReached|resource-exhausted/);
assert.doesNotMatch(
  appLayout,
  /businessLimitOpen|canCreateBusiness === false|Alcanzaste el límite/
);

console.log("BUSINESS_QUICK_FLOW_SMOKE_OK");
