import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { httpsCallable } from "firebase/functions";
import { assertClientWriteAllowed } from "../../../config/firebaseEnvironment.mjs";
import { db, getFirebaseFunctions } from "../../../firebase/firebaseConfig";

import {
  requireBusinessId,
  veterinaryAppointmentDocPath,
  veterinaryAppointmentsCollectionPath,
  veterinaryAttentionDocPath,
  veterinaryAttentionsCollectionPath,
  veterinaryBoxesCollectionPath,
  veterinaryPatientDocPath,
  veterinaryPatientsCollectionPath,
} from "./veterinaryFirestorePaths.mjs";




function veterinaryBusinessQuery(collectionPath, businessId, professionalUid) {
  const constraints = [where("negocioId", "==", businessId)];
  if (professionalUid) constraints.push(where("profesionalUid", "==", professionalUid));
  return query(collection(db, ...collectionPath), ...constraints);
}


function mapSnapshot(snapshot) {
  return snapshot.docs.map((entry) => ({
    ...entry.data(),
    id: entry.id,
  }));
}


export function subscribeToVeterinaryPatients(
  businessId,
  onItems,
  onError
) {
  const normalizedBusinessId =
    requireBusinessId(businessId);

  return onSnapshot(
    veterinaryBusinessQuery(
      veterinaryPatientsCollectionPath(normalizedBusinessId),
      normalizedBusinessId
    ),
    (snapshot) => {
      onItems(
        mapSnapshot(snapshot)
      );
    },
    onError
  );
}


export async function getVeterinaryPatient(
  businessId,
  patientId
) {
  const snapshot =
    await getDoc(
      doc(
        db,
        ...veterinaryPatientDocPath(
          requireBusinessId(businessId),
          patientId
        )
      )
    );

  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

export async function getVeterinaryBusinessName(businessId) {
  const business = await getDoc(doc(db, "negocios", requireBusinessId(businessId)));
  const {nombreComercial, razonSocial} = business.data() ?? {};
  return nombreComercial?.trim() || razonSocial?.trim() || "";
}

export async function getVeterinaryPatientProfilePhoto(businessId, pacienteId, {assignedOnly = false} = {}) {
  if (assignedOnly) {
    const {fotoPerfil} = await consultarPacientesVeterinariosAsignados(businessId, pacienteId, {soloFoto: true});
    return fotoPerfil ?? null;
  }
  const photo = await getDoc(doc(db, ...veterinaryPatientDocPath(businessId, pacienteId), "perfil", "foto"));
  return photo.data() ?? null;
}


export function subscribeToVeterinaryAppointments(
  businessId,
  onItems,
  onError,
  professionalUid
) {
  const normalizedBusinessId =
    requireBusinessId(businessId);

  return onSnapshot(
    veterinaryBusinessQuery(
      veterinaryAppointmentsCollectionPath(normalizedBusinessId),
      normalizedBusinessId,
      professionalUid
    ),
    (snapshot) => {
      onItems(
        mapSnapshot(snapshot)
      );
    },
    onError
  );
}


export async function getVeterinaryAppointment(
  businessId,
  appointmentId
) {
  const snapshot =
    await getDoc(
      doc(
        db,
        ...veterinaryAppointmentDocPath(
          requireBusinessId(businessId),
          appointmentId
        )
      )
    );

  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}


export function subscribeToVeterinaryAttentions(
  businessId,
  onItems,
  onError,
  professionalUid
) {
  const normalizedBusinessId =
    requireBusinessId(businessId);

  return onSnapshot(
    veterinaryBusinessQuery(
      veterinaryAttentionsCollectionPath(normalizedBusinessId),
      normalizedBusinessId,
      professionalUid
    ),
    (snapshot) => {
      onItems(
        mapSnapshot(snapshot)
      );
    },
    onError
  );
}


export function subscribeToVeterinaryBoxes(businessId, onItems, onError) {
  const id = requireBusinessId(businessId);
  return onSnapshot(
    veterinaryBusinessQuery(veterinaryBoxesCollectionPath(id), id),
    (snapshot) => onItems(mapSnapshot(snapshot)),
    onError
  );
}


export async function guardarBoxVeterinario(businessId, nombre) {
  assertClientWriteAllowed("guardar boxes veterinarios");
  const callable = httpsCallable(getFirebaseFunctions(), "guardarBoxVeterinario");
  const result = await callable({businessId: requireBusinessId(businessId), nombre});
  return result.data.boxId;
}


export function subscribeToPendingVeterinaryOrders(businessId, professionalUid, onOrders, onError) {
  const normalizedBusinessId = requireBusinessId(businessId);
  const path = veterinaryAttentionsCollectionPath(normalizedBusinessId);
  const assignedOrders = query(
    veterinaryBusinessQuery(path, normalizedBusinessId),
    where("profesionalUid", "==", professionalUid),
    where("estado", "==", "en_espera")
  );

  return onSnapshot(assignedOrders, {includeMetadataChanges: true}, (snapshot) => {
    // Una orden de caché puede haber sido reasignada o iniciada desde otra sesión.
    const orders = snapshot.metadata.fromCache ? [] : mapSnapshot(snapshot)
      .filter(({box, tipoAtencion}) => box && tipoAtencion)
      .map(({id, box, tipoAtencion, asignadoEn}) => ({id, box, tipoAtencion, asignadoEn}))
      .sort((left, right) => (right.asignadoEn?.toMillis?.() ?? 0) - (left.asignadoEn?.toMillis?.() ?? 0));
    onOrders(orders);
  }, onError);
}


export async function getVeterinaryAttention(
  businessId,
  attentionId
) {
  const snapshot =
    await getDoc(
      doc(
        db,
        ...veterinaryAttentionDocPath(
          requireBusinessId(businessId),
          attentionId
        )
      )
    );

  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

export async function consultarPacientesVeterinariosAsignados(businessId, pacienteId, {soloFoto = false} = {}) {
  const callable = httpsCallable(getFirebaseFunctions(), "consultarPacientesVeterinariosAsignados");
  const result = await callable({
    businessId: requireBusinessId(businessId),
    ...(pacienteId === undefined ? {} : {pacienteId}),
    ...(soloFoto ? {soloFoto} : {}),
  });
  return result.data;
}

export async function listarCatalogoVeterinarioParaAtencion(businessId, atencionId) {
  const callable = httpsCallable(getFirebaseFunctions(), "listarCatalogoVeterinarioParaAtencion");
  const result = await callable({businessId: requireBusinessId(businessId), atencionId});
  return result.data.items;
}

export async function listarProfesionalesDerivacionVeterinaria(businessId, atencionId) {
  const callable = httpsCallable(getFirebaseFunctions(), "listarProfesionalesDerivacionVeterinaria");
  const result = await callable({businessId: requireBusinessId(businessId), atencionId});
  return result.data.profesionales;
}

export async function guardarPacienteVeterinario(businessId, pacienteId, paciente, operacion, requestId, version, fotoPerfil) {
  assertClientWriteAllowed("guardar pacientes veterinarios");
  const callable = httpsCallable(getFirebaseFunctions(), "guardarPacienteVeterinario");
  const result = await callable({
    businessId: requireBusinessId(businessId),
    pacienteId,
    paciente,
    operacion,
    requestId,
    ...(version === undefined ? {} : {version}),
    ...(fotoPerfil === undefined ? {} : {fotoPerfil}),
  });
  return result.data.pacienteId;
}

export async function guardarCitaVeterinaria(businessId, citaId, operacion, cita) {
  assertClientWriteAllowed("guardar citas veterinarias");
  const callable = httpsCallable(getFirebaseFunctions(), "guardarCitaVeterinaria");
  const result = await callable({businessId: requireBusinessId(businessId), citaId, operacion, cita});
  return result.data.citaId;
}

export async function guardarAtencionVeterinaria(businessId, citaId, operacion, atencion = {}) {
  assertClientWriteAllowed("guardar atenciones veterinarias");
  const callable = httpsCallable(getFirebaseFunctions(), "guardarAtencionVeterinaria");
  const result = await callable({businessId: requireBusinessId(businessId), citaId, operacion, atencion});
  return result.data.atencionId;
}

export async function operarOrdenVeterinaria(businessId, atencionId, operacion, atencion = {}, citaId) {
  assertClientWriteAllowed("guardar órdenes de atención veterinaria");
  const callable = httpsCallable(getFirebaseFunctions(), "guardarAtencionVeterinaria");
  const result = await callable({
    businessId: requireBusinessId(businessId),
    atencionId,
    operacion,
    atencion,
    ...(citaId ? {citaId} : {}),
  });
  return result.data.atencionId;
}

export async function guardarRecepcionVeterinaria(businessId, citaId, recepcion) {
  assertClientWriteAllowed("guardar recepción veterinaria");
  const callable = httpsCallable(getFirebaseFunctions(), "guardarRecepcionVeterinaria");
  await callable({businessId: requireBusinessId(businessId), citaId, recepcion});
}

export async function operarFotoVeterinaria(businessId, atencionId, fotoId, operacion, data = {}) {
  if (operacion !== "leer") assertClientWriteAllowed("guardar fotos clínicas veterinarias");
  const callable = httpsCallable(getFirebaseFunctions(), "fotosAtencionVeterinaria");
  const result = await callable({businessId: requireBusinessId(businessId), atencionId, fotoId, operacion, ...data});
  return result.data;
}
