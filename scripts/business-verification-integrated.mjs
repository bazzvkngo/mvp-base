import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, createUserWithEmailAndPassword, getAuth} from "firebase/auth";
import {connectFirestoreEmulator, doc, getDoc, getFirestore, setDoc, terminate, updateDoc} from "firebase/firestore";
import {connectFunctionsEmulator, getFunctions, httpsCallable} from "firebase/functions";
import {connectStorageEmulator, getStorage, ref, uploadBytes} from "firebase/storage";

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
const fiscalSeed = [...RUN_ID].reduce(
  (total, character) => (total * 31 + character.charCodeAt(0)) % 60000000,
  0
);
const FIRST_FISCAL_ID = chileRut(20000000 + fiscalSeed);
const RETRY_FISCAL_ID = chileRut(80000000 + (fiscalSeed % 9999999));
const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const {deleteApp: deleteAdminApp, initializeApp: initializeAdminApp} = requireFromFunctions("firebase-admin/app");
const {getAuth: getAdminAuth} = requireFromFunctions("firebase-admin/auth");
const {getFirestore: getAdminFirestore} = requireFromFunctions("firebase-admin/firestore");

function client(name) {
  const app = initializeApp({apiKey: "demo", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.firebasestorage.app`, appId: `verification-${name}-${RUN_ID}`}, `verification-${name}-${RUN_ID}`);
  const auth = getAuth(app); const db = getFirestore(app); const functions = getFunctions(app, "us-central1"); const storage = getStorage(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  connectFirestoreEmulator(db, "127.0.0.1", 8080); connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  return {app, auth, db, functions, storage};
}
async function authenticate(target, name) {
  const credential = await createUserWithEmailAndPassword(target.auth, `verification-${name}-${RUN_ID}@example.test`, `Verification-${RUN_ID}-Pass!`);
  target.uid = credential.user.uid; target.user = credential.user; return target;
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
const profile = (name, fiscalValue) => ({
  nombreComercial: name,
  rubroCodigo: "INGENIERIA_CONSULTORIA",
  rubroNombre: "Ingeniería y consultoría técnica",
  rubroOtro: "",
  paisCodigo: "CL",
  monedaCodigo: "CLP",
  locale: "es-CL",
  identificadorFiscalTipo: "RUT",
  identificadorFiscalValor: fiscalValue,
  regionCodigo: "13",
  comunaCodigo: "13101",
  razonSocial: `${name} SpA`,
  giro: "Servicios",
  email: `${name.toLowerCase().replace(/\s+/g, "-")}@example.test`,
  telefono: "+56 9 1234 5678",
  direccion: "Dirección 123",
  ciudad: "Santiago",
  regionEstado: "Región Metropolitana de Santiago",
  codigoPostal: "8320000",
  sitioWeb: "",
});
const verificationPayload = (companyProfile) => ({
  paisCodigo: companyProfile.paisCodigo,
  identificadorFiscalTipo: companyProfile.identificadorFiscalTipo,
  identificadorFiscalValor: companyProfile.identificadorFiscalValor,
  relacionSolicitante: "Representante legal",
  correoSolicitante: companyProfile.email,
  telefonoSolicitante: companyProfile.telefono,
  observaciones: "Solicitud integrada",
});
const editableProfile = (companyProfile) => {
  const {
    identificadorFiscalValor: _fiscalValue,
    razonSocial: _legalName,
    ...editable
  } = companyProfile;
  return editable;
};

const owner = await authenticate(client("owner"), "owner");
const admin = await authenticate(client("admin"), "admin");
const member = await authenticate(client("member"), "member");
const platform = await authenticate(client("platform"), "platform");
const secondOwner = await authenticate(client("second-owner"), "second-owner");
const clients = [owner, admin, member, platform, secondOwner];
const adminApp = initializeAdminApp({projectId: PROJECT_ID}, `verification-admin-${RUN_ID}`);
const adminDb = getAdminFirestore(adminApp); const adminAuth = getAdminAuth(adminApp);

try {
  const firstCreated = await call(owner, "createFirstBusiness")({nombreComercial: "Empresa Uno", rubroCodigo: "INGENIERIA_CONSULTORIA", regionCodigo: "13", requestId: requestId("business_one")});
  const businessId = firstCreated.data.business.id;
  const firstProfile = profile("Empresa Uno", FIRST_FISCAL_ID);
  await call(owner, "updateBusinessInformation")({businessId, profile: editableProfile(firstProfile)});
  await Promise.all([
    adminDb.doc(`membresias/${businessId}__${admin.uid}`).set({negocioId: businessId, uid: admin.uid, rol: "ADMIN", estado: "activo"}),
    adminDb.doc(`membresias/${businessId}__${member.uid}`).set({negocioId: businessId, uid: member.uid, rol: "MEMBER", estado: "activo"}),
  ]);
  const firstRequestId = requestId("verification_one");
  const evidencePath = `negocios/${businessId}/verificacion/${owner.uid}/${firstRequestId}/acreditacion.pdf`;
  const evidenceBytes = new TextEncoder().encode("documento acreditativo de prueba");
  await uploadBytes(ref(owner.storage, evidencePath), evidenceBytes, {contentType: "application/pdf"});
  const firstRequest = {
    ...verificationPayload(firstProfile),
    documentoAcreditativo: {
      ruta: evidencePath,
      nombreOriginal: "acreditacion.pdf",
      tipoContenido: "application/pdf",
      tamanoBytes: evidenceBytes.byteLength,
    },
  };
  await rejected("ADMIN solicita", () => call(admin, "solicitarVerificacionEmpresa")({businessId, requestId: requestId("admin_request"), solicitud: firstRequest}), ["permission-denied"]);
  await rejected("MEMBER solicita", () => call(member, "solicitarVerificacionEmpresa")({businessId, requestId: requestId("member_request"), solicitud: firstRequest}), ["permission-denied"]);
  await rejected("payload falsea país", () => call(owner, "solicitarVerificacionEmpresa")({businessId, requestId: requestId("fake_country"), solicitud: {...firstRequest, paisCodigo: "BO"}}), ["failed-precondition", "invalid-argument"]);
  const requested = await call(owner, "solicitarVerificacionEmpresa")({businessId, requestId: firstRequestId, solicitud: firstRequest});
  const requestRetry = await call(owner, "solicitarVerificacionEmpresa")({businessId, requestId: firstRequestId, solicitud: firstRequest});
  assert.equal(requested.data.estado, "PENDIENTE"); assert.equal(requestRetry.data.idempotent, true);
  assert.equal(requested.data.solicitudId, requestRetry.data.solicitudId);
  assert.equal((await adminDb.doc(`negocios/${businessId}`).get()).data().verificacionEmpresa.estado, "PENDIENTE");
  const storedRequests = await adminDb.collection(`negocios/${businessId}/solicitudesVerificacionEmpresa`).get();
  assert.equal(storedRequests.size, 1);
  assert.equal(storedRequests.docs[0].data().razonSocial, undefined);

  await rejected("SDK falsea verificación", () => updateDoc(doc(owner.db, "negocios", businessId), {verificacionEmpresa: {estado: "VERIFICADA"}}), ["permission-denied"]);
  await rejected("SDK crea solicitud", () => setDoc(doc(owner.db, "negocios", businessId, "solicitudesVerificacionEmpresa", "forged"), {negocioId: businessId}), ["permission-denied"]);
  assert.equal((await getDoc(doc(owner.db, "negocios", businessId, "solicitudesVerificacionEmpresa", requested.data.solicitudId))).exists(), true);
  await rejected("ADMIN lee solicitud sensible", () => getDoc(doc(admin.db, "negocios", businessId, "solicitudesVerificacionEmpresa", requested.data.solicitudId)), ["permission-denied"]);

  await adminAuth.setCustomUserClaims(owner.uid, {platformRole: "PLATFORM_SUPERADMIN"});
  await owner.user.getIdToken(true);
  await rejected("OWNER con claim aprueba su empresa", () => call(owner, "resolverVerificacionEmpresa")({businessId, solicitudId: requested.data.solicitudId, decision: "APROBAR", motivo: "", razonSocialOficial: "Empresa Uno Oficial SpA", requestId: requestId("self_approve")}), ["permission-denied"]);
  await adminAuth.setCustomUserClaims(platform.uid, {platformRole: "PLATFORM_SUPERADMIN"});
  await platform.user.getIdToken(true);
  await rejected("plataforma no lee solicitud por SDK", () => getDoc(doc(platform.db, "negocios", businessId, "solicitudesVerificacionEmpresa", requested.data.solicitudId)), ["permission-denied"]);
  await rejected("aprobar sin razon social oficial", () => call(platform, "resolverVerificacionEmpresa")({businessId, solicitudId: requested.data.solicitudId, decision: "APROBAR", motivo: "", razonSocialOficial: "", requestId: requestId("missing_legal_name")}), ["invalid-argument"]);
  const decisionId = requestId("platform_approve");
  const approved = await call(platform, "resolverVerificacionEmpresa")({businessId, solicitudId: requested.data.solicitudId, decision: "APROBAR", motivo: "", razonSocialOficial: "Empresa Uno Oficial SpA", requestId: decisionId});
  const approvedRetry = await call(platform, "resolverVerificacionEmpresa")({businessId, solicitudId: requested.data.solicitudId, decision: "APROBAR", motivo: "", razonSocialOficial: "Empresa Uno Oficial SpA", requestId: decisionId});
  assert.equal(approved.data.estado, "VERIFICADA"); assert.equal(approvedRetry.data.idempotent, true);
  const approvedBusiness = (await adminDb.doc(`negocios/${businessId}`).get()).data();
  const approvedProfile = (await adminDb.doc(`negocios/${businessId}/empresa/perfil`).get()).data();
  assert.equal(approvedBusiness.razonSocial, "Empresa Uno Oficial SpA");
  assert.equal(approvedBusiness.identificadorFiscalTipo, "RUT");
  assert.equal(approvedBusiness.identificadorFiscalValor, FIRST_FISCAL_ID);
  assert.equal(approvedBusiness.verificacionEmpresa.identificadorFiscalValor, FIRST_FISCAL_ID);
  assert.equal(approvedBusiness.verificacionEmpresa.razonSocialVerificada, "Empresa Uno Oficial SpA");
  assert.equal(approvedProfile.razonSocial, "Empresa Uno Oficial SpA");
  assert.equal(approvedProfile.identificadorFiscalTipo, "RUT");
  assert.equal(approvedProfile.identificadorFiscalValor, FIRST_FISCAL_ID);
  assert.equal(approvedProfile.rut, undefined);
  const identityPath = `identidadesFiscalesVerificadas/CL__${FIRST_FISCAL_ID.replace(/[.\s-]/g, "")}`;
  assert.equal((await adminDb.doc(identityPath).get()).data().negocioId, businessId);
  await rejected("índice global cerrado", () => getDoc(doc(platform.db, identityPath)), ["permission-denied"]);

  const pendingAdditional = await call(owner, "createAdditionalBusiness")({
    nombreComercial: "Empresa pendiente del mismo owner",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    regionCodigo: "13",
    requestId: requestId("same_owner_pending_business"),
  });
  const pendingBusinessId = pendingAdditional.data.business.id;
  await call(owner, "setActiveBusiness")({businessId: pendingBusinessId});
  const pendingSession = await call(owner, "getBusinessSession")();
  assert.equal(pendingSession.data.activeBusiness.id, pendingBusinessId);
  assert.equal(pendingSession.data.activeBusiness.verificacionEmpresa.estado, "NO_VERIFICADA");
  await rejected("multiempresa pendiente bloqueada", () =>
    call(owner, "listarMiembrosNegocio")({businessId: pendingBusinessId}),
  ["failed-precondition"]);
  await call(owner, "setActiveBusiness")({businessId});
  const verifiedSession = await call(owner, "getBusinessSession")();
  assert.equal(verifiedSession.data.activeBusiness.id, businessId);
  assert.equal(verifiedSession.data.activeBusiness.verificacionEmpresa.estado, "VERIFICADA");
  const verifiedMemberList = await call(owner, "listarMiembrosNegocio")({businessId});
  assert.ok(verifiedMemberList.data.miembros.length >= 3);
  console.log("OK multiempresa: gate recalculado por negocio activo");

  await call(owner, "updateBusinessInformation")({businessId, profile: {...editableProfile(firstProfile), telefono: "+56 9 9999 9999"}});
  assert.equal((await adminDb.doc(`negocios/${businessId}`).get()).data().verificacionEmpresa.estado, "VERIFICADA");

  const secondCreated = await call(secondOwner, "createFirstBusiness")({nombreComercial: "Empresa Dos", rubroCodigo: "INGENIERIA_CONSULTORIA", regionCodigo: "13", requestId: requestId("business_two")});
  const secondBusinessId = secondCreated.data.business.id;
  const secondProfile = profile("Empresa Dos", FIRST_FISCAL_ID);
  await call(secondOwner, "updateBusinessInformation")({businessId: secondBusinessId, profile: editableProfile(secondProfile)});
  const secondRequest = await call(secondOwner, "solicitarVerificacionEmpresa")({businessId: secondBusinessId, requestId: requestId("verification_two"), solicitud: verificationPayload(secondProfile)});
  await rejected("identidad fiscal global duplicada", () => call(platform, "resolverVerificacionEmpresa")({businessId: secondBusinessId, solicitudId: secondRequest.data.solicitudId, decision: "APROBAR", motivo: "", razonSocialOficial: "Empresa Dos Oficial SpA", requestId: requestId("duplicate_approve")}), ["already-exists"]);
  await call(platform, "resolverVerificacionEmpresa")({businessId: secondBusinessId, solicitudId: secondRequest.data.solicitudId, decision: "RECHAZAR", motivo: "Identidad fiscal ya utilizada.", razonSocialOficial: "", requestId: requestId("platform_reject")});
  const secondBusiness = (await adminDb.doc(`negocios/${secondBusinessId}`).get()).data();
  assert.equal(secondBusiness.verificacionEmpresa.estado, "RECHAZADA");
  assert.equal(secondBusiness.verificacionEmpresa.motivoRechazo, "Identidad fiscal ya utilizada.");

  await rejected("identidad verificada inmutable", () => call(owner, "updateBusinessInformation")({
    businessId,
    profile: {...editableProfile(firstProfile), identificadorFiscalValor: RETRY_FISCAL_ID},
  }), ["failed-precondition"]);
  const unchanged = (await adminDb.doc(`negocios/${businessId}`).get()).data();
  assert.equal(unchanged.verificacionEmpresa.estado, "VERIFICADA");
  assert.equal(unchanged.identificadorFiscalValor, FIRST_FISCAL_ID);
  assert.equal((await adminDb.doc(identityPath).get()).exists, true);
  await rejected("razon social verificada inmutable", () => call(owner, "updateBusinessInformation")({
    businessId,
    profile: {...editableProfile(firstProfile), razonSocial: "Nombre alterado SpA"},
  }), ["failed-precondition"]);

  const correctedSecondProfile = profile("Empresa Dos", RETRY_FISCAL_ID);
  const retryRequest = await call(secondOwner, "solicitarVerificacionEmpresa")({
    businessId: secondBusinessId,
    requestId: requestId("verification_two_retry"),
    solicitud: verificationPayload(correctedSecondProfile),
  });
  assert.equal(retryRequest.data.estado, "PENDIENTE");
  await call(platform, "resolverVerificacionEmpresa")({
    businessId: secondBusinessId,
    solicitudId: retryRequest.data.solicitudId,
    decision: "APROBAR",
    motivo: "",
    razonSocialOficial: "Empresa Dos Corregida SpA",
    requestId: requestId("retry_approve"),
  });
  const retriedBusiness = (await adminDb.doc(`negocios/${secondBusinessId}`).get()).data();
  assert.equal(retriedBusiness.verificacionEmpresa.estado, "VERIFICADA");
  assert.equal(retriedBusiness.identificadorFiscalValor, RETRY_FISCAL_ID);

  await adminDb.doc(`negocios/${secondBusinessId}`).update({estado: "suspendida"});
  await rejected("empresa suspendida no solicita", () => call(secondOwner, "solicitarVerificacionEmpresa")({businessId: secondBusinessId, requestId: requestId("suspended_request"), solicitud: verificationPayload(secondProfile)}), ["failed-precondition"]);
  await adminDb.doc(`negocios/${secondBusinessId}`).update({estado: "eliminada", eliminadoEn: new Date()});
  await rejected("empresa eliminada no solicita", () => call(secondOwner, "solicitarVerificacionEmpresa")({businessId: secondBusinessId, requestId: requestId("deleted_request"), solicitud: verificationPayload(secondProfile)}), ["failed-precondition"]);
  console.log("Business verification integrated: OK");
} finally {
  await Promise.all(clients.map(async (target) => { try { await terminate(target.db); } catch {} try { await deleteApp(target.app); } catch {} }));
  await deleteAdminApp(adminApp);
}
