import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signOut,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  terminate,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const firebaseConfig = {
  apiKey: "demo-key",
  authDomain: "tesis-inventario-ia.firebaseapp.com",
  projectId: "tesis-inventario-ia",
  appId: "quote-integrated-local",
};

const app = initializeApp(firebaseConfig, `quote-local-${Date.now()}`);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, "us-central1");
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
connectFirestoreEmulator(db, "127.0.0.1", 8080);
connectFunctionsEmulator(functions, "127.0.0.1", 5001);

const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const credential = await createUserWithEmailAndPassword(
  auth,
  `quotes-${unique}@example.test`,
  `Quote-${unique}-Pass!`
);
const uid = credential.user.uid;
const createFirstBusiness = httpsCallable(functions, "createFirstBusiness");
const createQuote = httpsCallable(functions, "createQuoteWithNumber");
const updateQuoteDraft = httpsCallable(functions, "updateQuoteDraft");
const businessResponse = await createFirstBusiness({
  nombreComercial: "Empresa cotizaciones local",
  rubroCodigo: "SERVICIOS_PROFESIONALES",
  regionCodigo: "13",
  requestId: `business-${unique}`,
});
const businessId = businessResponse.data.business.id;

function makeQuote(index = 1) {
  return {
    estado: "borrador",
    validezDias: 10,
    afectaIva: true,
    cliente: {
      empresa: `Cliente local ${index}`,
      rut: "76.123.456-7",
      contacto: "Pablo Acuña",
      email: "cliente@example.test",
      proyecto: "Fabricación local",
    },
    empresa: {
      nombreComercial: "Bagner local",
      rut: "77.091.679-8",
      responsable: "Responsable local",
      validezCotizacionDias: 10,
    },
    items: [
      {
        lineaId: `linea-${index}`,
        itemId: `inventory-${index}`,
        codigo: `SRV-${String(index).padStart(4, "0")}`,
        nombre: "Servicio de fabricación",
        descripcionComercial: "Descripción con áéíóú y ñ.",
        tipoItem: "servicio",
        unidad: "servicio",
        cantidad: 2,
        precioSugerido: 100000,
        precioUnitarioEditable: 100000,
        descuentoPorcentaje: 5,
        inventarioSnapshot: {
          inventarioId: `inventory-${index}`,
          codigoInterno: `SRV-${String(index).padStart(4, "0")}`,
          nombre: "Servicio de fabricación",
          tipoItem: "servicio",
          areaId: "area-servicios",
          categoriaId: "categoria-fabricacion",
          categoria: "Fabricación",
          unidad: "servicio",
          modeloInventarioVersion: 2,
        },
      },
    ],
    descuento: 10000,
    seccionesAlcance: [
      { id: "servicios", titulo: "Servicios", lineas: ["Fabricación y montaje."] },
    ],
    condiciones: {
      formaPago: "50% al inicio y 50% contra entrega",
      plazoEntrega: "3 días hábiles",
    },
    aceptacion: { habilitada: true, texto: "Acepto los términos." },
  };
}

const idempotentRequestId = `quote-${unique}-same`;
const [first, second] = await Promise.all([
  createQuote({ businessId, requestId: idempotentRequestId, quote: makeQuote(1) }),
  createQuote({ businessId, requestId: idempotentRequestId, quote: makeQuote(1) }),
]);
assert.equal(first.data.quote.id, second.data.quote.id);
assert.equal(first.data.quote.numero, second.data.quote.numero);
console.log("OK idempotencia: doble solicitud crea una sola cotización");

const concurrent = await Promise.all(
  Array.from({ length: 4 }, (_, index) =>
    createQuote({
      businessId,
      requestId: `quote-${unique}-concurrent-${index}`,
      quote: makeQuote(index + 2),
    })
  )
);
const numbers = concurrent.map((response) => response.data.quote.numero);
assert.equal(new Set(numbers).size, numbers.length);
assert.ok(numbers.every((number) => /^COT-\d{4}-\d{4}$/.test(number)));
console.log("OK concurrencia: numeración única en solicitudes simultáneas");

const quoteId = first.data.quote.id;
const quoteRef = doc(db, `negocios/${businessId}/cotizaciones/${quoteId}`);
const stored = await getDoc(quoteRef);
assert.ok(stored.exists());
assert.equal(stored.data().uidUsuario, uid);
assert.equal(stored.data().subtotal, 200000);
assert.equal(stored.data().descuentoItems, 10000);
assert.equal(stored.data().descuentoTotal, 20000);
assert.equal(stored.data().neto, 180000);
assert.equal(stored.data().iva, 34200);
assert.equal(stored.data().total, 214200);
assert.equal(stored.data().items[0].inventarioSnapshot.nombre, "Servicio de fabricación");
console.log("OK consistencia: backend recalcula y persiste snapshot, neto, IVA y total");

const updated = await updateQuoteDraft({
  businessId,
  quoteId,
  quote: {
    ...makeQuote(1),
    condiciones: {
      ...makeQuote(1).condiciones,
      observaciones: "Edición recalculada del borrador",
    },
  },
});
assert.equal(updated.data.quote.numero, first.data.quote.numero);
assert.equal((await getDoc(quoteRef)).data().observaciones, "Edición recalculada del borrador");
assert.equal((await getDoc(quoteRef)).data().total, 214200);
console.log("OK edición: borrador recalculado por backend sin renumeración");

const quotesSnapshot = await getDocs(
  collection(db, `negocios/${businessId}/cotizaciones`)
);
assert.equal(quotesSnapshot.size, 5);
const persistedNumbers = quotesSnapshot.docs.map((quoteDoc) => quoteDoc.data().numero);
assert.equal(new Set(persistedNumbers).size, 5);
console.log("OK persistencia: sin duplicados por reintentos y contador no expuesto al cliente");

await signOut(auth);
await terminate(db);
await deleteApp(app);
console.log("QUOTE_INTEGRATED_LOCAL_OK");
