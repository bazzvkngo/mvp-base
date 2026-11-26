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
  veterinaryPatientDocPath,
  veterinaryPatientsCollectionPath,
} from "./veterinaryFirestorePaths.mjs";




function veterinaryBusinessQuery(collectionPath, businessId) {
  return query(collection(db, ...collectionPath), where("negocioId", "==", businessId));
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


export function subscribeToVeterinaryAppointments(
  businessId,
  onItems,
  onError
) {
  const normalizedBusinessId =
    requireBusinessId(businessId);

  return onSnapshot(
    veterinaryBusinessQuery(
      veterinaryAppointmentsCollectionPath(normalizedBusinessId),
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
  onError
) {
  const normalizedBusinessId =
    requireBusinessId(businessId);

  return onSnapshot(
    veterinaryBusinessQuery(
      veterinaryAttentionsCollectionPath(normalizedBusinessId),
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
export async function guardarPacienteVeterinario(businessId, pacienteId, paciente, operacion, requestId, version) {
  assertClientWriteAllowed("guardar pacientes veterinarios");
  const callable = httpsCallable(getFirebaseFunctions(), "guardarPacienteVeterinario");
  const result = await callable({
    businessId: requireBusinessId(businessId),
    pacienteId,
    paciente,
    operacion,
    requestId,
    ...(version === undefined ? {} : {version}),
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
