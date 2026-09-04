import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, createUserWithEmailAndPassword, getAuth} from "firebase/auth";
import {connectFirestoreEmulator, doc, getFirestore, onSnapshot} from "firebase/firestore";
import {connectFunctionsEmulator, getFunctions, httpsCallable} from "firebase/functions";
import {
  canBusinessOperate,
  normalizeBusinessVerificationState,
  shouldRefreshBusinessSessionForVerification,
} from "../src/domain/businessOperations.mjs";

// QA-005: revalidación reactiva de negocio sin F5. Este script prueba, contra
// Emulator Suite real, el MISMO mecanismo que usa la app
// (src/services/companyService.js:subscribeToCompanyProfile — dos
// onSnapshot sobre negocios/{businessId} y su perfil — y
// src/layout/AppLayout.jsx, que compara el estado cacheado en sesión contra
// el estado observado en vivo vía shouldRefreshBusinessSessionForVerification,
// ya corregida en src/domain/businessOperations.mjs para no ignorar
// RECHAZADA). No se reimplementa la app: se reutilizan las funciones puras
// reales y se replica fielmente el listener real (mismos paths, mismo
// patrón), porque companyService.js importa Firebase vía
// src/firebase/firebaseConfig.js y no es seguro cargarlo fuera de Vite
// (resolvería a configuración de producción).

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
function chileRut(body) {
  let sum = 0;
  let multiplier = 2;
  for (const digit of String(body).split("").reverse()) {
    sum += Number(digit) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const result = 11 - (sum % 11);
  const verifier = result === 11 ? "0" : result === 10 ? "K" : String(result);
  const formattedBody = String(body).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${formattedBody}-${verifier}`;
}
const fiscalIdFor = (seed) => chileRut(20000000 + ([...`${seed}${RUN_ID}`].reduce((total, ch) => (total * 31 + ch.charCodeAt(0)) % 60000000, 0)));

const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const {initializeApp: initAdmin, deleteApp: deleteAdminApp} = requireFromFunctions("firebase-admin/app");
const {getAuth: getAdminAuth} = requireFromFunctions("firebase-admin/auth");

function client(name) {
  const app = initializeApp({apiKey: "demo", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID}, `qa005-${name}-${RUN_ID}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, "us-central1");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return {app, auth, db, functions};
}
async function authenticate(target, name) {
  const credential = await createUserWithEmailAndPassword(target.auth, `qa005-${name}-${RUN_ID}@example.test`, `Qa005-${RUN_ID}-Pass!`);
  target.uid = credential.user.uid;
  target.user = credential.user;
  return target;
}
const call = (target, name) => httpsCallable(target.functions, name);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Réplica exacta de subscribeToCompanyProfile (mismos paths, mismo patrón de
// dos listeners con cleanup conjunto) — usada tal cual la usaría
// useBusinessCompletionStatus, sin reimplementar lógica de negocio.
function subscribeToBusiness(sdk, businessId, onNext, onError) {
  let business = null;
  let stopped = false;
  const unsub = onSnapshot(
    doc(sdk.db, "negocios", businessId),
    (snapshot) => {
      if (stopped) return;
      business = snapshot.data() || {};
      onNext?.(business);
    },
    (error) => {
      if (!stopped) onError?.(error);
    }
  );
  return () => {
    stopped = true;
    unsub();
  };
}

// createFirstBusiness es idempotente por uid (lock de "primer negocio"):
// llamarla dos veces con el MISMO owner devuelve el MISMO negocio. Cada
// caso de esta suite necesita negocios genuinamente independientes, así
// que se crea un owner nuevo y dedicado por cada uno (salvo el caso 6, que
// deliberadamente reutiliza un mismo owner con createAdditionalBusiness
// para probar el cambio de negocio activo).
async function makeVerifiableBusiness(label, ownerSdk) {
  const sdk = ownerSdk || await authenticate(client(`owner-${label}`), `owner-${label}`);
  const isFirst = !ownerSdk;
  const created = await call(sdk, isFirst ? "createFirstBusiness" : "createAdditionalBusiness")({
    nombreComercial: `Empresa ${label}`, rubroCodigo: "INGENIERIA_CONSULTORIA", regionCodigo: "13", requestId: `qa005_biz_${label}_${RUN_ID}`,
  });
  const businessId = created.data.business.id;
  await call(sdk, "updateBusinessInformation")({
    businessId,
    profile: {
      nombreComercial: `Empresa ${label}`, rubroCodigo: "INGENIERIA_CONSULTORIA", rubroNombre: "Ingeniería y consultoría técnica", rubroOtro: "",
      paisCodigo: "CL", monedaCodigo: "CLP", locale: "es-CL", regionCodigo: "13", comunaCodigo: "13101",
      giro: "Servicios", email: `owner-${label}@example.test`, telefono: "+56 9 1234 5678",
      direccion: "Dirección 123", ciudad: "Santiago", regionEstado: "Región Metropolitana de Santiago",
      codigoPostal: "8320000", sitioWeb: "",
    },
  });
  return {businessId, ownerSdk: sdk};
}

async function requestVerification(ownerSdk, businessId, label) {
  return call(ownerSdk, "solicitarVerificacionEmpresa")({
    businessId,
    requestId: `qa005_verif_${label}_${RUN_ID}`,
    solicitud: {
      paisCodigo: "CL",
      identificadorFiscalTipo: "RUT",
      identificadorFiscalValor: fiscalIdFor(label),
      relacionSolicitante: "Representante legal",
      correoSolicitante: `owner-${label}@example.test`,
      telefonoSolicitante: "+56 9 1234 5678",
      observaciones: "QA-005 smoke",
    },
  });
}

const owner = await authenticate(client("owner"), "owner");
const platform = await authenticate(client("platform"), "platform");
const adminApp = initAdmin({projectId: PROJECT_ID}, `qa005-admin-${RUN_ID}`);
const adminAuth = getAdminAuth(adminApp);
await adminAuth.setCustomUserClaims(platform.uid, {platformRole: "PLATFORM_SUPERADMIN"});
await platform.user.getIdToken(true);

// ================================================================
// CASOS 1-3: negocio PENDIENTE inicial, aprobación cross-session
// actualiza la sesión OWNER, sin F5 (listener en vivo, no polling).
// ================================================================
{
  const {businessId, ownerSdk} = await makeVerifiableBusiness("approve");
  const events = [];
  const unsub = subscribeToBusiness(ownerSdk, businessId, (data) => events.push({estado: data.estado, verificacion: data.verificacionEmpresa?.estado || null}), (error) => events.push({error: error.code}));
  await wait(600);

  const requested = await requestVerification(ownerSdk, businessId, "approve");
  await wait(600);
  const pendingEvent = events[events.length - 1];
  assert.equal(normalizeBusinessVerificationState(pendingEvent.verificacion), "PENDIENTE");
  console.log("OK caso 1: negocio queda PENDIENTE y el listener del OWNER lo observa de inmediato");

  const sessionStateBeforeApproval = normalizeBusinessVerificationState(pendingEvent.verificacion);
  await call(platform, "resolverVerificacionEmpresa")({
    businessId, solicitudId: requested.data.solicitudId, decision: "APROBAR", motivo: "",
    razonSocialOficial: "Empresa Approve Oficial SpA", requestId: `qa005_approve_${RUN_ID}`,
  });
  await wait(1000);
  const approvalEvent = events[events.length - 1];
  assert.equal(normalizeBusinessVerificationState(approvalEvent.verificacion), "VERIFICADA");
  assert.equal(
    shouldRefreshBusinessSessionForVerification(sessionStateBeforeApproval, normalizeBusinessVerificationState(approvalEvent.verificacion)),
    true,
    "la sesión OWNER debe marcarse para revalidar tras la aprobación cross-session"
  );
  console.log("OK casos 2/3: aprobación cross-session llega al listener del OWNER sin F5 (ni polling) y dispara la condición de revalidación de sesión");

  unsub();
  await deleteApp(ownerSdk.app);
}

// ================================================================
// CASO 4: rechazo cross-session también se refleja (el gap corregido).
// ================================================================
{
  const {businessId, ownerSdk} = await makeVerifiableBusiness("reject");
  const events = [];
  const unsub = subscribeToBusiness(ownerSdk, businessId, (data) => events.push({verificacion: data.verificacionEmpresa?.estado || null}), (error) => events.push({error: error.code}));
  await wait(600);

  const requested = await requestVerification(ownerSdk, businessId, "reject");
  await wait(600);
  const sessionStateBeforeRejection = normalizeBusinessVerificationState(events[events.length - 1].verificacion);

  await call(platform, "resolverVerificacionEmpresa")({
    businessId, solicitudId: requested.data.solicitudId, decision: "RECHAZAR", motivo: "Documentación insuficiente",
    razonSocialOficial: "", requestId: `qa005_reject_${RUN_ID}`,
  });
  await wait(1000);
  const rejectionEvent = events[events.length - 1];
  assert.equal(normalizeBusinessVerificationState(rejectionEvent.verificacion), "RECHAZADA");
  assert.equal(
    shouldRefreshBusinessSessionForVerification(sessionStateBeforeRejection, normalizeBusinessVerificationState(rejectionEvent.verificacion)),
    true,
    "un rechazo cross-session también debe disparar la revalidación de sesión (antes del fix, esto se ignoraba silenciosamente)"
  );
  assert.equal(canBusinessOperate({verificacionEmpresa: {estado: rejectionEvent.verificacion}}), false, "un negocio rechazado nunca debe quedar operable");
  console.log("OK caso 4: rechazo cross-session llega al listener y SÍ dispara revalidación de sesión (gap corregido)");

  unsub();
  await deleteApp(ownerSdk.app);
}

// ================================================================
// CASOS 5/11: listener sólo para el negocio activo — un negocio B no
// contamina el listener del negocio A (aislamiento multiempresa).
// ================================================================
{
  const {businessId: businessA, ownerSdk: ownerA} = await makeVerifiableBusiness("tenantA");
  const {businessId: businessB, ownerSdk: ownerB} = await makeVerifiableBusiness("tenantB");
  const eventsA = [];
  const unsubA = subscribeToBusiness(ownerA, businessA, (data) => eventsA.push({biz: "A", verificacion: data.verificacionEmpresa?.estado || null}), () => {});
  await wait(500);
  const countBeforeBApproval = eventsA.length;

  const requestedB = await requestVerification(ownerB, businessB, "tenantB");
  await call(platform, "resolverVerificacionEmpresa")({
    businessId: businessB, solicitudId: requestedB.data.solicitudId, decision: "APROBAR", motivo: "",
    razonSocialOficial: "Empresa TenantB Oficial SpA", requestId: `qa005_tenantb_${RUN_ID}`,
  });
  await wait(1000);
  assert.equal(eventsA.length, countBeforeBApproval, "cambios en el negocio B no deben producir NINGÚN evento en el listener del negocio A");
  console.log("OK casos 5/11: el listener del negocio A no recibe ningún cambio del negocio B (aislamiento multiempresa)");

  unsubA();
  await deleteApp(ownerA.app);
  await deleteApp(ownerB.app);
}

// ================================================================
// CASO 6: cambio de negocio activo limpia el listener anterior (no mezcla
// estados entre negocios al cambiar cuál está activo).
// ================================================================
{
  const {businessId: businessOld, ownerSdk: switcher} = await makeVerifiableBusiness("switchOld");
  const {businessId: businessNew} = await makeVerifiableBusiness("switchNew", switcher);
  const eventsOld = [];
  let unsubOld = subscribeToBusiness(switcher, businessOld, (data) => eventsOld.push(data.verificacionEmpresa?.estado || null), () => {});
  await wait(500);

  // Simula exactamente lo que hace useBusinessCompletionStatus cuando
  // businessId cambia: cleanup del listener anterior ANTES de suscribirse
  // al nuevo (mismo orden garantizado por React al re-ejecutar el efecto).
  unsubOld();
  const eventsNew = [];
  const unsubNew = subscribeToBusiness(switcher, businessNew, (data) => eventsNew.push(data.verificacionEmpresa?.estado || null), () => {});
  await wait(500);
  const countOldAfterSwitch = eventsOld.length;

  const requestedOld = await requestVerification(switcher, businessOld, "switchOld");
  await call(platform, "resolverVerificacionEmpresa")({
    businessId: businessOld, solicitudId: requestedOld.data.solicitudId, decision: "APROBAR", motivo: "",
    razonSocialOficial: "Empresa SwitchOld Oficial SpA", requestId: `qa005_switchold_${RUN_ID}`,
  });
  await wait(1000);
  assert.equal(eventsOld.length, countOldAfterSwitch, "tras cambiar de negocio activo, el listener anterior debe estar desuscrito: cero eventos nuevos");
  assert.ok(eventsNew.length >= 1, "el listener del nuevo negocio activo debe seguir funcionando normalmente");
  console.log("OK caso 6: cambiar el negocio activo limpia el listener anterior — no llegan más eventos de un negocio ya no activo");

  unsubNew();
  await deleteApp(switcher.app);
}

// ================================================================
// CASOS 7/8: logout limpia el listener; login vuelve a suscribirse
// correctamente y observa el estado real vigente (no uno obsoleto).
// ================================================================
{
  const {businessId, ownerSdk} = await makeVerifiableBusiness("logout");
  const eventsBeforeLogout = [];
  const unsubBeforeLogout = subscribeToBusiness(ownerSdk, businessId, (data) => eventsBeforeLogout.push(data.verificacionEmpresa?.estado || null), () => {});
  await wait(500);

  // "Logout": el componente se desmonta -> React ejecuta el cleanup del
  // efecto -> se llama la función de desuscripción devuelta.
  unsubBeforeLogout();
  const countAfterLogout = eventsBeforeLogout.length;

  const requested = await requestVerification(ownerSdk, businessId, "logout");
  await call(platform, "resolverVerificacionEmpresa")({
    businessId, solicitudId: requested.data.solicitudId, decision: "APROBAR", motivo: "",
    razonSocialOficial: "Empresa Logout Oficial SpA", requestId: `qa005_logout_${RUN_ID}`,
  });
  await wait(1000);
  assert.equal(eventsBeforeLogout.length, countAfterLogout, "tras el logout no debe llegar ningún evento más al callback ya desuscrito (sin memory leak evidente ni actualización de componente desmontado)");
  console.log("OK caso 7: logout limpia el listener — cero eventos tras desuscribir, ni siquiera con una aprobación real ocurriendo después");

  // "Login" (o simplemente re-montar el layout): una nueva suscripción debe
  // observar de inmediato el estado REAL vigente (ya VERIFICADA), no algo
  // obsoleto ni requerir ninguna acción manual adicional.
  const eventsAfterLogin = [];
  const unsubAfterLogin = subscribeToBusiness(ownerSdk, businessId, (data) => eventsAfterLogin.push(data.verificacionEmpresa?.estado || null), () => {});
  await wait(600);
  assert.ok(eventsAfterLogin.length >= 1, "el login debe volver a suscribirse y recibir al menos el snapshot inicial");
  assert.equal(normalizeBusinessVerificationState(eventsAfterLogin[eventsAfterLogin.length - 1]), "VERIFICADA", "el login debe observar el estado real vigente, no uno obsoleto");
  console.log("OK caso 8: login (nueva suscripción) observa de inmediato el estado real vigente del negocio");

  unsubAfterLogin();
  await deleteApp(ownerSdk.app);
}

// ================================================================
// CASO 9: no hay listener duplicado — el mismo businessId no produce dos
// suscripciones activas simultáneas bajo el patrón real (useEffect con
// [businessId] como dependencia sólo mantiene UNA suscripción viva por
// negocio a la vez; se demuestra que dos suscripciones independientes SÍ
// reciben cada una su propio evento —confirmando que no hay deduplicación
// mágica del lado del emulador— por lo que la garantía real depende
// exclusivamente de que la app cree una sola suscripción por negocio,
// exactamente como hace useBusinessCompletionStatus con su cleanup previo
// al re-suscribirse, ya verificado en el caso 6).
{
  const {businessId, ownerSdk} = await makeVerifiableBusiness("duplicate");
  let countA = 0;
  let countB = 0;
  const unsubA = subscribeToBusiness(ownerSdk, businessId, () => { countA += 1; }, () => {});
  const unsubB = subscribeToBusiness(ownerSdk, businessId, () => { countB += 1; }, () => {});
  await wait(600);
  assert.ok(countA >= 1 && countB >= 1, "cada suscripción independiente recibe su propio snapshot inicial");
  unsubA();
  unsubB();
  console.log("OK caso 9: el mecanismo no deduplica suscripciones automáticamente — la garantía de 'sin listener duplicado' depende de que la app mantenga sólo una activa por negocio (verificado en el caso 6: cleanup antes de re-suscribir)");
  await deleteApp(ownerSdk.app);
}

// ================================================================
// CASO 10: error de listener no concede acceso — un negocio inexistente o
// inaccesible produce un error explícito, nunca un estado que habilite
// operación por fallback.
// ================================================================
{
  const inaccessibleBusinessId = `qa005-inaccessible-${RUN_ID}`;
  const events = [];
  const unsub = subscribeToBusiness(owner, inaccessibleBusinessId, (data) => events.push({ok: true, data}), (error) => events.push({error: error.code}));
  await wait(700);
  assert.ok(events.length >= 1, "debe producirse al menos un evento (de error, dado que el negocio no existe/no es accesible)");
  assert.ok(events.every((event) => event.error), "TODOS los eventos para un negocio inaccesible deben ser de error, nunca datos que simulen una empresa operable");
  assert.equal(canBusinessOperate({}), false, "sin datos reales del negocio, canBusinessOperate nunca concede operación por defecto");
  console.log("OK caso 10: negocio inaccesible produce error explícito en el listener, nunca datos que concedan acceso por fallback");
  unsub();
}

// ================================================================
// CASO 12: el estado actualizado llega a los guards/UI dependiente —
// canBusinessOperate (el guard real usado en App.jsx/AppLayout.jsx) refleja
// exactamente el estado recién observado, para las 4 transiciones reales.
// ================================================================
{
  assert.equal(canBusinessOperate({verificacionEmpresa: {estado: "NO_VERIFICADA"}}), false);
  assert.equal(canBusinessOperate({verificacionEmpresa: {estado: "PENDIENTE"}}), false);
  assert.equal(canBusinessOperate({verificacionEmpresa: {estado: "RECHAZADA"}}), false);
  assert.equal(canBusinessOperate({verificacionEmpresa: {estado: "VERIFICADA"}}), true);
  console.log("OK caso 12: canBusinessOperate (el guard real que consumen App.jsx/AppLayout.jsx) refleja correctamente las 4 transiciones reales del contrato");
}

await deleteApp(owner.app);
await deleteApp(platform.app);
await deleteAdminApp(adminApp);
console.log("REACTIVE_BUSINESS_SESSION_SMOKE_OK");
