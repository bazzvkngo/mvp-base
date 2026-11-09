import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { db } from "../../../firebase/firebaseConfig";

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
    id: entry.id,
    ...entry.data(),
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