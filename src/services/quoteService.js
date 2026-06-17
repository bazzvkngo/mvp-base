import { getFunctions, httpsCallable } from "firebase/functions";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
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
  quoteCounterDocPath,
  quoteDocPath,
  quotesCollectionPath,
} from "../firebase/firestorePaths";

export const DRAFT_QUOTE_NUMBER_LABEL = "Borrador sin número";
const CHILE_TIME_ZONE = "America/Santiago";

const VALID_QUOTE_STATUS = [
  "borrador",
  "emitida",
  "aceptada",
  "rechazada",
  "vencida",
  "archivada",
];

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

function getChileDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHILE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(byType.year),
    month: byType.month,
    day: byType.day,
  };
}

export function getChileDateInputValue(date = new Date()) {
  const parts = getChileDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatCommercialQuoteNumber(year, sequence) {
  return `COT-${year}-${String(sequence).padStart(4, "0")}`;
}

export function getQuoteDisplayNumber(quote, fallback = DRAFT_QUOTE_NUMBER_LABEL) {
  return safeString(quote?.numero || quote?.numeroCotizacion || quote?.quoteNumber) || fallback;
}

function normalizeCompanySnapshot(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    nombreComercial: safeString(source.nombreComercial),
    razonSocial: safeString(source.razonSocial),
    rut: safeString(source.rut),
    giro: safeString(source.giro),
    email: safeString(source.email),
    telefono: safeString(source.telefono),
    direccion: safeString(source.direccion),
    ciudad: safeString(source.ciudad),
    sitioWeb: safeString(source.sitioWeb),
    logoUrl: safeString(source.logoUrl),
    condicionesPago: safeString(source.condicionesPago),
    validezCotizacionDias: safeNumber(source.validezCotizacionDias, 15),
    notaPieCotizacion: safeString(source.notaPieCotizacion),
  };
}

function normalizeQuote(uid, data, { isCreate = false } = {}) {
  if (!uid) throw new Error("Usuario no autenticado.");

  const clienteNombre = safeString(data?.clienteNombre);
  const items = normalizeQuoteItems(data?.items);

  if (!clienteNombre) throw new Error("El nombre del cliente es obligatorio.");
  if (items.length === 0) throw new Error("Agrega al menos un ítem a la cotización.");

  const totals = calculateQuoteTotals(items, data?.descuento);
  const estado = VALID_QUOTE_STATUS.includes(data?.estado)
    ? data.estado
    : "borrador";

  const payload = {
    numero: safeString(data?.numero),
    fecha: safeString(data?.fecha),
    clienteNombre,
    clienteRut: safeString(data?.clienteRut),
    clienteEmail: safeString(data?.clienteEmail),
    clienteTelefono: safeString(data?.clienteTelefono),
    clienteDireccion: safeString(data?.clienteDireccion),
    condicionesPago: safeString(data?.condicionesPago),
    empresa: normalizeCompanySnapshot(data?.empresa),
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

export async function createQuote(uid, data) {
  if (!uid) throw new Error("Usuario no autenticado.");

  const issuedAt = new Date();
  const chileDate = getChileDateInputValue(issuedAt);
  const { year } = getChileDateParts(issuedAt);
  const quoteRef = doc(quotesCollectionRef(uid));
  const counterRef = doc(db, ...quoteCounterDocPath(uid, year));

  try {
    return await runTransaction(db, async (transaction) => {
      const counterSnap = await transaction.get(counterRef);
      const lastNumber = counterSnap.exists()
        ? safeNumber(counterSnap.data()?.lastNumber, 0)
        : 0;
      const nextNumber = lastNumber + 1;
      const commercialNumber = formatCommercialQuoteNumber(year, nextNumber);
      const payload = normalizeQuote(
        uid,
        {
          ...data,
          numero: commercialNumber,
          fecha: chileDate,
        },
        { isCreate: true }
      );

      transaction.set(
        counterRef,
        {
          year,
          lastNumber: nextNumber,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      transaction.set(quoteRef, payload);

      return { id: quoteRef.id, ...payload };
    });
  } catch (err) {
    console.error("Error asignando número de cotización:", err);
    throw new Error("No pudimos asignar el número de cotización. Inténtalo nuevamente.");
  }
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
  const existingSnap = await getDoc(doc(db, ...quoteDocPath(uid, quoteId)));
  const existing = existingSnap.exists() ? existingSnap.data() || {} : {};
  const payload = normalizeQuote(uid, {
    ...data,
    numero: safeString(data?.numero) || existing.numero || "",
    fecha: safeString(data?.fecha) || existing.fecha || "",
  });
  await updateDoc(doc(db, ...quoteDocPath(uid, quoteId)), payload);
  return { id: quoteId, ...payload };
}

export async function updateQuoteStatus(uid, quoteId, estado, options = {}) {
  if (!uid) throw new Error("Usuario no autenticado.");
  if (!quoteId) throw new Error("quoteId es requerido.");
  if (!VALID_QUOTE_STATUS.includes(estado)) {
    throw new Error("Estado de cotización inválido.");
  }

  const payload = {
    estado,
    actualizadoEn: serverTimestamp(),
  };

  if (VALID_QUOTE_STATUS.includes(options.estadoAnterior)) {
    payload.estadoAnterior = options.estadoAnterior;
  }

  await updateDoc(doc(db, ...quoteDocPath(uid, quoteId)), payload);
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
