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
    filterUnreadNotifications,
    formatBadgeCount,
    hasOpenChildDialog,
    notificationIcon,
    shouldClosePopoverOnEscape,
    shouldClosePopoverOnPointerDown,
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
  assert.doesNotMatch(error, /Sin notificaciones|No tienes avisos nuevos/, "error: no se muestra el vacío engañoso");
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
  assert.match(empty, /class="notification-empty">No tienes avisos nuevos</, "vacío del OWNER: texto discreto con clase propia del panel, sin skeleton colgado");
  assert.doesNotMatch(empty, /Sin notificaciones/, "vacío del OWNER: ya no dice Sin notificaciones");
  assert.doesNotMatch(empty, /erp-empty-state/, "vacío: sin la caja punteada");
  assert.doesNotMatch(empty, /responsive-dialog__eyebrow|ValoraCloud/, "el panel ya no lleva pretítulo");
  console.log("OK estados: loading/slow/error/vacío con un solo role=status o alert, nunca anidados");

  // --- Con datos reales: solo se listan los no leídos (leida !== true) ---
  const unreadItems = [
    { id: "n1", tipo: "VERIFICACION_APROBADA", titulo: "Empresa verificada", descripcion: "Los módulos operativos ya están disponibles.", leida: false, creadoEn: new Date(Date.now() - 5 * 60 * 1000 - 5000) },
    { id: "n2", tipo: "VERIFICACION_RECHAZADA", titulo: "Verificación rechazada", descripcion: "Documentación insuficiente.", creadoEn: new Date("2026-01-04T09:00:00") },
    { id: "n3", tipo: "TIPO_FUTURO", titulo: "Aviso de un tipo nuevo", leida: false, creadoEn: new Date("2026-01-03T09:00:00") },
  ];
  const withData = html({
    notifications: unreadItems,
    subscription: { status: SUBSCRIPTION_STATUS.READY, synced: true },
    unreadCount: 3,
  });
  assertClean(withData, "con datos");
  assertSingleStatusRole(withData, "con datos");
  assert.equal(
    (withData.match(/notification-list__item is-unread/g) || []).length,
    3,
    "cada aviso listado es un no leído (leida false o sin el campo)"
  );
  assert.match(withData, /Empresa verificada/);
  assert.match(withData, /Verificación rechazada/);
  assert.doesNotMatch(withData, /erp-empty-state|notification-empty/, "con datos: no muestra el vacío");

  // Cambio B: un aviso leído no se lista; con mezcla solo salen los no leídos; con todos leídos, el vacío.
  assert.deepEqual(
    filterUnreadNotifications([{ id: "a", leida: true }, { id: "b", leida: false }, { id: "c" }]).map((item) => item.id),
    ["b", "c"],
    "filterUnreadNotifications: descarta solo leida === true"
  );
  assert.deepEqual(filterUnreadNotifications(undefined), [], "filterUnreadNotifications: tolera undefined");
  const mixed = html({
    notifications: [
      { id: "m1", tipo: "VERIFICACION_APROBADA", titulo: "Aviso nuevo", leida: false, creadoEn: new Date() },
      { id: "m2", tipo: "VERIFICACION_RECHAZADA", titulo: "Aviso ya leído", leida: true, creadoEn: new Date() },
    ],
    subscription: { status: SUBSCRIPTION_STATUS.READY, synced: true },
    unreadCount: 1,
  });
  assert.match(mixed, /Aviso nuevo/);
  assert.doesNotMatch(mixed, /Aviso ya leído/, "un aviso leído deja de mostrarse en la lista");
  assert.equal((mixed.match(/<li>/g) || []).length, 1, "mezcla: una sola fila");
  const allRead = html({
    notifications: [{ id: "r1", titulo: "Aviso ya leído", leida: true, creadoEn: new Date() }],
    subscription: { status: SUBSCRIPTION_STATUS.READY, synced: true },
    unreadCount: 0,
  });
  assertClean(allRead, "todos leídos");
  assert.doesNotMatch(allRead, /Aviso ya leído|notification-list/, "todos leídos: sin lista");
  assert.match(allRead, /class="notification-empty">No tienes avisos nuevos</, "todos leídos: No tienes avisos nuevos");
  assert.doesNotMatch(allRead, /ui-badge-count/, "todos leídos: sin contador");

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
  assert.equal((withData.match(/notification-list__dot" aria-hidden="true"/g) || []).length, 3, "un punto por cada no leído");
  assert.equal((withData.match(/class="sr-only">No leída</g) || []).length, 3, "el estado no leído también va en texto");

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
  assert.equal(shouldShowInvitations(inv({ status: "slow" })), true, "lenta: visible (con aviso y Reintentar)");
  assert.equal(shouldShowInvitations(inv({ status: "error" })), true, "error: visible");
  assert.equal(shouldShowInvitations(inv({ requiresVerification: true })), true, "correo sin verificar: visible");
  assert.equal(shouldShowInvitations(inv({ invitations: [{ id: "x" }] })), true, "con invitaciones: visible");

  const hiddenSection = html({ notifications: [], subscription: ready, unreadCount: 0, invitations: inv({}) });
  assert.doesNotMatch(hiddenSection, /Invitaciones|notification-invitations-title/, "oculta: ni título ni texto");
  assert.match(hiddenSection, /No tienes avisos nuevos/);
  assert.equal((hiddenSection.match(/No tienes avisos nuevos/g) || []).length, 1, "OWNER: el vacío se dice una sola vez");
  assert.doesNotMatch(hiddenSection, /Sin notificaciones/, "OWNER con avisos: el vacío es No tienes avisos nuevos");

  // ADMIN/MEMBER (sin permiso de avisos), sin invitaciones, correo verificado y sin cargar:
  // ninguna sección se dibuja, así que el cuerpo muestra el texto discreto en vez de quedar vacío.
  const adminEmpty = html({ notifications: [], showNotifications: false, subscription: ready, unreadCount: 0, invitations: inv({}) });
  assertClean(adminEmpty, "ADMIN sin nada que mostrar");
  assertSingleStatusRole(adminEmpty, "ADMIN sin nada que mostrar");
  assert.match(adminEmpty, /class="notification-empty">Sin notificaciones</, "ADMIN sin invitaciones: texto discreto, no cuerpo vacío");
  assert.equal((adminEmpty.match(/Sin notificaciones/g) || []).length, 1);
  assert.doesNotMatch(adminEmpty, /erp-empty-state|notification-section|notification-invitations-title/, "sin caja punteada ni secciones");

  const firstOrder = { id: "orden-1", tipoAtencion: "Control", box: "Box 1", asignadoEn: new Date() };
  const secondOrder = { id: "orden-2", tipoAtencion: "Urgencia", box: "Box 2" };
  const veterinaryProps = {
    notifications: [], showNotifications: false, subscription: ready, unreadCount: 0,
    onVeterinaryOrderOpen: () => {},
  };
  const oneOrder = html({ ...veterinaryProps, pendingVeterinaryOrders: [firstOrder] });
  assertClean(oneOrder, "profesional con una orden por iniciar");
  assert.match(oneOrder, /aria-label="Notificaciones, 1 orden por iniciar"/);
  assert.match(oneOrder, /class="ui-badge-count topbar-notifications-button__badge"[^>]*>1</);
  assert.match(oneOrder, /Órdenes asignadas/);
  assert.match(oneOrder, /Nueva atención asignada/);
  assert.match(oneOrder, /Control · Box 1/);
  assert.match(oneOrder, /Ver orden/);
  assert.doesNotMatch(oneOrder, /Sin notificaciones|No leída|aria-label="Avisos"/);

  const ordersAndInvitation = html({
    ...veterinaryProps,
    pendingVeterinaryOrders: [firstOrder, secondOrder],
    invitations: inv({ invitations: [{ id: "i1", negocioNombre: "Bagner", rolEtiqueta: "Técnico" }] }),
  });
  assert.match(ordersAndInvitation, /aria-label="Notificaciones, 1 sin leer, 2 órdenes por iniciar"/);
  assert.match(ordersAndInvitation, /class="ui-badge-count topbar-notifications-button__badge"[^>]*>3</);
  assert.match(ordersAndInvitation, /Urgencia · Box 2/);
  assert.match(ordersAndInvitation, /Invitaciones/);
  console.log("OK órdenes por iniciar: sección del profesional y contador compartido con invitaciones, de alcance diferenciado");

  // Con algo que mostrar, el texto no aparece: cargando, error, correo sin verificar o invitaciones.
  for (const [name, extra] of [
    ["cargando", { status: "loading" }],
    ["lenta", { status: "slow" }],
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

  // --- Cambio A: desplegable anclado a la campana, no un modal ---
  const closedMarkup = html({ open: false, notifications: unreadItems, subscription: ready, unreadCount: 3 });
  assert.doesNotMatch(closedMarkup, /notification-popover/, "cerrado: el panel no está en el DOM");
  assert.match(closedMarkup, /aria-expanded="false"/, "cerrado: aria-expanded=false");
  assert.doesNotMatch(closedMarkup, /aria-controls/, "cerrado: sin aria-controls a un panel inexistente");
  const openMarkup = html({ notifications: unreadItems, subscription: ready, unreadCount: 3 });
  assert.match(openMarkup, /class="notification-bell"/, "el wrapper ancla botón y panel");
  assert.match(openMarkup, /aria-haspopup="true"/, "el botón ya no anuncia un dialog");
  assert.match(openMarkup, /aria-expanded="true"/, "abierto: aria-expanded=true");
  assert.match(openMarkup, /aria-controls="([^"]+)"/, "abierto: el botón controla el panel");
  const panelId = openMarkup.match(/aria-controls="([^"]+)"/)[1];
  assert.match(openMarkup, new RegExp(`<section id="${panelId.replace(/[:]/g, "\\$&")}" class="notification-popover no-print"`), "el panel lleva el id que controla el botón");
  assert.match(openMarkup, /<h2 id="[^"]+" class="notification-popover__title">Notificaciones<\/h2>/, "el panel tiene su título");
  assert.doesNotMatch(openMarkup, /aria-modal|role="dialog"|responsive-dialog/, "sin aria-modal, sin dialog y sin ResponsiveDialog");
  assert.ok(
    openMarkup.indexOf("topbar-notifications-button") < openMarkup.indexOf("notification-popover"),
    "el panel va justo después del botón: el Tab llega a él naturalmente"
  );
  assert.equal((openMarkup.match(/<h2/g) || []).length, 1, "un solo h2: el título del panel");

  // Clic fuera y Escape, con un diálogo hijo (Rechazar invitación) abierto o no: lógica pura con DOM simulado.
  const inside = {};
  const outside = {};
  const root = { contains: (node) => node === inside };
  const docWith = (open) => ({ querySelector: (selector) => (open && selector === ".responsive-dialog-layer" ? {} : null) });
  assert.equal(hasOpenChildDialog(docWith(true)), true);
  assert.equal(hasOpenChildDialog(docWith(false)), false);
  assert.equal(hasOpenChildDialog(null), false);
  assert.equal(shouldClosePopoverOnPointerDown(outside, root, docWith(false)), true, "clic fuera sin diálogo: cierra");
  assert.equal(shouldClosePopoverOnPointerDown(inside, root, docWith(false)), false, "clic dentro (incluido el botón): no cierra");
  assert.equal(shouldClosePopoverOnPointerDown(outside, root, docWith(true)), false, "clic fuera con un diálogo hijo abierto: se ignora");
  assert.equal(shouldClosePopoverOnPointerDown(outside, null, docWith(false)), false, "sin raíz montada: no cierra");
  assert.equal(shouldClosePopoverOnEscape({ key: "Escape", defaultPrevented: false }, docWith(false)), true, "Escape sin diálogo: cierra");
  assert.equal(shouldClosePopoverOnEscape({ key: "Escape", defaultPrevented: false }, docWith(true)), false, "Escape con un diálogo hijo abierto: lo atiende el diálogo");
  assert.equal(shouldClosePopoverOnEscape({ key: "Escape", defaultPrevented: true }, docWith(false)), false, "Escape ya atendido: no cierra");
  assert.equal(shouldClosePopoverOnEscape({ key: "Enter", defaultPrevented: false }, docWith(false)), false, "otra tecla: no cierra");

  // Cableado en la fuente (renderToStaticMarkup no ejecuta efectos).
  const viewCode = stripLineComments(await readFile(new URL("../src/components/NotificationBellView.jsx", import.meta.url), "utf8"));
  assert.doesNotMatch(viewCode, /ResponsiveDialog/, "la vista ya no usa ResponsiveDialog");
  assert.match(viewCode, /document\.addEventListener\("pointerdown", handlePointerDown\)/, "clic fuera: pointerdown en document");
  assert.match(viewCode, /document\.addEventListener\("keydown", handleKeyDown\)/, "Escape: keydown en document");
  assert.match(viewCode, /shouldClosePopoverOnPointerDown\(event\.target, rootRef\.current, document\)/, "pointerdown consulta la lógica de diálogos hijos");
  assert.match(viewCode, /shouldClosePopoverOnEscape\(event, document\)/, "Escape consulta la lógica de diálogos hijos");
  assert.match(viewCode, /triggerRef\.current\?\.focus\(\)/, "Escape devuelve el foco al botón");
  assert.match(viewCode, /onClick=\{open \? onClose : onOpen\}/, "el botón alterna abrir y cerrar");
  assert.doesNotMatch(viewCode, /focus-trap|FOCUSABLE_SELECTOR|document\.body\.style\.overflow/, "sin focus-trap ni bloqueo de scroll");
  assert.match(
    await readFile(new URL("../src/components/RejectInvitationDialog.jsx", import.meta.url), "utf8"),
    /ResponsiveDialog/,
    "el diálogo de rechazo sigue siendo un ResponsiveDialog (clase responsive-dialog-layer) en un portal"
  );

  // CSS del panel: solo tokens, anclado en escritorio y fixed con margen --space-3 en pantallas chicas.
  const layoutCss = await readFile(new URL("../src/styles/layout.css", import.meta.url), "utf8");
  const popoverRule = (layoutCss.match(/\n\.notification-popover \{[^}]*\}/) || [""])[0];
  assert.ok(popoverRule, "layout.css: regla .notification-popover");
  assert.match(popoverRule, /position: absolute;/, "escritorio: anclado a la campana");
  assert.match(popoverRule, /top: calc\(100% \+ var\(--space-2\)\)/, "escritorio: bajo el icono");
  assert.match(popoverRule, /right: 0;/, "escritorio: alineado al borde derecho de la campana");
  assert.doesNotMatch(popoverRule, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, "el panel no usa colores literales");
  assert.match(popoverRule, /var\(--radius-md\)/);
  assert.match(popoverRule, /var\(--shadow-md\)/);
  const mobileRule = (layoutCss.match(/@media \(max-width: 640px\) \{[\s\S]*?\n  \.notification-popover \{([^}]*)\}/) || [])[1] || "";
  assert.match(mobileRule, /position: fixed;/, "pantallas chicas: fixed");
  assert.match(mobileRule, /left: var\(--space-3\);/, "pantallas chicas: margen izquierdo --space-3");
  assert.match(mobileRule, /right: var\(--space-3\);/, "pantallas chicas: margen derecho --space-3");
  assert.match(mobileRule, /top: calc\(var\(--shell-topbar-height\) \+ var\(--space-2\)\)/, "pantallas chicas: bajo el encabezado");
  console.log("OK desplegable: anclado, sin modal, clic fuera y Escape con diálogos hijos ignorados, fixed en pantallas chicas");

  // Fuentes del panel: sin escapes unicode ni colores literales (solo tokens).
  const viewSource = await readFile(new URL("../src/components/NotificationBellView.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(viewSource, /\\u[0-9a-fA-F]{4}/, "NotificationBellView: sin escapes unicode");
  assert.doesNotMatch(viewSource, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, "NotificationBellView: sin colores literales");
  assert.match(bellSource, /sendVerificationEmail\(\)/, "NotificationBell: el reenvío usa sendVerificationEmail");
} finally {
  await vite.close();
}

console.log("NOTIFICATION_BELL_SMOKE_OK");
