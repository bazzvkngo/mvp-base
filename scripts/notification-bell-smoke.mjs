import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

// ETAPA 4 (centro de notificaciones), SESIÓN 2: campana + panel
// (src/components/NotificationBell.jsx, NotificationBellView.jsx,
// hooks/useNotifications.js). Sin Firebase: se prueba vía Vite
// ssrLoadModule + renderToStaticMarkup, mismo patrón que skeleton-smoke/
// button-smoke/loading-screen-smoke. Por eso la vista vive en su propio
// archivo (NotificationBellView.jsx): NotificationBell.jsx importa el
// hook, que importa notificationService.js, que importa firebaseConfig
// y no se puede cargar aquí (mismo motivo que ya documenta
// loading-screen-smoke para separar LoadingScreen de App.jsx).
//
// "No llama a subscribeToNotifications" no se puede observar
// renderizando: renderToStaticMarkup nunca ejecuta useEffect, así que la
// suscripción real (dentro de un efecto) no se dispara ni para OWNER ni
// para no-OWNER en este entorno. Se verifica en cambio la cadena de
// guards en el código fuente: NotificationBell.jsx blanquea businessId
// si el rol no es OWNER, y useNotifications.js corta antes de llamar a
// subscribeToNotifications si businessId es falsy — la misma garantía
// que ya usa useFinancialMovements/DashboardPage.

const assertClean = (markup, name) =>
  assert.doesNotMatch(
    markup,
    /undefined|NaN|Infinity|<!--/,
    `${name}: markup sin undefined/NaN/Infinity/comentarios`
  );
const countRole = (markup, role) =>
  (markup.match(new RegExp(`role="${role}"`, "g")) || []).length;
const assertSingleStatusRole = (markup, name) => {
  const total = countRole(markup, "status") + countRole(markup, "alert");
  assert.ok(
    total <= 1,
    `${name}: a lo sumo un role="status" o role="alert", sin anidar (encontrados: ${total})`
  );
};

// --- Guard de rol: fuente, sin depender de que un efecto se ejecute ---
const stripLineComments = (source) => source.replace(/\/\/.*$/gm, "");
const bellSource = stripLineComments(
  await readFile(
    new URL("../src/components/NotificationBell.jsx", import.meta.url),
    "utf8"
  )
);
const hookSource = stripLineComments(
  await readFile(
    new URL("../src/hooks/useNotifications.js", import.meta.url),
    "utf8"
  )
);
assert.match(
  bellSource,
  /useNotifications\(canSeeNotifications \? businessId : ""\)/,
  "NotificationBell: pasa businessId vacío al hook si el rol no es OWNER"
);
// SPEC 032: la campana la ven todos los roles (las invitaciones llegan por la
// Function listarMisInvitaciones). Para quien no es OWNER solo se oculta la
// sección de avisos y no se pide la suscripción.
assert.doesNotMatch(bellSource, /if \(!canSeeNotifications\) return null;/, "NotificationBell: ya no se oculta para quien no es OWNER");
assert.match(bellSource, /showNotifications=\{canSeeNotifications\}/, "NotificationBell: la sección de avisos depende del rol");
assert.match(bellSource, /useMyInvitations\(/, "NotificationBell: las invitaciones salen del hook de la Function");
const guardIndex = hookSource.indexOf("if (!businessId) return undefined;");
const subscribeIndex = hookSource.indexOf("subscribeToNotifications(");
assert.ok(guardIndex >= 0 && subscribeIndex > guardIndex,
  "useNotifications: el guard de businessId vacío corta antes de llamar a subscribeToNotifications");
// Consulta: debe coincidir con la regla de lectura (resource.data.negocioId ==
// businessId). Sin where("negocioId") Firestore responde permission-denied.
// La prueba con emuladores está en notification-rules-smoke.mjs.
const serviceSource = stripLineComments(
  await readFile(
    new URL("../src/services/notificationService.js", import.meta.url),
    "utf8"
  )
);
assert.match(
  serviceSource,
  /query\(\s*notificationsCollectionRef\(businessId\),\s*where\("negocioId", "==", businessId\),\s*orderBy\("creadoEn", "desc"\)\s*\)/,
  "notificationService: la consulta filtra por negocioId y ordena por creadoEn"
);
const indexes = JSON.parse(
  await readFile(new URL("../firestore.indexes.json", import.meta.url), "utf8")
);
assert.ok(
  indexes.indexes.some(
    (index) =>
      index.collectionGroup === "notificaciones" &&
      index.queryScope === "COLLECTION" &&
      JSON.stringify(index.fields) ===
        JSON.stringify([
          { fieldPath: "negocioId", order: "ASCENDING" },
          { fieldPath: "creadoEn", order: "DESCENDING" },
        ])
  ),
  "firestore.indexes.json: índice compuesto notificaciones (negocioId ASC, creadoEn DESC)"
);
console.log("OK consulta: where(negocioId) + orderBy(creadoEn) con su índice compuesto");

console.log("OK guard de rol: businessId se blanquea y el hook corta antes de suscribirse, verificado en la fuente");

const vite = await createServer({
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  const {
    default: NotificationBellView,
    canViewBusinessNotifications,
    formatBadgeCount,
    notificationIcon,
    shouldShowInvitations,
  } = await vite.ssrLoadModule("/src/components/NotificationBellView.jsx");
  const { formatRelativeTimestamp } = await vite.ssrLoadModule("/src/utils/formatters.js");
  const { SUBSCRIPTION_STATUS } = await vite.ssrLoadModule(
    "/src/domain/subscriptionStatus.mjs"
  );

  // --- canViewBusinessNotifications: puro, sin permiso nuevo ---
  assert.equal(canViewBusinessNotifications("OWNER"), true);
  assert.equal(canViewBusinessNotifications("owner"), true, "insensible a mayúsculas, como normalizeBusinessRole");
  assert.equal(canViewBusinessNotifications(" OWNER "), true, "tolera espacios");
  assert.equal(canViewBusinessNotifications("ADMIN"), false);
  assert.equal(canViewBusinessNotifications("MEMBER"), false);
  assert.equal(canViewBusinessNotifications(""), false);
  assert.equal(canViewBusinessNotifications(undefined), false);
  console.log("OK canViewBusinessNotifications: solo OWNER, sin permiso nuevo");

  // --- formatBadgeCount: 0, alto (99+) y conteo real ---
  assert.equal(formatBadgeCount(0), "0");
  assert.equal(formatBadgeCount(3), "3");
  assert.equal(formatBadgeCount(99), "99");
  assert.equal(formatBadgeCount(100), "99+");
  assert.equal(formatBadgeCount(150), "99+");
  console.log("OK formatBadgeCount: 0, conteo real y tope 99+");

  const baseProps = {
    markRead: () => {},
    onClose: () => {},
    onOpen: () => {},
    open: true,
    retry: () => {},
  };
  const html = (props) =>
    renderToStaticMarkup(React.createElement(NotificationBellView, { ...baseProps, ...props }));

  // --- Badge en el trigger: ausente con 0, "3" con conteo real, "99+" con uno alto ---
  const zeroUnread = html({ notifications: [], subscription: { status: SUBSCRIPTION_STATUS.READY, synced: true }, unreadCount: 0 });
  assertClean(zeroUnread, "0 no leídas");
  assert.doesNotMatch(zeroUnread, /ui-badge-count/, "0 no leídas: sin badge en el DOM, no solo oculto");
  assert.match(zeroUnread, /aria-label="Notificaciones"/, "0 no leídas: aria-label sin conteo");

  const realUnread = html({ notifications: [], subscription: { status: SUBSCRIPTION_STATUS.READY, synced: true }, unreadCount: 3 });
  assertClean(realUnread, "3 no leídas");
  assert.match(realUnread, /class="ui-badge-count topbar-notifications-button__badge"[^>]*>3</, "3 no leídas: badge muestra el conteo real");
  assert.match(realUnread, /aria-label="Notificaciones, 3 sin leer"/);

  const highUnread = html({ notifications: [], subscription: { status: SUBSCRIPTION_STATUS.READY, synced: true }, unreadCount: 150 });
  assertClean(highUnread, "150 no leídas");
  assert.match(highUnread, />99\+</, "150 no leídas: badge topea en 99+, no desborda el ícono");
  console.log("OK badge: ausente en 0, conteo real, tope 99+ con un número alto");

  // --- Estados de subscriptionStatus: uno solo role=status/alert, sin anidar ---
  const loading = html({ notifications: [], subscription: { status: SUBSCRIPTION_STATUS.LOADING, synced: false }, unreadCount: 0 });
  assertClean(loading, "loading");
  assertSingleStatusRole(loading, "loading");
  assert.match(loading, /role="status"/, "loading: SkeletonRegion anuncia con role=status");
  assert.match(loading, /class="ui-skeleton-cards"/, "loading: usa SkeletonCards, no SkeletonTable");
  assert.doesNotMatch(loading, /role="alert"/, "loading: nunca alert");

  const slow = html({ notifications: [], subscription: { status: SUBSCRIPTION_STATUS.SLOW, synced: false }, unreadCount: 0 });
  assertClean(slow, "slow");
  assertSingleStatusRole(slow, "slow");
  assert.match(slow, /role="status"/, "slow: status, no alert (no es un error confirmado)");
  assert.match(slow, /client-message--warning/);
  assert.match(slow, /Reintentar/);

  const error = html({ notifications: [], subscription: { status: SUBSCRIPTION_STATUS.ERROR, synced: false }, unreadCount: 0 });
  assertClean(error, "error");
  assertSingleStatusRole(error, "error");
  assert.match(error, /role="alert"/, "error: alert, más urgente que slow");
  assert.match(error, /client-message--error/);
  assert.match(error, /Reintentar/);

  // Error: el contador no queda en cero en silencio. Marca "!" y avisa en la etiqueta.
  assert.match(error, /class="ui-badge-count topbar-notifications-button__badge"[^>]*>!</, "error: badge '!' en lugar de ocultarse");
  assert.match(error, /aria-label="Notificaciones, no se pudieron cargar los avisos"/, "error: la etiqueta del botón avisa del fallo");
  assert.match(error, /No se pudieron cargar las notificaciones\./, "error: mensaje claro en el panel");
  assert.doesNotMatch(error, /Sin notificaciones/, "error: no se muestra el vacío engañoso");
  assert.doesNotMatch(error, /notification-list/, "error: sin lista");
  // Un error no cambia los estados sanos: sin error, 0 sigue sin badge (ya probado arriba).
  // Quien no puede leer avisos (no OWNER) nunca suscribe, así que no ve el "!".
  const errorHidden = html({ notifications: [], showNotifications: false, subscription: { status: SUBSCRIPTION_STATUS.ERROR, synced: false }, unreadCount: 0 });
  assert.doesNotMatch(errorHidden, /ui-badge-count/, "sin permiso de avisos: no hay badge de error");
  // Las invitaciones siguen su propio camino: con error en avisos, el conteo
  // de invitaciones sigue en la etiqueta y su sección se dibuja intacta.
  const errorWithInvitations = html({
    notifications: [],
    subscription: { status: SUBSCRIPTION_STATUS.ERROR, synced: false },
    unreadCount: 0,
    invitations: {
      busyId: "",
      feedback: { text: "", error: false },
      invitations: [],
      onAccept: () => {},
      onClearFeedback: () => {},
      onReject: () => {},
      onRetry: () => {},
      requiresVerification: false,
      status: "ready",
    },
  });
  // Invitaciones terminadas bien, sin ninguna y con el correo verificado: la sección
  // no se dibuja (ni título ni texto de vacío). El error de avisos no la devuelve.
  assert.doesNotMatch(errorWithInvitations, /No tienes invitaciones pendientes\./, "sin invitaciones: no se dibuja la sección");
  assert.doesNotMatch(errorWithInvitations, /notification-invitations-title/, "sin invitaciones: sin título Invitaciones");
  assert.doesNotMatch(errorWithInvitations, />Avisos</, "sin sección Invitaciones: el título del modal basta, sin h3 Avisos");
  assert.match(errorWithInvitations, /No se pudieron cargar las notificaciones\./);

  const empty = html({ notifications: [], subscription: { status: SUBSCRIPTION_STATUS.READY, synced: true }, unreadCount: 0 });
  assertClean(empty, "vacío");
  assertSingleStatusRole(empty, "vacío");
  assert.doesNotMatch(empty, /role="status"|role="alert"/, "vacío real: no es un estado de carga ni de error, sin role propio");
  assert.match(empty, /class="notification-empty">Sin notificaciones</, "vacío: texto discreto con clase propia del panel, sin skeleton colgado");
  assert.doesNotMatch(empty, /erp-empty-state/, "vacío: sin la caja punteada");
  assert.doesNotMatch(empty, /responsive-dialog__eyebrow|ValoraCloud/, "el panel ya no lleva pretítulo");
  console.log("OK estados: loading/slow/error/vacío con un solo role=status o alert, nunca anidados");

  // --- Con datos reales: leídas y no leídas ---
  const withData = html({
    notifications: [
      { id: "n1", tipo: "VERIFICACION_APROBADA", titulo: "Empresa verificada", descripcion: "Los módulos operativos ya están disponibles.", leida: false, creadoEn: new Date(Date.now() - 5 * 60 * 1000 - 5000) },
      { id: "n2", tipo: "VERIFICACION_RECHAZADA", titulo: "Verificación rechazada", descripcion: "Documentación insuficiente.", leida: true, creadoEn: new Date("2026-01-04T09:00:00") },
      { id: "n3", tipo: "TIPO_FUTURO", titulo: "Aviso de un tipo nuevo", leida: true, creadoEn: new Date("2026-01-03T09:00:00") },
    ],
    subscription: { status: SUBSCRIPTION_STATUS.READY, synced: true },
    unreadCount: 1,
  });
  assertClean(withData, "con datos");
  assertSingleStatusRole(withData, "con datos");
  assert.match(withData, /notification-list__item is-unread/, "no leída: clase is-unread");
  assert.equal(
    (withData.match(/is-unread/g) || []).length,
    1,
    "solo la notificación no leída lleva is-unread"
  );
  assert.match(withData, /Empresa verificada/);
  assert.match(withData, /Verificación rechazada/);
  assert.doesNotMatch(withData, /erp-empty-state|notification-empty/, "con datos: no muestra el vacío");

  // Icono por tipo: ShieldCheck / ShieldAlert / Bell de respaldo; siempre decorativo.
  const iconOf = (id) => {
    const item = withData.split("<li").find((chunk) => chunk.includes(id)) || "";
    return (item.match(/notification-list__icon"><svg[^>]*class="([^"]*)"[^>]*>/) || [])[0] || "";
  };
  assert.match(iconOf("Empresa verificada"), /lucide-shield-check/, "aprobada: ShieldCheck");
  assert.match(iconOf("Verificación rechazada"), /lucide-shield-alert/, "rechazada: ShieldAlert");
  assert.match(iconOf("Aviso de un tipo nuevo"), /lucide-bell/, "tipo desconocido: Bell de respaldo");
  assert.equal((withData.match(/notification-list__icon"><svg[^>]*aria-hidden="true"/g) || []).length, 3, "los tres iconos son decorativos (aria-hidden)");
  assert.equal(notificationIcon(undefined).displayName, notificationIcon("OTRO").displayName, "sin tipo: mismo respaldo");

  // No leída: punto decorativo + texto para lectores de pantalla, solo en la no leída.
  assert.equal((withData.match(/notification-list__dot" aria-hidden="true"/g) || []).length, 1, "un solo punto de no leído");
  assert.equal((withData.match(/class="sr-only">No leída</g) || []).length, 1, "el estado no leído también va en texto");

  // Fecha: relativa y con la fecha completa en title; las viejas caen a fecha.
  assert.match(withData, /<small title="[^"]+">hace 5 minutos<\/small>/, "fecha relativa con title de fecha completa");
  assert.match(withData, /<small title="[^"]+">\d{2}[-/]\d{2}[-/]\d{4}<\/small>/, "pasados 7 días: fecha completa");
  console.log("OK con datos: leídas/no leídas, icono por tipo, punto y fecha relativa");

  // --- Sección Invitaciones: solo si hay algo que mostrar ---
  const inv = (extra) => ({
    busyId: "", feedback: { text: "", error: false }, invitations: [], onAccept: () => {},
    onClearFeedback: () => {}, onReject: () => {}, onRetry: () => {}, requiresVerification: false,
    status: "ready", ...extra,
  });
  const ready = { status: SUBSCRIPTION_STATUS.READY, synced: true };
  assert.equal(shouldShowInvitations(null), false);
  assert.equal(shouldShowInvitations(inv({})), false, "terminó bien, sin invitaciones y verificado: oculta");
  assert.equal(shouldShowInvitations(inv({ status: "loading" })), true, "cargando: visible");
  assert.equal(shouldShowInvitations(inv({ status: "error" })), true, "error: visible");
  assert.equal(shouldShowInvitations(inv({ requiresVerification: true })), true, "correo sin verificar: visible");
  assert.equal(shouldShowInvitations(inv({ invitations: [{ id: "x" }] })), true, "con invitaciones: visible");

  const hiddenSection = html({ notifications: [], subscription: ready, unreadCount: 0, invitations: inv({}) });
  assert.doesNotMatch(hiddenSection, /Invitaciones|notification-invitations-title/, "oculta: ni título ni texto");
  assert.match(hiddenSection, /Sin notificaciones/);
  assert.equal((hiddenSection.match(/Sin notificaciones/g) || []).length, 1, "OWNER: el vacío se dice una sola vez");

  // ADMIN/MEMBER (sin permiso de avisos), sin invitaciones, correo verificado y sin cargar:
  // ninguna sección se dibuja, así que el cuerpo muestra el texto discreto en vez de quedar vacío.
  const adminEmpty = html({ notifications: [], showNotifications: false, subscription: ready, unreadCount: 0, invitations: inv({}) });
  assertClean(adminEmpty, "ADMIN sin nada que mostrar");
  assertSingleStatusRole(adminEmpty, "ADMIN sin nada que mostrar");
  assert.match(adminEmpty, /class="notification-empty">Sin notificaciones</, "ADMIN sin invitaciones: texto discreto, no cuerpo vacío");
  assert.equal((adminEmpty.match(/Sin notificaciones/g) || []).length, 1);
  assert.doesNotMatch(adminEmpty, /erp-empty-state|notification-section|notification-invitations-title/, "sin caja punteada ni secciones");
  // Con algo que mostrar, el texto no aparece: cargando, error, correo sin verificar o invitaciones.
  for (const [name, extra] of [
    ["cargando", { status: "loading" }],
    ["error", { status: "error" }],
    ["correo sin verificar", { requiresVerification: true }],
    ["con invitaciones", { invitations: [{ id: "i1", negocioNombre: "Bagner", rolEtiqueta: "Técnico" }] }],
  ]) {
    const markup = html({ notifications: [], showNotifications: false, subscription: ready, unreadCount: 0, invitations: inv(extra) });
    assert.doesNotMatch(markup, /Sin notificaciones/, `ADMIN ${name}: la sección de invitaciones ocupa el cuerpo, sin el texto de vacío`);
  }

  const verify = html({ notifications: [], subscription: ready, unreadCount: 0, invitations: inv({ requiresVerification: true }), verification: { cooldownLeft: 0, feedback: "", onResend: () => {}, resending: false } });
  assertClean(verify, "verificar correo");
  assertSingleStatusRole(verify, "verificar correo");
  assert.match(verify, /ui-notice ui-notice--info notification-notice/, "correo sin verificar: Notice informativo compacto");
  assert.match(verify, /Verifica tu correo para ver y responder tus invitaciones\./);
  assert.match(verify, />Reenviar correo</, "con acción de reenviar");
  assert.doesNotMatch(verify, /erp-empty-state/, "sin caja punteada");
  assert.doesNotMatch(verify, /ui-notice[^>]*role=/, "el Notice estático no es región viva");
  assert.doesNotMatch(verify, /ui-button--primary/, "sin botón principal en el aviso");
  assert.doesNotMatch(verify, />Aceptar</);

  const cooling = html({ notifications: [], subscription: ready, unreadCount: 0, invitations: inv({ requiresVerification: true }), verification: { cooldownLeft: 45, feedback: "Te enviamos el correo de verificación.", onResend: () => {}, resending: false } });
  assert.match(cooling, />Reenviar en 45 s</, "cuenta atrás del reenvío");
  assert.match(cooling, /<button[^>]*disabled[^>]*>[^<]*(<[^>]*>)*[^<]*Reenviar en 45 s/, "el reenvío se bloquea durante la espera");
  assert.match(cooling, /role="status"[^>]*>Te enviamos el correo de verificación\./, "el feedback es el único role=status");
  assertSingleStatusRole(cooling, "verificar con feedback");

  const loadingInv = html({ notifications: [], subscription: ready, unreadCount: 0, invitations: inv({ status: "loading" }) });
  assert.match(loadingInv, /Invitaciones/);
  assert.match(loadingInv, /ui-skeleton-cards/, "cargando: la sección sigue visible con su skeleton");
  const errorInv = html({ notifications: [], subscription: ready, unreadCount: 0, invitations: inv({ status: "error" }) });
  assert.match(errorInv, /No se pudieron cargar las invitaciones\./, "error: la sección sigue visible");
  const bothSections = html({ notifications: [], subscription: ready, unreadCount: 0, invitations: inv({ status: "error" }) });
  assert.match(bothSections, />Avisos</, "con ambas secciones, cada una conserva su título");

  // Fecha relativa (pura): se inyecta now.
  const now = new Date("2026-06-15T12:00:00Z").getTime();
  const ago = (ms) => new Date(now - ms);
  assert.equal(formatRelativeTimestamp(ago(20 * 1000), now), "ahora");
  assert.equal(formatRelativeTimestamp(new Date(now + 90 * 1000), now), "ahora", "fecha futura por reloj atrasado: ahora");
  assert.equal(formatRelativeTimestamp(ago(5 * 60 * 1000), now), "hace 5 minutos");
  assert.equal(formatRelativeTimestamp(ago(2 * 60 * 60 * 1000), now), "hace 2 horas");
  assert.equal(formatRelativeTimestamp(ago(30 * 60 * 60 * 1000), now), "ayer");
  assert.equal(formatRelativeTimestamp(ago(3 * 24 * 60 * 60 * 1000), now), "hace 3 días");
  assert.match(formatRelativeTimestamp(ago(30 * 24 * 60 * 60 * 1000), now), /^\d{2}[-/]\d{2}[-/]\d{4}$/, "pasados 7 días: fecha completa");
  assert.equal(formatRelativeTimestamp(null, now), "-");
  assert.equal(formatRelativeTimestamp("no es fecha", now), "-");
  assert.equal(formatRelativeTimestamp({ toDate: () => ago(5 * 60 * 1000) }, now), "hace 5 minutos", "acepta Timestamp de Firestore");
  console.log("OK invitaciones condicionales, aviso de verificación y fecha relativa");

  // Fuentes del panel: sin escapes unicode ni colores literales (solo tokens).
  const viewSource = await readFile(new URL("../src/components/NotificationBellView.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(viewSource, /\\u[0-9a-fA-F]{4}/, "NotificationBellView: sin escapes unicode");
  assert.doesNotMatch(viewSource, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, "NotificationBellView: sin colores literales");
  assert.match(bellSource, /sendVerificationEmail\(\)/, "NotificationBell: el reenvío usa sendVerificationEmail");
} finally {
  await vite.close();
}

console.log("NOTIFICATION_BELL_SMOKE_OK");
