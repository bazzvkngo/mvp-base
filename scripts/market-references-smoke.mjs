import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signOut,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const require = createRequire(import.meta.url);
const {
  GENERIC_QUERY_WARNING,
  MARKET_REFERENCE_CACHE_TTL_MS,
  buildInventoryMarketQuery,
  normalizeSerperShoppingResults,
  summarizeMarketResults,
} = require("../functions/marketReferences.js");

// --- Pruebas puras (sin emulador): armado de consulta y normalización ---

assert.deepEqual(
  buildInventoryMarketQuery({nombre: "Taladro", marca: "Marca Demo", modelo: "X20"}),
  {query: "Marca Demo X20", confidence: "HIGH", warnings: []}
);
assert.deepEqual(
  buildInventoryMarketQuery({nombre: "Taladro inalámbrico"}),
  {query: "Taladro inalámbrico", confidence: "LOW", warnings: [GENERIC_QUERY_WARNING]}
);
console.log("OK referencias de mercado: consulta determinista y advertencia para producto genérico");

const fixture = {
  shopping: [
    {title: "Producto demo A", source: "Tienda Uno", link: "https://uno.example/a", price: "$90.000", productId: "a"},
    {title: "Producto demo B", source: "Tienda Dos", link: "https://dos.example/b", extractedPrice: 100000, productId: "b"},
    {title: "Producto demo C", source: "Tienda Tres", link: "https://tres.example/c", price: "CLP 130.000", productId: "c"},
    {title: "Sin enlace", price: "$80.000"},
  ],
};
const parsedResults = normalizeSerperShoppingResults(fixture, {
  checkedAt: "2026-08-28T12:00:00.000Z",
  defaultCurrency: "CLP",
});
assert.equal(parsedResults.length, 3);
assert.deepEqual(summarizeMarketResults(parsedResults, "CLP"), {
  count: 3,
  currency: "CLP",
  min: 90000,
  median: 100000,
  max: 130000,
});
assert.equal(summarizeMarketResults([], "CLP"), null);
console.log("OK referencias de mercado: normalización y resumen de precios");

// --- Pruebas integradas (Emulator Suite): membresía, cache y TTL ---

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = Date.now().toString(36);
const emulatorEndpoint = (environmentName, fallbackPort) => {
  const [host = "127.0.0.1", port = fallbackPort] = String(
    process.env[environmentName] || `127.0.0.1:${fallbackPort}`
  ).split(":");
  return {host, port: Number(port)};
};
const authEmulator = emulatorEndpoint("FIREBASE_AUTH_EMULATOR_HOST", 9099);
const firestoreEmulator = emulatorEndpoint("FIRESTORE_EMULATOR_HOST", 8080);
const functionsEmulator = emulatorEndpoint("FUNCTIONS_EMULATOR_HOST", 5001);
const requireFromFunctions = createRequire(
  new URL("../functions/package.json", import.meta.url)
);
const {
  deleteApp: deleteAdminApp,
  initializeApp: initializeAdminApp,
} = requireFromFunctions("firebase-admin/app");
const { Timestamp, getFirestore: getAdminFirestore } = requireFromFunctions(
  "firebase-admin/firestore"
);

const baseBusiness = Object.freeze({
  rubroCodigo: "INGENIERIA_CONSULTORIA",
  regionCodigo: "13",
});

function createClient(name) {
  const app = initializeApp(
    {
      apiKey: "demo-key",
      appId: `demo-${name}-${RUN_ID}`,
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
    },
    `${name}-${RUN_ID}`
  );
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, "us-central1");
  connectAuthEmulator(auth, `http://${authEmulator.host}:${authEmulator.port}`, {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, firestoreEmulator.host, firestoreEmulator.port);
  connectFunctionsEmulator(functions, functionsEmulator.host, functionsEmulator.port);
  return { app, auth, db, functions };
}

async function createAccount(client, label) {
  return createUserWithEmailAndPassword(
    client.auth,
    `${label}-${RUN_ID}@example.test`,
    "test-password-123"
  );
}

function callable(client, name, data = {}) {
  return httpsCallable(client.functions, name)(data);
}

async function expectCallableCode(code, operation) {
  await assert.rejects(operation, (error) =>
    String(error?.code || "").includes(code)
  );
}

async function main() {
  const owner = createClient("market-ref-owner");
  const outsider = createClient("market-ref-outsider");
  const adminApp = initializeAdminApp({ projectId: PROJECT_ID }, `market-ref-admin-${RUN_ID}`);
  const adminDb = getAdminFirestore(adminApp);

  try {
    const [ownerCredential, outsiderCredential] = await Promise.all([
      createAccount(owner, "market-ref-owner"),
      createAccount(outsider, "market-ref-outsider"),
    ]);
    const ownerUid = ownerCredential.user.uid;
    const outsiderUid = outsiderCredential.user.uid;

    const business = await callable(owner, "createFirstBusiness", {
      ...baseBusiness,
      nombreComercial: "Referencias de mercado",
      requestId: `market_ref_business_${RUN_ID}`,
    });
    const businessId = business.data.business.id;

    const otherBusiness = await callable(outsider, "createFirstBusiness", {
      ...baseBusiness,
      nombreComercial: "Otro negocio",
      requestId: `market_ref_other_business_${RUN_ID}`,
    });
    const otherBusinessId = otherBusiness.data.business.id;

    await Promise.all(
      [businessId, otherBusinessId].map((id) =>
        adminDb.doc(`negocios/${id}`).set(
          {
            identificadorFiscalTipo: "RUT",
            identificadorFiscalValor: "76.600.600-6",
            verificacionEmpresa: {
              estado: "VERIFICADA",
              identificadorFiscalTipo: "RUT",
              identificadorFiscalValor: "76.600.600-6",
            },
          },
          { merge: true }
        )
      )
    );

    const itemId = "item-market-ref";
    await adminDb.doc(`negocios/${businessId}/inventario/${itemId}`).set({
      negocioId: businessId,
      nombre: "Taladro inalámbrico",
      marca: "Marca Demo",
      modelo: "X20",
      tipoItem: "producto",
      estado: "activo",
      precioInterno: 95000,
    });
    const serviceItemId = "item-market-ref-service";
    await adminDb.doc(`negocios/${businessId}/inventario/${serviceItemId}`).set({
      negocioId: businessId,
      nombre: "Instalación eléctrica",
      tipoItem: "servicio",
      estado: "activo",
    });

    await expectCallableCode("permission-denied", () =>
      callable(outsider, "searchInventoryMarketReferences", { businessId, itemId })
    );
    console.log("OK referencias de mercado: rechazo sin membresía activa en el negocio");

    await expectCallableCode("not-found", () =>
      callable(owner, "searchInventoryMarketReferences", { businessId, itemId: "item-inexistente" })
    );
    await expectCallableCode("not-found", () =>
      callable(outsider, "searchInventoryMarketReferences", { businessId: otherBusinessId, itemId })
    );
    console.log("OK referencias de mercado: rechazo de itemId inexistente o de otro negocio");

    await expectCallableCode("failed-precondition", () =>
      callable(owner, "searchInventoryMarketReferences", { businessId, itemId: serviceItemId })
    );
    console.log("OK referencias de mercado: rechazo para ítems que no son producto");

    const firstSearch = await callable(owner, "searchInventoryMarketReferences", { businessId, itemId });
    assert.equal(firstSearch.data.cached, false);
    assert.ok(firstSearch.data.results.length > 0);
    assert.ok(firstSearch.data.summary);
    assert.equal(firstSearch.data.item.internalPrice, 95000);
    const cacheDocPath = `negocios/${businessId}/referenciasPrecios/${itemId}`;
    const cacheAfterFirstSearch = await adminDb.doc(cacheDocPath).get();
    assert.ok(cacheAfterFirstSearch.exists, "la Function debe escribir el cache tras consultar Serper");
    console.log("OK referencias de mercado: primera búsqueda consulta el proveedor y guarda cache");

    const secondSearch = await callable(owner, "searchInventoryMarketReferences", { businessId, itemId });
    assert.equal(secondSearch.data.cached, true);
    assert.deepEqual(secondSearch.data.results, firstSearch.data.results);
    console.log("OK referencias de mercado: usa cache vigente sin volver a consultar Serper");

    const forcedSearch = await callable(owner, "searchInventoryMarketReferences", {
      businessId,
      itemId,
      forceRefresh: true,
    });
    assert.equal(forcedSearch.data.cached, false);
    console.log("OK referencias de mercado: forceRefresh salta el cache vigente");

    const expiredMillis = Date.now() - (MARKET_REFERENCE_CACHE_TTL_MS + 60 * 1000);
    await adminDb.doc(cacheDocPath).update({
      actualizadoEn: Timestamp.fromMillis(expiredMillis),
    });
    const searchAfterExpiry = await callable(owner, "searchInventoryMarketReferences", { businessId, itemId });
    assert.equal(searchAfterExpiry.data.cached, false);
    const cacheAfterExpiry = await adminDb.doc(cacheDocPath).get();
    assert.ok(cacheAfterExpiry.data().actualizadoEn.toMillis() > expiredMillis);
    console.log("OK referencias de mercado: refresca automáticamente cuando el cache expiró (TTL 24h)");

    await adminDb.doc(`membresias/${businessId}__${outsiderUid}`).set({
      negocioId: businessId,
      uid: outsiderUid,
      rol: "TECNICO",
      estado: "activo",
    });
    const technicianSearch = await callable(outsider, "searchInventoryMarketReferences", { businessId, itemId });
    assert.equal(technicianSearch.data.cached, true);
    console.log("OK referencias de mercado: sin restricción de rol, cualquier miembro activo puede consultar");

    console.log("MARKET_REFERENCES_SMOKE_OK");
  } finally {
    await Promise.all(
      [owner, outsider].map((client) =>
        client.auth.currentUser ? signOut(client.auth) : Promise.resolve()
      )
    );
    await Promise.all([
      deleteApp(owner.app),
      deleteApp(outsider.app),
      deleteAdminApp(adminApp),
    ]);
  }
}

main().catch((error) => {
  console.error(
    "MARKET_REFERENCES_SMOKE_FAILED",
    error?.code || "",
    error?.message || error
  );
  process.exitCode = 1;
});
