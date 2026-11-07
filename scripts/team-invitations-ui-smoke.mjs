import assert from "node:assert/strict";
import {readFile, readdir} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";

// SPEC 032, sección 7: interfaz de invitaciones de equipo. Sin Firebase ni
// emuladores: modelo puro, aserciones estáticas sobre las fuentes y render de
// los componentes presentacionales con Vite ssrLoadModule.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

async function walk(dir) {
  const entries = await readdir(dir, {withFileTypes: true});
  const files = await Promise.all(entries.map((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  }));
  return files.flat();
}

const [employees, waiting, onboarding, bellSource, memberService, invitationService, hookSource, layout] = await Promise.all([
  read("src/pages/EmployeesPage.jsx"),
  read("src/features/auth/BusinessWaitingPage.jsx"),
  read("src/pages/OnboardingPage.jsx"),
  read("src/components/NotificationBell.jsx"),
  read("src/services/businessMemberService.js"),
  read("src/services/teamInvitationService.js"),
  read("src/hooks/useMyInvitations.js"),
  read("src/layout/AppLayout.jsx"),
]);

// --- Fuentes: nada de la acción directa ni del código de acceso ---
const sourceFiles = (await walk(path.join(root, "src"))).filter((file) => /\.(jsx?|mjs|css)$/.test(file));
for (const file of sourceFiles) {
  const source = await readFile(file, "utf8");
  const name = path.relative(root, file);
  assert.doesNotMatch(source, /asociarUsuarioExistente/, `${name}: asociarUsuarioExistente ya no existe`);
  assert.doesNotMatch(source, /código de acceso|codigo de acceso|access-code|auth-wait-code|auth-wait__code/i, `${name}: sin mención de código de acceso`);
}
console.log("OK src/: sin asociarUsuarioExistente ni código de acceso");

// --- Servicio ---
assert.doesNotMatch(memberService, /asociarUsuarioExistente|normalizeBusinessMemberEmail/);
for (const name of ["invitarMiembroNegocio", "listarInvitacionesNegocio", "revocarInvitacionNegocio", "listarMisInvitaciones", "responderInvitacion"]) {
  assert.match(invitationService, new RegExp(`httpsCallable|"${name}"`));
  assert.match(invitationService, new RegExp(`call\\(\\s*"${name}"`), `el servicio llama a ${name}`);
}
assert.match(invitationService, /export function createRequestId\(\)/);
assert.match(invitationService, /requestId: requestId \|\| createRequestId\(\)/);
console.log("OK servicio: las cinco Functions con requestId");

// --- Empleados ---
const employeesCode = stripComments(employees);
assert.doesNotMatch(employeesCode, /Agregar usuario|Agregando|ya existe|existente/, "el diálogo ya no habla de agregar una cuenta existente");
assert.match(employeesCode, />Invitar usuario<\/Button>/, "el botón pasa a Invitar usuario");
assert.match(employeesCode, /title="Invitar usuario"/);
assert.match(employeesCode, /invitarMiembroNegocio\(businessId/);
assert.match(employeesCode, /setFeedback\(\{text: INVITATION_SENT_MESSAGE/, "al enviar se muestra el texto neutro");
assert.match(employeesCode, /setEmailError\(cleanError\(error, "No pudimos enviar la invitación\."\)\)/, "el error del servidor se muestra tal cual");
assert.match(employeesCode, /getWorkMemberIdentity/, "la identidad del miembro es la compartida con Proyectos y trabajos");
assert.doesNotMatch(employeesCode, /\$\{member\.nombre\}|\{member\.nombre\}/, "ninguna pantalla muestra member.nombre directo");
assert.match(employeesCode, /<TeamInvitationsPanel\b/);
console.log("OK Empleados: Invitar usuario, mensaje neutro, errores tal cual e identidad compartida");

// --- Centro de notificaciones, espera y onboarding ---
assert.match(bellSource, /useMyInvitations\(/);
assert.match(bellSource, /respond\(invitation, "aceptar"\)/, "el centro acepta");
assert.match(bellSource, /respond\(invitation, "rechazar", reason\)/, "el centro rechaza");
assert.match(waiting, /respond\(invitation, "aceptar"\)/, "la espera acepta");
assert.match(waiting, /respond\(invitation, "rechazar", reason\)/, "la espera rechaza");
assert.match(waiting, /reloadInvitations\(\{ silent: true \}\)/, "la consulta periódica pide también las invitaciones");
assert.match(onboarding, /Tienes[\s\S]*pendiente/, "el onboarding avisa de las invitaciones pendientes");
assert.match(onboarding, /Ver invitaciones/);
assert.match(hookSource, /onAcceptedRef\.current\?\.\(result, invitation\)/, "al aceptar se recarga la sesión");
assert.match(hookSource, /result\?\.mensaje/, "si la respuesta trae mensaje, se muestra");
assert.match(layout, /handleInvitationAccepted/, "el centro entra a la empresa tras aceptar");
console.log("OK Centro, espera y onboarding: aceptar y rechazar, aviso y recarga de sesión");

const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
try {
  const model = await vite.ssrLoadModule("/src/domain/teamInvitationModel.mjs");
  const {default: InvitationsInbox} = await vite.ssrLoadModule("/src/components/InvitationsInbox.jsx");
  const {default: NotificationBellView} = await vite.ssrLoadModule("/src/components/NotificationBellView.jsx");
  const {SUBSCRIPTION_STATUS} = await vite.ssrLoadModule("/src/domain/subscriptionStatus.mjs");
  const {default: TeamInvitationsPanel} = await vite.ssrLoadModule("/src/features/employees/TeamInvitationsPanel.jsx");

  // Modelo puro
  assert.equal(model.INVITATION_SENT_MESSAGE, "Si esa persona usa ValoraCloud, recibirá la invitación.");
  assert.equal(model.MAX_INVITATION_REJECTION_REASON_LENGTH, 500);
  assert.equal(model.trimInvitationReason("a".repeat(900)).length, 500);
  const mine = model.adaptMyInvitation({id: "n1__abc", negocioId: "n1", negocioNombre: "Bagner", rol: "tecnico", perfilNombre: "", invitadoPor: "Bruno", expiraEn: "2026-10-26T12:00:00.000Z"});
  assert.equal(model.invitationHeadline(mine), "Bagner te invita a unirte como Técnico");
  assert.equal(model.invitationHeadline(model.adaptMyInvitation({id: "x", negocioNombre: "Bagner", rol: "MEMBER", perfilNombre: "Coordinación"})), "Bagner te invita a unirte como Coordinación", "el perfil personalizado manda sobre el rol");
  const response = model.adaptMyInvitationsResponse({invitaciones: [{id: "a", negocioNombre: "A", rol: "VENTAS"}, {negocioNombre: "sin id"}], requiereVerificacion: true});
  assert.equal(response.invitations.length, 1);
  assert.equal(response.requiresVerification, true);
  assert.deepEqual(model.adaptMyInvitationsResponse(undefined), {invitations: [], requiresVerification: false});
  const groups = model.groupBusinessInvitations(["pendiente", "rechazada", "vencida", "pendiente"].map((estado, index) => model.adaptBusinessInvitation({id: String(index), correo: `${index}@x.cl`, rol: "VENTAS", estado})));
  assert.deepEqual([groups.pendiente.length, groups.rechazada.length, groups.vencida.length], [2, 1, 1]);
  console.log("OK modelo: titular, perfil sobre rol, tope de 500 y agrupación");

  const status = (markup) => (markup.match(/role="(status|alert)"/g) || []).length;
  const clean = (markup, name) => assert.doesNotMatch(markup, /undefined|NaN|Infinity/, `${name}: markup limpio`);
  const base = {busyId: "", feedback: {text: "", error: false}, invitations: [], onAccept() {}, onReject() {}, onRetry() {}, requiresVerification: false, status: "ready"};
  const html = (props) => renderToStaticMarkup(React.createElement(InvitationsInbox, {...base, ...props}));

  // Estados separados de la lista: cargando, error, correo sin verificar, vacío, datos
  const loading = html({status: "loading"});
  assert.match(loading, /ui-skeleton-cards/);
  assert.equal(status(loading), 1, "cargando: un solo role=status");
  const failed = html({status: "error"});
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Reintentar/);
  assert.doesNotMatch(failed, /ui-skeleton/, "error: sin skeleton colgado");
  const verify = html({requiresVerification: true});
  assert.match(verify, /Verifica tu correo para ver y responder tus invitaciones\./);
  assert.doesNotMatch(verify, /Aceptar/);
  const empty = html({});
  assert.match(empty, /No tienes invitaciones pendientes\./);
  assert.equal(status(empty), 0, "vacío real: sin role ni skeleton");
  assert.doesNotMatch(empty, /ui-skeleton/);
  const data = html({invitations: [mine]});
  clean(data, "datos");
  assert.match(data, /Bagner te invita a unirte como Técnico/);
  assert.match(data, />Aceptar</);
  assert.match(data, />Rechazar</);
  assert.match(data, /Te invita Bruno\./);
  const answered = html({invitations: [mine], feedback: {text: "Ya tienes acceso a esa empresa.", error: false}});
  assert.match(answered, /role="status"[^>]*>Ya tienes acceso a esa empresa\./);
  const rejected = html({invitations: [], feedback: {text: "No pudimos responder la invitación.", error: true}});
  assert.match(rejected, /role="alert"[^>]*>No pudimos responder la invitación\./);
  console.log("OK lista: cargando, error, sin verificar, vacío y datos por separado");

  // Centro de notificaciones con invitaciones
  const bell = (props) => renderToStaticMarkup(React.createElement(NotificationBellView, {
    markRead() {}, onClose() {}, onOpen() {}, open: true, retry() {},
    notifications: [], subscription: {status: SUBSCRIPTION_STATUS.READY, synced: true}, unreadCount: 0, ...props,
  }));
  const asAdmin = bell({showNotifications: false, invitations: {...base, invitations: [mine]}});
  assert.match(asAdmin, /Bagner te invita a unirte como Técnico/);
  assert.match(asAdmin, />Aceptar</);
  assert.match(asAdmin, />Rechazar</);
  assert.match(asAdmin, /aria-label="Notificaciones, 1 sin leer"/, "las invitaciones cuentan en el badge");
  assert.doesNotMatch(asAdmin, /Sin notificaciones/, "sin permiso para avisos, no se dibuja esa sección");
  // Sin invitaciones, verificado y terminó de cargar: la sección no se dibuja en el centro
  // (el texto "No tienes invitaciones pendientes." sigue en la lista de espera y onboarding).
  const asOwner = bell({invitations: {...base, invitations: []}});
  assert.doesNotMatch(asOwner, /No tienes invitaciones pendientes\./, "el centro no dibuja la sección vacía");
  assert.doesNotMatch(asOwner, /notification-invitations-title/);
  assert.match(asOwner, /Sin notificaciones/, "los avisos conservan su vacío propio");
  // ADMIN sin invitaciones, correo verificado y no cargando: sin avisos ni invitaciones que dibujar,
  // el cuerpo muestra el texto discreto (no queda vacío ni vuelve el texto de invitaciones).
  const adminEmpty = bell({showNotifications: false, invitations: {...base, invitations: []}});
  assert.match(adminEmpty, /class="notification-empty">Sin notificaciones</, "ADMIN sin invitaciones: texto discreto");
  assert.doesNotMatch(adminEmpty, /No tienes invitaciones pendientes\.|notification-section|erp-empty-state/);
  assert.doesNotMatch(bell({showNotifications: false, invitations: {...base, status: "loading"}}), /Sin notificaciones/, "ADMIN cargando: se ve el skeleton de invitaciones, no el vacío");
  assert.doesNotMatch(bell({showNotifications: false, invitations: {...base, invitations: [mine]}}), /Sin notificaciones/, "ADMIN con invitaciones: se ven las invitaciones");
  const unverified = bell({invitations: {...base, requiresVerification: true}, verification: {cooldownLeft: 0, feedback: "", onResend() {}, resending: false}});
  assert.match(unverified, /ui-notice--info/, "correo sin verificar: aviso informativo");
  assert.match(unverified, /Verifica tu correo para ver y responder tus invitaciones\./);
  assert.match(unverified, />Reenviar correo</);
  assert.doesNotMatch(unverified, /erp-empty-state[^>]*>Verifica/, "ya no es una caja punteada");
  assert.doesNotMatch(unverified, />Aceptar</);
  const loadingSection = bell({invitations: {...base, status: "loading"}});
  assert.match(loadingSection, /Invitaciones/, "cargando: la sección sigue visible");
  const failedSection = bell({invitations: {...base, status: "error"}});
  assert.match(failedSection, /No se pudieron cargar las invitaciones\./, "error: la sección sigue visible");
  const bothLoading = bell({subscription: {status: SUBSCRIPTION_STATUS.ERROR, synced: false}, invitations: {...base, status: "loading"}});
  assert.match(bothLoading, /ui-skeleton-cards/, "la carga de invitaciones es independiente del error de avisos");
  assert.match(bothLoading, /No se pudieron cargar las notificaciones\./);
  console.log("OK centro: invitaciones con Aceptar/Rechazar, badge y estados independientes de los avisos");

  // Panel de Empleados
  const invite = (estado, extra = {}) => model.adaptBusinessInvitation({id: `n__${estado}`, correo: `${estado}@x.cl`, rol: "VENTAS", estado, expiraEn: "2026-10-26T12:00:00.000Z", respondidoEn: "2026-10-20T12:00:00.000Z", ...extra});
  const panelProps = {status: "ready", busyId: "", onRevoke() {}, onReinvite() {}, onRetry() {}};
  const panel = renderToStaticMarkup(React.createElement(TeamInvitationsPanel, {...panelProps, groups: model.groupBusinessInvitations([invite("pendiente"), invite("rechazada", {motivoRechazo: "No me interesa"}), invite("vencida")])}));
  clean(panel, "panel");
  assert.match(panel, />Revocar</);
  assert.match(panel, />Volver a invitar</);
  assert.match(panel, /Vence el /);
  assert.match(panel, /Motivo: No me interesa/);
  assert.match(panel, /Rechazada el /);
  assert.match(panel, /Venció el /);
  assert.match(renderToStaticMarkup(React.createElement(TeamInvitationsPanel, {...panelProps, groups: model.groupBusinessInvitations([invite("rechazada")])})), /Sin motivo indicado\./);
  assert.match(renderToStaticMarkup(React.createElement(TeamInvitationsPanel, {...panelProps, groups: model.groupBusinessInvitations([])})), /Aún no hay invitaciones/);
  assert.match(renderToStaticMarkup(React.createElement(TeamInvitationsPanel, {...panelProps, status: "error", groups: model.groupBusinessInvitations([])})), /role="alert"/);
  assert.match(renderToStaticMarkup(React.createElement(TeamInvitationsPanel, {...panelProps, status: "loading", groups: model.groupBusinessInvitations([])})), /role="status"/);
  console.log("OK Empleados: pendientes con Revocar, rechazadas con motivo y vencidas con Volver a invitar");

  // Empleados E5: tabla compacta de invitaciones (sin tarjetas), estado con su color y perfil neutro.
  const render = (props) => renderToStaticMarkup(React.createElement(TeamInvitationsPanel, {...panelProps, ...props}));
  const tablePanel = render({groups: model.groupBusinessInvitations([invite("vencida"), invite("pendiente"), invite("rechazada", {motivoRechazo: "No me interesa"})])});
  assert.equal((tablePanel.match(/<table\b/g) || []).length, 1, "una sola tabla de invitaciones");
  assert.match(tablePanel, /<th>Correo<\/th><th>Perfil<\/th><th>Estado<\/th><th>Vence \/ Fecha<\/th><th class="clients-actions-column">Acciones<\/th>/, "columnas Correo, Perfil, Estado, Vence / Fecha y Acciones");
  assert.equal((tablePanel.match(/<tr>(?:<td)/g) || []).length, 3, "una fila por invitación");
  assert.doesNotMatch(tablePanel, /<ul\b|<li\b|<article|class="employees-invitation"|employees-invitations__/, "sin lista ni tarjetas");
  assert.doesNotMatch(tablePanel, /<h3\b/, "sin subtítulos por grupo");
  assert.equal((tablePanel.match(/<h2\b/g) || []).length, 1, "un solo encabezado de sección");
  assert.ok(tablePanel.indexOf("Pendiente</span>") < tablePanel.indexOf("Rechazada</span>") && tablePanel.indexOf("Rechazada</span>") < tablePanel.indexOf("Vencida</span>"), "orden: pendientes, rechazadas y vencidas");
  assert.match(tablePanel, /ui-status-badge--warning">Pendiente</, "pendiente en advertencia");
  assert.match(tablePanel, /ui-status-badge--danger">Rechazada</, "rechazada en peligro");
  assert.match(tablePanel, /ui-status-badge--neutral">Vencida</, "vencida en neutro");
  assert.match(tablePanel, /ui-status-badge--neutral">Ventas</, "el perfil va en insignia neutra, sin el color del estado");
  assert.doesNotMatch(tablePanel, /ui-status-badge--(warning|danger)">Ventas</, "el perfil nunca toma el color del estado");
  assert.match(tablePanel, /class="client-row-actions__labeled"[^>]*aria-label="Revocar pendiente@x\.cl"[^>]*><svg[\s\S]*?<\/svg>Revocar<\/button>/, "Revocar con ícono, texto visible y nombre accesible");
  assert.match(tablePanel, /aria-label="Volver a invitar vencida@x\.cl"[^>]*><svg[\s\S]*?<\/svg>Volver a invitar<\/button>/, "Volver a invitar con ícono y texto visible");
  assert.equal((tablePanel.match(/client-row-actions__labeled/g) || []).length, 2, "acciones solo en pendientes (Revocar) y vencidas (Volver a invitar)");
  const busyPanel = render({busyId: "n__pendiente", groups: model.groupBusinessInvitations([invite("pendiente"), invite("vencida")])});
  assert.equal((busyPanel.match(/ aria-busy="true"/g) || []).length, 1, "solo la fila en proceso se marca ocupada");
  assert.equal((busyPanel.match(/disabled=""/g) || []).length, 2, "mientras una acción corre, las demás se desactivan (igual que antes)");
  const emptyPanel = render({groups: model.groupBusinessInvitations([])});
  assert.match(emptyPanel, /<p class="employees-profile-empty">Aún no hay invitaciones enviadas\.<\/p>/, "vacío en una sola línea");
  assert.doesNotMatch(emptyPanel, /<table|ui-skeleton|role="alert"/, "vacío real: sin tabla, esqueleto ni error");
  const errorPanel = render({status: "error", groups: model.groupBusinessInvitations([invite("pendiente")])});
  assert.match(errorPanel, /No pudimos cargar las invitaciones\.[\s\S]*Reintentar/, "error con Reintentar");
  assert.doesNotMatch(errorPanel, /Aún no hay invitaciones|<table|ui-skeleton/, "error: ni falso vacío ni tabla ni esqueleto");
  const loadingPanel = render({status: "loading", groups: model.groupBusinessInvitations([])});
  assert.equal((loadingPanel.match(/role="status"/g) || []).length, 1, "carga: un solo role=status");
  assert.match(loadingPanel, /ui-skeleton-table/, "carga: esqueleto con forma de tabla");
  assert.doesNotMatch(loadingPanel, /Aún no hay invitaciones/, "carga: sin falso vacío");
  const panelSource = await read("src/features/employees/TeamInvitationsPanel.jsx");
  assert.doesNotMatch(panelSource, /title: "(Pendientes|Rechazadas|Vencidas)"/, "los títulos de grupo ya no existen");
  assert.equal((panelSource.match(/badgeLabel/g) || []).length >= 4, true, "badgeLabel se usa en la insignia de Estado");
  console.log("OK Empleados E5: tabla compacta, estado con color, perfil neutro, acciones con texto, vacío/error/carga sin falso vacío");

  // Diálogo de rechazo (usa un portal: se verifica la fuente)
  const reject = await read("src/components/RejectInvitationDialog.jsx");
  assert.match(reject, /maxLength=\{MAX_INVITATION_REJECTION_REASON_LENGTH\}/);
  assert.match(reject, /Motivo \(opcional\)/);
  assert.match(reject, /onSubmit\(reason\.trim\(\)\)/);
  console.log("OK diálogo de rechazo: motivo opcional de hasta 500 caracteres");
} finally {
  await vite.close();
}

console.log("TEAM_INVITATIONS_UI_SMOKE_OK");
