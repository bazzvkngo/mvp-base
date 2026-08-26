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

const [pagesSource, serviceSource, functionsSource] = await Promise.all([
  readFile(new URL("../src/platform/PlatformAdminPages.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/services/platformAdminService.js", import.meta.url), "utf8"),
  readFile(new URL("../functions/platformAdmin.js", import.meta.url), "utf8"),
]);
assert.match(pagesSource, /window\.open\("", "_blank"\)[\s\S]*getPlatformVerificationDocument/);
assert.match(pagesSource, />Ver documento</);
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
assert.match(serviceSource, /eliminarEmpresaPermanentePlataforma/);
assert.match(functionsSource, /requirePlatformSuperadmin\(request, dependencies\)/);
assert.match(functionsSource, /db\.recursiveDelete\(businessRef\)/);

console.log("Platform admin smoke: OK");
