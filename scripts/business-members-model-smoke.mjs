import assert from "node:assert/strict";
import fs from "node:fs";
import {
  adaptBusinessMember,
  businessMemberProfileLabel,
  canManageBusinessMembers,
  canReadBusinessMembers,
  isValidBusinessMemberEmail,
  normalizeBusinessMemberEmail,
} from "../src/domain/businessMemberModel.mjs";

assert.equal(canReadBusinessMembers("OWNER"), true);
assert.equal(canReadBusinessMembers("ADMIN"), true);
assert.equal(canReadBusinessMembers("MEMBER"), true);
assert.equal(canReadBusinessMembers("VENTAS"), true);
assert.equal(canReadBusinessMembers("COMPRAS"), true);
assert.equal(canReadBusinessMembers("TECNICO"), true);
assert.equal(canReadBusinessMembers("FINANZAS"), true);
assert.equal(canReadBusinessMembers("UNKNOWN"), false);
assert.equal(canManageBusinessMembers("OWNER"), true);
assert.equal(canManageBusinessMembers("ADMIN"), true);
assert.equal(canManageBusinessMembers("MEMBER"), false);
console.log("OK miembros modelo: perfiles predefinidos y Colaborador son contratos reconocidos");

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
  profileId: "profile-1",
  perfilNombre: "Supervisor comercial",
  telefonoPersonal: "+56 9 1111 2222",
  numeroDocumento: "12.345.678-5",
});
assert.deepEqual(Object.keys(adapted).sort(), [
  "correo",
  "estado",
  "fechaIncorporacion",
  "nombre",
  "perfilNombre",
  "profileId",
  "rol",
  "uid",
]);
assert.equal(adapted.telefonoPersonal, undefined);
assert.equal(adapted.numeroDocumento, undefined);
assert.equal(businessMemberProfileLabel(adapted), "Supervisor comercial");
assert.equal(adaptBusinessMember({nombre: "Sin nombre registrado"}).nombre, "Nombre no informado");
assert.equal(adaptBusinessMember({nombre: ""}).nombre, "Nombre no informado");
console.log("OK miembros modelo: DTO mínimo y correo exacto normalizado");

const backendSource = fs.readFileSync("functions/businessMemberships.js", "utf8");
const rulesSource = fs.readFileSync("firestore.rules", "utf8");
const pageSource = fs.readFileSync("src/pages/EmployeesPage.jsx", "utf8");
const rbacSource = fs.readFileSync("src/domain/rbac.mjs", "utf8");
const navigationSource = fs.readFileSync("src/app/navigation.js", "utf8");
assert.match(backendSource, /getUserByEmail/);
assert.match(backendSource, /authUser\.disabled/);
assert.doesNotMatch(backendSource, /emailVerified/);
assert.match(backendSource, /roles: \["OWNER", "ADMIN"\]/);
assert.match(backendSource, /target\.rol === "OWNER"/);
assert.match(backendSource, /transaction\.create\(targetRef/);
assert.doesNotMatch(backendSource, /transaction\.delete/);
assert.match(
  rulesSource,
  /match \/membresias\/\{membershipId\}[\s\S]*allow create, update, delete: if false;/
);
assert.match(pageSource, /canManageBusinessMembers/);
assert.match(pageSource, /Perfiles y permisos/);
assert.match(pageSource, /Perfiles del sistema/);
assert.match(pageSource, /Perfiles personalizados/);
assert.match(pageSource, /Perfil protegido/);
assert.match(pageSource, /Acceso a módulos/);
assert.match(pageSource, /Seleccionar todos/);
assert.match(pageSource, /Limpiar/);
assert.match(pageSource, /profileForm\.modulos\.length/);
assert.match(rbacSource, /trabajos: "Proyectos y trabajos"/);
assert.doesNotMatch(pageSource, /Perfil estándar de ValoraCloud/);
assert.doesNotMatch(pageSource, /legacy/i);
assert.match(navigationSource, /to: "\/empleados"/);
console.log("OK miembros integración estática: backend autoritativo, Rules y UI responsive");

console.log("BUSINESS_MEMBERS_MODEL_SMOKE_OK");
