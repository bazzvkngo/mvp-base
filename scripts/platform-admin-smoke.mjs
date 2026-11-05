import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {readFile} from "node:fs/promises";
import {hasPlatformSuperadminClaim, isPlatformRoute} from "../src/domain/platformAccess.mjs";
import {formatFiscalIdentifierForDisplay} from "../src/domain/fiscalIdentifier.mjs";

assert.equal(hasPlatformSuperadminClaim({platformRole: "PLATFORM_SUPERADMIN"}), true);
assert.equal(hasPlatformSuperadminClaim({platformRole: "OWNER"}), false);
assert.equal(hasPlatformSuperadminClaim({}), false);
assert.equal(isPlatformRoute("/admin"), true);
assert.equal(isPlatformRoute("/admin/empresas/abc"), true);
assert.equal(isPlatformRoute("/empresa"), false);
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
assert.match(pagesSource, /Confirmar aprobación/);
assert.match(pagesSource, /Confirmar rechazo/);
assert.match(pagesSource, /disabled=\{working \|\| !officialLegalName\.trim\(\)\}/);
assert.match(pagesSource, /disabled=\{working \|\| !rejectionReason\.trim\(\)\}/);
assert.match(pagesSource, /Nombre no informado/);
assert.match(serviceSource, /eliminarEmpresaPermanentePlataforma/);
assert.match(functionsSource, /requirePlatformSuperadmin\(request, dependencies\)/);
assert.match(functionsSource, /db\.recursiveDelete\(businessRef\)/);
assert.match(functionsSource, /customClaims\?\.platformRole === PLATFORM_SUPERADMIN/);
assert.match(functionsSource, /const PLATFORM_SUPERADMIN = "PLATFORM_SUPERADMIN"/);
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

// Interruptor de modulos: seccion "Modulos" de la consola y su servicio.
const modulesPanelSource = await readFile(new URL("../src/platform/PlatformModulesPanel.jsx", import.meta.url), "utf8");
assert.match(serviceSource, /export const setPlatformBusinessModules = \(\{businessId, modulos, motivo, requestId\}\) =>\s*call\("cambiarModulosEmpresaPlataforma", \{businessId, modulos, motivo, requestId\}\)/);
assert.match(pagesSource, /<PlatformModulesPanel[\s\S]*?registry=\{modulosDisponibles\}[\s\S]*?enabled=\{enabledModules\}/);
assert.match(pagesSource, /run\("update_modules", \(requestId\) => setPlatformBusinessModules\(\{businessId, modulos, motivo, requestId\}\)\)/);
assert.match(pagesSource, /modulos_actualizados: "Módulos actualizados"/);
assert.match(pagesSource, /event\.tipo === MODULES_EVENT_TYPE \? moduleEventSummary\(event, modulosDisponibles\)/);
assert.match(modulesPanelSource, /<h2 id="platform-modules-title">Módulos<\/h2>/);
assert.match(modulesPanelSource, /No hay módulos verticales disponibles todavía\./);
assert.match(modulesPanelSource, /registry\.map\(\(item\) => \([\s\S]*?type="checkbox"/);
assert.match(modulesPanelSource, /Motivo del cambio/);
assert.match(modulesPanelSource, /Guardar módulos/);
assert.match(modulesPanelSource, /disabled=\{deleted \|\| working \|\| !dirty \|\| !reason\.trim\(\)\}/);
assert.doesNotMatch(modulesPanelSource, /taller|veterinaria/i, "el panel no conoce ningun modulo por nombre");
console.log("OK platform-admin: seccion Modulos y servicio");
