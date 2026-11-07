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
const invitationsSource = fs.readFileSync("functions/teamInvitations.js", "utf8");
// SPEC 032: el alta pasa por invitación; ya no hay búsqueda de cuentas por correo.
assert.doesNotMatch(backendSource, /getUserByEmail/);
assert.doesNotMatch(invitationsSource, /getUserByEmail/);
assert.doesNotMatch(backendSource, /asociarUsuarioExistente/);
assert.match(invitationsSource, /authUser\.disabled/);
assert.match(invitationsSource, /authUser\.emailVerified !== true/);
assert.match(invitationsSource, /roles: \["OWNER", "ADMIN"\]/);
assert.match(invitationsSource, /createMembershipForUser\(/);
assert.match(backendSource, /async function createMembershipForUser/);
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

// Empleados E1: tabla sin columna Correo, "Solo lectura" para el propietario y sin tabla vacía si falla la carga.
const cssSource = fs.readFileSync("src/features/employees/employees.css", "utf8");
assert.doesNotMatch(pageSource, /<th>Correo<\/th>/, "la tabla de miembros ya no tiene columna Correo");
assert.match(pageSource, /<th>Nombre<\/th><th>Perfil<\/th>/, "el correo se muestra bajo el nombre, no en columna propia");
assert.match(pageSource, /employees-person__email/, "el correo va como segunda línea bajo el nombre");
assert.match(pageSource, /email\.toLowerCase\(\) === memberName\(member\)\.toLowerCase\(\) \? "" : email/, "el correo no se repite cuando coincide con el nombre");
assert.match(pageSource, /member\.rol === "OWNER"\) return <span className="employees-readonly-label">Solo lectura<\/span>/, "el propietario muestra Solo lectura en Acciones");
assert.match(pageSource, /<SkeletonTable columns=\{canManage \? 5 : 4\} \/>/, "el esqueleto tiene una columna menos");
assert.match(pageSource, /loadError && members\.length === 0 \? null :/, "si falla la carga sin miembros no se dibuja la tabla");
assert.match(pageSource, /\{!loadError && <span className="employees-count">/, "con error de carga se oculta el contador");
for (const cssClass of ["employees-person__name", "employees-person__email", "employees-readonly-label"]) {
  assert.match(cssSource, new RegExp(`\\.${cssClass}\\b`), `employees.css define .${cssClass}`);
}
const e1Css = cssSource.slice(cssSource.indexOf(".employees-person__name"), cssSource.indexOf(".employees-actions {"));
assert.doesNotMatch(e1Css, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|\d+px/, "los estilos nuevos usan solo tokens");
console.log("OK Empleados E1: sin columna Correo, Solo lectura del propietario y error de carga sin tabla vacía");

// Empleados E2: cabecera ModuleHeader con "Invitar usuario" como acción, sin la fila flotante.
// La ruta (título, descripción, ícono y título propio) se comprueba sobre navigation.js; module-header-smoke la renderiza.
const employeesNav = navigationSource.match(/to: "\/empleados",[\s\S]*?\n      \},/)?.[0] || "";
assert.match(employeesNav, /title: "Empleados"/);
assert.match(employeesNav, /icon: UsersRound/, "la ruta trae ícono");
assert.match(employeesNav, /description: "[^"\n]{10,90}\."/, "la ruta trae una descripción corta");
assert.match(navigationSource, /PAGE_HEADING_ROUTES = Object\.freeze\([\s\S]*?"\/empleados",[\s\S]*?\]\)/, "la barra superior no repite el título (un solo h1)");
assert.match(pageSource, /const MODULE = getRouteMeta\("\/empleados"\);/, "ícono, título y descripción salen de navigation.js");
assert.equal((pageSource.match(/<ModuleHeader\b/g) || []).length, 2, "ModuleHeader con y sin permiso de lectura");
assert.match(pageSource, /icon=\{MODULE\.icon\}[\s\S]*?title=\{MODULE\.title\}/);
assert.doesNotMatch(pageSource, /erp-module-intro/, "ya no usa la fila alineada a la derecha");
assert.doesNotMatch(pageSource, /<h1\b/, "el h1 lo dibuja ModuleHeader");
assert.match(pageSource, /actions=\{canManage && tab === "employees" \? <Button[^\n]*>Invitar usuario<\/Button> : null\}/, "Invitar usuario va en la cabecera, solo con permiso de administrar y en la pestaña Empleados");
assert.equal((pageSource.match(/>Invitar usuario<\/Button>/g) || []).length, 1, "un solo botón Invitar usuario");
assert.match(pageSource, /role="tablist"/, "las pestañas siguen en la página");
assert.match(pageSource, /setTab\("profiles"\)/);
assert.match(pageSource, /className="employees-count">\{members\.length\}/, "se conserva el contador de personas");
assert.match(pageSource, /className="employees-notice">Puedes consultar esta sección/, "se conserva el aviso de solo consulta");
console.log("OK Empleados E2: ModuleHeader con Invitar usuario en la cabecera, ruta con título propio y pestañas, contador y aviso conservados");

console.log("BUSINESS_MEMBERS_MODEL_SMOKE_OK");
