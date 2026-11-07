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
  identificadorFiscalTipo: "RUT",
  impuestoPredeterminadoId: "IVA_GENERAL",
  impuestoPredeterminadoNombre: "IVA",
  verificacionEmpresa: { estado: "NO_VERIFICADA" },
};
const initial = getBusinessCompletionStatus(initialProfile);
assert.equal(initial.percent, 25);
assert.equal(initial.label, "Configuración inicial");
assert.equal(initial.verificationStatus, "NO_VERIFICADA");
assert.equal(initial.verificationLabel, "Empresa no verificada");
assert.equal(initial.nextRecommendedAction.id, "fiscalIdentity");
assert.equal(initial.nextRecommendedAction.actionLabel, "Verificar");
assert.equal(
  initial.pendingItems.find((item) => item.id === "ownerEmail")?.path,
  "/cuenta?seccion=acceso"
);
assert.equal(
  initial.pendingItems.find((item) => item.id === "ownerEmail")?.label,
  "Correo del propietario verificado"
);

const fiscal = getBusinessCompletionStatus({
  ...initialProfile,
  razonSocial: "Bagner Servicios Integrales SpA",
  identificadorFiscalValor: "12.345.678-5",
});
assert.equal(fiscal.percent, 25);
assert.equal(fiscal.label, "Configuración inicial");

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
assert.equal(profileReady.percent, 55);
assert.equal(profileReady.label, "Perfil en progreso");
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
assert.equal(pendingVerification.percent, 65);
assert.notEqual(pendingVerification.percent, 100);

const complete = getBusinessCompletionStatus(completeProfile, {
  ownerEmailVerified: true,
  verificationStatus: "VERIFICADA",
});
assert.equal(complete.percent, 100);
assert.equal(complete.label, "Empresa completa y verificada");
assert.equal(complete.verificationLabel, "Empresa verificada");
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
  identificadorFiscalTipo: "RUT",
  impuestoPredeterminadoId: "IVA_GENERAL",
  impuestoPredeterminadoNombre: "IVA",
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

const [layout, company, activation, hook, sessionBackend, account, completionCard, app] = await Promise.all([
  readFile(new URL("../src/layout/AppLayout.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/company/CompanyConfig.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/InitialBusinessActivationPage.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/hooks/useBusinessCompletionStatus.js", import.meta.url), "utf8"),
  readFile(new URL("../functions/businessOnboarding.js", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/AccountPage.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/company/BusinessCompletionCard.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/App.jsx", import.meta.url), "utf8"),
]);
assert.match(layout, /\["OWNER", "ADMIN"\]\.includes/);
assert.match(layout, /businessCompletionStatus\.percent/);
assert.match(layout, /ownerEmailVerified = negocioActivo\?\.ownerEmailVerified === true/);
assert.doesNotMatch(
  layout,
  /ownerEmailVerified = negocioActivo\?\.role === "OWNER"/
);
// El contexto del Outlet sigue entregando businessCompletionStatus; puede llevar además businessCompletionError.
assert.match(layout, /<Outlet context=\{\{[^}]*\bbusinessCompletionStatus\b[^}]*\}\}/);
assert.match(layout, /error: businessCompletionError,/);
assert.doesNotMatch(layout, /verification-banner|handleResendVerification|Estado de verificación/);
assert.match(company, /<BusinessCompletionCard/);
assert.match(company, /searchParams\.get\("objetivo"\)/);
assert.match(company, /item\.id !== "ownerEmail" \|\| role === "OWNER"/);
for (const target of ["logo", "fiscal", "contacto", "direccion"]) {
  assert.match(company, new RegExp(`empresa-${target}`));
}
assert.match(activation, /<BusinessCompletionCard/);
assert.match(activation, /useBusinessCompletionStatus/);
assert.match(hook, /getBusinessCompletionStatus/);
assert.match(hook, /subscribeToCompanyProfile/);
assert.match(sessionBackend, /auth\.getUser\(ownerUid\)/);
assert.match(sessionBackend, /ownerEmailVerified/);
assert.match(account, /Acceso y seguridad/);
assert.match(account, /Correo verificado/);
assert.match(account, /Correo sin verificar/);
assert.match(account, /sendVerificationEmail/);
assert.match(account, /refreshCurrentUser/);
assert.match(account, /resetPassword/);
assert.match(account, /Comprobar verificación/);
assert.match(account, /✓ Correo verificado/);
assert.match(account, /Enviar enlace para cambiar contraseña/);
assert.match(account, /disabled=\{!form\.tipoDocumento\}/);
assert.match(account, /No corresponde al RUT fiscal de una empresa/);
assert.match(account, /resendCooldown/);
assert.doesNotMatch(account, /Perfil privado/);
assert.match(completionCard, /canActOnItem\(item\)/);
assert.match(app, /onSessionRefresh=\{onBusinessCreated\}/);

// Empresa EM3: sugerencias de datos para los documentos. No son parte del porcentaje ni de la fórmula.
{
  const {COMPANY_DOCUMENT_SUGGESTIONS, getCompanyDocumentSuggestions} = await import("../src/domain/companyDocumentSuggestions.mjs");
  const ids = (profile, options = {canEdit: true}) => getCompanyDocumentSuggestions(profile, options).map((item) => item.id);
  const texts = {
    email: "Las respuestas de tus órdenes y cotizaciones te llegarán a este correo.",
    telefono: "Aparece en tus documentos para que te contacten.",
    giro: "Se muestra en tus cotizaciones y órdenes de compra.",
    sitioWeb: "Se muestra en tus cotizaciones.",
    logo: "Se muestra en tus PDF y vistas de impresión.",
  };
  // 1-2. Un texto por dato faltante, con su propósito, solo para quien puede editar.
  const all = getCompanyDocumentSuggestions({}, {canEdit: true});
  assert.deepEqual(all.map((item) => item.id).sort(), ["email", "giro", "logo", "sitioWeb", "telefono"]);
  for (const item of all) assert.equal(item.text, texts[item.id], `texto de ${item.id}`);
  assert.deepEqual(all.map((item) => item.label).sort(), ["Correo comercial", "Giro", "Logo", "Sitio web", "Teléfono comercial"]);
  assert.deepEqual(Object.keys(all[0]).sort(), ["id", "label", "section", "text"], "sin funciones internas en lo que se muestra");
  assert.equal(COMPANY_DOCUMENT_SUGGESTIONS.length, 5);
  assert.ok(Object.isFrozen(COMPANY_DOCUMENT_SUGGESTIONS));
  // 3. Reactivo al formulario: desaparece apenas el dato se completa; espacios no cuentan.
  assert.deepEqual(ids({email: "contacto@empresa.cl"}).includes("email"), false);
  assert.deepEqual(ids({email: "   "}).includes("email"), true, "solo espacios sigue faltando");
  assert.equal(ids({telefono: "+56 9 1234 5678"}).includes("telefono"), false);
  assert.equal(ids({giro: "Servicios de ingeniería"}).includes("giro"), false);
  assert.equal(ids({sitioWeb: "https://www.empresa.cl"}).includes("sitioWeb"), false);
  assert.equal(ids({logoUrl: "https://logo.test/a.png"}).includes("logo"), false);
  assert.equal(ids({logoPath: "negocios/a/logo.png"}).includes("logo"), false, "la ruta del logo también cuenta, igual que en la completitud");
  const complete = {email: "a@b.cl", telefono: "+56 9 1", giro: "Servicios", sitioWeb: "https://a.cl", logoUrl: "https://a.cl/l.png"};
  assert.deepEqual(getCompanyDocumentSuggestions(complete, {canEdit: true}), [], "con todo completo no aparece nada");
  assert.deepEqual(ids({...complete, giro: ""}), ["giro"], "solo lo que falta");
  // ...ni en solo lectura, con o sin datos.
  assert.deepEqual(getCompanyDocumentSuggestions({}, {canEdit: false}), []);
  assert.deepEqual(getCompanyDocumentSuggestions({}), []);
  assert.deepEqual(getCompanyDocumentSuggestions(null, {canEdit: true}).length, 5, "un perfil nulo no rompe");
  // No cambian el porcentaje: la misma empresa suma igual con y sin estos datos.
  const withoutExtras = getBusinessCompletionStatus(completeProfile, {ownerEmailVerified: true, verificationStatus: "VERIFICADA"});
  const withExtras = getBusinessCompletionStatus({...completeProfile, giro: "Servicios", sitioWeb: "https://a.cl", telefono: "+56 9 1"}, {ownerEmailVerified: true, verificationStatus: "VERIFICADA"});
  assert.equal(withoutExtras.percent, 100);
  assert.equal(withExtras.percent, 100);
  assert.deepEqual(withoutExtras.items.map((item) => item.id), withExtras.items.map((item) => item.id));
  const completionSource = await readFile(new URL("../src/domain/businessCompletion.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(completionSource, /companyDocumentSuggestions|Sugerencia/, "la fórmula de completitud no sabe de las sugerencias");
  // 4. Ubicación y forma: una nota por tarjeta (Datos comerciales y Contacto), sin alerta ni ícono ni color propio.
  const infoSection = company.slice(company.indexOf("function BusinessInformationSection"), company.indexOf("function BusinessVerificationSection"));
  const commercialCard = infoSection.slice(infoSection.indexOf("<h3>Datos comerciales</h3>"), infoSection.indexOf("<h3>Contacto</h3>"));
  const contactCard = infoSection.slice(infoSection.indexOf("<h3>Contacto</h3>"), infoSection.indexOf("</fieldset>"));
  assert.match(infoSection, /getCompanyDocumentSuggestions\(form, \{ canEdit \}\)/, "se calcula sobre el formulario en pantalla y solo con permiso de edición");
  assert.match(commercialCard, /<CompanySuggestions items=\{commercialSuggestions\} \/>/);
  assert.match(contactCard, /<CompanySuggestions items=\{contactSuggestions\} \/>/);
  assert.equal((infoSection.match(/<CompanySuggestions\b/g) || []).length, 2, "dos notas, una por tarjeta");
  assert.deepEqual(
    ["giro", "logo"].every((id) => COMPANY_DOCUMENT_SUGGESTIONS.find((item) => item.id === id).section === "comerciales") &&
      ["email", "telefono", "sitioWeb"].every((id) => COMPANY_DOCUMENT_SUGGESTIONS.find((item) => item.id === id).section === "contacto"),
    true,
    "Giro y Logo van bajo Datos comerciales; Correo, Teléfono y Sitio web bajo Contacto"
  );
  const suggestionsComponent = company.slice(company.indexOf("function CompanySuggestions("), company.indexOf("function SectionFrame("));
  assert.doesNotMatch(suggestionsComponent, /role=|aria-live|<AppIcon|Notice|settings-message/, "no es una alerta: sin role, aria-live, ícono ni aviso");
  const interiorCss = (await readFile(new URL("../src/styles/interior.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const cssStart = interiorCss.indexOf(".company-suggestions {");
  assert.ok(cssStart > 0, "existe el estilo de la nota");
  const suggestionsCss = interiorCss.slice(cssStart, interiorCss.indexOf("\n}\n", interiorCss.indexOf(".company-suggestions strong {", cssStart)) + 3);
  assert.match(suggestionsCss, /color: var\(--color-text-muted\);[\s\S]*font-size: var\(--font-size-xs\);/, "texto pequeño y apagado");
  assert.doesNotMatch(suggestionsCss, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|\d+px|var\(--color-(brand|dark|danger|warning|success|info)-/, "solo tokens de texto, sin colores nuevos ni de alerta");
}

console.log("BUSINESS_COMPLETION_SMOKE_OK");
