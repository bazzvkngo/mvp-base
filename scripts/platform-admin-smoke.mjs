import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {readFile} from "node:fs/promises";
import {hasPlatformSuperadminClaim, isPlatformRoute, resolvePlatformOnlyRedirect, PLATFORM_HOME_PATH} from "../src/domain/platformAccess.mjs";
import {formatFiscalIdentifierForDisplay} from "../src/domain/fiscalIdentifier.mjs";

assert.equal(hasPlatformSuperadminClaim({platformRole: "PLATFORM_SUPERADMIN"}), true);
assert.equal(hasPlatformSuperadminClaim({platformRole: "OWNER"}), false);
assert.equal(hasPlatformSuperadminClaim({}), false);
assert.equal(isPlatformRoute("/admin"), true);
assert.equal(isPlatformRoute("/admin/empresas/abc"), true);
assert.equal(isPlatformRoute("/empresa"), false);
// Superadmin sin negocio: raiz, /login, /onboarding y cualquier ruta de respaldo van a la consola.
const superadmin = {isSuperadmin: true, role: "PLATFORM_SUPERADMIN"};
const normalUser = {isSuperadmin: false, role: null};
assert.equal(PLATFORM_HOME_PATH, "/admin/dashboard");
for (const pathname of ["/", "/login", "/onboarding", "/cotizaciones", "/ruta-que-no-existe", "/empresa"]) {
  assert.equal(resolvePlatformOnlyRedirect({platformAccess: superadmin, needsOnboarding: true, pathname}), "/admin/dashboard", `superadmin sin negocio en ${pathname}`);
}
// Ya dentro de /admin no redirige (el guard de plataforma lo atiende).
for (const pathname of ["/admin", "/admin/dashboard", "/admin/empresas/abc"]) {
  assert.equal(resolvePlatformOnlyRedirect({platformAccess: superadmin, needsOnboarding: true, pathname}), null);
}
// Superadmin con negocio y usuario normal no cambian.
for (const pathname of ["/", "/login", "/onboarding", "/cotizaciones"]) {
  assert.equal(resolvePlatformOnlyRedirect({platformAccess: superadmin, needsOnboarding: false, pathname}), null, `superadmin con negocio en ${pathname}`);
  assert.equal(resolvePlatformOnlyRedirect({platformAccess: normalUser, needsOnboarding: true, pathname}), null, `usuario normal en ${pathname}`);
  assert.equal(resolvePlatformOnlyRedirect({platformAccess: normalUser, needsOnboarding: false, pathname}), null);
}
// Sin resolver (cargando) o con datos invalidos: no redirige.
for (const platformAccess of [null, undefined, {}, {isSuperadmin: "true"}, {isSuperadmin: 1}]) {
  assert.equal(resolvePlatformOnlyRedirect({platformAccess, needsOnboarding: true, pathname: "/"}), null);
}
assert.equal(resolvePlatformOnlyRedirect({platformAccess: superadmin, pathname: "/"}), null, "needsOnboarding ausente no redirige");
assert.equal(resolvePlatformOnlyRedirect(), null);
assert.equal(formatFiscalIdentifierForDisplay("AR", "30712345678"), "30-71234567-8");

const [layoutSource, appLayoutSource, pagesSource, serviceSource, functionsSource] = await Promise.all([
  readFile(new URL("../src/platform/PlatformAdminLayout.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/layout/AppLayout.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/platform/PlatformAdminPages.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/services/platformAdminService.js", import.meta.url), "utf8"),
  readFile(new URL("../functions/platformAdmin.js", import.meta.url), "utf8"),
]);
assert.match(layoutSource, /Consola de Administración/);
assert.match(layoutSource, /Administración de plataforma/);
assert.match(layoutSource, />Administrador<\/span>/);
assert.doesNotMatch(layoutSource, />[^<]*Superadmin[^<]*</i);
assert.doesNotMatch(layoutSource, />PLATFORM_SUPERADMIN</);
assert.doesNotMatch(layoutSource, /Platform Console|Panel plataforma/);
assert.match(appLayoutSource, /Consola de Administración/);
assert.match(pagesSource, /window\.open\("", "_blank"\)[\s\S]*getPlatformVerificationDocument/);
assert.match(pagesSource, /popup\.document\.body\.textContent = "Preparando documento seguro/);
assert.match(pagesSource, /popup\.location\.assign\(evidence\.url\)/);
assert.match(pagesSource, /if \(!popup\.closed\) popup\.close\(\)/);
assert.match(serviceSource, /getSafePlatformDocumentUrl\(evidence\?\.url\)/);
assert.match(serviceSource, /parsed\.protocol !== "https:" && !localEmulator/);
assert.match(pagesSource, /"Ver documento"/);
assert.match(pagesSource, /className="platform-verification-review__evidence"/);
assert.match(pagesSource, />Evidencia</);
assert.doesNotMatch(pagesSource, /Generar acceso temporal al documento/);
assert.match(pagesSource, /El navegador bloqueó la nueva pestaña/);
assert.match(pagesSource, /<form className="platform-filters" onSubmit=\{onSubmit\}>/);
assert.match(pagesSource, /type="search"/);
assert.match(pagesSource, /onSelectorChange\(\{\.\.\.draft, country:/);
assert.match(pagesSource, /onSelectorChange\(\{\.\.\.draft, state:/);
assert.match(pagesSource, /onSelectorChange\(\{\.\.\.draft, verification:/);
assert.match(pagesSource, /onSelectorChange\(\{\.\.\.draft, company:/);
assert.match(pagesSource, /setFilters\(\{\.\.\.nextFilters, search: nextFilters\.search\.trim\(\)\}\)/);
assert.match(pagesSource, /setFilters\(\{\.\.\.initialFilters\}\)/);
for (const route of ["/admin/empresas", "/admin/usuarios", "/admin/verificaciones"]) {
  assert.match(pagesSource, new RegExp(`to: "${route}"`));
}
assert.match(pagesSource, /to: "\/admin\/empresas\?estado=SUSPENDIDA"/);
assert.match(pagesSource, /label: "Suspensiones", value: state\.data\.empresas\.suspendidas, detail: "Empresas suspendidas"/);
assert.doesNotMatch(pagesSource, /empresas\.suspendidas \+ state\.data\.usuarios\.suspendidos/);
assert.match(pagesSource, /className="platform-metric platform-metric--link"/);
assert.match(pagesSource, /new URLSearchParams\(location\.search\)\.get\("estado"\)/);
assert.doesNotMatch(pagesSource, /<th>Propietario<\/th>/);
assert.doesNotMatch(pagesSource, /<small>\{business\.id\}<\/small>/);
assert.match(pagesSource, /business\.propietario\?\.correo \|\| "Propietario sin correo"/);
assert.match(pagesSource, /busqueda: firstId|ID: \{empresa\.id\}/);
assert.match(pagesSource, /\.\.\.\(verified \? \[[\s\S]*Razón social oficial[\s\S]*confirmado/);
assert.doesNotMatch(pagesSource, /label: "País declarado"|label: "Tipo fiscal"/);
assert.match(pagesSource, /fiscalFieldLabel\(solicitudActual\.identificadorFiscalTipo, "declarado"\)/);
assert.match(pagesSource, /<h2>Historial<\/h2>/);
assert.match(pagesSource, /VERIFICACION_APROBADA: "Verificación aprobada"/);
assert.match(pagesSource, /PENDIENTE: "En revisión"/);
assert.match(pagesSource, /platformEventLabel\(event\.tipo\)/);
assert.match(pagesSource, /platformStateLabel\(event\.estadoAnterior\)/);
// Los textos del modal de confirmación viven en VerificationDecisionDialog.jsx (se prueban al final de este archivo).
assert.match(await readFile(new URL("../src/platform/VerificationDecisionDialog.jsx", import.meta.url), "utf8"), /Confirmar aprobación[\s\S]*Confirmar rechazo/);
assert.match(pagesSource, /<VerificationDecisionDialog/);
assert.match(pagesSource, /disabled=\{working \|\| !officialLegalName\.trim\(\)\}/);
assert.match(pagesSource, /disabled=\{working \|\| !rejectionReason\.trim\(\)\}/);
assert.match(pagesSource, /Nombre no informado/);
assert.match(serviceSource, /eliminarEmpresaPermanentePlataforma/);
assert.match(functionsSource, /requirePlatformSuperadmin\(request, dependencies\)/);
assert.match(functionsSource, /db\.recursiveDelete\(businessRef\)/);
assert.match(functionsSource, /customClaims\?\.platformRole === PLATFORM_SUPERADMIN/);
assert.match(
  await readFile(new URL("../functions/platformAccess.js", import.meta.url), "utf8"),
  /const PLATFORM_SUPERADMIN = "PLATFORM_SUPERADMIN"/
);
assert.doesNotMatch(functionsSource, /Las cuentas PLATFORM_SUPERADMIN/);
// Guardas de la Function: autosuspension y destino con claim de plataforma.
assert.match(functionsSource, /if \(uid === actor\.uid\) fail\(HttpsError, "failed-precondition", "No puedes suspender tu propia cuenta\."\)/);
assert.match(functionsSource, /Las cuentas Administrador no se suspenden desde este panel\./);
// Ficha de usuario: la cuenta propia no muestra el formulario de suspension.
assert.match(layoutSource, /currentUid: usuario\?\.uid \|\| ""/);
assert.match(pagesSource, /const \{currentUid\} = useOutletContext\(\) \|\| \{\};/);
assert.match(pagesSource, /const isOwnAccount = Boolean\(currentUid\) && usuario\.uid === currentUid;/);
assert.match(pagesSource, /\{isOwnAccount \? <p className="platform-help platform-help--flush">Tu propia cuenta de plataforma no se suspende desde aquí\.<\/p> : <>/);
assert.equal((pagesSource.match(/Suspender usuario/g) || []).length, 1);
// El reset total de producción (borraba negocios, membresías y cuentas salvo
// la superadmin) se retiró del repo; queda sólo en el historial de git.
assert.equal(
  existsSync(new URL("./reset-production-for-v1-qa.mjs", import.meta.url)),
  false,
  "scripts/reset-production-for-v1-qa.mjs no debe volver al repo"
);

console.log("Platform admin smoke: OK");

// Interruptor de modulos por negocio: la Function de plataforma sigue el patron
// de las demas acciones (superadmin, requestId idempotente, transaccion, evento)
// y recibe el registro por dependencias.
const [platformIndexSource, platformRulesSource] = await Promise.all([
  readFile(new URL("../functions/index.js", import.meta.url), "utf8"),
  readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
]);
assert.match(functionsSource, /async function cambiarModulosEmpresaPlataformaHandler\(request, dependencies\) \{[\s\S]*?dependencies\.verticalModules \|\| VERTICAL_MODULES[\s\S]*?requirePlatformSuperadmin[\s\S]*?platformModulesRequests[\s\S]*?db\.runTransaction[\s\S]*?tipo: MODULES_EVENT_TYPE/);
assert.match(functionsSource, /MODULES_EVENT_TYPE = "modulos_actualizados"/);
assert.match(functionsSource, /modulosAnteriores: previous,[\s\S]*?modulosResultantes: desired,[\s\S]*?motivo: reason,[\s\S]*?creadoPorUid: actor\.uid/);
assert.match(functionsSource, /Indica el motivo del cambio de modulos/);
assert.match(functionsSource, /modulosDisponibles: registry\.map/);
assert.match(functionsSource, /modulosHabilitados: normalizeEnabledModules\(business\.modulosHabilitados, registry\)/);
assert.match(platformIndexSource, /exports\.cambiarModulosEmpresaPlataforma = onCall\([\s\S]*?cambiarModulosEmpresaPlataformaHandler\(request, platformAdminDependencies\)/);
assert.match(platformIndexSource, /const platformAdminDependencies = \{[\s\S]*?verticalModules: VERTICAL_MODULES,[\s\S]*?\};/);
assert.match(platformRulesSource, /match \/platformModulesRequests\/\{requestId\} \{\s*allow read, create, update, delete: if false;/);
assert.match(platformRulesSource, /function isBusinessModuleEnabled\(businessId, moduleId\)[\s\S]*?get\("modulosHabilitados", \[\]\)\.hasAny\(\[moduleId\]\)/);
console.log("OK platform-admin: cambiarModulosEmpresaPlataforma, registro por dependencias y reglas");

// SPEC 039: la consola ya no edita modulos (el rubro de la empresa los define). La Function de
// plataforma se conserva sin cambios (asserts de arriba); lo que se retira es el panel y su servicio.
const moduleEventsSource = await readFile(new URL("../src/platform/platformModuleEvents.mjs", import.meta.url), "utf8");
assert.equal(existsSync(new URL("../src/platform/PlatformModulesPanel.jsx", import.meta.url)), false, "el panel Modulos se retiro");
assert.doesNotMatch(pagesSource, /PlatformModulesPanel|setPlatformBusinessModules|update_modules|Guardar módulos/);
assert.doesNotMatch(serviceSource, /setPlatformBusinessModules/);
assert.doesNotMatch(layoutSource + pagesSource, /platform-modules/);
const platformStylesSource = await readFile(new URL("../src/styles/platform.css", import.meta.url), "utf8");
assert.doesNotMatch(platformStylesSource, /platform-modules/);
// El historial sigue mostrando los eventos modulos_actualizados que ya existen.
assert.match(moduleEventsSource, /export const MODULES_EVENT_TYPE = "modulos_actualizados"/);
assert.match(moduleEventsSource, /export function moduleEventSummary\(event, registry = \[\]\)/);
assert.match(pagesSource, /import \{MODULES_EVENT_TYPE, moduleEventSummary\} from "\.\/platformModuleEvents\.mjs"/);
assert.match(pagesSource, /modulos_actualizados: "Módulos actualizados"/);
assert.match(pagesSource, /event\.tipo === MODULES_EVENT_TYPE \? moduleEventSummary\(event, modulosDisponibles\)/);
const {MODULES_EVENT_TYPE, moduleEventSummary} = await import("../src/platform/platformModuleEvents.mjs");
assert.equal(MODULES_EVENT_TYPE, "modulos_actualizados");
const eventRegistry = [{id: "taller", label: "Taller automotriz"}, {id: "veterinaria", label: "Clínica veterinaria"}];
assert.equal(
  moduleEventSummary({modulosAnteriores: [], modulosResultantes: ["taller"], motivo: "Prueba"}, eventRegistry),
  "Módulos: ninguno → Taller automotriz · Prueba"
);
assert.equal(
  moduleEventSummary({modulosAnteriores: ["taller", "otro"], modulosResultantes: []}, eventRegistry),
  "Módulos: Taller automotriz, otro → ninguno"
);
console.log("OK platform-admin: sin panel Modulos, historial de modulos conservado (SPEC 039)");

// --- Modal "Confirmar aprobación / rechazo": el motivo del rechazo del servidor se ve dentro del modal ---
{
  const {
    INITIAL_DECISION_STATE, PLATFORM_ACTION_GENERIC_ERROR, confirmDecision, decisionReducer, platformActionErrorMessage,
  } = await import("../src/platform/verificationDecision.mjs");
  const GENERIC = "No se pudo completar la acción. Intenta de nuevo.";
  assert.equal(PLATFORM_ACTION_GENERIC_ERROR, GENERIC);

  // Mensaje: el de negocio tal cual; lo demás, el genérico (sin códigos ni trazas).
  const alreadyExists = {code: "functions/already-exists", message: "La identidad fiscal ya pertenece a otra empresa verificada."};
  assert.equal(platformActionErrorMessage(alreadyExists), "La identidad fiscal ya pertenece a otra empresa verificada.");
  assert.equal(platformActionErrorMessage({code: "already-exists", message: "  La decisión ya fue utilizada con otros datos.  "}), "La decisión ya fue utilizada con otros datos.");
  for (const code of ["failed-precondition", "invalid-argument", "not-found"]) {
    assert.equal(platformActionErrorMessage({code: `functions/${code}`, message: "La solicitud ya no esta pendiente."}), "La solicitud ya no esta pendiente.", code);
  }
  const notReadable = [
    {code: "functions/unavailable", message: "Failed to fetch"},
    {code: "functions/permission-denied", message: "Se requiere autoridad de plataforma."},
    {code: "functions/unauthenticated", message: "Debes iniciar sesion."},
    {code: "functions/internal", message: "internal"},
    {code: "functions/deadline-exceeded", message: "deadline-exceeded"},
    {code: "functions/already-exists", message: ""},
    {code: "functions/already-exists", message: "already-exists"},
    {code: "functions/already-exists", message: "functions/already-exists"},
    {code: "functions/failed-precondition", message: "Error: algo salió mal\n    at run (platformAdminService.js:12:3)"},
    {code: "functions/invalid-argument", message: "x ".repeat(200)},
    {code: "functions/not-found"},
    {message: "Algo con varias palabras sin código"},
    new Error("boom con varias palabras"),
    "texto suelto", null, undefined, 7, {},
  ];
  for (const error of notReadable) assert.equal(platformActionErrorMessage(error), GENERIC, JSON.stringify(error));
  assert.doesNotMatch(platformActionErrorMessage({code: "functions/internal", message: "internal"}), /functions\/|internal|code/i);

  // Estado: el error del servicio llega al modal, que sigue abierto; se limpia al reintentar, cerrar y reabrir.
  let state = INITIAL_DECISION_STATE;
  const dispatch = (action) => { state = decisionReducer(state, action); };
  const failingService = (error) => async () => { throw error; };
  // Mismo contrato que `run` de la página: captura el error, lo entrega a onError y devuelve false.
  const runAction = (service) => async ({onError}) => {
    try { await service(); return true; } catch (error) { onError(error); return false; }
  };
  dispatch({type: "open", decision: "APROBAR"});
  assert.deepEqual(state, {decision: "APROBAR", error: ""});
  assert.equal(await confirmDecision({dispatch, runAction: runAction(failingService(alreadyExists))}), false);
  assert.deepEqual(state, {decision: "APROBAR", error: "La identidad fiscal ya pertenece a otra empresa verificada."}, "el modal sigue abierto y muestra el motivo del servidor");
  // Reintento: el aviso anterior se limpia al empezar y el nuevo error genérico lo reemplaza.
  let errorWhileRunning = null;
  await confirmDecision({dispatch, runAction: async ({onError}) => {
    errorWhileRunning = state.error;
    onError({code: "functions/unavailable", message: "Failed to fetch"});
    return false;
  }});
  assert.equal(errorWhileRunning, "", "al reintentar el aviso anterior ya no está");
  assert.deepEqual(state, {decision: "APROBAR", error: GENERIC});
  // Cerrar (Volver o la X) y volver a abrir: sin aviso. Cambiar de decisión también lo limpia.
  dispatch({type: "close"});
  assert.deepEqual(state, INITIAL_DECISION_STATE);
  dispatch({type: "open", decision: "APROBAR"});
  assert.equal(state.error, "");
  await confirmDecision({dispatch, runAction: runAction(failingService(alreadyExists))});
  assert.notEqual(state.error, "");
  dispatch({type: "close"});
  dispatch({type: "open", decision: "APROBAR"});
  assert.deepEqual(state, {decision: "APROBAR", error: ""}, "al cerrar y reabrir el aviso anterior ya no aparece");
  await confirmDecision({dispatch, runAction: runAction(failingService(alreadyExists))});
  dispatch({type: "open", decision: "RECHAZAR"});
  assert.deepEqual(state, {decision: "RECHAZAR", error: ""});
  // Éxito: cierra sin aviso (el comportamiento de antes).
  assert.equal(await confirmDecision({dispatch, runAction: runAction(async () => {})}), true);
  assert.deepEqual(state, INITIAL_DECISION_STATE);
  // Un error que llega con el modal ya cerrado no abre nada; acciones desconocidas no cambian el estado.
  assert.deepEqual(decisionReducer(INITIAL_DECISION_STATE, {type: "fail", error: alreadyExists}), INITIAL_DECISION_STATE);
  assert.equal(decisionReducer(state, {type: "otra"}), state);
  assert.equal(decisionReducer(undefined, undefined), INITIAL_DECISION_STATE);

  // Render real del modal (sin portal): aviso de error con role="alert", botones y estados.
  const [{default: React}, {renderToStaticMarkup}, {createServer}] = await Promise.all([import("react"), import("react-dom/server"), import("vite")]);
  const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
  let Dialog;
  try {
    Dialog = (await vite.ssrLoadModule("/src/platform/VerificationDecisionDialog.jsx")).default;
  } finally {
    await vite.close();
  }
  const render = (props) => renderToStaticMarkup(React.createElement(Dialog, {portal: false, onClose() {}, onConfirm() {}, summary: "Bagner SpA", fiscalIdentifier: "76.123.456-7", ...props}));
  const count = (markup, pattern) => (markup.match(pattern) || []).length;
  const withError = render({decision: "APROBAR", error: "La identidad fiscal ya pertenece a otra empresa verificada."});
  assert.match(withError, /Confirmar aprobación/);
  assert.match(withError, /La identidad fiscal ya pertenece a otra empresa verificada\./, "el mensaje de negocio se muestra tal cual");
  assert.match(withError, /ui-notice--error/, "aviso de error del sistema de diseño");
  assert.equal(count(withError, /role="alert"/g), 1, "un solo role=alert");
  assert.match(withError, /Aprobar empresa/);
  assert.match(withError, /Bagner SpA/, "el modal conserva su contenido");
  assert.doesNotMatch(withError, /functions\/|already-exists/);
  assert.ok(withError.indexOf("ui-notice--error") < withError.indexOf("platform-verification-confirmation"), "el aviso va arriba del resumen");
  const genericMarkup = render({decision: "APROBAR", error: GENERIC});
  assert.match(genericMarkup, /No se pudo completar la acción\. Intenta de nuevo\./);
  const rejecting = render({decision: "RECHAZAR", error: GENERIC, summary: "Falta el documento"});
  assert.match(rejecting, /Confirmar rechazo/);
  assert.match(rejecting, /Rechazar solicitud/);
  assert.match(rejecting, /role="alert"/);
  // Sin error: sin aviso. Cerrado: no dibuja nada.
  const clean = render({decision: "APROBAR", error: ""});
  assert.doesNotMatch(clean, /ui-notice|role="alert"/);
  assert.equal(render({decision: "", error: "no debería verse"}), "");
  // Mientras la acción corre, Volver y la acción quedan deshabilitados (sin doble envío); con el error vuelven a habilitarse.
  const buttons = (markup) => [...markup.matchAll(/<button\b[^>]*>/g)].map(([tag]) => tag);
  const dialogButtons = (markup) => buttons(markup).filter((tag) => /ui-button/.test(tag));
  const working = render({decision: "APROBAR", error: "", working: true});
  assert.equal(dialogButtons(working).length >= 2, true);
  assert.equal(dialogButtons(working).every((tag) => /\bdisabled\b/.test(tag)), true, "botones del modal deshabilitados mientras corre");
  assert.match(working, /Confirmando\.\.\./);
  assert.equal(dialogButtons(withError).some((tag) => /\bdisabled\b/.test(tag)), false, "tras el error los botones se habilitan de nuevo");

  // Cableado: la página usa el estado y el modal nuevos; el error del servicio ya no cae al aviso de página;
  // las demás acciones conservan su aviso; el servicio y sus permisos no cambian.
  assert.match(pagesSource, /import VerificationDecisionDialog from "\.\/VerificationDecisionDialog"/);
  assert.match(pagesSource, /React\.useReducer\(decisionReducer, INITIAL_DECISION_STATE\)/);
  assert.match(pagesSource, /error=\{decisionState\.error\}/);
  assert.match(pagesSource, /onClose=\{\(\) => dispatchDecision\(\{type: "close"\}\)\}/);
  assert.match(pagesSource, /onConfirm=\{\(\) => confirmDecision\(\{/);
  assert.match(pagesSource, /\{onError\}\)/, "la decisión pasa onError a run");
  assert.match(pagesSource, /if \(onError\) onError\(error\);\s*else setNotice\(message\(error, "No pudimos completar la acción\."\)\);/);
  assert.equal(count(pagesSource, /dispatchDecision\(\{type: "open", decision: "(?:APROBAR|RECHAZAR)"\}\)/g), 2, "los dos botones abren el modal sin aviso");
  assert.doesNotMatch(pagesSource, /setVerificationDecision/);
  assert.doesNotMatch(pagesSource, /title=\{verificationDecision === "APROBAR" \? "Confirmar aprobación"/, "el modal ya no está en línea");
  const dialogSource = await readFile(new URL("../src/platform/VerificationDecisionDialog.jsx", import.meta.url), "utf8");
  assert.match(dialogSource, /<Notice variant="error"/);
  assert.match(dialogSource, /onClose=\{\(\) => !working && onClose\(\)\}/, "la X sigue bloqueada mientras corre");
  assert.match(serviceSource, /call\("resolverVerificacionEmpresa", \{\s*businessId,\s*solicitudId,\s*decision,\s*motivo,\s*razonSocialOficial,\s*requestId,\s*\}\)/);
  const errorCss = (await readFile(new URL("../src/styles/platform.css", import.meta.url), "utf8")).match(/\.platform-verification-dialog__error \{[^}]*\}/)?.[0] || "";
  assert.match(errorCss, /margin-bottom: var\(--space-3\)/);
  assert.doesNotMatch(errorCss, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  console.log("OK platform-admin: el error de aprobar/rechazar verificación se muestra dentro del modal (mensaje de negocio o genérico) y se limpia al cerrar");
}

// --- Un único requirePlatformSuperadmin (functions/platformAccess.js) ---
{
  const {createRequire} = await import("node:module");
  const {readdir} = await import("node:fs/promises");
  const requireFromScripts = createRequire(import.meta.url);
  const {PLATFORM_SUPERADMIN: ROLE, requirePlatformSuperadmin: guard} = requireFromScripts("../functions/platformAccess.js");
  assert.equal(ROLE, "PLATFORM_SUPERADMIN");

  class FakeHttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const makeDeps = ({authUser, userDoc = {}, authError = null}) => ({
    HttpsError: FakeHttpsError,
    auth: {getUser: async (uid) => { if (authError) throw authError; return {uid, ...authUser}; }},
    db: {collection: () => ({doc: () => ({get: async () => ({data: () => userDoc})})})},
  });
  const codeOf = async (promise) => { try { await promise; } catch (error) { return `${error.code}: ${error.message}`; } return "ok"; };
  const claim = {customClaims: {platformRole: ROLE}};

  assert.match(await codeOf(guard({}, makeDeps({authUser: claim}))), /^unauthenticated/);
  assert.match(await codeOf(guard({auth: {}}, makeDeps({authUser: claim}))), /^unauthenticated/);
  // El claim del token ya no cuenta: manda el de Auth (revocarlo surte efecto al instante).
  assert.match(
    await codeOf(guard({auth: {uid: "u1", token: {platformRole: ROLE}}}, makeDeps({authUser: {customClaims: {}}}))),
    /^permission-denied: Se requiere autoridad de plataforma/
  );
  assert.match(await codeOf(guard({auth: {uid: "u1"}}, makeDeps({authUser: {}}))), /^permission-denied/);
  assert.match(await codeOf(guard({auth: {uid: "u1"}}, makeDeps({authUser: {customClaims: {platformRole: "OWNER"}}}))), /^permission-denied/);
  assert.match(
    await codeOf(guard({auth: {uid: "u1"}}, makeDeps({authError: {code: "auth/user-not-found"}}))),
    /^permission-denied/
  );
  // Cuenta suspendida: Auth deshabilitado o estado de plataforma persistido.
  assert.match(
    await codeOf(guard({auth: {uid: "u1"}}, makeDeps({authUser: {...claim, disabled: true}}))),
    /^permission-denied: La cuenta de plataforma esta suspendida/
  );
  assert.match(
    await codeOf(guard({auth: {uid: "u1"}}, makeDeps({authUser: claim, userDoc: {estadoPlataforma: "suspendido"}}))),
    /^permission-denied: La cuenta de plataforma esta suspendida/
  );
  // Un error inesperado de Auth no se convierte en acceso.
  assert.match(await codeOf(guard({auth: {uid: "u1"}}, makeDeps({authError: {code: "auth/internal-error"}}))), /internal-error|undefined/);
  const allowed = await guard({auth: {uid: "u1", token: {}}}, makeDeps({authUser: claim}));
  assert.equal(allowed.uid, "u1");

  // Una sola definición: ninguna Function de plataforma lee el claim del token ni redefine el guardia.
  const functionFiles = (await readdir(new URL("../functions/", import.meta.url))).filter((name) => name.endsWith(".js"));
  const definitions = [];
  for (const name of functionFiles) {
    const source = await readFile(new URL(`../functions/${name}`, import.meta.url), "utf8");
    if (/function requirePlatformSuperadmin\b/.test(source)) definitions.push(name);
    assert.doesNotMatch(source, /token\?\.platformRole/, `${name} no debe leer el claim del token`);
  }
  assert.deepEqual(definitions, ["platformAccess.js"]);
  const verificationSource = await readFile(new URL("../functions/businessVerification.js", import.meta.url), "utf8");
  assert.match(verificationSource, /require\("\.\/platformAccess"\)/);
  assert.match(verificationSource, /await requirePlatformSuperadmin\(request, dependencies\)/);
  assert.match(platformIndexSource, /const businessVerificationDependencies = \{\s*auth: adminAuth,/);
  assert.match(functionsSource, /require\("\.\/platformAccess"\)/);
  console.log("OK platform-admin: un único requirePlatformSuperadmin lee authUser.customClaims y rechaza cuentas suspendidas");
}

// --- Empresas por cuenta, verificaciones pendientes en el Dashboard y motivos de usuario ---
{
  assert.match(functionsSource, /const accountUid = request\?\.data\?\.uid\s*\?\s*id\(request\.data\.uid, "La cuenta", HttpsError\)/);
  assert.match(functionsSource, /where\("uid", "==", uid\)\.where\("rol", "==", "OWNER"\)/);
  assert.match(functionsSource, /cuenta: \{\s*uid,\s*nombre: personName/);
  assert.match(functionsSource, /verificacionesPendientesAntiguas: oldestPendingDtos/);
  assert.match(functionsSource, /PENDING_VERIFICATIONS_PREVIEW = 5/);
  assert.match(functionsSource, /motivoSuspension: platformUserStatus\(user, authUser\) === SUSPENDED_STATUS/);
  assert.match(functionsSource, /motivo: text\(snapshot\.data\(\)\?\.motivo, 1000\),\s*creadoPorUid/);
  assert.match(serviceSource, /\.\.\.\(uid \? \{uid\} : \{\}\)/);
  assert.match(pagesSource, /<h3 className="platform-pending-subtitle" id="platform-pending-oldest-title">Las más antiguas primero<\/h3>/);
  assert.match(pagesSource, /state\.data\.verificacionesPendientesAntiguas \|\| \[\]/);
  assert.match(pagesSource, /to=\{`\/admin\/empresas\/\$\{business\.id\}`\}[\s\S]{0,260}Solicitud \{date\(business\.fechaSolicitud\)\}/);
  assert.match(pagesSource, />Ver empresas<\/Button>/);
  assert.match(pagesSource, /navigate\(`\/admin\/empresas\?uid=\$\{encodeURIComponent\(usuario\.uid\)\}`\)/);
  assert.match(pagesSource, /uid: filters\.uid,/);
  assert.match(pagesSource, /Empresas de la cuenta/);
  assert.match(pagesSource, /Ver todas las empresas/);
  assert.match(pagesSource, /\{label: "Motivo de suspensión", value: usuario\.motivoSuspension\}/);
  assert.match(pagesSource, /\{event\.motivo && <p>Motivo: \{event\.motivo\}<\/p>\}/);
  // El conteo actual de la tarjeta y del panel se conserva.
  assert.match(pagesSource, /\{pendingVerifications === 1 \? "1 verificación pendiente"/);
  const newCss = (await readFile(new URL("../src/styles/platform.css", import.meta.url), "utf8"))
    .split("\n").filter((line) => /platform-(account-filter|pending-subtitle|heading-actions)|recent-list--detailed/.test(line)).join("\n");
  assert.ok(newCss.length > 0);
  assert.doesNotMatch(newCss, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, "el CSS nuevo usa solo tokens");
  console.log("OK platform-admin: filtro por cuenta, pendientes antiguas en el Dashboard y motivos de usuario");
}
