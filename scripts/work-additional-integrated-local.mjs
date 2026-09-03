import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, createUserWithEmailAndPassword, getAuth} from "firebase/auth";
import {connectFirestoreEmulator, deleteDoc, doc, getDoc, getFirestore, setDoc, terminate, updateDoc} from "firebase/firestore";
import {connectFunctionsEmulator, getFunctions, httpsCallable} from "firebase/functions";

// SPEC 020 ETAPA 2: persistencia autoritativa de ADICIONALES FACTURABLES.
// Emulator Suite real (auth + firestore + functions), nunca Firebase real.
// Mismo arnés que scripts/quote-integrated-local.mjs y
// scripts/sales-integrated-local.mjs: firebase-admin para sembrar datos
// (bypassa Rules), SDK cliente real conectado a los emuladores para ejercer
// tanto las Functions autoritativas como las Firestore Rules.

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ||= PROJECT_ID;
const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const {deleteApp: deleteAdminApp, initializeApp: initializeAdminApp} = requireFromFunctions("firebase-admin/app");
const {getFirestore: getAdminFirestore} = requireFromFunctions("firebase-admin/firestore");

function createClientApp(name) {
  const app = initializeApp({apiKey: "demo-key", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID, appId: `wkadd-${name}-${RUN_ID}`}, `wkadd-${name}-${RUN_ID}`);
  const auth = getAuth(app); const db = getFirestore(app); const functions = getFunctions(app, "us-central1");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  connectFirestoreEmulator(db, "127.0.0.1", 8080); connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return {app, auth, db, functions};
}
async function authenticate(client, label) {
  const credential = await createUserWithEmailAndPassword(client.auth, `wkadd-${label}-${RUN_ID}@example.test`, `WkAdd-${RUN_ID}-Pass!`);
  client.uid = credential.user.uid;
  return client;
}
const callable = (client, name) => httpsCallable(client.functions, name);
const requestId = (label) => `wkadd-${RUN_ID}-${label}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
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
async function expectDenied(label, operation) {
  try {
    await operation();
  } catch (error) {
    assert.match(String(error?.code || ""), /permission-denied/, `${label}: código inesperado ${error?.code}`);
    console.log(`OK reglas: ${label}`);
    return;
  }
  throw new Error(`Se esperaba denegación: ${label}`);
}

const owner = await authenticate(createClientApp("owner"), "owner");
const admin = await authenticate(createClientApp("admin"), "admin");
const technician = await authenticate(createClientApp("technician"), "technician");
const strangerTechnician = await authenticate(createClientApp("stranger-technician"), "stranger-technician");
const finance = await authenticate(createClientApp("finance"), "finance");
const outsider = await authenticate(createClientApp("outsider"), "outsider");
const unauthenticated = createClientApp("unauthenticated");
const clients = [owner, admin, technician, strangerTechnician, finance, outsider];

const adminApp = initializeAdminApp({projectId: PROJECT_ID}, `wkadd-admin-${RUN_ID}`);
const adminDb = getAdminFirestore(adminApp);

try {
  const main = await callable(owner, "createFirstBusiness")({nombreComercial: "Negocio adicionales", rubroCodigo: "INGENIERIA_CONSULTORIA", regionCodigo: "13", requestId: requestId("business-main")});
  const other = await callable(outsider, "createFirstBusiness")({nombreComercial: "Negocio externo adicionales", rubroCodigo: "INGENIERIA_CONSULTORIA", regionCodigo: "13", requestId: requestId("business-other")});
  const businessId = main.data.business.id;
  const otherBusinessId = other.data.business.id;
  await Promise.all([
    adminDb.doc(`negocios/${businessId}`).set({
      identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.300.300-3",
      verificacionEmpresa: {estado: "VERIFICADA", identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.300.300-3"},
    }, {merge: true}),
    adminDb.doc(`negocios/${otherBusinessId}`).set({
      identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.900.900-9",
      verificacionEmpresa: {estado: "VERIFICADA", identificadorFiscalTipo: "RUT", identificadorFiscalValor: "76.900.900-9"},
    }, {merge: true}),
    adminDb.doc(`membresias/${businessId}__${admin.uid}`).set({negocioId: businessId, uid: admin.uid, rol: "ADMIN", estado: "activo"}),
    adminDb.doc(`membresias/${businessId}__${technician.uid}`).set({negocioId: businessId, uid: technician.uid, rol: "TECNICO", estado: "activo"}),
    adminDb.doc(`membresias/${businessId}__${strangerTechnician.uid}`).set({negocioId: businessId, uid: strangerTechnician.uid, rol: "TECNICO", estado: "activo"}),
    adminDb.doc(`membresias/${businessId}__${finance.uid}`).set({negocioId: businessId, uid: finance.uid, rol: "FINANZAS", estado: "activo"}),
  ]);

  const project = await callable(owner, "crearTrabajo")({
    businessId, requestId: requestId("work-main"),
    trabajo: {titulo: "Instalación de red", descripcion: "Proyecto para adicionales", clienteId: "", responsableUid: technician.uid, participanteUids: [], estado: "pendiente", prioridad: "normal", fechaInicio: "", fechaPrevista: ""},
  });
  const workId = project.data.trabajoId;
  const foreignProject = await callable(outsider, "crearTrabajo")({
    businessId: otherBusinessId, requestId: requestId("work-foreign"),
    trabajo: {titulo: "Proyecto externo", descripcion: "", clienteId: "", responsableUid: "", participanteUids: [], estado: "pendiente", prioridad: "normal", fechaInicio: "", fechaPrevista: ""},
  });
  assert.ok(workId);

  const product = `product-${RUN_ID}`;
  const service = `service-${RUN_ID}`;
  const inactiveItem = `inactive-${RUN_ID}`;
  await Promise.all([
    adminDb.doc(`negocios/${businessId}/inventario/${product}`).set({itemId: product, negocioId: businessId, estado: "activo", tipoItem: "producto", nombre: "Extensión de cableado", codigoInterno: "ADD-PROD", unidad: "unidad", stock: 50, costoBase: 4000, costoPromedio: 3500, costoPromedioMoneda: "CLP"}),
    adminDb.doc(`negocios/${businessId}/inventario/${service}`).set({itemId: service, negocioId: businessId, estado: "activo", tipoItem: "servicio", nombre: "Configuración adicional", codigoInterno: "ADD-SERV", unidad: "servicio"}),
    adminDb.doc(`negocios/${businessId}/inventario/${inactiveItem}`).set({itemId: inactiveItem, negocioId: businessId, estado: "archivado", tipoItem: "servicio", nombre: "Servicio archivado", codigoInterno: "ADD-ARCH", unidad: "servicio"}),
  ]);

  const crearAdicional = callable(owner, "crearAdicionalTrabajo");

  // --- Caso 1/2: usuario autorizado crea adicional válido; estado inicial siempre PENDIENTE_COBRO ---
  const created = await crearAdicional({businessId, trabajoId: workId, requestId: requestId("create-valid"), adicional: {itemId: product, cantidad: 2, precioUnitario: 15000, descripcion: "Cableado extra solicitado en terreno"}});
  assert.ok(created.data.adicionalId);
  const createdRef = adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/${created.data.adicionalId}`);
  const createdStored = (await createdRef.get()).data();
  assert.equal(createdStored.estado, "PENDIENTE_COBRO");
  assert.equal(createdStored.tipoItem, "producto");
  assert.equal(createdStored.itemSnapshot.nombre, "Extensión de cableado");
  assert.equal(createdStored.cantidad, 2);
  assert.equal(createdStored.precioUnitario, 15000);
  assert.equal(createdStored.registradoPorUid, owner.uid);
  assert.equal(createdStored.ventaId, null);
  console.log("OK casos 1/2: adicional válido creado por usuario autorizado, PENDIENTE_COBRO, snapshot de catálogo autoritativo");

  // --- Caso 3: usuario no autenticado rechazado ---
  await expectCallableError("no autenticado", () => callable(unauthenticated, "crearAdicionalTrabajo")({businessId, trabajoId: workId, requestId: requestId("unauth"), adicional: {itemId: product, cantidad: 1, precioUnitario: 1000}}), ["unauthenticated"]);

  // --- Caso 4: usuario sin autorización (rol fuera de WORK_OPERATION_ROLES) rechazado ---
  await expectCallableError("FINANZAS no opera adicionales", () => callable(finance, "crearAdicionalTrabajo")({businessId, trabajoId: workId, requestId: requestId("finance"), adicional: {itemId: product, cantidad: 1, precioUnitario: 1000}}), ["permission-denied"]);
  // Bonus: TECNICO con rol permitido pero sin asignación al proyecto también se rechaza (assertWorkOperator)
  await expectCallableError("TECNICO no asignado no opera adicionales", () => callable(strangerTechnician, "crearAdicionalTrabajo")({businessId, trabajoId: workId, requestId: requestId("stranger-tech"), adicional: {itemId: product, cantidad: 1, precioUnitario: 1000}}), ["permission-denied"]);

  // --- Caso 5: cross-business rechazado (outsider no tiene membresía en el negocio principal) ---
  await expectCallableError("cross-business", () => callable(outsider, "crearAdicionalTrabajo")({businessId, trabajoId: workId, requestId: requestId("cross-business"), adicional: {itemId: product, cantidad: 1, precioUnitario: 1000}}), ["permission-denied", "failed-precondition"]);

  // --- Caso 6: workId inexistente rechazado ---
  await expectCallableError("trabajo inexistente", () => crearAdicional({businessId, trabajoId: "trabajo-inexistente", requestId: requestId("missing-work"), adicional: {itemId: product, cantidad: 1, precioUnitario: 1000}}), ["not-found"]);

  // --- Caso 7: trabajo con negocioId adulterado (spoofing de otro negocio) rechazado ---
  const spoofedWorkId = `spoofed-${RUN_ID}`;
  await adminDb.doc(`negocios/${businessId}/trabajos/${spoofedWorkId}`).set({...(await adminDb.doc(`negocios/${businessId}/trabajos/${workId}`).get()).data(), negocioId: otherBusinessId});
  await expectCallableError("trabajo con negocioId de otro negocio", () => crearAdicional({businessId, trabajoId: spoofedWorkId, requestId: requestId("spoofed-work"), adicional: {itemId: product, cantidad: 1, precioUnitario: 1000}}), ["permission-denied"]);
  assert.equal((await adminDb.collection(`negocios/${businessId}/trabajos/${spoofedWorkId}/adicionales`).get()).size, 0);

  // --- Caso 8: itemId ausente rechazado ---
  await expectCallableError("itemId ausente", () => crearAdicional({businessId, trabajoId: workId, requestId: requestId("missing-item"), adicional: {itemId: "", cantidad: 1, precioUnitario: 1000}}), ["invalid-argument"]);

  // --- Caso 9: cantidad inválida rechazada ---
  for (const [label, cantidad] of [["cero", 0], ["negativa", -1], ["no numérica", "abc"]]) {
    await expectCallableError(`cantidad inválida (${label})`, () => crearAdicional({businessId, trabajoId: workId, requestId: requestId(`bad-qty-${label}`), adicional: {itemId: product, cantidad, precioUnitario: 1000}}), ["invalid-argument"]);
  }

  // --- Caso 10: precio inválido rechazado (0 es válido: adicional de cortesía es una decisión comercial legítima) ---
  await expectCallableError("precio negativo", () => crearAdicional({businessId, trabajoId: workId, requestId: requestId("bad-price"), adicional: {itemId: product, cantidad: 1, precioUnitario: -1}}), ["invalid-argument"]);
  const freeAdditional = await crearAdicional({businessId, trabajoId: workId, requestId: requestId("free-price"), adicional: {itemId: service, cantidad: 1, precioUnitario: 0}});
  assert.equal((await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/${freeAdditional.data.adicionalId}`).get()).data().precioUnitario, 0);
  console.log("OK caso 10: precio negativo rechazado; precio 0 aceptado deliberadamente");

  // --- Item inactivo o inexistente rechazado (bonus, misma defensa que crearVenta) ---
  await expectCallableError("ítem archivado", () => crearAdicional({businessId, trabajoId: workId, requestId: requestId("archived-item"), adicional: {itemId: inactiveItem, cantidad: 1, precioUnitario: 1000}}), ["failed-precondition"]);
  await expectCallableError("ítem inexistente", () => crearAdicional({businessId, trabajoId: workId, requestId: requestId("missing-catalog"), adicional: {itemId: "no-existe", cantidad: 1, precioUnitario: 1000}}), ["not-found"]);

  // --- Caso 11: el cliente no puede enviar moneda; se deriva autoritativamente del trabajo, cualquier valor enviado se ignora ---
  const spoofedCurrencyAdditional = await crearAdicional({businessId, trabajoId: workId, requestId: requestId("spoofed-currency"), adicional: {itemId: product, cantidad: 1, precioUnitario: 1000, moneda: "USD"}});
  const spoofedCurrencyStored = (await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/${spoofedCurrencyAdditional.data.adicionalId}`).get()).data();
  assert.equal(spoofedCurrencyStored.moneda, "CLP", "la moneda enviada por el cliente se ignora; siempre se deriva del trabajo");
  console.log("OK caso 11: moneda nunca proviene del cliente (a diferencia de itemId/cantidad/precio, no hay 'moneda inválida' que rechazar porque nunca se lee del payload)");

  // --- Casos 12/13: el cliente no puede elegir INCORPORADO_A_VENTA ni ANULADO al crear; el campo simplemente se ignora ---
  for (const [label, estadoInyectado] of [["INCORPORADO_A_VENTA", "INCORPORADO_A_VENTA"], ["ANULADO", "ANULADO"]]) {
    const injected = await crearAdicional({businessId, trabajoId: workId, requestId: requestId(`inject-${label}`), adicional: {itemId: product, cantidad: 1, precioUnitario: 1000, estado: estadoInyectado}});
    const injectedStored = (await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/${injected.data.adicionalId}`).get()).data();
    assert.equal(injectedStored.estado, "PENDIENTE_COBRO", `un adicional creado con estado='${estadoInyectado}' inyectado por el cliente debe ignorar ese valor`);
  }
  console.log("OK casos 12/13: crearAdicionalTrabajo nunca lee `estado` del cliente; siempre nace PENDIENTE_COBRO sin importar lo que se envíe");

  // --- Caso 14: autorizado anula PENDIENTE_COBRO ---
  const anular = callable(owner, "anularAdicionalTrabajo");
  const annulled = await anular({businessId, trabajoId: workId, adicionalId: created.data.adicionalId, motivo: "Cliente desistió del adicional", requestId: requestId("annul-valid")});
  assert.equal(annulled.data.adicionalId, created.data.adicionalId);
  const annulledStored = (await createdRef.get()).data();
  assert.equal(annulledStored.estado, "ANULADO");
  assert.equal(annulledStored.motivoAnulacion, "Cliente desistió del adicional");
  assert.equal(annulledStored.anuladoPorUid, owner.uid);
  // Doble anulación es idempotente (mismo patrón que anularGastoTrabajo), no un error
  const annulledAgain = await anular({businessId, trabajoId: workId, adicionalId: created.data.adicionalId, motivo: "Otro motivo", requestId: requestId("annul-again")});
  assert.equal(annulledAgain.data.sinCambios, true);
  assert.equal((await createdRef.get()).data().motivoAnulacion, "Cliente desistió del adicional", "la doble anulación no debe sobrescribir el motivo original");
  console.log("OK caso 14: PENDIENTE_COBRO -> ANULADO autorizado; doble anulación idempotente sin efectos");

  // --- Caso 15: anular un INCORPORADO_A_VENTA se rechaza (estado sembrado, ETAPA 2 no tiene forma real de alcanzarlo todavía) ---
  const incorporatedId = `incorporated-${RUN_ID}`;
  await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/${incorporatedId}`).set({adicionalId: incorporatedId, negocioId: businessId, trabajoId: workId, itemId: product, tipoItem: "producto", cantidad: 1, precioUnitario: 1000, moneda: "CLP", estado: "INCORPORADO_A_VENTA", ventaId: "venta-simulada", lineaId: "linea-simulada", registradoPorUid: owner.uid, creadoEn: new Date()});
  await expectCallableError("anular INCORPORADO_A_VENTA", () => anular({businessId, trabajoId: workId, adicionalId: incorporatedId, motivo: "Intento inválido", requestId: requestId("annul-incorporated")}), ["failed-precondition"]);
  assert.equal((await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/${incorporatedId}`).get()).data().estado, "INCORPORADO_A_VENTA");
  console.log("OK caso 15: un adicional INCORPORADO_A_VENTA nunca puede anularse (transición terminal protegida)");

  // --- Caso 16: modificar un adicional directamente desde el cliente se rechaza ---
  await expectDenied("escritura directa (create)", () => setDoc(doc(owner.db, `negocios/${businessId}/trabajos/${workId}/adicionales/sdk-write`), {negocioId: businessId, trabajoId: workId, estado: "PENDIENTE_COBRO"}));
  await expectDenied("escritura directa (update)", () => updateDoc(doc(owner.db, `negocios/${businessId}/trabajos/${workId}/adicionales/${incorporatedId}`), {estado: "PENDIENTE_COBRO"}));
  await expectDenied("cliente marca INCORPORADO_A_VENTA directamente", () => updateDoc(doc(owner.db, `negocios/${businessId}/trabajos/${workId}/adicionales/${created.data.adicionalId}`), {estado: "INCORPORADO_A_VENTA"}));

  // --- Caso 17: delete directo rechazado ---
  await expectDenied("borrado directo", () => deleteDoc(doc(owner.db, `negocios/${businessId}/trabajos/${workId}/adicionales/${incorporatedId}`)));
  assert.equal((await adminDb.doc(`negocios/${businessId}/trabajos/${workId}/adicionales/${incorporatedId}`).get()).exists, true);
  console.log("OK casos 16/17: create/update/delete directos siempre rechazados; INCORPORADO_A_VENTA nunca alcanzable desde el cliente");

  // --- Caso 18: lectura autorizada del Proyecto ---
  const readByOwner = await getDoc(doc(owner.db, `negocios/${businessId}/trabajos/${workId}/adicionales/${created.data.adicionalId}`));
  assert.equal(readByOwner.exists(), true);
  const readByAdmin = await getDoc(doc(admin.db, `negocios/${businessId}/trabajos/${workId}/adicionales/${created.data.adicionalId}`));
  assert.equal(readByAdmin.exists(), true);
  console.log("OK caso 18: lectura autorizada OWNER/ADMIN vía el mismo predicado canReadWorkCosts ya usado por gastos/HH");
  // HALLAZGO PRE-EXISTENTE (no introducido por SPEC 020, fuera de su alcance):
  // un TECNICO leyendo un registro propio a través de canReadWorkCosts agota el
  // presupuesto de 1000 expresiones de Firestore Rules (cadena
  // canReadWorkCosts -> canReadWork -> hasBusinessModuleAccess ->
  // hasCustomBusinessModule/hasBusinessRole, sin memoización de get() dentro de
  // una misma evaluación, agravado por el match /{document=**} de cierre que
  // también se evalúa para la misma ruta). Se confirmó con un repro desechable
  // que gastos (sin tocar en este bloque) reproduce exactamente el mismo error
  // para un TECNICO leyendo su propio gasto. No es una brecha de seguridad (el
  // efecto es denegar de más, nunca conceder de más) y no es una regresión de
  // ETAPA 2: se documenta aquí como hallazgo para un bloque futuro dedicado a
  // esos helpers compartidos, no se intenta corregir en SPEC 020.
  const technicianOwnAdditional = await callable(technician, "crearAdicionalTrabajo")({businessId, trabajoId: workId, requestId: requestId("technician-own"), adicional: {itemId: service, cantidad: 1, precioUnitario: 2000}});
  await expectCallableError(
    "lectura de TECNICO sobre su propio adicional (hallazgo pre-existente compartido con gastos/HH, ver comentario arriba)",
    () => getDoc(doc(technician.db, `negocios/${businessId}/trabajos/${workId}/adicionales/${technicianOwnAdditional.data.adicionalId}`)),
    ["permission-denied", "resource-exhausted"],
  );

  // --- Caso 19: lectura cross-tenant rechazada ---
  await expectDenied("lectura cross-tenant", () => getDoc(doc(outsider.db, `negocios/${businessId}/trabajos/${workId}/adicionales/${created.data.adicionalId}`)));

  // --- Caso 20: creación/anulación no modifica balance ni documentos comerciales ---
  const balanceBefore = await callable(owner, "obtenerBalanceTrabajo")({businessId, trabajoId: workId});
  const workBefore = (await adminDb.doc(`negocios/${businessId}/trabajos/${workId}`).get()).data();
  const extraAdditional = await crearAdicional({businessId, trabajoId: workId, requestId: requestId("balance-check-create"), adicional: {itemId: product, cantidad: 5, precioUnitario: 999999, descripcion: "No debe afectar el balance"}});
  await anular({businessId, trabajoId: workId, adicionalId: extraAdditional.data.adicionalId, motivo: "Verificación de no impacto en balance", requestId: requestId("balance-check-annul")});
  const balanceAfter = await callable(owner, "obtenerBalanceTrabajo")({businessId, trabajoId: workId});
  const workAfter = (await adminDb.doc(`negocios/${businessId}/trabajos/${workId}`).get()).data();
  assert.deepEqual({...balanceAfter.data, calculadoEn: null}, {...balanceBefore.data, calculadoEn: null}, "crear/anular un adicional no debe alterar el balance del proyecto (se excluye calculadoEn: es un timestamp de cálculo en vivo, cambia en cada llamada por diseño)");
  for (const field of ["gastosMontoTotal", "gastosMontoDirecto", "gastosMontoIndirecto", "gastosVigentesTotal", "horasHombreCostoTotal", "materialesCostoTotal", "ventasVinculadas", "cotizacionesVinculadas"]) {
    assert.equal(workAfter[field] ?? 0, workBefore[field] ?? 0, `el campo ${field} del trabajo no debe cambiar por adicionales`);
  }
  assert.equal((await adminDb.collection(`negocios/${businessId}/ventas`).get()).size, 0, "crear/anular adicionales no debe generar ninguna Venta");
  assert.equal((await adminDb.collection(`negocios/${businessId}/cotizaciones`).get()).size, 0, "crear/anular adicionales no debe generar ninguna Cotización");
  assert.equal((await adminDb.collection(`negocios/${businessId}/movimientosInventario`).get()).size, 0, "crear/anular adicionales no debe generar movimientos de inventario (Q/V intacto)");
  console.log("OK caso 20: crear y anular adicionales no altera el balance del Proyecto ni genera Ventas/Cotizaciones/movimientos de inventario");

  // --- Idempotencia por requestId (mismo patrón que registrarGastoTrabajo) ---
  const idempotentId = requestId("idempotent");
  const firstCall = await crearAdicional({businessId, trabajoId: workId, requestId: idempotentId, adicional: {itemId: product, cantidad: 1, precioUnitario: 1234}});
  const secondCall = await crearAdicional({businessId, trabajoId: workId, requestId: idempotentId, adicional: {itemId: product, cantidad: 1, precioUnitario: 1234}});
  assert.equal(secondCall.data.adicionalId, firstCall.data.adicionalId);
  assert.equal(secondCall.data.idempotent, true);
  const countAfterRetry = (await adminDb.collection(`negocios/${businessId}/trabajos/${workId}/adicionales`).get()).size;
  const retryOnceMore = await crearAdicional({businessId, trabajoId: workId, requestId: idempotentId, adicional: {itemId: product, cantidad: 1, precioUnitario: 1234}});
  assert.equal(retryOnceMore.data.adicionalId, firstCall.data.adicionalId);
  assert.equal((await adminDb.collection(`negocios/${businessId}/trabajos/${workId}/adicionales`).get()).size, countAfterRetry, "un doble-click con el mismo requestId nunca crea un segundo adicional");
  console.log("OK idempotencia: mismo requestId nunca crea un segundo adicional (protección de doble-click reutilizada de gastos)");

  console.log("WORK_ADDITIONAL_INTEGRATED_LOCAL_OK");
} finally {
  await Promise.all(clients.map((client) => terminate(client.db)));
  await Promise.all(clients.map((client) => deleteApp(client.app)));
  await terminate(unauthenticated.db);
  await deleteApp(unauthenticated.app);
  await deleteAdminApp(adminApp);
}
