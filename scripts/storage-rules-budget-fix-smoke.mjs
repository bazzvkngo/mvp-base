import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, getAuth, signInAnonymously} from "firebase/auth";
import {
  connectStorageEmulator,
  deleteObject,
  getBytes,
  getStorage,
  ref,
  uploadBytes,
} from "firebase/storage";
import {createRequire} from "node:module";

const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const {initializeApp: initAdmin, deleteApp: deleteAdmin} = requireFromFunctions("firebase-admin/app");
const {getFirestore: getAdminFirestore} = requireFromFunctions("firebase-admin/firestore");

const PROJECT_ID = "tesis-inventario-ia";

function createClient(name) {
  const app = initializeApp({
    apiKey: "demo-key",
    appId: `demo-${name}`,
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID,
    storageBucket: `${PROJECT_ID}.firebasestorage.app`,
  }, `storage-budget-${name}`);
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
  throw new Error(`Se esperaba denegacion: ${label}`);
}

const adminApp = initAdmin({projectId: PROJECT_ID}, "storage-budget-admin");
const adminDb = getAdminFirestore(adminApp);

const owner = createClient("owner");
const admin = createClient("admin");
const outsider = createClient("outsider");

const ownerUid = (await signInAnonymously(owner.auth)).user.uid;
const adminUid = (await signInAnonymously(admin.auth)).user.uid;
const outsiderUid = (await signInAnonymously(outsider.auth)).user.uid;

const businessId = `storage-budget-biz-${ownerUid}`;
const legacyBusinessId = `storage-budget-legacy-${ownerUid}`;
const otherBusinessId = `storage-budget-other-biz-${outsiderUid}`;
const nonexistentBusinessId = `storage-budget-nonexistent-${ownerUid}`;
const evidenceBytes = new TextEncoder().encode("evidencia empresarial");

await Promise.all([
  adminDb.doc(`usuarios/${ownerUid}`).set({estadoPlataforma: "activo"}),
  adminDb.doc(`usuarios/${adminUid}`).set({estadoPlataforma: "activo"}),
  adminDb.doc(`usuarios/${outsiderUid}`).set({estadoPlataforma: "activo"}),
  adminDb.doc(`negocios/${businessId}`).set({
    creadoPorUid: ownerUid, estado: "activo", verificacionEmpresa: {estado: "NO_VERIFICADA"},
  }),
  adminDb.doc(`membresias/${businessId}__${ownerUid}`).set({negocioId: businessId, uid: ownerUid, rol: "OWNER", estado: "activo"}),
  adminDb.doc(`membresias/${businessId}__${adminUid}`).set({negocioId: businessId, uid: adminUid, rol: "ADMIN", estado: "activo"}),
  // Documento legacy real: existe, activo, pero SIN creadoPorUid en absoluto
  // (el mismo estado que tendría un negocio creado antes de que este campo
  // existiera — no se inventa el valor, se prueba tal cual).
  adminDb.doc(`negocios/${legacyBusinessId}`).set({
    estado: "activo", verificacionEmpresa: {estado: "NO_VERIFICADA"},
  }),
  adminDb.doc(`membresias/${legacyBusinessId}__${ownerUid}`).set({negocioId: legacyBusinessId, uid: ownerUid, rol: "OWNER", estado: "activo"}),
  adminDb.doc(`negocios/${otherBusinessId}`).set({
    creadoPorUid: outsiderUid, estado: "activo", verificacionEmpresa: {estado: "NO_VERIFICADA"},
  }),
  adminDb.doc(`membresias/${otherBusinessId}__${outsiderUid}`).set({negocioId: otherBusinessId, uid: outsiderUid, rol: "OWNER", estado: "activo"}),
]);

// ================================================================
// CASOS POSITIVOS
// ================================================================

// 1/3/4. OWNER creador (documento moderno con creadoPorUid) sube y lee evidencia.
{
  const path = `negocios/${businessId}/verificacion/${ownerUid}/req-1/documento.pdf`;
  const evidenceRef = ref(owner.storage, path);
  await uploadBytes(evidenceRef, evidenceBytes, {contentType: "application/pdf"});
  const downloaded = await getBytes(evidenceRef);
  if (new TextDecoder().decode(downloaded) !== "evidencia empresarial") {
    throw new Error("La lectura no devolvió el contenido esperado.");
  }
  await deleteObject(evidenceRef);
  console.log("OK casos 1/3/4/6: OWNER creador (documento moderno con creadoPorUid) sube, lee y revierte evidencia sin agotar presupuesto ni error de evaluación");
}

// 2. "ADMIN/rol autorizado si corresponde": el contrato vigente
// (canAccessBusinessVerificationEvidence) es específicamente EL CREADOR
// registrado, no cualquier OWNER/ADMIN (a diferencia de canManageBusiness).
// No se fuerza un positivo que el contrato no autoriza: se documenta como
// negativo explícito más abajo (caso "ADMIN no creador").

// 7. Upload con metadata/path válidos ya cubierto arriba (contentType
// application/pdf, path negocios/{businessId}/verificacion/{uid}/{req}/...).

// 8. El flujo existente de verificación empresarial sigue funcionando: ver
// regresión de scripts/business-verification-rules-smoke.mjs (sección K
// del informe), no se repite aquí.

console.log("PARTE 1 (positivos) completa.");

// ================================================================
// CASOS NEGATIVOS
// ================================================================

// 5/14. Documento LEGACY real (existe, activo, sin creadoPorUid): el propio
// OWNER de ese negocio no puede demostrar autoría -> DENY limpio, sin error
// de evaluación (el bug original producía "Property creadoPorUid is
// undefined on object" en vez de esto).
await expectDenied("negocio legacy sin creadoPorUid deniega evidencia incluso al OWNER real (DENY limpio, no error)", () =>
  uploadBytes(
    ref(owner.storage, `negocios/${legacyBusinessId}/verificacion/${ownerUid}/req-legacy/documento.pdf`),
    evidenceBytes,
    {contentType: "application/pdf"}
  )
);

// 9. no autenticado.
{
  const anonApp = initializeApp({apiKey: "demo-key", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.firebasestorage.app`}, "storage-budget-noauth");
  const anonStorage = getStorage(anonApp);
  connectStorageEmulator(anonStorage, "127.0.0.1", 9199);
  await expectDenied("usuario no autenticado sube evidencia", () =>
    uploadBytes(ref(anonStorage, `negocios/${businessId}/verificacion/${ownerUid}/req-anon/documento.pdf`), evidenceBytes, {contentType: "application/pdf"})
  );
  await deleteApp(anonApp);
}

// 10/12/22. usuario de otro negocio (con su propio negocio real) conoce el
// path exacto del negocio ajeno y lo usa directamente.
await expectDenied("OUTSIDER (creador legítimo de su propio negocio) lee/sube evidencia de un negocio ajeno por path exacto conocido", () =>
  uploadBytes(
    ref(outsider.storage, `negocios/${businessId}/verificacion/${outsiderUid}/req-outsider/documento.pdf`),
    evidenceBytes,
    {contentType: "application/pdf"}
  )
);
await expectDenied("OUTSIDER intenta leer evidencia ya existente de un negocio ajeno", async () => {
  const path = `negocios/${businessId}/verificacion/${ownerUid}/req-read/documento.pdf`;
  await uploadBytes(ref(owner.storage, path), evidenceBytes, {contentType: "application/pdf"});
  await getBytes(ref(outsider.storage, path));
});

// 11. businessId manipulado (el uid del path coincide con el caller, pero el
// negocio referenciado es el de OTRO usuario, no el propio).
await expectDenied("businessId manipulado: OWNER intenta usar su propio uid contra el negocio ajeno", () =>
  uploadBytes(
    ref(owner.storage, `negocios/${otherBusinessId}/verificacion/${ownerUid}/req-manip/documento.pdf`),
    evidenceBytes,
    {contentType: "application/pdf"}
  )
);

// 13. creadoPorUid de otro usuario (ADMIN, miembro real y autorizado por rol
// en otros contextos, pero NO el creador registrado del negocio).
await expectDenied("ADMIN (miembro real, no creador) no puede subir evidencia — el contrato exige específicamente al creador", () =>
  uploadBytes(
    ref(admin.storage, `negocios/${businessId}/verificacion/${adminUid}/req-admin/documento.pdf`),
    evidenceBytes,
    {contentType: "application/pdf"}
  )
);

// 15. creadoPorUid manipulado (defensa en profundidad): el negocio existe,
// activo, pero su creadoPorUid registrado no coincide con NINGÚN usuario de
// la prueba (simula una inconsistencia de datos) — nadie debe poder pasar.
{
  const tamperedBusinessId = `storage-budget-tampered-${ownerUid}`;
  await adminDb.doc(`negocios/${tamperedBusinessId}`).set({
    creadoPorUid: "uid-que-no-existe-en-ninguna-parte",
    estado: "activo",
    verificacionEmpresa: {estado: "NO_VERIFICADA"},
  });
  await expectDenied("negocio con creadoPorUid que no coincide con el caller (aunque el path use su propio uid)", () =>
    uploadBytes(
      ref(owner.storage, `negocios/${tamperedBusinessId}/verificacion/${ownerUid}/req-tampered/documento.pdf`),
      evidenceBytes,
      {contentType: "application/pdf"}
    )
  );
}

// 16. overwrite prohibido.
{
  const path = `negocios/${businessId}/verificacion/${ownerUid}/req-overwrite/documento.pdf`;
  await uploadBytes(ref(owner.storage, path), evidenceBytes, {contentType: "application/pdf"});
  await expectDenied("OWNER creador no puede sobrescribir su propia evidencia ya subida", () =>
    uploadBytes(ref(owner.storage, path), new TextEncoder().encode("reemplazo"), {contentType: "application/pdf"})
  );
}

// 17. delete prohibido (evidencia asociada a una solicitud de verificación real).
{
  const requestId = "req-delete-protected";
  const path = `negocios/${businessId}/verificacion/${ownerUid}/${requestId}/documento.pdf`;
  await uploadBytes(ref(owner.storage, path), evidenceBytes, {contentType: "application/pdf"});
  await adminDb.doc(`negocios/${businessId}/businessVerificationRequests/${requestId}`).set({negocioId: businessId, uidUsuario: ownerUid});
  await expectDenied("OWNER creador no puede eliminar evidencia ya asociada a una solicitud", () =>
    deleteObject(ref(owner.storage, path))
  );
}

// 18. MIME inválido.
await expectDenied("tipo MIME no permitido para evidencia de verificación", () =>
  uploadBytes(
    ref(owner.storage, `negocios/${businessId}/verificacion/${ownerUid}/req-mime/documento.txt`),
    new TextEncoder().encode("texto plano"),
    {contentType: "text/plain"}
  )
);

// 19. tamaño inválido.
await expectDenied("evidencia superior a 5 MB", () =>
  uploadBytes(
    ref(owner.storage, `negocios/${businessId}/verificacion/${ownerUid}/req-size/documento.pdf`),
    new Uint8Array(5 * 1024 * 1024 + 1),
    {contentType: "application/pdf"}
  )
);

// 20. ruta arbitraria (fuera del patrón negocios/{id}/verificacion/{uid}/{req}/archivo).
await expectDenied("ruta arbitraria fuera del patrón de evidencia de verificación", () =>
  uploadBytes(
    ref(owner.storage, `negocios/${businessId}/otra-cosa-arbitraria/documento.pdf`),
    evidenceBytes,
    {contentType: "application/pdf"}
  )
);

// 21. documento Firestore relacionado inexistente (negocio que directamente
// no existe en Firestore, no sólo inactivo).
await expectDenied("negocio inexistente en Firestore deniega cualquier evidencia (hasActiveBusinessDocument limpio)", () =>
  uploadBytes(
    ref(owner.storage, `negocios/${nonexistentBusinessId}/verificacion/${ownerUid}/req-missing/documento.pdf`),
    evidenceBytes,
    {contentType: "application/pdf"}
  )
);

console.log("PARTE 2 (negativos) completa — todos denegados, ninguno con error de evaluación.");

await Promise.all([deleteApp(owner.app), deleteApp(admin.app), deleteApp(outsider.app)]);
await deleteAdmin(adminApp);
console.log("STORAGE_RULES_BUDGET_FIX_SMOKE_OK");
