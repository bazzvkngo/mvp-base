import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import { normalizeQuickBusinessPayload } from "../src/domain/businessQuickPayload.mjs";
import { resolveInitialActivationRoute } from "../src/domain/initialActivationNavigation.mjs";
import { filterNavigationSections } from "../src/domain/rbac.mjs";
import { buildNavigationSections, navigationSections } from "../src/app/navigation.js";

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
    rubroCodigo: "TECNOLOGIA_INFORMATICA",
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
    rubroCodigo: "TECNOLOGIA_INFORMATICA",
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
  /navigate\(canBusinessOperate\(nextBusiness\)[\s\S]*?getDefaultBusinessPath\(nextBusiness, getBusinessPathOptions\(nextBusiness\)\)[\s\S]*?"\/empresa\?seccion=verificacion"/
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
// Módulos verticales: con el registro vacío del Core el menú no cambia y no hay
// grupo "Módulos"; con un registro de prueba solo aparece el módulo habilitado.
assert.equal(buildNavigationSections(), navigationSections);
assert.equal(navigationSections.some((section) => section.label === "Módulos"), false);
assert.deepEqual(
  filterNavigationSections(buildNavigationSections(), "OWNER").map((section) => section.label),
  ["Inicio", "Comercial", "Operación", "Abastecimiento", "Gestión", "Cuenta"]
);
const testVerticalRegistry = [{ id: "prueba", label: "Módulo de prueba", basePath: "/modulo-prueba" }];
const verticalSections = buildNavigationSections(testVerticalRegistry);
assert.deepEqual(verticalSections.map((section) => section.label).slice(-2), ["Módulos", "Cuenta"]);
const verticalMenuFor = (options) =>
  filterNavigationSections(verticalSections, { role: "OWNER" }, { registry: testVerticalRegistry, ...options })
    .flatMap((section) => section.items.map((item) => item.to));
assert.equal(verticalMenuFor({}).includes("/modulo-prueba"), false, "sin enabledModules el vertical no se ve");
assert.equal(verticalMenuFor({ enabledModules: [] }).includes("/modulo-prueba"), false);
assert.match(app, /key=\{businessId\}/);
assert.match(companyConfig, /ownerOnly: true/);
assert.match(companyConfig, /<CompanyFact\s+label="País"/);
assert.match(companyConfig, /confirmation\.trim\(\) === expectedName/);
assert.match(companyConfig, /Desactivar para todos/);
assert.doesNotMatch(companyConfig, /Eliminar definitivamente/);
// "Empresa verificada" sale de la etiqueta de estado (EM2: es la única mención de "verificada" en Información empresa).
assert.match(await readFile(new URL("../src/services/businessVerificationService.js", import.meta.url), "utf8"), /VERIFICADA: "Empresa verificada"/);
assert.match(companyConfig, /<dt>Estado<\/dt>\s*<dd className=\{form\.verificacionEmpresa\?\.estado === BUSINESS_VERIFICATION_STATES\.VERIFIED \? "is-verified" : ""\}>[\s\S]*?BUSINESS_VERIFICATION_STATUS_LABELS\[/);
assert.match(companyConfig, /aria-label="Resumen de la empresa"/);
assert.match(companyConfig, /<dt>Estado<\/dt>[\s\S]*<dt>Rubro<\/dt>/);
assert.match(companyConfig, /Estos datos forman parte de la verificación\. Si cambian, ValoraCloud solicitará una nueva revisión\./);
// A2: sin aviso amarillo de "invalidará la verificación" (la pantalla no ofrece editar la razón social);
// EM2: la advertencia es una sola nota para toda la franja fiscal, en PENDIENTE y en VERIFICADA.
assert.doesNotMatch(companyConfig, /Cambiar la razón social invalidará/);
assert.doesNotMatch(companyConfig, /Pendiente por completar|recommendedPending/);
assert.match(companyConfig, /\[BUSINESS_VERIFICATION_STATES\.PENDING, BUSINESS_VERIFICATION_STATES\.VERIFIED\]\.includes\(form\.verificacionEmpresa\?\.estado\) && \(\s*<p className="company-verification-strip__note">\s*Estos datos forman parte de la verificación/);
assert.doesNotMatch(companyConfig, /name="razonSocial"/, "la razón social sigue bloqueada: no hay campo para editarla");
assert.doesNotMatch(companyConfig, new RegExp(String.fromCharCode(92) + "u00a0"), "sin secuencias de escape en la fuente");
assert.match(companyConfig, /Resumen tributario protegido/);
assert.match(companyConfig, /Pago y validez/);
assert.match(companyConfig, /Entrega y garantía/);
assert.match(companyConfig, /Condiciones generales/);
assert.match(companyConfig, /Notas finales/);

// Empresa EM2: franja fiscal de solo lectura (un candado, una nota, una sola mención de "verificada").
{
  const count = (text, pattern) => (text.match(pattern) || []).length;
  const infoSection = companyConfig.slice(companyConfig.indexOf("function BusinessInformationSection"), companyConfig.indexOf("function BusinessVerificationSection"));
  const summaryDl = infoSection.slice(infoSection.indexOf('<dl className="company-profile-summary'), infoSection.indexOf("</dl>"));
  const strip = infoSection.slice(infoSection.indexOf("company-verification-strip__header"), infoSection.indexOf("<h3>Datos comerciales</h3>"));
  // 1. Seis datos en una franja, con un solo candado y una sola nota.
  for (const label of ['label="País"', 'label="Moneda nacional"', 'label="Formato regional"', 'label="Identificación fiscal"', 'label="Razón social oficial"']) {
    assert.ok(strip.includes(label), `la franja muestra ${label}`);
  }
  assert.match(strip, /`Estado del \$\{form\.identificadorFiscalTipo \|\| "identificador fiscal"\}`[\s\S]*?targetId="empresa-fiscal"[\s\S]*?value=\{form\.identificadorFiscalValor\}/, "el RUT (o su estado) sigue en la franja y conserva el objetivo de foco");
  assert.match(strip, /targetId="empresa-configuracion"/, "el objetivo de foco de País se conserva");
  assert.equal(count(strip, /<AppIcon icon=\{Lock\}/g), 1, "un solo candado en la franja");
  assert.doesNotMatch(infoSection, /<LockedSetting|settings-locked-field/, "ya no hay seis campos grises con un candado cada uno");
  assert.equal(count(infoSection, /forman parte de la verificación/g), 1, "una sola nota");
  assert.doesNotMatch(infoSection, /Este dato forma parte/, "sin la nota por campo");
  // 2. Una sola mención de "verificada" en la sección: el Estado del resumen.
  assert.doesNotMatch(infoSection, /Verificación vigente|company-verified-status|✓ Verificado|"Empresa verificada"|company-authoritative-card|(?<!no) verificado`/, "sin insignia, título ni etiquetas que repitan 'verificada'");
  assert.equal(count(summaryDl, /BUSINESS_VERIFICATION_STATUS_LABELS\[/g), 1, "el Estado del resumen es la única mención");
  assert.match(strip, /<h3>Datos fiscales<\/h3>/, "título neutro de la franja");
  // 3. El resumen no repite lo de la franja: solo Estado y Rubro.
  assert.equal(count(summaryDl, /<dt>/g), 2);
  assert.doesNotMatch(summaryDl, /<dt>(País|Razón social)<\/dt>|identificadorFiscal|razonSocial|paisNombre/, "el resumen no repite país, RUT ni razón social");
  assert.match(summaryDl, /getBusinessCategoryVisibleName\(form\.rubroCodigo, form\.rubroOtro, form\.rubroNombre\)/, "el rubro conserva su nombre visible");
  // 4. Todos los estados de verificación conservan sus textos y acciones.
  assert.match(strip, /BUSINESS_VERIFICATION_STATES\.VERIFIED && \(|!== BUSINESS_VERIFICATION_STATES\.VERIFIED && \(/, "pendiente, rechazada y sin verificar siguen en la franja");
  assert.match(strip, /settings-verification-pill is-\$\{/, "la insignia por estado se conserva");
  assert.match(strip, /\$\{form\.identificadorFiscalTipo \|\| "Identificador fiscal"\} no verificado/, "texto de sin verificar");
  assert.match(strip, /BUSINESS_VERIFICATION_STATUS_LABELS\[\s*form\.verificacionEmpresa\?\.estado \|\| BUSINESS_VERIFICATION_STATES\.NOT_VERIFIED\s*\]/, "textos de pendiente y rechazada (etiquetas del servicio)");
  assert.match(strip, /navigate\("\/empresa\?seccion=verificacion"\)[\s\S]*?Ir a verificación/, "la acción Ir a verificación se conserva");
  const serviceLabels = await readFile(new URL("../src/services/businessVerificationService.js", import.meta.url), "utf8");
  for (const text of ["Empresa no verificada", "Verificación en revisión", "Empresa verificada", "Verificación empresarial rechazada"]) {
    assert.ok(serviceLabels.includes(`"${text}"`), `etiqueta de estado: ${text}`);
  }
  // 5. Estilos nuevos: solo tokens.
  const interiorCss = (await readFile(new URL("../src/styles/interior.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const cssStart = interiorCss.indexOf("/* Resumen compacto (Estado y Rubro)");
  const stripCss = interiorCss.slice(cssStart, interiorCss.indexOf("\n}\n", interiorCss.indexOf("@media (max-width: 640px)", cssStart)) + 3).replace(/@media[^{]*\{/g, "");
  assert.ok(cssStart > 0 && stripCss.includes(".company-verification-strip__facts"), "se encontró el bloque de estilos nuevos");
  assert.doesNotMatch(stripCss, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|(?<![\d.])(?!1px\b)\d+px|var\(--color-(brand|dark)-/, "los estilos nuevos usan solo tokens semánticos");
}

// Empresa EM2b: recuadros suaves, dos filas, acento verde solo en el RUT verificado y toque de marca en la tarjeta.
{
  const count = (text, pattern) => (text.match(pattern) || []).length;
  const infoSection = companyConfig.slice(companyConfig.indexOf("function BusinessInformationSection"), companyConfig.indexOf("function BusinessVerificationSection"));
  const strip = infoSection.slice(infoSection.indexOf("company-verification-strip__header"), infoSection.indexOf("<h3>Datos comerciales</h3>"));
  const factComponent = companyConfig.slice(companyConfig.indexOf("function CompanyFact("), companyConfig.indexOf("function SectionFrame("));
  const interiorCss = (await readFile(new URL("../src/styles/interior.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const rule = (selector) => {
    const at = interiorCss.indexOf(`${selector} {`);
    assert.ok(at >= 0, `existe la regla ${selector}`);
    return interiorCss.slice(at, interiorCss.indexOf("\n}\n", at) + 3);
  };
  // 1. Cada dato en su recuadro suave: fondo y borde fino con tokens, etiqueta arriba y valor abajo.
  const factRule = rule(".company-verification-strip__fact");
  assert.match(factRule, /background: var\(--color-surface-subtle\);/);
  assert.match(factRule, /border: 1px solid var\(--color-border-subtle\);/);
  assert.match(factRule, /border-radius: var\(--radius-sm\);/);
  assert.match(factRule, /padding: var\(--space-2\) var\(--space-3\);/);
  assert.match(factComponent, /<dt>\{label\}<\/dt>\s*<dd>/, "etiqueta arriba y valor abajo");
  assert.match(rule(".company-verification-strip__fact dt"), /font-size: var\(--font-size-xs\);/, "etiqueta pequeña");
  assert.match(rule(".company-verification-strip__fact dd"), /font-weight: var\(--font-weight-semibold\);/, "valor en negrita");
  // 2. Distribución: 4 en la primera fila; RUT y razón social, de 2 columnas cada uno, en la segunda.
  assert.match(rule(".company-verification-strip__facts"), /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(rule(".company-verification-strip__fact--wide"), /grid-column: span 2;/);
  const facts = strip.split("<CompanyFact").slice(1);
  assert.equal(facts.length, 6, "seis datos");
  facts.slice(0, 4).forEach((fact, index) => assert.doesNotMatch(fact, /\bwide\b/, `el dato ${index + 1} ocupa una columna`));
  assert.match(facts[4], /^\s+wide$/m, "el RUT ocupa dos columnas aunque no esté verificado");
  assert.match(facts[5], /\bwide\s*\/>/, "la razón social ocupa dos columnas");
  assert.match(interiorCss, /@media \(max-width: 900px\) \{\s*\.company-verification-strip__facts \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/, "dos columnas en pantallas medianas");
  assert.match(interiorCss, /@media \(max-width: 640px\) \{[\s\S]*?\.company-verification-strip__fact--wide \{\s*grid-column: auto;/, "una columna en móvil, sin columna implícita");
  // 3. Acento verde sobrio solo en el RUT verificado, con check de texto accesible y sin textos visibles nuevos.
  assert.equal(count(strip, /accent=\{/g), 1, "un solo recuadro con acento");
  assert.match(facts[4], /accent=\{isVerified\}/, "el acento es del RUT y solo cuando está verificada");
  assert.equal(count(infoSection, /aria-label="Verificado"/g), 1, "un solo check con texto accesible");
  assert.match(facts[4], /trailing=\{isVerified \? \(\s*<span className="company-verification-strip__check" role="img" aria-label="Verificado">\s*<AppIcon icon=\{Check\} size=\{15\} \/>/, "el check solo aparece verificada");
  assert.doesNotMatch(infoSection, />\s*Verificado\s*<|Verificación vigente|✓ Verificado|"Empresa verificada"/, "ningún texto visible nuevo de verificada");
  const accent = rule(".company-verification-strip__fact--verified");
  assert.match(accent, /background: var\(--color-success-50\);/);
  assert.match(accent, /border-color: var\(--color-success-200\);/);
  assert.match(interiorCss, /\.company-verification-strip__fact--verified dt,\s*\.company-verification-strip__fact--verified dd \{\s*color: var\(--color-success-700\);/, "texto verde con el mismo par ya usado por el estado verificado");
  // 4. Tarjeta con toque de marca solo verificada; neutra en pendiente, rechazada y sin verificar; un candado y la nota.
  assert.match(infoSection, /const isVerified = form\.verificacionEmpresa\?\.estado === BUSINESS_VERIFICATION_STATES\.VERIFIED;/);
  assert.match(infoSection, /company-verification-strip\$\{isVerified \? " company-verification-strip--verified" : ""\}/, "el modificador solo con isVerified");
  assert.match(rule(".company-verification-strip.company-verification-strip--verified"), /border-color: var\(--color-text-brand-accent\);/, "borde con el color de marca");
  assert.equal(count(strip, /<AppIcon icon=\{Lock\}/g), 1, "se conserva un solo candado");
  assert.equal(count(infoSection, /Estos datos forman parte de la verificación\. Si cambian, ValoraCloud solicitará una nueva revisión\./g), 1, "se conserva la nota");
  assert.match(strip, /targetId="empresa-fiscal"/, "se conserva el objetivo de foco empresa-fiscal");
}
assert.match(businessService, /httpsCallable\(functions, "deleteBusiness"\)/);
assert.doesNotMatch(drawer, /onLimitReached|resource-exhausted/);
assert.doesNotMatch(
  appLayout,
  /businessLimitOpen|canCreateBusiness === false|Alcanzaste el límite/
);
assert.match(appLayout, /shouldRefreshBusinessSessionForVerification/);
assert.match(appLayout, /verificationToastTitle: "Empresa verificada"/);
assert.match(appLayout, /verificationToastDescription: "Los módulos operativos ya están disponibles\."/);
assert.doesNotMatch(appLayout, /window\.location\.reload|setInterval/);

// --- Salir de un campo (blur): el error no aparece antes de que el usuario edite ---
// businessForm.js importa sin extensión, así que se carga con Vite (mismo patrón que disclosure-smoke).
const vite = await createServer({ appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
let shouldValidateOnBlur;
let validateQuickBusiness;
let INITIAL_ONBOARDING_BUSINESS_VALUES;
try {
  ({ INITIAL_ONBOARDING_BUSINESS_VALUES, shouldValidateOnBlur, validateQuickBusiness } = await vite.ssrLoadModule(
    "/src/domain/businessForm.js"
  ));
} finally {
  await vite.close();
}
const picker = await readFile(new URL("../src/components/BusinessCategoryPicker.jsx", import.meta.url), "utf8");

assert.equal(typeof shouldValidateOnBlur, "function");
// Salir sin editar (ni intentar enviar): sin error.
assert.equal(shouldValidateOnBlur({ submitted: false, dirty: false, hasPatch: false }), false, "salir sin editar no valida");
assert.equal(shouldValidateOnBlur({}), false, "sin datos no valida");
assert.equal(shouldValidateOnBlur(), false, "sin argumento no valida");
// Editar y salir: con error (el validador lo da: nombre de 1 letra).
assert.equal(shouldValidateOnBlur({ submitted: false, dirty: true, hasPatch: false }), true, "editar y salir valida");
assert.equal(
  validateQuickBusiness({ ...INITIAL_ONBOARDING_BUSINESS_VALUES, nombreComercial: "a" }, { requireCountry: true, requireRegion: false })
    .nombreComercial,
  "El nombre debe tener al menos 2 caracteres."
);
// Escribir y borrar: el campo sigue editado aunque el valor vuelva a vacío, y entonces sí hay error.
for (const [name, source, stateName] of [
  ["OnboardingPage", onboarding, "dirty"],
  ["AdditionalBusinessDrawer", drawer, "editedFields"],
]) {
  const setter = stateName === "dirty" ? "setDirty" : "setEditedFields";
  assert.match(
    source,
    new RegExp(String.raw`${setter}\(\(current\) => \{\s*const next = \{ \.\.\.current \};\s*for \(const changedField of Object\.keys\(patch\)\) next\[changedField\] = true;`),
    `${name}: editar marca el campo sin mirar el valor (escribir y borrar sigue editado)`
  );
}
assert.equal(shouldValidateOnBlur({ submitted: false, dirty: true, hasPatch: false }), true, "escribir y borrar valida");
assert.equal(
  validateQuickBusiness({ ...INITIAL_ONBOARDING_BUSINESS_VALUES, nombreComercial: "" }, { requireCountry: true, requireRegion: false })
    .nombreComercial,
  "Ingresa el nombre del negocio."
);
// Cerrar el selector de rubro sin elegir: onTouched() sin parche, y el campo no está editado: sin error.
assert.match(picker, /const closePicker = \(\) => \{\s*setOpen\(false\);\s*onTouched\?\.\(\);\s*\};/, "cerrar el selector no manda parche");
assert.match(fields, /onTouched=\{\(patch\) => onBlur\(field, patch\)\}/, "el parche del selector llega a onBlur tal cual");
assert.equal(shouldValidateOnBlur({ submitted: false, dirty: false, hasPatch: false }), false, "cerrar el rubro sin elegir no valida");
// Confirmar un rubro (con parche): valida aunque el campo no figure como editado.
assert.match(picker, /onTouched\?\.\(\{\s*rubroCodigo: draftCode,/, "confirmar manda el parche con el rubro elegido");
assert.equal(shouldValidateOnBlur({ submitted: false, dirty: false, hasPatch: true }), true, "confirmar con parche valida");
const withCategory = (rubroCodigo) =>
  validateQuickBusiness(
    { ...INITIAL_ONBOARDING_BUSINESS_VALUES, rubroCodigo, rubroOtro: "" },
    { requireCountry: true, requireRegion: false }
  ).rubroCodigo;
assert.equal(withCategory("INGENIERIA_CONSULTORIA"), undefined, "el rubro confirmado no da error");
assert.equal(withCategory(""), "Selecciona el rubro principal.", "sin rubro elegido el validador sí da error");
// Después de intentar enviar: siempre valida.
for (const state of [
  { submitted: true, dirty: false, hasPatch: false },
  { submitted: true, dirty: true, hasPatch: true },
  { submitted: true },
]) {
  assert.equal(shouldValidateOnBlur(state), true, `submitted siempre valida: ${JSON.stringify(state)}`);
}
// Las dos pantallas usan la función antes de marcar el campo como tocado.
for (const [name, source, stateName] of [
  ["OnboardingPage", onboarding, "dirty"],
  ["AdditionalBusinessDrawer", drawer, "editedFields"],
]) {
  assert.match(source, /shouldValidateOnBlur,\s*validateQuickBusiness,\s*\} from "\.\.\/domain\/businessForm";/, `${name}: importa shouldValidateOnBlur`);
  const body = source.slice(source.indexOf("const validateField = "));
  assert.match(
    body,
    new RegExp(String.raw`if \(\s*!shouldValidateOnBlur\(\{\s*submitted,\s*dirty: Boolean\(${stateName}\[field\]\),\s*hasPatch: Object\.keys\(patch\)\.length > 0,\s*\}\)\s*\) \{\s*return;\s*\}`),
    `${name}: validateField sale temprano sin editar`
  );
  assert.ok(
    body.indexOf("shouldValidateOnBlur") < body.indexOf("setTouched((current) => ({ ...current, [field]: true }))"),
    `${name}: el guard va antes de marcar el campo como tocado`
  );
}
assert.match(drawer, /setErrors\(\{\}\);\s*setTouched\(\{\}\);\s*setEditedFields\(\{\}\);\s*setSubmitted\(false\);/, "el drawer reinicia lo editado al abrirse");
console.log("OK: blur — sin error al salir sin editar, con error tras editar o borrar, selector sin elegir sin error, parche y submitted validan");

console.log("BUSINESS_QUICK_FLOW_SMOKE_OK");
