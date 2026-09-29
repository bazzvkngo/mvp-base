import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { assertClientWriteAllowed } from "../config/firebaseEnvironment.mjs";
import { db } from "../firebase/firebaseConfig";
import {
  notificationDocPath,
  notificationsCollectionPath,
} from "../firebase/firestorePaths";

function notificationsCollectionRef(businessId) {
  return collection(db, ...notificationsCollectionPath(businessId));
}

function notificationsQuery(businessId) {
  return query(notificationsCollectionRef(businessId), orderBy("creadoEn", "desc"));
}

// includeMetadataChanges: sin esto, un listener que ya entregó una
// respuesta de caché (aunque sea la lista vacía) no vuelve a disparar
// cuando el servidor confirma exactamente los mismos datos — la lista
// queda mostrando un vacío nunca confirmado. Con esto, el consumidor
// recibe otra notificación de solo-metadatos (mismos docs, fromCache pasa
// a false) que subscriptionStatus.mjs usa para salir de "loading"/"slow"
// sin depender de que los datos cambien. Mismo patrón que ya usaba
// subscribeToReferenceTasks (recuperable de 720a7a1~1).
export function subscribeToNotifications(businessId, onNotifications, onError) {
  return onSnapshot(
    notificationsQuery(businessId),
    { includeMetadataChanges: true },
    (snapshot) => {
      const notifications = snapshot.docs.map((notificationDoc) => ({
        id: notificationDoc.id,
        ...notificationDoc.data(),
      }));
      onNotifications(notifications, { fromCache: snapshot.metadata.fromCache });
    },
    onError
  );
}

export function markNotificationRead(businessId, notificacionId) {
  assertClientWriteAllowed("marcar una notificación como leída");
  return updateDoc(doc(db, ...notificationDocPath(businessId, notificacionId)), {
    leida: true,
    leidaEn: serverTimestamp(),
  });
}
