import {collection, documentId, getDocs, limit, orderBy, query, startAfter, where} from "firebase/firestore";
import {
  REPORT_PROJECT_BALANCE_CONCURRENCY_V4,
  REPORT_SALES_QUERY_LIMITS,
  loadSalesPagesBounded,
  runProjectBalancesBounded,
  validateSalesDateRangeV4,
} from "../domain/reportProfitabilityV4Query.mjs";
import {adaptStoredSale} from "../domain/saleModel.mjs";
import {BUSINESS_PERMISSIONS, hasBusinessPermission} from "../domain/rbac.mjs";
import {db} from "../firebase/firebaseConfig";
import {salesCollectionPath} from "../firebase/firestorePaths";
import {listarTrabajos, obtenerBalanceTrabajo} from "./workService";

function requireBusinessId(value) {
  const businessId = String(value || "").trim();
  if (!businessId) throw new Error("Selecciona un negocio activo.");
  return businessId;
}

// Única función que toca Firestore en este archivo: una página de Ventas acotada
// por negocio y rango, ordenada por fechaVenta DESC + documentId DESC. No consulta
// inventario, costos maestros ni calcula margen — sólo lee y adapta el documento.
async function fetchSalesPageFromFirestore(businessId, {from, to, cursor, pageSize}) {
  const constraints = [
    where("negocioId", "==", businessId),
    where("fechaVenta", ">=", from),
    where("fechaVenta", "<=", to),
    orderBy("fechaVenta", "desc"),
    orderBy(documentId(), "desc"),
    limit(pageSize + 1),
  ];
  if (cursor) constraints.push(startAfter(cursor.fechaVenta, cursor.id));

  const snapshot = await getDocs(query(collection(db, ...salesCollectionPath(businessId)), ...constraints));
  const docs = snapshot.docs.slice(0, pageSize);
  const hasMore = snapshot.docs.length > pageSize;
  const last = docs[docs.length - 1];

  return {
    items: docs.map((entry) => adaptStoredSale({id: entry.id, ...entry.data()})),
    hasMore,
    nextCursor: hasMore && last ? {fechaVenta: last.get("fechaVenta"), id: last.id} : null,
  };
}

// Fuente acotada de Ventas para REPORTES_RENTABILIDAD_V4 (ETAPA 2, SPEC 018 §5.6/§11.1).
// No hace load-all: pagina hasta agotar el rango o alcanzar REPORT_SALES_QUERY_LIMITS.
export async function loadSalesForReportV4(rawBusinessId, {
  from,
  to,
  role = "",
  pageSize = REPORT_SALES_QUERY_LIMITS.MAX_PAGE_SIZE,
  maxDocuments = REPORT_SALES_QUERY_LIMITS.MAX_TOTAL_DOCUMENTS,
  fetchPage,
} = {}) {
  const businessId = requireBusinessId(rawBusinessId);
  if (role && !hasBusinessPermission(role, BUSINESS_PERMISSIONS.SALES_READ)) {
    throw new Error("Tu perfil no tiene acceso a Ventas.");
  }
  const range = validateSalesDateRangeV4({from, to});
  const loadPage = fetchPage || ((args) => fetchSalesPageFromFirestore(businessId, args));
  return loadSalesPagesBounded({fetchPage: loadPage, from: range.from, to: range.to, pageSize, maxDocuments});
}

// Balances de Proyecto para V4: sigue usando obtenerBalanceTrabajo como única fuente
// autoritativa (Callable ya existente). No recalcula materiales/HH/gastos/Ventas en
// frontend. El fan-out ilimitado anterior se reemplaza por concurrencia acotada.
export async function loadProjectBalancesBoundedV4(rawBusinessId, {
  role = "",
  listWorks = listarTrabajos,
  loadBalance,
} = {}) {
  const businessId = requireBusinessId(rawBusinessId);
  if (!hasBusinessPermission(role, BUSINESS_PERMISSIONS.PROFITABILITY_READ)) {
    return {proyectos: [], fallidos: []};
  }
  const works = await listWorks(businessId, {role});
  const resolveBalance = loadBalance || ((work) => obtenerBalanceTrabajo(businessId, work.id));
  return runProjectBalancesBounded(works, resolveBalance, {concurrency: REPORT_PROJECT_BALANCE_CONCURRENCY_V4});
}
