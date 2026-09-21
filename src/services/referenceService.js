import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { referencesCollectionPath } from "../firebase/firestorePaths";

function referencesCollectionRef(uid) {
  return collection(db, ...referencesCollectionPath(uid));
}

function referencesQuery(uid) {
  return query(referencesCollectionRef(uid), orderBy("actualizadoEn", "desc"));
}

export function subscribeToReferences(uid, onReferences, onError) {
  return onSnapshot(
    referencesQuery(uid),
    (snapshot) => {
      const references = snapshot.docs.map((referenceDoc) => ({
        id: referenceDoc.id,
        ...referenceDoc.data(),
      }));
      onReferences(references);
    },
    onError
  );
}
