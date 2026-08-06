import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { assertClientWriteAllowed } from "../config/firebaseEnvironment.mjs";
import {
  adaptFinancialMovement,
  normalizeFinancialMovementInput,
} from "../domain/financialMovement.mjs";
import { auth, db } from "../firebase/firebaseConfig";
import {
  financialMovementDocPath,
  financialMovementsCollectionPath,
} from "../firebase/firestorePaths";

function requireBusinessId(businessId) {
  if (!businessId) throw new Error("Selecciona un negocio activo.");
}

function requireCurrentUserId() {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error("Debes iniciar sesión.");
  return userId;
}

function financialCollectionRef(businessId) {
  return collection(db, ...financialMovementsCollectionPath(businessId));
}

function financialDocRef(businessId, movementId) {
  return doc(db, ...financialMovementDocPath(businessId, movementId));
}

function buildFinancialQuery(businessId, filters = {}) {
  const constraints = [];
  if (filters.start) constraints.push(where("date", ">=", filters.start));
  if (filters.end) constraints.push(where("date", "<=", filters.end));
  if (filters.type) constraints.push(where("type", "==", filters.type));
  if (filters.status) constraints.push(where("status", "==", filters.status));
  constraints.push(orderBy("date", "desc"));
  return query(financialCollectionRef(businessId), ...constraints);
}

export function subscribeToFinancialMovements(
  businessId,
  filters,
  onItems,
  onError
) {
  requireBusinessId(businessId);
  return onSnapshot(
    buildFinancialQuery(businessId, filters),
    (snapshot) => {
      const items = snapshot.docs
        .map((movementDoc) =>
          adaptFinancialMovement({ id: movementDoc.id, ...movementDoc.data() })
        )
        .sort((left, right) => {
          const dateOrder = String(right.date).localeCompare(String(left.date));
          if (dateOrder !== 0) return dateOrder;
          const leftCreated = left.createdAt?.toMillis?.() || 0;
          const rightCreated = right.createdAt?.toMillis?.() || 0;
          return rightCreated - leftCreated;
        });
      onItems(items);
    },
    onError
  );
}

export async function createFinancialMovement(businessId, input) {
  assertClientWriteAllowed("registrar movimientos financieros");
  requireBusinessId(businessId);
  const userId = requireCurrentUserId();
  const payload = normalizeFinancialMovementInput(input, { businessId, userId });
  const timestamp = serverTimestamp();
  const reference = await addDoc(financialCollectionRef(businessId), {
    ...payload,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return reference.id;
}

export async function updateFinancialMovement(businessId, movementId, input) {
  assertClientWriteAllowed("editar movimientos financieros");
  requireBusinessId(businessId);
  if (!movementId) throw new Error("Selecciona un movimiento para editar.");
  const userId = requireCurrentUserId();
  const reference = financialDocRef(businessId, movementId);
  const snapshot = await getDoc(reference);
  if (!snapshot.exists()) throw new Error("El movimiento ya no existe.");
  const stored = snapshot.data();
  if (stored.businessId !== businessId) {
    throw new Error("El movimiento no pertenece al negocio activo.");
  }
  if ((stored.sourceType || "manual") !== "manual") {
    throw new Error("Este movimiento está protegido porque proviene de otro módulo.");
  }

  const normalized = normalizeFinancialMovementInput(
    { ...input, sourceType: "manual", sourceId: "" },
    { businessId, userId }
  );
  await updateDoc(reference, {
    type: normalized.type,
    status: normalized.status,
    amount: normalized.amount,
    date: normalized.date,
    concept: normalized.concept,
    categoryId: normalized.categoryId,
    paymentMethodId: normalized.paymentMethodId,
    counterpartyName: normalized.counterpartyName,
    note: normalized.note,
    reference: normalized.reference,
    searchText: normalized.searchText,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteFinancialMovement(businessId, movementId) {
  assertClientWriteAllowed("eliminar movimientos financieros");
  requireBusinessId(businessId);
  requireCurrentUserId();
  if (!movementId) throw new Error("Selecciona un movimiento para eliminar.");
  const reference = financialDocRef(businessId, movementId);
  const snapshot = await getDoc(reference);
  if (!snapshot.exists()) return false;
  const stored = snapshot.data();
  if (stored.businessId !== businessId) {
    throw new Error("El movimiento no pertenece al negocio activo.");
  }
  if ((stored.sourceType || "manual") !== "manual") {
    throw new Error("Este movimiento está protegido porque proviene de otro módulo.");
  }
  await deleteDoc(reference);
  return true;
}
