import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
  signOut,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const PROJECT_ID = "tesis-inventario-ia";
const TEST_UID_PREFIX = "inventory-integrated";
const requireFromFunctions = createRequire(
  new URL("../functions/package.json", import.meta.url)
);
const {
  deleteApp: deleteAdminApp,
  initializeApp: initializeAdminApp,
} = requireFromFunctions("firebase-admin/app");
const { getFirestore: getAdminFirestore } = requireFromFunctions(
  "firebase-admin/firestore"
);

let activeBusinessId = "";

function collectionRef(db, uid, name) {
  return collection(db, "negocios", activeBusinessId || uid, name);
}

async function expectCallableCode(expectedCode, operation) {
  await assert.rejects(operation, (error) =>
    String(error?.code || "").includes(expectedCode)
  );
}

async function main() {
  const app = initializeApp(
    {
      apiKey: "demo-key",
      appId: `demo-${TEST_UID_PREFIX}`,
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
    },
    TEST_UID_PREFIX
  );
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, "us-central1");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);

  const adminApp = initializeAdminApp({ projectId: PROJECT_ID }, TEST_UID_PREFIX);
  const adminDb = getAdminFirestore(adminApp);

  try {
    const credential = await signInAnonymously(auth);
    const uid = credential.user.uid;
    const invoke = (name, data = {}) => httpsCallable(functions, name)(data);
    const businessResponse = await invoke("createFirstBusiness", {
      nombreComercial: "Inventario integrado",
      rubroCodigo: "SERVICIOS_PROFESIONALES",
      regionCodigo: "13",
      requestId: `business_inventory_${uid}`,
    });
    const businessId = businessResponse.data.business.id;
    activeBusinessId = businessId;
    const call = (name, data = {}) =>
      invoke(name, { ...data, businessId });

    const initialReads = await Promise.all([
      getDocs(collectionRef(db, uid, "areas")),
      getDocs(collectionRef(db, uid, "categoriasInventario")),
      getDocs(collectionRef(db, uid, "inventario")),
    ]);
    assert.deepEqual(
      initialReads.map((snapshot) => snapshot.size),
      [0, 0, 0],
      "Consultar Inventario no debe crear documentos."
    );

    await call("initializeInventoryCatalog");
    await call("initializeInventoryCatalog");
    const initialAreas = await getDocs(
      query(collectionRef(db, uid, "areas"), orderBy("nombreNormalizado", "asc"))
    );
    const initialCategories = await getDocs(
      query(
        collectionRef(db, uid, "categoriasInventario"),
        orderBy("nombreNormalizado", "asc")
      )
    );
    assert.equal(initialAreas.size, 4);
    assert.equal(initialCategories.size, 9);
    assert.deepEqual(
      new Set(initialAreas.docs.map((area) => area.data().nombre)),
      new Set([
        "Informática",
        "Sistemas de seguridad",
        "Electricidad",
        "Obra civil",
      ])
    );

    await expectCallableCode("already-exists", () =>
      call("saveInventoryArea", { nombre: "  INFORMATICA  " })
    );
    const manualAreaResponse = await call("saveInventoryArea", {
      nombre: "Telecomunicaciones",
    });
    const manualAreaId = manualAreaResponse.data.areaId;
    await call("saveInventoryArea", {
      areaId: manualAreaId,
      nombre: "Telecom y redes",
      estado: "activo",
    });
    await call("saveInventoryArea", {
      areaId: manualAreaId,
      nombre: "Telecom y redes",
      estado: "inactivo",
    });
    assert.equal(
      (await getDoc(doc(db, "negocios", businessId, "areas", manualAreaId))).data().estado,
      "inactivo"
    );
    await call("saveInventoryArea", {
      areaId: manualAreaId,
      nombre: "Telecom y redes",
      estado: "activo",
    });

    await expectCallableCode("invalid-argument", () =>
      call("saveInventoryCategory", { nombre: "Redes" })
    );
    const categoryId = initialCategories.docs.find(
      (category) => category.data().nombre === "Redes y conectividad"
    )?.id;
    assert.ok(categoryId);
    const categorySnapshot = await getDoc(
      doc(db, "negocios", businessId, "categoriasInventario", categoryId)
    );
    assert.equal(categorySnapshot.data().areaId, "area_informatica");
    await expectCallableCode("already-exists", () =>
      call("saveInventoryCategory", {
        areaId: "area_informatica",
        nombre: "  REDES Y CONECTIVIDAD ",
      })
    );
    await call("saveInventoryCategory", {
      areaId: "area_electricidad",
      nombre: "Redes y conectividad",
    });
    await expectCallableCode("failed-precondition", () =>
      call("saveInventoryCategory", {
        categoriaId: categoryId,
        areaId: "area_electricidad",
        nombre: "Redes trasladadas",
      })
    );
    await call("saveInventoryCategory", {
      categoriaId: categoryId,
      areaId: "area_informatica",
      nombre: "Redes y conectividad",
      estado: "inactivo",
    });
    assert.equal(
      (
        await getDoc(
          doc(db, "negocios", businessId, "categoriasInventario", categoryId)
        )
      ).data().estado,
      "inactivo"
    );
    await call("saveInventoryCategory", {
      categoriaId: categoryId,
      areaId: "area_informatica",
      nombre: "Redes y conectividad",
      estado: "activo",
    });

    const commonItem = {
      areaId: "area_informatica",
      categoriaId: categoryId,
      descripcion: "Prueba integrada local",
      unidad: "unidad",
      costoBase: 10000,
      margenDeseado: 20,
      precioInterno: 12000,
      estado: "activo",
    };
    const serviceResponse = await call("createInventoryItemWithCode", {
      requestId: "integrated_service_0001",
      item: {
        ...commonItem,
        tipoItem: "servicio",
        nombre: "Soporte local integrado",
      },
    });
    const activityResponse = await call("createInventoryItemWithCode", {
      requestId: "integrated_activity_0001",
      item: {
        ...commonItem,
        tipoItem: "actividad",
        nombre: "Levantamiento local integrado",
      },
    });
    const productResponse = await call("createInventoryItemWithCode", {
      requestId: "integrated_product_0001",
      item: {
        ...commonItem,
        tipoItem: "producto",
        nombre: "Router local integrado",
        marca: "Cisco",
        modelo: "ISR 1100",
        stock: 8,
        stockMinimo: 2,
        codigoBarras: "780000000001",
      },
    });
    assert.equal(serviceResponse.data.codigoInterno, "SV-0001");
    assert.equal(activityResponse.data.codigoInterno, "AC-0001");
    assert.equal(productResponse.data.codigoInterno, "PR-0001");

    const serviceData = (
      await getDoc(
        doc(db, "negocios", businessId, "inventario", serviceResponse.data.itemId)
      )
    ).data();
    assert.equal("marca" in serviceData, false);
    assert.equal("stock" in serviceData, false);
    const productData = (
      await getDoc(
        doc(db, "negocios", businessId, "inventario", productResponse.data.itemId)
      )
    ).data();
    assert.equal(productData.marca, "Cisco");
    assert.equal(productData.modelo, "ISR 1100");
    assert.equal(productData.stock, 8);

    await expectCallableCode("invalid-argument", () =>
      call("createInventoryItemWithCode", {
        requestId: "integrated_product_invalid_0001",
        item: {
          ...commonItem,
          tipoItem: "producto",
          nombre: "Producto incompleto",
          marca: "",
          modelo: "",
          stock: -1,
          stockMinimo: 0,
        },
      })
    );
    await expectCallableCode("failed-precondition", () =>
      call("createInventoryItemWithCode", {
        requestId: "integrated_relation_invalid_0001",
        item: {
          ...commonItem,
          tipoItem: "servicio",
          areaId: "area_electricidad",
          nombre: "Relación incompatible",
        },
      })
    );

    const legacyPath = `negocios/${businessId}/inventario/legacy-integrated`;
    await adminDb.doc(legacyPath).set({
      nombre: "Equipo heredado",
      tipoItem: "producto",
      categoria: "Categoría histórica",
      descripcion: "Registro anterior",
      unidad: "unidad",
      costoBase: 5000,
      margenDeseado: 10,
      precioInterno: 5500,
      sku: "LEGACY-042",
      estado: "activo",
      uidUsuario: uid,
      negocioId: businessId,
      actualizadoEn: new Date(),
      campoDesconocido: { conservar: true },
    });
    const legacyRef = doc(
      db,
      "negocios",
      businessId,
      "inventario",
      "legacy-integrated"
    );
    const legacyBefore = (await getDoc(legacyRef)).data();
    assert.equal(legacyBefore.areaId, undefined);
    assert.equal(legacyBefore.codigoInterno, undefined);
    await updateDoc(legacyRef, {
      areaId: "area_informatica",
      categoriaId: categoryId,
      categoria: "Redes y conectividad",
      marca: "Legacy",
      modelo: "L-42",
      stock: 1,
      stockMinimo: 0,
    });
    const legacyAfter = (await getDoc(legacyRef)).data();
    assert.equal(legacyAfter.sku, "LEGACY-042");
    assert.equal(legacyAfter.codigoInterno, undefined);
    assert.deepEqual(legacyAfter.campoDesconocido, { conservar: true });

    const productRef = doc(
      db,
      "negocios",
      businessId,
      "inventario",
      productResponse.data.itemId
    );
    await updateDoc(productRef, {
      tipoItem: "servicio",
      marca: deleteField(),
      modelo: deleteField(),
      stock: deleteField(),
      stockMinimo: deleteField(),
      codigoBarras: deleteField(),
    });
    const convertedProduct = (await getDoc(productRef)).data();
    assert.equal(convertedProduct.codigoInterno, "PR-0001");
    assert.equal(convertedProduct.tipoItem, "servicio");
    assert.equal("marca" in convertedProduct, false);

    const importRows = [
      {
        rowId: "import-product-1",
        item: {
          ...commonItem,
          tipoItem: "producto",
          nombre: "Producto importado repetible",
          marca: "Ubiquiti",
          modelo: "U6 Pro",
          stock: 4,
          stockMinimo: 1,
          origen: "importacion_inteligente_archivo",
        },
      },
      {
        rowId: "import-product-2",
        item: {
          ...commonItem,
          tipoItem: "producto",
          nombre: "Producto importado repetible",
          marca: "Ubiquiti",
          modelo: "U6 Pro",
          stock: 4,
          stockMinimo: 1,
          origen: "importacion_inteligente_archivo",
        },
      },
      {
        rowId: "import-service-1",
        item: {
          ...commonItem,
          tipoItem: "servicio",
          nombre: "Servicio importado",
          origen: "importacion_inteligente_archivo",
        },
      },
      {
        rowId: "import-activity-1",
        item: {
          ...commonItem,
          tipoItem: "actividad",
          nombre: "Actividad importada",
          origen: "importacion_inteligente_archivo",
        },
      },
    ];
    const itemsBeforePreview = await getDocs(collectionRef(db, uid, "inventario"));
    const countersBeforePreview = await Promise.all(
      ["producto", "servicio", "actividad"].map((type) =>
        adminDb.doc(`negocios/${businessId}/inventarioContadores/${type}`).get()
      )
    );
    assert.equal(itemsBeforePreview.size, 4);
    assert.deepEqual(
      countersBeforePreview.map((snapshot) => snapshot.data()?.ultimoNumero),
      [1, 1, 1],
      "Preparar o cancelar una previsualización no debe consumir códigos."
    );

    await expectCallableCode("invalid-argument", () =>
      call("confirmInventoryImportV2", {
        requestId: "import_oversized_0001",
        rows: Array.from({ length: 201 }, (_, index) => ({
          rowId: `oversized-${index}`,
          item: importRows[2].item,
        })),
      })
    );
    await expectCallableCode("invalid-argument", () =>
      call("confirmInventoryImportV2", {
        requestId: "import_code_injection_0001",
        rows: [
          {
            ...importRows[2],
            item: { ...importRows[2].item, codigoInterno: "SV-9999" },
          },
        ],
      })
    );

    const countBeforeInvalidBatch = (
      await getDocs(collectionRef(db, uid, "inventario"))
    ).size;
    await expectCallableCode("invalid-argument", () =>
      call("confirmInventoryImportV2", {
        requestId: "import_invalid_row_0001",
        rows: [
          importRows[2],
          {
            rowId: "invalid-product",
            item: {
              ...commonItem,
              tipoItem: "producto",
              nombre: "Producto inválido",
              marca: "",
              modelo: "",
              stock: -1,
              stockMinimo: 0,
            },
          },
        ],
      })
    );
    assert.equal(
      (await getDocs(collectionRef(db, uid, "inventario"))).size,
      countBeforeInvalidBatch,
      "Una fila inválida no debe producir escrituras parciales."
    );

    await call("saveInventoryCategory", {
      categoriaId: categoryId,
      areaId: "area_informatica",
      nombre: "Redes y conectividad",
      estado: "inactivo",
    });
    await expectCallableCode("failed-precondition", () =>
      call("confirmInventoryImportV2", {
        requestId: "import_catalog_changed_0001",
        rows: [importRows[2]],
      })
    );
    assert.equal(
      (await getDocs(collectionRef(db, uid, "inventario"))).size,
      countBeforeInvalidBatch,
      "Un catálogo desactivado al confirmar debe rechazar todo el lote."
    );
    await call("saveInventoryCategory", {
      categoriaId: categoryId,
      areaId: "area_informatica",
      nombre: "Redes y conectividad",
      estado: "activo",
    });

    const batchPayload = {
      requestId: "import_batch_retry_0001",
      rows: importRows,
    };
    const [firstBatchResponse, duplicateBatchResponse] = await Promise.all([
      call("confirmInventoryImportV2", batchPayload),
      call("confirmInventoryImportV2", batchPayload),
    ]);
    assert.deepEqual(
      firstBatchResponse.data.results,
      duplicateBatchResponse.data.results,
      "Un doble envío debe devolver el mismo lote."
    );
    const importedCodes = firstBatchResponse.data.results.map(
      (result) => result.codigoInterno
    );
    assert.deepEqual(importedCodes, ["PR-0002", "PR-0003", "SV-0002", "AC-0002"]);
    assert.notEqual(
      firstBatchResponse.data.results[0].itemId,
      firstBatchResponse.data.results[1].itemId,
      "Dos filas legítimamente iguales deben crear ítems distintos."
    );
    const retryResponse = await call("confirmInventoryImportV2", batchPayload);
    assert.equal(retryResponse.data.idempotent, true);
    assert.deepEqual(retryResponse.data.results, firstBatchResponse.data.results);
    await expectCallableCode("failed-precondition", () =>
      call("confirmInventoryImportV2", {
        ...batchPayload,
        rows: batchPayload.rows.slice(0, 1),
      })
    );

    const importedService = (
      await getDoc(
        doc(
          db,
          "negocios",
          businessId,
          "inventario",
          firstBatchResponse.data.results[2].itemId
        )
      )
    ).data();
    assert.equal("marca" in importedService, false);
    assert.equal("stock" in importedService, false);

    const unclassifiedProduct = await call("createInventoryItemWithCode", {
      requestId: "integrated_unclassified_product_0001",
      item: {
        tipoItem: "producto",
        areaId: "",
        categoriaId: "",
        nombre: "Producto sin clasificación",
        descripcion: "Creación básica sin barreras de catálogo",
        unidad: "unidad",
        unidadStock: "unidad",
        costoBase: 1500,
        margenDeseado: 20,
        precioInterno: 999999,
        precioManual: false,
        stock: 2,
        stockMinimo: 1,
      },
    });
    const unclassifiedData = (
      await getDoc(doc(db, "negocios", businessId, "inventario", unclassifiedProduct.data.itemId))
    ).data();
    assert.equal("areaId" in unclassifiedData, false);
    assert.equal("categoriaId" in unclassifiedData, false);
    assert.equal(unclassifiedData.precioInterno, 1800);
    assert.equal("marca" in unclassifiedData, false);

    await expectCallableCode("already-exists", () =>
      call("confirmInventoryImportV2", {
        requestId: "integrated_legacy_sku_collision_0001",
        rows: [{
          rowId: "legacy-sku-collision-row",
          item: {
            tipoItem: "servicio",
            nombre: "Servicio con código legacy ocupado",
            unidad: "servicio",
            costoBase: 1000,
            margenDeseado: 10,
            precioInterno: 1100,
            precioManual: false,
            codigoSolicitado: "legacy-042",
          },
        }],
      })
    );
    assert.equal(
      (
        await adminDb.doc(
          `negocios/${businessId}/inventoryCodeKeys/${Buffer.from("LEGACY-042").toString("base64url")}`
        ).get()
      ).exists,
      false,
      "Validar un SKU legacy no debe crearle una clave interna."
    );

    const foreignBusinessId = "inventory-foreign-business";
    await adminDb.doc(
      `negocios/${foreignBusinessId}/inventario/foreign-legacy-code`
    ).set({
      sku: "FOREIGN-LEGACY-001",
      negocioId: foreignBusinessId,
    });
    const crossBusinessCodePayload = {
      requestId: "integrated_cross_business_code_0001",
      item: {
        tipoItem: "servicio",
        nombre: "Servicio con código libre en este negocio",
        unidad: "servicio",
        costoBase: 1000,
        margenDeseado: 10,
        precioInterno: 1100,
        precioManual: false,
        codigoSolicitado: "foreign-legacy-001",
      },
    };
    const crossBusinessCode = await call(
      "createInventoryItemWithCode",
      crossBusinessCodePayload
    );
    assert.equal(crossBusinessCode.data.codigoInterno, "FOREIGN-LEGACY-001");
    const crossBusinessCodeRetry = await call(
      "createInventoryItemWithCode",
      crossBusinessCodePayload
    );
    assert.equal(crossBusinessCodeRetry.data.idempotent, true);
    assert.equal(crossBusinessCodeRetry.data.itemId, crossBusinessCode.data.itemId);

    const customCodePayload = {
      requestId: "integrated_custom_code_0001",
      rows: [{
        rowId: "custom-code-row",
        item: {
          tipoItem: "servicio",
          areaId: "",
          categoriaId: "",
          nombre: "Servicio con código de planilla",
          unidad: "servicio",
          costoBase: 1000,
          margenDeseado: 10,
          precioInterno: 1100,
          precioManual: false,
          codigoSolicitado: "CUSTOM-001",
          origen: "importacion_excel_local",
        },
      }],
    };
    const customCodeResult = await call("confirmInventoryImportV2", customCodePayload);
    assert.equal(customCodeResult.data.results[0].codigoInterno, "CUSTOM-001");
    const customCodeRetry = await call("confirmInventoryImportV2", customCodePayload);
    assert.equal(customCodeRetry.data.idempotent, true);
    assert.deepEqual(customCodeRetry.data.results, customCodeResult.data.results);
    await expectCallableCode("already-exists", () =>
      call("confirmInventoryImportV2", {
        ...customCodePayload,
        requestId: "integrated_custom_code_0002",
      })
    );

    await assert.rejects(
      setDoc(
        doc(db, "negocios", businessId, "inventoryImportRequests", "client-write"),
        { total: 99 }
      )
    );
    await assert.rejects(
      setDoc(doc(db, "negocios", businessId, "inventarioContadores", "producto"), {
        ultimoNumero: 9999,
      })
    );

    const finalItems = await getDocs(
      query(collectionRef(db, uid, "inventario"), orderBy("actualizadoEn", "desc"))
    );
    assert.equal(finalItems.size, 11);

    await signOut(auth);
    const memberCredential = await signInAnonymously(auth);
    await adminDb.doc(`membresias/${businessId}__${memberCredential.user.uid}`).set({
      uid: memberCredential.user.uid,
      negocioId: businessId,
      rol: "MEMBER",
      estado: "activo",
    });
    await expectCallableCode("permission-denied", () =>
      call("createInventoryItemWithCode", {
        requestId: "member_cannot_create_0001",
        item: commonItem,
      })
    );

    console.log(
      "INVENTORY_INTEGRATED_LOCAL_OK",
      JSON.stringify({
        uid,
        areas: initialAreas.size,
        categories: initialCategories.size,
        categoryId,
        codes: [
          serviceResponse.data.codigoInterno,
          activityResponse.data.codigoInterno,
          productResponse.data.codigoInterno,
        ],
        legacySku: legacyAfter.sku,
        importedCodes,
      })
    );
  } finally {
    if (auth.currentUser) await signOut(auth);
    await Promise.all([deleteApp(app), deleteAdminApp(adminApp)]);
  }
}

main().catch((error) => {
  console.error(
    "INVENTORY_INTEGRATED_LOCAL_FAILED",
    error?.code || "",
    error?.message || error
  );
  process.exitCode = 1;
});
