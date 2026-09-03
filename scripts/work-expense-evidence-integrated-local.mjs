import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, createUserWithEmailAndPassword, getAuth} from "firebase/auth";
import {connectFirestoreEmulator, getFirestore, terminate} from "firebase/firestore";
import {connectFunctionsEmulator, getFunctions, httpsCallable} from "firebase/functions";
import {connectStorageEmulator, getStorage, ref, uploadBytes} from "firebase/storage";

// SPEC 020 ETAPA 3: registro autoritativo de evidencia documental de gastos.
// Emulator Suite real (auth + firestore + functions + storage), nunca
// Firebase real. Mismo arnés que work-additional-integrated-local.mjs
// (ETAPA 2) y business-verification-integrated.mjs, extendido con Storage
// para poder subir archivos reales antes de registrar su metadata.

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ||= PROJECT_ID;
const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const {deleteApp: deleteAdminApp, initializeApp: initializeAdminApp} = requireFromFunctions("firebase-admin/app");
const {getFirestore: getAdminFirestore} = requireFromFunctions("firebase-admin/firestore");
const {getStorage: getAdminStorage} = requireFromFunctions("firebase-admin/storage");
const workPersistenceExports = requireFromFunctions("../functions/workPersistence.js");

function createClientApp(name) {
  const app = initializeApp({apiKey: "demo-key", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.firebasestorage.app`, appId: `wkevidence-${name}-${RUN_ID}`}, `wkevidence-${name}-${RUN_ID}`);
  const auth = getAuth(app); const db = getFirestore(app); const functions = getFunctions(app, "us-central1"); const storage = getStorage(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  connectFirestoreEmulator(db, "127.0.0.1", 8080); connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  return {app, auth, db, functions, storage};
}
async function authenticate(client, label) {
  const credential = await createUserWithEmailAndPassword(client.auth, `wkevidence-${label}-${RUN_ID}@example.test`, `WkEvidence-${RUN_ID}-Pass!`);
  client.uid = credential.user.uid;
  return client;
}
const callable = (client, name) => httpsCallable(client.functions, name);
const requestId = (label) => `wkevidence-${RUN_ID}-${label}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
async function expectCallableError(label, operation, expectedCodes) {
  try {
    await operation();
  } catch (error) {
    const code = String(error?.code || "");
    assert.ok(expectedCodes.some((expected) => code.includes(expected)), `${label}: código inesperado ${code} (${error?.message})`);
    console.log(`OK rechazo: ${label}`);
    return;
  }
  throw new Error(`Se esperaba rechazo: ${label}`);
}

const owner = await authenticate(createClientApp("owner"), "owner");
const technicianOwn = await authenticate(createClientApp("technician-own"), "technician-own");
const technicianOther = await authenticate(createClientApp("technician-other"), "technician-other");
const finance = await authenticate(createClientApp("finance"), "finance");
const outsider = await authenticate(createClientApp("outsider"), "outsider");
const clients = [owner, technicianOwn, technicianOther, finance, outsider];

const adminApp = initializeAdminApp({projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.firebasestorage.app`}, `wkevidence-admin-${RUN_ID}`);
const adminDb = getAdminFirestore(adminApp);
const adminBucket = getAdminStorage(adminApp).bucket();

try {
  const main = await callable(owner, "createFirstBusiness")({nombreComercial: "Negocio evidencia", rubroCodigo: "INGENIERIA_CONSULTORIA", regionCodigo: "13", requestId: requestId("business-main")});
  const other = await callable(outsider, "createFirstBusiness")({nombreComercial: "Negocio externo evidencia", rubroCodigo: "INGENIERIA_CONSULTORIA", regionCodigo: "13", requestId: requestId("business-other")});
  const businessId = main.data.business.id;
  const otherBusinessId = other.data.business.id;
  await Promise.all([
    adminDb.doc(`negocios/${businessId}`).set({identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.500.500-5", verificacionEmpresa: {estado: "VERIFICADA", identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.500.500-5"}}, {merge: true}),
    adminDb.doc(`negocios/${otherBusinessId}`).set({identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.900.900-9", verificacionEmpresa: {estado: "VERIFICADA", identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.900.900-9"}}, {merge: true}),
    adminDb.doc(`membresias/${businessId}__${technicianOwn.uid}`).set({negocioId: businessId, uid: technicianOwn.uid, rol: "TECNICO", estado: "activo"}),
    adminDb.doc(`membresias/${businessId}__${technicianOther.uid}`).set({negocioId: businessId, uid: technicianOther.uid, rol: "TECNICO", estado: "activo"}),
    adminDb.doc(`membresias/${businessId}__${finance.uid}`).set({negocioId: businessId, uid: finance.uid, rol: "FINANZAS", estado: "activo"}),
  ]);

  const project = await callable(owner, "crearTrabajo")({businessId, requestId: requestId("work-main"), trabajo: {titulo: "Instalación con evidencia", descripcion: "", clienteId: "", responsableUid: technicianOwn.uid, participanteUids: [], estado: "pendiente", prioridad: "normal", fechaInicio: "", fechaPrevista: ""}});
  const workId = project.data.trabajoId;

  const registrar = callable(technicianOwn, "registrarGastoTrabajo");
  const gastoBase = {concepto: "Materiales de instalación", monto: 45000, categoria: "MATERIAL", responsableDelGastoUid: technicianOwn.uid, fecha: "2026-09-03", observacion: "", tareaId: ""};
  const expense = await registrar({businessId, trabajoId: workId, requestId: requestId("expense-main"), gasto: gastoBase});
  const expenseId = expense.data.gastoId;
  const otherExpense = await registrar({businessId, trabajoId: workId, requestId: requestId("expense-other"), gasto: {...gastoBase, concepto: "Otro gasto sin evidencia"}});
  const otherExpenseId = otherExpense.data.gastoId;
  const annullableExpense = await registrar({businessId, trabajoId: workId, requestId: requestId("expense-annullable"), gasto: {...gastoBase, concepto: "Gasto que será anulado"}});
  const annullableExpenseId = annullableExpense.data.gastoId;

  const adjuntar = callable(technicianOwn, "adjuntarEvidenciaGastoTrabajo");
  const expensePath = (expId, fileName) => `negocios/${businessId}/trabajos/${workId}/gastos/${expId}/${fileName}`;
  const evidenceBytes = new TextEncoder().encode("evidencia real de gasto");

  // --- Casos 13/14/15: registrar PDF/JPG/PNG válidos ---
  for (const [fileName, contentType, label] of [
    ["documento.pdf", "application/pdf", "PDF"],
    ["documento.jpg", "image/jpeg", "JPG"],
    ["documento.png", "image/png", "PNG"],
  ]) {
    await uploadBytes(ref(technicianOwn.storage, expensePath(expenseId, fileName)), evidenceBytes, {contentType});
    const registered = await adjuntar({businessId, trabajoId: workId, gastoId: expenseId, nombreArchivo: fileName, requestId: requestId(`attach-${fileName}`)});
    assert.ok(registered.data.evidenciaId);
    assert.equal(registered.data.idempotent, false);
    console.log(`OK caso: registrar ${label} válido`);
  }
  const expenseAfterThree = (await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/gastos/${expenseId}`).get()).data();
  assert.equal(expenseAfterThree.evidencia.length, 3);
  assert.deepEqual(expenseAfterThree.evidencia.map((entry) => entry.nombreArchivo).sort(), ["documento.jpg", "documento.pdf", "documento.png"]);
  console.log("OK casos 13/14/15: los 3 formatos quedan asociados de forma independiente, sin reemplazarse entre sí");

  // --- Caso 16: objeto inexistente rechazado (nunca se subió ese archivo) ---
  await expectCallableError("objeto inexistente", () => adjuntar({businessId, trabajoId: workId, gastoId: expenseId, nombreArchivo: "nunca-subido.pdf", requestId: requestId("missing-object")}), ["not-found"]);

  // --- Caso 17: "path ajeno" — no existe un canal para que el cliente envíe
  // una ruta propia (sólo nombreArchivo; la ruta la reconstruye el servidor,
  // ver §A del informe). Se prueba en su lugar que un archivo subido bajo un
  // gasto no puede "tomarse prestado" registrándolo contra otro gasto: el
  // servidor reconstruye la ruta esperada usando el gastoId real de la
  // llamada, así que la Function busca un objeto que no existe en ESA ruta.
  await expectCallableError("intento de reutilizar evidencia de otro gasto", () => adjuntar({businessId, trabajoId: workId, gastoId: otherExpenseId, nombreArchivo: "documento.pdf", requestId: requestId("borrowed-path")}), ["not-found"]);
  assert.equal(((await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/gastos/${otherExpenseId}`).get()).data().evidencia || []).length, 0);

  // --- Caso 18: business cross-tenant rechazado ---
  await expectCallableError("business cross-tenant", () => callable(outsider, "adjuntarEvidenciaGastoTrabajo")({businessId, trabajoId: workId, gastoId: expenseId, nombreArchivo: "documento.pdf", requestId: requestId("cross-business")}), ["permission-denied", "failed-precondition"]);

  // --- Caso 19: work cross-tenant (negocioId adulterado) rechazado ---
  const spoofedWorkId = `spoofed-${RUN_ID}`;
  await adminDb.doc(`negocios/${businessId}/trabajos/${spoofedWorkId}`).set({...(await adminDb.doc(`negocios/${businessId}/trabajos/${workId}`).get()).data(), negocioId: otherBusinessId});
  await expectCallableError("work con negocioId de otro negocio", () => adjuntar({businessId, trabajoId: spoofedWorkId, gastoId: expenseId, nombreArchivo: "documento.pdf", requestId: requestId("spoofed-work")}), ["permission-denied"]);

  // --- Caso 20: expense ajeno/inexistente rechazado ---
  await expectCallableError("expense inexistente", () => adjuntar({businessId, trabajoId: workId, gastoId: "gasto-inexistente", nombreArchivo: "documento.pdf", requestId: requestId("missing-expense")}), ["not-found"]);
  const foreignWorkGasto = `foreign-work-expense-${RUN_ID}`;
  await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/gastos/${foreignWorkGasto}`).set({...(await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/gastos/${expenseId}`).get()).data(), trabajoId: "otro-trabajo-cualquiera"});
  await expectCallableError("expense con trabajoId adulterado", () => adjuntar({businessId, trabajoId: workId, gastoId: foreignWorkGasto, nombreArchivo: "documento.pdf", requestId: requestId("foreign-work-gasto")}), ["not-found"]);
  console.log("OK casos 18/19/20: aislamiento multiempresa/multiproyecto verificado en cada capa");

  // --- Bonus RBAC: FINANZAS y TECNICO ajeno rechazados también a nivel Function ---
  await expectCallableError("FINANZAS no adjunta evidencia", () => callable(finance, "adjuntarEvidenciaGastoTrabajo")({businessId, trabajoId: workId, gastoId: expenseId, nombreArchivo: "documento.pdf", requestId: requestId("finance-attach")}), ["permission-denied"]);
  await expectCallableError("TECNICO sobre gasto ajeno no adjunta evidencia", () => callable(technicianOther, "adjuntarEvidenciaGastoTrabajo")({businessId, trabajoId: workId, gastoId: expenseId, nombreArchivo: "documento.pdf", requestId: requestId("tech-other-attach")}), ["permission-denied"]);

  // --- Casos 21/22: MIME/size reales inválidos (objeto sembrado directo en Storage, sin pasar por Storage Rules) ---
  const invalidMimePath = expensePath(otherExpenseId, "documento-mime-invalido.pdf");
  await adminBucket.file(invalidMimePath).save(Buffer.from("contenido con mime real inválido"), {contentType: "text/plain", resumable: false});
  await expectCallableError("MIME real inválido", () => adjuntar({businessId, trabajoId: workId, gastoId: otherExpenseId, nombreArchivo: "documento-mime-invalido.pdf", requestId: requestId("invalid-mime")}), ["invalid-argument"]);
  const oversizedPath = expensePath(otherExpenseId, "documento-oversized.pdf");
  await adminBucket.file(oversizedPath).save(Buffer.alloc(5 * 1024 * 1024 + 1, 1), {contentType: "application/pdf", resumable: false});
  await expectCallableError("size real >5MB", () => adjuntar({businessId, trabajoId: workId, gastoId: otherExpenseId, nombreArchivo: "documento-oversized.pdf", requestId: requestId("oversized")}), ["invalid-argument"]);
  assert.equal(((await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/gastos/${otherExpenseId}`).get()).data().evidencia || []).length, 0);
  console.log("OK casos 21/22: la Function nunca confía en el contentType/size declarado por Storage Rules, siempre relee el objeto real");

  // --- Caso 23: llamada duplicada (mismo requestId) no duplica evidencia ---
  await uploadBytes(ref(technicianOwn.storage, expensePath(otherExpenseId, "documento-idempotente.pdf")), evidenceBytes, {contentType: "application/pdf"});
  const idempotentRequestId = requestId("idempotent-attach");
  const firstAttach = await adjuntar({businessId, trabajoId: workId, gastoId: otherExpenseId, nombreArchivo: "documento-idempotente.pdf", requestId: idempotentRequestId});
  const secondAttach = await adjuntar({businessId, trabajoId: workId, gastoId: otherExpenseId, nombreArchivo: "documento-idempotente.pdf", requestId: idempotentRequestId});
  assert.equal(secondAttach.data.evidenciaId, firstAttach.data.evidenciaId);
  assert.equal(secondAttach.data.idempotent, true);
  assert.equal((await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/gastos/${otherExpenseId}`).get()).data().evidencia.length, 1);
  // Reintento con un requestId nuevo, mismo archivo ya registrado: también idempotente por storagePath, no duplica
  const thirdAttach = await adjuntar({businessId, trabajoId: workId, gastoId: otherExpenseId, nombreArchivo: "documento-idempotente.pdf", requestId: requestId("idempotent-attach-retry")});
  assert.equal(thirdAttach.data.idempotent, true);
  assert.equal((await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/gastos/${otherExpenseId}`).get()).data().evidencia.length, 1);
  console.log("OK caso 23: doble llamada (mismo requestId o mismo archivo) nunca duplica evidencia");

  // --- Casos 24/25: metadata económica del gasto no cambia ---
  const expenseBefore = (await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/gastos/${expenseId}`).get()).data();
  assert.equal(expenseBefore.monto, 45000);
  assert.equal(expenseBefore.moneda, "CLP");
  assert.equal(expenseBefore.categoria, "MATERIAL");
  assert.equal(expenseBefore.estado, "vigente");
  console.log("OK casos 24/25: monto/moneda/categoría/estado del gasto quedan intactos tras adjuntar 3 evidencias");

  // --- Caso 26: balance del Proyecto idéntico antes/después ---
  const balanceBefore = await callable(owner, "obtenerBalanceTrabajo")({businessId, trabajoId: workId});
  await uploadBytes(ref(technicianOwn.storage, expensePath(annullableExpenseId, "documento-balance.pdf")), evidenceBytes, {contentType: "application/pdf"});
  await adjuntar({businessId, trabajoId: workId, gastoId: annullableExpenseId, nombreArchivo: "documento-balance.pdf", requestId: requestId("balance-check")});
  const balanceAfter = await callable(owner, "obtenerBalanceTrabajo")({businessId, trabajoId: workId});
  assert.deepEqual({...balanceAfter.data, calculadoEn: null}, {...balanceBefore.data, calculadoEn: null}, "adjuntar evidencia no debe alterar el balance del proyecto (se excluye calculadoEn: timestamp de cálculo en vivo)");
  console.log("OK caso 26: balance del Proyecto idéntico antes/después de adjuntar evidencia");

  // --- Caso 27: evidencia queda asociada exclusivamente al gasto correcto ---
  const expenseIdEvidence = (await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/gastos/${expenseId}`).get()).data().evidencia;
  const annullableEvidence = (await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/gastos/${annullableExpenseId}`).get()).data().evidencia;
  assert.equal(expenseIdEvidence.length, 3);
  assert.equal(annullableEvidence.length, 1);
  assert.ok(expenseIdEvidence.every((entry) => entry.storagePath.includes(`/gastos/${expenseId}/`)));
  assert.ok(annullableEvidence.every((entry) => entry.storagePath.includes(`/gastos/${annullableExpenseId}/`)));
  console.log("OK caso 27: cada evidencia queda asociada exclusivamente al gasto correcto, sin fuga entre gastos");

  // --- Caso 28: no se puede falsificar createdBy/createdAt ---
  await uploadBytes(ref(technicianOwn.storage, expensePath(otherExpenseId, "documento-spoof.pdf")), evidenceBytes, {contentType: "application/pdf"});
  const spoofAttempt = await adjuntar({businessId, trabajoId: workId, gastoId: otherExpenseId, nombreArchivo: "documento-spoof.pdf", requestId: requestId("spoof-metadata"), subidoPorUid: "uid-falsificado", subidoEn: "2000-01-01T00:00:00.000Z"});
  const spoofedEntry = (await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/gastos/${otherExpenseId}`).get()).data().evidencia.find((entry) => entry.id === spoofAttempt.data.evidenciaId);
  assert.equal(spoofedEntry.subidoPorUid, technicianOwn.uid, "subidoPorUid siempre es el uid autenticado real, el payload no tiene ningún campo que lo sobrescriba");
  assert.notEqual(spoofedEntry.subidoEn, "2000-01-01T00:00:00.000Z");
  assert.ok(new Date(spoofedEntry.subidoEn).getTime() > Date.now() - 60000, "subidoEn debe ser un timestamp real y reciente, no el valor inyectado");
  console.log("OK caso 28: createdBy/createdAt (subidoPorUid/subidoEn) no se pueden falsificar; el payload no tiene ningún canal para ellos");

  // --- Caso 29: evidencia de gasto anulado se preserva; no admite evidencia nueva ---
  const anular = callable(owner, "anularGastoTrabajo");
  await anular({businessId, trabajoId: workId, gastoId: annullableExpenseId, motivo: "Verificación de preservación de evidencia", requestId: requestId("annul-with-evidence")});
  const annulledStored = (await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/gastos/${annullableExpenseId}`).get()).data();
  assert.equal(annulledStored.estado, "anulado");
  assert.equal(annulledStored.evidencia.length, 1, "la evidencia ya asociada se conserva íntegra tras anular el gasto");
  assert.equal(annulledStored.evidencia[0].storagePath, expensePath(annullableExpenseId, "documento-balance.pdf"));
  // Subir directo vía SDK cliente a un gasto ya anulado también lo rechaza
  // storage.rules (canCreateWorkExpenseEvidence exige estado == "vigente"),
  // así que para probar la defensa PROPIA de la Function (server-side,
  // independiente de Storage Rules) se siembra el objeto directo con el
  // bucket admin, bypasseando Storage Rules, igual que en los casos 21/22.
  const postAnnulPath = expensePath(annullableExpenseId, "documento-post-anulacion.pdf");
  await adminBucket.file(postAnnulPath).save(Buffer.from(evidenceBytes), {contentType: "application/pdf", resumable: false});
  await expectCallableError("adjuntar evidencia a gasto anulado", () => adjuntar({businessId, trabajoId: workId, gastoId: annullableExpenseId, nombreArchivo: "documento-post-anulacion.pdf", requestId: requestId("attach-after-annul")}), ["failed-precondition"]);
  assert.equal((await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/gastos/${annullableExpenseId}`).get()).data().evidencia.length, 1, "el intento rechazado no debe agregar nada");
  console.log("OK caso 29: la evidencia de un gasto anulado se conserva íntegra; no admite evidencia nueva (rechazado tanto por Storage Rules como, de forma independiente, por la Function)");

  // --- Caso 30: no existe delete físico expuesto al cliente ---
  const exportedHandlers = Object.keys(workPersistenceExports);
  const deleteLikeExports = exportedHandlers.filter((name) => /evidenc/i.test(name) && /(eliminar|borrar|delete|remove)/i.test(name));
  assert.deepEqual(deleteLikeExports, [], "no debe existir ninguna Function que borre evidencia; sólo adjuntarEvidenciaGastoTrabajoHandler existe para esta feature");
  assert.ok(exportedHandlers.includes("adjuntarEvidenciaGastoTrabajoHandler"));
  console.log("OK caso 30: no existe ninguna Function de borrado de evidencia expuesta (complementa el delete directo de Storage, ya cubierto por work-expense-evidence-storage-rules-smoke.mjs)");

  console.log("WORK_EXPENSE_EVIDENCE_INTEGRATED_LOCAL_OK");
} finally {
  await Promise.all(clients.map((client) => terminate(client.db)));
  await Promise.all(clients.map((client) => deleteApp(client.app)));
  await deleteAdminApp(adminApp);
}
