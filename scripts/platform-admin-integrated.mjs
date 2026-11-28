import assert from "node:assert/strict";
import {createHash} from "node:crypto";
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
const {FieldPath, FieldValue} = requireFromFunctions("firebase-admin/firestore");
const {HttpsError} = requireFromFunctions("firebase-functions/v2/https");
const {
  cambiarModulosEmpresaPlataformaHandler,
  listarEmpresasPlataformaHandler,
  obtenerEmpresaPlataformaHandler,
} = requireFromFunctions("./platformAdmin");
const {
  EMAIL_EVENT: RECOVERY_EMAIL_EVENT,
  PROFILE_EVENT: RECOVERY_PROFILE_EVENT,
  RESET_EVENT: RECOVERY_RESET_EVENT,
  cambiarCorreoUsuarioPlataformaHandler,
  restablecerContrasenaUsuarioPlataformaHandler,
} = requireFromFunctions("./platformUsersAdmin");
const {resolverVerificacionEmpresaHandler} = requireFromFunctions("./businessVerification");
const {VERTICAL_MODULES} = requireFromFunctions("./verticalModules");

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
const secondPlatform = await authenticate(client("second-platform"), "second-platform");
const thirdPlatform = await authenticate(client("third-platform"), "third-platform");
const clients = [platform, owner, secondOwner, secondPlatform, thirdPlatform];
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
  await adminAuth.setCustomUserClaims(secondPlatform.uid, {platformRole: "PLATFORM_SUPERADMIN"});
  await secondPlatform.user.getIdToken(true);
  await adminAuth.setCustomUserClaims(thirdPlatform.uid, {platformRole: "PLATFORM_SUPERADMIN"});
  await thirdPlatform.user.getIdToken(true);

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

  // Dashboard: las verificaciones pendientes más antiguas primero (máximo 5) y el conteo se conserva.
  const dashboard = (await call(platform, "obtenerResumenPlataforma")({})).data;
  const oldestPending = dashboard.verificacionesPendientesAntiguas;
  assert.ok(Array.isArray(oldestPending) && oldestPending.length <= 5);
  assert.ok(dashboard.empresas.verificacionesPendientes >= 2);
  assert.ok(oldestPending.some((item) => item.id === firstId) && oldestPending.some((item) => item.id === secondId));
  assert.ok(oldestPending.findIndex((item) => item.id === firstId) < oldestPending.findIndex((item) => item.id === secondId), "la solicitud más antigua va primero");
  assert.ok(oldestPending.every((item) => item.verificacion === "PENDIENTE" && item.fechaSolicitud && item.nombreComercial));
  assert.deepEqual(oldestPending.map((item) => item.fechaSolicitud), [...oldestPending.map((item) => item.fechaSolicitud)].sort());
  assert.equal(oldestPending.find((item) => item.id === firstId).propietario.correo, owner.email);
  await rejected("usuario normal no ve el Dashboard", () => call(owner, "obtenerResumenPlataforma")({}), ["permission-denied"]);

  // Filtro por cuenta: solo empresas donde la cuenta es OWNER (membresias).
  const ownedByOwner = (await call(platform, "listarEmpresasPlataforma")({uid: owner.uid, limite: 20})).data;
  assert.deepEqual(ownedByOwner.empresas.map((item) => item.id).sort(), [firstId, retainedId].sort());
  assert.equal(ownedByOwner.cursor, null);
  assert.deepEqual(ownedByOwner.cuenta, {uid: owner.uid, nombre: ownedByOwner.cuenta.nombre, correo: owner.email});
  assert.ok(ownedByOwner.empresas.every((item) => item.propietario.uid === owner.uid));
  const ownedBySecond = (await call(platform, "listarEmpresasPlataforma")({uid: secondOwner.uid, limite: 20})).data;
  assert.deepEqual(ownedBySecond.empresas.map((item) => item.id), [secondId]);
  const ownedPage1 = (await call(platform, "listarEmpresasPlataforma")({uid: owner.uid, limite: 1})).data;
  assert.equal(ownedPage1.empresas.length, 1); assert.ok(ownedPage1.cursor);
  const ownedPage2 = (await call(platform, "listarEmpresasPlataforma")({uid: owner.uid, limite: 1, cursor: ownedPage1.cursor})).data;
  assert.equal(ownedPage2.empresas.length, 1); assert.equal(ownedPage2.cursor, null);
  assert.deepEqual([ownedPage1.empresas[0].id, ownedPage2.empresas[0].id].sort(), [firstId, retainedId].sort());
  assert.deepEqual((await call(platform, "listarEmpresasPlataforma")({uid: owner.uid, verificacion: "PENDIENTE", limite: 20})).data.empresas.map((item) => item.id), [firstId]);
  assert.deepEqual((await call(platform, "listarEmpresasPlataforma")({uid: owner.uid, busqueda: "Alterna", limite: 20})).data.empresas.map((item) => item.id), [retainedId]);
  assert.deepEqual((await call(platform, "listarEmpresasPlataforma")({uid: platform.uid, limite: 20})).data.empresas, []);
  // Ser miembro (no OWNER) de otra empresa no la lista bajo esa cuenta.
  const memberOnlyRef = adminDb.doc(`membresias/${firstId}__${secondOwner.uid}`);
  await memberOnlyRef.set({negocioId: firstId, uid: secondOwner.uid, rol: "ADMIN", estado: "activo", creadoEn: FieldValue.serverTimestamp()});
  assert.deepEqual((await call(platform, "listarEmpresasPlataforma")({uid: secondOwner.uid, limite: 20})).data.empresas.map((item) => item.id), [secondId]);
  await memberOnlyRef.delete();
  await rejected("cuenta inexistente en el filtro", () => call(platform, "listarEmpresasPlataforma")({uid: `no-existe-${RUN_ID}`}), ["not-found"]);
  await rejected("uid con formato invalido", () => call(platform, "listarEmpresasPlataforma")({uid: "uid con espacios"}), ["invalid-argument"]);
  await rejected("cursor ajeno a la cuenta", () => call(platform, "listarEmpresasPlataforma")({uid: owner.uid, cursor: secondId}), ["invalid-argument"]);
  await rejected("usuario normal no filtra por cuenta", () => call(owner, "listarEmpresasPlataforma")({uid: owner.uid}), ["permission-denied"]);
  // Sin uid el directorio sigue mostrando todas las empresas.
  assert.ok((await call(platform, "listarEmpresasPlataforma")({limite: 20})).data.empresas.some((item) => item.id === secondId));
  console.log("OK dashboard con pendientes antiguas y directorio filtrado por cuenta");

  // Interruptor de modulos por negocio (Function cambiarModulosEmpresaPlataforma).
  // El emulador valida el registro real de verticales; los escenarios con
  // multiples modulos se prueban invocando el handler real con un registro
  // de prueba inyectado por dependencias.
  const modulesReason = "Activacion acordada con el cliente";
  await rejected("usuario normal no cambia modulos", () => call(owner, "cambiarModulosEmpresaPlataforma")({businessId: secondId, modulos: [], motivo: modulesReason, requestId: requestId("modules_normal")}), ["permission-denied"]);
  await rejected("modulo desconocido contra el registro real", () => call(platform, "cambiarModulosEmpresaPlataforma")({businessId: secondId, modulos: ["modulo-inexistente"], motivo: modulesReason, requestId: requestId("modules_unknown")}), ["invalid-argument"]);
  const emptyModulesId = requestId("modules_empty");
  const emptyModules = await call(platform, "cambiarModulosEmpresaPlataforma")({businessId: secondId, modulos: [], motivo: modulesReason, requestId: emptyModulesId});
  assert.deepEqual(emptyModules.data.modulosHabilitados, []); assert.equal(emptyModules.data.idempotent, false);
  assert.equal((await call(platform, "cambiarModulosEmpresaPlataforma")({businessId: secondId, modulos: [], motivo: modulesReason, requestId: emptyModulesId})).data.idempotent, true);
  assert.equal((await adminDb.collection(`negocios/${secondId}/eventosPlataforma`).get()).size, 0);
  const secondDetail = (await call(platform, "obtenerEmpresaPlataforma")({businessId: secondId})).data;
  assert.deepEqual(secondDetail.empresa.modulosHabilitados, []);
  assert.deepEqual(secondDetail.modulosDisponibles, VERTICAL_MODULES.map((item) => ({...item})));

  const testRegistry = Object.freeze([
    {id: "taller", label: "Taller", basePath: "/taller"},
    {id: "veterinaria", label: "Clinica veterinaria", basePath: "/clinica-veterinaria"},
  ]);
  const handlerDeps = {auth: adminAuth, db: adminDb, FieldPath, FieldValue, HttpsError, verticalModules: testRegistry};
  const asRequest = (uid, platformRole, data) => ({auth: {uid, token: platformRole ? {platformRole} : {}}, data});
  const superRequest = (data) => asRequest(platform.uid, "PLATFORM_SUPERADMIN", data);
  const modulesEvents = () => adminDb.collection(`negocios/${secondId}/eventosPlataforma`).get();
  const enableId = requestId("modules_enable");
  const enableData = {businessId: secondId, modulos: ["veterinaria", "taller", "taller"], motivo: modulesReason, requestId: enableId};
  const enabled = await cambiarModulosEmpresaPlataformaHandler(superRequest(enableData), handlerDeps);
  assert.deepEqual(enabled.modulosHabilitados, ["taller", "veterinaria"]); assert.equal(enabled.idempotent, false);
  assert.deepEqual((await adminDb.doc(`negocios/${secondId}`).get()).data().modulosHabilitados, ["taller", "veterinaria"]);
  let moduleEvents = await modulesEvents();
  assert.equal(moduleEvents.size, 1);
  const enableEvent = moduleEvents.docs[0].data();
  assert.equal(enableEvent.tipo, "modulos_actualizados"); assert.deepEqual(enableEvent.modulosAnteriores, []);
  assert.deepEqual(enableEvent.modulosResultantes, ["taller", "veterinaria"]); assert.equal(enableEvent.motivo, modulesReason);
  assert.equal(enableEvent.creadoPorUid, platform.uid); assert.ok(enableEvent.creadoEn);
  assert.equal((await adminDb.doc(`negocios/${secondId}/platformModulesRequests/${enableId}`).get()).exists, true);
  const enableRetry = await cambiarModulosEmpresaPlataformaHandler(superRequest(enableData), handlerDeps);
  assert.equal(enableRetry.idempotent, true); assert.deepEqual(enableRetry.modulosHabilitados, ["taller", "veterinaria"]);
  assert.equal((await modulesEvents()).size, 1);
  await rejected("requestId de modulos reutilizado con otros datos", () => cambiarModulosEmpresaPlataformaHandler(superRequest({...enableData, modulos: ["taller"]}), handlerDeps), ["already-exists"]);
  await rejected("modulo desconocido en el registro de prueba", () => cambiarModulosEmpresaPlataformaHandler(superRequest({...enableData, modulos: ["taller", "inexistente"], requestId: requestId("modules_bad")}), handlerDeps), ["invalid-argument"]);
  await rejected("modulos sin motivo", () => cambiarModulosEmpresaPlataformaHandler(superRequest({...enableData, motivo: "  ", requestId: requestId("modules_noreason")}), handlerDeps), ["invalid-argument"]);
  await rejected("modulos que no son una lista", () => cambiarModulosEmpresaPlataformaHandler(superRequest({...enableData, modulos: "taller", requestId: requestId("modules_notlist")}), handlerDeps), ["invalid-argument"]);
  await rejected("handler de modulos sin claim de plataforma", () => cambiarModulosEmpresaPlataformaHandler(asRequest(owner.uid, null, {...enableData, requestId: requestId("modules_noclaim")}), handlerDeps), ["permission-denied"]);
  assert.equal((await modulesEvents()).size, 1);
  const registryDetail = await obtenerEmpresaPlataformaHandler(superRequest({businessId: secondId}), handlerDeps);
  assert.deepEqual(registryDetail.empresa.modulosHabilitados, ["taller", "veterinaria"]);
  assert.deepEqual(registryDetail.modulosDisponibles, testRegistry.map((item) => ({...item})));
  const moduleEvent = registryDetail.eventos.find((item) => item.tipo === "modulos_actualizados");
  assert.deepEqual(moduleEvent.modulosResultantes, ["taller", "veterinaria"]);
  const disabled = await cambiarModulosEmpresaPlataformaHandler(superRequest({businessId: secondId, modulos: ["veterinaria"], motivo: "Fin de la prueba de Taller", requestId: requestId("modules_disable")}), handlerDeps);
  assert.deepEqual(disabled.modulosHabilitados, ["veterinaria"]);
  moduleEvents = await modulesEvents();
  assert.equal(moduleEvents.size, 2);
  assert.ok(moduleEvents.docs.some((item) => JSON.stringify(item.data().modulosAnteriores) === JSON.stringify(["taller", "veterinaria"]) && JSON.stringify(item.data().modulosResultantes) === JSON.stringify(["veterinaria"])));
  await cambiarModulosEmpresaPlataformaHandler(superRequest({businessId: secondId, modulos: [], motivo: "Limpieza", requestId: requestId("modules_clear")}), handlerDeps);
  await cambiarModulosEmpresaPlataformaHandler(superRequest({businessId: secondId, modulos: [], motivo: "Sin cambios", requestId: requestId("modules_nochange")}), handlerDeps);
  assert.equal((await modulesEvents()).size, 3);
  assert.deepEqual((await adminDb.doc(`negocios/${secondId}`).get()).data().modulosHabilitados, []);
  await rejected("SDK cliente no escribe modulosHabilitados", () => updateDoc(doc(secondOwner.db, "negocios", secondId), {modulosHabilitados: ["taller"]}), ["permission-denied"]);

  // Regresion: las actualizaciones del negocio que no cambian el rubro no tocan modulosHabilitados (SPEC 039: solo un
  // cambio real de rubro los recalcula; eso se prueba en business-onboarding-integrated). Aqui el rubro no cambia.
  await cambiarModulosEmpresaPlataformaHandler(superRequest({businessId: secondId, modulos: ["taller", "veterinaria"], motivo: "Prueba de regresion", requestId: requestId("modules_regression")}), handlerDeps);
  const enabledModulesNow = async () => (await adminDb.doc(`negocios/${secondId}`).get()).data().modulosHabilitados;
  assert.deepEqual(await enabledModulesNow(), ["taller", "veterinaria"]);
  const regressionProfile = {...editableProfile(secondProfile), telefono: "+56 9 8765 4321"};
  await call(secondOwner, "updateBusinessProfile")({businessId: secondId, profile: regressionProfile});
  assert.deepEqual(await enabledModulesNow(), ["taller", "veterinaria"]);
  await call(secondOwner, "updateBusinessInformation")({businessId: secondId, profile: regressionProfile});
  assert.deepEqual(await enabledModulesNow(), ["taller", "veterinaria"]);
  console.log("OK regresion: updateBusinessProfile y updateBusinessInformation sin cambio de rubro conservan modulosHabilitados");
  await cambiarModulosEmpresaPlataformaHandler(superRequest({businessId: secondId, modulos: [], motivo: "Fin de la regresion", requestId: requestId("modules_regression_clear")}), handlerDeps);
  assert.deepEqual(await enabledModulesNow(), []);

  await rejected("claim no abre SDK global", () => getDocs(collection(platform.db, "negocios")), ["permission-denied"]);
  await rejected("platform no falsea estado por SDK", () => updateDoc(doc(platform.db, "negocios", firstId), {estado: "suspendida"}), ["permission-denied"]);
  await rejected("usuario normal no abre evidencia", () => call(owner, "obtenerDocumentoVerificacionPlataforma")({businessId: firstId, solicitudId: firstRequest.data.solicitudId}), ["permission-denied"]);
  const evidence = await call(platform, "obtenerDocumentoVerificacionPlataforma")({businessId: firstId, solicitudId: firstRequest.data.solicitudId});
  assert.equal(evidence.data.nombre, "acreditacion.pdf");
  assert.equal(evidence.data.tipoContenido, "application/pdf");
  assert.match(evidence.data.url, /^https?:\/\//);
  assert.ok(new Date(evidence.data.expiraEn).getTime() - Date.now() <= 10 * 60 * 1000);

  // Un único guardia de plataforma: el claim sale de Auth (no del token) y la cuenta debe estar activa,
  // también en resolverVerificacionEmpresa.
  const guardResolveData = {businessId: firstId, solicitudId: firstRequest.data.solicitudId, decision: "RECHAZAR", motivo: "Prueba del guardia", razonSocialOficial: "", requestId: requestId("guard_resolve")};
  await adminAuth.setCustomUserClaims(thirdPlatform.uid, {});
  await rejected("claim revocado en Auth con token vigente: resolver verificacion", () => call(thirdPlatform, "resolverVerificacionEmpresa")(guardResolveData), ["permission-denied"]);
  await rejected("claim revocado en Auth con token vigente: directorio", () => call(thirdPlatform, "listarEmpresasPlataforma")({}), ["permission-denied"]);
  await rejected("handler de plataforma: el claim solo del token no basta", () => listarEmpresasPlataformaHandler(asRequest(thirdPlatform.uid, "PLATFORM_SUPERADMIN", {}), handlerDeps), ["permission-denied"]);
  await rejected("handler de verificacion: el claim solo del token no basta", () => resolverVerificacionEmpresaHandler(asRequest(thirdPlatform.uid, "PLATFORM_SUPERADMIN", guardResolveData), {...handlerDeps, bucket: adminBucket}), ["permission-denied"]);
  await adminAuth.setCustomUserClaims(thirdPlatform.uid, {platformRole: "PLATFORM_SUPERADMIN"});
  await adminAuth.updateUser(thirdPlatform.uid, {disabled: true});
  await rejected("cuenta de plataforma deshabilitada en Auth: resolver verificacion", () => call(thirdPlatform, "resolverVerificacionEmpresa")(guardResolveData), ["permission-denied"]);
  await rejected("handler: cuenta de plataforma deshabilitada", () => listarEmpresasPlataformaHandler(asRequest(thirdPlatform.uid, null, {}), handlerDeps), ["permission-denied"]);
  await rejected("handler de verificacion: cuenta de plataforma deshabilitada", () => resolverVerificacionEmpresaHandler(asRequest(thirdPlatform.uid, null, guardResolveData), {...handlerDeps, bucket: adminBucket}), ["permission-denied"]);
  await adminAuth.updateUser(thirdPlatform.uid, {disabled: false});
  await adminDb.doc(`usuarios/${thirdPlatform.uid}`).set({estadoPlataforma: "suspendido"}, {merge: true});
  await rejected("cuenta de plataforma suspendida (estado persistido): resolver verificacion", () => call(thirdPlatform, "resolverVerificacionEmpresa")(guardResolveData), ["permission-denied"]);
  await rejected("handler: cuenta de plataforma suspendida", () => listarEmpresasPlataformaHandler(asRequest(thirdPlatform.uid, null, {}), handlerDeps), ["permission-denied"]);
  await rejected("handler de verificacion: cuenta de plataforma suspendida", () => resolverVerificacionEmpresaHandler(asRequest(thirdPlatform.uid, null, guardResolveData), {...handlerDeps, bucket: adminBucket}), ["permission-denied"]);
  await adminDb.doc(`usuarios/${thirdPlatform.uid}`).set({estadoPlataforma: "activo"}, {merge: true});
  assert.equal((await adminDb.doc(`negocios/${firstId}`).get()).data().verificacionEmpresa.estado, "PENDIENTE", "los rechazos no resuelven la solicitud");
  assert.equal((await adminDb.doc(`negocios/${firstId}/platformVerificationDecisionRequests/${guardResolveData.requestId}`).get()).exists, false);
  assert.ok((await call(thirdPlatform, "listarEmpresasPlataforma")({limite: 1})).data.empresas.length >= 0, "la cuenta activa con claim en Auth vuelve a operar");
  console.log("OK guardia unico de plataforma: claim de Auth y cuenta activa en todas las Functions");

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

  // Regresion de updateBusinessSettings: exige empresa verificada, por eso va con firstId.
  await cambiarModulosEmpresaPlataformaHandler(superRequest({businessId: firstId, modulos: ["taller"], motivo: "Regresion de configuracion", requestId: requestId("modules_settings_on")}), handlerDeps);
  const firstModulesNow = async () => (await adminDb.doc(`negocios/${firstId}`).get()).data().modulosHabilitados;
  assert.deepEqual(await firstModulesNow(), ["taller"]);
  await call(owner, "updateBusinessSettings")({businessId: firstId, section: "inventario", settings: {alertasStockBajo: true, umbralStockBajo: 3, permitirStockNegativo: false}});
  assert.deepEqual(await firstModulesNow(), ["taller"]);
  await call(owner, "updateBusinessSettings")({businessId: firstId, section: "cotizaciones", settings: {validezCotizacionDias: 20}});
  assert.deepEqual(await firstModulesNow(), ["taller"]);
  console.log("OK regresion: updateBusinessSettings conserva modulosHabilitados");
  await cambiarModulosEmpresaPlataformaHandler(superRequest({businessId: firstId, modulos: [], motivo: "Fin de la regresion", requestId: requestId("modules_settings_off")}), handlerDeps);

  const suspendUserId = requestId("suspend_user");
  await call(platform, "cambiarEstadoUsuarioPlataforma")({uid: owner.uid, estado: "suspendido", motivo: "Revision de cuenta", requestId: suspendUserId});
  const suspendUserRetry = await call(platform, "cambiarEstadoUsuarioPlataforma")({uid: owner.uid, estado: "suspendido", motivo: "Revision de cuenta", requestId: suspendUserId});
  assert.equal(suspendUserRetry.data.idempotent, true);
  assert.equal((await adminAuth.getUser(owner.uid)).disabled, true);
  // El detalle devuelve el motivo de la suspensión, en la cuenta y en su evento.
  const suspendedDetail = (await call(platform, "obtenerUsuarioPlataforma")({uid: owner.uid})).data;
  assert.equal(suspendedDetail.usuario.estado, "suspendido");
  assert.equal(suspendedDetail.usuario.motivoSuspension, "Revision de cuenta");
  assert.equal(suspendedDetail.eventos.length, 1);
  assert.equal(suspendedDetail.eventos[0].tipo, "USUARIO_SUSPENDIDO");
  assert.equal(suspendedDetail.eventos[0].motivo, "Revision de cuenta");
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
  const reactivatedDetail = (await call(platform, "obtenerUsuarioPlataforma")({uid: owner.uid})).data;
  assert.equal(reactivatedDetail.usuario.estado, "activo");
  assert.equal(reactivatedDetail.usuario.motivoSuspension, "", "una cuenta activa no muestra motivo de suspension");
  assert.equal(reactivatedDetail.eventos.find((item) => item.tipo === "USUARIO_SUSPENDIDO").motivo, "Revision de cuenta");
  assert.equal(reactivatedDetail.eventos.find((item) => item.tipo === "USUARIO_REACTIVADO").motivo, "");
  console.log("OK obtenerUsuarioPlataforma devuelve el motivo de suspension y de sus eventos");

  // Las cuentas de plataforma no se suspenden desde el panel: ni la propia ni otra con claim.
  const selfSuspendRequestId = requestId("suspend_self");
  const platformTargetRequestId = requestId("suspend_platform");
  await rejected("superadmin no se suspende a si mismo", () => call(platform, "cambiarEstadoUsuarioPlataforma")({uid: platform.uid, estado: "suspendido", motivo: "Prueba de autosuspension", requestId: selfSuspendRequestId}), ["failed-precondition"]);
  await rejected("superadmin no suspende a otra cuenta de plataforma", () => call(platform, "cambiarEstadoUsuarioPlataforma")({uid: secondPlatform.uid, estado: "suspendido", motivo: "Prueba de cuenta de plataforma", requestId: platformTargetRequestId}), ["failed-precondition"]);
  for (const target of [platform, secondPlatform]) {
    assert.equal((await adminAuth.getUser(target.uid)).disabled, false);
    assert.equal((await adminDb.collection(`usuarios/${target.uid}/eventosPlataforma`).get()).size, 0);
    assert.notEqual((await adminDb.doc(`usuarios/${target.uid}`).get()).data()?.estadoPlataforma, "suspendido");
  }
  for (const operationId of [selfSuspendRequestId, platformTargetRequestId]) {
    assert.equal((await adminDb.doc(`platformUserStatusRequests/${operationId}`).get()).exists, false);
  }
  assert.equal((await call(platform, "obtenerUsuarioPlataforma")({uid: secondPlatform.uid})).data.usuario.estado, "activo");

  // --- Recuperacion de cuenta (functions/platformUsersAdmin.js) ---
  const newAccount = (name, options = {}) => adminAuth.createUser({email: `recovery-${name}-${RUN_ID}@example.test`.toLowerCase(), password: `Recovery-${RUN_ID}-Pass!`, ...options});
  const recoveryTarget = await newAccount("target");
  const recoveryOther = await newAccount("other");
  const recover = (name, data) => call(platform, name)(data);
  const recoveryOperations = () => adminDb.collection("platformUserRecoveryRequests").get();
  const recoveryEvents = (uid) => adminDb.collection(`usuarios/${uid}/eventosPlataforma`).get();
  const operationsBefore = (await recoveryOperations()).size;
  // Cuenta que entra solo con Google: el emulador de Auth acepta un id_token en JSON.
  const googleSignIn = await (await fetch(`http://127.0.0.1:${AUTH_EMULATOR_PORT}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({
      postBody: `id_token=${encodeURIComponent(JSON.stringify({sub: `google-${RUN_ID}`, email: `recovery-google-${RUN_ID}@example.test`.toLowerCase(), email_verified: true}))}&providerId=google.com`,
      requestUri: "http://localhost",
      returnIdpCredential: true,
      returnSecureToken: true,
    }),
  })).json();
  const googleUid = googleSignIn.localId;
  assert.ok(googleUid, `no se pudo crear la cuenta solo Google: ${JSON.stringify(googleSignIn)}`);
  assert.deepEqual((await adminAuth.getUser(googleUid)).providerData.map((provider) => provider.providerId), ["google.com"]);

  // Bloqueos y validaciones: ninguna accion deja operaciones ni eventos.
  const blocked = [
    ["restablecerContrasenaUsuarioPlataforma", {}],
    ["cambiarCorreoUsuarioPlataforma", {correoNuevo: `bloqueado-${RUN_ID}@example.test`}],
    ["editarUsuarioPlataforma", {cambios: {nombres: "Bloqueado"}}],
  ];
  for (const [name, extra] of blocked) {
    const data = (uid, patch = {}) => ({uid, motivo: "Prueba de bloqueo", requestId: requestId(`block_${name}`), ...extra, ...patch});
    await rejected(`${name}: usuario normal`, () => call(owner, name)(data(recoveryTarget.uid)), ["permission-denied"]);
    await rejected(`${name}: sin motivo`, () => recover(name, data(recoveryTarget.uid, {motivo: "  "})), ["invalid-argument"]);
    await rejected(`${name}: cuenta propia`, () => recover(name, data(platform.uid)), ["failed-precondition"]);
    await rejected(`${name}: otro superadmin`, () => recover(name, data(secondPlatform.uid)), ["failed-precondition"]);
    await rejected(`${name}: cuenta solo Google`, () => recover(name, data(googleUid)), ["failed-precondition"]);
    await rejected(`${name}: usuario inexistente`, () => recover(name, data("usuarioInexistente123")), ["not-found"]);
  }
  for (const uid of [platform.uid, secondPlatform.uid, googleUid]) {
    assert.equal((await recoveryEvents(uid)).size, 0, "los bloqueos no escriben eventos");
  }
  assert.equal((await recoveryOperations()).size, operationsBefore, "los bloqueos no crean operaciones");
  assert.equal((await adminAuth.getUser(googleUid)).email, `recovery-google-${RUN_ID}@example.test`.toLowerCase());

  // Restablecimiento de contrasena: en emulador el envio se simula y el enlace no vuelve al navegador.
  const resetId = requestId("recovery_reset");
  const reset = await recover("restablecerContrasenaUsuarioPlataforma", {uid: recoveryTarget.uid, motivo: "Perdio la contrasena", requestId: resetId});
  assert.equal(reset.data.enviado, true);
  assert.equal(reset.data.envio, "simulado");
  assert.doesNotMatch(JSON.stringify(reset.data), /https?:|oobCode/, "la respuesta no incluye el enlace");
  assert.equal((await recover("restablecerContrasenaUsuarioPlataforma", {uid: recoveryTarget.uid, motivo: "Perdio la contrasena", requestId: resetId})).data.idempotent, true);
  await rejected("restablecimiento: requestId reutilizado con otro motivo", () => recover("restablecerContrasenaUsuarioPlataforma", {uid: recoveryTarget.uid, motivo: "Otro motivo", requestId: resetId}), ["already-exists"]);
  const resetEvent = (await adminDb.doc(`usuarios/${recoveryTarget.uid}/eventosPlataforma/${resetId}`).get()).data();
  assert.equal(resetEvent.tipo, RECOVERY_RESET_EVENT);
  assert.equal(resetEvent.motivo, "Perdio la contrasena");
  assert.equal(resetEvent.creadoPorUid, platform.uid);

  // Cambio de correo.
  const newEmail = `Recovery-Nuevo-${RUN_ID}@Example.test`;
  const changeData = (patch = {}) => ({uid: recoveryTarget.uid, correoNuevo: newEmail, motivo: "Perdio acceso al correo", requestId: requestId("recovery_email"), ...patch});
  await rejected("correo: formato invalido", () => recover("cambiarCorreoUsuarioPlataforma", changeData({correoNuevo: "no-es-un-correo", requestId: requestId("recovery_email_bad")})), ["invalid-argument"]);
  await rejected("correo: ya esta en uso", () => recover("cambiarCorreoUsuarioPlataforma", changeData({correoNuevo: recoveryOther.email, requestId: requestId("recovery_email_used")})), ["already-exists"]);
  await rejected("correo: igual al actual", () => recover("cambiarCorreoUsuarioPlataforma", changeData({correoNuevo: recoveryTarget.email, requestId: requestId("recovery_email_same")})), ["failed-precondition"]);
  assert.equal((await adminAuth.getUser(recoveryTarget.uid)).email, recoveryTarget.email, "los rechazos no cambian el correo");
  await adminAuth.updateUser(recoveryTarget.uid, {emailVerified: true});
  const changeStartedAt = Date.now();
  const changed = await recover("cambiarCorreoUsuarioPlataforma", changeData());
  assert.equal(changed.data.correo, newEmail.toLowerCase());
  assert.equal(changed.data.avisoCorreoAnterior, "simulado");
  const changedAuth = await adminAuth.getUser(recoveryTarget.uid);
  assert.equal(changedAuth.email, newEmail.toLowerCase());
  assert.equal(changedAuth.emailVerified, false, "el correo nuevo queda sin verificar");
  assert.ok(new Date(changedAuth.tokensValidAfterTime).getTime() >= changeStartedAt - 2000, "se revocaron las sesiones");
  assert.equal((await adminDb.doc(`usuarios/${recoveryTarget.uid}`).get()).data().email, newEmail.toLowerCase());
  const emailEvent = (await adminDb.doc(`usuarios/${recoveryTarget.uid}/eventosPlataforma/${requestId("recovery_email")}`).get()).data();
  assert.equal(emailEvent.tipo, RECOVERY_EMAIL_EVENT);
  assert.equal(emailEvent.correoAnterior, recoveryTarget.email);
  assert.equal(emailEvent.correoNuevo, newEmail.toLowerCase());
  assert.equal(emailEvent.motivo, "Perdio acceso al correo");
  assert.equal((await recover("cambiarCorreoUsuarioPlataforma", changeData())).data.idempotent, true);
  await rejected("correo: requestId reutilizado con otro correo", () => recover("cambiarCorreoUsuarioPlataforma", changeData({correoNuevo: `otro-${RUN_ID}@example.test`})), ["already-exists"]);
  assert.equal((await adminAuth.getUser(recoveryTarget.uid)).email, newEmail.toLowerCase(), "el reintento no vuelve a cambiar el correo");

  // Edicion de perfil: lista blanca de campos.
  const editData = (cambios, patch = {}) => ({uid: recoveryTarget.uid, cambios, motivo: "Datos corregidos", requestId: requestId("recovery_edit"), ...patch});
  await rejected("edicion: campo fuera de la lista blanca", () => recover("editarUsuarioPlataforma", editData({nombres: "Ana", rol: "OWNER"}, {requestId: requestId("recovery_edit_bad")})), ["invalid-argument"]);
  await rejected("edicion: sin cambios", () => recover("editarUsuarioPlataforma", editData({}, {requestId: requestId("recovery_edit_empty")})), ["invalid-argument"]);
  await rejected("edicion: nombre vacio", () => recover("editarUsuarioPlataforma", editData({nombres: "  "}, {requestId: requestId("recovery_edit_name")})), ["invalid-argument"]);
  const edited = await recover("editarUsuarioPlataforma", editData({nombres: "Ana", telefonoPersonal: "+591 700 00000"}));
  assert.deepEqual([...edited.data.camposModificados].sort(), ["nombres", "telefonoPersonal"]);
  const editedProfile = (await adminDb.doc(`usuarios/${recoveryTarget.uid}/cuenta/perfil`).get()).data();
  assert.equal(editedProfile.nombres, "Ana");
  assert.equal(editedProfile.telefonoPersonal, "+591 700 00000");
  assert.equal((await adminDb.doc(`usuarios/${recoveryTarget.uid}/eventosPlataforma/${requestId("recovery_edit")}`).get()).data().tipo, RECOVERY_PROFILE_EVENT);
  assert.equal((await recover("editarUsuarioPlataforma", editData({nombres: "Ana", telefonoPersonal: "+591 700 00000"}))).data.idempotent, true);
  await rejected("edicion: sin cambios reales", () => recover("editarUsuarioPlataforma", editData({nombres: "Ana"}, {requestId: requestId("recovery_edit_same")})), ["failed-precondition"]);
  await recover("editarUsuarioPlataforma", editData({telefonoPersonal: ""}, {requestId: requestId("recovery_edit_clear")}));
  assert.equal((await adminDb.doc(`usuarios/${recoveryTarget.uid}/cuenta/perfil`).get()).data().telefonoPersonal, undefined);

  // La ficha devuelve proveedores, rol y los campos nuevos de los eventos.
  const recoveryDetail = (await call(platform, "obtenerUsuarioPlataforma")({uid: recoveryTarget.uid})).data;
  assert.deepEqual(recoveryDetail.usuario.proveedores, ["password"]);
  assert.equal(recoveryDetail.usuario.esSuperadmin, false);
  assert.equal(recoveryDetail.usuario.nombres, "Ana");
  const detailEmailEvent = recoveryDetail.eventos.find((item) => item.tipo === RECOVERY_EMAIL_EVENT);
  assert.equal(detailEmailEvent.correoAnterior, recoveryTarget.email);
  assert.equal(detailEmailEvent.correoNuevo, newEmail.toLowerCase());
  assert.equal(detailEmailEvent.avisoCorreoAnterior, "simulado");
  assert.ok(recoveryDetail.eventos.some((item) => item.tipo === RECOVERY_PROFILE_EVENT && item.camposModificados.includes("nombres")));
  assert.deepEqual((await call(platform, "obtenerUsuarioPlataforma")({uid: googleUid})).data.usuario.proveedores, ["google.com"]);
  assert.equal((await call(platform, "obtenerUsuarioPlataforma")({uid: secondPlatform.uid})).data.usuario.esSuperadmin, true);

  // Envio real (proveedor inyectado): el enlace va al correo del usuario y el aviso al correo anterior.
  const sentMail = [];
  const mailDeps = {
    auth: adminAuth, db: adminDb, FieldValue, HttpsError,
    isEmulatorEnvironment: () => false,
    getResendApiKey: () => "clave-de-prueba",
    getEmailSender: () => "ValoraCloud <no-reply@example.test>",
    sendEmail: async (message) => { sentMail.push(message); },
  };
  const asPlatform = (data) => ({auth: {uid: platform.uid, token: {}}, data});
  const mailTarget = await newAccount("mail");
  const mailResetId = requestId("recovery_mail_reset");
  const mailReset = await restablecerContrasenaUsuarioPlataformaHandler(asPlatform({uid: mailTarget.uid, motivo: "Prueba de envio", requestId: mailResetId}), mailDeps);
  assert.equal(mailReset.envio, "enviado");
  assert.doesNotMatch(JSON.stringify(mailReset), /https?:|oobCode/);
  assert.equal(sentMail.length, 1);
  assert.equal(sentMail[0].to, mailTarget.email);
  assert.match(sentMail[0].text, /https?:\/\/\S+/, "el correo lleva el enlace");
  assert.equal((await restablecerContrasenaUsuarioPlataformaHandler(asPlatform({uid: mailTarget.uid, motivo: "Prueba de envio", requestId: mailResetId}), mailDeps)).idempotent, true);
  assert.equal(sentMail.length, 1, "el reintento no reenvia el enlace");
  await rejected("restablecimiento: envio no configurado", () => restablecerContrasenaUsuarioPlataformaHandler(asPlatform({uid: mailTarget.uid, motivo: "Sin envio", requestId: requestId("recovery_mail_unconfigured")}), {...mailDeps, getResendApiKey: () => ""}), ["failed-precondition"]);
  const failedResetId = requestId("recovery_mail_failed");
  await rejected("restablecimiento: falla el proveedor", () => restablecerContrasenaUsuarioPlataformaHandler(asPlatform({uid: mailTarget.uid, motivo: "Proveedor caido", requestId: failedResetId}), {...mailDeps, sendEmail: async () => { throw new Error("proveedor caido"); }}), ["unavailable"]);
  assert.equal((await adminDb.doc(`platformUserRecoveryRequests/${failedResetId}`).get()).data().estado, "FALLIDA");
  assert.equal((await restablecerContrasenaUsuarioPlataformaHandler(asPlatform({uid: mailTarget.uid, motivo: "Proveedor caido", requestId: failedResetId}), mailDeps)).envio, "enviado", "tras fallar se puede reintentar");

  sentMail.length = 0;
  const noticeId = requestId("recovery_mail_notice");
  const noticeEmail = `recovery-aviso-${RUN_ID}@example.test`.toLowerCase();
  const notified = await cambiarCorreoUsuarioPlataformaHandler(asPlatform({uid: mailTarget.uid, correoNuevo: noticeEmail, motivo: "Aviso", requestId: noticeId}), mailDeps);
  assert.equal(notified.avisoCorreoAnterior, "enviado");
  assert.equal(sentMail.length, 1);
  assert.equal(sentMail[0].to, mailTarget.email, "el aviso va al correo anterior");
  assert.ok(!sentMail[0].text.includes(noticeEmail) && !sentMail[0].html.includes(noticeEmail), "el aviso no expone el correo nuevo completo");
  assert.equal((await cambiarCorreoUsuarioPlataformaHandler(asPlatform({uid: mailTarget.uid, correoNuevo: noticeEmail, motivo: "Aviso", requestId: noticeId}), mailDeps)).idempotent, true);
  assert.equal(sentMail.length, 1, "el reintento no reenvia el aviso");

  // El aviso al correo anterior puede fallar sin deshacer el cambio, y el resultado se informa.
  const failedNoticeTarget = await newAccount("notice-failed");
  const failedNoticeId = requestId("recovery_notice_failed");
  const failedNotice = await cambiarCorreoUsuarioPlataformaHandler(asPlatform({uid: failedNoticeTarget.uid, correoNuevo: `recovery-fallido-${RUN_ID}@example.test`, motivo: "Aviso fallido", requestId: failedNoticeId}), {...mailDeps, sendEmail: async () => { throw new Error("proveedor caido"); }});
  assert.equal(failedNotice.avisoCorreoAnterior, "fallido");
  assert.equal((await adminAuth.getUser(failedNoticeTarget.uid)).email, `recovery-fallido-${RUN_ID}@example.test`);
  assert.equal((await adminDb.doc(`usuarios/${failedNoticeTarget.uid}/eventosPlataforma/${failedNoticeId}`).get()).data().avisoCorreoAnterior, "fallido");
  const unconfiguredTarget = await newAccount("notice-unconfigured");
  const unconfigured = await cambiarCorreoUsuarioPlataformaHandler(asPlatform({uid: unconfiguredTarget.uid, correoNuevo: `recovery-sinconfig-${RUN_ID}@example.test`, motivo: "Sin envio", requestId: requestId("recovery_notice_unconfigured")}), {...mailDeps, getResendApiKey: () => ""});
  assert.equal(unconfigured.avisoCorreoAnterior, "no_configurado");
  assert.equal((await adminAuth.getUser(unconfiguredTarget.uid)).email, `recovery-sinconfig-${RUN_ID}@example.test`);
  const warnedDetail = (await call(platform, "obtenerUsuarioPlataforma")({uid: failedNoticeTarget.uid})).data;
  assert.equal(warnedDetail.eventos.find((item) => item.tipo === RECOVERY_EMAIL_EVENT).avisoCorreoAnterior, "fallido");

  // Una operacion interrumpida despues de actualizar Auth se reanuda con el mismo requestId y conserva el correo anterior.
  const resumeTarget = await newAccount("resume");
  const resumeEmail = `recovery-reanuda-${RUN_ID}@example.test`;
  const resumeId = requestId("recovery_resume");
  await adminAuth.updateUser(resumeTarget.uid, {email: resumeEmail});
  await adminDb.doc(`platformUserRecoveryRequests/${resumeId}`).set({
    uidUsuario: resumeTarget.uid,
    accion: "CAMBIAR_CORREO",
    estado: "EN_PROCESO",
    creadoPorUid: platform.uid,
    fingerprint: createHash("sha256").update(JSON.stringify({uid: resumeTarget.uid, action: "CAMBIAR_CORREO", reason: "Reanudar", newEmail: resumeEmail})).digest("hex"),
    iniciadoEnMs: 1,
    correoAnterior: resumeTarget.email,
    correoNuevo: resumeEmail,
  });
  const resumed = await cambiarCorreoUsuarioPlataformaHandler(asPlatform({uid: resumeTarget.uid, correoNuevo: resumeEmail, motivo: "Reanudar", requestId: resumeId}), mailDeps);
  assert.equal(resumed.idempotent, false);
  assert.equal((await adminDb.doc(`usuarios/${resumeTarget.uid}/eventosPlataforma/${resumeId}`).get()).data().correoAnterior, resumeTarget.email);
  assert.equal((await adminDb.doc(`platformUserRecoveryRequests/${resumeId}`).get()).data().estado, "COMPLETADA");
  console.log("OK recuperacion de cuenta: bloqueos, restablecimiento, cambio de correo, aviso y edicion");

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
