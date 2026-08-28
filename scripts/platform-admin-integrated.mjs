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
const {getStorage: getAdminStorage} = requireFromFunctions("firebase-admin/storage");

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
function validChileanRut(seed) {
  const body = String(10_000_000 + (Number(seed) % 80_000_000));
  let sum = 0; let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  const verifier = remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder);
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${verifier}`;
}
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
const verification = (value) => ({paisCodigo: value.paisCodigo, identificadorFiscalTipo: value.identificadorFiscalTipo, identificadorFiscalValor: value.identificadorFiscalValor, relacionSolicitante: "Representante legal", correoSolicitante: value.email, telefonoSolicitante: value.telefono, observaciones: "Revision platform"});
const editableProfile = (value) => {
  const {
    identificadorFiscalValor: _fiscalValue,
    razonSocial: _legalName,
    ...editable
  } = value;
  return editable;
};

const platform = await authenticate(client("superadmin"), "superadmin");
const owner = await authenticate(client("owner"), "owner");
const secondOwner = await authenticate(client("second-owner"), "second-owner");
const clients = [platform, owner, secondOwner];
const adminApp = initializeAdminApp({
  projectId: PROJECT_ID,
  storageBucket: `${PROJECT_ID}.firebasestorage.app`,
}, `platform-admin-${RUN_ID}`);
const adminDb = getAdminFirestore(adminApp); const adminAuth = getAdminAuth(adminApp);
const adminBucket = getAdminStorage(adminApp).bucket();

try {
  await rejected("usuario normal lista plataforma", () => call(owner, "listarEmpresasPlataforma")({}), ["permission-denied"]);
  await adminAuth.setCustomUserClaims(platform.uid, {platformRole: "PLATFORM_SUPERADMIN"});
  await platform.user.getIdToken(true);

  const first = await call(owner, "createFirstBusiness")(businessInput("Empresa Platform Uno", "one"));
  const second = await call(secondOwner, "createFirstBusiness")(businessInput("Empresa Platform Dos", "two"));
  const retained = await call(owner, "createAdditionalBusiness")(businessInput("Empresa Platform Alterna", "retained"));
  const firstId = first.data.business.id; const secondId = second.data.business.id;
  const retainedId = retained.data.business.id;
  const fiscalSeed = Number(RUN_ID.split("-")[0].slice(-8));
  const firstProfile = profile("Empresa Platform Uno", validChileanRut(fiscalSeed));
  const secondProfile = profile("Empresa Platform Dos", validChileanRut(fiscalSeed + 1));
  await call(owner, "updateBusinessInformation")({businessId: firstId, profile: editableProfile(firstProfile)});
  await call(secondOwner, "updateBusinessInformation")({businessId: secondId, profile: editableProfile(secondProfile)});
  await adminDb.doc(`negocios/${firstId}/clientes/historico`).set({negocioId: firstId, nombre: "Cliente historico"});
  await adminDb.doc(`negocios/${secondId}/clientes/conservado`).set({negocioId: secondId, nombre: "Cliente conservado"});

  const firstVerificationRequestId = requestId("verification_one");
  const evidencePath = `negocios/${firstId}/verificacion/${owner.uid}/${firstVerificationRequestId}/documento.pdf`;
  await adminBucket.file(evidencePath).save(Buffer.from("platform evidence"), {
    contentType: "application/pdf",
  });
  const firstRequest = await call(owner, "solicitarVerificacionEmpresa")({
    businessId: firstId,
    requestId: firstVerificationRequestId,
    solicitud: {
      ...verification(firstProfile),
      documentoAcreditativo: {
        ruta: evidencePath,
        nombreOriginal: "acreditacion.pdf",
        tipoContenido: "application/pdf",
        tamanoBytes: Buffer.byteLength("platform evidence"),
      },
    },
  });
  const secondRequest = await call(secondOwner, "solicitarVerificacionEmpresa")({businessId: secondId, requestId: requestId("verification_two"), solicitud: verification(secondProfile)});

  const summary = await call(platform, "obtenerResumenPlataforma")({});
  assert.ok(summary.data.empresas.total >= 3); assert.ok(summary.data.usuarios.total >= 3);
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
  assert.ok(secondPage.data.cursor);
  const thirdPage = await call(platform, "listarEmpresasPlataforma")({
    limite: 1,
    cursor: secondPage.data.cursor,
    verificacion: "TODAS",
  });
  assert.equal(thirdPage.data.empresas.length, 1);
  assert.notEqual(thirdPage.data.empresas[0].id, secondPage.data.empresas[0].id);
  const pending = await call(platform, "listarEmpresasPlataforma")({limite: 20, verificacion: "PENDIENTE"});
  assert.ok(pending.data.empresas.some((item) => item.id === firstId));
  assert.ok(pending.data.empresas.some((item) => item.id === secondId));
  const searchedById = await call(platform, "listarEmpresasPlataforma")({
    busqueda: firstId,
    limite: 20,
  });
  assert.deepEqual(searchedById.data.empresas.map((item) => item.id), [firstId]);
  const searchedByOwner = await call(platform, "listarEmpresasPlataforma")({
    busqueda: owner.email,
    pais: "CL",
    limite: 20,
  });
  assert.ok(searchedByOwner.data.empresas.some((item) => item.id === firstId));
  assert.ok(searchedByOwner.data.empresas.some((item) => item.id === retainedId));
  const searchedVerification = await call(platform, "listarEmpresasPlataforma")({
    busqueda: firstProfile.identificadorFiscalValor.replace(/\D/g, ""),
    pais: "CL",
    verificacion: "PENDIENTE",
    modo: "VERIFICACIONES",
    limite: 20,
  });
  assert.ok(searchedVerification.data.empresas.some((item) => item.id === firstId));
  assert.ok(searchedVerification.data.empresas.every((item) =>
    String(item.identificadorFiscalValor).replace(/\D/g, "") ===
      firstProfile.identificadorFiscalValor.replace(/\D/g, "")
  ));
  const users = await call(platform, "listarUsuariosPlataforma")({limite: 20});
  assert.equal(users.data.usuarios.length, clients.length);
  const searchedUser = await call(platform, "listarUsuariosPlataforma")({
    busqueda: owner.email,
    estado: "ACTIVO",
    empresa: "CON_EMPRESA",
    limite: 20,
  });
  assert.deepEqual(searchedUser.data.usuarios.map((item) => item.uid), [owner.uid]);
  const withoutCompany = await call(platform, "listarUsuariosPlataforma")({
    busqueda: platform.email,
    empresa: "SIN_EMPRESA",
    limite: 20,
  });
  assert.ok(withoutCompany.data.usuarios.some((item) => item.uid === platform.uid));
  const firstUserPage = await call(platform, "listarUsuariosPlataforma")({limite: 1});
  assert.equal(firstUserPage.data.usuarios.length, 1);
  assert.ok(firstUserPage.data.cursor);
  const nextUserPage = await call(platform, "listarUsuariosPlataforma")({
    limite: 1,
    cursor: firstUserPage.data.cursor,
  });
  assert.equal(nextUserPage.data.usuarios.length, 1);
  assert.equal((await call(platform, "obtenerEmpresaPlataforma")({businessId: firstId})).data.propietario.uid, owner.uid);
  assert.ok((await call(platform, "obtenerUsuarioPlataforma")({uid: owner.uid})).data.membresias.some((item) => item.negocioId === firstId));

  await rejected("claim no abre SDK global", () => getDocs(collection(platform.db, "negocios")), ["permission-denied"]);
  await rejected("platform no falsea estado por SDK", () => updateDoc(doc(platform.db, "negocios", firstId), {estado: "suspendida"}), ["permission-denied"]);
  await rejected("usuario normal no abre evidencia", () => call(owner, "obtenerDocumentoVerificacionPlataforma")({businessId: firstId, solicitudId: firstRequest.data.solicitudId}), ["permission-denied"]);
  const evidence = await call(platform, "obtenerDocumentoVerificacionPlataforma")({businessId: firstId, solicitudId: firstRequest.data.solicitudId});
  assert.equal(evidence.data.nombre, "acreditacion.pdf");
  assert.equal(evidence.data.tipoContenido, "application/pdf");
  assert.match(evidence.data.url, /^https?:\/\//);
  assert.ok(new Date(evidence.data.expiraEn).getTime() - Date.now() <= 10 * 60 * 1000);

  await call(platform, "resolverVerificacionEmpresa")({businessId: firstId, solicitudId: firstRequest.data.solicitudId, decision: "APROBAR", motivo: "", razonSocialOficial: "Empresa Platform Uno Oficial SpA", requestId: requestId("approve")});
  await call(platform, "resolverVerificacionEmpresa")({businessId: secondId, solicitudId: secondRequest.data.solicitudId, decision: "RECHAZAR", motivo: "Documentacion insuficiente", razonSocialOficial: "", requestId: requestId("reject")});
  assert.equal((await adminDb.doc(`negocios/${firstId}`).get()).data().verificacionEmpresa.estado, "VERIFICADA");
  assert.equal((await adminDb.doc(`negocios/${secondId}`).get()).data().verificacionEmpresa.estado, "RECHAZADA");

  const suspendBusinessId = requestId("suspend_business");
  const suspendedBusiness = await call(platform, "cambiarEstadoEmpresaPlataforma")({businessId: firstId, estado: "suspendida", motivo: "Revision de cumplimiento", requestId: suspendBusinessId});
  const suspendedBusinessRetry = await call(platform, "cambiarEstadoEmpresaPlataforma")({businessId: firstId, estado: "suspendida", motivo: "Revision de cumplimiento", requestId: suspendBusinessId});
  assert.equal(suspendedBusiness.data.estado, "suspendida"); assert.equal(suspendedBusinessRetry.data.idempotent, true);
  await rejected("empresa suspendida no opera", () => call(owner, "updateBusinessInformation")({businessId: firstId, profile: editableProfile(firstProfile)}), ["failed-precondition"]);
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

  await adminDb.doc(`quotePublicTokens/delete-${RUN_ID}`).set({
    negocioId: firstId,
    estado: "active",
  });
  await adminBucket.file(`negocios/${firstId}/adjuntos/delete-test.txt`)
    .save(Buffer.from("delete me"), {contentType: "text/plain"});
  const retainedStoragePath = `negocios/${secondId}/adjuntos/keep-test.txt`;
  await adminBucket.file(retainedStoragePath)
    .save(Buffer.from("keep me"), {contentType: "text/plain"});
  await adminDb.doc(`usuarios/${owner.uid}`).set({
    negocioActivoId: firstId,
    primerNegocioId: firstId,
  }, {merge: true});
  const permanentDeleteId = requestId("permanent_delete");
  await rejected("usuario normal no elimina empresa", () => call(owner, "eliminarEmpresaPermanentePlataforma")({
    businessId: firstId,
    confirmacionNombreComercial: "Empresa Platform Uno",
    requestId: permanentDeleteId,
  }), ["permission-denied"]);
  await rejected("confirmacion de nombre incorrecta", () => call(platform, "eliminarEmpresaPermanentePlataforma")({
    businessId: firstId,
    confirmacionNombreComercial: "Empresa incorrecta",
    requestId: permanentDeleteId,
  }), ["failed-precondition"]);
  const deleted = await call(platform, "eliminarEmpresaPermanentePlataforma")({
    businessId: firstId,
    confirmacionNombreComercial: "Empresa Platform Uno",
    requestId: permanentDeleteId,
  });
  assert.equal(deleted.data.idempotent, false);
  const deletedRetry = await call(platform, "eliminarEmpresaPermanentePlataforma")({
    businessId: firstId,
    confirmacionNombreComercial: "Empresa Platform Uno",
    requestId: permanentDeleteId,
  });
  assert.equal(deletedRetry.data.idempotent, true);
  assert.equal((await adminDb.doc(`negocios/${firstId}`).get()).exists, false);
  assert.equal((await adminDb.doc(`negocios/${firstId}/clientes/historico`).get()).exists, false);
  assert.equal((await adminDb.collection("membresias").where("negocioId", "==", firstId).get()).empty, true);
  assert.equal((await adminDb.collection("quotePublicTokens").where("negocioId", "==", firstId).get()).empty, true);
  assert.equal((await adminDb.collection("identidadesFiscalesVerificadas").where("negocioId", "==", firstId).get()).empty, true);
  assert.equal((await adminBucket.file(evidencePath).exists())[0], false);
  assert.equal((await adminDb.doc(`negocios/${retainedId}`).get()).exists, true);
  assert.equal((await adminDb.doc(`negocios/${secondId}`).get()).exists, true);
  assert.equal((await adminDb.doc(`negocios/${secondId}/clientes/conservado`).get()).exists, true);
  assert.equal((await adminBucket.file(retainedStoragePath).exists())[0], true);
  assert.equal((await adminAuth.getUser(owner.uid)).uid, owner.uid);
  assert.equal((await adminDb.doc(`usuarios/${owner.uid}`).get()).data().negocioActivoId, retainedId);
  assert.equal((await adminDb.doc(`auditoriaPlataforma/${permanentDeleteId}`).get()).data().estado, "COMPLETADA");
  const absent = await call(platform, "listarEmpresasPlataforma")({busqueda: firstId, limite: 20});
  assert.equal(absent.data.empresas.length, 0);
  console.log("Platform admin integrated: OK");
} finally {
  await Promise.all(clients.map(async (target) => { try { await terminate(target.db); } catch {} try { await deleteApp(target.app); } catch {} }));
  await deleteAdminApp(adminApp);
}
