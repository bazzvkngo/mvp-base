import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {MAX_RECEPTION_MILEAGE_KM} from "../src/domain/workOrderReceptionModel.mjs";
import {testWorkOrderApproval, testWorkOrderApprovalRace} from "./work-order-approval-cases.mjs";
import {testServiceExecution} from "./work-order-service-execution-cases.mjs";
import {testWorkOrderClosure} from "./work-order-closure-cases.mjs";
import {testWorkOrderCancellation} from "./work-order-cancellation-cases.mjs";
import {testWorkOrderEndToEnd} from "./work-order-end-to-end-cases.mjs";
import {testWorkshopPlazas} from "./work-order-plaza-cases.mjs";
import {testWorkshopPlazaAutoAssignment} from "./work-order-plaza-auto-cases.mjs";
import {testWorkOrderStock} from "./work-order-stock-cases.mjs";
import {receptionPhotosFixture} from "./work-order-photo-fixtures.mjs";
import {RECEPTION_VEHICLE_ZONES} from "../src/domain/workOrderReceptionPhotoModel.mjs";
import {testWorkshopSecurity} from "./workshop-security-cases.mjs";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  terminate,
  where,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const AUTH_PORT = Number(process.env.WORK_ORDER_TEST_AUTH_PORT || 9099);
const FIRESTORE_PORT = Number(process.env.WORK_ORDER_TEST_FIRESTORE_PORT || 8080);
const FUNCTIONS_PORT = Number(process.env.WORK_ORDER_TEST_FUNCTIONS_PORT || 5001);
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

function createClientApp(name) {
  const app = initializeApp({
    apiKey: "demo-key",
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID,
    appId: `work-orders-${name}-${RUN_ID}`,
  }, `work-orders-${name}-${RUN_ID}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, "us-central1");
  connectAuthEmulator(auth, `http://127.0.0.1:${AUTH_PORT}`, {disableWarnings: true});
  connectFirestoreEmulator(db, "127.0.0.1", FIRESTORE_PORT);
  connectFunctionsEmulator(functions, "127.0.0.1", FUNCTIONS_PORT);
  return {app, auth, db, functions};
}

async function authenticate(client, label) {
  const credential = await createUserWithEmailAndPassword(
    client.auth,
    `work-orders-${label}-${RUN_ID}@example.test`,
    `WorkOrders-${RUN_ID}-Pass!`
  );
  client.uid = credential.user.uid;
  return client;
}

function callable(client, name) {
  return httpsCallable(client.functions, name);
}

async function expectCallableError(label, operation, codes, messagePattern) {
  try {
    await operation();
  } catch (error) {
    const code = String(error?.code || "");
    assert.ok(
      codes.some((expected) => code.includes(expected)),
      `${label}: código inesperado ${code}`
    );
    if (messagePattern) assert.match(String(error?.message || ""), messagePattern);
    console.log(`OK rechazo: ${label}`);
    return;
  }
  throw new Error(`Se esperaba rechazo: ${label}`);
}

async function expectFirestoreDenied(label, operation) {
  try {
    await operation();
  } catch (error) {
    assert.match(String(error?.code || ""), /permission-denied/);
    console.log(`OK Rules: ${label}`);
    return;
  }
  throw new Error(`Se esperaba denegación de Firestore: ${label}`);
}

function storedClient(businessId, clienteId, name) {
  return {
    clienteId,
    negocioId: businessId,
    tipoCliente: "persona",
    paisCodigo: "CL",
    identificadorFiscalTipo: "RUT",
    identificadorFiscalValor: clienteId === "cliente-b" ? "11111111-1" : "76086428-5",
    nombreRazonSocial: name,
    estado: "activo",
  };
}

function storedVehicle(businessId, vehiculoId, clienteId, patente) {
  return {
    vehiculoId,
    negocioId: businessId,
    clienteId,
    patente,
    vin: null,
    marca: "Toyota",
    modelo: "Corolla",
    anio: 2020,
    color: "Blanco",
    tipo: "sedan",
  };
}

const RECEPTION_REASON = "Ruido al frenar y vibración en el volante.";

function workOrderReception(overrides = {}) {
  return {
    motivoCliente: RECEPTION_REASON,
    kilometraje: 45210,
    nivelCombustible: "1/2",
    testigosEncendidos: false,
    testigos: [],
    ingresaNombre: "Marta Rojas",
    ingresaDocumento: "12.345.678-5",
    ...overrides,
  };
}

const owner = await authenticate(createClientApp("owner"), "owner");
const admin = await authenticate(createClientApp("admin"), "admin");
const technician = await authenticate(createClientApp("technician"), "technician");
const member = await authenticate(createClientApp("member"), "member");
const outsider = await authenticate(createClientApp("outsider"), "outsider");
const anonymous = createClientApp("anonymous");
const clients = [owner, admin, technician, member, outsider, anonymous];
const adminApp = initializeAdminApp(
  {projectId: PROJECT_ID},
  `work-orders-admin-${RUN_ID}`
);
const adminDb = getAdminFirestore(adminApp);

try {
  const ownerBusiness = await callable(owner, "createFirstBusiness")({
    nombreComercial: "Taller OT principal",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    regionCodigo: "13",
    requestId: `business-owner-${RUN_ID}`,
  });
  const businessId = ownerBusiness.data.business.id;
  const outsiderBusiness = await callable(outsider, "createFirstBusiness")({
    nombreComercial: "Taller OT externo",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    regionCodigo: "13",
    requestId: `business-outsider-${RUN_ID}`,
  });
  const outsiderBusinessId = outsiderBusiness.data.business.id;

  await expectCallableError(
    "Function Taller con módulo deshabilitado",
    () => callable(owner, "listarCatalogoTaller")({businessId}),
    ["failed-precondition"],
    /Este módulo no está habilitado para tu empresa\./
  );

  await Promise.all([
    adminDb.doc(`negocios/${businessId}`).update({
      monedaCodigo: "CLP",
      modulosHabilitados: ["taller"],
      verificacionEmpresa: {estado: "VERIFICADA"},
    }),
    adminDb.doc(`negocios/${outsiderBusinessId}`).update({
      modulosHabilitados: ["taller"],
      verificacionEmpresa: {estado: "VERIFICADA"},
    }),
    adminDb.doc(`membresias/${businessId}__${admin.uid}`).set({
      negocioId: businessId,
      uid: admin.uid,
      rol: "ADMIN",
      estado: "activo",
    }),
    adminDb.doc(`membresias/${businessId}__${technician.uid}`).set({
      negocioId: businessId,
      uid: technician.uid,
      rol: "TECNICO",
      estado: "activo",
    }),
    adminDb.doc(`membresias/${businessId}__${member.uid}`).set({
      negocioId: businessId,
      uid: member.uid,
      rol: "MEMBER",
      estado: "activo",
    }),
    adminDb.doc(`negocios/${businessId}/clientes/cliente-a`).set(
      storedClient(businessId, "cliente-a", "Cliente A")
    ),
    adminDb.doc(`negocios/${businessId}/clientes/cliente-b`).set(
      storedClient(businessId, "cliente-b", "Cliente B")
    ),
    adminDb.doc(`negocios/${businessId}/clientes/cliente-inconsistente`).set(
      storedClient(outsiderBusinessId, "cliente-inconsistente", "Externo")
    ),
    adminDb.doc(`negocios/${businessId}/vehiculos/vehiculo-a`).set(
      storedVehicle(businessId, "vehiculo-a", "cliente-a", "ABCD12")
    ),
    adminDb.doc(`negocios/${businessId}/vehiculos/vehiculo-b`).set(
      storedVehicle(businessId, "vehiculo-b", "cliente-b", "EFGH34")
    ),
    adminDb.doc(`negocios/${businessId}/inventario/servicio-core`).set({
      negocioId: businessId, tipoItem: "servicio", estado: "activo", nombre: "Cambio de aceite",
      codigoInterno: "SER-001", unidad: "servicio", costoBase: 10000, precioInterno: 25000,
    }),
    adminDb.doc(`negocios/${businessId}/inventario/producto-core`).set({
      negocioId: businessId, tipoItem: "producto", estado: "activo", nombre: "Filtro",
      codigoInterno: "PRO-001", unidad: "unidad", costoBase: 3000, precioInterno: 8000, stock: 12,
    }),
    adminDb.doc(`negocios/${businessId}/inventario/servicio-externo`).set({
      negocioId: outsiderBusinessId, tipoItem: "servicio", estado: "activo", nombre: "Ajeno",
    }),
    adminDb.doc(`negocios/${businessId}/vehiculos/vehiculo-inconsistente`).set(
      storedVehicle(
        outsiderBusinessId,
        "vehiculo-inconsistente",
        "cliente-a",
        "IJKL56"
      )
    ),
    adminDb.doc(`negocios/${outsiderBusinessId}/clientes/cliente-externo`).set(
      storedClient(outsiderBusinessId, "cliente-externo", "Cliente externo")
    ),
    adminDb.doc(`negocios/${outsiderBusinessId}/vehiculos/vehiculo-externo`).set(
      storedVehicle(
        outsiderBusinessId,
        "vehiculo-externo",
        "cliente-externo",
        "MNOP78"
      )
    ),
  ]);

  const requestId = `work-order-create-${RUN_ID}`;
  const first = await callable(owner, "crearOrdenTrabajo")({
    businessId,
    requestId,
    ordenTrabajo: {vehiculoId: "vehiculo-a"},
  });
  assert.equal(first.data.sinCambios, false);
  assert.equal(first.data.ordenTrabajo.numeroOT, "OT-000001");
  assert.equal(first.data.ordenTrabajo.clienteId, "cliente-a");
  const otId = first.data.ordenTrabajo.otId;
  const orderPath = `negocios/${businessId}/ordenesTrabajo/${otId}`;
  const stored = (await adminDb.doc(orderPath).get()).data();
  assert.deepEqual(Object.keys(stored).sort(), [
    "actualizadoEn",
    "actualizadoPorUid",
    "clienteId",
    "creadoEn",
    "creadoPorUid",
    "estado",
    "estadoAprobacion",
    "moneda",
    "negocioId",
    "numeroOT",
    "otId",
    "plazaId",
    "recepcion",
    "vehiculoId",
  ]);
  assert.equal(stored.negocioId, businessId);
  assert.equal(stored.numeroOT, "OT-000001");
  assert.equal(stored.vehiculoId, "vehiculo-a");
  assert.equal(stored.clienteId, "cliente-a");
  assert.equal(stored.estado, "ingresada");
  const initialHistory = (await callable(owner, "obtenerHistorialOT")({businessId, otId})).data.eventos;
  assert.equal(initialHistory.length, 1);
  assert.equal(initialHistory[0].tipo, "ot_creada");
  assert.ok(initialHistory[0].fecha);
  assert.ok(initialHistory[0].actorNombre);
  assert.deepEqual(initialHistory[0].detalle, {estado: "ingresada", estadoAprobacion: "pendiente"});
  assert.ok(!Object.keys(initialHistory[0].detalle).some((key) => /precio|costo|alcance/i.test(key)));
  const adminHistory = (await callable(admin, "obtenerHistorialOT")({businessId, otId})).data.eventos;
  assert.equal(adminHistory.length, 1);
  await expectCallableError(
    "TECNICO no consulta el historial de gestión",
    () => callable(technician, "obtenerHistorialOT")({businessId, otId}),
    ["permission-denied"]
  );
  await expectCallableError(
    "MEMBER no consulta el historial de gestión",
    () => callable(member, "obtenerHistorialOT")({businessId, otId}),
    ["permission-denied"]
  );
  await expectCallableError(
    "TECNICO no consulta los eventos de cierre de gestión",
    () => callable(technician, "obtenerEventosCierreOT")({businessId, otId}),
    ["permission-denied"]
  );
  await expectCallableError(
    "MEMBER no consulta los eventos de cierre de gestión",
    () => callable(member, "obtenerEventosCierreOT")({businessId, otId}),
    ["permission-denied"]
  );
  console.log("OK historial OT: solo OWNER y ADMIN reciben eventos de gestión");
  assert.equal(stored.estadoAprobacion, "pendiente");
  assert.equal(stored.plazaId, null);
  assert.equal(stored.moneda, "CLP");
  assert.equal(stored.recepcion, null);
  assert.equal(stored.creadoPorUid, owner.uid);
  assert.equal(stored.actualizadoPorUid, owner.uid);
  assert.ok(stored.creadoEn?.toDate());
  assert.ok(stored.actualizadoEn?.toDate());
  console.log("OK creación OT: contrato inicial, autoría y timestamps autoritativos");

  await expectCallableError(
    "diagnóstico exige recepción previa",
    () => callable(owner, "registrarDiagnostico")({
      businessId, otId, requestId: `diagnosis-early-${RUN_ID}`,
      diagnostico: {responsableUid: technician.uid, descripcion: "", observaciones: ""},
    }),
    ["failed-precondition"], /recepción/i
  );

  const invalidReceptions = [
    ["recepción sin relato del cliente", {motivoCliente: "  "}, /motivo del cliente.*obligatorio/i],
    ["combustible fuera de la lista", {nivelCombustible: "Medio"}, /nivel de combustible válido/i],
    ["testigos encendidos sin indicar cuáles", {testigosEncendidos: true, testigos: []}, /Elige cuáles sensores/i],
    ["testigos con la opción «sin sensores»", {testigosEncendidos: false, testigos: ["abs"]}, /lista debe estar vacía/i],
    ["testigo desconocido", {testigosEncendidos: true, testigos: ["turbo"]}, /sensores encendidos no son válidos/i],
    ["testigos sin responder", {testigosEncendidos: undefined, testigos: []}, /Indica si hay sensores encendidos/i],
  ];
  for (const [label, overrides, message] of invalidReceptions) {
    await expectCallableError(label, () => callable(owner, "registrarRecepcionOrdenTrabajo")({
      businessId, otId, recepcion: workOrderReception(overrides),
    }), ["invalid-argument"], message);
  }
  await expectCallableError("campo de la checklist anterior", () => callable(owner, "registrarRecepcionOrdenTrabajo")({
    businessId, otId, recepcion: workOrderReception({checklist: {}}),
  }), ["invalid-argument"], /campo de recepción checklist no está admitido/i);
  await expectCallableError(
    "kilometraje de recepción sobre el máximo",
    () => callable(owner, "registrarRecepcionOrdenTrabajo")({
      businessId,
      otId,
      recepcion: workOrderReception({
        kilometraje: MAX_RECEPTION_MILEAGE_KM + 1,
      }),
    }),
    ["invalid-argument"],
    /kilometraje.*no puede superar/i
  );
  // Las seis fotos del vehículo y la del tablero se exigen para registrar la recepción.
  await expectCallableError("recepción sin fotos", () => callable(owner, "registrarRecepcionOrdenTrabajo")({
    businessId, otId, recepcion: workOrderReception(),
  }), ["failed-precondition"], /Faltan fotos de recepción: Delantera, Lateral izq\. delantero, Lateral izq\. trasero, Lateral der\. delantero, Lateral der\. trasero, Trasera, Tablero\. Complétalas antes de registrar la recepción\./);
  await adminDb.doc(orderPath).update({fotosRecepcion: receptionPhotosFixture(RECEPTION_VEHICLE_ZONES.map((zone) => zone.id))});
  await expectCallableError("recepción sin foto del tablero", () => callable(owner, "registrarRecepcionOrdenTrabajo")({
    businessId, otId, recepcion: workOrderReception(),
  }), ["failed-precondition"], /Faltan fotos de recepción: Tablero\./);
  assert.equal((await adminDb.doc(orderPath).get()).data().recepcion, null);
  await adminDb.doc(orderPath).update({fotosRecepcion: receptionPhotosFixture()});
  console.log("OK fotos obligatorias: registrar la recepción exige las seis zonas y el tablero");
  const registeredReception = await callable(owner, "registrarRecepcionOrdenTrabajo")({
    businessId,
    otId,
    recepcion: workOrderReception(),
  });
  assert.equal(registeredReception.data.ordenTrabajo.estado, "en_cola");
  const orderAfterReception = (await adminDb.doc(orderPath).get()).data();
  assert.equal(orderAfterReception.estado, "en_cola");
  assert.equal(orderAfterReception.recepcion.motivoCliente, RECEPTION_REASON);
  assert.equal(orderAfterReception.recepcion.testigosEncendidos, false);
  assert.deepEqual(orderAfterReception.recepcion.testigos, []);
  assert.equal(orderAfterReception.recepcion.recibidoPorUid, owner.uid);
  assert.ok(orderAfterReception.recepcion.recibidoEn?.toDate());
  assert.equal(orderAfterReception.actualizadoPorUid, owner.uid);
  const receptionEventsRef = adminDb.collection(`${orderPath}/historial`);
  const registrationEvents = (await receptionEventsRef.where("tipo", "==", "recepcion_registrada").get()).docs;
  assert.equal(registrationEvents.length, 1);
  assert.equal(registrationEvents[0].data().actorUid, owner.uid);
  assert.ok(registrationEvents[0].data().actorSnapshot?.nombre);
  assert.ok(registrationEvents[0].data().fecha?.toDate());
  assert.deepEqual(registrationEvents[0].data().detalle.cambios.kilometraje, {anterior: null, nuevo: 45210});
  // Quién entrega el vehículo: nombre en la OT; el RUT solo en el documento del servidor y nunca en el historial.
  assert.equal(orderAfterReception.recepcion.ingresaNombre, "Marta Rojas");
  assert.equal(orderAfterReception.recepcion.ingresaTieneDocumento, true);
  assert.equal(orderAfterReception.recepcion.ingresaDocumento, undefined);
  assert.equal((await adminDb.doc(`${orderPath}/recepcionActa/persona`).get()).data().documento, "12.345.678-5");
  assert.doesNotMatch(JSON.stringify(registrationEvents[0].data()), /12\.345\.678-5/);
  assert.equal(registrationEvents[0].data().detalle.cambios.ingresaDocumento?.modificado, true);
  // La recepción deja la patente en el índice de la consulta pública /seguimiento (id por hash, sin la patente en claro).
  const plateIndexDoc = await adminDb.doc(`tallerSeguimientoPatentes/${createHash("sha256").update("patente|ABCD12").digest("hex")}`).get();
  assert.ok(plateIndexDoc.data()?.negocios?.includes(businessId), "la recepción indexa la patente para la consulta pública");
  console.log("OK recepción OT: relato, tablero, autoría backend y transición sin Plaza");

  const updatedReception = await callable(technician, "registrarRecepcionOrdenTrabajo")({
    businessId,
    otId,
    recepcion: workOrderReception({nivelCombustible: "3/4", testigosEncendidos: true, testigos: ["abs", "frenos"]}),
  });
  assert.equal(updatedReception.data.ordenTrabajo.estado, "en_cola");
  const orderAfterReceptionUpdate = (await adminDb.doc(orderPath).get()).data();
  assert.equal(orderAfterReceptionUpdate.recepcion.recibidoPorUid, owner.uid);
  assert.equal(orderAfterReceptionUpdate.recepcion.nivelCombustible, "3/4");
  assert.deepEqual(orderAfterReceptionUpdate.recepcion.testigos, ["abs", "frenos"]);
  assert.equal(orderAfterReceptionUpdate.actualizadoPorUid, technician.uid);
  const updatedEvents = (await receptionEventsRef.where("tipo", "==", "recepcion_actualizada").get()).docs;
  assert.equal(updatedEvents.length, 1);
  assert.equal(updatedEvents[0].data().actorUid, technician.uid);
  assert.deepEqual(updatedEvents[0].data().detalle.cambios.nivelCombustible, {anterior: "1/2", nuevo: "3/4"});
  assert.deepEqual(updatedEvents[0].data().detalle.cambios.testigos, {anterior: [], nuevo: ["abs", "frenos"]});
  assert.equal(updatedEvents[0].data().detalle.cambios.motivoCliente, undefined);
  const noChangeRevision = orderAfterReceptionUpdate.actualizadoEn.toMillis();
  const repeatedReception = await callable(technician, "registrarRecepcionOrdenTrabajo")({
    businessId, otId,
    recepcion: workOrderReception({nivelCombustible: "3/4", testigosEncendidos: true, testigos: ["abs", "frenos"]}),
  });
  assert.equal(repeatedReception.data.ordenTrabajo.sinCambios, true);
  assert.equal((await adminDb.doc(orderPath).get()).data().actualizadoEn.toMillis(), noChangeRevision);
  assert.equal((await receptionEventsRef.where("tipo", "==", "recepcion_actualizada").get()).size, 1);
  const receptionRace = await Promise.allSettled([
    callable(owner, "registrarRecepcionOrdenTrabajo")({businessId, otId,
      recepcion: workOrderReception({nivelCombustible: "3/4", testigosEncendidos: true, testigos: ["abs", "frenos"],
        motivoCliente: "Revisión A."})}),
    callable(technician, "registrarRecepcionOrdenTrabajo")({businessId, otId,
      recepcion: workOrderReception({nivelCombustible: "3/4", testigosEncendidos: true, testigos: ["abs", "frenos"],
        motivoCliente: "Revisión B."})}),
  ]);
  assert.ok(receptionRace.every((entry) => entry.status === "fulfilled"),
    receptionRace.map((entry) => entry.reason?.message || entry.status).join(" | "));
  const raceEvents = (await receptionEventsRef.where("tipo", "==", "recepcion_actualizada").get()).docs;
  assert.equal(raceEvents.length, 3);
  const raceChanges = raceEvents.map((entry) => entry.data().detalle.cambios.motivoCliente).filter(Boolean);
  assert.equal(raceChanges.length, 2);
  assert.ok(raceChanges.some((change) => change.anterior === RECEPTION_REASON));
  assert.ok(raceChanges.some((change) => ["Revisión A.", "Revisión B."].includes(change.anterior)));
  assert.equal((await adminDb.doc(orderPath).get()).data().recepcion.recibidoEn.toMillis(),
    orderAfterReception.recepcion.recibidoEn.toMillis());
  console.log("OK actualización recepción: rol operativo autorizado y autoría inicial preservada");

  // Los trabajos se registran en la ejecución: primero el Owner aprueba el ingreso (compuerta).
  // La aprobación revalida las fotos (OT registradas antes de exigirlas); el resumen informa faltantes y daños.
  const approveMain = async (requestId) => callable(owner, "aprobarOT")({businessId, otId, requestId,
    responsableUid: technician.uid, expectedActualizadoEn: (await adminDb.doc(orderPath).get()).data().actualizadoEn.toMillis()});
  await adminDb.doc(orderPath).update({fotosRecepcion: receptionPhotosFixture(RECEPTION_VEHICLE_ZONES.map((zone) => zone.id))});
  await expectCallableError("aprobar con la foto del tablero pendiente", () => approveMain(`gate-one-photo-${RUN_ID}`),
    ["failed-precondition"], /Faltan fotos de recepción: Tablero\. Complétalas antes de aprobar el ingreso\./);
  assert.equal((await adminDb.doc(orderPath).get()).data().estadoAprobacion, "pendiente");
  assert.deepEqual((await callable(owner, "obtenerResumenAprobacionOT")({businessId, otId})).data.fotosFaltantes, ["Tablero"]);
  await adminDb.doc(orderPath).update({fotosRecepcion: {...receptionPhotosFixture(),
    "lateral-izquierdo-delantero": {...receptionPhotosFixture()["lateral-izquierdo-delantero"],
      conDanos: true, marcas: [{x: 0.4, y: 0.5, nota: "rayón de 15 cm en puerta delantera"}]}}});
  assert.deepEqual((await callable(owner, "obtenerResumenAprobacionOT")({businessId, otId})).data.danosPrevios,
    [{zona: "Lateral izq. delantero", notas: ["rayón de 15 cm en puerta delantera"]}]);
  // Rechazar no exige fotos; aprobar sí. Una OT rechazada puede aprobarse si cambia la decisión.
  await callable(owner, "rechazarOT")({businessId, otId, requestId: `gate-reject-no-photos-${RUN_ID}`,
    motivo: "Faltan fotos de recepción.",
    expectedActualizadoEn: (await adminDb.doc(orderPath).get()).data().actualizadoEn.toMillis()});
  assert.equal((await adminDb.doc(orderPath).get()).data().estadoAprobacion, "rechazada");
  console.log("OK fotos obligatorias: la aprobación revalida las fotos e informa los daños previos");
  // Un negocio sin Plazas activas no puede aprobar ingresos.
  await expectCallableError("aprobar sin Plazas activas", async () => callable(owner, "aprobarOT")({
    businessId, otId, requestId: `gate-no-plaza-${RUN_ID}`, responsableUid: technician.uid,
    expectedActualizadoEn: (await adminDb.doc(orderPath).get()).data().actualizadoEn.toMillis(),
  }), ["failed-precondition"], /al menos una Plaza activa/i);
  const mainPlazaId = (await callable(owner, "crearPlazaTaller")({
    businessId, requestId: `plaza-main-${RUN_ID}`, plaza: {nombre: "Taller - Plaza principal"},
  })).data.plaza.plazaId;
  await callable(owner, "aprobarOT")({businessId, otId, requestId: `gate-approve-${RUN_ID}`,
    responsableUid: technician.uid, expectedActualizadoEn: (await adminDb.doc(orderPath).get()).data().actualizadoEn.toMillis()});
  assert.equal((await adminDb.doc(orderPath).get()).data().estado, "en_reparacion");
  assert.equal((await adminDb.doc(orderPath).get()).data().plazaId, mainPlazaId, "aprobar asigna la Plaza libre");
  assert.equal((await adminDb.doc(orderPath).get()).data().responsableUid, technician.uid, "aprobar guarda el responsable de la OT");
  const serviceRequestId = `service-create-${RUN_ID}`;
  await expectCallableError("ServicioOT rechaza Producto Core", () => callable(owner, "crearServicioOT")({
    businessId, otId, requestId: `service-wrong-${RUN_ID}`,
    servicio: {itemId: "producto-core"},
  }), ["failed-precondition"], /servicio activo/i);
  await expectCallableError("ServicioOT rechaza ítem de otro negocio", () => callable(owner, "crearServicioOT")({
    businessId, otId, requestId: `service-cross-${RUN_ID}`,
    servicio: {itemId: "servicio-externo"},
  }), ["failed-precondition"], /mismo negocio/i);
  // El responsable es de la OT (se elige al aprobar); el trabajo ya no tiene uno propio.
  await expectCallableError("ServicioOT no admite responsable propio", () => callable(owner, "crearServicioOT")({
    businessId, otId, requestId: `service-responsible-${RUN_ID}`,
    servicio: {itemId: "servicio-core", responsableUid: outsider.uid},
  }), ["invalid-argument"], /no está admitido/i);
  await expectCallableError("solo el responsable, Admin u Owner crean trabajos", () => callable(member, "crearServicioOT")({
    businessId, otId, requestId: `service-not-responsible-${RUN_ID}`,
    servicio: {itemId: "servicio-core"},
  }), ["permission-denied"], /Solo el responsable de la OT/i);
  await expectCallableError("ServicioOT rechaza precio manual", () => callable(owner, "crearServicioOT")({
    businessId, otId, requestId: `service-price-${RUN_ID}`,
    servicio: {itemId: "servicio-core", precioUnitario: 1},
  }), ["invalid-argument"], /no está admitido/i);
  const createdService = await callable(technician, "crearServicioOT")({
    businessId, otId, requestId: serviceRequestId,
    servicio: {itemId: "servicio-core"},
  });
  const serviceId = createdService.data.servicioOtId;
  const servicePath = `${orderPath}/servicios/${serviceId}`;
  let service = (await adminDb.doc(servicePath).get()).data();
  assert.equal(service.estado, "pendiente");
  assert.equal(service.precioUnitario, null);
  assert.equal(service.servicioSnapshot, null);
  assert.deepEqual(service.productos, []);
  assert.equal(service.creadoPorUid, technician.uid);
  assert.equal((await callable(technician, "crearServicioOT")({
    businessId, otId, requestId: serviceRequestId,
    servicio: {itemId: "servicio-core"},
  })).data.sinCambios, true);
  assert.equal((await adminDb.collection(`${orderPath}/servicios`).get()).size, 1);
  await expectCallableError("ProductoOT rechaza Servicio Core", () => callable(owner, "agregarProductoOT")({
    businessId, otId, servicioOtId: serviceId, requestId: `product-wrong-${RUN_ID}`,
    itemId: "servicio-core", cantidad: 1,
  }), ["failed-precondition"], /producto activo/i);
  await expectCallableError("ProductoOT rechaza precio manual", () => callable(owner, "agregarProductoOT")({
    businessId, otId, servicioOtId: serviceId, requestId: `product-price-${RUN_ID}`,
    itemId: "producto-core", cantidad: 1, precioUnitario: 1,
  }), ["invalid-argument"], /no está admitido/i);
  const stockBefore = (await adminDb.doc(`negocios/${businessId}/inventario/producto-core`).get()).data().stock;
  const addedProduct = await callable(owner, "agregarProductoOT")({
    businessId, otId, servicioOtId: serviceId, requestId: `product-add-${RUN_ID}`,
    itemId: "producto-core", cantidad: 2,
  });
  const productId = addedProduct.data.productoOtId;
  service = (await adminDb.doc(servicePath).get()).data();
  assert.equal(service.productos[0].productoOtId, productId);
  assert.equal(service.productos[0].itemId, "producto-core");
  assert.equal(service.productos[0].cantidad, 2);
  assert.equal(service.productos[0].precioUnitario, null);
  assert.equal(service.productos[0].productoSnapshot, null);
  assert.equal((await callable(owner, "agregarProductoOT")({
    businessId, otId, servicioOtId: serviceId, requestId: `product-add-${RUN_ID}`,
    itemId: "producto-core", cantidad: 2,
  })).data.sinCambios, true);
  await callable(admin, "actualizarServicioOT")({
    businessId, otId, servicioOtId: serviceId, expectedActualizadoEn: service.actualizadoEn.toMillis(),
    servicio: {itemId: "servicio-core"},
  });
  service = (await adminDb.doc(servicePath).get()).data();
  assert.equal(service.responsableUid, undefined, "El trabajo no guarda responsable propio");
  await expectCallableError("solo el responsable, Admin u Owner cambian repuestos", () => callable(member, "actualizarProductoOT")({
    businessId, otId, servicioOtId: serviceId, productoOtId: productId, cantidad: 3,
    expectedActualizadoEn: service.actualizadoEn.toMillis(),
  }), ["permission-denied"], /Solo el responsable de la OT/i);
  await callable(technician, "actualizarProductoOT")({
    businessId, otId, servicioOtId: serviceId, productoOtId: productId, cantidad: 3,
    expectedActualizadoEn: service.actualizadoEn.toMillis(),
  });
  service = (await adminDb.doc(servicePath).get()).data();
  assert.equal(service.productos[0].cantidad, 3);
  await expectCallableError("versión obsoleta de ProductoOT", () => callable(owner, "eliminarProductoOT")({
    businessId, otId, servicioOtId: serviceId, productoOtId: productId,
    expectedActualizadoEn: 0,
  }), ["aborted"], /otra sesión/i);
  await callable(owner, "eliminarProductoOT")({
    businessId, otId, servicioOtId: serviceId, productoOtId: productId,
    expectedActualizadoEn: service.actualizadoEn.toMillis(),
  });
  service = (await adminDb.doc(servicePath).get()).data();
  assert.deepEqual(service.productos, []);
  assert.equal((await adminDb.doc(`negocios/${businessId}/inventario/producto-core`).get()).data().stock, stockBefore);
  await expectFirestoreDenied("SDK cliente no escribe ServicioOT", () => setDoc(doc(owner.db, servicePath), {estado: "completado"}, {merge: true}));
  await expectFirestoreDenied("otro negocio no lee ServicioOT", () => getDoc(doc(outsider.db, servicePath)));
  assert.equal((await getDocs(query(collection(technician.db, `${orderPath}/servicios`),
    where("negocioId", "==", businessId), where("otId", "==", otId)))).size, 1);
  console.log("OK trabajos OT: referencias Core, responsable de la OT, idempotencia, cantidad, stock intacto y RBAC");

  const assignable = await callable(technician, "listarPersonasAsignablesTaller")({businessId});
  assert.ok(assignable.data.personas.some((person) => person.uid === technician.uid));
  assert.ok(!assignable.data.personas.some((person) => person.uid === owner.uid));
  assert.ok(assignable.data.actores.some((person) => person.uid === owner.uid));
  assert.ok(assignable.data.personas.every((person) => Object.keys(person).sort().join(",") === "nombre,uid"));
  assert.ok(assignable.data.actores.every((person) => Object.keys(person).sort().join(",") === "nombre,uid"));
  const diagnosisRequestId = `diagnosis-create-${RUN_ID}`;
  const draftInput = {responsableUid: technician.uid, descripcion: "", observaciones: "Revisar motor"};
  const draft = await callable(owner, "registrarDiagnostico")({
    businessId, otId, requestId: diagnosisRequestId, diagnostico: draftInput,
  });
  const diagnosisId = draft.data.diagnosticoId;
  const diagnosisPath = `${orderPath}/diagnosticos/${diagnosisId}`;
  let diagnosis = (await adminDb.doc(diagnosisPath).get()).data();
  assert.equal(diagnosis.estado, "borrador");
  assert.equal(diagnosis.responsableUid, technician.uid);
  assert.equal(diagnosis.creadoPorUid, owner.uid);
  assert.equal(diagnosis.actualizadoPorUid, owner.uid);
  assert.equal(diagnosis.completadoEn, null);
  assert.ok(diagnosis.creadoEn?.toDate());
  assert.ok(diagnosis.actualizadoEn?.toDate());
  const retry = await callable(owner, "registrarDiagnostico")({
    businessId, otId, requestId: diagnosisRequestId, diagnostico: draftInput,
  });
  assert.equal(retry.data.sinCambios, true);
  assert.equal((await adminDb.collection(`${orderPath}/diagnosticos`).get()).size, 1);
  await expectCallableError("responsable de otro negocio", () => callable(owner, "registrarDiagnostico")({
    businessId, otId, requestId: `diagnosis-cross-${RUN_ID}`,
    diagnostico: {responsableUid: outsider.uid, descripcion: "Falla", observaciones: ""},
  }), ["failed-precondition"], /responsable asignable/i);
  await expectCallableError("estado directo de diagnóstico", () => callable(owner, "registrarDiagnostico")({
    businessId, otId, requestId: `diagnosis-state-${RUN_ID}`,
    diagnostico: {...draftInput, estado: "completado"},
  }), ["invalid-argument"], /no está admitido/i);
  await expectCallableError("descripción vacía no completa", () => callable(technician, "completarDiagnostico")({
    businessId, otId, diagnosticoId: diagnosisId, expectedActualizadoEn: diagnosis.actualizadoEn.toMillis(),
  }), ["failed-precondition"], /Describe el diagnóstico/i);
  await expectCallableError("miembro sin acceso no edita diagnóstico", () => callable(outsider, "actualizarDiagnostico")({
    businessId, otId, diagnosticoId: diagnosisId, expectedActualizadoEn: diagnosis.actualizadoEn.toMillis(),
    diagnostico: {responsableUid: technician.uid, descripcion: "No autorizado", observaciones: ""},
  }), ["permission-denied"]);
  await callable(technician, "actualizarDiagnostico")({
    businessId, otId, diagnosticoId: diagnosisId, expectedActualizadoEn: diagnosis.actualizadoEn.toMillis(),
    diagnostico: {responsableUid: technician.uid, descripcion: "Falla de arranque confirmada", observaciones: "Revisar motor"},
  });
  const oldRevision = diagnosis.actualizadoEn.toMillis();
  diagnosis = (await adminDb.doc(diagnosisPath).get()).data();
  assert.equal(diagnosis.actualizadoPorUid, technician.uid);
  assert.equal(diagnosis.creadoPorUid, owner.uid);
  await expectCallableError("edición concurrente", () => callable(owner, "actualizarDiagnostico")({
    businessId, otId, diagnosticoId: diagnosisId, expectedActualizadoEn: oldRevision,
    diagnostico: {responsableUid: technician.uid, descripcion: "Dato obsoleto", observaciones: ""},
  }), ["aborted"], /otra sesión/i);
  await callable(admin, "completarDiagnostico")({
    businessId, otId, diagnosticoId: diagnosisId, expectedActualizadoEn: diagnosis.actualizadoEn.toMillis(),
  });
  diagnosis = (await adminDb.doc(diagnosisPath).get()).data();
  assert.equal(diagnosis.estado, "completado");
  assert.equal(diagnosis.completadoPorUid, admin.uid);
  assert.ok(diagnosis.completadoEn?.toDate());
  await expectCallableError("diagnóstico completado inmutable", () => callable(owner, "actualizarDiagnostico")({
    businessId, otId, diagnosticoId: diagnosisId, expectedActualizadoEn: diagnosis.actualizadoEn.toMillis(),
    diagnostico: {responsableUid: technician.uid, descripcion: "Cambio posterior", observaciones: ""},
  }), ["failed-precondition"], /solo lectura/i);
  await expectCallableError("completar dos veces", () => callable(admin, "completarDiagnostico")({
    businessId, otId, diagnosticoId: diagnosisId, expectedActualizadoEn: diagnosis.actualizadoEn.toMillis(),
  }), ["failed-precondition"], /ya está completado/i);
  const nextDiagnosis = await callable(member, "registrarDiagnostico")({
    businessId, otId, requestId: `diagnosis-second-${RUN_ID}`,
    diagnostico: {responsableUid: member.uid, descripcion: "Nueva observación", observaciones: ""},
  });
  assert.notEqual(nextDiagnosis.data.diagnosticoId, diagnosisId);
  assert.equal((await adminDb.collection(`${orderPath}/diagnosticos`).get()).size, 2);
  const events = (await adminDb.collection(`${orderPath}/historial`).get()).docs.map((item) => item.data());
  assert.deepEqual(events.filter((event) => event.tipo.startsWith("diagnostico_"))
    .map((event) => event.tipo).sort(), [
    "diagnostico_actualizado", "diagnostico_completado", "diagnostico_creado", "diagnostico_creado",
  ].sort());
  assert.ok(events.filter((event) => event.tipo.startsWith("diagnostico_"))
    .every((event) => event.actorUid && event.fecha?.toDate() && event.detalle?.diagnosticoId));
  assert.deepEqual(events.filter((event) => event.tipo.includes("_ot_"))
    .map((event) => event.tipo).sort(), [
      "servicio_ot_creado", "servicio_ot_actualizado", "producto_ot_agregar",
      "producto_ot_actualizar", "producto_ot_eliminar",
    ].sort());
  await expectFirestoreDenied("SDK cliente no escribe diagnóstico", () => setDoc(doc(owner.db, `${orderPath}/diagnosticos/directo`), {
    negocioId: businessId, otId, estado: "completado",
  }));
  await expectFirestoreDenied("otro negocio no lee diagnóstico", () => getDoc(doc(outsider.db, diagnosisPath)));
  const visibleDiagnoses = await getDocs(query(collection(technician.db, `${orderPath}/diagnosticos`),
    where("negocioId", "==", businessId), where("otId", "==", otId)));
  assert.equal(visibleDiagnoses.size, 2);
  console.log("OK Diagnósticos: borrador, responsable, concurrencia, completar explícito, inmutabilidad, auditoría y permisos");

  const repeated = await callable(owner, "crearOrdenTrabajo")({
    businessId,
    requestId,
    ordenTrabajo: {vehiculoId: "vehiculo-a"},
  });
  assert.equal(repeated.data.sinCambios, true);
  assert.equal(repeated.data.ordenTrabajo.otId, otId);
  assert.equal(
    (await adminDb.collection(`negocios/${businessId}/ordenesTrabajo`).get()).size,
    1
  );
  await expectCallableError(
    "requestId reutilizado con otro vehículo",
    () => callable(owner, "crearOrdenTrabajo")({
      businessId,
      requestId,
      ordenTrabajo: {vehiculoId: "vehiculo-b"},
    }),
    ["already-exists"],
    /otros datos/i
  );
  console.log("OK idempotencia OT: el reintento no crea otra orden ni consume número");

  await adminDb.doc(`negocios/${businessId}/vehiculos/vehiculo-a`).update({
    clienteId: "cliente-b",
  });
  assert.equal((await adminDb.doc(orderPath).get()).data().clienteId, "cliente-a");
  const afterOwnerChange = await callable(admin, "crearOrdenTrabajo")({
    businessId,
    requestId: `work-order-new-owner-${RUN_ID}`,
    ordenTrabajo: {vehiculoId: "vehiculo-a"},
  });
  assert.equal(afterOwnerChange.data.ordenTrabajo.numeroOT, "OT-000002");
  assert.equal(afterOwnerChange.data.ordenTrabajo.clienteId, "cliente-b");
  assert.equal((await adminDb.doc(orderPath).get()).data().clienteId, "cliente-a");
  const transitionPlazaRequestId = `plaza-transition-${RUN_ID}`;
  const transitionPlaza = await callable(owner, "crearPlazaTaller")({
    businessId, requestId: transitionPlazaRequestId, plaza: {nombre: "Taller - Plaza 1"},
  });
  const transitionOtId = afterOwnerChange.data.ordenTrabajo.otId;
  const transitionOrderRef = adminDb.doc(`negocios/${businessId}/ordenesTrabajo/${transitionOtId}`);
  await callable(admin, "asignarPlazaOT")({
    businessId, otId: transitionOtId, plazaId: transitionPlaza.data.plaza.plazaId,
    expectedActualizadoEn: (await transitionOrderRef.get()).data().actualizadoEn.toMillis(),
  });
  await transitionOrderRef.update({fotosRecepcion: receptionPhotosFixture()});
  const receptionWithPlaza = await callable(admin, "registrarRecepcionOrdenTrabajo")({
    businessId,
    otId: transitionOtId,
    recepcion: workOrderReception(),
  });
  assert.equal(receptionWithPlaza.data.ordenTrabajo.estado, "en_diagnostico");
  console.log("OK transición recepción: una OT con Plaza pasa a diagnóstico");
  console.log("OK Cliente histórico: cada OT congela el propietario vigente al crear");

  const concurrent = await Promise.all([
    callable(owner, "crearOrdenTrabajo")({
      businessId,
      requestId: `work-order-concurrent-owner-${RUN_ID}`,
      ordenTrabajo: {vehiculoId: "vehiculo-a"},
    }),
    callable(admin, "crearOrdenTrabajo")({
      businessId,
      requestId: `work-order-concurrent-admin-${RUN_ID}`,
      ordenTrabajo: {vehiculoId: "vehiculo-b"},
    }),
  ]);
  assert.deepEqual(
    concurrent.map((result) => result.data.ordenTrabajo.numeroOT).sort(),
    ["OT-000003", "OT-000004"]
  );
  assert.equal(
    new Set(concurrent.map((result) => result.data.ordenTrabajo.numeroOT)).size,
    2
  );
  assert.equal(
    (await adminDb.doc(`negocios/${businessId}/otCounters/global`).get()).data().lastNumber,
    4
  );
  console.log("OK concurrencia OT: el contador entrega números únicos e incrementales");

  // Las pruebas de Plaza parten de la OT principal recién recibida, antes de aprobar el ingreso.
  await callable(owner, "liberarPlazaOT")({businessId, otId,
    expectedActualizadoEn: (await adminDb.doc(orderPath).get()).data().actualizadoEn.toMillis()});
  await adminDb.doc(orderPath).update({estado: "en_cola", estadoAprobacion: "pendiente"});
  await testWorkshopPlazas({
    adminDb, businessId, transitionOtId, transitionPlazaId: transitionPlaza.data.plaza.plazaId,
    primaryOtId: otId, concurrentOtIds: concurrent.map((result) => result.data.ordenTrabajo.otId),
    owner, admin, technician, member, outsider, callable, expectCallableError,
    expectFirestoreDenied, runId: RUN_ID,
  });

  await expectCallableError(
    "frontend intenta fijar numeroOT y estado",
    () => callable(owner, "crearOrdenTrabajo")({
      businessId,
      requestId: `work-order-protected-${RUN_ID}`,
      ordenTrabajo: {
        vehiculoId: "vehiculo-b",
        numeroOT: "OT-999999",
        estado: "cerrada",
      },
    }),
    ["invalid-argument"],
    /no está admitido/i
  );
  await expectCallableError(
    "vehículo inexistente",
    () => callable(owner, "crearOrdenTrabajo")({
      businessId,
      requestId: `work-order-missing-vehicle-${RUN_ID}`,
      ordenTrabajo: {vehiculoId: "vehiculo-inexistente"},
    }),
    ["not-found"]
  );
  await expectCallableError(
    "vehículo con negocioId inconsistente",
    () => callable(owner, "crearOrdenTrabajo")({
      businessId,
      requestId: `work-order-cross-vehicle-${RUN_ID}`,
      ordenTrabajo: {vehiculoId: "vehiculo-inconsistente"},
    }),
    ["failed-precondition"],
    /no pertenece al negocio/i
  );
  await adminDb.doc(`negocios/${businessId}/vehiculos/vehiculo-b`).update({
    clienteId: "cliente-inconsistente",
  });
  await expectCallableError(
    "Cliente del vehículo pertenece a otro negocio",
    () => callable(owner, "crearOrdenTrabajo")({
      businessId,
      requestId: `work-order-cross-client-${RUN_ID}`,
      ordenTrabajo: {vehiculoId: "vehiculo-b"},
    }),
    ["failed-precondition"],
    /propietario actual no pertenece/i
  );
  const technicianOrder = await callable(technician, "crearOrdenTrabajo")({
    businessId,
    requestId: `work-order-technician-${RUN_ID}`,
    ordenTrabajo: {vehiculoId: "vehiculo-a"},
  });
  assert.equal(technicianOrder.data.ordenTrabajo.creadoPorUid, technician.uid);
  await expectCallableError(
    "MEMBER no crea OT",
    () => callable(member, "crearOrdenTrabajo")({
      businessId,
      requestId: `work-order-member-${RUN_ID}`,
      ordenTrabajo: {vehiculoId: "vehiculo-a"},
    }),
    ["permission-denied"]
  );
  await expectCallableError(
    "usuario sin membresía manipula businessId",
    () => callable(outsider, "crearOrdenTrabajo")({
      businessId,
      requestId: `work-order-outsider-${RUN_ID}`,
      ordenTrabajo: {vehiculoId: "vehiculo-a"},
    }),
    ["permission-denied"]
  );
  await expectCallableError(
    "usuario sin membresía registra recepción",
    () => callable(outsider, "registrarRecepcionOrdenTrabajo")({
      businessId,
      otId,
      recepcion: workOrderReception(),
    }),
    ["permission-denied"]
  );

  const outsiderOrder = await callable(outsider, "crearOrdenTrabajo")({
    businessId: outsiderBusinessId,
    requestId: `work-order-outsider-own-${RUN_ID}`,
    ordenTrabajo: {vehiculoId: "vehiculo-externo"},
  });
  assert.equal(outsiderOrder.data.ordenTrabajo.numeroOT, "OT-000001");
  console.log("OK aislamiento OT: correlativo e idempotencia son por negocio");

  assert.ok((await getDoc(doc(technician.db, orderPath))).exists());
  const listed = await getDocs(query(
    collection(technician.db, `negocios/${businessId}/ordenesTrabajo`),
    where("negocioId", "==", businessId)
  ));
  assert.equal(listed.size, 5);
  console.log("OK lectura OT: listado filtrado autorizado para Taller");

  const technicianInventory = await getDoc(
    doc(technician.db, `negocios/${businessId}/inventario/producto-core`)
  );
  assert.equal(technicianInventory.data()?.costoBase, 3000);
  const technicianCatalog = (await callable(technician, "listarCatalogoTaller")({businessId})).data.items;
  assert.ok(technicianCatalog.length > 0);
  assert.ok(technicianCatalog.every((item) => item.precioEfectivo === null));
  assert.ok(technicianCatalog.every((item) =>
    !Object.keys(item).some((key) => /costo|margen|precioInterno/i.test(key))));
  const ownerCatalog = (await callable(owner, "listarCatalogoTaller")({businessId})).data.items;
  assert.ok(ownerCatalog.some((item) => item.itemId === "producto-core" && item.precioEfectivo === 8000));
  console.log("OK permisos Core: TECNICO lee costos, no recibe precios; OWNER recibe precio efectivo");

  await expectFirestoreDenied(
    "otro negocio no puede leer la OT",
    () => getDoc(doc(outsider.db, orderPath))
  );
  await expectFirestoreDenied(
    "consulta OT sin filtro de negocioId",
    () => getDocs(collection(owner.db, `negocios/${businessId}/ordenesTrabajo`))
  );
  await expectFirestoreDenied(
    "SDK cliente no puede crear OT",
    () => setDoc(doc(owner.db, `negocios/${businessId}/ordenesTrabajo/directa`), {
      otId: "directa",
      negocioId: businessId,
      numeroOT: "OT-999999",
    })
  );
  await expectFirestoreDenied(
    "SDK cliente no puede leer contador OT",
    () => getDoc(doc(owner.db, `negocios/${businessId}/otCounters/global`))
  );
  await expectFirestoreDenied(
    "SDK cliente no puede leer idempotencia OT",
    () => getDoc(doc(owner.db, `negocios/${businessId}/otCreateRequests/${requestId}`))
  );
  await adminDb.doc(`negocios/${businessId}/perfilesEmpleados/taller-only`).set({
    negocioId: businessId, estado: "activo", modulos: ["taller"],
  });
  await adminDb.doc(`membresias/${businessId}__${member.uid}`).update({profileId: "taller-only"});
  await expectFirestoreDenied("perfil solo Taller no lee costos de Inventario Core", () =>
    getDocs(query(collection(member.db, `negocios/${businessId}/inventario`),
      where("negocioId", "==", businessId))));
  const tallerOnlyCatalog = (await callable(member, "listarCatalogoTaller")({businessId})).data.items;
  assert.ok(tallerOnlyCatalog.length > 0);
  assert.ok(tallerOnlyCatalog.every((item) => item.precioEfectivo === null));
  assert.ok(tallerOnlyCatalog.every((item) =>
    !Object.keys(item).some((key) => /costo|margen|precioInterno/i.test(key))));
  await adminDb.doc(`negocios/${businessId}/perfilesEmpleados/taller-only`).update({
    modulos: ["taller", "cotizaciones"],
  });
  const pricedCatalog = (await callable(member, "listarCatalogoTaller")({businessId})).data.items;
  assert.ok(pricedCatalog.some((item) => item.itemId === "servicio-core" && item.precioEfectivo === 25000));
  assert.ok(pricedCatalog.some((item) => item.itemId === "producto-core" && item.precioEfectivo === 8000));
  assert.ok(pricedCatalog.every((item) =>
    !Object.keys(item).some((key) => /costo|margen|precioInterno/i.test(key))));
  assert.ok((await getDoc(doc(member.db, servicePath))).exists());
  console.log("OK perfil Taller: catálogo sin costos y precios solo con PRICING_READ");
  console.log("WORK_ORDERS_INTEGRATED_LOCAL_OK");
  await testWorkOrderApproval({adminDb, businessId, otId, serviceId,
    owner, admin, technician, member, outsider, callable, expectCallableError, expectFirestoreDenied, runId: RUN_ID});
  await testServiceExecution({adminDb, businessId, otId, serviceId, owner, admin, technician, member,
    outsider, callable, expectCallableError, expectFirestoreDenied, runId: RUN_ID});
  await testWorkOrderClosure({adminDb, businessId, otId, serviceId, owner, admin, technician, member,
    outsider, anonymous, callable, expectCallableError, expectFirestoreDenied,
    reception: workOrderReception(), runId: RUN_ID});
  await testWorkOrderCancellation({adminDb, businessId, owner, technician, outsider, callable,
    expectCallableError, expectFirestoreDenied, reception: workOrderReception(), runId: RUN_ID});
  await testWorkOrderEndToEnd({adminDb, businessId, owner, technician, anonymous, callable, expectCallableError,
    reception: workOrderReception(), runId: RUN_ID});
  await testWorkshopPlazaAutoAssignment({adminDb, businessId, owner, admin, technician, callable,
    expectCallableError, reception: workOrderReception(), runId: RUN_ID});
  await testWorkOrderStock({adminDb, businessId, owner, technician, callable,
    expectCallableError, reception: workOrderReception(), runId: RUN_ID});
  await testWorkshopSecurity({adminDb, businessId, otId, owner, member, technician, outsider,
    anonymous, callable, expectCallableError, expectFirestoreDenied, runId: RUN_ID});
  // Al final: crea su propia OT y puede ocupar una plaza.
  await testWorkOrderApprovalRace({adminDb, businessId, owner, admin, technician, callable,
    reception: workOrderReception(), runId: RUN_ID});
} finally {
  await Promise.all(clients.map((client) => terminate(client.db)));
  await Promise.all(clients.map((client) => deleteApp(client.app)));
  await deleteAdminApp(adminApp);
}
