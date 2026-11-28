"use strict";

const {createHash} = require("node:crypto");
const {isDeepStrictEqual} = require("node:util");
const {importVeterinaryModel} = require("./veterinaryModels");
const {veterinaryBoxId} = require("./veterinaryBoxPersistence");
const {deliverVeterinarySale, stageVeterinarySale} = require("./veterinaryAttentionSale");
const {
  prepareVeterinaryControlAppointment,
  assertVeterinaryControlAppointmentAvailable,
  writeVeterinaryControlAppointment,
} = require("./veterinaryAppointmentPersistence");
const {
  assertAssignableVeterinaryProfessional,
  assertCurrentVeterinaryGrant,
  canReceiveVeterinaryReferral,
  getVeterinaryProfessionalDisplayName,
  getVeterinaryProfessionalGrantRefs,
  getVeterinaryProfessionalProfileRef,
  requireVeterinaryProfessionalAccess,
} = require("./veterinaryProfessionalAccess");

const ORDER_ORIGINS = new Set(["cita", "directa", "emergencia"]);
const ORDER_OPERATIONS = new Set(["crearOrden", "asignarOrden", "iniciar", "borrador", "cerrar", "emitirReceta", "cancelarOrden"]);
const ASSIGNED_OPERATIONS = new Set(["iniciar", "borrador", "cerrar", "emitirReceta"]);
const LEGACY_OPERATIONS = new Set(["iniciar", "borrador", "cerrar"]);
const MAX_PRESCRIPTIONS = 5;
const validId = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(value);

function requireId(value, HttpsError, message = "Selecciona una orden válida.") {
  if (!validId(value)) throw new HttpsError("invalid-argument", message);
  return value;
}

function requireText(value, limit, label, HttpsError, required = true) {
  const text = typeof value === "string" ? value.trim() : "";
  if ((required && !text) || text.length > limit || (value != null && typeof value !== "string")) {
    throw new HttpsError("invalid-argument", label + ": ingresa un texto válido de hasta " + limit + " caracteres.");
  }
  return text;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function appointmentSlotRef(businessRef, appointment) {
  if (!appointment || !/^\d{4}-\d{2}-\d{2}$/.test(appointment.fecha) ||
      !/^\d{2}:\d{2}$/.test(appointment.hora)) return null;
  return businessRef.collection("cuposVeterinarios").doc(appointment.fecha + "_" + appointment.hora.replace(":", ""));
}

function auditStamp(FieldValue, uid) {
  return {actualizadoEn: FieldValue.serverTimestamp(), actualizadoPorUid: uid};
}

function modelError(error, HttpsError) {
  if (!error.fieldErrors) throw error;
  return new HttpsError("invalid-argument", Object.values(error.fieldErrors).flat()[0], error.fieldErrors);
}

async function guardarAtencionVeterinariaHandler(request, {db, HttpsError, FieldValue, requireBusinessAccess, now = () => new Date()}) {
  const context = await requireVeterinaryProfessionalAccess(request, {db, HttpsError, requireBusinessAccess});
  const params = request.data ?? {};
  const {operacion, atencionId, citaId} = params;
  const dependencies = {...context, db, HttpsError, FieldValue, ...(operacion === "cerrar" ? {requestedAt: now()} : {})};
  if (operacion === "generarVenta") {
    const id = requireId(atencionId ?? citaId, HttpsError);
    const attention = (await context.businessRef.collection("atencionesVeterinarias").doc(id).get()).data();
    if (attention?.negocioId !== context.businessId) throw new HttpsError("not-found", "La atención no está disponible.");
    if (context.assignedOnly) requireAssignedProfessional(attention, context.uid, HttpsError);
    if (attention.estado !== "finalizada" || !attention.ventaEstado) {
      throw new HttpsError("failed-precondition", "La atención no tiene una venta pendiente de generar.");
    }
    await deliverVeterinarySale({...dependencies, atencionId: id});
    return {atencionId: id};
  }
  if (context.assignedOnly && (atencionId === undefined || !ASSIGNED_OPERATIONS.has(operacion))) {
    throw new HttpsError("permission-denied", "Tu perfil solo puede atender órdenes que tengas asignadas.");
  }
  let result;
  if (atencionId !== undefined || !LEGACY_OPERATIONS.has(operacion)) {
    requireId(atencionId, HttpsError);
    if (!ORDER_OPERATIONS.has(operacion)) throw new HttpsError("invalid-argument", "Selecciona una operación válida.");
    if (operacion === "crearOrden") return createOrder(params, dependencies);
    result = await mutateOrder(params, dependencies);
  } else {
    requireId(citaId, HttpsError, "Selecciona una cita válida.");
    result = await mutateLegacyAttention(params, dependencies);
  }
  if (operacion === "cerrar") {
    try {
      await deliverVeterinarySale({...dependencies, atencionId: result.atencionId});
    } catch (error) {
      // La intención se guardó junto al cierre. Su trigger puede retomar la generación.
      console.warn("Venta veterinaria pendiente de generación.", error.code || "internal");
    }
  }
  return result;
}

async function createOrder({atencionId, citaId, atencion}, {db, uid, businessId, businessRef, HttpsError, FieldValue}) {
  const {VETERINARY_TRIAGE_PRIORITIES} = await importVeterinaryModel("receptionTriageModel");
  const origen = atencion?.origen;
  if (!ORDER_ORIGINS.has(origen)) throw new HttpsError("invalid-argument", "Selecciona el tipo de ingreso.");
  if (origen === "cita") {
    requireId(citaId, HttpsError, "Selecciona una cita válida.");
    if (citaId === atencionId) throw new HttpsError("invalid-argument", "La orden necesita su propio identificador.");
  } else if (citaId != null) {
    throw new HttpsError("invalid-argument", "Este ingreso no se vincula con una cita.");
  }

  const appointments = businessRef.collection("citasVeterinarias");
  const attentions = businessRef.collection("atencionesVeterinarias");
  const appointmentRef = origen === "cita" ? appointments.doc(citaId) : null;
  // Esta lectura solo resuelve la referencia; la transacción valida de nuevo la cita.
  const initialAppointment = appointmentRef ? (await appointmentRef.get()).data() : null;
  if (appointmentRef && initialAppointment?.negocioId !== businessId) {
    throw new HttpsError("not-found", "La cita ya no está disponible.");
  }
  const pacienteId = requireId(appointmentRef ? initialAppointment.pacienteId : atencion?.pacienteId,
      HttpsError, "Selecciona un paciente válido.");
  const patientRef = businessRef.collection("pacientesVeterinarios").doc(pacienteId);
  const attentionRef = attentions.doc(atencionId);
  const legacyRef = appointmentRef ? attentions.doc(citaId) : null;
  let intake;
  if (!appointmentRef) {
    const {horaLlegada, prioridad} = atencion;
    if (typeof horaLlegada !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(horaLlegada) ||
        !VETERINARY_TRIAGE_PRIORITIES.includes(prioridad) || (origen === "emergencia" && prioridad !== "urgente")) {
      throw new HttpsError("invalid-argument", "Registra la hora de llegada y una prioridad válida para el ingreso.");
    }
    const motivoConsulta = requireText(atencion.motivoConsulta, 1000, "Motivo de consulta", HttpsError);
    intake = {horaLlegada, prioridad, motivoConsulta};
  }
  const creationHash = digest({origen, citaId: citaId ?? null, pacienteId, intake});

  return db.runTransaction(async (tx) => {
    const [orderSnapshot, patientSnapshot, appointmentSnapshot, legacySnapshot] = await tx.getAll(
        attentionRef, patientRef, ...(appointmentRef ? [appointmentRef, legacyRef] : []),
    );
    const existing = orderSnapshot.data();
    if (existing) {
      if (existing.creadoPorUid === uid && existing.negocioId === businessId && existing.huellaCreacion === creationHash) {
        return {atencionId};
      }
      throw new HttpsError("already-exists", "Ya existe una orden con ese identificador.");
    }

    const patient = patientSnapshot.data();
    if (patient?.negocioId !== businessId || !["activo", undefined].includes(patient.estado)) {
      throw new HttpsError("failed-precondition", "Selecciona un paciente activo de esta empresa.");
    }
    const appointment = appointmentSnapshot?.data();
    if (appointmentRef) {
      if (appointment?.negocioId !== businessId || appointment.pacienteId !== pacienteId) {
        throw new HttpsError("aborted", "La cita cambió. Vuelve a abrirla.");
      }
      if (appointment.atencionId || legacySnapshot.exists) {
        throw new HttpsError("already-exists", "Esta cita ya tiene una atención registrada.");
      }
      if (appointment.estado !== "en_espera" || !appointment.recepcion?.horaLlegada || !appointment.triage?.prioridad) {
        throw new HttpsError("failed-precondition", "Registra la recepción y el triage antes de crear la orden.");
      }
    }

    const audit = auditStamp(FieldValue, uid);
    const stamp = audit.actualizadoEn;
    const recepcion = appointment?.recepcion ?? {horaLlegada: intake.horaLlegada, recibidaEn: stamp, recibidaPorUid: uid};
    const triage = appointment?.triage ?? {prioridad: intake.prioridad};
    const professional = appointment?.profesionalUid ? {
      profesionalUid: appointment.profesionalUid, profesionalNombre: appointment.profesionalNombre ?? "",
    } : {};
    tx.create(attentionRef, {
      ...audit, negocioId: businessId, atencionId, pacienteId, origen, estado: "en_espera",
      ...(appointmentRef ? {citaId} : {}),
      ...professional,
      motivoConsulta: appointment ? appointment.motivo ?? "" : intake.motivoConsulta,
      recepcion, triage, recibidoEn: recepcion.recibidaEn ?? stamp,
      creadoEn: stamp, creadoPorUid: uid, huellaCreacion: creationHash,
    });
    if (appointmentRef) tx.update(appointmentRef, {atencionId, ...audit});
    return {atencionId};
  });
}

function assignmentPayload(value, HttpsError, {normalizeVeterinaryBoxName, VETERINARY_BOX_NAME_LIMIT}) {
  return {
    box: requireText(normalizeVeterinaryBoxName(value?.box), VETERINARY_BOX_NAME_LIMIT, "Box", HttpsError),
    tipoAtencion: requireText(value?.tipoAtencion, 100, "Tipo de atención", HttpsError),
    profesionalUid: requireId(value?.profesionalUid, HttpsError, "Selecciona un profesional válido."),
  };
}

function prescriptionPayload(value, HttpsError) {
  const recetaId = requireId(value?.recetaId, HttpsError, "Selecciona un identificador de receta válido.");
  if (!Array.isArray(value.medicamentos) || value.medicamentos.length < 1 || value.medicamentos.length > 10) {
    throw new HttpsError("invalid-argument", "Registra entre 1 y 10 medicamentos por receta.");
  }
  const medicamentos = value.medicamentos.map((item) => ({
    nombre: requireText(item?.nombre, 120, "Medicamento", HttpsError),
    dosis: requireText(item?.dosis, 80, "Dosis", HttpsError),
    frecuencia: requireText(item?.frecuencia, 80, "Frecuencia", HttpsError),
    duracion: requireText(item?.duracion, 80, "Duración", HttpsError),
    instrucciones: requireText(item?.instrucciones, 300, "Instrucciones", HttpsError, false),
  }));
  return {
    recetaId, medicamentos,
    indicaciones: requireText(value.indicaciones, 1000, "Indicaciones", HttpsError, false),
  };
}

function requireExistingOrder(order, businessId, HttpsError) {
  if (order?.negocioId !== businessId || !ORDER_ORIGINS.has(order.origen)) {
    throw new HttpsError("not-found", "La orden de atención ya no está disponible.");
  }
}

function requireAssignedProfessional(order, uid, HttpsError) {
  if (order.profesionalUid !== uid) {
    throw new HttpsError("permission-denied", "Solo el profesional asignado puede registrar esta atención.");
  }
}

function assignOrder(tx, orderRef, order, assignment, assignmentData, context) {
  const {nextBox, currentLock, nextLock, displayName} = assignmentData;
  const {uid, HttpsError, audit} = context;
  if (order.estado !== "en_espera") throw new HttpsError("failed-precondition", "Solo puedes asignar una orden en espera.");
  if (nextLock.exists && nextLock.get("atencionId") !== orderRef.id) {
    throw new HttpsError("already-exists", "El box ya está asignado a otra orden en espera o en atención.");
  }
  if (currentLock?.ref.path !== nextBox.path && currentLock?.get("atencionId") === orderRef.id) tx.delete(currentLock.ref);
  if (nextLock.get("atencionId") === orderRef.id && order.box === assignment.box &&
      order.tipoAtencion === assignment.tipoAtencion && order.profesionalUid === assignment.profesionalUid &&
      order.profesionalNombre === displayName) return;
  tx.set(nextBox, {atencionId: orderRef.id});
  tx.update(orderRef, {
    ...assignment, profesionalNombre: displayName, ...audit, asignadoEn: audit.actualizadoEn, asignadoPorUid: uid,
  });
}

function issuePrescription(tx, orderRef, order, prescription, {uid, HttpsError, audit}) {
  requireAssignedProfessional(order, uid, HttpsError);
  const prescriptions = order.recetas ?? [];
  const existing = prescriptions.find((entry) => entry.recetaId === prescription.recetaId);
  const result = {atencionId: orderRef.id, recetaId: prescription.recetaId};
  if (existing) {
    if (existing.profesionalUid === uid && existing.indicaciones === prescription.indicaciones &&
        isDeepStrictEqual(existing.medicamentos, prescription.medicamentos)) return result;
    throw new HttpsError("already-exists", "La receta ya fue emitida con otros datos.");
  }
  if (order.estado !== "en_atencion") throw new HttpsError("failed-precondition", "La orden debe estar en atención para emitir una receta.");
  if (prescriptions.length >= MAX_PRESCRIPTIONS) {
    throw new HttpsError("failed-precondition", "Puedes emitir hasta cinco recetas por atención.");
  }
  // Firestore no permite serverTimestamp dentro de un arreglo. La fecha la fija el servidor.
  const entry = {
    ...prescription, emitidaEn: new Date(), profesionalUid: uid, profesionalNombre: order.profesionalNombre,
  };
  tx.update(orderRef, {...audit, recetas: [...prescriptions, entry]});
  return result;
}

function clinicalFollowupFields(atencion, outcome, HttpsError, allowPartial = false) {
  if (outcome === "control") {
    const fecha = atencion?.control?.fecha ?? "";
    const hora = atencion?.control?.hora ?? "";
    const errors = {};
    if (!(allowPartial && fecha === "") && (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha))) {
      errors.controlFecha = "Selecciona la fecha del control.";
    }
    if (!(allowPartial && hora === "") && (typeof hora !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora))) {
      errors.controlHora = "Selecciona la hora del control.";
    }
    const message = errors.controlFecha || errors.controlHora;
    if (message) throw new HttpsError("invalid-argument", message, errors);
    return {control: {fecha, hora}};
  }
  if (outcome === "derivacion") {
    const tipo = atencion?.derivacion?.tipo ?? "";
    if (allowPartial && tipo === "") return {derivacion: {tipo}};
    if (tipo === "externa") return {derivacion: {tipo}};
    if (tipo !== "interna") {
      const message = "Selecciona si la derivación es interna o externa.";
      throw new HttpsError("invalid-argument", message, {derivacionTipo: message});
    }
    const profesionalUid = atencion?.derivacion?.profesionalUid ?? "";
    if (!(allowPartial && profesionalUid === "") && !validId(profesionalUid)) {
      const message = "Selecciona un profesional veterinario para la derivación.";
      throw new HttpsError("invalid-argument", message, {derivacionProfesionalUid: message});
    }
    return {derivacion: {tipo, profesionalUid}};
  }
  return {};
}

async function prepareFollowupProfessional(profesionalUid, {db, businessRef, businessId}, optional = false) {
  if (!validId(profesionalUid)) return null;
  const memberRef = db.doc("membresias/" + businessId + "__" + profesionalUid);
  const member = (await memberRef.get()).data();
  const currentMember = member?.negocioId === businessId && member.uid === profesionalUid && member.estado === "activo";
  const profileRef = currentMember ? getVeterinaryProfessionalProfileRef(businessRef, member) : null;
  const profesionalNombre = currentMember ? await getVeterinaryProfessionalDisplayName(db, profesionalUid) : "";
  return {profesionalUid, profesionalNombre, memberRef, profileRef, optional};
}

function closureOutcome(atencion) {
  return String(atencion?.resultadoClinico ?? "").trim().toLowerCase();
}

async function prepareClinicalFollowup(atencion, {atencionId, pacienteId, profesionalUid}, context, legacy = false) {
  const {control, derivacion} = clinicalFollowupFields(atencion, closureOutcome(atencion), context.HttpsError);
  if (!control && !derivacion) return null;
  const booking = control ? await prepareVeterinaryControlAppointment(control, {
    ...context, pacienteId, citaId: "control-" + digest(atencionId),
  }) : null;
  const professional = await prepareFollowupProfessional(
      control ? profesionalUid : derivacion?.profesionalUid, context, legacy && Boolean(control),
  );
  const refs = [...(booking?.refs ?? []), professional?.memberRef, professional?.profileRef];
  return {booking, derivacion, professional, sourceProfessionalUid: profesionalUid, refs};
}

function readFollowupProfessional(professional, snapshots, {businessId, HttpsError}, isReferral = false) {
  if (!professional) return {};
  const {memberRef, profileRef, profesionalUid, profesionalNombre, optional} = professional;
  const member = snapshots.get(memberRef.path).data();
  const profile = profileRef && member?.profileId === profileRef.id ? snapshots.get(profileRef.path).data() : null;
  if (isReferral) {
    if (!canReceiveVeterinaryReferral(member, profile, {businessId, uid: profesionalUid})) {
      const message = "Selecciona un profesional activo con perfil veterinario de esta empresa.";
      throw new HttpsError("failed-precondition", message, {derivacionProfesionalUid: message});
    }
  } else {
    try {
      assertAssignableVeterinaryProfessional(member, profile, {businessId, uid: profesionalUid, HttpsError});
    } catch (error) {
      if (optional && error.code === "failed-precondition") return {};
      throw error;
    }
  }
  if (!profesionalNombre) {
    throw new HttpsError("aborted", "El profesional cambió. Vuelve a abrir la atención.");
  }
  return {profesionalUid, profesionalNombre};
}

function readClinicalFollowup(followup, closure, snapshots, identity, context) {
  const {resultadoClinico} = closure;
  const {HttpsError} = context;
  if (resultadoClinico === "control") {
    const booking = followup?.booking;
    if (!booking || booking.appointment.pacienteId !== identity.pacienteId ||
        followup.sourceProfessionalUid !== identity.profesionalUid) {
      throw new HttpsError("aborted", "La atención cambió. Vuelve a abrirla para agendar el control.");
    }
    assertVeterinaryControlAppointmentAvailable(booking, snapshots, context);
    const {fecha, hora} = booking.appointment;
    const professional = readFollowupProfessional(followup.professional, snapshots, context);
    return {booking, professional, patch: {control: {citaId: booking.appointmentRef.id, fecha, hora}}};
  }
  if (resultadoClinico === "derivacion") {
    if (!followup?.derivacion) throw new HttpsError("aborted", "La atención cambió. Vuelve a abrirla para registrar la derivación.");
    const {tipo} = followup.derivacion;
    const professional = tipo === "interna" ? readFollowupProfessional(followup.professional, snapshots, context, true) : {};
    return {patch: {derivacion: {tipo, ...professional}}};
  }
  return {};
}

function uniqueReferences(refs) {
  return [...new Map(refs.filter(Boolean).map((ref) => [ref.path, ref])).values()];
}

async function mutateOrder({atencionId, operacion, atencion}, context) {
  const {db, uid, businessId, businessRef, HttpsError, FieldValue} = context;
  const orderRef = businessRef.collection("atencionesVeterinarias").doc(atencionId);
  // Estas lecturas determinan las referencias de la transacción, que revalida el estado y sus vínculos.
  const initial = (await orderRef.get()).data();
  requireExistingOrder(initial, businessId, HttpsError);
  if (context.assignedOnly) requireAssignedProfessional(initial, uid, HttpsError);
  const appointmentRef = initial.citaId
    ? businessRef.collection("citasVeterinarias").doc(requireId(initial.citaId, HttpsError))
    : null;
  const boxModel = await importVeterinaryModel("boxModel");
  const {veterinaryBoxKey} = boxModel;
  const assignment = operacion === "asignarOrden" ? assignmentPayload(atencion, HttpsError, boxModel) : null;
  const prescription = operacion === "emitirReceta" ? prescriptionPayload(atencion, HttpsError) : null;
  const memberRef = assignment ? db.doc("membresias/" + businessId + "__" + assignment.profesionalUid) : null;
  const [actorMembershipRef, actorProfileRef] = getVeterinaryProfessionalGrantRefs(context);
  let displayName = "";
  let profileRef = null;
  if (memberRef) {
    const membership = (await memberRef.get()).data();
    profileRef = getVeterinaryProfessionalProfileRef(businessRef, membership);
    const profile = profileRef ? (await profileRef.get()).data() : null;
    assertAssignableVeterinaryProfessional(membership, profile, {businessId, uid: assignment.profesionalUid, HttpsError});
    displayName = await getVeterinaryProfessionalDisplayName(db, assignment.profesionalUid);
  }
  const currentBoxKey = veterinaryBoxKey(initial.box);
  const nextBoxKey = assignment ? veterinaryBoxKey(assignment.box) : "";
  const nextBoxId = assignment ? veterinaryBoxId(nextBoxKey) : null;
  const reservations = businessRef.collection("reservasBoxesVeterinarios");
  const currentBox = currentBoxKey ? reservations.doc(veterinaryBoxId(currentBoxKey)) : null;
  const nextBox = nextBoxId ? reservations.doc(nextBoxId) : null;
  const configuredBox = nextBoxId ? businessRef.collection("boxesVeterinarios").doc(nextBoxId) : null;
  const slot = appointmentRef && operacion === "cancelarOrden"
    ? appointmentSlotRef(businessRef, (await appointmentRef.get()).data())
    : null;
  const followup = operacion === "cerrar" && initial.estado === "en_atencion"
    ? await prepareClinicalFollowup(atencion, {...initial, atencionId}, context)
    : null;
  const readRefs = uniqueReferences([
    orderRef, appointmentRef, currentBox, nextBox, configuredBox, memberRef, profileRef, slot, actorMembershipRef,
    actorProfileRef,
    ...(followup?.refs ?? []),
  ]);

  return db.runTransaction(async (tx) => {
    const snapshots = new Map((await tx.getAll(...readRefs)).map((snapshot) => [snapshot.ref.path, snapshot]));
    const order = snapshots.get(orderRef.path).data();
    requireExistingOrder(order, businessId, HttpsError);
    if (context.assignedOnly) {
      assertCurrentVeterinaryGrant(
          context, snapshots.get(actorMembershipRef.path).data(), snapshots.get(actorProfileRef.path).data(),
      );
      requireAssignedProfessional(order, uid, HttpsError);
    }
    if (order.citaId !== initial.citaId || order.box !== initial.box) {
      throw new HttpsError("aborted", "La orden cambió. Vuelve a abrirla.");
    }
    const appointment = appointmentRef ? snapshots.get(appointmentRef.path).data() : null;
    if (appointmentRef && (appointment?.negocioId !== businessId || appointment.atencionId !== atencionId ||
        appointment.pacienteId !== order.pacienteId)) {
      throw new HttpsError("failed-precondition", "La cita ya no coincide con esta orden.");
    }

    const audit = auditStamp(FieldValue, uid);
    const actor = {uid, businessId, HttpsError, audit};
    const currentLock = currentBox ? snapshots.get(currentBox.path) : null;
    if (assignment) {
      const membership = snapshots.get(memberRef.path).data();
      const profile = profileRef && membership?.profileId === profileRef.id ? snapshots.get(profileRef.path).data() : null;
      assertAssignableVeterinaryProfessional(membership, profile, {businessId, uid: assignment.profesionalUid, HttpsError});
      const box = snapshots.get(configuredBox.path).data();
      const configured = box?.negocioId === businessId && veterinaryBoxKey(box.nombre) === nextBoxKey;
      if (!configured && currentBoxKey !== nextBoxKey) {
        throw new HttpsError("failed-precondition", "Selecciona un box registrado en la clínica.");
      }
      assignOrder(tx, orderRef, order, {...assignment, box: configured ? box.nombre : order.box}, {
        nextBox, currentLock, nextLock: snapshots.get(nextBox.path), displayName,
      }, actor);
      if (appointmentRef &&
          (appointment.profesionalUid !== assignment.profesionalUid || appointment.profesionalNombre !== displayName)) {
        tx.update(appointmentRef, {...audit, profesionalUid: assignment.profesionalUid, profesionalNombre: displayName});
      }
      return {atencionId};
    }
    if (operacion === "cancelarOrden") {
      if (order.estado === "cancelada") return {atencionId};
      if (order.estado !== "en_espera") throw new HttpsError("failed-precondition", "Solo puedes cancelar una orden en espera.");
      if (appointmentRef) {
        if (appointment.estado !== "en_espera" || appointmentSlotRef(businessRef, appointment)?.path !== slot?.path) {
          throw new HttpsError("aborted", "La cita cambió. Vuelve a abrir la orden.");
        }
        tx.update(appointmentRef, {...audit, estado: "cancelada"});
        if (slot && snapshots.get(slot.path).get("citaId") === order.citaId) tx.delete(slot);
      }
      if (currentLock?.get("atencionId") === atencionId) tx.delete(currentBox);
      tx.update(orderRef, {...audit, estado: "cancelada", canceladaEn: audit.actualizadoEn, canceladaPorUid: uid});
      return {atencionId};
    }
    if (appointment?.profesionalUid && appointment.profesionalUid !== order.profesionalUid) {
      throw new HttpsError("failed-precondition", "El profesional de la cita no coincide con el de la orden.");
    }
    if (prescription) return issuePrescription(tx, orderRef, order, prescription, actor);
    if (operacion === "iniciar" && !order.profesionalUid) {
      throw new HttpsError("failed-precondition", "Asigna el box, el tipo de atención y el profesional antes de iniciar.");
    }
    requireAssignedProfessional(order, uid, HttpsError);
    if (operacion === "iniciar") {
      if (order.estado === "en_atencion") return {atencionId};
      if (order.estado !== "en_espera" || (appointmentRef && appointment.estado !== "en_espera") ||
          !order.box || !order.tipoAtencion || currentLock?.get("atencionId") !== atencionId) {
        throw new HttpsError("failed-precondition", "La orden no está en espera o no tiene asignación completa.");
      }
      tx.update(orderRef, {
        ...audit, estado: "en_atencion", iniciadaEn: audit.actualizadoEn, iniciadoPorUid: uid,
      });
      if (appointmentRef) tx.update(appointmentRef, {
        ...audit, estado: "en_atencion", profesionalUid: order.profesionalUid, profesionalNombre: order.profesionalNombre ?? "",
      });
      return {atencionId};
    }

    if (operacion === "cerrar" && order.estado === "finalizada") return {atencionId};
    if (order.estado !== "en_atencion" || (appointmentRef && appointment.estado !== "en_atencion")) {
      throw new HttpsError("failed-precondition", "La orden debe estar en atención.");
    }
    if (operacion === "borrador") {
      await saveDraft(tx, orderRef, order, atencion, {audit, HttpsError});
      return {atencionId};
    }

    const clinicalContext = {
      atencionId, citaId: order.citaId || undefined, pacienteId: order.pacienteId, profesionalUid: order.profesionalUid,
    };
    await closeAttention(tx, orderRef, {...atencion, items: atencion?.items ?? order.borrador?.items},
        clinicalContext, {...context, audit}, followup, snapshots);
    if (appointmentRef) tx.update(appointmentRef, {...audit, estado: "finalizada"});
    if (currentLock?.get("atencionId") === atencionId) tx.delete(currentBox);
    return {atencionId};
  });
}

async function mutateLegacyAttention({citaId, operacion, atencion}, context) {
  const {db, uid, businessId, businessRef, HttpsError, FieldValue} = context;
  const appointmentRef = businessRef.collection("citasVeterinarias").doc(citaId);
  const attentionRef = businessRef.collection("atencionesVeterinarias").doc(citaId);
  let followup;
  if (operacion === "cerrar" && ["control", "derivacion"].includes(closureOutcome(atencion))) {
    const [appointmentRefSnapshot, attentionRefSnapshot] = await db.getAll(appointmentRef, attentionRef);
    const appointment = appointmentRefSnapshot.data();
    const attention = attentionRefSnapshot.data();
    if (appointment?.negocioId === businessId && !appointment.atencionId && appointment.estado === "en_atencion" &&
        attention?.negocioId === businessId && attention.estado === "en_atencion" &&
        attention.pacienteId === appointment.pacienteId && attention.citaId === citaId) {
      followup = await prepareClinicalFollowup(atencion, {
        atencionId: citaId, pacienteId: attention.pacienteId,
        profesionalUid: attention.profesionalUid || appointment.profesionalUid,
      }, context, true);
    }
  }
  const refs = uniqueReferences([appointmentRef, attentionRef, ...(followup?.refs ?? [])]);

  return db.runTransaction(async (tx) => {
    const snapshots = await tx.getAll(...refs);
    const [appointmentSnapshot, attentionSnapshot] = snapshots;
    const appointment = appointmentSnapshot.data();
    const existing = attentionSnapshot.data();
    if (!appointment || appointment.negocioId !== businessId) {
      throw new HttpsError("not-found", "La cita ya no está disponible.");
    }
    if (appointment.atencionId) throw new HttpsError("failed-precondition", "Abre la orden de atención vinculada a esta cita.");
    const {pacienteId} = appointment;
    if (existing && (existing.negocioId !== businessId || existing.pacienteId !== pacienteId || existing.citaId !== citaId)) {
      throw new HttpsError("failed-precondition", "La atención no coincide con la cita.");
    }
    if (existing && (
      (operacion !== "borrador" && existing.estado === "finalizada" && appointment.estado === "finalizada") ||
      (operacion === "iniciar" && existing.estado === "en_atencion" && appointment.estado === "en_atencion")
    )) return {atencionId: citaId};

    const audit = auditStamp(FieldValue, uid);
    const stamp = audit.actualizadoEn;
    if (operacion === "iniciar") {
      if (existing || appointment.estado !== "en_espera" || !appointment.recepcion?.horaLlegada || !appointment.triage?.prioridad) {
        throw new HttpsError("failed-precondition", "Registra la recepción y el triage antes de iniciar la atención.");
      }
      if (!validId(pacienteId)) throw new HttpsError("failed-precondition", "La cita no tiene un paciente válido.");
      const patient = (await tx.get(businessRef.collection("pacientesVeterinarios").doc(pacienteId))).data();
      if (!patient || patient.negocioId !== businessId) {
        throw new HttpsError("failed-precondition", "El paciente no está disponible en esta empresa.");
      }
      tx.create(attentionRef, {
        ...audit, negocioId: businessId, citaId, pacienteId, estado: "en_atencion",
        iniciadaEn: stamp, iniciadoPorUid: uid, motivoConsulta: appointment.motivo ?? "",
        recepcion: appointment.recepcion, triage: appointment.triage,
      });
      tx.update(appointmentRef, {...audit, estado: "en_atencion"});
      return {atencionId: citaId};
    }
    if (operacion === "borrador") {
      if (existing?.estado !== "en_atencion" || appointment.estado !== "en_atencion") {
        throw new HttpsError("failed-precondition", "Solo puedes guardar el borrador de una atención abierta.");
      }
      await saveDraft(tx, attentionRef, existing, atencion, {audit, HttpsError});
      return {atencionId: citaId};
    }
    if (existing?.estado !== "en_atencion" || appointment.estado !== "en_atencion") {
      throw new HttpsError("failed-precondition", "Inicia la atención antes de cerrarla.");
    }

    await closeAttention(tx, attentionRef, {...atencion, items: atencion?.items ?? existing.borrador?.items},
        {citaId, pacienteId, profesionalUid: existing.profesionalUid || appointment.profesionalUid}, {...context, audit},
        followup, new Map(snapshots.map((snapshot) => [snapshot.ref.path, snapshot])));
    tx.update(appointmentRef, {...audit, estado: "finalizada"});
    return {atencionId: citaId};
  });
}

async function saveDraft(tx, attentionRef, existing, atencion, {audit, HttpsError}) {
  const {buildVeterinaryAttentionDraftPayload} = await importVeterinaryModel("attentionModel");
  let draft;
  try {
    draft = buildVeterinaryAttentionDraftPayload(atencion);
  } catch (error) {
    throw modelError(error, HttpsError);
  }
  const previous = existing.borrador?.resultadoClinico === draft.resultadoClinico ? existing.borrador : undefined;
  const followup = clinicalFollowupFields({
    control: atencion?.control ?? previous?.control,
    derivacion: atencion?.derivacion ?? previous?.derivacion,
  }, draft.resultadoClinico, HttpsError, true);
  // Sin lista de ítems en la solicitud se conserva la del borrador anterior.
  tx.update(attentionRef, {borrador: {...draft, ...followup, items: draft.items ?? existing.borrador?.items ?? []}, ...audit});
}

async function closeAttention(tx, attentionRef, atencion, identity, context, followup, snapshots) {
  const {businessRef, businessId, uid, audit, HttpsError, FieldValue} = context;
  const {buildVeterinaryAttentionMutationPayload} = await importVeterinaryModel("attentionModel");
  const {buildVeterinaryClinicalClosureMutationPayload} = await importVeterinaryModel("clinicalClosureModel");
  const entries = await loadReferences(tx, businessRef, businessId, atencion?.items ?? [], HttpsError);
  if (identity.atencionId && entries.length === 0) {
    throw new HttpsError("failed-precondition", "Añade al menos un servicio o producto de Inventario para generar la venta.");
  }
  const references = entries.map(({reference}) => reference);
  let clinical;
  let closure;
  try {
    clinical = buildVeterinaryAttentionMutationPayload({
      ...atencion, ...identity,
      servicios: references.filter((item) => item.tipoItem === "servicio"),
      productos: references.filter((item) => item.tipoItem === "producto"),
    });
    closure = buildVeterinaryClinicalClosureMutationPayload({...identity, resultadoClinico: atencion?.resultadoClinico});
  } catch (error) {
    throw modelError(error, HttpsError);
  }
  const {booking, professional, patch} = readClinicalFollowup(followup, closure, snapshots, identity, context);
  const sale = entries.length ? await stageVeterinarySale(tx, attentionRef, identity, entries, context) : {};
  if (booking) writeVeterinaryControlAppointment(tx, booking, professional, context);
  tx.update(attentionRef, {
    ...clinical, ...audit, resultadoClinico: closure.resultadoClinico,
    estado: "finalizada", finalizadaEn: audit.actualizadoEn, finalizadoPorUid: uid,
    borrador: FieldValue.delete(), ...sale, ...patch,
  });
}

async function loadReferences(tx, business, businessId, items, HttpsError) {
  const {buildVeterinaryInventoryReference} = await importVeterinaryModel("inventoryPharmacyIntegrationModel");
  if (!Array.isArray(items) || items.length > 100) {
    throw new HttpsError("invalid-argument", "Registra hasta 50 servicios y 50 productos.");
  }
  const ids = new Set();
  for (const item of items) {
    if (typeof item?.itemId !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(item.itemId) || ids.has(item.itemId)) {
      throw new HttpsError("invalid-argument", "Selecciona ítems de inventario válidos y sin duplicados.");
    }
    ids.add(item.itemId);
  }
  if (!items.length) return [];
  const snapshots = await tx.getAll(...items.map((item) => business.collection("inventario").doc(item.itemId)));
  return snapshots.map((snapshot, index) => {
    if (!snapshot.exists || snapshot.get("negocioId") !== businessId) {
      throw new HttpsError("failed-precondition", "El ítem no está disponible en el inventario de esta empresa.");
    }
    try {
      const inventory = snapshot.data();
      return {
        reference: buildVeterinaryInventoryReference({...inventory, id: snapshot.id}, items[index].cantidad),
        snapshot: inventory,
      };
    } catch (error) {
      throw new HttpsError("failed-precondition", error.message);
    }
  });
}

module.exports = {guardarAtencionVeterinariaHandler};
