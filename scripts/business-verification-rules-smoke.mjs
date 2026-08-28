import {deleteApp, initializeApp} from "firebase/app";
import {createRequire} from "node:module";
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
} from "firebase/auth";
import {
  connectStorageEmulator,
  deleteObject,
  getStorage,
  ref,
  uploadBytes,
} from "firebase/storage";

const PROJECT_ID = "tesis-inventario-ia";
const requireFromFunctions = createRequire(
  new URL("../functions/package.json", import.meta.url)
);
const {
  deleteApp: deleteAdminApp,
  initializeApp: initializeAdminApp,
} = requireFromFunctions("firebase-admin/app");
const {getFirestore: getAdminFirestore} = requireFromFunctions(
  "firebase-admin/firestore"
);

function createClient(name) {
  const app = initializeApp({
    apiKey: "demo-key",
    appId: `demo-${name}`,
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID,
    storageBucket: `${PROJECT_ID}.firebasestorage.app`,
  }, name);
  const auth = getAuth(app);
  const storage = getStorage(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  return {app, auth, storage};
}

async function expectDenied(label, operation) {
  try {
    await operation();
  } catch (error) {
    const code = String(error?.code || "");
    if (code.includes("unauthorized") || code.includes("permission-denied")) {
      console.log(`OK denegado: ${label}`);
      return;
    }
    throw error;
  }
  throw new Error(`Se esperaba denegación: ${label}`);
}

async function main() {
  const ownerClient = createClient("verification-rules-owner");
  const otherClient = createClient("verification-rules-other");
  const adminApp = initializeAdminApp({projectId: PROJECT_ID}, "verification-rules-admin");
  const adminDb = getAdminFirestore(adminApp);

  try {
    const ownerUid = (await signInAnonymously(ownerClient.auth)).user.uid;
    const otherUid = (await signInAnonymously(otherClient.auth)).user.uid;
    const businessId = `verification-rules-${ownerUid}`;
    const requestId = "verification-request";
    const evidencePath =
      `negocios/${businessId}/verificacion/${ownerUid}/${requestId}/documento.pdf`;

    await Promise.all([
      adminDb.doc(`usuarios/${ownerUid}`).set({estadoPlataforma: "activo"}),
      adminDb.doc(`usuarios/${otherUid}`).set({estadoPlataforma: "activo"}),
      adminDb.doc(`negocios/${businessId}`).set({
        estado: "activo",
        verificacionEmpresa: {estado: "NO_VERIFICADA"},
      }),
      adminDb.doc(`membresias/${businessId}__${ownerUid}`).set({
        negocioId: businessId,
        uid: ownerUid,
        rol: "OWNER",
        estado: "activo",
      }),
    ]);

    await uploadBytes(
      ref(ownerClient.storage, evidencePath),
      new TextEncoder().encode("evidencia empresarial"),
      {contentType: "application/pdf"}
    );
    await deleteObject(ref(ownerClient.storage, evidencePath));
    console.log("OK permitido: OWNER revierte evidencia no asociada");

    await expectDenied("tipo de evidencia inválido", () =>
      uploadBytes(
        ref(ownerClient.storage,
          `negocios/${businessId}/verificacion/${ownerUid}/invalid/documento.txt`),
        new TextEncoder().encode("archivo inválido"),
        {contentType: "text/plain"}
      )
    );
    await expectDenied("evidencia superior a 5 MB", () =>
      uploadBytes(
        ref(ownerClient.storage,
          `negocios/${businessId}/verificacion/${ownerUid}/large/documento.png`),
        new Uint8Array(5 * 1024 * 1024 + 1),
        {contentType: "image/png"}
      )
    );
    await expectDenied("otro usuario sube evidencia del OWNER", () =>
      uploadBytes(
        ref(otherClient.storage, evidencePath),
        new TextEncoder().encode("evidencia ajena"),
        {contentType: "application/pdf"}
      )
    );

    await uploadBytes(
      ref(ownerClient.storage, evidencePath),
      new TextEncoder().encode("evidencia empresarial asociada"),
      {contentType: "application/pdf"}
    );
    await adminDb.doc(
      `negocios/${businessId}/businessVerificationRequests/${requestId}`
    ).set({negocioId: businessId, uidUsuario: ownerUid, otherUid});
    await expectDenied("OWNER elimina evidencia asociada", () =>
      deleteObject(ref(ownerClient.storage, evidencePath))
    );
    console.log("Business verification rules smoke: OK");
  } finally {
    await Promise.all([
      deleteApp(ownerClient.app),
      deleteApp(otherClient.app),
      deleteAdminApp(adminApp),
    ]);
  }
}

main().catch((error) => {
  console.error("BUSINESS_VERIFICATION_RULES_SMOKE_FAILED", error?.code, error?.message);
  process.exitCode = 1;
});
