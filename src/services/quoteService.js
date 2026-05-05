import { getFunctions, httpsCallable } from "firebase/functions";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import "../firebase/firebaseConfig";
import {
  calculateQuoteTotals,
  normalizeQuoteItems,
} from "../domain/quoteItemFactory";
import {
  generarPropuestaCotizacion,
  normalizarPropuesta,
} from "../domain/pricing";
import { db } from "../firebase/firebaseConfig";
import {
  quoteDocPath,
  quotesCollectionPath,
} from "../firebase/firestorePaths";

const VALID_QUOTE_STATUS = ["borrador", "emitida", "aceptada", "rechazada"];

function quotesCollectionRef(uid) {
  return collection(db, ...quotesCollectionPath(uid));
}

function quotesQuery(uid) {
  return query(quotesCollectionRef(uid), orderBy("actualizadoEn", "desc"));
}

function safeString(value) {
  return String(value || "").trim();
}

function safeNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeQuote(uid, data, { isCreate = false } = {}) {
  if (!uid) throw new Error("Usuario no autenticado.");

  const clienteNombre = safeString(data?.clienteNombre);
  const items = normalizeQuoteItems(data?.items);

  if (!clienteNombre) throw new Error("El nombre del cliente es obligatorio.");
  if (items.length === 0) throw new Error("Agrega al menos un item a la cotizacion.");

  const totals = calculateQuoteTotals(items, data?.descuento);
  const estado = VALID_QUOTE_STATUS.includes(data?.estado)
    ? data.estado
    : "borrador";

  const payload = {
    numero: safeString(data?.numero) || generateQuoteNumber(),
    fecha: safeString(data?.fecha) || new Date().toISOString().slice(0, 10),
    clienteNombre,
    clienteRut: safeString(data?.clienteRut),
    clienteEmail: safeString(data?.clienteEmail),
    clienteTelefono: safeString(data?.clienteTelefono),
    clienteDireccion: safeString(data?.clienteDireccion),
    condicionesPago: safeString(data?.condicionesPago),
    items,
    subtotal: totals.subtotal,
    descuento: safeNumber(totals.descuento, 0),
    total: totals.total,
    observaciones: safeString(data?.observaciones),
    estado,
    uidUsuario: uid,
    actualizadoEn: serverTimestamp(),
  };

  if (isCreate) {
    payload.creadoEn = serverTimestamp();
  }

  return payload;
}

export function generateQuoteNumber(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `COT-${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

export async function createQuote(uid, data) {
  const payload = normalizeQuote(uid, data, { isCreate: true });
  const docRef = await addDoc(quotesCollectionRef(uid), payload);
  return { id: docRef.id, ...payload };
}

export async function getQuotes(uid) {
  if (!uid) throw new Error("Usuario no autenticado.");
  const snapshot = await getDocs(quotesQuery(uid));
  return snapshot.docs.map((quoteDoc) => ({
    id: quoteDoc.id,
    ...quoteDoc.data(),
  }));
}

export async function getQuoteById(uid, quoteId) {
  if (!uid) throw new Error("Usuario no autenticado.");
  if (!quoteId) throw new Error("quoteId es requerido.");

  const snapshot = await getDoc(doc(db, ...quoteDocPath(uid, quoteId)));
  if (!snapshot.exists()) return null;
  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

export async function updateQuote(uid, quoteId, data) {
  if (!quoteId) throw new Error("quoteId es requerido.");
  const payload = normalizeQuote(uid, data);
  await updateDoc(doc(db, ...quoteDocPath(uid, quoteId)), payload);
  return { id: quoteId, ...payload };
}

export async function updateQuoteStatus(uid, quoteId, estado) {
  if (!uid) throw new Error("Usuario no autenticado.");
  if (!quoteId) throw new Error("quoteId es requerido.");
  if (!VALID_QUOTE_STATUS.includes(estado)) {
    throw new Error("Estado de cotizacion invalido.");
  }

  await updateDoc(doc(db, ...quoteDocPath(uid, quoteId)), {
    estado,
    actualizadoEn: serverTimestamp(),
  });
}

let cachedSimularCotizacionProyecto = null;

function getSimularCotizacionCallable() {
  if (!cachedSimularCotizacionProyecto) {
    const functions = getFunctions();
    cachedSimularCotizacionProyecto = httpsCallable(
      functions,
      "simularCotizacionProyecto"
    );
  }
  return cachedSimularCotizacionProyecto;
}

export { generarPropuestaCotizacion, normalizarPropuesta };

export async function cotizarProyecto(params) {
  const {
    tipoProyecto,
    descripcionProyecto,
    distanciaKm,
    nivelCalidad,
    presupuestoReferencia,
    respuestasCuestionario,
  } = params || {};

  const callable = getSimularCotizacionCallable();
  const response = await callable({
    tipoProyecto: tipoProyecto || "",
    descripcion: descripcionProyecto || "",
    distanciaKm:
      distanciaKm !== undefined && distanciaKm !== null
        ? Number(distanciaKm)
        : null,
    nivelCalidad: nivelCalidad || "",
    presupuestoReferencia:
      presupuestoReferencia !== undefined && presupuestoReferencia !== null
        ? Number(presupuestoReferencia)
        : null,
    respuestasCuestionario: respuestasCuestionario || null,
  });

  return response.data;
}
