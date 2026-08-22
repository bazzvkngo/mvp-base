import assert from "node:assert/strict";
import {hasPlatformSuperadminClaim, isPlatformRoute} from "../src/domain/platformAccess.mjs";

assert.equal(hasPlatformSuperadminClaim({platformRole: "PLATFORM_SUPERADMIN"}), true);
assert.equal(hasPlatformSuperadminClaim({platformRole: "OWNER"}), false);
assert.equal(hasPlatformSuperadminClaim({}), false);
assert.equal(isPlatformRoute("/admin"), true);
assert.equal(isPlatformRoute("/admin/empresas/abc"), true);
assert.equal(isPlatformRoute("/empresa"), false);

console.log("Platform admin smoke: OK");
