import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  terminate,
  updateDoc,
} from "firebase/firestore";
import {connectFunctionsEmulator, getFunctions, httpsCallable} from "firebase/functions";

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const AUTH_EMULATOR_PORT = Number(process.env.VALORA_AUTH_EMULATOR_PORT || 9099);
const FIRESTORE_EMULATOR_PORT = Number(process.env.VALORA_FIRESTORE_EMULATOR_PORT || 8080);
const FUNCTIONS_EMULATOR_PORT = Number(process.env.VALORA_FUNCTIONS_EMULATOR_PORT || 5001);
const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const {deleteApp: deleteAdminApp, initializeApp: initializeAdminApp} = requireFromFunctions("firebase-admin/app");
const {getAuth: getAdminAuth} = requireFromFunctions("firebase-admin/auth");
const {getFirestore: getAdminFirestore} = requireFromFunctions("firebase-admin/firestore");

function client(name) {
  const app = initializeApp({apiKey: "demo", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID, appId: `platform-${name}-${RUN_ID}`}, `platform-${name}-${RUN_ID}`);
  const auth = getAuth(app); const db = getFirestore(app); const functions = getFunctions(app, "us-central1");
  connectAuthEmulator(auth, `http://127.0.0.1:${AUTH_EMULATOR_PORT}`, {disableWarnings: true});
  connectFirestoreEmulator(db, "127.0.0.1", FIRESTORE_EMULATOR_PORT);
  connectFunctionsEmulator(functions, "127.0.0.1", FUNCTIONS_EMULATOR_PORT);
  return {app, auth, db, functions};
}

async function authenticate(target, name) {
  target.email = `platform-${name}-${RUN_ID}@example.test`;
  target.password = `Platform-${RUN_ID}-Pass!`;
  const credential = await createUserWithEmailAndPassword(target.auth, target.email, target.password);
  target.uid = credential.user.uid; target.user = credential.user;
  return target;
}

const call = (target, name) => httpsCallable(target.functions, name);
const requestId = (prefix) => `${prefix}_${RUN_ID.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 120);
async function rejected(label, operation, codes) {
  try { await operation(); } catch (error) {
    assert.ok(codes.some((code) => String(error?.code || "").includes(code)), `${label}: ${error?.code} ${error?.message}`);
    console.log(`OK rechazo: ${label}`); return;
  }
  throw new Error(`Se esperaba rechazo: ${label}`);
}

const businessInput = (name, suffix) => ({nombreComercial: name, rubroCodigo: "INGENIERIA_CONSULTORIA", regionCodigo: "13", requestId: requestId(`business_${suffix}`)});
const profile = (name, rut) => ({
  nombreComercial: name, rubroCodigo: "INGENIERIA_CONSULTORIA", rubroNombre: "Ingeniería y consultoría técnica", rubroOtro: "",
  paisCodigo: "CL", monedaCodigo: "CLP", locale: "es-CL", identificadorFiscalTipo: "RUT", identificadorFiscalValor: rut,
  regionCodigo: "13", comunaCodigo: "13101", razonSocial: `${name} SpA`, giro: "Servicios", email: `${name.toLowerCase().replace(/\s+/g, "-")}@example.test`,
  telefono: "+56 9 1234 5678", direccion: "Direccion 123", ciudad: "Santiago", regionEstado: "Region Metropolitana", codigoPostal: "8320000", sitioWeb: "",
});
const verification = (value) => ({razonSocial: value.razonSocial, paisCodigo: value.paisCodigo, identificadorFiscalTipo: value.identificadorFiscalTipo, identificadorFiscalValor: value.identificadorFiscalValor, relacionSolicitante: "Representante legal", correoSolicitante: value.email, telefonoSolicitante: value.telefono, observaciones: "Revision platform"});

const platform = await authenticate(client("superadmin"), "superadmin");
const owner = await authenticate(client("owner"), "owner");
const secondOwner = await authenticate(client("second-owner"), "second-owner");
const clients = [platform, owner, secondOwner];
const adminApp = initializeAdminApp({projectId: PROJECT_ID}, `platform-admin-${RUN_ID}`);
const adminDb = getAdminFirestore(adminApp); const adminAuth = getAdminAuth(adminApp);

try {
  await rejected("usuario normal lista plataforma", () => call(owner, "listarEmpresasPlataforma")({}), ["permission-denied"]);
  await adminAuth.setCustomUserClaims(platform.uid, {platformRole: "PLATFORM_SUPERADMIN"});
  await platform.user.getIdToken(true);

  const first = await call(owner, "createFirstBusiness")(businessInput("Empresa Platform Uno", "one"));
  const second = await call(secondOwner, "createFirstBusiness")(businessInput("Empresa Platform Dos", "two"));
  const firstId = first.data.business.id; const secondId = second.data.business.id;
  const firstProfile = profile("Empresa Platform Uno", "76.000.000-0");
  const secondProfile = profile("Empresa Platform Dos", "77.777.777-7");
  await call(owner, "updateBusinessInformation")({businessId: firstId, profile: firstProfile});
  await call(secondOwner, "updateBusinessInformation")({businessId: secondId, profile: secondProfile});
  await adminDb.doc(`negocios/${firstId}/clientes/historico`).set({negocioId: firstId, nombre: "Cliente historico"});

  const firstRequest = await call(owner, "solicitarVerificacionEmpresa")({businessId: firstId, requestId: requestId("verification_one"), solicitud: verification(firstProfile)});
  const secondRequest = await call(secondOwner, "solicitarVerificacionEmpresa")({businessId: secondId, requestId: requestId("verification_two"), solicitud: verification(secondProfile)});

  const summary = await call(platform, "obtenerResumenPlataforma")({});
  assert.equal(summary.data.empresas.total, 2); assert.equal(summary.data.usuarios.total, 3);
  const businesses = await call(platform, "listarEmpresasPlataforma")({limite: 20, verificacion: "TODAS"});
  assert.ok(businesses.data.empresas.some((item) => item.id === firstId));
  const firstPage = await call(platform, "listarEmpresasPlataforma")({limite: 1, verificacion: "TODAS"});
  assert.equal(firstPage.data.empresas.length, 1);
  assert.ok(firstPage.data.cursor);
  const secondPage = await call(platform, "listarEmpresasPlataforma")({
    limite: 1,
    cursor: firstPage.data.cursor,
    verificacion: "TODAS",
  });
  assert.equal(secondPage.data.empresas.length, 1);
  assert.notEqual(secondPage.data.empresas[0].id, firstPage.data.empresas[0].id);
  assert.equal(secondPage.data.cursor, null);
  const pending = await call(platform, "listarEmpresasPlataforma")({limite: 20, verificacion: "PENDIENTE"});
  assert.ok(pending.data.empresas.some((item) => item.id === firstId));
  assert.ok(pending.data.empresas.some((item) => item.id === secondId));
  const users = await call(platform, "listarUsuariosPlataforma")({limite: 20});
  assert.ok(users.data.usuarios.some((item) => item.uid === owner.uid));
  assert.equal((await call(platform, "obtenerEmpresaPlataforma")({businessId: firstId})).data.propietario.uid, owner.uid);
  assert.ok((await call(platform, "obtenerUsuarioPlataforma")({uid: owner.uid})).data.membresias.some((item) => item.negocioId === firstId));

  await rejected("claim no abre SDK global", () => getDocs(collection(platform.db, "negocios")), ["permission-denied"]);
  await rejected("platform no falsea estado por SDK", () => updateDoc(doc(platform.db, "negocios", firstId), {estado: "suspendida"}), ["permission-denied"]);

  await call(platform, "resolverVerificacionEmpresa")({businessId: firstId, solicitudId: firstRequest.data.solicitudId, decision: "APROBAR", motivo: "", requestId: requestId("approve")});
  await call(platform, "resolverVerificacionEmpresa")({businessId: secondId, solicitudId: secondRequest.data.solicitudId, decision: "RECHAZAR", motivo: "Documentacion insuficiente", requestId: requestId("reject")});
  assert.equal((await adminDb.doc(`negocios/${firstId}`).get()).data().verificacionEmpresa.estado, "VERIFICADA");
  assert.equal((await adminDb.doc(`negocios/${secondId}`).get()).data().verificacionEmpresa.estado, "RECHAZADA");

  const suspendBusinessId = requestId("suspend_business");
  const suspendedBusiness = await call(platform, "cambiarEstadoEmpresaPlataforma")({businessId: firstId, estado: "suspendida", motivo: "Revision de cumplimiento", requestId: suspendBusinessId});
  const suspendedBusinessRetry = await call(platform, "cambiarEstadoEmpresaPlataforma")({businessId: firstId, estado: "suspendida", motivo: "Revision de cumplimiento", requestId: suspendBusinessId});
  assert.equal(suspendedBusiness.data.estado, "suspendida"); assert.equal(suspendedBusinessRetry.data.idempotent, true);
  await rejected("empresa suspendida no opera", () => call(owner, "updateBusinessInformation")({businessId: firstId, profile: firstProfile}), ["failed-precondition"]);
  assert.equal((await adminDb.doc(`negocios/${firstId}/clientes/historico`).get()).exists, true);
  assert.equal((await adminDb.collection(`negocios/${firstId}/eventosPlataforma`).get()).size, 1);
  await call(platform, "cambiarEstadoEmpresaPlataforma")({businessId: firstId, estado: "activo", motivo: "", requestId: requestId("reactivate_business")});
  assert.equal((await call(owner, "getBusinessSession")({})).data.accessState, "active");

  const suspendUserId = requestId("suspend_user");
  await call(platform, "cambiarEstadoUsuarioPlataforma")({uid: owner.uid, estado: "suspendido", motivo: "Revision de cuenta", requestId: suspendUserId});
  const suspendUserRetry = await call(platform, "cambiarEstadoUsuarioPlataforma")({uid: owner.uid, estado: "suspendido", motivo: "Revision de cuenta", requestId: suspendUserId});
  assert.equal(suspendUserRetry.data.idempotent, true);
  assert.equal((await adminAuth.getUser(owner.uid)).disabled, true);
  await rejected("usuario suspendido no opera Function", () => call(owner, "getBusinessSession")({}), ["permission-denied", "unauthenticated"]);
  await rejected("usuario suspendido no opera SDK", () => getDoc(doc(owner.db, "negocios", firstId)), ["permission-denied"]);
  assert.equal((await adminDb.doc(`negocios/${firstId}/clientes/historico`).get()).exists, true);
  assert.equal((await adminDb.doc(`membresias/${firstId}__${owner.uid}`).get()).exists, true);
  assert.equal((await adminDb.collection(`usuarios/${owner.uid}/eventosPlataforma`).get()).size, 1);

  await call(platform, "cambiarEstadoUsuarioPlataforma")({uid: owner.uid, estado: "activo", motivo: "", requestId: requestId("reactivate_user")});
  assert.equal((await adminAuth.getUser(owner.uid)).disabled, false);
  try { await signOut(owner.auth); } catch {}
  const signedIn = await signInWithEmailAndPassword(owner.auth, owner.email, owner.password); owner.user = signedIn.user;
  assert.equal((await call(owner, "getBusinessSession")({})).data.accessState, "active");
  assert.equal((await adminDb.collection(`usuarios/${owner.uid}/eventosPlataforma`).get()).size, 2);
  console.log("Platform admin integrated: OK");
} finally {
  await Promise.all(clients.map(async (target) => { try { await terminate(target.db); } catch {} try { await deleteApp(target.app); } catch {} }));
  await deleteAdminApp(adminApp);
}
