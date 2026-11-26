import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, createUserWithEmailAndPassword, getAuth} from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  terminate,
  updateDoc,
} from "firebase/firestore";
import {connectFunctionsEmulator, getFunctions, httpsCallable} from "firebase/functions";

// SPEC 036, entrega D: Bolivia con 2 decimales de punta a punta, y Chile sin cambios. Corre con emuladores
// (npm run test:bolivia-decimals-integrated). Un mismo flujo se ejecuta en un negocio BOB (3 × Bs 3,50) y en uno CLP
// (3 × $3.500): cotización → venta, orden de compra → recepción → compra con costos en centavos, OT con repuesto
// enviada a aprobación y un movimiento financiero. Al final, ningún documento de Chile lleva `montoDecimales`.
const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ||= PROJECT_ID;
const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const {deleteApp: deleteAdminApp, initializeApp: initializeAdminApp} = requireFromFunctions("firebase-admin/app");
const {getFirestore: getAdminFirestore} = requireFromFunctions("firebase-admin/firestore");

function createClient(name) {
  const app = initializeApp({
    apiKey: "demo-key",
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID,
    appId: `bolivia-decimals-${name}-${RUN_ID}`,
  }, `bolivia-decimals-${name}-${RUN_ID}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, "us-central1");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return {app, auth, db, functions};
}

async function authenticate(client, label) {
  const credential = await createUserWithEmailAndPassword(
    client.auth,
    `bolivia-decimals-${label}-${RUN_ID}@example.test`,
    `BoliviaDecimals-${RUN_ID}-Pass!`
  );
  client.uid = credential.user.uid;
  return client;
}

const call = (client, name) => httpsCallable(client.functions, name);
const requestId = (prefix) => `${prefix}-${RUN_ID}-${Math.random().toString(36).slice(2, 10)}`;

async function expectDenied(label, operation) {
  try {
    await operation();
  } catch (error) {
    assert.match(String(error?.code || ""), /permission-denied/);
    console.log(`OK reglas: ${label}`);
    return;
  }
  throw new Error(`Se esperaba denegación: ${label}`);
}

async function expectCallableError(label, operation, expected) {
  try {
    await operation();
  } catch (error) {
    assert.ok(expected.some((code) => String(error?.code || "").includes(code)), `${label}: ${error?.code} ${error?.message}`);
    console.log(`OK rechazo: ${label}`);
    return;
  }
  throw new Error(`Se esperaba rechazo: ${label}`);
}

const owners = {
  BO: await authenticate(createClient("owner-bo"), "owner-bo"),
  CL: await authenticate(createClient("owner-cl"), "owner-cl"),
};
const technician = await authenticate(createClient("technician"), "technician");
const clients = [owners.BO, owners.CL, technician];
const adminApp = initializeAdminApp({projectId: PROJECT_ID}, `bolivia-decimals-admin-${RUN_ID}`);
const adminDb = getAdminFirestore(adminApp);

// Cada país: el negocio, su moneda, los precios del ejemplo y lo que esperamos.
const COUNTRIES = {
  BO: {
    label: "Bolivia (BOB)", country: "BO", region: "LP", currency: "BOB", taxId: "NIT", taxValue: "1020304050", rate: 0.13, decimals: 2,
    price: 3.5, serviceCost: 50, averageCost: 2, receptionCost: 3.45,
    quote: {subtotal: 10.5, neto: 10.5, iva: 1.37, total: 11.87},
    order: {subtotal: 10.5, neto: 10.5, iva: 1.37, total: 11.87},
    saleCost: 6, purchaseNeto: 10.35, stockValue: 50.35, otTotal: 60.5, movement: 10.5,
  },
  CL: {
    label: "Chile (CLP)", country: "CL", region: "13", currency: "CLP", taxId: "RUT", taxValue: "76.100.100-1", rate: 0.19, decimals: 0,
    price: 3500, serviceCost: 50000, averageCost: 2000, receptionCost: 3450,
    quote: {subtotal: 10500, neto: 10500, iva: 1995, total: 12495},
    order: {subtotal: 10500, neto: 10500, iva: 1995, total: 12495},
    saleCost: 6000, purchaseNeto: 10350, stockValue: 50350, otTotal: 60500, movement: 125000,
  },
};
const MONEY_COLLECTIONS = ["cotizaciones", "ventas", "ordenesCompra", "recepciones", "compras", "ordenesTrabajo"];

async function createBusiness(spec) {
  const owner = owners[spec.country];
  const created = await call(owner, "createFirstBusiness")({
    nombreComercial: `Negocio decimales ${spec.country}`,
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    ...(spec.country === "CL" ? {} : {paisCodigo: spec.country}),
    regionCodigo: spec.region,
    requestId: requestId(`business-${spec.country}`),
  });
  const businessId = created.data.business.id;
  const stored = (await adminDb.doc(`negocios/${businessId}`).get()).data();
  assert.equal(stored.monedaCodigo, spec.currency, `${spec.label}: moneda del negocio`);
  await Promise.all([
    adminDb.doc(`negocios/${businessId}`).set({
      identificadorFiscalTipo: spec.taxId,
      identificadorFiscalValor: spec.taxValue,
      modulosHabilitados: ["taller"],
      verificacionEmpresa: {estado: "VERIFICADA", identificadorFiscalTipo: spec.taxId, identificadorFiscalValor: spec.taxValue},
    }, {merge: true}),
    adminDb.doc(`negocios/${businessId}/empresa/perfil`).set({
      negocioId: businessId,
      nombreComercial: `Empresa ${spec.country}`,
      razonSocial: `Empresa ${spec.country} SpA`,
      identificadorFiscalTipo: spec.taxId,
      identificadorFiscalValor: spec.taxValue,
      email: `empresa-${spec.country.toLowerCase()}@example.test`,
      direccion: "Dirección de prueba 100",
    }, {merge: true}),
    adminDb.doc(`membresias/${businessId}__${technician.uid}`).set({
      negocioId: businessId, uid: technician.uid, rol: "TECNICO", estado: "activo",
    }),
  ]);
  return businessId;
}

async function seedBusiness(spec, businessId) {
  const inventoryItem = (itemId, tipoItem, nombre, extra = {}) => ({
    itemId, negocioId: businessId, estado: "activo", tipoItem, nombre, codigoInterno: itemId.toUpperCase(),
    unidad: tipoItem === "producto" ? "unidad" : "servicio", ...extra,
  });
  const stocked = (itemId, nombre, price) => inventoryItem(itemId, "producto", nombre, {
    precioInterno: price, costoBase: spec.averageCost, costoPromedio: spec.averageCost, costoPromedioMoneda: spec.currency, stock: 20,
  });
  await Promise.all([
    adminDb.doc(`negocios/${businessId}/clientes/cliente-1`).set({
      clienteId: "cliente-1", negocioId: businessId, estado: "activo", tipoCliente: "empresa", paisCodigo: spec.country,
      identificadorFiscalTipo: spec.taxId, identificadorFiscalValor: spec.taxValue,
      rut: spec.taxValue, nombreRazonSocial: "Cliente de prueba", email: "cliente@example.test",
    }),
    adminDb.doc(`negocios/${businessId}/vehiculos/vehiculo-1`).set({
      vehiculoId: "vehiculo-1", negocioId: businessId, clienteId: "cliente-1", patente: "ABCD12", vin: null,
      marca: "Toyota", modelo: "Corolla", anio: 2020, color: "Blanco", tipo: "sedan",
    }),
    adminDb.doc(`negocios/${businessId}/proveedores/proveedor-1`).set({
      proveedorId: "proveedor-1", negocioId: businessId, estado: "activo", rut: "12.345.678-5",
      razonSocial: "Proveedor de prueba SpA", email: "proveedor@example.test", direccion: "Dirección proveedor 100",
      condicionesPago: "contado", diasCredito: 0,
    }),
    adminDb.doc(`negocios/${businessId}/inventario/producto-venta`).set(stocked("producto-venta", "Repuesto para venta", spec.price)),
    adminDb.doc(`negocios/${businessId}/inventario/producto-compra`).set(stocked("producto-compra", "Repuesto para compra", spec.price)),
    adminDb.doc(`negocios/${businessId}/inventario/producto-ot`).set(stocked("producto-ot", "Repuesto para OT", spec.price)),
    adminDb.doc(`negocios/${businessId}/inventario/servicio-ot`).set(inventoryItem("servicio-ot", "servicio", "Servicio de taller", {
      precioInterno: spec.serviceCost, costoBase: spec.serviceCost / 2,
    })),
  ]);
}

function quotePayload(spec) {
  return {
    clienteId: "cliente-1",
    estado: "borrador",
    validezDias: 10,
    afectaIva: true,
    cliente: {clienteId: "cliente-1", nombreRazonSocial: "NOMBRE MANIPULADO", empresa: "NOMBRE MANIPULADO", rut: "1-9", email: "manipulado@example.test"},
    clienteNombre: "NOMBRE MANIPULADO",
    clienteRut: "1-9",
    clienteEmail: "manipulado@example.test",
    proyectoNombre: "Venta de repuestos",
    empresa: {nombreComercial: "Local", rut: "77.091.679-8", responsable: "Responsable", validezCotizacionDias: 10},
    items: [{
      lineaId: "linea-1",
      itemId: "producto-venta",
      codigo: "PRODUCTO-VENTA",
      nombre: "Repuesto para venta",
      descripcionComercial: "Repuesto",
      tipoItem: "producto",
      unidad: "unidad",
      cantidad: 3,
      precioSugerido: spec.price,
      precioUnitarioEditable: spec.price,
      descuentoPorcentaje: 0,
      inventarioSnapshot: {
        inventarioId: "producto-venta", codigoInterno: "PRODUCTO-VENTA", nombre: "Repuesto para venta",
        tipoItem: "producto", unidad: "unidad", modeloInventarioVersion: 2,
      },
    }],
    descuento: 0,
    seccionesAlcance: [{id: "productos", titulo: "Productos", lineas: ["Repuesto."]}],
    condiciones: {formaPago: "Contado", plazoEntrega: "Inmediata"},
    aceptacion: {habilitada: true, texto: "Acepto los términos."},
  };
}

const totalsOf = (document) => ({subtotal: document.subtotal, neto: document.neto, iva: document.iva, total: document.total});
const cents = (value) => Math.round(value * 100);

async function runFlow(spec) {
  const owner = owners[spec.country];
  const businessId = await createBusiness(spec);
  await seedBusiness(spec, businessId);
  const base = `negocios/${businessId}`;
  const expectDecimals = (document, label) => {
    if (spec.decimals > 0) assert.equal(document.montoDecimales, spec.decimals, `${spec.label}: ${label} guarda montoDecimales ${spec.decimals}`);
    else assert.equal(Object.hasOwn(document, "montoDecimales"), false, `${spec.label}: ${label} no gana montoDecimales`);
  };

  // --- Cotización → venta ---
  const createdQuote = await call(owner, "createQuoteWithNumber")({businessId, requestId: requestId("quote"), quote: quotePayload(spec)});
  const quoteId = createdQuote.data.quote.id;
  let quote = (await adminDb.doc(`${base}/cotizaciones/${quoteId}`).get()).data();
  expectDecimals(quote, "la cotización");
  assert.equal(quote.tasaIva, spec.rate, `${spec.label}: tasa de IVA del país`);
  assert.deepEqual(totalsOf(quote), spec.quote, `${spec.label}: totales de la cotización`);
  await call(owner, "transitionQuoteStatus")({businessId, quoteId, estado: "emitida", requestId: requestId("quote-emit")});
  const accepted = await call(owner, "transitionQuoteStatus")({businessId, quoteId, estado: "aceptada", requestId: requestId("quote-accept")});
  let saleId = accepted.data.quoteStatus?.ventaId;
  if (!saleId) saleId = (await call(owner, "crearVentaDesdeCotizacion")({businessId, cotizacionId: quoteId, requestId: requestId("quote-sale")})).data.venta.id;
  const sale = (await adminDb.doc(`${base}/ventas/${saleId}`).get()).data();
  expectDecimals(sale, "la venta");
  assert.equal(sale.estado, "confirmada");
  assert.deepEqual(totalsOf(sale), spec.quote, `${spec.label}: la venta hereda los totales de la cotización`);
  assert.equal(sale.efectosInventario[0].costoTotal, spec.saleCost, `${spec.label}: costo histórico de la venta`);
  console.log(`OK ${spec.label}: cotización → venta (3 × ${spec.price}: ${JSON.stringify(spec.quote)})`);

  // --- Orden de compra → recepción → compra (costos en centavos) ---
  const createdOrder = await call(owner, "crearOrdenCompra")({
    businessId,
    requestId: requestId("order"),
    ordenCompra: {
      proveedorId: "proveedor-1",
      fechaEntregaEstimada: "2026-12-10",
      direccionEntrega: "Bodega central 123",
      condicionesPago: "Contado",
      observaciones: "",
      items: [{lineaId: "linea-1", itemId: "producto-compra", cantidad: 3, costoUnitario: spec.price, descuentoPct: 0}],
    },
  });
  const orderId = createdOrder.data.ordenCompra.id;
  let order = (await adminDb.doc(`${base}/ordenesCompra/${orderId}`).get()).data();
  expectDecimals(order, "la orden de compra");
  assert.deepEqual(totalsOf(order), spec.order, `${spec.label}: totales de la orden`);
  await call(owner, "emitirOrdenCompra")({businessId, ordenCompraId: orderId, canalEmision: "manual"});
  const reception = await call(owner, "crearRecepcionDesdeOrden")({businessId, ordenCompraId: orderId, requestId: requestId("reception")});
  const receptionId = reception.data.recepcion.id;
  expectDecimals((await adminDb.doc(`${base}/recepciones/${receptionId}`).get()).data(), "la recepción");
  await call(owner, "actualizarRecepcionBorrador")({
    businessId,
    recepcionId: receptionId,
    recepcion: {
      fechaRecepcion: "2026-12-12",
      observaciones: "Costo real en centavos",
      items: reception.data.recepcion.items.map((line) => ({lineaId: line.lineaId, cantidad: 3, costoUnitario: spec.receptionCost, descuentoPct: 0})),
    },
  });
  const confirmed = await call(owner, "confirmarRecepcion")({businessId, recepcionId: receptionId, requestId: requestId("reception-confirm")});
  const purchase = (await adminDb.doc(`${base}/compras/${confirmed.data.compra.id}`).get()).data();
  expectDecimals(purchase, "la compra");
  assert.equal(purchase.estado, "confirmada");
  assert.equal(purchase.neto, spec.purchaseNeto, `${spec.label}: neto de la compra con costo ${spec.receptionCost}`);
  assert.equal(cents(purchase.neto) + cents(purchase.iva), cents(purchase.total), `${spec.label}: neto + IVA = total de la compra`);
  const purchasedItem = (await adminDb.doc(`${base}/inventario/producto-compra`).get()).data();
  assert.equal(purchasedItem.stock, 23);
  assert.equal(purchasedItem.valorInventario, spec.stockValue, `${spec.label}: valor de inventario con costos en centavos`);
  assert.equal(purchasedItem.ultimoCosto, spec.receptionCost);
  const acquisition = (await adminDb.collection(`${base}/adquisicionesInventario`).where("recepcionId", "==", receptionId).get()).docs[0].data();
  assert.equal(acquisition.costoInventarioTotal, spec.purchaseNeto);
  console.log(`OK ${spec.label}: orden de compra → recepción → compra (costo ${spec.receptionCost}, inventario ${spec.stockValue})`);

  // --- OT con repuesto, enviada a aprobación ---
  const createdOrderOt = await call(owner, "crearOrdenTrabajo")({businessId, requestId: requestId("ot"), ordenTrabajo: {vehiculoId: "vehiculo-1"}});
  const otId = createdOrderOt.data.ordenTrabajo.otId;
  const otRef = adminDb.doc(`${base}/ordenesTrabajo/${otId}`);
  expectDecimals((await otRef.get()).data(), "la OT recién creada");
  await call(owner, "registrarRecepcionOrdenTrabajo")({
    businessId, otId,
    recepcion: {
      kilometraje: 45210, nivelCombustible: "1/2",
      checklist: {
        carroceriaPintura: "SIN_DANOS_VISIBLES", vidriosEspejos: "SIN_DANOS_VISIBLES", lucesOpticos: "SIN_DANOS_VISIBLES",
        neumaticosLlantas: "SIN_DANOS_VISIBLES", interior: "SIN_DANOS_VISIBLES", tableroIndicadores: "SIN_ALERTAS_VISIBLES",
        encendido: "NO_PROBADO", fugasVisibles: "NO_REVISADO", nivelesVisibles: "SIN_OBSERVACIONES", estadoGeneral: "SIN_OBSERVACIONES",
      },
      accesorios: ["Llave de rueda"], danosObservados: "Ninguno", observaciones: "Sin novedades visibles.",
    },
  });
  const diagnosis = await call(owner, "registrarDiagnostico")({
    businessId, otId, requestId: requestId("diagnosis"),
    diagnostico: {responsableUid: technician.uid, descripcion: "Falla confirmada", observaciones: ""},
  });
  const diagnosisSnapshot = await adminDb.doc(`${base}/ordenesTrabajo/${otId}/diagnosticos/${diagnosis.data.diagnosticoId}`).get();
  await call(owner, "completarDiagnostico")({
    businessId, otId, diagnosticoId: diagnosis.data.diagnosticoId, expectedActualizadoEn: diagnosisSnapshot.data().actualizadoEn.toMillis(),
  });
  const service = await call(technician, "crearServicioOT")({
    businessId, otId, requestId: requestId("service"), servicio: {itemId: "servicio-ot", responsableUid: technician.uid},
  });
  const serviceOtId = service.data.servicioOtId;
  await call(owner, "agregarProductoOT")({
    businessId, otId, servicioOtId: serviceOtId, requestId: requestId("ot-product"), itemId: "producto-ot", cantidad: 3,
  });
  const catalog = await call(owner, "listarCatalogoTaller")({businessId});
  assert.equal(catalog.data.items.find((item) => item.itemId === "producto-ot").precioEfectivo, spec.price, `${spec.label}: precio vigente del catálogo del taller`);
  const orderBeforeSend = (await otRef.get()).data();
  await call(owner, "enviarOTAprobacion")({
    businessId, otId, requestId: requestId("ot-send"), expectedActualizadoEn: orderBeforeSend.actualizadoEn.toMillis(),
  });
  const orderAfterSend = (await otRef.get()).data();
  assert.equal(orderAfterSend.estado, "esperando_aprobacion");
  expectDecimals(orderAfterSend, "la OT enviada a aprobación");
  const frozenService = (await otRef.collection("servicios").doc(serviceOtId).get()).data();
  assert.equal(frozenService.precioUnitario, spec.serviceCost, `${spec.label}: precio del servicio congelado`);
  assert.equal(frozenService.productos[0].precioUnitario, spec.price, `${spec.label}: el repuesto congela ${spec.price} (sin redondear al entero en BOB)`);
  const summary = await call(owner, "obtenerResumenAprobacionOT")({businessId, otId});
  if (spec.decimals > 0) assert.equal(summary.data.montoDecimales, spec.decimals);
  else assert.equal(Object.hasOwn(summary.data, "montoDecimales"), false);
  const productLine = summary.data.alcance[0].productos[0];
  const lineTotal = spec.decimals > 0 ? Math.round(productLine.precioUnitario * productLine.cantidad * 100) / 100 : productLine.precioUnitario * productLine.cantidad;
  assert.equal(spec.serviceCost + lineTotal, spec.otTotal, `${spec.label}: total del alcance de la OT`);
  console.log(`OK ${spec.label}: OT con repuesto a ${spec.price} enviada a aprobación (total ${spec.otTotal})`);

  // --- Movimiento financiero (SDK cliente + reglas) ---
  const movement = {
    modelVersion: 1, businessId, type: "income", status: "paid", amount: spec.movement, date: "2026-12-12", concept: "Cobro de prueba",
    categoryId: "sales", paymentMethodId: "bank_transfer", counterpartyName: "", note: "", reference: "", sourceType: "manual", sourceId: "",
    searchText: "cobro de prueba", createdBy: owner.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
  const movementPath = `${base}/financialMovements/movimiento-${spec.country.toLowerCase()}`;
  await setDoc(doc(owner.db, movementPath), movement);
  assert.equal((await getDoc(doc(owner.db, movementPath))).data().amount, spec.movement, `${spec.label}: el movimiento conserva su monto`);
  await updateDoc(doc(owner.db, movementPath), {amount: spec.movement + 0.5, updatedAt: serverTimestamp()});
  assert.equal((await getDoc(doc(owner.db, movementPath))).data().amount, spec.movement + 0.5, `${spec.label}: las reglas aceptan montos con decimales`);
  await expectDenied(`${spec.label}: monto cero`, () => setDoc(doc(owner.db, `${base}/financialMovements/cero`), {...movement, amount: 0}));
  await expectDenied(`${spec.label}: monto fuera de tope`, () => setDoc(doc(owner.db, `${base}/financialMovements/tope`), {...movement, amount: 9007199254740992}));
  await expectDenied(`${spec.label}: monto no numérico`, () => setDoc(doc(owner.db, `${base}/financialMovements/texto`), {...movement, amount: "10"}));
  console.log(`OK ${spec.label}: movimiento financiero de ${spec.movement}`);

  // --- Qué documentos llevan montoDecimales ---
  for (const collectionName of MONEY_COLLECTIONS) {
    const documents = (await adminDb.collection(`${base}/${collectionName}`).get()).docs;
    assert.ok(documents.length > 0, `${spec.label}: hay documentos en ${collectionName}`);
    documents.forEach((snapshot) => expectDecimals(snapshot.data(), `${collectionName}/${snapshot.id}`));
  }
  console.log(`OK ${spec.label}: ${MONEY_COLLECTIONS.join(", ")} ${spec.decimals > 0 ? `llevan montoDecimales ${spec.decimals}` : "no ganan montoDecimales"}`);
  return businessId;
}

try {
  const boliviaBusinessId = await runFlow(COUNTRIES.BO);
  const chileBusinessId = await runFlow(COUNTRIES.CL);

  // Inventario del negocio BOB: el servidor rechaza 3,505 y acepta 3,50 (la moneda sale del negocio, no del cliente).
  const item = (overrides = {}) => ({tipoItem: "producto", nombre: "Repuesto nuevo", unidad: "unidad", costoBase: 3.5, margenDeseado: 30, precioInterno: 0, stock: 4, stockMinimo: 1, ...overrides});
  await expectCallableError("BOB rechaza costo 3,505", () => call(owners.BO, "createInventoryItemWithCode")({businessId: boliviaBusinessId, requestId: requestId("inventory-bad"), item: item({costoBase: 3.505})}), ["invalid-argument"]);
  const createdItem = await call(owners.BO, "createInventoryItemWithCode")({businessId: boliviaBusinessId, requestId: requestId("inventory-good"), item: item()});
  const storedItem = (await adminDb.doc(`negocios/${boliviaBusinessId}/inventario/${createdItem.data.itemId}`).get()).data();
  assert.equal(storedItem.costoBase, 3.5);
  assert.equal(storedItem.precioInterno, 4.55, "3,50 + 30 % = 4,55");
  const chileItem = await call(owners.CL, "createInventoryItemWithCode")({businessId: chileBusinessId, requestId: requestId("inventory-cl"), item: item({costoBase: 3.505})});
  assert.equal((await adminDb.doc(`negocios/${chileBusinessId}/inventario/${chileItem.data.itemId}`).get()).data().precioInterno, 5, "Chile conserva el redondeo entero");
  console.log("OK inventario: BOB rechaza 3,505 y calcula 4,55; Chile conserva su comportamiento");
  console.log("OK entrega D integrada: Bolivia con 2 decimales de punta a punta y Chile sin montoDecimales");
} finally {
  await Promise.allSettled(clients.map(async (client) => {
    await terminate(client.db);
    await deleteApp(client.app);
  }));
  await deleteAdminApp(adminApp);
}
