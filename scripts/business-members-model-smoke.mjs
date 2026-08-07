import assert from "node:assert/strict";
import fs from "node:fs";
import {
  adaptBusinessMember,
  canManageBusinessMembers,
  canReadBusinessMembers,
  isValidBusinessMemberEmail,
  normalizeBusinessMemberEmail,
} from "../src/domain/businessMemberModel.mjs";

assert.equal(canReadBusinessMembers("OWNER"), true);
assert.equal(canReadBusinessMembers("ADMIN"), true);
assert.equal(canReadBusinessMembers("MEMBER"), true);
assert.equal(canReadBusinessMembers("UNKNOWN"), false);
assert.equal(canManageBusinessMembers("OWNER"), true);
assert.equal(canManageBusinessMembers("ADMIN"), false);
assert.equal(canManageBusinessMembers("MEMBER"), false);
console.log("OK miembros modelo: OWNER administra y ADMIN/MEMBER consultan");

assert.equal(normalizeBusinessMemberEmail(" Persona@Empresa.CL "), "persona@empresa.cl");
assert.equal(isValidBusinessMemberEmail("persona@empresa.cl"), true);
assert.equal(isValidBusinessMemberEmail("correo-incompleto"), false);
const adapted = adaptBusinessMember({
  uid: "member-1",
  nombre: "Persona Ejemplo",
  correo: "persona@example.test",
  rol: "ADMIN",
  estado: "activo",
  fechaIncorporacion: "2026-08-07T12:00:00.000Z",
  telefonoPersonal: "+56 9 1111 2222",
  numeroDocumento: "12.345.678-5",
});
assert.deepEqual(Object.keys(adapted).sort(), [
  "correo",
  "estado",
  "fechaIncorporacion",
  "nombre",
  "rol",
  "uid",
]);
assert.equal(adapted.telefonoPersonal, undefined);
assert.equal(adapted.numeroDocumento, undefined);
console.log("OK miembros modelo: DTO mínimo y correo exacto normalizado");

const backendSource = fs.readFileSync("functions/businessMemberships.js", "utf8");
const rulesSource = fs.readFileSync("firestore.rules", "utf8");
const pageSource = fs.readFileSync("src/pages/EmployeesPage.jsx", "utf8");
const navigationSource = fs.readFileSync("src/app/navigation.js", "utf8");
assert.match(backendSource, /getUserByEmail/);
assert.match(backendSource, /authUser\.disabled/);
assert.doesNotMatch(backendSource, /emailVerified/);
assert.match(backendSource, /roles: \["OWNER"\]/);
assert.match(backendSource, /target\.rol === "OWNER"/);
assert.match(backendSource, /transaction\.create\(targetRef/);
assert.doesNotMatch(backendSource, /transaction\.delete/);
assert.match(
  rulesSource,
  /match \/membresias\/\{membershipId\}[\s\S]*allow create, update, delete: if false;/
);
assert.match(pageSource, /canManageBusinessMembers/);
assert.match(pageSource, /erp-card-list erp-mobile-only/);
assert.match(navigationSource, /to: "\/empleados"/);
console.log("OK miembros integración estática: backend autoritativo, Rules y UI responsive");

console.log("BUSINESS_MEMBERS_MODEL_SMOKE_OK");
