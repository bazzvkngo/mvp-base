import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc} from "firebase/firestore";

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const {HttpsError} = require("firebase-functions/v2/https");
const {FieldValue} = require("firebase-admin/firestore");
const {crearVehiculoHandler} = require("./vehiclePersistence.js");
const {requireOperationalBusinessAccess} = require("./businessOnboarding.js");

export async function testWorkshopSecurity({adminDb, businessId, otId, owner, member,
  technician, outsider, anonymous, callable, expectCallableError, expectFirestoreDenied, runId}) {
  const base = `negocios/${businessId}`;
  const calls = {
    crearVehiculo: {}, actualizarVehiculo: {}, cambiarPropietarioVehiculo: {},
    listarClientesSeleccionablesTaller: {}, crearOrdenTrabajo: {},
    registrarRecepcionOrdenTrabajo: {}, registrarDiagnostico: {}, actualizarDiagnostico: {},
    completarDiagnostico: {}, crearServicioOT: {}, actualizarServicioOT: {}, eliminarServicioOT: {},
    agregarProductoOT: {}, actualizarProductoOT: {}, eliminarProductoOT: {},
    iniciarServicioOT: {}, completarServicioOT: {}, enviarOTAprobacion: {}, aprobarOT: {}, rechazarOT: {},
    revalidarDisponibilidadOT: {}, obtenerResumenAprobacionOT: {},
    finalizarReparacionOT: {}, registrarEntregaOT: {}, cancelarOT: {}, obtenerHistorialOT: {}, obtenerEventosCierreOT: {},
    listarCatalogoTaller: {}, listarPersonasAsignablesTaller: {},
    crearPlazaTaller: {requestId: `security-${runId}`, plaza: {nombre: "Prueba"}},
    actualizarPlazaTaller: {plazaId: "plaza", plaza: {nombre: "Prueba"}, expectedActualizadoEn: 1},
    activarPlazaTaller: {plazaId: "plaza", expectedActualizadoEn: 1},
    inactivarPlazaTaller: {plazaId: "plaza", expectedActualizadoEn: 1},
    asignarPlazaOT: {otId, plazaId: "plaza", expectedActualizadoEn: 1},
    liberarPlazaOT: {otId, expectedActualizadoEn: 1},
  };
  async function deniedMatrix(label, client, code = "permission-denied") {
    for (const [name, payload] of Object.entries(calls)) {
      await expectCallableError(`${label}: ${name}`, () => callable(client, name)({businessId, ...payload}), [code]);
    }
  }
  await deniedMatrix("sin sesión", anonymous, "unauthenticated");
  await deniedMatrix("negocio ajeno", outsider);
  // Revoke after the Core guard succeeds, before the vehicle transaction starts.
  const technicianRef = adminDb.doc(`membresias/${businessId}__${technician.uid}`);
  const originalTechnician = (await technicianRef.get()).data();
  const requestId = `revocation-${runId}`;
  let initiallyAuthorized = false;
  try {
    await expectCallableError("revocación entre autorización y escritura", () => crearVehiculoHandler({
      auth: {uid: technician.uid}, data: {businessId, requestId, vehiculo: {
        clienteId: "cliente-a", patente: "SECU12", marca: "Prueba", modelo: "Seguridad",
        anio: 2026, color: "Blanco", tipo: "sedan",
      }},
    }, {db: adminDb, FieldValue, HttpsError, requireBusinessAccess: async (...args) => {
      const context = await requireOperationalBusinessAccess(...args);
      initiallyAuthorized = true;
      await technicianRef.update({estado: "inactivo"});
      return context;
    }}), ["permission-denied"]);
    assert.equal(initiallyAuthorized, true);
    assert.equal((await adminDb.doc(`${base}/vehicleCreateRequests/${requestId}`).get()).exists, false);
    assert.equal((await adminDb.collection(`${base}/vehiculos`).where("patente", "==", "SECU12").get()).empty, true);
  } finally {
    await technicianRef.set(originalTechnician);
  }
  const memberRef = adminDb.doc(`membresias/${businessId}__${member.uid}`);
  const originalMember = (await memberRef.get()).data();
  const profileRef = adminDb.doc(`${base}/perfilesEmpleados/security-empty`);
  const userRef = adminDb.doc(`usuarios/${member.uid}`);
  const originalUser = (await userRef.get()).data();
  try {
    await memberRef.update({estado: "inactivo"});
    await deniedMatrix("membresía inactiva", member);
    await memberRef.set({...originalMember, profileId: "security-empty"});
    await profileRef.set({negocioId: businessId, estado: "activo", modulos: ["inventario"]});
    await deniedMatrix("perfil sin Taller", member);
    await memberRef.set(originalMember);
    await userRef.set({...originalUser, estadoPlataforma: "suspendido"});
    await deniedMatrix("usuario suspendido", member);
  } finally {
    await memberRef.set(originalMember);
    if (originalUser) await userRef.set(originalUser);
    else await userRef.delete();
  }

  // An OWNER still cannot access internal collections through the client SDK.
  for (const name of ["vehiclePlateKeys", "vehicleVinKeys", "vehicleCreateRequests", "otCounters",
    "otCreateRequests", "otApprovalState", "otApprovalRequests", "otServiceExecutionRequests",
    "otClosureRequests", "plazaOccupancyKeys",
    `ordenesTrabajo/${otId}/historial`]) {
    const path = `${base}/${name}/security-proof`;
    await adminDb.doc(path).set({negocioId: businessId, otId});
    const target = doc(owner.db, path);
    await expectFirestoreDenied(`${name}: get`, () => getDoc(target));
    await expectFirestoreDenied(`${name}: list`, () => getDocs(collection(owner.db, `${base}/${name}`)));
    await expectFirestoreDenied(`${name}: create`, () => setDoc(doc(owner.db, `${base}/${name}/client-created`), {negocioId: businessId}));
    await expectFirestoreDenied(`${name}: update`, () => updateDoc(target, {prueba: true}));
    await expectFirestoreDenied(`${name}: delete`, () => deleteDoc(target));
    await adminDb.doc(path).delete();
  }

  // Verify Core exposure with synthetic data only; this remains a documented upstream risk.
  await adminDb.doc(`${base}/inventario/security-cost-probe`).set({
    negocioId: businessId, tipoItem: "producto", nombre: "Prueba seguridad", estado: "activo",
    stock: 1, precioInterno: 20, costoBase: 10, costoPromedio: 10, valorInventario: 10,
  });
  const coreRead = await getDoc(doc(technician.db, `${base}/inventario/security-cost-probe`));
  assert.equal(coreRead.data().costoBase, 10);
  const catalog = (await callable(technician, "listarCatalogoTaller")({businessId})).data.items;
  const safeItem = catalog.find((item) => item.itemId === "security-cost-probe");
  assert.ok(safeItem);
  assert.ok(!Object.keys(safeItem).some((key) => /costo|margen|valorInventario/i.test(key)));
  console.log("DECISION_CORE_CONFIRMADA: TECNICO lee costos de Inventario; DTO Taller permanece acotado hasta la alineación central");
  await adminDb.doc(`${base}/inventario/security-cost-probe`).delete();
  console.log(`WORKSHOP_SECURITY_OK: ${Object.keys(calls).length} Functions × 5 escenarios negativos; 11 colecciones internas cerradas`);
}
