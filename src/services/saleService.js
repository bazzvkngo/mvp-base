import {collection, doc, getDoc, getDocs, query, where} from "firebase/firestore";
import {httpsCallable} from "firebase/functions";
import {assertCloudFunctionAllowed} from "../config/firebaseEnvironment.mjs";
import {adaptStoredSale, buildSaleMutationPayload} from "../domain/saleModel.mjs";
import {db, getFirebaseFunctions} from "../firebase/firebaseConfig";
import {saleDocPath, salesCollectionPath} from "../firebase/firestorePaths";

const functions = getFirebaseFunctions("us-central1");
const businessId = (value) => { const id = String(value || "").trim(); if (!id) throw new Error("Selecciona un negocio activo."); return id; };
const requireVentaId = (value) => { const id = String(value || "").trim(); if (!id) throw new Error("Selecciona una venta válida."); return id; };

export function createSaleRequestId(prefix = "sale") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function message(error, fallback) {
  const code = String(error?.code || "").replace(/^functions\//, "");
  const value = String(error?.message || "").trim();
  if (code === "permission-denied") return "Tu membresía no permite administrar ventas.";
  if (code === "unauthenticated") return "Debes iniciar sesión nuevamente.";
  if (["invalid-argument", "failed-precondition", "not-found", "already-exists"].includes(code)) return value || fallback;
  if (["cancelled", "deadline-exceeded", "unavailable"].includes(code)) return "No pudimos conectar con el servicio. Intenta nuevamente.";
  return value || fallback;
}

async function call(name, payload, fallback) {
  assertCloudFunctionAllowed(name);
  try {
    const response = await httpsCallable(functions, name)(payload);
    return {...response.data, venta: adaptStoredSale(response.data?.venta || {})};
  } catch (error) {
    const normalized = new Error(message(error, fallback));
    normalized.code = String(error?.code || "").replace(/^functions\//, "");
    throw normalized;
  }
}

export async function listarVentas(value) {
  const id = businessId(value);
  const snapshot = await getDocs(query(collection(db, ...salesCollectionPath(id)), where("negocioId", "==", id)));
  return snapshot.docs
    .map((entry) => adaptStoredSale({id: entry.id, ...entry.data()}))
    .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));
}

export async function obtenerVenta(value, ventaId) {
  const snapshot = await getDoc(doc(db, ...saleDocPath(businessId(value), requireVentaId(ventaId))));
  return snapshot.exists() ? adaptStoredSale({id: snapshot.id, ...snapshot.data()}) : null;
}

export const crearVenta = (value, raw, options = {}) => call("crearVenta", {
  businessId: businessId(value),
  requestId: options.requestId || createSaleRequestId("sale-create"),
  venta: buildSaleMutationPayload(raw),
}, "No pudimos crear la venta.");

export const crearVentaDesdeCotizacion = (value, cotizacionId, options = {}) => call("crearVentaDesdeCotizacion", {
  businessId: businessId(value),
  cotizacionId,
  requestId: options.requestId || createSaleRequestId("sale-quote"),
}, "No pudimos registrar la cotización como venta.");

export const actualizarVentaBorrador = (value, ventaId, raw) => call("actualizarVentaBorrador", {
  businessId: businessId(value),
  ventaId: requireVentaId(ventaId),
  venta: buildSaleMutationPayload(raw),
}, "No pudimos guardar el borrador.");

export const confirmarVenta = (value, ventaId, options = {}) => call("confirmarVenta", {
  businessId: businessId(value),
  ventaId: requireVentaId(ventaId),
  requestId: options.requestId || createSaleRequestId("sale-confirm"),
}, "No pudimos confirmar la venta.");

export const cancelarVenta = (value, ventaId, motivo, options = {}) => call("cancelarVenta", {
  businessId: businessId(value),
  ventaId: requireVentaId(ventaId),
  motivo: String(motivo || "").trim(),
  requestId: options.requestId || createSaleRequestId("sale-cancel"),
}, "No pudimos cancelar la venta.");

export const cancelarVentaBorrador = cancelarVenta;
