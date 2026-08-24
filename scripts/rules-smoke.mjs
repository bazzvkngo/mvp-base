import { deleteApp, initializeApp } from "firebase/app";
import { createRequire } from "node:module";
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
} from "firebase/auth";
import {
  collection,
  collectionGroup,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
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
    const guestCredential = await signInAnonymously(guestClient.auth);
    const ownerUid = ownerCredential.user.uid;
    const otherUid = otherCredential.user.uid;
    const guestUid = guestCredential.user.uid;
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
      stock: 3,
      stockMinimo: 1,
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
      actualizadoEn: serverTimestamp(),
    });
    console.log("OK permitido: registro heredado adopta area y categoria sin renumerarse");
    await expectDenied("cliente altera stock heredado directamente", () =>
      updateDoc(doc(ownerClient.db, inventoryPath), {
        stock: 4,
        actualizadoEn: serverTimestamp(),
      })
    );

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
    await expectDenied("cliente altera stock v2 directamente", () =>
      updateDoc(doc(ownerClient.db, managedItemPath), {
        stock: 9,
        actualizadoEn: serverTimestamp(),
      })
    );
    await expectDenied("cliente altera costo promedio directamente", () =>
      updateDoc(doc(ownerClient.db, managedItemPath), {
        costoPromedio: 1,
        actualizadoEn: serverTimestamp(),
      })
    );
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
    await expectDenied("cliente SDK fuerza aceptacion legacy", () =>
      updateDoc(doc(ownerClient.db, managedQuotePath), {
        estado: "aceptada",
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
        rubroCodigo: "INGENIERIA_CONSULTORIA",
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

    const businessInventoryPath =
      `negocios/${businessId}/inventario/item-stock-hardening`;
    await adminDb.doc(businessInventoryPath).set({
      negocioId: businessId,
      modeloInventarioVersion: 2,
      codigoInterno: "PR-0001",
      tipoItem: "producto",
      nombre: "Producto protegido",
      categoria: "",
      unidad: "unidad",
      costoBase: 1000,
      margenDeseado: 20,
      precioInterno: 1200,
      precioManual: false,
      stock: 5,
      stockMinimo: 1,
      estado: "activo",
    });
    await updateDoc(doc(ownerClient.db, businessInventoryPath), {
      nombre: "Producto protegido editado",
      actualizadoEn: serverTimestamp(),
    });
    console.log("OK permitido: OWNER edita nombre sin alterar stock");
    await expectDenied("OWNER altera stock directamente", () =>
      updateDoc(doc(ownerClient.db, businessInventoryPath), {
        stock: 50,
        actualizadoEn: serverTimestamp(),
      })
    );
    await expectDenied("OWNER altera derivados de adquisición", () =>
      updateDoc(doc(ownerClient.db, businessInventoryPath), {
        costoPromedio: 10,
        ultimoCosto: 10,
        actualizadoEn: serverTimestamp(),
      })
    );

    const businessQuotePath =
      `negocios/${businessId}/cotizaciones/quote-managed`;
    await adminDb.doc(businessQuotePath).set({
      negocioId: businessId,
      numero: "COT-2026-0001",
      estado: "emitida",
    });
    await expectDenied("cliente SDK fuerza rechazo de cotizacion", () =>
      updateDoc(doc(ownerClient.db, businessQuotePath), {
        estado: "rechazada",
        actualizadoEn: serverTimestamp(),
      })
    );
    await expectDenied("cliente SDK crea evento de cotizacion", () =>
      setDoc(doc(ownerClient.db, `${businessQuotePath}/eventos/forged`), {
        tipo: "respuesta_cliente",
        estadoResultante: "aceptada",
      })
    );

    const businessClientPath =
      `negocios/${businessId}/clientes/client-rules-smoke`;
    const businessClientRutKeyPath =
      `negocios/${businessId}/clientRutKeys/123456785`;
    const unknownBusinessPath =
      `negocios/${businessId}/coleccionNoDeclarada/documento-smoke`;
    const foreignBusinessId = `rules-foreign-${guestUid}`;
    const foreignClientPath =
      `negocios/${foreignBusinessId}/clientes/foreign-client-smoke`;
    const businessWorkPath =
      `negocios/${businessId}/trabajos/work-rules-smoke`;
    const businessWorkTaskPath = `${businessWorkPath}/tareas/task-rules-smoke`;
    const businessWorkTaskDocumentationPath = `${businessWorkTaskPath}/documentacion/documentation-rules-smoke`;
    const businessWorkNotePath = `${businessWorkPath}/notas/note-rules-smoke`;
    const businessWorkHistoryPath = `${businessWorkPath}/historial/event-rules-smoke`;
    const businessWorkLinkPath = `${businessWorkPath}/vinculos/cotizacion__quote-rules-smoke`;
    const businessWorkExpensePath = `${businessWorkPath}/gastos/expense-rules-smoke`;
    const businessWorkLaborPath = `${businessWorkPath}/horasHombre/labor-rules-smoke`;
    const businessWorkMaterialMovementPath = `negocios/${businessId}/movimientosInventario/material-rules-smoke`;
    const businessAcquisitionPath = `negocios/${businessId}/adquisicionesInventario/acquisition-rules-smoke`;
    await Promise.all([
      adminDb.doc(businessClientPath).set({
        clienteId: "client-rules-smoke",
        negocioId: businessId,
        modeloClienteVersion: 1,
        tipoCliente: "empresa",
        rut: "12.345.678-5",
        rutNormalizado: "12345678-5",
        nombreRazonSocial: "Cliente de reglas",
        estado: "activo",
      }),
      adminDb.doc(businessClientRutKeyPath).set({
        clienteId: "client-rules-smoke",
        negocioId: businessId,
        rutNormalizado: "12345678-5",
        estadoCliente: "activo",
      }),
      adminDb.doc(businessAcquisitionPath).set({
        adquisicionId: "acquisition-rules-smoke",
        negocioId: businessId,
        itemId: "item-rules-smoke",
        recepcionId: "reception-rules-smoke",
      }),
      adminDb.doc(unknownBusinessPath).set({
        negocioId: businessId,
        contenido: "no debe ser legible desde el SDK cliente",
      }),
      adminDb.doc(`negocios/${foreignBusinessId}`).set({
        nombreComercial: "Empresa externa de reglas",
        estado: "activo",
      }),
      adminDb.doc(`membresias/${foreignBusinessId}__${guestUid}`).set({
        negocioId: foreignBusinessId,
        uid: guestUid,
        rol: "OWNER",
        estado: "activo",
      }),
      adminDb.doc(foreignClientPath).set({
        clienteId: "foreign-client-smoke",
        negocioId: foreignBusinessId,
        modeloClienteVersion: 1,
        tipoCliente: "empresa",
        rut: "11.111.111-1",
        rutNormalizado: "11111111-1",
        nombreRazonSocial: "Cliente externo",
        estado: "activo",
      }),
      adminDb.doc(businessWorkPath).set({
        trabajoId: "work-rules-smoke",
        negocioId: businessId,
        numero: "TRB-2026-0001",
        titulo: "Trabajo de reglas",
        estado: "pendiente",
        prioridad: "normal",
      }),
      adminDb.doc(businessWorkTaskPath).set({
        tareaId: "task-rules-smoke",
        trabajoId: "work-rules-smoke",
        negocioId: businessId,
        titulo: "Tarea protegida",
        completada: false,
      }),
      adminDb.doc(businessWorkTaskDocumentationPath).set({
        documentacionId: "documentation-rules-smoke",
        tareaId: "task-rules-smoke",
        trabajoId: "work-rules-smoke",
        negocioId: businessId,
        texto: "Documentación protegida",
      }),
      adminDb.doc(businessWorkNotePath).set({
        notaId: "note-rules-smoke",
        trabajoId: "work-rules-smoke",
        negocioId: businessId,
        texto: "Nota protegida",
      }),
      adminDb.doc(businessWorkHistoryPath).set({
        eventoId: "event-rules-smoke",
        trabajoId: "work-rules-smoke",
        negocioId: businessId,
        tipo: "trabajo_creado",
      }),
      adminDb.doc(businessWorkLinkPath).set({
        vinculoId: "cotizacion__quote-rules-smoke",
        trabajoId: "work-rules-smoke",
        negocioId: businessId,
        tipoDocumento: "cotizacion",
        documentoId: "quote-rules-smoke",
      }),
      adminDb.doc(businessWorkExpensePath).set({
        gastoId: "expense-rules-smoke",
        trabajoId: "work-rules-smoke",
        negocioId: businessId,
        concepto: "Material protegido",
        monto: 1000,
        categoria: "MATERIAL",
        estado: "vigente",
      }),
      adminDb.doc(businessWorkLaborPath).set({
        horasHombreId: "labor-rules-smoke",
        trabajoId: "work-rules-smoke",
        negocioId: businessId,
        concepto: "HH protegidas",
        horas: 2,
        costoHora: 1000,
        total: 2000,
        estado: "vigente",
      }),
      adminDb.doc(businessWorkMaterialMovementPath).set({
        movimientoId: "material-rules-smoke",
        trabajoId: "work-rules-smoke",
        negocioId: businessId,
        itemId: "product-rules-smoke",
        tipo: "SALIDA_PROYECTO",
        cantidad: 1,
        costoUnitario: 1000,
        costoTotal: 1000,
      }),
      adminDb.doc(`negocios/${businessId}/workCounters/2026`).set({
        negocioId: businessId,
        ultimoNumero: 1,
      }),
      adminDb.doc(`negocios/${businessId}/workCreateRequests/request-smoke`).set({
        negocioId: businessId,
        trabajoId: "work-rules-smoke",
      }),
      adminDb.doc(`negocios/${businessId}/workTaskRequests/task-request-smoke`).set({
        negocioId: businessId,
        trabajoId: "work-rules-smoke",
        tareaId: "task-rules-smoke",
      }),
      adminDb.doc(`negocios/${businessId}/workCostRequests/cost-request-smoke`).set({
        negocioId: businessId,
        trabajoId: "work-rules-smoke",
        registroId: "expense-rules-smoke",
      }),
      adminDb.doc(`negocios/${businessId}/workMaterialRequests/material-request-smoke`).set({
        negocioId: businessId,
        trabajoId: "work-rules-smoke",
        registroId: "material-rules-smoke",
      }),
      adminDb.doc(`negocios/${businessId}/workMaterialBalances/material-rules-smoke`).set({
        negocioId: businessId,
        trabajoId: "work-rules-smoke",
        movimientoOrigenId: "material-rules-smoke",
        cantidadSalida: 1,
        cantidadDevuelta: 0,
      }),
    ]);
    if (!(await getDoc(doc(ownerClient.db, businessClientPath))).exists()) {
      throw new Error("El miembro OWNER no pudo leer clientes del negocio.");
    }
    console.log("OK permitido: miembro activo lee clientes del negocio");
    for (const protectedPath of [businessWorkPath, businessWorkTaskPath, businessWorkTaskDocumentationPath, businessWorkNotePath, businessWorkHistoryPath, businessWorkLinkPath, businessWorkExpensePath, businessWorkLaborPath]) {
      if (!(await getDoc(doc(ownerClient.db, protectedPath))).exists()) {
        throw new Error(`El miembro activo no pudo leer ${protectedPath}.`);
      }
    }
    console.log("OK permitido: miembro activo lee trabajo, tareas, notas e historial");
    const taskDocumentationSnapshot = await getDocs(query(
      collection(ownerClient.db, businessWorkTaskPath, "documentacion"),
      where("negocioId", "==", businessId),
      where("trabajoId", "==", "work-rules-smoke"),
      where("tareaId", "==", "task-rules-smoke")
    ));
    if (taskDocumentationSnapshot.size !== 1) {
      throw new Error("La consulta no devolviÃ³ la documentaciÃ³n de tarea esperada.");
    }
    console.log("OK permitido: miembro activo lista documentaciÃ³n de tarea");
    for (const [collectionName, label] of [["gastos", "gastos"], ["horasHombre", "HH"]]) {
      const snapshot = await getDocs(query(
        collection(ownerClient.db, businessWorkPath, collectionName),
        where("negocioId", "==", businessId),
        where("trabajoId", "==", "work-rules-smoke")
      ));
      if (snapshot.size !== 1) throw new Error(`La consulta no devolvió ${label}.`);
    }
    console.log("OK permitido: miembro activo lista gastos y HH");
    const materialMovementsSnapshot = await getDocs(query(
      collection(ownerClient.db, "negocios", businessId, "movimientosInventario"),
      where("negocioId", "==", businessId),
      where("trabajoId", "==", "work-rules-smoke")
    ));
    if (materialMovementsSnapshot.size !== 1) throw new Error("La consulta no devolvió los materiales del trabajo.");
    console.log("OK permitido: miembro activo lista movimientos de materiales del trabajo");
    const acquisitionsSnapshot = await getDocs(query(
      collection(ownerClient.db, "negocios", businessId, "adquisicionesInventario"),
      where("negocioId", "==", businessId),
      where("itemId", "==", "item-rules-smoke")
    ));
    if (acquisitionsSnapshot.size !== 1) throw new Error("La consulta no devolvió la adquisición esperada.");
    console.log("OK permitido: miembro activo lista adquisiciones del inventario");
    await expectDenied("usuario sin membresía lee trabajo", () =>
      getDoc(doc(guestClient.db, businessWorkPath))
    );
    await expectDenied("usuario sin membresía lee costos del trabajo", () =>
      getDoc(doc(guestClient.db, businessWorkExpensePath))
    );
    const businessWorksCollection = collection(ownerClient.db, "negocios", businessId, "trabajos");
    const filteredWorksSnapshot = await getDocs(query(businessWorksCollection, where("negocioId", "==", businessId)));
    if (filteredWorksSnapshot.size !== 1) {
      throw new Error("La consulta filtrada no devolvió el trabajo esperado.");
    }
    console.log("OK permitido: consulta de trabajos filtrada por negocioId");
    const ownerTasksSnapshot = await getDocs(query(
      collection(ownerClient.db, businessWorkPath, "tareas"),
      where("negocioId", "==", businessId),
      where("trabajoId", "==", "work-rules-smoke")
    ));
    if (ownerTasksSnapshot.size !== 1) {
      throw new Error("OWNER no pudo listar las tareas del trabajo.");
    }
    console.log("OK permitido: OWNER lista tareas con la consulta usada por la ficha");
    await expectDenied("OWNER crea trabajo directamente", () =>
      setDoc(doc(ownerClient.db, `negocios/${businessId}/trabajos/direct-work`), {negocioId: businessId, titulo: "Directo"})
    );
    await expectDenied("OWNER edita trabajo directamente", () =>
      updateDoc(doc(ownerClient.db, businessWorkPath), {titulo: "Edición directa"})
    );
    await expectDenied("OWNER escribe tarea directamente", () =>
      setDoc(doc(ownerClient.db, `${businessWorkPath}/tareas/direct-task`), {negocioId: businessId, trabajoId: "work-rules-smoke", titulo: "Directa"})
    );
    await expectDenied("OWNER edita tarea directamente", () =>
      updateDoc(doc(ownerClient.db, businessWorkTaskPath), {estado: "completada", completada: true})
    );
    await expectDenied("OWNER documenta tarea directamente", () =>
      setDoc(doc(ownerClient.db, `${businessWorkTaskPath}/documentacion/direct-documentation`), {negocioId: businessId, trabajoId: "work-rules-smoke", tareaId: "task-rules-smoke", texto: "Directa"})
    );
    await expectDenied("OWNER escribe nota directamente", () =>
      setDoc(doc(ownerClient.db, `${businessWorkPath}/notas/direct-note`), {negocioId: businessId, trabajoId: "work-rules-smoke", texto: "Directa"})
    );
    await expectDenied("OWNER escribe historial directamente", () =>
      setDoc(doc(ownerClient.db, `${businessWorkPath}/historial/direct-event`), {negocioId: businessId, trabajoId: "work-rules-smoke", tipo: "forjado"})
    );
    await expectDenied("OWNER escribe vínculo comercial directamente", () =>
      setDoc(doc(ownerClient.db, `${businessWorkPath}/vinculos/direct-link`), {negocioId: businessId, trabajoId: "work-rules-smoke", tipoDocumento: "venta"})
    );
    await expectDenied("OWNER crea gasto directamente", () =>
      setDoc(doc(ownerClient.db, `${businessWorkPath}/gastos/direct-expense`), {negocioId: businessId, trabajoId: "work-rules-smoke", concepto: "Directo", monto: 1})
    );
    await expectDenied("OWNER edita gasto directamente", () =>
      updateDoc(doc(ownerClient.db, businessWorkExpensePath), {monto: 2})
    );
    await expectDenied("OWNER elimina gasto directamente", () =>
      deleteDoc(doc(ownerClient.db, businessWorkExpensePath))
    );
    await expectDenied("OWNER crea HH directamente", () =>
      setDoc(doc(ownerClient.db, `${businessWorkPath}/horasHombre/direct-labor`), {negocioId: businessId, trabajoId: "work-rules-smoke", horas: 1, costoHora: 1, total: 1})
    );
    await expectDenied("OWNER edita HH directamente", () =>
      updateDoc(doc(ownerClient.db, businessWorkLaborPath), {total: 1})
    );
    await expectDenied("OWNER elimina HH directamente", () =>
      deleteDoc(doc(ownerClient.db, businessWorkLaborPath))
    );
    await expectDenied("OWNER crea movimiento de material directamente", () =>
      setDoc(doc(ownerClient.db, `negocios/${businessId}/movimientosInventario/direct-material`), {negocioId: businessId, trabajoId: "work-rules-smoke", tipo: "SALIDA_PROYECTO"})
    );
    await expectDenied("OWNER crea adquisición directamente", () =>
      setDoc(doc(ownerClient.db, `negocios/${businessId}/adquisicionesInventario/direct-acquisition`), {negocioId: businessId, itemId: "item-rules-smoke"})
    );
    await expectDenied("OWNER edita adquisición directamente", () =>
      updateDoc(doc(ownerClient.db, businessAcquisitionPath), {costoPagadoTotal: 1})
    );
    await expectDenied("OWNER elimina adquisición directamente", () =>
      deleteDoc(doc(ownerClient.db, businessAcquisitionPath))
    );
    await expectDenied("OWNER edita movimiento de material directamente", () =>
      updateDoc(doc(ownerClient.db, businessWorkMaterialMovementPath), {cantidad: 2})
    );
    await expectDenied("OWNER elimina movimiento de material directamente", () =>
      deleteDoc(doc(ownerClient.db, businessWorkMaterialMovementPath))
    );
    await expectDenied("workCounters bloquea lectura directa", () =>
      getDoc(doc(ownerClient.db, `negocios/${businessId}/workCounters/2026`))
    );
    await expectDenied("workCreateRequests bloquea lectura directa", () =>
      getDoc(doc(ownerClient.db, `negocios/${businessId}/workCreateRequests/request-smoke`))
    );
    await expectDenied("workTaskRequests bloquea lectura directa", () =>
      getDoc(doc(ownerClient.db, `negocios/${businessId}/workTaskRequests/task-request-smoke`))
    );
    await expectDenied("workCostRequests bloquea lectura directa", () =>
      getDoc(doc(ownerClient.db, `negocios/${businessId}/workCostRequests/cost-request-smoke`))
    );
    await expectDenied("workMaterialRequests bloquea lectura directa", () =>
      getDoc(doc(ownerClient.db, `negocios/${businessId}/workMaterialRequests/material-request-smoke`))
    );
    await expectDenied("workMaterialBalances bloquea lectura directa", () =>
      getDoc(doc(ownerClient.db, `negocios/${businessId}/workMaterialBalances/material-rules-smoke`))
    );
    await expectDenied("usuario sin membresía lee clientes", () =>
      getDoc(doc(guestClient.db, businessClientPath))
    );
    const businessClientsCollection = collection(
      ownerClient.db,
      "negocios",
      businessId,
      "clientes"
    );
    const filteredClientsSnapshot = await getDocs(
      query(
        businessClientsCollection,
        where("negocioId", "==", businessId)
      )
    );
    if (filteredClientsSnapshot.size !== 1) {
      throw new Error("La consulta filtrada no devolvió el cliente esperado.");
    }
    console.log("OK permitido: consulta clientes filtrada por negocioId");
    await expectDenied("consulta clientes sin filtro de negocioId", () =>
      getDocs(businessClientsCollection)
    );
    await expectDenied("consulta cruzada de clientes de otro negocio", () =>
      getDocs(
        query(
          collection(
            ownerClient.db,
            "negocios",
            foreignBusinessId,
            "clientes"
          ),
          where("negocioId", "==", foreignBusinessId)
        )
      )
    );
    await expectDenied("miembro de otro negocio consulta clientes", () =>
      getDocs(
        query(
          collection(
            guestClient.db,
            "negocios",
            businessId,
            "clientes"
          ),
          where("negocioId", "==", businessId)
        )
      )
    );
    await expectDenied("lectura de subcolección desconocida", () =>
      getDoc(doc(ownerClient.db, unknownBusinessPath))
    );
    await expectDenied("OWNER crea cliente directamente", () =>
      setDoc(
        doc(
          ownerClient.db,
          `negocios/${businessId}/clientes/client-direct-create`
        ),
        {
          clienteId: "client-direct-create",
          negocioId: businessId,
          tipoCliente: "empresa",
          rut: "11.111.111-1",
          rutNormalizado: "11111111-1",
          nombreRazonSocial: "Creación directa",
          estado: "activo",
        }
      )
    );
    await expectDenied("OWNER edita cliente directamente", () =>
      updateDoc(doc(ownerClient.db, businessClientPath), {
        nombreRazonSocial: "Edición directa",
      })
    );
    await expectDenied("OWNER elimina cliente directamente", () =>
      deleteDoc(doc(ownerClient.db, businessClientPath))
    );
    await expectDenied("clientRutKeys bloquea lectura directa", () =>
      getDoc(doc(ownerClient.db, businessClientRutKeyPath))
    );
    const clientRutKeysCollection = collection(
      ownerClient.db,
      "negocios",
      businessId,
      "clientRutKeys"
    );
    await expectDenied("clientRutKeys bloquea listado", () =>
      getDocs(clientRutKeysCollection)
    );
    await expectDenied("clientRutKeys bloquea consulta", () =>
      getDocs(
        query(
          clientRutKeysCollection,
          where("estadoCliente", "==", "activo")
        )
      )
    );
    await expectDenied("clientRutKeys bloquea collectionGroup", () =>
      getDocs(collectionGroup(ownerClient.db, "clientRutKeys"))
    );
    await expectDenied("clientRutKeys bloquea creación directa", () =>
      setDoc(
        doc(
          ownerClient.db,
          `negocios/${businessId}/clientRutKeys/111111111`
        ),
        {
          clienteId: "forged",
          negocioId: businessId,
          rutNormalizado: "11111111-1",
          estadoCliente: "activo",
        }
      )
    );
    await expectDenied("clientRutKeys bloquea actualización directa", () =>
      updateDoc(doc(ownerClient.db, businessClientRutKeyPath), {
        clienteId: "forged",
      })
    );
    await expectDenied("clientRutKeys bloquea eliminación directa", () =>
      deleteDoc(doc(ownerClient.db, businessClientRutKeyPath))
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
    if (!(await getDoc(doc(otherClient.db, businessClientPath))).exists()) {
      throw new Error("El MEMBER no pudo consultar clientes del negocio.");
    }
    console.log("OK permitido: MEMBER lee clientes del negocio");
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

    const businessProviderPath = `negocios/${businessId}/proveedores/provider-rbac`;
    const businessPurchasePath = `negocios/${businessId}/compras/purchase-rbac`;
    const businessSalePath = `negocios/${businessId}/ventas/sale-rbac`;
    const unassignedWorkPath = `negocios/${businessId}/trabajos/work-unassigned-rbac`;
    await Promise.all([
      adminDb.doc(businessProviderPath).set({negocioId: businessId, proveedorId: "provider-rbac", estado: "activo"}),
      adminDb.doc(businessPurchasePath).set({negocioId: businessId, compraId: "purchase-rbac", estado: "confirmada"}),
      adminDb.doc(businessSalePath).set({negocioId: businessId, ventaId: "sale-rbac", estado: "confirmada"}),
      adminDb.doc(unassignedWorkPath).set({negocioId: businessId, trabajoId: "work-unassigned-rbac", titulo: "No asignado", participanteUids: []}),
      adminDb.doc(businessWorkPath).update({participanteUids: [otherUid]}),
      adminDb.doc(businessWorkTaskPath).update({responsableUid: otherUid}),
      adminDb.doc(businessWorkExpensePath).update({registradoPorUid: otherUid, responsableDelGastoUid: otherUid}),
      adminDb.doc(businessWorkLaborPath).update({registradoPorUid: otherUid, tecnicoUid: otherUid}),
    ]);

    await adminDb.doc(`membresias/${businessId}__${otherUid}`).update({rol: "VENTAS"});
    for (const readablePath of [businessClientPath, businessQuotePath, businessSalePath, businessInventoryPath]) {
      if (!(await getDoc(doc(otherClient.db, readablePath))).exists()) throw new Error(`VENTAS no leyó ${readablePath}`);
    }
    await expectDenied("VENTAS no consulta proveedores", () => getDoc(doc(otherClient.db, businessProviderPath)));
    await expectDenied("VENTAS no consulta compras", () => getDoc(doc(otherClient.db, businessPurchasePath)));
    await expectDenied("VENTAS no consulta finanzas", () => getDoc(doc(otherClient.db, ownerMovementPath)));
    console.log("OK RBAC Rules: VENTAS aislado del dominio de compras y finanzas");

    await adminDb.doc(`membresias/${businessId}__${otherUid}`).update({rol: "COMPRAS"});
    for (const readablePath of [businessProviderPath, businessPurchasePath, businessInventoryPath, businessAcquisitionPath]) {
      if (!(await getDoc(doc(otherClient.db, readablePath))).exists()) throw new Error(`COMPRAS no leyó ${readablePath}`);
    }
    await updateDoc(doc(otherClient.db, businessInventoryPath), {nombre: "Producto editado por COMPRAS", actualizadoEn: serverTimestamp()});
    await expectDenied("COMPRAS no consulta clientes", () => getDoc(doc(otherClient.db, businessClientPath)));
    await expectDenied("COMPRAS no consulta ventas", () => getDoc(doc(otherClient.db, businessSalePath)));
    console.log("OK RBAC Rules: COMPRAS gestiona inventario sin acceso comercial");

    await adminDb.doc(`membresias/${businessId}__${otherUid}`).update({rol: "TECNICO"});
    for (const readablePath of [businessWorkPath, businessWorkTaskPath, businessWorkExpensePath, businessWorkLaborPath, businessWorkMaterialMovementPath]) {
      if (!(await getDoc(doc(otherClient.db, readablePath))).exists()) throw new Error(`TECNICO no leyó ${readablePath}`);
    }
    const assignedWorks = await getDocs(query(
      collection(otherClient.db, "negocios", businessId, "trabajos"),
      where("negocioId", "==", businessId),
      where("participanteUids", "array-contains", otherUid)
    ));
    if (assignedWorks.size !== 1) throw new Error("TECNICO no pudo listar sus proyectos asignados");
    const assignedTasks = await getDocs(query(
      collection(otherClient.db, businessWorkPath, "tareas"),
      where("negocioId", "==", businessId),
      where("trabajoId", "==", "work-rules-smoke"),
      where("responsableUid", "==", otherUid)
    ));
    if (assignedTasks.size !== 1) throw new Error("TECNICO no pudo listar sus tareas asignadas");
    await expectDenied("TECNICO no lista tareas sin filtro de asignación", () =>
      getDocs(query(
        collection(otherClient.db, businessWorkPath, "tareas"),
        where("negocioId", "==", businessId),
        where("trabajoId", "==", "work-rules-smoke")
      ))
    );
    await expectDenied("TECNICO no consulta proyectos no asignados", () => getDoc(doc(otherClient.db, unassignedWorkPath)));
    await expectDenied("TECNICO no consulta ventas", () => getDoc(doc(otherClient.db, businessSalePath)));
    await expectDenied("TECNICO no consulta finanzas", () => getDoc(doc(otherClient.db, ownerMovementPath)));
    await expectDenied("TECNICO no consulta adquisiciones", () => getDoc(doc(otherClient.db, businessAcquisitionPath)));
    console.log("OK RBAC Rules: TECNICO limitado a expediente y registros asignados");

    await adminDb.doc(`membresias/${businessId}__${otherUid}`).update({rol: "FINANZAS"});
    for (const readablePath of [businessSalePath, businessPurchasePath, ownerMovementPath, businessAcquisitionPath, businessWorkPath, businessWorkExpensePath]) {
      if (!(await getDoc(doc(otherClient.db, readablePath))).exists()) throw new Error(`FINANZAS no leyó ${readablePath}`);
    }
    await expectDenied("FINANZAS no consulta clientes", () => getDoc(doc(otherClient.db, businessClientPath)));
    await expectDenied("FINANZAS no consulta proveedores", () => getDoc(doc(otherClient.db, businessProviderPath)));
    await expectDenied("FINANZAS no consulta tareas operativas", () => getDoc(doc(otherClient.db, businessWorkTaskPath)));
    console.log("OK RBAC Rules: FINANZAS consulta economía sin administrar operación");

    await adminDb.doc(`membresias/${businessId}__${otherUid}`).update({rol: "MEMBER"});
    if (!(await getDoc(doc(otherClient.db, businessClientPath))).exists()) throw new Error("MEMBER legacy perdió su lectura histórica");
    const memberTasksSnapshot = await getDocs(query(
      collection(otherClient.db, businessWorkPath, "tareas"),
      where("negocioId", "==", businessId),
      where("trabajoId", "==", "work-rules-smoke")
    ));
    if (memberTasksSnapshot.size !== 1) throw new Error("MEMBER no pudo listar las tareas del trabajo");
    console.log("OK RBAC Rules: MEMBER legacy conserva lectura compatible");

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

    const verificationEvidencePath = `negocios/${businessId}/verificacion/${ownerUid}/verification-rules-request/documento.pdf`;
    await uploadBytes(
      ref(ownerClient.storage, verificationEvidencePath),
      new TextEncoder().encode("evidencia empresarial"),
      {contentType: "application/pdf"}
    );
    console.log("OK permitido: OWNER sube evidencia de verificación");
    await expectDenied("otro usuario sube evidencia de verificación", () =>
      uploadBytes(
        ref(otherClient.storage, `negocios/${businessId}/verificacion/${otherUid}/verification-rules-request/documento.pdf`),
        new TextEncoder().encode("evidencia ajena"),
        {contentType: "application/pdf"}
      )
    );
    await expectDenied("OWNER sobrescribe evidencia de verificación", () =>
      uploadBytes(
        ref(ownerClient.storage, verificationEvidencePath),
        new TextEncoder().encode("reemplazo"),
        {contentType: "application/pdf"}
      )
    );
    await expectDenied("OWNER elimina evidencia de verificación", () =>
      deleteObject(ref(ownerClient.storage, verificationEvidencePath))
    );

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

    await adminDb.doc(`usuarios/${ownerUid}`).set(
      {estadoPlataforma: "suspendido"},
      {merge: true}
    );
    await expectDenied("usuario suspendido lee empresa", () =>
      getDoc(doc(ownerClient.db, `negocios/${businessId}`))
    );
    await expectDenied("usuario suspendido lee perfil propio", () =>
      getDoc(doc(ownerClient.db, personalProfilePath))
    );
    await expectDenied("usuario suspendido escribe Storage", () =>
      uploadBytes(
        ref(ownerClient.storage, `usuarios/${ownerUid}/empresa/logo/suspendido.png`),
        new Uint8Array([137, 80, 78, 71]),
        {contentType: "image/png"}
      )
    );
    console.log("OK denegado: suspension de plataforma cierra SDK y Storage");

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
