import {collection, getDocs, query, where} from "firebase/firestore";
import {
  normalizeInventoryAcquisition,
  normalizeInventoryMovement,
  normalizeWorkCost,
} from "../domain/reportModel.mjs";
import {
  adaptWorkExpense,
  adaptWorkLabor,
  canViewWorkProfitability,
} from "../domain/workModel.mjs";
import {db} from "../firebase/firebaseConfig";
import {BUSINESS_PERMISSIONS, hasBusinessPermission} from "../domain/rbac.mjs";
import {
  inventoryAcquisitionsCollectionPath,
  inventoryMovementsCollectionPath,
  workExpensesCollectionPath,
  workLaborCollectionPath,
} from "../firebase/firestorePaths";
import {getInventoryItems} from "./inventoryService";
import {listarCompras} from "./purchaseService";
import {getQuotes} from "./quoteService";
import {listarVentas} from "./saleService";
import {listarTrabajos, obtenerBalanceTrabajo} from "./workService";

function requireBusinessId(value) {
  const businessId = String(value || "").trim();
  if (!businessId) throw new Error("Selecciona un negocio activo.");
  return businessId;
}

async function listCollectionByBusiness(path, businessId) {
  const snapshot = await getDocs(
    query(
      collection(db, ...path),
      where("negocioId", "==", businessId)
    )
  );
  return snapshot.docs.map((entry) => ({id: entry.id, ...entry.data()}));
}

async function listWorkCosts(businessId, works, fallbackCurrency) {
  const records = await Promise.all(works.flatMap((work) => [
    getDocs(query(
      collection(db, ...workExpensesCollectionPath(businessId, work.id)),
      where("negocioId", "==", businessId),
      where("trabajoId", "==", work.id)
    )).then((snapshot) => snapshot.docs.map((entry) => normalizeWorkCost(
      adaptWorkExpense({id: entry.id, ...entry.data()}),
      {fallbackCurrency, kind: "GASTO", work}
    ))),
    getDocs(query(
      collection(db, ...workLaborCollectionPath(businessId, work.id)),
      where("negocioId", "==", businessId),
      where("trabajoId", "==", work.id)
    )).then((snapshot) => snapshot.docs.map((entry) => normalizeWorkCost(
      adaptWorkLabor({id: entry.id, ...entry.data()}),
      {fallbackCurrency, kind: "HH", work}
    ))),
  ]));
  return records.flat();
}

async function listProjectBalances(businessId, works, role) {
  if (!canViewWorkProfitability(role)) return [];
  return Promise.all(works.map(async (work) => ({
    ...work,
    balance: await obtenerBalanceTrabajo(businessId, work.id),
  })));
}

export async function loadReportData(
  value,
  {fallbackCurrency = "CLP", includeTraceability = false, role = ""} = {}
) {
  const businessId = requireBusinessId(value);
  const can = (permission) => hasBusinessPermission(role, permission);
  const [sales, purchases, quotes, inventory, rawMovements, rawAcquisitions, works] =
    await Promise.all([
      can(BUSINESS_PERMISSIONS.SALES_READ) ? listarVentas(businessId) : Promise.resolve([]),
      can(BUSINESS_PERMISSIONS.PURCHASES_READ) ? listarCompras(businessId) : Promise.resolve([]),
      can(BUSINESS_PERMISSIONS.QUOTES_READ) ? getQuotes(businessId) : Promise.resolve([]),
      can(BUSINESS_PERMISSIONS.INVENTORY_READ) ? getInventoryItems(businessId) : Promise.resolve([]),
      can(BUSINESS_PERMISSIONS.INVENTORY_READ)
        ? listCollectionByBusiness(inventoryMovementsCollectionPath(businessId), businessId)
        : Promise.resolve([]),
      includeTraceability && can(BUSINESS_PERMISSIONS.INVENTORY_COSTS_READ)
        ? listCollectionByBusiness(inventoryAcquisitionsCollectionPath(businessId), businessId)
        : Promise.resolve([]),
      includeTraceability && (
        can(BUSINESS_PERMISSIONS.WORKS_READ) || can(BUSINESS_PERMISSIONS.REPORTS_READ)
      )
        ? listarTrabajos(businessId)
        : Promise.resolve([]),
    ]);

  const inventoryAcquisitions = rawAcquisitions
    .map((entry) => normalizeInventoryAcquisition(entry, {fallbackCurrency}));
  const acquisitionsByMovement = new Map(
    inventoryAcquisitions.map((entry) => [entry.movimientoInventarioId, entry])
  );
  const worksById = new Map(works.map((work) => [work.id, work]));
  const purchasesById = new Map(purchases.map((purchase) => [purchase.id, purchase]));
  const inventoryMovements = rawMovements
    .map((entry) => normalizeInventoryMovement(entry, {
      acquisition: acquisitionsByMovement.get(entry.id),
      fallbackCurrency,
      purchase: purchasesById.get(entry.compraId),
      work: worksById.get(entry.trabajoId),
    }))
    .sort((left, right) => right.timestampMillis - left.timestampMillis);
  const [workCosts, projectBalances] = includeTraceability
    ? await Promise.all([
        listWorkCosts(businessId, works, fallbackCurrency),
        listProjectBalances(businessId, works, role),
      ])
    : [[], []];

  return {
    sales,
    purchases,
    quotes,
    inventory,
    inventoryMovements,
    inventoryAcquisitions,
    works,
    workCosts,
    projectBalances,
  };
}
