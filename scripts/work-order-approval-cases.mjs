import assert from "node:assert/strict";

// La aprobación es una compuerta de ingreso: el Owner o el Administrador dicen sí o no,
// sin servicios ni alcance. Los trabajos se registran después, en la ejecución, y los
// precios se congelan al finalizar (envío a Ventas), no al aprobar.
export async function testWorkOrderApproval({adminDb, businessId, otId, serviceId,
  owner, admin, technician, member, outsider, callable, expectCallableError, runId}) {
  const base = `negocios/${businessId}`;
  const orderRef = adminDb.doc(`${base}/ordenesTrabajo/${otId}`);
  const serviceRef = orderRef.collection("servicios").doc(serviceId);
  let sequence = 0;
  const requestId = () => `approval-${runId}-${++sequence}`;
  const order = async () => (await orderRef.get()).data();
  const service = async () => (await serviceRef.get()).data();
  const payload = async (extra = {}) => ({businessId, otId, requestId: requestId(),
    expectedActualizadoEn: (await order()).actualizadoEn.toMillis(), ...extra});
  const action = async (name, client = owner, extra = {}) => (await callable(client, name)(await payload(extra))).data;
  const reject = (label, name, data, client = owner, codes = ["failed-precondition"]) =>
    expectCallableError(label, () => callable(client, name)(data), codes);
  const events = async () => (await orderRef.collection("historial").get()).docs.map((snapshot) => snapshot.data());
  const planning = (extra = {}) => ({businessId, otId, requestId: requestId(),
    servicio: {itemId: "servicio-core"}, ...extra});

  // La compuerta se prueba sobre una OT recibida y pendiente de decisión, sin importar el estado previo.
  await orderRef.update({estado: "en_diagnostico", estadoAprobacion: "pendiente"});

  // Antes de aprobar el ingreso no se registran trabajos ni repuestos.
  await reject("trabajos antes de aprobar", "crearServicioOT", planning(), technician);
  await reject("repuestos antes de aprobar", "agregarProductoOT", {businessId, otId, servicioOtId: serviceId,
    itemId: "producto-core", cantidad: 1, requestId: requestId()}, technician);

  // El envío a aprobación y la revalidación de disponibilidad dejaron de usarse.
  await reject("enviar a aprobación ya no existe", "enviarOTAprobacion", await payload());
  await reject("revalidar disponibilidad ya no existe", "revalidarDisponibilidadOT", await payload());

  // Precondiciones y autoridad se validan en el servidor.
  const reception = (await order()).recepcion;
  await orderRef.update({recepcion: null});
  await reject("aprobar sin recepción", "aprobarOT", await payload({responsableUid: technician.uid}));
  await orderRef.update({recepcion: reception});
  await reject("precio manual", "aprobarOT", await payload({precioUnitario: 1}), owner, ["invalid-argument"]);
  await reject("snapshot aportado por frontend", "aprobarOT", await payload({snapshot: {precioUnitario: 1}}), owner, ["invalid-argument"]);
  await reject("negocio ajeno", "aprobarOT", await payload(), outsider, ["permission-denied"]);
  await reject("membresía operativa no concede aprobación", "aprobarOT", await payload(), technician, ["permission-denied"]);
  await reject("perfil Taller no concede aprobación", "aprobarOT", await payload(), member, ["permission-denied"]);
  await reject("revisión obsoleta", "aprobarOT", await payload({expectedActualizadoEn: 1, responsableUid: technician.uid}), owner, ["aborted"]);

  // Rechazar exige motivo y deja la OT esperando una nueva decisión; no habilita trabajos.
  await reject("rechazar sin motivo", "rechazarOT", await payload(), admin, ["invalid-argument"]);
  await reject("rechazar con motivo en blanco", "rechazarOT", await payload({motivo: "   "}), admin, ["invalid-argument"]);
  const rejection = await action("rechazarOT", admin, {motivo: "Falta autorización del cliente"});
  assert.equal(rejection.estadoAprobacion, "rechazada");
  assert.ok(["en_cola", "en_diagnostico"].includes(rejection.estado), "rechazar no inicia la ejecución");
  assert.equal((await order()).estadoAprobacion, "rechazada");
  assert.equal((await order()).motivoRechazo, "Falta autorización del cliente", "la OT guarda el motivo de la espera");
  // La OT puede traer rechazos anteriores de la suite: se busca el de esta decisión.
  const rejectedEvent = (await events()).find((event) =>
    event.tipo === "ot_rechazada" && event.detalle.motivo === "Falta autorización del cliente");
  assert.ok(rejectedEvent, "el rechazo registra su motivo en el historial");
  await reject("trabajos tras rechazar", "crearServicioOT", planning(), technician);

  // Aprobar es idempotente, no exige servicios ni congela precios.
  const approvedEventsBefore = (await events()).filter((event) => event.tipo === "ot_aprobada").length;
  // Aprobar exige elegir el responsable de la OT, que debe ser un miembro asignable y activo del negocio.
  await reject("aprobar sin responsable", "aprobarOT", await payload(), admin, ["invalid-argument"]);
  await reject("responsable de otro negocio", "aprobarOT", await payload({responsableUid: outsider.uid}), admin);
  await reject("rechazar no asigna responsable", "rechazarOT", await payload({motivo: "No", responsableUid: technician.uid}), admin, ["invalid-argument"]);
  const approveRequest = await payload({responsableUid: technician.uid});
  const approved = (await callable(admin, "aprobarOT")(approveRequest)).data;
  assert.equal(approved.estado, "en_reparacion");
  assert.equal(approved.estadoAprobacion, "aprobada");
  assert.equal((await callable(admin, "aprobarOT")(approveRequest)).data.sinCambios, true);
  assert.equal((await events()).filter((event) => event.tipo === "ot_aprobada").length, approvedEventsBefore + 1);
  await reject("requestId reutilizado con otros datos", "aprobarOT", {...approveRequest, motivo: "otro"}, admin, ["already-exists"]);
  assert.equal((await order()).responsableUid, technician.uid, "Aprobar guarda el responsable de la OT");
  assert.ok((await order()).responsableNombre, "Aprobar guarda el nombre visible del responsable");
  const approvalEvent = (await events()).filter((event) => event.tipo === "ot_aprobada").at(-1);
  assert.ok(approvalEvent.detalle.responsableNombre, "El historial indica quién quedó como responsable");
  await reject("aprobar de nuevo", "aprobarOT", await payload({responsableUid: technician.uid}));
  await reject("rechazar una OT ya aprobada", "rechazarOT", await payload({motivo: "Tarde"}), admin);
  assert.equal((await service()).precioUnitario, null, "Aprobar no congela precios");

  // Con el ingreso aprobado se registran trabajos y repuestos sin invalidar la aprobación.
  const addId = requestId();
  await callable(technician, "agregarProductoOT")({businessId, otId, servicioOtId: serviceId,
    itemId: "producto-core", cantidad: 1, requestId: addId});
  assert.equal((await order()).estadoAprobacion, "aprobada");
  assert.equal((await order()).estado, "en_reparacion");
  const added = (await service()).productos.find((product) => product.itemId === "producto-core");
  await callable(owner, "eliminarProductoOT")({businessId, otId, servicioOtId: serviceId,
    productoOtId: added.productoOtId, expectedActualizadoEn: (await service()).actualizadoEn.toMillis()});
  assert.equal((await order()).estadoAprobacion, "aprobada");

  // El resumen no expone costos ni márgenes y nunca devuelve precios del alcance antes de finalizar.
  const summary = (await callable(owner, "obtenerResumenAprobacionOT")({businessId, otId})).data;
  assert.equal(summary.puedeEnviar, false);
  assert.equal(summary.puedeDecidir, false);
  assert.equal(summary.puedeAprobar, true);
  assert.doesNotMatch(JSON.stringify(summary), /costo|margen|precioInterno/);
  console.log("OK aprobación OT: compuerta de ingreso, rechazo con motivo, trabajos solo en ejecución");
}
