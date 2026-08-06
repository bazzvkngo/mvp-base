import { randomBytes } from "node:crypto";
import { deleteApp, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  setDoc,
  terminate,
  updateDoc,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  deleteObject,
  getMetadata,
  getStorage,
  ref,
  uploadBytes,
} from "firebase/storage";

if (process.env.VALORACLOUD_ALLOW_REAL_WRITES !== "tesis-inventario-ia") {
  throw new Error(
    "Validación real bloqueada. Define VALORACLOUD_ALLOW_REAL_WRITES=tesis-inventario-ia para autorizar escrituras controladas."
  );
}

const firebaseConfig = {
  apiKey: "AIzaSyAGB0metkzNnJOtvI0zsft-NvIb5uoKBXA",
  authDomain: "tesis-inventario-ia.firebaseapp.com",
  projectId: "tesis-inventario-ia",
  storageBucket: "tesis-inventario-ia.firebasestorage.app",
  messagingSenderId: "1030324613425",
  appId: "1:1030324613425:web:27b82796bd1e955c2ac010",
};

const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const email = `codex.validation.${runId}@example.com`;
const password = `Codex-${randomBytes(18).toString("base64url")}!9a`;
const app = initializeApp(firebaseConfig, `real-validation-${runId}`);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app, "us-central1");
const results = [];
let uid = "";
let legacyInventoryRef = null;
const v2InventoryRefs = [];
let quoteRef = null;
let logoRef = null;

function normalizeError(error) {
  return {
    code: String(error?.code || "unknown"),
    message: String(error?.message || error || "Error desconocido").slice(0, 500),
  };
}

async function check(name, action, { expectedErrorCodes = [] } = {}) {
  try {
    const detail = await action();
    if (expectedErrorCodes.length) {
      const error = {
        code: "validation/unexpected-success",
        message: `La operación debía ser rechazada con: ${expectedErrorCodes.join(", ")}.`,
      };
      results.push({ name, status: "failed", error });
      return { ok: false, expected: false, error };
    }
    results.push({ name, status: "ok", detail: detail ?? null });
    return { ok: true, detail };
  } catch (error) {
    const normalized = normalizeError(error);
    const expected = expectedErrorCodes.some(
      (code) => normalized.code === code || normalized.code.endsWith(`/${code}`)
    );
    results.push({
      name,
      status: expected ? "expected-denial" : "failed",
      error: normalized,
    });
    return { ok: false, expected, error: normalized };
  }
}

function callable(name) {
  return httpsCallable(functions, name, { timeout: 60_000 });
}

function makeInventoryItem(name) {
  return {
    tipoItem: "servicio",
    areaId: "area_informatica",
    categoriaId: "cat_soporte_tecnico_hardware",
    nombre: name,
    descripcion: "Registro controlado de validación Firebase real",
    unidad: "servicio",
    costoBase: 1000,
    margenDeseado: 20,
    precioInterno: 1200,
    estado: "activo",
  };
}

function makeQuote(inventoryId = `validation-${runId}`) {
  return {
    estado: "borrador",
    validezDias: 10,
    afectaIva: true,
    cliente: {
      empresa: "Cliente validación Codex",
      rut: "76.123.456-7",
      contacto: "Contacto de prueba",
      email: "cliente.validacion@example.com",
      proyecto: "Validación Firebase real",
    },
    empresa: {
      nombreComercial: "ValoraCloud QA",
      rut: "77.091.679-8",
      responsable: "Validación automática",
      validezCotizacionDias: 10,
    },
    items: [
      {
        lineaId: `linea-${runId}`,
        itemId: inventoryId,
        codigo: "SV-VALIDACION",
        nombre: "Servicio de validación",
        descripcionComercial: "Ítem de prueba controlado",
        tipoItem: "servicio",
        unidad: "servicio",
        cantidad: 1,
        precioSugerido: 1200,
        precioUnitarioEditable: 1200,
        descuentoPorcentaje: 0,
        inventarioSnapshot: {
          inventarioId: inventoryId,
          codigoInterno: "SV-VALIDACION",
          nombre: "Servicio de validación",
          tipoItem: "servicio",
          areaId: "area_informatica",
          categoriaId: "cat_soporte_tecnico_hardware",
          categoria: "Soporte técnico y hardware",
          unidad: "servicio",
          modeloInventarioVersion: 2,
        },
      },
    ],
    descuento: 0,
    seccionesAlcance: [
      {
        id: "validacion",
        titulo: "Validación",
        lineas: ["Prueba controlada de persistencia."],
      },
    ],
    condiciones: {
      formaPago: "Prueba sin valor comercial",
      plazoEntrega: "No aplica",
    },
    aceptacion: { habilitada: false, texto: "Documento de prueba." },
  };
}

try {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  uid = credential.user.uid;
  results.push({ name: "auth.create-test-user", status: "ok", detail: { uid, email } });

  const userRef = doc(db, "usuarios", uid);
  const companyRef = doc(db, `usuarios/${uid}/empresa/perfil`);

  await check("firestore.user.create-read-update", async () => {
    await setDoc(userRef, {
      uidUsuario: uid,
      nombre: "Validación Codex",
      tipoDato: "prueba",
      creadoEn: serverTimestamp(),
    });
    await setDoc(companyRef, {
      uidUsuario: uid,
      nombreComercial: "ValoraCloud validación",
      estadoValidacion: "iniciada",
      actualizadoEn: serverTimestamp(),
    });
    await updateDoc(companyRef, {
      estadoValidacion: "completada",
      actualizadoEn: serverTimestamp(),
    });
    const snapshot = await getDoc(companyRef);
    if (!snapshot.exists() || snapshot.data().uidUsuario !== uid) {
      throw new Error("No se confirmó la lectura del perfil propio.");
    }
    return { companyPath: companyRef.path };
  });

  await check(
    "firestore.cross-uid-read-denied",
    () => getDoc(doc(db, `usuarios/codex-other-${runId}`)),
    { expectedErrorCodes: ["permission-denied"] }
  );

  await check("firestore.legacy-inventory-create-edit", async () => {
    legacyInventoryRef = await addDoc(collection(db, `usuarios/${uid}/inventario`), {
      uidUsuario: uid,
      nombre: `VALIDACIÓN LEGACY ${runId}`,
      tipoItem: "servicio",
      unidad: "servicio",
      costoBase: 500,
      margenDeseado: 10,
      precioInterno: 550,
      creadoDesdeCotizacion: true,
      estado: "activo",
      creadoEn: serverTimestamp(),
      actualizadoEn: serverTimestamp(),
    });
    await updateDoc(legacyInventoryRef, {
      estado: "inactivo",
      actualizadoEn: serverTimestamp(),
      eliminadoEn: serverTimestamp(),
    });
    const snapshot = await getDoc(legacyInventoryRef);
    if (snapshot.data()?.estado !== "inactivo") {
      throw new Error("El inventario legacy no quedó inactivo.");
    }
    return { inventoryPath: legacyInventoryRef.path };
  });

  if (legacyInventoryRef) {
    await check(
      "firestore.hard-delete-denied-by-rules",
      () => deleteDoc(legacyInventoryRef),
      { expectedErrorCodes: ["permission-denied"] }
    );
  }

  await check(
    "firestore.direct-quote-create-denied",
    () =>
      setDoc(doc(db, `usuarios/${uid}/cotizaciones/direct-${runId}`), {
        uidUsuario: uid,
        estado: "borrador",
        numero: "NO-DEBE-CREARSE",
      }),
    { expectedErrorCodes: ["permission-denied"] }
  );

  await check("storage.upload-read-delete", async () => {
    logoRef = ref(storage, `usuarios/${uid}/empresa/logo/validacion-${runId}.png`);
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ioAAAAASUVORK5CYII=",
        "base64"
      )
    );
    await uploadBytes(logoRef, png, { contentType: "image/png" });
    const metadata = await getMetadata(logoRef);
    await deleteObject(logoRef);
    logoRef = null;
    return { contentType: metadata.contentType, size: metadata.size };
  });

  const initialize = await check("function.initializeInventoryCatalog", async () => {
    const response = await callable("initializeInventoryCatalog")({});
    const [areas, categories] = await Promise.all([
      getDocs(collection(db, `usuarios/${uid}/areas`)),
      getDocs(collection(db, `usuarios/${uid}/categoriasInventario`)),
    ]);
    if (!areas.size || !categories.size) {
      throw new Error("La Function respondió, pero no creó el catálogo esperado.");
    }
    return { response: response.data, areas: areas.size, categories: categories.size };
  });

  if (initialize.ok) {
    const areaName = `Área validación ${runId}`;
    const categoryName = `Categoría validación ${runId}`;
    let validationAreaId = "";
    let validationCategoryId = "";
    const areaCreate = await check("function.saveInventoryArea.create", async () => {
      const response = await callable("saveInventoryArea")({ nombre: areaName, estado: "activo" });
      validationAreaId = response.data?.areaId || "";
      if (!validationAreaId) throw new Error("La Function no devolvió areaId.");
      return response.data;
    });
    if (areaCreate.ok) {
      const categoryCreate = await check("function.saveInventoryCategory.create", async () => {
        const response = await callable("saveInventoryCategory")({
          areaId: validationAreaId,
          nombre: categoryName,
          estado: "activo",
        });
        validationCategoryId = response.data?.categoriaId || "";
        if (!validationCategoryId) throw new Error("La Function no devolvió categoriaId.");
        return response.data;
      });
      if (categoryCreate.ok) {
        await check("function.saveInventoryCategory.deactivate", async () => {
          const response = await callable("saveInventoryCategory")({
            categoriaId: validationCategoryId,
            areaId: validationAreaId,
            nombre: categoryName,
            estado: "inactivo",
          });
          return response.data;
        });
      }
      await check("function.saveInventoryArea.deactivate", async () => {
        const response = await callable("saveInventoryArea")({
          areaId: validationAreaId,
          nombre: areaName,
          estado: "inactivo",
        });
        return response.data;
      });
    }

    const quickItem = await check("function.createInventoryItemWithCode", async () => {
      const response = await callable("createInventoryItemWithCode")({
        requestId: `quick_${runId}`,
        item: makeInventoryItem(`VALIDACIÓN V2 RÁPIDA ${runId}`),
      });
      const itemId = response.data?.itemId;
      if (!itemId) throw new Error("La Function no devolvió itemId.");
      const itemReference = doc(db, `usuarios/${uid}/inventario/${itemId}`);
      v2InventoryRefs.push(itemReference);
      const snapshot = await getDoc(itemReference);
      if (snapshot.data()?.modeloInventarioVersion !== 2) {
        throw new Error("El ítem rápido no quedó almacenado como v2.");
      }
      return response.data;
    });

    await check("function.confirmInventoryImportV2", async () => {
      const response = await callable("confirmInventoryImportV2")({
        requestId: `import_${runId}`,
        rows: [
          {
            rowId: `row_${runId}`,
            item: makeInventoryItem(`VALIDACIÓN V2 IMPORTADA ${runId}`),
          },
        ],
      });
      const created = Array.isArray(response.data?.results) ? response.data.results : [];
      if (created.length !== 1 || !created[0].itemId) {
        throw new Error("La importación v2 no devolvió el ítem esperado.");
      }
      v2InventoryRefs.push(doc(db, `usuarios/${uid}/inventario/${created[0].itemId}`));
      return { total: response.data.total, result: created[0] };
    });

    const inventoryId = quickItem.ok ? quickItem.detail.itemId : `validation-${runId}`;
    const quotePayload = makeQuote(inventoryId);
    const quoteCreate = await check("function.createQuoteWithNumber", async () => {
      const response = await callable("createQuoteWithNumber")({
        requestId: `quote_${runId}`,
        quote: quotePayload,
      });
      const quoteId = response.data?.quote?.id;
      if (!quoteId || !response.data?.quote?.numero) {
        throw new Error("La Function no devolvió ID y número de cotización.");
      }
      quoteRef = doc(db, `usuarios/${uid}/cotizaciones/${quoteId}`);
      return { id: quoteId, numero: response.data.quote.numero };
    });

    if (quoteCreate.ok) {
      await check("function.updateQuoteDraft", async () => {
        const response = await callable("updateQuoteDraft")({
          quoteId: quoteCreate.detail.id,
          quote: {
            ...quotePayload,
            condiciones: {
              ...quotePayload.condiciones,
              observaciones: `Edición validada ${runId}`,
            },
          },
        });
        if (response.data?.quote?.id !== quoteCreate.detail.id) {
          throw new Error("La edición no conservó el ID de cotización.");
        }
        return { id: response.data.quote.id, numero: response.data.quote.numero };
      });
      await check(
        "firestore.direct-quote-content-update-denied",
        () =>
          updateDoc(quoteRef, {
            clienteNombre: "MODIFICACIÓN DIRECTA NO AUTORIZADA",
            actualizadoEn: serverTimestamp(),
          }),
        { expectedErrorCodes: ["permission-denied"] }
      );
    }
  } else {
    await check("function.createInventoryItemWithCode", () =>
      callable("createInventoryItemWithCode")({
        requestId: `quick_${runId}`,
        item: makeInventoryItem(`VALIDACIÓN V2 RÁPIDA ${runId}`),
      })
    );
    await check("function.confirmInventoryImportV2", () =>
      callable("confirmInventoryImportV2")({
        requestId: `import_${runId}`,
        rows: [{ rowId: `row_${runId}`, item: makeInventoryItem(`VALIDACIÓN ${runId}`) }],
      })
    );
    await check("function.createQuoteWithNumber", () =>
      callable("createQuoteWithNumber")({
        requestId: `quote_${runId}`,
        quote: makeQuote(),
      })
    );
    await check("function.updateQuoteDraft", () =>
      callable("updateQuoteDraft")({ quoteId: `missing-${runId}`, quote: makeQuote() })
    );
  }

  await check(
    "function.sendQuoteEmail.validation-only",
    () => callable("sendQuoteEmail")({}),
    { expectedErrorCodes: ["invalid-argument"] }
  );

  for (const itemRef of v2InventoryRefs) {
    await check(`cleanup.soft-delete.${itemRef.id}`, () =>
      updateDoc(itemRef, {
        estado: "inactivo",
        actualizadoEn: serverTimestamp(),
        eliminadoEn: serverTimestamp(),
      })
    );
  }
  if (quoteRef) {
    await check("cleanup.archive-quote", () =>
      updateDoc(quoteRef, {
        estado: "archivada",
        estadoAnterior: "borrador",
        actualizadoEn: serverTimestamp(),
      })
    );
  }
} finally {
  if (logoRef) {
    await deleteObject(logoRef).catch(() => {});
  }
  await signOut(auth).catch(() => {});
  await terminate(db).catch(() => {});
  await deleteApp(app).catch(() => {});
}

const failed = results.filter((result) => result.status === "failed");
console.log(JSON.stringify({
  runId,
  projectId: firebaseConfig.projectId,
  uid,
  accountEmail: email,
  results,
  summary: {
    passed: results.filter((result) => result.status === "ok").length,
    expectedDenials: results.filter((result) => result.status === "expected-denial").length,
    failed: failed.length,
  },
}, null, 2));

if (failed.length) process.exitCode = 2;
