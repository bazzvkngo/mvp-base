import { deleteApp, initializeApp } from "firebase/app";
import { createRequire } from "node:module";
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {
  connectStorageEmulator,
  deleteObject,
  getStorage,
  ref,
  uploadBytes,
} from "firebase/storage";

const PROJECT_ID = "tesis-inventario-ia";
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

function createClient(name) {
  const app = initializeApp(
    {
      apiKey: "demo-key",
      appId: `demo-${name}`,
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
      storageBucket: `${PROJECT_ID}.firebasestorage.app`,
    },
    name
  );
  const auth = getAuth(app);
  const db = getFirestore(app);
  const storage = getStorage(app);

  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);

  return { app, auth, db, storage };
}

async function expectDenied(label, operation) {
  try {
    await operation();
  } catch (error) {
    const code = String(error?.code || "");
    if (
      code.includes("permission-denied") ||
      code.includes("unauthorized")
    ) {
      console.log(`OK denegado: ${label}`);
      return;
    }
    throw error;
  }

  throw new Error(`Se esperaba denegacion: ${label}`);
}

async function main() {
  const ownerClient = createClient("rules-owner");
  const otherClient = createClient("rules-other");
  const guestClient = createClient("rules-guest");
  const adminApp = initializeAdminApp({ projectId: PROJECT_ID }, "rules-admin");
  const adminDb = getAdminFirestore(adminApp);

  try {
    const ownerCredential = await signInAnonymously(ownerClient.auth);
    const otherCredential = await signInAnonymously(otherClient.auth);
    const ownerUid = ownerCredential.user.uid;
    const otherUid = otherCredential.user.uid;
    const inventoryPath = `usuarios/${ownerUid}/inventario/item-smoke`;
    const areaPath = `usuarios/${ownerUid}/areas/area-smoke`;
    const categoryPath =
      `usuarios/${ownerUid}/categoriasInventario/category-smoke`;

    await adminDb.doc(areaPath).set({
      nombre: "Informática",
      nombreNormalizado: "informatica",
      estado: "activo",
      uidUsuario: ownerUid,
    });
    await adminDb.doc(categoryPath).set({
      areaId: "area-smoke",
      nombre: "Hardware",
      nombreNormalizado: "hardware",
      estado: "activo",
      uidUsuario: ownerUid,
    });

    await setDoc(doc(ownerClient.db, inventoryPath), {
      nombre: "Item de prueba",
      tipoItem: "producto",
      unidad: "unidad",
      costoBase: 1000,
      margenDeseado: 20,
      precioInterno: 1200,
      sku: "LEG-001",
      estado: "activo",
      creadoDesdeCotizacion: true,
      uidUsuario: ownerUid,
      actualizadoEn: serverTimestamp(),
    });
    console.log("OK permitido: propietario crea inventario");
    const readableLegacyItem = await getDoc(doc(ownerClient.db, inventoryPath));
    if (!readableLegacyItem.exists()) {
      throw new Error("El propietario no pudo leer un registro heredado.");
    }
    console.log("OK permitido: propietario lee inventario heredado sin area");

    await updateDoc(doc(ownerClient.db, inventoryPath), {
      estado: "inactivo",
      actualizadoEn: serverTimestamp(),
    });
    console.log("OK permitido: cambio de ciclo de vida de inventario heredado");

    await updateDoc(doc(ownerClient.db, inventoryPath), {
      areaId: "area-smoke",
      categoriaId: "category-smoke",
      categoria: "Hardware",
      marca: "Lenovo",
      modelo: "T14",
      stock: 3,
      stockMinimo: 1,
      actualizadoEn: serverTimestamp(),
    });
    console.log("OK permitido: registro heredado adopta area y categoria sin renumerarse");

    await expectDenied("cliente altera SKU/codigo heredado", () =>
      updateDoc(doc(ownerClient.db, inventoryPath), {
        sku: "LEG-002",
        actualizadoEn: serverTimestamp(),
      })
    );

    const managedItemPath =
      `usuarios/${ownerUid}/inventario/item-managed-smoke`;
    const managedCounterPath =
      `usuarios/${ownerUid}/inventarioContadores/producto`;
    await adminDb.doc(managedCounterPath).set({
      tipoItem: "producto",
      ultimoNumero: 1,
      uidUsuario: ownerUid,
    });
    await adminDb.doc(managedItemPath).set({
      areaId: "area-smoke",
      categoriaId: "category-smoke",
      categoria: "Hardware",
      codigoInterno: "PR-0001",
      modeloInventarioVersion: 2,
      nombre: "Servidor administrado",
      tipoItem: "producto",
      descripcion: "",
      unidad: "unidad",
      costoBase: 1000,
      margenDeseado: 20,
      precioInterno: 1200,
      marca: "Dell",
      modelo: "R760",
      stock: 2,
      stockMinimo: 1,
      estado: "activo",
      uidUsuario: ownerUid,
    });
    await updateDoc(doc(ownerClient.db, managedItemPath), {
      nombre: "Servidor administrado actualizado",
      actualizadoEn: serverTimestamp(),
    });
    const [managedAfterEdit, counterAfterEdit] = await Promise.all([
      adminDb.doc(managedItemPath).get(),
      adminDb.doc(managedCounterPath).get(),
    ]);
    if (
      managedAfterEdit.data()?.codigoInterno !== "PR-0001" ||
      counterAfterEdit.data()?.ultimoNumero !== 1
    ) {
      throw new Error("Editar un item alteró su código o su contador.");
    }
    console.log("OK permitido: propietario edita item v2 valido");
    await expectDenied("cliente altera codigo interno v2", () =>
      updateDoc(doc(ownerClient.db, managedItemPath), {
        codigoInterno: "PR-9000",
        actualizadoEn: serverTimestamp(),
      })
    );

    await expectDenied("propietario elimina fisicamente un item", () =>
      deleteDoc(doc(ownerClient.db, inventoryPath))
    );
    await expectDenied("cliente crea item con codigo interno protegido", () =>
      setDoc(doc(ownerClient.db, `usuarios/${ownerUid}/inventario/forged-code`), {
        nombre: "Código falsificado",
        tipoItem: "producto",
        codigoInterno: "PR-9999",
        modeloInventarioVersion: 2,
        uidUsuario: ownerUid,
      })
    );
    await expectDenied("cliente crea item heredado fuera de un flujo transitorio", () =>
      setDoc(doc(ownerClient.db, `usuarios/${ownerUid}/inventario/legacy-direct`), {
        nombre: "Alta directa no autorizada",
        tipoItem: "servicio",
        unidad: "servicio",
        costoBase: 1000,
        margenDeseado: 20,
        precioInterno: 1200,
        uidUsuario: ownerUid,
      })
    );
    await expectDenied("cliente escribe contador de inventario", () =>
      setDoc(
        doc(
          ownerClient.db,
          `usuarios/${ownerUid}/inventarioContadores/producto`
        ),
        { ultimoNumero: 9999, uidUsuario: ownerUid }
      )
    );
    await expectDenied("cliente escribe idempotencia de importación", () =>
      setDoc(
        doc(
          ownerClient.db,
          `usuarios/${ownerUid}/inventoryImportRequests/forged-request`
        ),
        { total: 1, uidUsuario: ownerUid }
      )
    );
    await expectDenied("cliente crea area fuera de la Function", () =>
      setDoc(doc(ownerClient.db, `usuarios/${ownerUid}/areas/forged-area`), {
        nombre: "Área no autorizada",
        estado: "activo",
        uidUsuario: ownerUid,
      })
    );

    await expectDenied("otro usuario lee inventario", () =>
      getDoc(doc(otherClient.db, inventoryPath))
    );
    await expectDenied("usuario no autenticado crea inventario", () =>
      setDoc(doc(guestClient.db, `usuarios/${ownerUid}/inventario/guest`), {
        nombre: "No permitido",
        uidUsuario: ownerUid,
      })
    );
    await expectDenied("propietario declara otro uidUsuario", () =>
      setDoc(doc(ownerClient.db, `usuarios/${ownerUid}/inventario/owner-mismatch`), {
        nombre: "No permitido",
        uidUsuario: otherUid,
      })
    );
    await expectDenied("cliente crea cotizacion fuera de la Function", () =>
      setDoc(
        doc(
          ownerClient.db,
          `usuarios/${ownerUid}/cotizaciones/quote-forged-email`
        ),
        {
          clienteNombre: "Cliente de prueba",
          estado: "borrador",
          uidUsuario: ownerUid,
        }
      )
    );

    const managedQuotePath = `usuarios/${ownerUid}/cotizaciones/quote-managed`;
    await adminDb.doc(managedQuotePath).set({
      numero: "COT-2026-0001",
      clienteNombre: "Cliente de prueba",
      estado: "borrador",
      uidUsuario: ownerUid,
    });
    await expectDenied("cliente edita contenido sin recalculo de la Function", () =>
      updateDoc(doc(ownerClient.db, managedQuotePath), {
        observaciones: "Cambio no permitido desde el cliente",
        actualizadoEn: serverTimestamp(),
      })
    );
    await expectDenied("cliente renumera una cotizacion", () =>
      updateDoc(doc(ownerClient.db, managedQuotePath), {
        numero: "COT-2026-9999",
        actualizadoEn: serverTimestamp(),
      })
    );

    await expectDenied("cliente incrementa contador de cotizaciones", () =>
      setDoc(
        doc(ownerClient.db, `usuarios/${ownerUid}/contadores/cotizaciones_2026`),
        { lastNumber: 999, uidUsuario: ownerUid }
      )
    );
    await expectDenied("cliente registra solicitud idempotente de cotizacion", () =>
      setDoc(
        doc(
          ownerClient.db,
          `usuarios/${ownerUid}/quoteCreateRequests/quote-forged-request`
        ),
        { quoteId: "forged", uidUsuario: ownerUid }
      )
    );

    const businessId = `rules-business-${ownerUid}`;
    const businessProfilePath = `negocios/${businessId}/empresa/perfil`;
    await Promise.all([
      adminDb.doc(`negocios/${businessId}`).set({
        nombreComercial: "Empresa de reglas",
        rubroCodigo: "SERVICIOS_PROFESIONALES",
        paisCodigo: "CL",
        monedaCodigo: "CLP",
        regionCodigo: "13",
        estado: "activo",
      }),
      adminDb.doc(`membresias/${businessId}__${ownerUid}`).set({
        negocioId: businessId,
        uid: ownerUid,
        rol: "OWNER",
        estado: "activo",
      }),
      adminDb.doc(businessProfilePath).set({
        negocioId: businessId,
        nombreComercial: "Empresa de reglas",
      }),
    ]);
    if (!(await getDoc(doc(ownerClient.db, businessProfilePath))).exists()) {
      throw new Error("El propietario no pudo leer el perfil del negocio activo.");
    }
    await expectDenied("otro usuario lee perfil de negocio ajeno", () =>
      getDoc(doc(otherClient.db, businessProfilePath))
    );

    const businessSettingsPath =
      `negocios/${businessId}/configuracion/inventario`;
    await adminDb.doc(businessSettingsPath).set({
      negocioId: businessId,
      alertasStockBajo: true,
      umbralStockBajo: 5,
      permitirStockNegativo: false,
    });
    if (!(await getDoc(doc(ownerClient.db, businessSettingsPath))).exists()) {
      throw new Error("El propietario no pudo leer la configuración del negocio.");
    }
    await expectDenied("usuario ajeno lee configuración de negocio", () =>
      getDoc(doc(otherClient.db, businessSettingsPath))
    );
    await expectDenied("propietario escribe ajustes sin Function", () =>
      updateDoc(doc(ownerClient.db, businessSettingsPath), {
        umbralStockBajo: 99,
      })
    );

    await adminDb.doc(`membresias/${businessId}__${otherUid}`).set({
      negocioId: businessId,
      uid: otherUid,
      rol: "ADMIN",
      estado: "activo",
    });

    const financialBase = {
      modelVersion: 1,
      businessId,
      type: "income",
      status: "paid",
      amount: 125000,
      date: "2026-08-02",
      concept: "Ingreso de prueba",
      categoryId: "services",
      paymentMethodId: "bank_transfer",
      counterpartyName: "Cliente de prueba",
      note: "",
      reference: "TEST-001",
      sourceType: "manual",
      sourceId: "",
      searchText: "ingreso de prueba cliente de prueba test-001",
      createdBy: ownerUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const ownerMovementPath =
      `negocios/${businessId}/financialMovements/owner-movement`;
    await setDoc(doc(ownerClient.db, ownerMovementPath), financialBase);
    console.log("OK permitido: OWNER crea movimiento financiero válido");
    await updateDoc(doc(ownerClient.db, ownerMovementPath), {
      amount: 130000,
      updatedAt: serverTimestamp(),
    });
    console.log("OK permitido: OWNER edita movimiento financiero manual");
    await expectDenied("movimiento con monto cero", () =>
      setDoc(
        doc(
          ownerClient.db,
          `negocios/${businessId}/financialMovements/invalid-zero`
        ),
        { ...financialBase, amount: 0 }
      )
    );
    await expectDenied("movimiento declara otro negocio", () =>
      setDoc(
        doc(
          ownerClient.db,
          `negocios/${businessId}/financialMovements/invalid-business`
        ),
        { ...financialBase, businessId: "otro-negocio" }
      )
    );
    await expectDenied("cliente crea movimiento automático", () =>
      setDoc(
        doc(
          ownerClient.db,
          `negocios/${businessId}/financialMovements/forged-automatic`
        ),
        { ...financialBase, sourceType: "quote", sourceId: "quote-1" }
      )
    );

    const adminMovementPath =
      `negocios/${businessId}/financialMovements/admin-movement`;
    await setDoc(doc(otherClient.db, adminMovementPath), {
      ...financialBase,
      createdBy: otherUid,
      concept: "Movimiento de ADMIN",
      searchText: "movimiento de admin",
    });
    await deleteDoc(doc(otherClient.db, adminMovementPath));
    console.log("OK permitido: ADMIN crea y elimina movimiento manual");

    await adminDb.doc(`membresias/${businessId}__${otherUid}`).update({
      rol: "MEMBER",
    });
    if (!(await getDoc(doc(otherClient.db, businessSettingsPath))).exists()) {
      throw new Error("El miembro no pudo consultar la configuración del negocio.");
    }
    await expectDenied("miembro escribe ajustes directamente", () =>
      updateDoc(doc(otherClient.db, businessSettingsPath), {
        umbralStockBajo: 7,
      })
    );
    if (!(await getDoc(doc(otherClient.db, ownerMovementPath))).exists()) {
      throw new Error("MEMBER no pudo consultar movimientos financieros.");
    }
    await expectDenied("MEMBER crea movimiento financiero", () =>
      setDoc(
        doc(
          otherClient.db,
          `negocios/${businessId}/financialMovements/member-forged`
        ),
        { ...financialBase, createdBy: otherUid }
      )
    );
    await expectDenied("MEMBER edita movimiento financiero", () =>
      updateDoc(doc(otherClient.db, ownerMovementPath), {
        amount: 999999,
        updatedAt: serverTimestamp(),
      })
    );
    await expectDenied("usuario sin membresía lee movimientos", () =>
      getDoc(doc(guestClient.db, ownerMovementPath))
    );

    const automaticMovementPath =
      `negocios/${businessId}/financialMovements/quote__quote-1`;
    await adminDb.doc(automaticMovementPath).set({
      ...financialBase,
      sourceType: "quote",
      sourceId: "quote-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expectDenied("OWNER edita movimiento de origen protegido", () =>
      updateDoc(doc(ownerClient.db, automaticMovementPath), {
        amount: 150000,
        updatedAt: serverTimestamp(),
      })
    );
    await expectDenied("OWNER elimina movimiento de origen protegido", () =>
      deleteDoc(doc(ownerClient.db, automaticMovementPath))
    );
    await deleteDoc(doc(ownerClient.db, ownerMovementPath));
    console.log("OK permitido: OWNER elimina movimiento manual");

    const personalProfilePath = `usuarios/${ownerUid}/cuenta/perfil`;
    await adminDb.doc(personalProfilePath).set({
      uid: ownerUid,
      nombres: "Persona de prueba",
    });
    if (!(await getDoc(doc(ownerClient.db, personalProfilePath))).exists()) {
      throw new Error("El usuario no pudo leer su propio perfil personal.");
    }
    await expectDenied("otro usuario lee perfil personal ajeno", () =>
      getDoc(doc(otherClient.db, personalProfilePath))
    );
    await expectDenied("usuario escribe perfil personal sin Function", () =>
      updateDoc(doc(ownerClient.db, personalProfilePath), {
        nombres: "Escritura directa",
      })
    );
    await expectDenied("cliente modifica directamente datos comerciales", () =>
      updateDoc(doc(ownerClient.db, businessProfilePath), {
        razonSocial: "Escritura directa no permitida",
        actualizadoEn: serverTimestamp(),
      })
    );
    await updateDoc(doc(ownerClient.db, businessProfilePath), {
      logoUrl: "https://example.test/logo.png",
      logoPath: `negocios/${businessId}/empresa/logo/logo.png`,
      logoNombreOriginal: "logo.png",
      logoActualizadoEn: serverTimestamp(),
      actualizadoEn: serverTimestamp(),
    });
    console.log("OK permitido: propietario actualiza metadatos del logo");

    const businessLogoPath = `negocios/${businessId}/empresa/logo/logo-smoke.png`;
    await uploadBytes(
      ref(ownerClient.storage, businessLogoPath),
      new Uint8Array([137, 80, 78, 71]),
      { contentType: "image/png" }
    );
    await expectDenied("otro usuario sube logo de negocio ajeno", () =>
      uploadBytes(
        ref(otherClient.storage, businessLogoPath),
        new Uint8Array([137, 80, 78, 71]),
        { contentType: "image/png" }
      )
    );
    await deleteObject(ref(ownerClient.storage, businessLogoPath));

    const logoPath = `usuarios/${ownerUid}/empresa/logo/logo-smoke.png`;
    await uploadBytes(
      ref(ownerClient.storage, logoPath),
      new Uint8Array([137, 80, 78, 71]),
      { contentType: "image/png" }
    );
    console.log("OK permitido: propietario sube PNG");

    await expectDenied("otro usuario reemplaza logo", () =>
      uploadBytes(
        ref(otherClient.storage, logoPath),
        new Uint8Array([137, 80, 78, 71]),
        { contentType: "image/png" }
      )
    );
    await expectDenied("otro usuario elimina logo", () =>
      deleteObject(ref(otherClient.storage, logoPath))
    );
    await expectDenied("tipo MIME no permitido", () =>
      uploadBytes(
        ref(ownerClient.storage, `usuarios/${ownerUid}/empresa/logo/logo.txt`),
        new TextEncoder().encode("contenido"),
        { contentType: "text/plain" }
      )
    );
    await expectDenied("logo superior a 2 MB", () =>
      uploadBytes(
        ref(ownerClient.storage, `usuarios/${ownerUid}/empresa/logo/grande.png`),
        new Uint8Array(2 * 1024 * 1024 + 1),
        { contentType: "image/png" }
      )
    );
    await deleteObject(ref(ownerClient.storage, logoPath));
    console.log("OK permitido: propietario elimina su logo");

    console.log("RULES_SMOKE_OK");
  } finally {
    await Promise.all([
      deleteApp(ownerClient.app),
      deleteApp(otherClient.app),
      deleteApp(guestClient.app),
      deleteAdminApp(adminApp),
    ]);
  }
}

main().catch((error) => {
  console.error("RULES_SMOKE_FAILED", error?.code || "", error?.message || error);
  process.exitCode = 1;
});
