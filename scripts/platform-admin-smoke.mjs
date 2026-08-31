import assert from "node:assert/strict";
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

const [layoutSource, appLayoutSource, pagesSource, serviceSource, functionsSource, resetSource] = await Promise.all([
  readFile(new URL("../src/platform/PlatformAdminLayout.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/layout/AppLayout.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/platform/PlatformAdminPages.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/services/platformAdminService.js", import.meta.url), "utf8"),
  readFile(new URL("../functions/platformAdmin.js", import.meta.url), "utf8"),
  readFile(new URL("./reset-production-for-v1-qa.mjs", import.meta.url), "utf8"),
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
assert.match(resetSource, /const PROJECT_ID = "tesis-inventario-ia"/);
assert.match(resetSource, /const PRESERVED_ADMIN_EMAIL = "software\.bagner@gmail\.com"/);
assert.match(resetSource, /platformRole !== PLATFORM_SUPERADMIN/);
assert.match(resetSource, /mode: confirm \? "confirm" : "dry-run"/);
assert.match(resetSource, /argv\.includes\("--confirm"\)/);
assert.match(resetSource, /GOOGLE_APPLICATION_CREDENTIALS/);
assert.match(resetSource, /async function walk\(parentPath, collectionId\)/);
assert.match(resetSource, /await walk\(relativePath, nestedCollectionId\)/);
assert.match(resetSource, /right\.path\.split\("\/"\)\.length - left\.path\.split\("\/"\)\.length/);
assert.match(resetSource, /await verifyPostReset\(api, admin\.localId\)/);

console.log("Platform admin smoke: OK");
