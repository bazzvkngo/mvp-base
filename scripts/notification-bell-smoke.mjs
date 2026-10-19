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
  const { default: NotificationBellView, canViewBusinessNotifications, formatBadgeCount } =
    await vite.ssrLoadModule("/src/components/NotificationBellView.jsx");
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
  assert.match(errorWithInvitations, /No tienes invitaciones pendientes\./, "error en avisos: la sección de invitaciones no cambia");
  assert.match(errorWithInvitations, /No se pudieron cargar las notificaciones\./);

  const empty = html({ notifications: [], subscription: { status: SUBSCRIPTION_STATUS.READY, synced: true }, unreadCount: 0 });
  assertClean(empty, "vacío");
  assertSingleStatusRole(empty, "vacío");
  assert.doesNotMatch(empty, /role="status"|role="alert"/, "vacío real: no es un estado de carga ni de error, sin role propio");
  assert.match(empty, /class="erp-empty-state">Sin notificaciones</, "vacío: mensaje esperado, sin skeleton colgado");
  console.log("OK estados: loading/slow/error/vacío con un solo role=status o alert, nunca anidados");

  // --- Con datos reales: leídas y no leídas ---
  const withData = html({
    notifications: [
      { id: "n1", titulo: "Empresa verificada", descripcion: "Los módulos operativos ya están disponibles.", leida: false, creadoEn: new Date("2026-01-05T10:30:00") },
      { id: "n2", titulo: "Verificación rechazada", descripcion: "Documentación insuficiente.", leida: true, creadoEn: new Date("2026-01-04T09:00:00") },
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
  assert.doesNotMatch(withData, /erp-empty-state/, "con datos: no muestra el vacío");
  console.log("OK con datos: leídas/no leídas se distinguen, sin markup roto");
} finally {
  await vite.close();
}

console.log("NOTIFICATION_BELL_SMOKE_OK");
