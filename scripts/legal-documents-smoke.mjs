import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {
  LEGAL_DOCUMENT_KEYS,
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENTS_VERSION,
  isCurrentLegalVersion,
} from "../src/domain/legalDocuments.mjs";

const require = createRequire(import.meta.url);
const backend = require("../functions/legalDocuments.js");

assert.match(LEGAL_DOCUMENTS_VERSION, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(backend.LEGAL_DOCUMENTS_VERSION, LEGAL_DOCUMENTS_VERSION);
assert.deepEqual(backend.LEGAL_DOCUMENT_KEYS, LEGAL_DOCUMENT_KEYS);
assert.deepEqual(backend.LEGAL_DOCUMENTS, LEGAL_DOCUMENTS);
console.log("OK Legal: versión y metadatos idénticos entre src/ y functions/");

assert.deepEqual(Object.keys(LEGAL_DOCUMENTS).sort(), ["privacidad", "terminos"]);
assert.equal(LEGAL_DOCUMENTS.privacidad.path, "/privacidad");
assert.equal(LEGAL_DOCUMENTS.terminos.path, "/terminos");
for (const [key, document] of Object.entries(LEGAL_DOCUMENTS)) {
  assert.equal(document.key, key);
  assert.ok(document.title.length > 0);
}
assert.ok(Object.isFrozen(LEGAL_DOCUMENTS));
assert.ok(Object.isFrozen(LEGAL_DOCUMENT_KEYS));
console.log("OK Legal: dos documentos con clave, ruta pública y título");

for (const check of [isCurrentLegalVersion, backend.isCurrentLegalVersion]) {
  assert.equal(check(LEGAL_DOCUMENTS_VERSION), true);
  assert.equal(check("2000-01-01"), false);
  assert.equal(check(` ${LEGAL_DOCUMENTS_VERSION}`), false);
  for (const invalid of [undefined, null, "", 0, {}, [LEGAL_DOCUMENTS_VERSION]]) {
    assert.equal(check(invalid), false);
  }
}
console.log("OK Legal: solo la versión vigente exacta es válida");

// Etapa 3: textos y páginas públicas (aserciones estáticas).
const {readFile} = await import("node:fs/promises");
const {
  LEGAL_DOCUMENTS_CONTENT,
  LEGAL_NOTICE,
  LEGAL_PROVIDER,
} = await import("../src/domain/legalDocumentsContent.mjs");

const [appSource, pageSource, cssSource] = await Promise.all([
  readFile(new URL("../src/app/App.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/legal/LegalDocumentPage.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/legal/legal-page.css", import.meta.url), "utf8"),
]);

function documentText(documentKey) {
  return LEGAL_DOCUMENTS_CONTENT[documentKey].sections
    .flatMap((section) => section.blocks)
    .flatMap((block) =>
      block.type === "list" ?
        block.items.map((item) => `${item.label || ""} ${item.text}`) :
        [block.text]
    )
    .join("\n");
}

assert.equal(
  LEGAL_NOTICE,
  "Versión inicial. Este texto está pendiente de revisión legal por parte de Bagner."
);
assert.deepEqual(Object.keys(LEGAL_DOCUMENTS_CONTENT).sort(), Object.keys(LEGAL_DOCUMENTS).sort());
for (const documentKey of Object.keys(LEGAL_DOCUMENTS)) {
  const {sections} = LEGAL_DOCUMENTS_CONTENT[documentKey];
  assert.equal(sections.length, 12, `${documentKey}: 12 secciones`);
  sections.forEach((section, index) => {
    assert.match(section.title, new RegExp(`^${index + 1}\\. \\S`));
    assert.ok(section.blocks.length > 0);
    for (const block of section.blocks) {
      assert.ok(["paragraph", "list"].includes(block.type));
      if (block.type === "paragraph") assert.ok(block.text.trim().length > 0);
      else assert.ok(block.items.length > 0 && block.items.every((item) => item.text.trim()));
    }
  });
  assert.ok(Object.isFrozen(LEGAL_DOCUMENTS_CONTENT[documentKey]));
  assert.doesNotMatch(documentText(documentKey), /\\|\*\*|`|undefined|\[object/);
}
console.log("OK Legal: cada documento tiene 12 secciones con contenido");

assert.deepEqual(LEGAL_PROVIDER, {
  razonSocial: "Servicios Integrales Bagner SpA",
  rut: "77.091.679-8",
  domicilio: "Tamarugal 2985, Iquique, Chile",
  correoPrivacidad: "bruno.pairumani@bagner.cl",
  sitio: "https://valoracloud.bagner.cl",
});
const privacyText = documentText("privacidad");
const termsText = documentText("terminos");
for (const value of [
  LEGAL_PROVIDER.razonSocial,
  LEGAL_PROVIDER.rut,
  LEGAL_PROVIDER.domicilio,
  LEGAL_PROVIDER.correoPrivacidad,
]) {
  assert.ok(privacyText.includes(value), `privacidad incluye ${value}`);
}
for (const value of [
  LEGAL_PROVIDER.razonSocial,
  LEGAL_PROVIDER.rut,
  LEGAL_PROVIDER.correoPrivacidad,
]) {
  assert.ok(termsText.includes(value), `términos incluye ${value}`);
}
assert.doesNotMatch(Object.values(LEGAL_PROVIDER).join("\n"), /[[\]]/, "LEGAL_PROVIDER sin marcadores");
// Ningún marcador de proveedor sin completar: los únicos corchetes que quedan
// en los textos son [CONFIRMAR ...] y [A DEFINIR ...].
for (const [name, text] of [["privacidad", privacyText], ["términos", termsText]]) {
  assert.doesNotMatch(text, /_BAGNER\]|\[CORREO_PRIVACIDAD\]|\[RAZON_SOCIAL|\[RUT|\[DOMICILIO/, `${name}: sin marcadores de proveedor`);
  for (const marker of text.match(/\[[^\]]*\]/g) || []) {
    assert.match(marker, /^\[(?:CONFIRMAR|A DEFINIR)\b/, `${name}: marcador inesperado ${marker}`);
  }
  // Solo el correo de privacidad de Bagner: ningún otro correo ni teléfono.
  const emails = new Set(text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || []);
  assert.deepEqual([...emails], [LEGAL_PROVIDER.correoPrivacidad], `${name}: un solo correo`);
  assert.doesNotMatch(text, /\+56|\b\d{9}\b/, `${name}: sin teléfono`);
}
assert.equal(privacyText.match(/\[CONFIRMAR/g).length, 4);
assert.equal(privacyText.match(/\[A DEFINIR/g).length, 1);
assert.equal(termsText.match(/\[A DEFINIR/g).length, 4);
assert.equal(termsText.includes("[CONFIRMAR"), false);
assert.match(privacyText, /correo de las personas invitadas a un equipo, incluso si todavía no tienen cuenta/);
assert.match(privacyText, /vigencia de 7 días[\s\S]*?\[A DEFINIR plazo de eliminación de invitaciones\]/);
console.log("OK Legal: datos reales del proveedor, sin marcadores de proveedor; solo [CONFIRMAR] y [A DEFINIR] de plazos o decisiones");

const publicBlockStart = appSource.indexOf("/^\\/propuesta\\/");
const legalRoutesBlock = appSource.indexOf("(privacidad|terminos)");
const loadingGate = appSource.indexOf("if (loading) return <LoadingScreen />;");
assert.ok(publicBlockStart > -1 && legalRoutesBlock > publicBlockStart);
assert.ok(loadingGate > legalRoutesBlock, "rutas legales antes de loading");
for (const document of Object.values(LEGAL_DOCUMENTS)) {
  const routeIndex = appSource.indexOf(`path="${document.path}"`);
  assert.ok(routeIndex > legalRoutesBlock && routeIndex < loadingGate, document.path);
  assert.ok(appSource.includes(`documentKey="${document.key}"`));
}
console.log("OK Legal: /privacidad y /terminos en el bloque superior de App.jsx");

assert.ok(pageSource.includes("LEGAL_NOTICE"));
assert.match(pageSource, /<BrandLogo\b/);
assert.match(pageSource, /<SkipLink\b/);
assert.match(pageSource, /<Button variant="ghost"/);
assert.doesNotMatch(cssSource, /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\(/);
assert.doesNotMatch(cssSource, /(?:border-radius|box-shadow|transition|animation)\s*:[^;]*\d(?:px|ms|s)\b/);
console.log("OK Legal: página con aviso, logo, SkipLink y volver; CSS sin literales");

// Etapa 4: casilla de registro, enlaces y servicio de aceptación (estático).
const [loginSource, authServiceSource, legalServiceSource, proposalSource, componentsCss] =
  await Promise.all([
    readFile(new URL("../src/features/auth/Login.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/authService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/legalService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/PublicQuoteProposalPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/components.css", import.meta.url), "utf8"),
  ]);

assert.equal(loginSource.match(/type="checkbox"/g).length, 1);
assert.match(
  loginSource,
  /\{!isLoginView && !isResetView && \(\s*<div className="auth-field">\s*<label className="ui-checkbox"/,
  "casilla solo en registro"
);
assert.match(loginSource, /useState\(false\);\s*\n\s*\n\s*const clearPasswordState/);
assert.match(loginSource, /checked=\{acceptedLegal\}/);
assert.doesNotMatch(loginSource, /checked(?:=\{true\})?\s*[\n/]*\s*onChange/);
console.log("OK Registro: casilla sin premarcar y solo en modo crear cuenta");

const blockIndex = loginSource.indexOf("if (!acceptedLegal)");
const registerCall = loginSource.indexOf("await registerWithEmail(");
assert.ok(blockIndex > loginSource.indexOf("if (!isLoginView) {"));
assert.ok(blockIndex > -1 && blockIndex < loginSource.indexOf("setIsSubmitting(true)"));
assert.ok(blockIndex < registerCall, "valida antes de registrar");
assert.match(
  loginSource.slice(blockIndex, blockIndex + 160),
  /setError\(LEGAL_REQUIRED_MESSAGE\);\s*return;/
);
assert.match(loginSource, /legalTermsAccepted: acceptedLegal/);
assert.doesNotMatch(loginSource, /firebaseEnvironment\.isReadOnly/);
console.log("OK Registro: la casilla bloquea el envío con el patrón setError + return");

assert.match(loginSource, /const LEGAL_LINKS = \[LEGAL_DOCUMENTS\.privacidad, LEGAL_DOCUMENTS\.terminos\]/);
assert.match(loginSource, /to=\{LEGAL_DOCUMENTS\.privacidad\.path\}/);
assert.match(loginSource, /to=\{LEGAL_DOCUMENTS\.terminos\.path\}/);
assert.match(loginSource, /to=\{document\.path\}/);
assert.equal(loginSource.match(/target="_blank"/g).length, 3);
assert.equal(loginSource.match(/rel="noopener noreferrer"/g).length, 3);
assert.ok(
  loginSource.indexOf('className="auth-legal"') > loginSource.indexOf('className="auth-actions"')
);
assert.match(
  loginSource,
  /\{\(isLoginView \|\| isResetView\) && \(\s*<nav className="auth-legal"/,
  "pie solo cuando no se muestra la casilla"
);
assert.match(proposalSource, /LEGAL_DOCUMENTS\.privacidad, LEGAL_DOCUMENTS\.terminos/);
assert.match(proposalSource, /to=\{document\.path\}[\s\S]*?target="_blank"[\s\S]*?rel="noopener noreferrer"/);
const errorBranch = proposalSource.slice(proposalSource.indexOf("Propuesta no disponible"));
assert.ok(errorBranch.indexOf("<PublicLegalLinks />") < errorBranch.indexOf("const resolved"));
const loadingBranch = proposalSource.slice(
  proposalSource.indexOf("if (state.loading)"),
  proposalSource.indexOf("if (state.error || !proposal)")
);
assert.doesNotMatch(loadingBranch, /PublicLegalLinks/);
assert.match(proposalSource, /<footer className="public-proposal__footer">[\s\S]*?<PublicLegalLinks \/>[\s\S]*?<\/footer>/);
console.log("OK Enlaces: login, registro y propuesta pública apuntan a LEGAL_DOCUMENTS");

assert.match(legalServiceSource, /httpsCallable\(functions, "acceptLegalTerms"\)/);
assert.match(legalServiceSource, /\{ version: LEGAL_DOCUMENTS_VERSION \}/);
assert.match(authServiceSource, /assertClientWriteAllowed\("crear cuentas"\)/);
const pendingIndex = authServiceSource.indexOf("pendingRegistrationSetup = setup");
const createIndex = authServiceSource.indexOf("await createUserWithEmailAndPassword(");
const acceptIndex = authServiceSource.indexOf("await acceptLegalTerms()");
assert.ok(pendingIndex > -1 && pendingIndex < createIndex, "deferred antes de crear la cuenta");
assert.ok(createIndex < acceptIndex);
assert.match(authServiceSource, /legalTermsAccepted !== true[\s\S]*?auth\/legal-terms-required/);
assert.match(authServiceSource, /try \{\s*await acceptLegalTerms\(\);\s*\} catch \(error\) \{[\s\S]*?console\.error/);
assert.match(authServiceSource, /\} finally \{[\s\S]*?finishSetup\(\);/);
assert.doesNotMatch(authServiceSource, /reject/);
console.log("OK Servicio: aceptación tras crear la cuenta, sin bloquear el registro y con deferred previo");

assert.match(componentsCss, /\.ui-checkbox\s*\{/);
assert.match(componentsCss, /\.auth-legal\s*\{/);
console.log("OK Estilos: .ui-checkbox y .auth-legal en components.css");

// Etapa 5: guard y pantalla de aceptación (aserciones estáticas + regla pura).
const {LEGAL_ACCEPTANCE_GATE, resolveLegalAcceptanceGate} = await import(
  "../src/domain/legalAcceptanceGate.mjs"
);
const [acceptancePageSource, accountPageSource] = await Promise.all([
  readFile(new URL("../src/features/legal/LegalAcceptancePage.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/AccountPage.jsx", import.meta.url), "utf8"),
]);

assert.equal(resolveLegalAcceptanceGate(undefined), LEGAL_ACCEPTANCE_GATE.UNKNOWN);
assert.equal(resolveLegalAcceptanceGate(null), LEGAL_ACCEPTANCE_GATE.UNKNOWN);
assert.equal(resolveLegalAcceptanceGate("x"), LEGAL_ACCEPTANCE_GATE.UNKNOWN);
assert.equal(resolveLegalAcceptanceGate({isCurrent: true}), LEGAL_ACCEPTANCE_GATE.ACCEPTED);
for (const legalAcceptance of [{}, {isCurrent: false}, {isCurrent: "true"}, {isCurrent: 1}]) {
  assert.equal(resolveLegalAcceptanceGate(legalAcceptance), LEGAL_ACCEPTANCE_GATE.REQUIRED);
}
console.log("OK Guard: sin legalAcceptance no bloquea; presente sin isCurrent === true bloquea");

const routesStart = appSource.indexOf("function AppRoutes(");
const routesSource = appSource.slice(routesStart, appSource.indexOf("\nfunction App()"));
const at = (needle) => {
  const index = routesSource.indexOf(needle);
  assert.ok(index > -1, `AppRoutes contiene ${needle}`);
  return index;
};
const guardIndex = at("legalAcceptanceGate === LEGAL_ACCEPTANCE_GATE.REQUIRED");
assert.ok(guardIndex > at("if (businessLoading) return <LoadingScreen />;"));
assert.ok(guardIndex > at("if (businessError) {"), "error de sesión antes del guard");
assert.ok(guardIndex < at('businessSession?.accessState === "unavailable"'), "guard antes de unavailable");
assert.ok(guardIndex < at("if (businessSession?.needsOnboarding) {"), "guard antes de needsOnboarding");
assert.ok(guardIndex < at('initialActivationRoute.status === "prompt"'));
assert.ok(at("isPlatformRoute(location.pathname)") < guardIndex, "/admin queda fuera del guard");
assert.ok(at("(privacidad|terminos)") < guardIndex && at("/^\\/propuesta\\/") < guardIndex);
assert.ok(at("if (loading) return <LoadingScreen />;") < guardIndex);
assert.match(
  routesSource.slice(guardIndex, guardIndex + 360),
  /<LegalAcceptancePage[\s\S]*?onAccepted=\{onBusinessCreated\}[\s\S]*?\/>/
);
assert.doesNotMatch(
  routesSource.slice(guardIndex, at('businessSession?.accessState === "unavailable"')),
  /initialActivation/,
  "el guard no interfiere con initialActivationRoute"
);
console.log("OK Guard: tras businessLoading/businessError y antes de unavailable, needsOnboarding e initialActivation");

assert.match(
  routesSource,
  /useEffect\(\(\) => \{\s*if \(legalAcceptanceUnknown\) \{\s*console\.warn\(/,
  "warn en un efecto, no en el render"
);
assert.match(
  routesSource,
  /const legalAcceptanceUnknown =\s*Boolean\(businessSession\) &&\s*legalAcceptanceGate === LEGAL_ACCEPTANCE_GATE\.UNKNOWN/
);
console.log("OK Guard: sesión sin legalAcceptance no bloquea y registra console.warn una vez");

const timeoutHelper = appSource.slice(
  appSource.indexOf("function waitForRegistrationSetupWithTimeout()"),
  routesStart
);
assert.match(appSource, /const REGISTRATION_SETUP_TIMEOUT_MS = 8000;/);
assert.match(timeoutHelper, /Promise\.race\(\[waitForRegistrationSetup\(\), timeout\]\)/);
assert.match(timeoutHelper, /setTimeout\(resolve, REGISTRATION_SETUP_TIMEOUT_MS\)/);
assert.match(timeoutHelper, /\.finally\(\(\) =>\s*clearTimeout\(timerId\)\s*\)/);
assert.doesNotMatch(timeoutHelper, /reject/);
const appComponentSource = appSource.slice(appSource.indexOf("\nfunction App()"));
const sessionEffect = appComponentSource.slice(
  appComponentSource.indexOf("// Si hay un registro en curso"),
  appComponentSource.indexOf("const finishInitialActivation")
);
assert.ok(sessionEffect.includes("[usuario?.uid]"), "recorte del efecto de sesión por uid");
const waitIndex = sessionEffect.indexOf("waitForRegistrationSetupWithTimeout()");
const sessionCall = sessionEffect.indexOf("getBusinessSession()");
assert.ok(waitIndex > -1 && sessionCall > waitIndex, "espera el registro antes de getBusinessSession");
assert.match(sessionEffect, /waitForRegistrationSetupWithTimeout\(\)\s*\.then\(\(\) => \(active \? getBusinessSession\(\) : null\)\)/);
assert.match(sessionEffect, /\.catch\(\(error\) => \{[\s\S]*?setBusinessState\(\{ loading: false, data: null, error \}\)/);
assert.match(appSource, /subscribeToAuth,\s*waitForRegistrationSetup,/);
console.log("OK Sesión: await de waitForRegistrationSetup con timeout de 8 s antes de getBusinessSession");

assert.match(acceptancePageSource, /to=\{document\.path\}[\s\S]*?target="_blank"[\s\S]*?rel="noopener noreferrer"/);
assert.match(acceptancePageSource, /LEGAL_DOCUMENTS\.privacidad, LEGAL_DOCUMENTS\.terminos/);
assert.match(acceptancePageSource, /await acceptLegalTerms\(\);\s*const session = await onAccepted\(\);/);
assert.match(acceptancePageSource, /\} catch \(acceptError\) \{[\s\S]*?setError\(ACCEPT_ERROR_MESSAGE\)/);
assert.match(acceptancePageSource, /\} finally \{\s*setAccepting\(false\);/);
assert.match(acceptancePageSource, /onClick=\{logout\}/);
assert.match(acceptancePageSource, /disabled=\{accepting\}\s*onClick=\{logout\}/);
assert.match(acceptancePageSource, /role="alert"/);
assert.match(acceptancePageSource, /<SkipLink\b/);
assert.match(acceptancePageSource, /<BrandLogo\b[^>]*\/>/);
assert.equal(acceptancePageSource.match(/role="status"/g), null);
console.log("OK Pantalla de aceptación: enlaces, aceptar + refresh, error sin atrapar y cerrar sesión");

assert.match(accountPageSource, /legalAcceptance\?\.acceptedVersion/);
assert.match(accountPageSource, /Versión aceptada: \{legalAcceptance\.acceptedVersion\}/);
assert.match(appSource, /legalAcceptance=\{businessSession\?\.legalAcceptance\}/);
assert.match(cssSource, /\.legal-acceptance__links\s*\{/);
console.log("OK Mi cuenta: versión y fecha aceptadas desde la sesión");
