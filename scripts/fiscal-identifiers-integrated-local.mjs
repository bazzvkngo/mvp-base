import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, createUserWithEmailAndPassword, getAuth} from "firebase/auth";
import {connectFunctionsEmulator, getFunctions, httpsCallable} from "firebase/functions";

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const {deleteApp: deleteAdminApp, initializeApp: initializeAdminApp} = requireFromFunctions("firebase-admin/app");
const {getFirestore} = requireFromFunctions("firebase-admin/firestore");

async function user(label) {
  const app = initializeApp({apiKey: "demo-key", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID, appId: `fiscal-${label}-${RUN_ID}`}, `fiscal-${label}-${RUN_ID}`);
  const auth = getAuth(app); const functions = getFunctions(app, "us-central1");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  const credential = await createUserWithEmailAndPassword(auth, `fiscal-${label}-${RUN_ID}@example.test`, `Fiscal-${RUN_ID}-Pass!`);
  return {app, functions, uid: credential.user.uid};
}

const call = (client, name) => httpsCallable(client.functions, name);
const requestId = (label) => `fiscal-${label}-${RUN_ID}`;
// La validación de teléfono (functions/contactFormatting.js) exige formato
// nacional chileno cuando el NEGOCIO OPERADOR (no el país fiscal del
// cliente/proveedor) es "CL" — countryCode se deriva de
// context.businessSnapshot.data().paisCodigo en crearCliente/crearProveedor
// (functions/clientPersistence.js:359, functions/providerPersistence.js
// equivalente). El fixture debe enviar un teléfono chileno sólo para las
// llamadas dirigidas a un negocio "CL"; el resto usa el formato
// internacional genérico ya aceptado.
const CHILEAN_PHONE = "+56 9 6123 4587";
const GENERIC_PHONE = "+591 70000000";
const customer = (value, country = "OTHER", name = "Cliente fiscal", telefono = GENERIC_PHONE) => ({tipoCliente: "empresa", paisCodigo: country, identificadorFiscalTipo: "FALSO", identificadorFiscalValor: value, nombreRazonSocial: name, giro: "Servicios", email: "fiscal@example.test", telefono, direccion: "Dirección fiscal", regionCodigo: "", regionNombre: "Departamento", comunaCodigo: "", comunaNombre: "Municipio", personaContacto: "Contacto", notas: ""});
const provider = (value, country = "OTHER", name = "Proveedor fiscal", telefono = GENERIC_PHONE) => ({paisCodigo: country, identificadorFiscalTipo: "FALSO", identificadorFiscalValor: value, razonSocial: name, nombreFantasia: "", giro: "Suministros", personaContacto: "Contacto", email: "proveedor@example.test", telefono, direccion: "Dirección fiscal", regionCodigo: "", regionNombre: "Departamento", comunaCodigo: "", comunaNombre: "Municipio", condicionesPago: "transferencia", diasCredito: 0, notas: ""});

async function rejected(label, operation, codes) {
  try { await operation(); } catch (error) {
    assert.ok(codes.some((code) => String(error?.code || "").includes(code)), `${label}: ${error?.code}`);
    return;
  }
  throw new Error(`Se esperaba rechazo: ${label}`);
}

const clients = await Promise.all(["cl", "bo", "bo2", "br", "pe"].map(user));
const [cl, bo, bo2, br, pe] = clients;
const adminApp = initializeAdminApp({projectId: PROJECT_ID}, `fiscal-admin-${RUN_ID}`);
const db = getFirestore(adminApp);

async function seedBusiness(client, country, currency) {
  const businessId = `fiscal-${country.toLowerCase()}-${client.uid.slice(0, 8)}-${RUN_ID}`;
  const writes = [
    db.doc(`negocios/${businessId}`).set({negocioId: businessId, nombreComercial: `Negocio ${country}`, paisCodigo: country, monedaCodigo: currency, estado: "activo", verificacionEmpresa: {estado: "VERIFICADA"}}),
    db.doc(`membresias/${businessId}__${client.uid}`).set({negocioId: businessId, uid: client.uid, rol: "OWNER", estado: "activo"}),
  ];
  if (country === "BR") {
    writes.push(db.doc(`negocios/${businessId}/configuracion/impuestos`).set({
      negocioId: businessId,
      impuestoPredeterminadoId: "TRIBUTO_QA",
      impuestoPredeterminadoNombre: "Tributo configurado QA",
      impuestoPredeterminadoTasa: 0,
      configuracionTributariaBaseCompleta: true,
    }));
  }
  await Promise.all(writes);
  return businessId;
}

try {
  const [clBusiness, boBusiness, bo2Business, brBusiness, peBusiness] = await Promise.all([
    seedBusiness(cl, "CL", "CLP"), seedBusiness(bo, "BO", "USD"), seedBusiness(bo2, "BO", "BOB"), seedBusiness(br, "BR", "BRL"), seedBusiness(pe, "PE", "PEN"),
  ]);

  const clCreated = await call(cl, "crearCliente")({businessId: clBusiness, cliente: customer("12.345.678-5", "BO", "Cliente CL", CHILEAN_PHONE)});
  assert.equal(clCreated.data.cliente.identificadorFiscalTipo, "RUT");
  await rejected("RUT chileno inválido", () => call(cl, "crearCliente")({businessId: clBusiness, cliente: customer("12.345.678-4", "BO", "Cliente fiscal", CHILEAN_PHONE)}), ["invalid-argument"]);

  const boCreated = await call(bo, "crearCliente")({businessId: boBusiness, cliente: customer("12-34567", "CL", "Cliente BO USD")});
  const boId = boCreated.data.cliente.clienteId;
  const boStored = (await db.doc(`negocios/${boBusiness}/clientes/${boId}`).get()).data();
  assert.equal(boStored.paisCodigo, "BO"); assert.equal(boStored.identificadorFiscalTipo, "NIT"); assert.equal(boStored.identificadorFiscalNormalizado, "1234567");
  assert.equal(Object.hasOwn(boStored, "rut"), false); assert.equal(Object.hasOwn(boStored, "rutNormalizado"), false);
  await rejected("NIT duplicado normalizado", () => call(bo, "crearCliente")({businessId: boBusiness, cliente: customer("1234567", "PE", "Duplicado")}), ["already-exists"]);
  const boOther = await call(bo2, "crearCliente")({businessId: bo2Business, cliente: customer("1234567", "CL", "Mismo NIT otra empresa")});
  assert.ok(boOther.data.cliente.clienteId);

  const brClient = await call(br, "crearCliente")({businessId: brBusiness, cliente: customer("529.982.247-25", "CL", "Cliente CPF")});
  assert.equal(brClient.data.cliente.identificadorFiscalTipo, "CPF");
  const brProvider = await call(br, "crearProveedor")({businessId: brBusiness, requestId: requestId("br-provider"), proveedor: provider("11.222.333/0001-81", "CL", "Proveedor CNPJ")});
  assert.equal(brProvider.data.proveedor.identificadorFiscalTipo, "CNPJ");
  const peProvider = await call(pe, "crearProveedor")({businessId: peBusiness, requestId: requestId("pe-provider"), proveedor: provider("20100070970", "CL", "Proveedor PE")});
  assert.equal(peProvider.data.proveedor.identificadorFiscalTipo, "RUC");

  const legacyClientId = `legacy-client-${RUN_ID}`; const legacyClientRut = "6.000.000-K"; const legacyClientKey = "6000000K";
  await Promise.all([
    db.doc(`negocios/${clBusiness}/clientes/${legacyClientId}`).set({clienteId: legacyClientId, negocioId: clBusiness, modeloClienteVersion: 1, tipoCliente: "persona", rut: legacyClientRut, rutNormalizado: "6000000-K", nombreRazonSocial: "Cliente legacy", estado: "activo"}),
    db.doc(`negocios/${clBusiness}/clientRutKeys/${legacyClientKey}`).set({negocioId: clBusiness, clienteId: legacyClientId, rutNormalizado: "6000000-K", estadoCliente: "activo"}),
  ]);
  await call(cl, "archivarCliente")({businessId: clBusiness, clienteId: legacyClientId});
  await call(cl, "reactivarCliente")({businessId: clBusiness, clienteId: legacyClientId});

  const legacyProviderId = `legacy-provider-${RUN_ID}`; const legacyProviderKey = "70000008";
  await Promise.all([
    db.doc(`negocios/${clBusiness}/proveedores/${legacyProviderId}`).set({proveedorId: legacyProviderId, negocioId: clBusiness, modeloProveedorVersion: 1, rut: "7.000.000-8", rutNormalizado: "7000000-8", razonSocial: "Proveedor legacy", estado: "activo"}),
    db.doc(`negocios/${clBusiness}/providerRutKeys/${legacyProviderKey}`).set({negocioId: clBusiness, proveedorId: legacyProviderId, rutNormalizado: "7000000-8", estadoProveedor: "activo"}),
  ]);
  await call(cl, "archivarProveedor")({businessId: clBusiness, proveedorId: legacyProviderId});
  await call(cl, "reactivarProveedor")({businessId: clBusiness, proveedorId: legacyProviderId});
  console.log("FISCAL_IDENTIFIERS_INTEGRATED_OK");
} finally {
  await Promise.all(clients.map((client) => deleteApp(client.app)));
  await deleteAdminApp(adminApp);
}
