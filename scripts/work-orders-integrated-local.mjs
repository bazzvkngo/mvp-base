import assert from "node:assert/strict";
import {testWorkOrderApproval} from "./work-order-approval-cases.mjs";
import {testServiceExecution} from "./work-order-service-execution-cases.mjs";
import {testWorkOrderClosure} from "./work-order-closure-cases.mjs";
import {testWorkOrderMaterials} from "./work-order-material-cases.mjs";
import {testWorkshopPlazas} from "./work-order-plaza-cases.mjs";
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

function workOrderReception({checklist: checklistOverrides = {}, ...overrides} = {}) {
  return {
    kilometraje: 45210,
    nivelCombustible: "1/2",
    checklist: {
      carroceriaPintura: "SIN_DANOS_VISIBLES",
      vidriosEspejos: "SIN_DANOS_VISIBLES",
      lucesOpticos: "SIN_DANOS_VISIBLES",
      neumaticosLlantas: "SIN_DANOS_VISIBLES",
      interior: "SIN_DANOS_VISIBLES",
      tableroIndicadores: "SIN_ALERTAS_VISIBLES",
      encendido: "NO_PROBADO",
      fugasVisibles: "NO_REVISADO",
      nivelesVisibles: "SIN_OBSERVACIONES",
      estadoGeneral: "SIN_OBSERVACIONES",
      ...checklistOverrides,
    },
    accesorios: ["Llave de rueda"],
    danosObservados: "Ninguno",
    observaciones: "Sin novedades visibles.",
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

  await Promise.all([
    adminDb.doc(`negocios/${businessId}`).update({
      monedaCodigo: "CLP",
      verificacionEmpresa: {estado: "VERIFICADA"},
    }),
    adminDb.doc(`negocios/${outsiderBusinessId}`).update({
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
      codigoInterno: "SER-001", unidad: "servicio", precioInterno: 25000,
    }),
    adminDb.doc(`negocios/${businessId}/inventario/producto-core`).set({
      negocioId: businessId, tipoItem: "producto", estado: "activo", nombre: "Filtro",
      codigoInterno: "PRO-001", unidad: "unidad", precioInterno: 8000, stock: 12,
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

  await expectCallableError(
    "anomalía de recepción sin descripción",
    () => callable(owner, "registrarRecepcionOrdenTrabajo")({
      businessId,
      otId,
      recepcion: workOrderReception({
        checklist: {encendido: "NO_ENCIENDE"},
      }),
    }),
    ["invalid-argument"],
    /Describe los daños/i
  );
  await expectCallableError(
    "recepción sin checklist completa",
    () => callable(owner, "registrarRecepcionOrdenTrabajo")({
      businessId,
      otId,
      recepcion: workOrderReception({
        checklist: {interior: ""},
      }),
    }),
    ["invalid-argument"],
    /obligatorio/i
  );
  const registeredReception = await callable(owner, "registrarRecepcionOrdenTrabajo")({
    businessId,
    otId,
    recepcion: workOrderReception(),
  });
  assert.equal(registeredReception.data.ordenTrabajo.estado, "en_cola");
  const orderAfterReception = (await adminDb.doc(orderPath).get()).data();
  assert.equal(orderAfterReception.estado, "en_cola");
  assert.equal(orderAfterReception.recepcion.danosObservados, "Ninguno");
  assert.equal(orderAfterReception.recepcion.recibidoPorUid, owner.uid);
  assert.ok(orderAfterReception.recepcion.recibidoEn?.toDate());
  assert.equal(orderAfterReception.actualizadoPorUid, owner.uid);
  console.log("OK recepción OT: checklist completa, autoría backend y transición sin Plaza");

  const updatedReception = await callable(technician, "registrarRecepcionOrdenTrabajo")({
    businessId,
    otId,
    recepcion: workOrderReception({
      checklist: {carroceriaPintura: "CON_OBSERVACIONES"},
      danosObservados: "Rayón visible en puerta trasera.",
    }),
  });
  assert.equal(updatedReception.data.ordenTrabajo.estado, "en_cola");
  const orderAfterReceptionUpdate = (await adminDb.doc(orderPath).get()).data();
  assert.equal(orderAfterReceptionUpdate.recepcion.recibidoPorUid, owner.uid);
  assert.equal(orderAfterReceptionUpdate.recepcion.danosObservados, "Rayón visible en puerta trasera.");
  assert.equal(orderAfterReceptionUpdate.actualizadoPorUid, technician.uid);
  console.log("OK actualización recepción: rol operativo autorizado y autoría inicial preservada");

  const serviceRequestId = `service-create-${RUN_ID}`;
  await expectCallableError("ServicioOT rechaza Producto Core", () => callable(owner, "crearServicioOT")({
    businessId, otId, requestId: `service-wrong-${RUN_ID}`,
    servicio: {itemId: "producto-core", responsableUid: technician.uid},
  }), ["failed-precondition"], /servicio activo/i);
  await expectCallableError("ServicioOT rechaza ítem de otro negocio", () => callable(owner, "crearServicioOT")({
    businessId, otId, requestId: `service-cross-${RUN_ID}`,
    servicio: {itemId: "servicio-externo", responsableUid: technician.uid},
  }), ["failed-precondition"], /mismo negocio/i);
  await expectCallableError("ServicioOT rechaza responsable externo", () => callable(owner, "crearServicioOT")({
    businessId, otId, requestId: `service-responsible-${RUN_ID}`,
    servicio: {itemId: "servicio-core", responsableUid: outsider.uid},
  }), ["failed-precondition"], /responsable asignable/i);
  await expectCallableError("ServicioOT rechaza precio manual", () => callable(owner, "crearServicioOT")({
    businessId, otId, requestId: `service-price-${RUN_ID}`,
    servicio: {itemId: "servicio-core", responsableUid: technician.uid, precioUnitario: 1},
  }), ["invalid-argument"], /no está admitido/i);
  const createdService = await callable(technician, "crearServicioOT")({
    businessId, otId, requestId: serviceRequestId,
    servicio: {itemId: "servicio-core", responsableUid: technician.uid},
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
    servicio: {itemId: "servicio-core", responsableUid: technician.uid},
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
    servicio: {itemId: "servicio-core", responsableUid: member.uid},
  });
  service = (await adminDb.doc(servicePath).get()).data();
  assert.equal(service.responsableUid, member.uid);
  await callable(member, "actualizarProductoOT")({
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
  console.log("OK planificación OT: referencias Core, responsable, idempotencia, cantidad, stock intacto y RBAC");

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
  const coreCatalog = (await callable(member, "listarCatalogoTaller")({businessId})).data.items;
  assert.ok(coreCatalog.some((item) => item.itemId === "servicio-core" && item.precioEfectivo === 25000));
  assert.ok(coreCatalog.some((item) => item.itemId === "producto-core" && item.precioEfectivo === 8000));
  assert.ok(coreCatalog.every((item) => !Object.keys(item).some((key) => /costo|margen|precioInterno/i.test(key))));
  assert.ok((await getDoc(doc(member.db, servicePath))).exists());
  console.log("OK perfil solo Taller: catálogo Core filtrado sin costos y ServiciosOT del mismo negocio");
  console.log("WORK_ORDERS_INTEGRATED_LOCAL_OK");
  await testWorkOrderApproval({adminDb, businessId, otId, serviceId, diagnosisPath,
    owner, admin, technician, member, outsider, callable, expectCallableError, expectFirestoreDenied, runId: RUN_ID});
  await testServiceExecution({adminDb, businessId, otId, serviceId, owner, admin, technician, member,
    outsider, callable, expectCallableError, expectFirestoreDenied, runId: RUN_ID});
  await testWorkOrderMaterials({adminDb, businessId, otId, owner, admin, technician, member, outsider,
    anonymous, callable, expectCallableError, expectFirestoreDenied, runId: RUN_ID});
  await testWorkOrderClosure({adminDb, businessId, otId, serviceId, owner, admin, technician, member,
    outsider, anonymous, callable, expectCallableError, expectFirestoreDenied,
    reception: workOrderReception(), runId: RUN_ID});
} finally {
  await Promise.all(clients.map((client) => terminate(client.db)));
  await Promise.all(clients.map((client) => deleteApp(client.app)));
  await deleteAdminApp(adminApp);
}
