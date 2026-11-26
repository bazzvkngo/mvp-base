import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, getAuth, signInAnonymously} from "firebase/auth";
import {connectFirestoreEmulator, doc, getDoc, getFirestore, terminate} from "firebase/firestore";

const {
  GCLOUD_PROJECT: projectId,
  FIREBASE_AUTH_EMULATOR_HOST: authHost,
  FIRESTORE_EMULATOR_HOST: databaseHost,
} = process.env;
if (!projectId?.startsWith("demo-") || !/^127\.0\.0\.1:\d+$/.test(authHost) || !/^127\.0\.0\.1:\d+$/.test(databaseHost)) {
  throw new Error("Ejecuta esta prueba con Auth y Firestore locales en un proyecto demo.");
}

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");
const {requireOperationalBusinessAccess} = require("../functions/businessOnboarding");
const {confirmarVentaHandler, crearVentaHandler} = require("../functions/salePersistence");
const {guardarAtencionVeterinariaHandler} = require("../functions/veterinaryAttentionPersistence");
const adminApp = admin.initializeApp({projectId});
const db = admin.firestore();
const app = initializeApp({projectId, apiKey: "demo-key"});
const auth = getAuth(app);
const clientDb = getFirestore(app);
connectAuthEmulator(auth, "http://" + authHost, {disableWarnings: true});
connectFirestoreEmulator(clientDb, "127.0.0.1", Number(databaseHost.split(":")[1]));

const dependencies = {
  db,
  HttpsError,
  FieldValue: admin.firestore.FieldValue,
  requireBusinessAccess: requireOperationalBusinessAccess,
};

try {
  const owner = await admin.auth().createUser({displayName: "Propietario de prueba"});
  const otherVet = await admin.auth().createUser({displayName: "Otra veterinaria de prueba"});
  const {user: veterinarian} = await signInAnonymously(auth);
  const businessId = "venta-veterinaria-" + randomUUID();
  const business = db.doc("negocios/" + businessId);
  const inventory = business.collection("inventario");
  const medication = inventory.doc("medicamento-ficticio");
  const consultation = inventory.doc("servicio-ficticio");
  const attentions = business.collection("atencionesVeterinarias");
  const sales = business.collection("ventas");
  const tutorId = "tutor-ficticio";
  const patientId = "paciente-ficticio";
  const profileId = "perfil-veterinario";
  const member = (uid, rol, profile = {}) => db.doc("membresias/" + businessId + "__" + uid).set({
    uid, negocioId: businessId, rol, estado: "activo", ...profile,
  });
  const inventoryItem = (itemId, nombre, tipoItem, precioInterno) => ({
    itemId, nombre, codigoInterno: itemId.toUpperCase(), negocioId: businessId,
    tipoItem, precioInterno, estado: "activo", unidad: "unidad",
  });
  await Promise.all([
    business.set({
      estado: "activo", paisCodigo: "CL", monedaCodigo: "CLP", locale: "es-CL",
      nombreComercial: "Clínica ficticia", verificacionEmpresa: {estado: "VERIFICADA"},
      modulosHabilitados: ["veterinaria"],
    }),
    member(owner.uid, "OWNER"),
    member(veterinarian.uid, "MEMBER", {profileId}),
    member(otherVet.uid, "MEMBER", {profileId}),
    db.doc("usuarios/" + veterinarian.uid + "/cuenta/perfil").set({nombres: "Veterinaria", apellidos: "de prueba"}),
    business.collection("perfilesEmpleados").doc(profileId).set({
      nombre: "Veterinario", negocioId: businessId, estado: "activo", modulos: ["veterinaria_asignada"],
    }),
    business.collection("clientes").doc(tutorId).set({
      clienteId: tutorId, negocioId: businessId, estado: "activo", tipoCliente: "persona",
      nombreRazonSocial: "Tutor de prueba", email: "tutor@example.test",
    }),
    business.collection("pacientesVeterinarios").doc(patientId).set({
      negocioId: businessId, estado: "activo", nombre: "Paciente de prueba", tutorClienteId: tutorId,
    }),
    medication.set({
      ...inventoryItem(medication.id, "Medicamento de prueba", "producto", 4500),
      stock: 10, costoBase: 4000, costoPromedio: 3500, costoPromedioMoneda: "CLP",
    }),
    consultation.set(inventoryItem(consultation.id, "Consulta veterinaria de prueba", "servicio", 12000)),
  ]);

  const handle = (operacion, atencionId, atencion = {}, uid = veterinarian.uid) =>
    guardarAtencionVeterinariaHandler({auth: {uid}, data: {businessId, operacion, atencionId, atencion}}, dependencies);
  const openOrder = async (orderId) => {
    await handle("crearOrden", orderId, {
      origen: "directa", pacienteId: patientId, horaLlegada: "09:00", prioridad: "normal", motivoConsulta: "Consulta ficticia",
    }, owner.uid);
    await handle("asignarOrden", orderId, {
      box: "Box " + orderId, tipoAtencion: "Consulta", profesionalUid: veterinarian.uid,
    }, owner.uid);
    await handle("iniciar", orderId);
  };
  const clinical = {
    motivoConsulta: "Motivo clínico privado de prueba",
    diagnostico: "Diagnóstico privado de prueba",
    tratamiento: "Tratamiento privado de prueba",
    resultadoClinico: "alta",
  };
  const confirm = (ventaId, requestId, uid = owner.uid) => confirmarVentaHandler({
    auth: {uid}, data: {businessId, ventaId, requestId},
  }, dependencies);
  const movements = (ventaId) => business.collection("movimientosInventario").where("ventaId", "==", ventaId).get();

  const orderId = "orden-cobro-ficticia";
  await openOrder(orderId);
  await assert.rejects(handle("cerrar", orderId, clinical), ({code}) =>
    ["invalid-argument", "failed-precondition"].includes(code));
  assert.equal((await attentions.doc(orderId).get()).get("estado"), "en_atencion");
  assert.equal((await sales.get()).size, 0);

  const billableClinical = {
    ...clinical,
    clienteId: "no-confiar-en-cliente",
    tutorClienteId: "no-confiar-en-tutor",
    items: [
      {itemId: consultation.id, cantidad: 1, precioUnitario: 1, descuentoPct: 100},
      {itemId: medication.id, cantidad: 3, precioUnitario: 1, tipoItem: "servicio"},
    ],
  };
  await assert.rejects(handle("cerrar", orderId, billableClinical, otherVet.uid), {code: "permission-denied"});
  assert.equal((await handle("cerrar", orderId, billableClinical)).atencionId, orderId);
  const closed = (await attentions.doc(orderId).get()).data();
  assert.equal(closed.estado, "finalizada");
  assert.equal(closed.ventaEstado, "generada");
  assert.match(closed.ventaNumero, /^VTA-\d{4}-\d+$/);
  assert.ok(closed.ventaId);
  const sale = await sales.doc(closed.ventaId).get();
  assert.equal(sale.get("estado"), "borrador");
  assert.equal(sale.get("clienteId"), tutorId);
  assert.equal(sale.get("clienteSnapshot.nombreRazonSocial"), "Tutor de prueba");
  assert.equal(sale.get("subtotal"), 25500);
  assert.equal(sale.get("stockAplicado"), false);
  assert.doesNotMatch(JSON.stringify(sale.data()), /privado de prueba/);
  const saleItems = new Map(sale.get("items").map((item) => [item.itemId, item]));
  assert.equal(saleItems.size, 2);
  assert.equal(saleItems.get(consultation.id).tipoItem, "servicio");
  assert.equal(saleItems.get(consultation.id).precioUnitario, 12000);
  assert.equal(saleItems.get(consultation.id).descuentoPct, 0);
  assert.equal(saleItems.get(medication.id).tipoItem, "producto");
  assert.equal(saleItems.get(medication.id).precioUnitario, 4500);
  assert.equal(saleItems.get(medication.id).cantidad, 3);
  assert.equal((await medication.get()).get("stock"), 10);
  assert.equal((await movements(sale.id)).size, 0);
  await assert.rejects(getDoc(doc(clientDb, sale.ref.path)), {code: "permission-denied"});

  await handle("cerrar", orderId, billableClinical);
  assert.equal((await attentions.doc(orderId).get()).get("ventaId"), sale.id);
  assert.equal((await sales.get()).size, 1);

  const manualSale = (cantidad, requestId, uid = owner.uid) => crearVentaHandler({
    auth: {uid},
    data: {
      businessId, requestId,
      venta: {
        clienteId: tutorId, fechaVenta: "2026-11-24",
        items: [{itemId: medication.id, cantidad, precioUnitario: 4500}],
      },
    },
  }, dependencies);
  await assert.rejects(manualSale(1, "creacion-no-autorizada", veterinarian.uid), {code: "permission-denied"});
  await assert.rejects(confirm(sale.id, "confirmacion-no-autorizada", veterinarian.uid), {code: "permission-denied"});
  assert.equal((await confirm(sale.id, "confirmacion-vet-1")).venta.estado, "confirmada");
  assert.equal((await confirm(sale.id, "confirmacion-vet-1")).idempotent, true);
  assert.equal((await confirm(sale.id, "confirmacion-vet-2")).idempotent, true);
  assert.deepEqual(
    [(await medication.get()).get("stock"), (await medication.get()).get("valorInventario")],
    [7, 24500],
  );
  assert.equal((await consultation.get()).get("stock"), undefined);
  const applied = await movements(sale.id);
  assert.equal(applied.size, 1);
  assert.equal(applied.docs[0].get("itemId"), medication.id);
  assert.equal(applied.docs[0].get("tipo"), "salida_venta");
  assert.equal(applied.docs[0].get("cantidad"), 3);
  assert.equal(applied.docs[0].get("costoTotal"), 10500);

  const insufficientOrderId = "orden-stock-compartido";
  await openOrder(insufficientOrderId);
  await handle("cerrar", insufficientOrderId, {...clinical, items: [{itemId: medication.id, cantidad: 7}]});
  const insufficient = (await attentions.doc(insufficientOrderId).get()).get("ventaId");
  assert.ok(insufficient);
  const interveningSale = await manualSale(1, "venta-intermedia");
  await confirm(interveningSale.venta.id, "confirmacion-intermedia");
  await assert.rejects(confirm(insufficient, "confirmacion-stock-insuficiente"), {
    code: "failed-precondition", message: /Stock insuficiente/,
  });
  assert.equal((await sales.doc(insufficient).get()).get("estado"), "borrador");
  assert.equal((await attentions.doc(insufficientOrderId).get()).get("estado"), "finalizada");
  const remaining = await medication.get();
  assert.deepEqual([remaining.get("stock"), remaining.get("valorInventario")], [6, 21000]);
  assert.equal((await movements(insufficient)).size, 0);
  console.log("VETERINARY_ATTENTION_SALE_SMOKE_OK");
} finally {
  await terminate(clientDb);
  await deleteApp(app);
  await adminApp.delete();
}
