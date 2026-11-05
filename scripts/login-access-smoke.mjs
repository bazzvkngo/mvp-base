import {GOOGLE_LOGIN_ENABLED, resolveGoogleLoginEnabled} from "../src/config/featureFlags.mjs";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {detectInAppBrowser} from "../src/domain/inAppBrowser.mjs";
import {
  ACCESS_HINT,
  buildLoginLink,
  ACCESS_HINT_QUERY_PARAM,
  ACCESS_HINT_STORAGE_KEY,
  normalizeAccessHint,
  resolveAccessHint,
} from "../src/domain/accessHint.mjs";

// SPEC 029: ingreso con Google, selector "Mi empresa / Soy colaborador" y
// pantalla de espera. Aserciones estáticas sobre el código fuente.

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [
  loginSource,
  stageSource,
  waitingSource,
  loginCss,
  authServiceSource,
  appSource,
  hookSource,
  domainSource,
  businessServiceSource,
  googleLogoSource,
] = await Promise.all([
  read("src/features/auth/Login.jsx"),
  read("src/features/auth/AuthStage.jsx"),
  read("src/features/auth/BusinessWaitingPage.jsx"),
  read("src/features/auth/login.css"),
  read("src/services/authService.js"),
  read("src/app/App.jsx"),
  read("src/hooks/useAccessHint.js"),
  read("src/domain/accessHint.mjs"),
  read("src/services/businessService.js"),
  read("src/assets/google-g.svg"),
]);

// --- Pista de acceso: regla pura ---------------------------------------
assert.deepEqual(Object.values(ACCESS_HINT).sort(), ["colaborador", "empresa"]);
assert.equal(ACCESS_HINT_QUERY_PARAM, "acceso");
assert.equal(normalizeAccessHint(" Colaborador "), "colaborador");
assert.equal(normalizeAccessHint("admin"), null);
assert.equal(normalizeAccessHint(undefined), null);
assert.equal(normalizeAccessHint({}), null);
assert.equal(resolveAccessHint({}), ACCESS_HINT.EMPRESA);
assert.equal(resolveAccessHint({stored: "colaborador"}), ACCESS_HINT.COLABORADOR);
assert.equal(
  resolveAccessHint({search: "?acceso=colaborador", stored: "empresa"}),
  ACCESS_HINT.COLABORADOR,
  "la query manda sobre lo guardado"
);
assert.equal(resolveAccessHint({search: "?acceso=superadmin", stored: "colaborador"}), ACCESS_HINT.COLABORADOR);
assert.equal(resolveAccessHint({search: "?acceso=superadmin"}), ACCESS_HINT.EMPRESA);
console.log("OK Pista: solo empresa/colaborador, la query manda y el resto cae a empresa");

// --- La elección vive solo en el navegador y no se envía al backend -----
assert.match(hookSource, /window\.sessionStorage/);
assert.ok(hookSource.includes("ACCESS_HINT_STORAGE_KEY"));
assert.equal(ACCESS_HINT_STORAGE_KEY, "valoracloud.accessHint");
assert.match(hookSource, /\} catch \{[\s\S]*?return memoryHint;/, "sessionStorage no disponible: respaldo en memoria");
for (const [name, source] of Object.entries({
  "useAccessHint.js": hookSource,
  "accessHint.mjs": domainSource,
  "BusinessWaitingPage.jsx": waitingSource,
  "AuthStage.jsx": stageSource,
})) {
  assert.doesNotMatch(
    source,
    /from "(?:firebase\/|\.\.\/firebase|\.\.\/\.\.\/firebase|.*businessService|.*legalService)|httpsCallable|fetch\(|setDoc|updateDoc/,
    `${name} no habla con Firebase ni con el backend`
  );
}
// Login solo conoce la pista para elegir textos y pestaña; las llamadas de
// autenticación no la reciben.
assert.match(loginSource, /await registerWithEmail\(email, password, \{\s*legalTermsAccepted: acceptedLegal,\s*\}\);/);
assert.match(loginSource, /await loginWithEmail\(email, password\);/);
assert.match(loginSource, /await loginWithGoogle\(\);/);
assert.doesNotMatch(authServiceSource, /accessHint|ACCESS_HINT|colaborador|acceso/i);
assert.doesNotMatch(businessServiceSource, /accessHint|ACCESS_HINT|colaborador|acceso/i);
assert.match(businessServiceSource, /const response = await callable\(\{\}\);/, "getBusinessSession se llama sin datos");
// En App la pista solo decide la pantalla dentro de la rama needsOnboarding.
const needsOnboardingBranch = appSource.slice(
  appSource.indexOf("if (businessSession?.needsOnboarding) {"),
  appSource.indexOf("const activeBusiness = businessSession?.activeBusiness;")
);
assert.match(needsOnboardingBranch, /accessHint === ACCESS_HINT\.COLABORADOR/);
assert.match(needsOnboardingBranch, /<BusinessWaitingPage[\s\S]*?onRefresh=\{onBusinessCreated\}[\s\S]*?onCreateOwnBusiness=\{clearAccessHint\}/);
assert.doesNotMatch(appSource.replace(needsOnboardingBranch, ""), /ACCESS_HINT\.COLABORADOR/);
console.log("OK Selector: la elección vive en sessionStorage, no llega a Firebase ni al backend y no autoriza nada");

// --- Selector accesible -------------------------------------------------
assert.match(loginSource, /import \{ TabPanel, Tabs \} from "\.\.\/\.\.\/components\/ui\/Tabs";/);
assert.match(loginSource, /label: "Mi empresa"/);
assert.match(loginSource, /label: "Soy colaborador"/);
assert.match(loginSource, /<Tabs[\s\S]*?idPrefix="auth-access"[\s\S]*?label="Tipo de acceso"/);
assert.match(loginSource, /"Acceso de colaborador"/);
assert.match(loginSource, /"Tu empresa te agrega con tu correo\."/);
// El subtítulo se renderiza siempre (vacío en "Mi empresa") y reserva una línea:
// cambiar de pestaña no debe desplazar título, Google ni formulario.
assert.match(loginSource, /<p className="auth-card__subtitle">\{subtitle\}<\/p>/, "el subtítulo no es condicional");
assert.doesNotMatch(loginSource, /subtitle &&/, "sin render condicional del subtítulo");
assert.match(
  loginCss,
  /\.auth-card \.auth-body__title \.auth-card__subtitle \{\s*min-height: calc\(var\(--font-size-md\) \* var\(--line-height-default\)\);\s*\}/,
  "altura de una línea reservada con tokens"
);
assert.doesNotMatch(loginCss, /\.auth-card__subtitle[^{]*\{[^}]*(?:display: none|visibility: hidden)/, "el subtítulo vacío no se oculta del flujo");
assert.doesNotMatch(loginSource, /placeholder=/, "campos sin placeholder");
assert.doesNotMatch(loginSource, /valoracloud-login-background/, "Login ya no importa el PNG");
assert.doesNotMatch(stageSource, /valoracloud-login-background|<img/);
console.log("OK Selector: Tabs del sistema con los textos de la maqueta, sin placeholders y sin el PNG");

// --- Panel animado: reduced-motion, aria-hidden y sin literales ----------
const reducedMotion = loginCss.slice(loginCss.indexOf("@media (prefers-reduced-motion: reduce)"));
assert.ok(reducedMotion.startsWith("@media (prefers-reduced-motion: reduce)"));
for (const selector of [
  ".auth-stage__orb",
  ".auth-stage__chip",
  ".auth-stage__gear",
  ".auth-stage__bar",
  ".auth-stage__line",
  ".auth-stage__tip",
]) {
  assert.ok(
    reducedMotion.slice(0, reducedMotion.indexOf("animation: none;")).includes(selector),
    `${selector} sin animación con prefers-reduced-motion`
  );
}
assert.match(reducedMotion, /\.auth-stage__line \{\s*stroke-dashoffset: 0;/, "línea dibujada en el estado final");
assert.match(reducedMotion, /\.auth-stage__tip \{\s*opacity: 1;/, "punta visible en el estado final");
const animatedSelectors = [...loginCss.matchAll(/(\.auth-stage__[\w-]+)\s*\{[^}]*animation:\s*auth-stage/g)].map((m) => m[1]);
assert.deepEqual(
  [...new Set(animatedSelectors)].sort(),
  [".auth-stage__bar", ".auth-stage__chip", ".auth-stage__gear", ".auth-stage__line", ".auth-stage__orb", ".auth-stage__tip"],
  "todo lo animado está cubierto por reduced-motion"
);
assert.match(stageSource, /<div className="auth-stage__decor" aria-hidden="true">/);
assert.match(stageSource, /<p className="auth-stage__headline">/);
assert.ok(
  stageSource.indexOf("</div>") < stageSource.indexOf('<p className="auth-stage__headline">'),
  "el titular queda fuera del bloque aria-hidden"
);
assert.doesNotMatch(loginCss, /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\(/, "login.css sin colores literales");
assert.doesNotMatch(loginCss, /(?:border-radius|box-shadow)\s*:[^;]*\d(?:px|rem|%)\b/, "login.css sin radios ni sombras literales");
assert.doesNotMatch(loginCss, /(?:animation|transition)(?:-delay|-duration)?\s*:[^;]*\d(?:ms|s)\b/, "login.css sin duraciones literales");
assert.doesNotMatch(stageSource, /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\(|<script|href="http/);
console.log("OK Panel: reduced-motion sin animación y en estado final, decoración aria-hidden y sin literales");

// --- Google --------------------------------------------------------------
assert.match(authServiceSource, /GoogleAuthProvider/);
assert.match(authServiceSource, /await signInWithPopup\(auth, provider\)/);
assert.match(authServiceSource, /await signInWithRedirect\(auth, provider\)/);
assert.match(authServiceSource, /"auth\/popup-blocked"/);
const googleFunction = authServiceSource.slice(
  authServiceSource.indexOf("export async function loginWithGoogle()"),
  authServiceSource.indexOf("export function completeGoogleRedirect()")
);
assert.match(googleFunction, /assertClientWriteAllowed\("crear cuentas"\);/);
assert.doesNotMatch(googleFunction, /acceptLegalTerms|waitForRegistrationSetup|pendingRegistrationSetup/, "Google no registra la aceptación: la pide el guard");
assert.match(authServiceSource, /assertClientWriteAllowed\("crear cuentas"\)/);
assert.doesNotMatch(authServiceSource, /reject/);
assert.match(loginSource, /Continuar con Google/);
assert.match(loginSource, /import googleLogo from "\.\.\/\.\.\/assets\/google-g\.svg";/);
assert.match(loginSource, /className=\{\s*GOOGLE_LOGIN_ENABLED\s*\? "auth-google"\s*: "auth-google auth-google--disabled"\s*\}/);
for (const code of [
  "auth/popup-closed-by-user",
  "auth/popup-blocked",
  "auth/account-exists-with-different-credential",
]) {
  assert.match(loginSource, new RegExp(`case "${code}":\\s*return "`), `mensaje en español para ${code}`);
}
assert.match(loginSource, /auth\/cancelled-popup-request/);
assert.match(loginSource, /if \(!GOOGLE_LOGIN_ENABLED\) return;\s*completeGoogleRedirect\(\)/, "sin el interruptor no se consulta el regreso de Google");
assert.doesNotMatch(loginSource, /firebaseEnvironment\.isReadOnly/);
assert.equal(loginSource.match(/type="checkbox"/g).length, 1, "Google no agrega otra casilla");
for (const fill of ["#EA4335", "#4285F4", "#FBBC05", "#34A853"]) {
  assert.ok(googleLogoSource.includes(fill), `logo oficial de Google: ${fill}`);
}
// El guard de aceptación va antes del onboarding y de la pantalla de espera.
const routesSource = appSource.slice(appSource.indexOf("function AppRoutes("), appSource.indexOf("\nfunction App()"));
const guardIndex = routesSource.indexOf("legalAcceptanceGate === LEGAL_ACCEPTANCE_GATE.REQUIRED");
assert.ok(guardIndex > -1);
assert.ok(guardIndex < routesSource.indexOf("<BusinessWaitingPage"), "el guard de aceptación va antes de la espera");
assert.ok(guardIndex < routesSource.indexOf("if (businessSession?.needsOnboarding) {"));
console.log("OK Google: popup con redirección, errores en español, sin casilla propia y con el guard de aceptación primero");

// --- Pantalla de espera ---------------------------------------------------
assert.match(waitingSource, /export const WAITING_POLL_INTERVAL_MS = 30000;/);
assert.match(waitingSource, /export const WAITING_POLL_MAX_CHECKS = 20;/);
assert.match(waitingSource, /window\.setInterval\(/);
assert.match(waitingSource, /window\.clearInterval\(intervalId\)/);
assert.match(waitingSource, /checksRef\.current >= WAITING_POLL_MAX_CHECKS/);
assert.match(waitingSource, /addEventListener\("focus", checkOnFocus\)/);
assert.match(waitingSource, /removeEventListener\("focus", checkOnFocus\)/);
assert.match(waitingSource, /await onRefresh\(\);\s*\} catch \{/, "un error de consulta no saca de la espera");
assert.doesNotMatch(waitingSource, /getBusinessSession\(|businessService/, "la espera usa la recarga de la app, no llama a getBusinessSession");
assert.match(waitingSource, /navigator\.clipboard\.writeText\(email\)/);
assert.match(waitingSource, /\{copyState === "copied" \? "Copiado" : "Copiar"\}/);
assert.match(waitingSource, /Quiero crear mi propia empresa/);
assert.match(waitingSource, /onClick=\{onCreateOwnBusiness\}/);
assert.match(waitingSource, /icon=\{LogOut\}\s*onClick=\{logout\}/);
// SPEC 032: las invitaciones reemplazan al campo de código de acceso.
assert.doesNotMatch(waitingSource, /<input\b|código de acceso|access-code|Próximamente/i, "ya no hay campo de código");
assert.match(waitingSource, /<InvitationsInbox\b/, "la espera lista las invitaciones pendientes");
// Antes: ningún role="status" en la página (todo venía de LoadingState). Ahora hay uno solo más: el feedback
// condicional del aviso de verificación (el aviso va con role={null}, así que no se anidan dos estados).
assert.equal(waitingSource.match(/role="status"/g).length, 1, "role=status en la página: solo el feedback del aviso; el resto viene de LoadingState");assert.equal(waitingSource.match(/<LoadingState\b/g).length, 1);
assert.match(waitingSource, /<SkipLink\b/);
assert.match(waitingSource, /<BrandLogo\b/);
console.log("OK Espera: correo con Copiar, estado, invitaciones (sin campo de código), salidas y consulta con tope");

// --- Aviso de correo sin verificar ----------------------------------------
assert.match(waitingSource, /import \{\s*logout,\s*refreshCurrentUser,\s*sendVerificationEmail,\s*\} from "\.\.\/\.\.\/services\/authService";/);
assert.match(waitingSource, /export const WAITING_VERIFICATION_COOLDOWN_SECONDS = 60;/);
assert.match(
  waitingSource,
  /const needsVerification =\s*\(Boolean\(email\) && !emailVerified\) \|\| invitationsState\.requiresVerification;/,
  "el aviso de verificación también sale cuando el backend pide verificar"
);
assert.match(waitingSource, /\{!needsVerification && \(\s*<section className="auth-wait__invitations"/, "con el correo sin verificar el aviso reemplaza a la lista");
assert.match(waitingSource, /useState\(\s*usuario\?\.emailVerified === true\s*\)/, "las cuentas ya verificadas (Google) parten sin aviso");
// El aviso es <Notice variant="warning"> con la clase antigua como extra (antes: <div className="auth-wait__notice">).
assert.match(waitingSource, /\{needsVerification && \(\s*(?:\/\/[^\n]*\s*)*<Notice\s+variant="warning"\s+role=\{null\}\s+className="auth-wait__notice"/);
assert.match(waitingSource, /import Notice from "\.\.\/\.\.\/components\/ui\/Notice";/);
// Feedback solo con texto, un único role="status" (el aviso va con role={null}) y sin altura reservada.
assert.match(waitingSource, /\{verifyFeedback && \(\s*<p className="auth-wait__notice-feedback" role="status">/, "el feedback del aviso solo existe con texto");
assert.doesNotMatch(waitingSource, /<span className="auth-wait__notice-feedback"/, "ya no hay span de feedback siempre presente");
assert.equal((waitingSource.match(/auth-wait__notice-feedback/g) || []).length, 1, "un solo feedback en el aviso");
assert.doesNotMatch(loginCss.match(/\.auth-wait__notice-feedback \{[^}]*\}/)?.[0] || "", /min-height/, "el feedback no reserva altura");
assert.ok(
  waitingSource.indexOf("auth-wait__notice") < waitingSource.indexOf("auth-body__title"),
  "el aviso va arriba del título"
);
assert.ok(waitingSource.includes("Primero verifica tu correo. Te enviamos un mensaje; sin eso"));
assert.ok(waitingSource.includes("tu empresa no podrá agregarte."));
assert.ok(waitingSource.includes("Reenviar correo de verificación"));
assert.ok(waitingSource.includes("Ya lo verifiqué"));
assert.match(waitingSource, /await sendVerificationEmail\(\);/);
assert.match(waitingSource, /error\?\.code === "auth\/too-many-requests"[\s\S]*?setCooldownLeft\(WAITING_VERIFICATION_COOLDOWN_SECONDS\)/);
assert.match(waitingSource, /disabled=\{cooldownLeft > 0\}/);
assert.match(waitingSource, /const verified = await reloadVerification\(\);\s*if \(verified\) await onRefresh\(\);/);
assert.match(waitingSource, /const user = await refreshCurrentUser\(\);/);
const checkSessionBody = waitingSource.slice(
  waitingSource.indexOf("const checkSession = "),
  waitingSource.indexOf("[onRefresh, reloadInvitations, reloadVerification]")
);
assert.ok(
  checkSessionBody.indexOf("await reloadVerification()") > -1 &&
    checkSessionBody.indexOf("await reloadVerification()") < checkSessionBody.indexOf("await onRefresh()"),
  "cada consulta periódica recarga al usuario antes de consultar la sesión"
);
assert.equal(waitingSource.match(/role="status"/g).length, 1, "solo el feedback condicional del aviso lleva role=status (ver la aserción de más arriba)");
assert.match(waitingSource, /<span className="auth-wait__copy-feedback"/, "el correo con Copiar queda igual");
console.log("OK Espera: aviso de correo sin verificar con reenvío (60 s), \"Ya lo verifiqué\" y recarga en cada consulta");

// --- Navegadores integrados -------------------------------------------------
const IN_APP_AGENTS = {
  Instagram: "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 Instagram 310.0.0.37.109 Android",
  Facebook: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21B74 [FBAN/FBIOS;FBAV/440.0.0.30.113;FBBV/560000;FBDV/iPhone14,5]",
  Messenger: "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/MESSENGER;FBAV/430.0.0.0.0]",
  WhatsApp: "WhatsApp/2.23.20.0 A",
  LinkedIn: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LinkedInApp",
  TikTok: "Mozilla/5.0 (Linux; Android 12; SM-A525F Build/SP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.0.0 Mobile Safari/537.36 musical_ly_29.5.0 BytedanceWebview/d8a21c6",
  "WebView de Android": "Mozilla/5.0 (Linux; Android 12; SM-G991B Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.0.0 Mobile Safari/537.36",
  "WebView de iOS": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
};
for (const [name, agent] of Object.entries(IN_APP_AGENTS)) {
  assert.deepEqual(detectInAppBrowser(agent), {isInAppBrowser: true, name}, name);
}
const REAL_BROWSERS = [
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
];
for (const agent of REAL_BROWSERS) {
  assert.deepEqual(detectInAppBrowser(agent), {isInAppBrowser: false, name: null}, agent);
}
for (const invalid of [undefined, null, "", 0, {}, []]) {
  assert.equal(detectInAppBrowser(invalid).isInAppBrowser, false);
}
assert.equal(buildLoginLink("https://valoracloud.bagner.cl/", "empresa"), "https://valoracloud.bagner.cl/login");
assert.equal(buildLoginLink("https://valoracloud.bagner.cl", "colaborador"), "https://valoracloud.bagner.cl/login?acceso=colaborador");
assert.equal(buildLoginLink("https://valoracloud.bagner.cl", "otro"), "https://valoracloud.bagner.cl/login");
console.log("OK Navegadores integrados: apps conocidas y WebViews detectadas; navegadores reales no");

assert.match(loginSource, /import \{ detectInAppBrowser \} from "\.\.\/\.\.\/domain\/inAppBrowser\.mjs";/);
assert.match(loginSource, /detectInAppBrowser\(\s*typeof navigator === "undefined" \? "" : navigator\.userAgent\s*\)/);
assert.match(
  loginSource,
  /\{GOOGLE_LOGIN_ENABLED && inAppBrowser\.isInAppBrowser \? \(\s*<div className="auth-inapp">[\s\S]*?\) : \(\s*<div className="auth-google-group">\s*<Button[\s\S]*?className=\{/,
  "en un navegador integrado no se renderiza el botón de Google"
);
assert.ok(loginSource.includes("Para ingresar con Google, abre esta página en Chrome o Safari."));
assert.ok(loginSource.includes("Copiar enlace"));
assert.match(loginSource, /navigator\.clipboard\.writeText\(loginLink\)/);
assert.ok(
  loginSource.slice(loginSource.indexOf('<div className="auth-divider">')).includes("<form"),
  "el ingreso con correo sigue disponible"
);
console.log("OK Login: en navegador integrado reemplaza el botón de Google por Copiar enlace y conserva el correo");

// --- Interruptor del ingreso con Google (apagado por defecto) ---------------
assert.equal(resolveGoogleLoginEnabled(undefined), false);
assert.equal(resolveGoogleLoginEnabled({}), false);
for (const off of ["false", "TRUE", "1", "", " true", true, 1, null]) {
  assert.equal(resolveGoogleLoginEnabled({VITE_GOOGLE_LOGIN_ENABLED: off}), false, `valor ${JSON.stringify(off)}`);
}
assert.equal(resolveGoogleLoginEnabled({VITE_GOOGLE_LOGIN_ENABLED: "true"}), true);
assert.equal(GOOGLE_LOGIN_ENABLED, false, "sin la variable el interruptor vale false");

const featureFlagsSource = await read("src/config/featureFlags.mjs");
assert.match(featureFlagsSource, /env\?\.VITE_GOOGLE_LOGIN_ENABLED === "true"/);
assert.match(featureFlagsSource, /export const GOOGLE_LOGIN_ENABLED = resolveGoogleLoginEnabled\(import\.meta\.env\);/);
for (const envFile of [".env.emulator", ".env.existing", ".env.local", ".env.production"]) {
  const content = await read(envFile).catch(() => "");
  assert.doesNotMatch(content, /VITE_GOOGLE_LOGIN_ENABLED/, `${envFile} no define el interruptor`);
}

// Apagado: botón deshabilitado con su nota ligada por aria-describedby.
assert.match(loginSource, /import \{ GOOGLE_LOGIN_ENABLED \} from "\.\.\/\.\.\/config\/featureFlags\.mjs";/);
assert.match(loginSource, /disabled=\{!GOOGLE_LOGIN_ENABLED \|\| isSubmitting\}/);
assert.match(loginSource, /aria-describedby=\{\s*GOOGLE_LOGIN_ENABLED \? undefined : "auth-google-note"\s*\}/);
assert.match(
  loginSource,
  /\{!GOOGLE_LOGIN_ENABLED && \(\s*<p id="auth-google-note" className="auth-google__note">\s*Ingreso con Google no conectado por ahora\.\s*<\/p>\s*\)\}/
);
assert.match(loginCss, /\.auth-google--disabled \.auth-google__logo \{\s*filter: grayscale\(1\);/, "logo en gris");
assert.doesNotMatch(loginCss, /\.auth-google--disabled[^{]*\{[^}]*(?:#|rgb|hsl)/);
// El separador y el formulario no cambian.
assert.ok(loginSource.includes('<div className="auth-divider">o</div>'));
assert.ok(loginSource.slice(loginSource.indexOf('<div className="auth-divider">')).includes("<form"));
// Apagado, nadie llama a loginWithGoogle ni a completeGoogleRedirect.
const handleGoogleBody = loginSource.slice(
  loginSource.indexOf("const handleGoogle = async () => {"),
  loginSource.indexOf("const handlePasswordReset")
);
assert.match(handleGoogleBody, /if \(!GOOGLE_LOGIN_ENABLED \|\| isGoogleLoading \|\| isSubmitting\) return;/);
assert.ok(handleGoogleBody.indexOf("GOOGLE_LOGIN_ENABLED") < handleGoogleBody.indexOf("await loginWithGoogle()"));
assert.equal(loginSource.match(/loginWithGoogle\(\)/g).length, 1, "loginWithGoogle solo se llama desde handleGoogle");
assert.equal(loginSource.match(/completeGoogleRedirect\(\)/g).length, 1);
assert.equal(loginSource.match(/onClick=\{handleGoogle\}/g).length, 1);

// Encendido: la rama sigue intacta (navegador integrado, logo, errores, servicio).
assert.ok(loginSource.includes("GOOGLE_LOGIN_ENABLED && inAppBrowser.isInAppBrowser"));
assert.ok(loginSource.includes("Continuar con Google"));
assert.match(loginSource, /loading=\{isGoogleLoading\}/);
assert.match(loginSource, /case "auth\/popup-closed-by-user":/);
assert.match(loginSource, /case "auth\/account-exists-with-different-credential":/);
assert.match(authServiceSource, /export async function loginWithGoogle\(\)/);
assert.match(authServiceSource, /export function completeGoogleRedirect\(\)/);
console.log("OK Interruptor: Google apagado por defecto (botón deshabilitado con su nota) y rama encendida intacta");

console.log("OK login-access: todas las aserciones pasaron");
