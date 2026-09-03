import {deleteApp, initializeApp} from "firebase/app";
import {connectAuthEmulator, getAuth, signInAnonymously} from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {createRequire} from "node:module";
import assert from "node:assert/strict";

const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const {initializeApp: initAdmin, deleteApp: deleteAdmin} = requireFromFunctions("firebase-admin/app");
const {getFirestore: getAdminFirestore} = requireFromFunctions("firebase-admin/firestore");

const PROJECT_ID = "tesis-inventario-ia";

async function client(label) {
  const app = initializeApp({apiKey: "demo-key", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID}, `inv-budget-${label}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const cred = await signInAnonymously(auth);
  return {app, db, uid: cred.user.uid};
}

async function expectDenied(label, operation) {
  try {
    await operation();
  } catch (error) {
    const code = String(error?.code || "");
    if (code.includes("permission-denied") || code.includes("unauthorized")) {
      console.log(`OK denegado: ${label}`);
      return;
    }
    throw error;
  }
  throw new Error(`Se esperaba denegacion: ${label}`);
}

const adminApp = initAdmin({projectId: PROJECT_ID}, "inv-budget-admin");
const adminDb = getAdminFirestore(adminApp);

const owner = await client("owner");
const outsider = await client("outsider");
const memberVentas = await client("ventas");

const businessId = "inv-budget-business";
const otherBusinessId = "inv-budget-other-business";

await Promise.all([
  adminDb.doc(`usuarios/${owner.uid}`).set({negocioActivoId: businessId, estadoPlataforma: "activo"}),
  adminDb.doc(`usuarios/${outsider.uid}`).set({negocioActivoId: otherBusinessId, estadoPlataforma: "activo"}),
  adminDb.doc(`usuarios/${memberVentas.uid}`).set({negocioActivoId: businessId, estadoPlataforma: "activo"}),
  adminDb.doc(`negocios/${businessId}`).set({estado: "activo", verificacionEmpresa: {estado: "VERIFICADA"}}),
  adminDb.doc(`negocios/${otherBusinessId}`).set({estado: "activo", verificacionEmpresa: {estado: "VERIFICADA"}}),
  adminDb.doc(`membresias/${businessId}__${owner.uid}`).set({negocioId: businessId, uid: owner.uid, rol: "OWNER", estado: "activo"}),
  adminDb.doc(`membresias/${otherBusinessId}__${outsider.uid}`).set({negocioId: otherBusinessId, uid: outsider.uid, rol: "OWNER", estado: "activo"}),
  adminDb.doc(`membresias/${businessId}__${memberVentas.uid}`).set({negocioId: businessId, uid: memberVentas.uid, rol: "VENTAS", estado: "activo"}),
]);

// ================================================================
// PARTE 1 — LEGACY: usuarios/{uid}/inventario/{itemId}
// ================================================================
const legacyAreaPath = `usuarios/${owner.uid}/areas/area-ok`;
const legacyCategoryPath = `usuarios/${owner.uid}/categoriasInventario/category-ok`;
const legacyOtherAreaPath = `usuarios/${outsider.uid}/areas/area-foreign`;
const legacyOtherCategoryPath = `usuarios/${outsider.uid}/categoriasInventario/category-foreign`;
const legacyMismatchCategoryPath = `usuarios/${owner.uid}/categoriasInventario/category-mismatch`;

await Promise.all([
  adminDb.doc(legacyAreaPath).set({nombre: "Informática", estado: "activo", uidUsuario: owner.uid}),
  adminDb.doc(legacyCategoryPath).set({areaId: "area-ok", nombre: "Hardware", estado: "activo", uidUsuario: owner.uid}),
  adminDb.doc(legacyOtherAreaPath).set({nombre: "Área ajena", estado: "activo", uidUsuario: outsider.uid}),
  adminDb.doc(legacyOtherCategoryPath).set({areaId: "area-foreign", nombre: "Cat ajena", estado: "activo", uidUsuario: outsider.uid}),
  adminDb.doc(legacyMismatchCategoryPath).set({areaId: "otra-area-inexistente", nombre: "Cat sin área", estado: "activo", uidUsuario: owner.uid}),
]);

async function seedLegacyItem(itemId, extra = {}) {
  const path = `usuarios/${owner.uid}/inventario/${itemId}`;
  await setDoc(doc(owner.db, path), {
    nombre: "Item de prueba",
    tipoItem: "producto",
    unidad: "unidad",
    costoBase: 1000,
    margenDeseado: 20,
    precioInterno: 1200,
    stock: 3,
    stockMinimo: 1,
    sku: `SKU-${itemId}`,
    estado: "activo",
    creadoDesdeCotizacion: true,
    uidUsuario: owner.uid,
    actualizadoEn: serverTimestamp(),
  }, {merge: false});
  return path;
}

// --- CASOS POSITIVOS (legacy) ---

// 1. Usuario autorizado actualiza ítem moderno válido (V2, canónico) — ver Parte 2.
// 2/6. Usuario autorizado actualiza ítem legacy sin tocar catálogo/campos
// protegidos. hasValidInventoryStructure exige categoria (string no vacío)
// en TODO update, heredado o no — un ítem recién creado vía
// isAllowedLegacyInventoryCreate() (que NO exige categoria) por tanto no es
// editable hasta adoptar catálogo una primera vez; se construye el caso
// sobre un ítem que YA adoptó catálogo (mismo estado que casos 3/4/5),
// reflejando el contrato real, no uno inventado.
{
  const path = await seedLegacyItem("pos-legacy-edit");
  await updateDoc(doc(owner.db, path), {
    areaId: "area-ok", categoriaId: "category-ok", categoria: "Hardware",
    marca: "Lenovo", modelo: "T14", actualizadoEn: serverTimestamp(),
  });
  await updateDoc(doc(owner.db, path), {actualizadoEn: serverTimestamp()});
  console.log("OK casos 2/6: OWNER edita ítem legacy (ya con catálogo asignado) sin tocar catálogo ni campos protegidos");
}

// 3/4/5. legacy adopta área válida / categoría válida / ambas.
{
  const path = await seedLegacyItem("pos-legacy-area-cat");
  await updateDoc(doc(owner.db, path), {
    areaId: "area-ok",
    categoriaId: "category-ok",
    categoria: "Hardware",
    marca: "Lenovo",
    modelo: "T14",
    actualizadoEn: serverTimestamp(),
  });
  const stored = await getDoc(doc(owner.db, path));
  assert.equal(stored.data().areaId, "area-ok");
  assert.equal(stored.data().categoriaId, "category-ok");
  console.log("OK casos 3/4/5: legacy adopta área y categoría válidas (ambas) sin agotar presupuesto");
}

// 7. ítem con relación ya válida sigue editable según contrato (segunda edición tras adoptar catálogo).
{
  const path = await seedLegacyItem("pos-legacy-already-valid");
  await updateDoc(doc(owner.db, path), {
    areaId: "area-ok", categoriaId: "category-ok", categoria: "Hardware",
    marca: "Lenovo", modelo: "T14", actualizadoEn: serverTimestamp(),
  });
  await updateDoc(doc(owner.db, path), {
    areaId: "area-ok", categoriaId: "category-ok", categoria: "Hardware",
    marca: "Lenovo", modelo: "T14 Gen2", actualizadoEn: serverTimestamp(),
  });
  console.log("OK caso 7: ítem con relación de catálogo ya válida sigue editable en ediciones subsiguientes");
}

// 8/9. OWNER válido (ya cubierto arriba en todos los casos). ADMIN válido:
{
  await adminDb.doc(`membresias/${businessId}__${owner.uid}`).set({negocioId: businessId, uid: owner.uid, rol: "ADMIN", estado: "activo"});
  const path = await seedLegacyItem("pos-admin-edit");
  await updateDoc(doc(owner.db, path), {
    areaId: "area-ok", categoriaId: "category-ok", categoria: "Hardware",
    marca: "Lenovo", modelo: "T14", actualizadoEn: serverTimestamp(),
  });
  await adminDb.doc(`membresias/${businessId}__${owner.uid}`).set({negocioId: businessId, uid: owner.uid, rol: "OWNER", estado: "activo"});
  console.log("OK casos 8/9: OWNER y ADMIN editan ítem legacy dentro de presupuesto");
}

// --- CASOS NEGATIVOS (legacy) ---

// 11. usuario no autenticado.
{
  const path = await seedLegacyItem("neg-unauth");
  const anonApp = initializeApp({apiKey: "demo-key", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID}, "inv-budget-noauth");
  const anonDb = getFirestore(anonApp);
  connectFirestoreEmulator(anonDb, "127.0.0.1", 8080);
  await expectDenied("usuario no autenticado actualiza ítem legacy", () =>
    updateDoc(doc(anonDb, path), {actualizadoEn: serverTimestamp()})
  );
  await deleteApp(anonApp);
}

// 12/21. usuario de otro negocio / cross-tenant por ID conocido.
{
  const path = await seedLegacyItem("neg-cross-tenant");
  await expectDenied("usuario de otro negocio (outsider) lee/edita ítem legacy ajeno por ID conocido", () =>
    updateDoc(doc(outsider.db, path), {actualizadoEn: serverTimestamp()})
  );
}

// 14/15. área de otro negocio / categoría de otro negocio (adoptadas por un item del owner).
{
  const path = await seedLegacyItem("neg-foreign-area");
  await expectDenied("legacy adopta área que pertenece a otro usuario/negocio", () =>
    updateDoc(doc(owner.db, path), {
      areaId: "area-foreign", categoriaId: "category-ok", categoria: "Hardware",
      marca: "Lenovo", modelo: "T14", actualizadoEn: serverTimestamp(),
    })
  );
}
{
  const path = await seedLegacyItem("neg-foreign-category");
  await expectDenied("legacy adopta categoría que pertenece a otro usuario/negocio", () =>
    updateDoc(doc(owner.db, path), {
      areaId: "area-ok", categoriaId: "category-foreign", categoria: "Cat ajena",
      marca: "Lenovo", modelo: "T14", actualizadoEn: serverTimestamp(),
    })
  );
}

// 16. categoría que no pertenece al área declarada.
{
  const path = await seedLegacyItem("neg-category-area-mismatch");
  await expectDenied("categoría cuyo areaId real no coincide con el area adoptada", () =>
    updateDoc(doc(owner.db, path), {
      areaId: "area-ok", categoriaId: "category-mismatch", categoria: "Cat sin área",
      marca: "Lenovo", modelo: "T14", actualizadoEn: serverTimestamp(),
    })
  );
}

// 17. IDs inexistentes.
{
  const path = await seedLegacyItem("neg-nonexistent-ids");
  await expectDenied("área/categoría inexistentes", () =>
    updateDoc(doc(owner.db, path), {
      areaId: "area-no-existe", categoriaId: "category-no-existe", categoria: "X",
      marca: "Lenovo", modelo: "T14", actualizadoEn: serverTimestamp(),
    })
  );
}

// 18. relación área/categoría inválida (categoriaId vacío con areaId presente).
{
  const path = await seedLegacyItem("neg-invalid-relation");
  await expectDenied("areaId presente sin categoriaId (relación incompleta)", () =>
    updateDoc(doc(owner.db, path), {
      areaId: "area-ok", categoria: "Hardware", marca: "Lenovo", modelo: "T14",
      actualizadoEn: serverTimestamp(),
    })
  );
}

// 19. rol sin permiso (VENTAS no opera inventario legacy de otro uid, y ni siquiera aplica a su propio uid vacío).
{
  await expectDenied("rol VENTAS (sin inventario propio) no puede leer/crear inventario legacy ajeno", () =>
    setDoc(doc(memberVentas.db, `usuarios/${owner.uid}/inventario/neg-role`), {
      nombre: "x", tipoItem: "producto", unidad: "u", costoBase: 1, margenDeseado: 1, precioInterno: 1,
      creadoDesdeCotizacion: true, uidUsuario: owner.uid,
    })
  );
}

// 20. intento de modificar campos protegidos (stock, estado — ya cubierto por rules-smoke.mjs; se reconfirma estado aquí).
{
  const path = await seedLegacyItem("neg-protected-field");
  await expectDenied("cliente intenta cambiar estado (campo protegido) en la misma llamada que toca catálogo", () =>
    updateDoc(doc(owner.db, path), {
      estado: "inactivo", areaId: "area-ok", categoriaId: "category-ok", categoria: "Hardware",
      marca: "Lenovo", modelo: "T14", actualizadoEn: serverTimestamp(),
    })
  );
}

// 22/23. create inválido / update inválido (estructura incompleta).
{
  await expectDenied("create legacy sin costoBase (estructura inválida)", () =>
    setDoc(doc(owner.db, `usuarios/${owner.uid}/inventario/neg-invalid-create`), {
      nombre: "x", tipoItem: "producto", unidad: "u", margenDeseado: 1, precioInterno: 1,
      creadoDesdeCotizacion: true, uidUsuario: owner.uid,
    })
  );
  const path = await seedLegacyItem("neg-invalid-update");
  await expectDenied("update legacy con tipoItem fuera de catálogo permitido", () =>
    updateDoc(doc(owner.db, path), {tipoItem: "otro", actualizadoEn: serverTimestamp()})
  );
}

// 24. delete no autorizado.
{
  const path = await seedLegacyItem("neg-delete");
  const {deleteDoc} = await import("firebase/firestore");
  await expectDenied("delete directo de ítem legacy", () => deleteDoc(doc(owner.db, path)));
}

console.log("PARTE 1 (legacy) completa — sin agotamiento de presupuesto en ningún caso.");

// ================================================================
// PARTE 2 — CANÓNICO: negocios/{businessId}/inventario/{itemId}
// ================================================================
const bizAreaPath = `negocios/${businessId}/areas/area-ok`;
const bizCategoryPath = `negocios/${businessId}/categoriasInventario/category-ok`;
const bizOtherAreaPath = `negocios/${otherBusinessId}/areas/area-foreign`;
const bizOtherCategoryPath = `negocios/${otherBusinessId}/categoriasInventario/category-foreign`;

await Promise.all([
  adminDb.doc(bizAreaPath).set({negocioId: businessId, nombre: "Informática", estado: "activo"}),
  adminDb.doc(bizCategoryPath).set({negocioId: businessId, areaId: "area-ok", nombre: "Hardware", estado: "activo"}),
  adminDb.doc(bizOtherAreaPath).set({negocioId: otherBusinessId, nombre: "Área ajena", estado: "activo"}),
  adminDb.doc(bizOtherCategoryPath).set({negocioId: otherBusinessId, areaId: "area-foreign", nombre: "Cat ajena", estado: "activo"}),
]);

async function seedBizItem(itemId, extra = {}) {
  const path = `negocios/${businessId}/inventario/${itemId}`;
  await adminDb.doc(path).set({
    negocioId: businessId,
    modeloInventarioVersion: 2,
    codigoInterno: `PR-${itemId}`,
    tipoItem: "producto",
    nombre: "Producto canónico",
    categoria: "",
    unidad: "unidad",
    costoBase: 1000,
    margenDeseado: 20,
    precioInterno: 1200,
    marca: "Dell",
    modelo: "R760",
    stock: 5,
    stockMinimo: 1,
    estado: "activo",
    ...extra,
  });
  return path;
}

// 1. Usuario autorizado actualiza ítem moderno válido (V2).
{
  const path = await seedBizItem("pos-v2-edit");
  await updateDoc(doc(owner.db, path), {nombre: "Producto canónico editado", actualizadoEn: serverTimestamp()});
  console.log("OK caso 1: OWNER edita ítem V2 canónico válido sin agotar presupuesto");
}

// 3/4/5 equivalentes canónicos: legacy (sin modeloInventarioVersion) adopta área/categoría.
async function seedBizLegacyItem(itemId) {
  const path = `negocios/${businessId}/inventario/${itemId}`;
  await adminDb.doc(path).set({
    negocioId: businessId,
    tipoItem: "producto",
    nombre: "Producto legacy de negocio",
    unidad: "unidad",
    costoBase: 1000,
    margenDeseado: 20,
    precioInterno: 1200,
    marca: "Dell",
    modelo: "R760",
    stock: 5,
    stockMinimo: 1,
    estado: "activo",
  });
  return path;
}
{
  const path = await seedBizLegacyItem("pos-biz-legacy-area-cat");
  await updateDoc(doc(owner.db, path), {
    areaId: "area-ok", categoriaId: "category-ok", categoria: "Hardware",
    actualizadoEn: serverTimestamp(),
  });
  console.log("OK casos 3/4/5 (canónico): legacy de negocio adopta área y categoría válidas");
}

// 6. edición normal sin cambiar catálogo (ya cubierto por caso 1).
// 7. relación ya válida sigue editable.
{
  const path = await seedBizItem("pos-v2-already-valid", {categoria: "Hardware"});
  await updateDoc(doc(owner.db, path), {nombre: "Editado otra vez", actualizadoEn: serverTimestamp()});
  console.log("OK caso 7 (canónico): ítem V2 con categoría ya asignada sigue editable");
}

// 9/10. ADMIN y COMPRAS válidos (roles autorizados para inventario canónico).
{
  await adminDb.doc(`membresias/${businessId}__${owner.uid}`).set({negocioId: businessId, uid: owner.uid, rol: "ADMIN", estado: "activo"});
  const path = await seedBizItem("pos-admin-v2");
  await updateDoc(doc(owner.db, path), {nombre: "Editado por ADMIN", actualizadoEn: serverTimestamp()});
  await adminDb.doc(`membresias/${businessId}__${owner.uid}`).set({negocioId: businessId, uid: owner.uid, rol: "COMPRAS", estado: "activo"});
  const path2 = await seedBizItem("pos-compras-v2");
  await updateDoc(doc(owner.db, path2), {nombre: "Editado por COMPRAS", actualizadoEn: serverTimestamp()});
  await adminDb.doc(`membresias/${businessId}__${owner.uid}`).set({negocioId: businessId, uid: owner.uid, rol: "OWNER", estado: "activo"});
  console.log("OK casos 9/10: ADMIN y COMPRAS editan ítem V2 canónico dentro de presupuesto");
}

// --- NEGATIVOS canónico ---

// 12/13/21. usuario de otro negocio / businessId manipulado / cross-tenant.
{
  const path = await seedBizItem("neg-biz-cross-tenant");
  await expectDenied("usuario de otro negocio edita ítem canónico ajeno por ID conocido", () =>
    updateDoc(doc(outsider.db, path), {nombre: "hackeado", actualizadoEn: serverTimestamp()})
  );
}

// 14/15. área/categoría de otro negocio.
{
  const path = await seedBizLegacyItem("neg-biz-foreign-area");
  await expectDenied("canónico adopta área de otro negocio", () =>
    updateDoc(doc(owner.db, path), {
      areaId: "area-foreign", categoriaId: "category-ok", categoria: "Hardware",
      actualizadoEn: serverTimestamp(),
    })
  );
}
{
  const path = await seedBizLegacyItem("neg-biz-foreign-category");
  await expectDenied("canónico adopta categoría de otro negocio", () =>
    updateDoc(doc(owner.db, path), {
      areaId: "area-ok", categoriaId: "category-foreign", categoria: "Cat ajena",
      actualizadoEn: serverTimestamp(),
    })
  );
}

// 17. IDs inexistentes.
{
  const path = await seedBizLegacyItem("neg-biz-nonexistent");
  await expectDenied("canónico: área/categoría inexistentes", () =>
    updateDoc(doc(owner.db, path), {
      areaId: "no-existe", categoriaId: "no-existe", actualizadoEn: serverTimestamp(),
    })
  );
}

// 19. rol sin permiso (VENTAS no administra inventario).
{
  const path = await seedBizItem("neg-biz-role");
  await expectDenied("rol VENTAS no puede editar inventario canónico", () =>
    updateDoc(doc(memberVentas.db, path), {nombre: "no autorizado", actualizadoEn: serverTimestamp()})
  );
}

// 20. campos protegidos (stock/costoPromedio) — ya cubierto en rules-smoke.mjs; se reconfirma aquí.
{
  const path = await seedBizItem("neg-biz-protected");
  await expectDenied("canónico: cliente altera stock directamente", () =>
    updateDoc(doc(owner.db, path), {stock: 999, actualizadoEn: serverTimestamp()})
  );
}

// 22/23. create/update inválidos.
{
  await expectDenied("canónico: create sin costoBase", () =>
    setDoc(doc(owner.db, `negocios/${businessId}/inventario/neg-biz-invalid-create`), {
      negocioId: businessId, nombre: "x", tipoItem: "producto", unidad: "u",
      margenDeseado: 1, precioInterno: 1, creadoDesdeCotizacion: true,
    })
  );
  const path = await seedBizItem("neg-biz-invalid-update");
  await expectDenied("canónico: update con tipoItem fuera de catálogo permitido", () =>
    updateDoc(doc(owner.db, path), {tipoItem: "otro", actualizadoEn: serverTimestamp()})
  );
}

// 24. delete no autorizado.
{
  const path = await seedBizItem("neg-biz-delete");
  const {deleteDoc} = await import("firebase/firestore");
  await expectDenied("canónico: delete directo de ítem", () => deleteDoc(doc(owner.db, path)));
}

console.log("PARTE 2 (canónico) completa — sin agotamiento de presupuesto en ningún caso.");

await Promise.all([deleteApp(owner.app), deleteApp(outsider.app), deleteApp(memberVentas.app)]);
await deleteAdmin(adminApp);
console.log("INVENTORY_RULES_BUDGET_FIX_SMOKE_OK");
