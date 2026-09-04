import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, getAuth, signInAnonymously} from "firebase/auth";
import {
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import {createRequire} from "node:module";

const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const {initializeApp: initAdmin, deleteApp: deleteAdmin} = requireFromFunctions("firebase-admin/app");
const {getFirestore: getAdminFirestore} = requireFromFunctions("firebase-admin/firestore");

const PROJECT_ID = "tesis-inventario-ia";

async function client(label) {
  const app = initializeApp({apiKey: "demo-key", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID}, `work-budget-${label}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const cred = await signInAnonymously(auth);
  return {app, db, uid: cred.user.uid};
}

async function expectDenied(label, operation) {
  try {
    await operation();
  } catch (error) {
    const code = String(error?.code || "");
    if (code.includes("permission-denied") || code.includes("unauthorized")) {
      console.log(`OK denegado: ${label}`);
      return;
    }
    throw error;
  }
  throw new Error(`Se esperaba denegacion: ${label}`);
}

const adminApp = initAdmin({projectId: PROJECT_ID}, "work-budget-admin");
const adminDb = getAdminFirestore(adminApp);

const owner = await client("owner");
const admin = await client("admin");
const ventas = await client("ventas");
const tecnicoOk = await client("tecnico-ok");
const tecnicoOther = await client("tecnico-other");
const finanzas = await client("finanzas");
const outsider = await client("outsider");

const businessId = "work-budget-business";
const otherBusinessId = "work-budget-other-business";
const workId = "work-budget-project";
const otherWorkId = "work-budget-other-project";
const taskId = "work-budget-task";
const otherBizTaskId = "work-budget-other-biz-task";

await Promise.all([
  adminDb.doc(`usuarios/${owner.uid}`).set({estadoPlataforma: "activo"}),
  adminDb.doc(`usuarios/${admin.uid}`).set({estadoPlataforma: "activo"}),
  adminDb.doc(`usuarios/${ventas.uid}`).set({estadoPlataforma: "activo"}),
  adminDb.doc(`usuarios/${tecnicoOk.uid}`).set({estadoPlataforma: "activo"}),
  adminDb.doc(`usuarios/${tecnicoOther.uid}`).set({estadoPlataforma: "activo"}),
  adminDb.doc(`usuarios/${finanzas.uid}`).set({estadoPlataforma: "activo"}),
  adminDb.doc(`usuarios/${outsider.uid}`).set({estadoPlataforma: "activo"}),
  adminDb.doc(`negocios/${businessId}`).set({estado: "activo", verificacionEmpresa: {estado: "VERIFICADA"}}),
  adminDb.doc(`negocios/${otherBusinessId}`).set({estado: "activo", verificacionEmpresa: {estado: "VERIFICADA"}}),
  adminDb.doc(`membresias/${businessId}__${owner.uid}`).set({negocioId: businessId, uid: owner.uid, rol: "OWNER", estado: "activo"}),
  adminDb.doc(`membresias/${businessId}__${admin.uid}`).set({negocioId: businessId, uid: admin.uid, rol: "ADMIN", estado: "activo"}),
  adminDb.doc(`membresias/${businessId}__${ventas.uid}`).set({negocioId: businessId, uid: ventas.uid, rol: "VENTAS", estado: "activo"}),
  adminDb.doc(`membresias/${businessId}__${tecnicoOk.uid}`).set({negocioId: businessId, uid: tecnicoOk.uid, rol: "TECNICO", estado: "activo"}),
  adminDb.doc(`membresias/${businessId}__${tecnicoOther.uid}`).set({negocioId: businessId, uid: tecnicoOther.uid, rol: "TECNICO", estado: "activo"}),
  adminDb.doc(`membresias/${businessId}__${finanzas.uid}`).set({negocioId: businessId, uid: finanzas.uid, rol: "FINANZAS", estado: "activo"}),
  adminDb.doc(`membresias/${otherBusinessId}__${outsider.uid}`).set({negocioId: otherBusinessId, uid: outsider.uid, rol: "OWNER", estado: "activo"}),
]);

await Promise.all([
  adminDb.doc(`negocios/${businessId}/trabajos/${workId}`).set({
    negocioId: businessId, titulo: "Proyecto de prueba", estado: "activo",
    responsableUid: tecnicoOk.uid, participanteUids: [tecnicoOk.uid],
  }),
  adminDb.doc(`negocios/${businessId}/trabajos/${otherWorkId}`).set({
    negocioId: businessId, titulo: "Proyecto no asignado", estado: "activo",
    responsableUid: "someone-else", participanteUids: [],
  }),
  adminDb.doc(`negocios/${businessId}/trabajos/${workId}/tareas/${taskId}`).set({
    negocioId: businessId, trabajoId: workId, titulo: "Tarea", estado: "activa",
    responsableUid: tecnicoOk.uid,
  }),
  adminDb.doc(`negocios/${businessId}/trabajos/${workId}/gastos/gasto-1`).set({
    negocioId: businessId, trabajoId: workId, monto: 1000, moneda: "CLP",
    registradoPorUid: tecnicoOk.uid, estado: "vigente",
  }),
  adminDb.doc(`negocios/${businessId}/trabajos/${workId}/horasHombre/hh-1`).set({
    negocioId: businessId, trabajoId: workId, horas: 4,
    tecnicoUid: tecnicoOk.uid, estado: "vigente",
  }),
  adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/adicional-1`).set({
    negocioId: businessId, trabajoId: workId, itemId: "item-1", cantidad: 1,
    precioUnitario: 100, estado: "PENDIENTE_COBRO", registradoPorUid: tecnicoOk.uid,
  }),
  adminDb.doc(`negocios/${businessId}/movimientosInventario/mov-1`).set({
    negocioId: businessId, trabajoId: workId, tipo: "SALIDA_PROYECTO",
  }),
  adminDb.doc(`negocios/${otherBusinessId}/trabajos/${otherWorkId}`).set({
    negocioId: otherBusinessId, titulo: "Proyecto ajeno", estado: "activo",
    responsableUid: outsider.uid, participanteUids: [outsider.uid],
  }),
  adminDb.doc(`negocios/${otherBusinessId}/trabajos/${otherWorkId}/tareas/${otherBizTaskId}`).set({
    negocioId: otherBusinessId, trabajoId: otherWorkId, titulo: "Tarea ajena", estado: "activa",
    responsableUid: outsider.uid,
  }),
  adminDb.doc(`negocios/${otherBusinessId}/trabajos/${otherWorkId}/gastos/gasto-ajeno`).set({
    negocioId: otherBusinessId, trabajoId: otherWorkId, monto: 500, moneda: "CLP",
    registradoPorUid: outsider.uid, estado: "vigente",
  }),
]);

const workPath = `negocios/${businessId}/trabajos/${workId}`;
const taskPath = `${workPath}/tareas/${taskId}`;
const gastoPath = `${workPath}/gastos/gasto-1`;
const hhPath = `${workPath}/horasHombre/hh-1`;
const adicionalPath = `${workPath}/adicionales/adicional-1`;

// ================================================================
// CASOS POSITIVOS
// ================================================================

// 1/2. OWNER y ADMIN leen Proyecto autorizado.
if (!(await getDoc(doc(owner.db, workPath))).exists()) throw new Error("OWNER no leyó el Proyecto");
console.log("OK caso 1: OWNER lee Proyecto autorizado sin agotar presupuesto");
if (!(await getDoc(doc(admin.db, workPath))).exists()) throw new Error("ADMIN no leyó el Proyecto");
console.log("OK caso 2: ADMIN lee Proyecto autorizado sin agotar presupuesto");

// 3. Rol operativo legítimo (FINANZAS) lee Proyecto según contrato (ficha, no tareas).
if (!(await getDoc(doc(finanzas.db, workPath))).exists()) throw new Error("FINANZAS no leyó el Proyecto");
console.log("OK caso 3: FINANZAS lee ficha de Proyecto según contrato (canReadWork incluye FINANZAS)");

// 4/5. Usuario legítimo (TECNICO asignado) lee tareas del Proyecto / tarea concreta.
if (!(await getDoc(doc(tecnicoOk.db, taskPath))).exists()) throw new Error("TECNICO asignado no leyó su tarea");
console.log("OK casos 4/5: TECNICO asignado lee la tarea concreta de su Proyecto");

// 6/7. Usuario con permiso adecuado lee gastos / HH.
if (!(await getDoc(doc(owner.db, gastoPath))).exists()) throw new Error("OWNER no leyó el gasto");
if (!(await getDoc(doc(tecnicoOk.db, gastoPath))).exists()) throw new Error("TECNICO autor no leyó su propio gasto");
console.log("OK caso 6: OWNER y TECNICO autor leen gastos según canReadWorkCosts");
if (!(await getDoc(doc(tecnicoOk.db, hhPath))).exists()) throw new Error("TECNICO no leyó su propio registro de HH");
console.log("OK caso 7: TECNICO autoatribuido lee HH según canReadWorkCosts");

// 8. Usuario con permiso adecuado lee materiales (movimientosInventario ligado a Proyecto).
if (!(await getDoc(doc(tecnicoOk.db, `negocios/${businessId}/movimientosInventario/mov-1`))).exists()) {
  throw new Error("TECNICO asignado no leyó el movimiento de materiales de su Proyecto");
}
console.log("OK caso 8: TECNICO asignado lee movimiento de materiales de su Proyecto (canReadWork)");

// 9. Adicionales mantienen lectura prevista.
if (!(await getDoc(doc(owner.db, adicionalPath))).exists()) throw new Error("OWNER no leyó el adicional");
if (!(await getDoc(doc(tecnicoOk.db, adicionalPath))).exists()) throw new Error("TECNICO autor no leyó su adicional");
console.log("OK caso 9: adicionales SPEC 020 mantienen exactamente la misma lectura (canReadWorkCosts sin cambios de política)");

// 10. Proyecto "legacy" válido (MEMBER sin perfil personalizado, acceso pleno histórico).
await adminDb.doc(`membresias/${businessId}__${finanzas.uid}`).set({negocioId: businessId, uid: finanzas.uid, rol: "MEMBER", estado: "activo"});
if (!(await getDoc(doc(finanzas.db, workPath))).exists()) throw new Error("MEMBER legacy no leyó el Proyecto");
if (!(await getDoc(doc(finanzas.db, taskPath))).exists()) throw new Error("MEMBER legacy no leyó la tarea");
await adminDb.doc(`membresias/${businessId}__${finanzas.uid}`).set({negocioId: businessId, uid: finanzas.uid, rol: "FINANZAS", estado: "activo"});
console.log("OK caso 10: MEMBER legacy (sin perfil personalizado) continúa con lectura plena de Proyecto y tareas");

console.log("PARTE 1 (positivos) completa — sin agotamiento de presupuesto en ningún caso.");

// ================================================================
// CASOS NEGATIVOS
// ================================================================

// 11. no autenticado.
{
  const anonApp = initializeApp({apiKey: "demo-key", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID}, "work-budget-noauth");
  const anonDb = getFirestore(anonApp);
  connectFirestoreEmulator(anonDb, "127.0.0.1", 8080);
  await expectDenied("usuario no autenticado lee Proyecto", () => getDoc(doc(anonDb, workPath)));
  await deleteApp(anonApp);
}

// 12/13/21. usuario de otro negocio / workId de otro negocio / subcolección cross-tenant.
await expectDenied("usuario de otro negocio lee Proyecto ajeno por ID conocido", () =>
  getDoc(doc(outsider.db, workPath))
);
await expectDenied("OWNER del negocio A lee Proyecto del negocio B por ID conocido", () =>
  getDoc(doc(owner.db, `negocios/${otherBusinessId}/trabajos/${otherWorkId}`))
);
await expectDenied("OWNER del negocio A lee tarea del negocio B (subcolección cross-tenant)", () =>
  getDoc(doc(owner.db, `negocios/${otherBusinessId}/trabajos/${otherWorkId}/tareas/${otherBizTaskId}`))
);
await expectDenied("OWNER del negocio A lee gasto del negocio B (subcolección cross-tenant)", () =>
  getDoc(doc(owner.db, `negocios/${otherBusinessId}/trabajos/${otherWorkId}/gastos/gasto-ajeno`))
);

// 14. taskId conocido de otro negocio, accedido por un usuario legítimo de ESE otro negocio pero con rol sin asignación.
await expectDenied("OUTSIDER (rol OWNER de su propio negocio) no puede leer una tarea vía el path de otro negocio inventado", () =>
  getDoc(doc(outsider.db, taskPath))
);

// 15. usuario sin módulo Projects/Works (VENTAS).
await expectDenied("VENTAS no lee Proyecto (sin módulo trabajos/reportes)", () => getDoc(doc(ventas.db, workPath)));
await expectDenied("VENTAS no lee tareas del Proyecto", () => getDoc(doc(ventas.db, taskPath)));

// 16. rol sin lectura (TECNICO no asignado al Proyecto).
await expectDenied("TECNICO no asignado no lee el Proyecto", () => getDoc(doc(tecnicoOther.db, workPath)));
await expectDenied("TECNICO no asignado no lee la tarea", () => getDoc(doc(tecnicoOther.db, taskPath)));

// 17. rol con lectura operativa pero sin lectura de costos intenta leer gastos (TECNICO asignado al
// Proyecto pero NO autoatribuido a ESE gasto específico).
await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/gastos/gasto-otro-tecnico`).set({
  negocioId: businessId, trabajoId: workId, monto: 200, moneda: "CLP",
  registradoPorUid: "alguien-mas", estado: "vigente",
});
await expectDenied("TECNICO asignado al Proyecto pero no autoatribuido no lee un gasto ajeno dentro del mismo Proyecto", () =>
  getDoc(doc(tecnicoOk.db, `negocios/${businessId}/trabajos/${workId}/gastos/gasto-otro-tecnico`))
);

// 18. usuario sin profitability/costos (TECNICO) intenta leer HH ajeno (información económica protegida).
await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/horasHombre/hh-otro-tecnico`).set({
  negocioId: businessId, trabajoId: workId, horas: 2, tecnicoUid: "alguien-mas", estado: "vigente",
});
await expectDenied("TECNICO no lee HH económico ajeno dentro de su propio Proyecto", () =>
  getDoc(doc(tecnicoOk.db, `negocios/${businessId}/trabajos/${workId}/horasHombre/hh-otro-tecnico`))
);

// 19. businessId manipulado (documento con negocioId real distinto al del path).
await adminDb.doc(`negocios/${businessId}/trabajos/spoofed-work`).set({
  negocioId: otherBusinessId, titulo: "Spoofed", estado: "activo", responsableUid: owner.uid, participanteUids: [],
});
await expectDenied("Proyecto con negocioId real distinto al del path (spoofed) se rechaza", () =>
  getDoc(doc(owner.db, `negocios/${businessId}/trabajos/spoofed-work`))
);

// 20. relación Work→Business inválida (tarea cuyo trabajoId real no coincide con el path).
await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/tareas/spoofed-task`).set({
  negocioId: businessId, trabajoId: otherWorkId, titulo: "Spoofed task", estado: "activa", responsableUid: owner.uid,
});
await expectDenied("Tarea cuyo trabajoId real no coincide con el Proyecto del path se rechaza", () =>
  getDoc(doc(owner.db, `negocios/${businessId}/trabajos/${workId}/tareas/spoofed-task`))
);

// 22/23. update/delete no autorizados.
await expectDenied("cliente actualiza tarea directamente", () =>
  updateDoc(doc(owner.db, taskPath), {titulo: "hackeado"})
);
await expectDenied("cliente elimina tarea directamente", () => deleteDoc(doc(owner.db, taskPath)));
await expectDenied("cliente actualiza gasto directamente", () =>
  updateDoc(doc(owner.db, gastoPath), {monto: 999999})
);
await expectDenied("cliente elimina Proyecto directamente", () => deleteDoc(doc(owner.db, workPath)));

// 24. acceso por ID directo sin permiso (TECNICO no asignado, ID exacto conocido de una tarea).
await expectDenied("TECNICO no asignado accede por ID directo a una tarea que no le pertenece", () =>
  getDoc(doc(tecnicoOther.db, taskPath))
);

console.log("PARTE 2 (negativos) completa — todos denegados, sin agotamiento de presupuesto en ningún caso.");

await Promise.all([
  deleteApp(owner.app), deleteApp(admin.app), deleteApp(ventas.app),
  deleteApp(tecnicoOk.app), deleteApp(tecnicoOther.app), deleteApp(finanzas.app), deleteApp(outsider.app),
]);
await deleteAdmin(adminApp);
console.log("WORK_RULES_BUDGET_FIX_SMOKE_OK");
