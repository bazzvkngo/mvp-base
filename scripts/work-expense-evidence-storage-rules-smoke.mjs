import {deleteApp, initializeApp} from "firebase/app";
import {createRequire} from "node:module";
import {connectAuthEmulator, getAuth, signInAnonymously} from "firebase/auth";
import {connectStorageEmulator, deleteObject, getBytes, getStorage, ref, uploadBytes} from "firebase/storage";

// SPEC 020 ETAPA 3: Storage Rules de evidencia de gastos. Mismo patrón que
// business-verification-rules-smoke.mjs: auth + storage + firestore
// (Firestore poblado directamente vía Admin SDK, sin pasar por Functions ni
// por Firestore Rules), probando exclusivamente storage.rules. No se toca
// el issue preexistente de presupuesto de expresiones de Firestore Rules
// (KNOWN_PREEXISTING_RULES_BUDGET_ISSUE): firestore.get()/firestore.exists()
// dentro de Storage Rules es un camino distinto, no afectado por ese límite,
// y así lo confirma este propio smoke al pasar en verde.

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const {deleteApp: deleteAdminApp, initializeApp: initializeAdminApp} = requireFromFunctions("firebase-admin/app");
const {getFirestore: getAdminFirestore} = requireFromFunctions("firebase-admin/firestore");

function createClient(name) {
  const app = initializeApp({apiKey: "demo-key", appId: `demo-${name}`, authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.firebasestorage.app`}, name);
  const auth = getAuth(app); const storage = getStorage(app);
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
  const owner = createClient("wkevidence-rules-owner");
  const technicianOwn = createClient("wkevidence-rules-tech-own");
  const technicianOther = createClient("wkevidence-rules-tech-other");
  const finance = createClient("wkevidence-rules-finance");
  const outsider = createClient("wkevidence-rules-outsider");
  const clients = [owner, technicianOwn, technicianOther, finance, outsider];
  const adminApp = initializeAdminApp({projectId: PROJECT_ID}, `wkevidence-rules-admin-${RUN_ID}`);
  const adminDb = getAdminFirestore(adminApp);

  try {
    const ownerUid = (await signInAnonymously(owner.auth)).user.uid;
    const technicianOwnUid = (await signInAnonymously(technicianOwn.auth)).user.uid;
    const technicianOtherUid = (await signInAnonymously(technicianOther.auth)).user.uid;
    const financeUid = (await signInAnonymously(finance.auth)).user.uid;
    const outsiderUid = (await signInAnonymously(outsider.auth)).user.uid;

    const businessId = `wkevidence-rules-biz-${RUN_ID}`;
    const otherBusinessId = `wkevidence-rules-other-biz-${RUN_ID}`;
    const workId = `wkevidence-rules-work-${RUN_ID}`;
    const otherWorkId = `wkevidence-rules-other-work-${RUN_ID}`;
    const expenseId = `wkevidence-rules-expense-${RUN_ID}`;
    const annulledExpenseId = `wkevidence-rules-annulled-expense-${RUN_ID}`;

    await Promise.all([
      adminDb.doc(`negocios/${businessId}`).set({estado: "activo"}),
      adminDb.doc(`negocios/${otherBusinessId}`).set({estado: "activo"}),
      adminDb.doc(`membresias/${businessId}__${ownerUid}`).set({negocioId: businessId, uid: ownerUid, estado: "activo", rol: "OWNER"}),
      adminDb.doc(`membresias/${businessId}__${technicianOwnUid}`).set({negocioId: businessId, uid: technicianOwnUid, estado: "activo", rol: "TECNICO"}),
      adminDb.doc(`membresias/${businessId}__${technicianOtherUid}`).set({negocioId: businessId, uid: technicianOtherUid, estado: "activo", rol: "TECNICO"}),
      adminDb.doc(`membresias/${businessId}__${financeUid}`).set({negocioId: businessId, uid: financeUid, estado: "activo", rol: "FINANZAS"}),
      adminDb.doc(`negocios/${businessId}/trabajos/${workId}`).set({negocioId: businessId, trabajoId: workId, estado: "pendiente"}),
      adminDb.doc(`negocios/${businessId}/trabajos/${otherWorkId}`).set({negocioId: businessId, trabajoId: otherWorkId, estado: "pendiente"}),
      adminDb.doc(`negocios/${businessId}/trabajos/${workId}/gastos/${expenseId}`).set({negocioId: businessId, trabajoId: workId, gastoId: expenseId, estado: "vigente", registradoPorUid: technicianOwnUid, responsableDelGastoUid: ""}),
      adminDb.doc(`negocios/${businessId}/trabajos/${workId}/gastos/${annulledExpenseId}`).set({negocioId: businessId, trabajoId: workId, gastoId: annulledExpenseId, estado: "anulado", registradoPorUid: ownerUid, responsableDelGastoUid: ""}),
    ]);

    const evidenceBytes = new TextEncoder().encode("evidencia de gasto de prueba");
    // {fileName} en storage.rules es un único segmento de ruta (sin "/"): a
    // diferencia de la evidencia de verificación empresarial (que usa
    // {requestId}/{fileName}), aquí no hay ningún segmento intermedio -- el
    // nombre de archivo debe ir plano justo después de {expenseId}.
    const path = (segment, fileName) => `negocios/${businessId}/trabajos/${workId}/gastos/${segment}/${fileName}`;

    // --- Caso 1: upload autorizado PDF válido (OWNER, sin restricción) ---
    const pdfRef = ref(owner.storage, path(expenseId, "documento.pdf"));
    await uploadBytes(pdfRef, evidenceBytes, {contentType: "application/pdf"});
    const downloaded = await getBytes(pdfRef);
    if (new TextDecoder().decode(downloaded) !== "evidencia de gasto de prueba") throw new Error("La lectura de evidencia no devolvió el contenido esperado.");
    console.log("OK caso 1: upload autorizado PDF válido (OWNER) + lectura");

    // --- Caso 2/3: JPG y PNG válidos (TECNICO sobre su propio gasto) ---
    for (const [extension, contentType] of [["jpg", "image/jpeg"], ["png", "image/png"]]) {
      const imageRef = ref(technicianOwn.storage, path(expenseId, `documento-${extension}.${extension}`));
      await uploadBytes(imageRef, evidenceBytes, {contentType});
      console.log(`OK caso: upload autorizado ${extension.toUpperCase()} válido (TECNICO sobre su propio gasto)`);
    }

    // --- Caso 4: archivo >5MB rechazado ---
    await expectDenied("archivo >5MB", () => uploadBytes(
      ref(owner.storage, path(expenseId, "documento-large.png")),
      new Uint8Array(5 * 1024 * 1024 + 1),
      {contentType: "image/png"},
    ));

    // --- Caso 5: MIME no permitido rechazado ---
    await expectDenied("MIME no permitido", () => uploadBytes(
      ref(owner.storage, path(expenseId, "documento-invalido.txt")),
      new TextEncoder().encode("archivo inválido"),
      {contentType: "text/plain"},
    ));

    // --- Caso 6: no autenticado rechazado ---
    const anonymousApp = createClient("wkevidence-rules-anonymous");
    await expectDenied("no autenticado", () => uploadBytes(
      ref(anonymousApp.storage, path(expenseId, "documento-anon.pdf")),
      evidenceBytes,
      {contentType: "application/pdf"},
    ));
    await deleteApp(anonymousApp.app);

    // --- Caso 7: usuario no autorizado rechazado ---
    await expectDenied("FINANZAS no puede adjuntar evidencia", () => uploadBytes(
      ref(finance.storage, path(expenseId, "documento-finanzas.pdf")),
      evidenceBytes,
      {contentType: "application/pdf"},
    ));
    await expectDenied("TECNICO sobre un gasto que no es suyo", () => uploadBytes(
      ref(technicianOther.storage, path(expenseId, "documento-tecnico-ajeno.pdf")),
      evidenceBytes,
      {contentType: "application/pdf"},
    ));

    // --- Caso 8: otro business rechazado ---
    await expectDenied("otro business", () => uploadBytes(
      ref(owner.storage, `negocios/${otherBusinessId}/trabajos/${workId}/gastos/${expenseId}/documento-cross-business.pdf`),
      evidenceBytes,
      {contentType: "application/pdf"},
    ));

    // --- Caso 9: otro work rechazado (el gasto no pertenece a otherWorkId) ---
    await expectDenied("otro work", () => uploadBytes(
      ref(owner.storage, `negocios/${businessId}/trabajos/${otherWorkId}/gastos/${expenseId}/documento-cross-work.pdf`),
      evidenceBytes,
      {contentType: "application/pdf"},
    ));

    // --- Caso 10: otro expense (inexistente) rechazado ---
    await expectDenied("expense inexistente", () => uploadBytes(
      ref(owner.storage, path("expense-inexistente", "documento-missing.pdf")),
      evidenceBytes,
      {contentType: "application/pdf"},
    ));

    // --- Caso 11: overwrite rechazado (create-only) ---
    await expectDenied("overwrite", () => uploadBytes(pdfRef, new TextEncoder().encode("intento de reemplazo"), {contentType: "application/pdf"}));

    // --- Caso 12: delete directo rechazado ---
    await expectDenied("delete directo", () => deleteObject(pdfRef));

    // --- Bonus: gasto anulado no admite evidencia nueva (aunque OWNER) ---
    await expectDenied("gasto anulado no admite evidencia nueva", () => uploadBytes(
      ref(owner.storage, path(annulledExpenseId, "documento-anulado.pdf")),
      evidenceBytes,
      {contentType: "application/pdf"},
    ));

    // --- Bonus: lectura cross-tenant rechazada ---
    await expectDenied("lectura cross-tenant", () => getBytes(ref(outsider.storage, path(expenseId, "documento.pdf"))));

    console.log("WORK_EXPENSE_EVIDENCE_STORAGE_RULES_SMOKE_OK");
  } finally {
    await Promise.all(clients.map((entry) => deleteApp(entry.app)));
    await deleteAdminApp(adminApp);
  }
}

main().catch((error) => {
  console.error("WORK_EXPENSE_EVIDENCE_STORAGE_RULES_SMOKE_FAILED", error?.code, error?.message);
  process.exitCode = 1;
});
