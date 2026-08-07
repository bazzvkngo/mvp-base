import {collection, getDocs, query, where} from "firebase/firestore";
import {normalizeInventoryMovement} from "../domain/reportModel.mjs";
import {db} from "../firebase/firebaseConfig";
import {inventoryMovementsCollectionPath} from "../firebase/firestorePaths";
import {getInventoryItems} from "./inventoryService";
import {listarCompras} from "./purchaseService";
import {getQuotes} from "./quoteService";
import {listarVentas} from "./saleService";

function requireBusinessId(value) {
  const businessId = String(value || "").trim();
  if (!businessId) throw new Error("Selecciona un negocio activo.");
  return businessId;
}

async function listInventoryMovements(businessId) {
  const snapshot = await getDocs(
    query(
      collection(db, ...inventoryMovementsCollectionPath(businessId)),
      where("negocioId", "==", businessId)
    )
  );
  return snapshot.docs
    .map((entry) => normalizeInventoryMovement({id: entry.id, ...entry.data()}))
    .sort((left, right) => right.timestampMillis - left.timestampMillis);
}

export async function loadReportData(value) {
  const businessId = requireBusinessId(value);
  const [sales, purchases, quotes, inventory, inventoryMovements] =
    await Promise.all([
      listarVentas(businessId),
      listarCompras(businessId),
      getQuotes(businessId),
      getInventoryItems(businessId),
      listInventoryMovements(businessId),
    ]);

  return {sales, purchases, quotes, inventory, inventoryMovements};
}
