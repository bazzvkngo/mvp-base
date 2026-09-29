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
assert.match(
  bellSource,
  /if \(!canSeeNotifications\) return null;/,
  "NotificationBell: no renderiza el trigger si el rol no es OWNER"
);
// El guard de "return null" debe estar ANTES del uso de notificationsState
// (que es lo que se pasa a la vista) para que el trigger nunca se arme
// con datos de una suscripción que no debió pedirse.
assert.ok(
  bellSource.indexOf("if (!canSeeNotifications) return null;") <
    bellSource.indexOf("<NotificationBellView"),
  "NotificationBell: el guard corta antes de usar el resultado del hook"
);
const guardIndex = hookSource.indexOf("if (!businessId) return undefined;");
const subscribeIndex = hookSource.indexOf("subscribeToNotifications(");
assert.ok(guardIndex >= 0 && subscribeIndex > guardIndex,
  "useNotifications: el guard de businessId vacío corta antes de llamar a subscribeToNotifications");
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
