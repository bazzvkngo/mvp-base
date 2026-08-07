import { httpsCallable } from "firebase/functions";
import {
  assertClientWriteAllowed,
  assertCloudFunctionAllowed,
  firebaseEnvironment,
} from "../config/firebaseEnvironment.mjs";
import {
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
  adaptStoredQuote,
  buildClientSuggestions,
  buildQuoteMutationPayload,
  DRAFT_QUOTE_NUMBER_LABEL,
  getQuoteDisplayNumber,
} from "../domain/quoteModel.mjs";
import {
  generarPropuestaCotizacion,
  normalizarPropuesta,
} from "../domain/pricing";
import { db, getFirebaseFunctions } from "../firebase/firebaseConfig";
import {
  quoteDocPath,
  quotesCollectionPath,
} from "../firebase/firestorePaths";

export { DRAFT_QUOTE_NUMBER_LABEL, getQuoteDisplayNumber };
const CHILE_TIME_ZONE = "America/Santiago";
const FUNCTIONS_REGION = "us-central1";

function normalizeQuoteCallableError(error, functionName, fallbackMessage) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  if (
    (code === "functions/not-found" && /^(not[- ]found|internal)$/i.test(message)) ||
    (code === "functions/internal" && /^internal$/i.test(message))
  ) {
    return new Error(
      firebaseEnvironment.isEmulator
        ? `La Function ${functionName} no está disponible en el entorno QA local.`
        : `La Function ${functionName} no está disponible en Firebase real. Debe desplegarse antes de usar esta acción.`
    );
  }
  if (["functions/unavailable", "functions/deadline-exceeded"].includes(code)) {
    return new Error("No pudimos conectar con el servicio. Inténtalo nuevamente.");
  }
  if (code === "functions/internal") return new Error(fallbackMessage);
  return new Error(message || fallbackMessage);
}

export {buildQuoteMutationPayload};

function quotesCollectionRef(uid) {
  return collection(db, ...quotesCollectionPath(uid));
}

function quotesQuery(uid) {
  return query(quotesCollectionRef(uid), orderBy("actualizadoEn", "desc"));
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

export function createQuoteRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return `quote-${globalThis.crypto.randomUUID()}`;
  }
  return `quote-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createQuoteDuplicateRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return `quote-copy-${globalThis.crypto.randomUUID()}`;
  }
  return `quote-copy-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function createQuote(uid, data, { requestId } = {}) {
  assertCloudFunctionAllowed("crear cotizaciones");
  if (!uid) throw new Error("Usuario no autenticado.");
  const stableRequestId = requestId || createQuoteRequestId();
  const payload = buildQuoteMutationPayload(uid, data, {
    issueDate: data?.fecha || getChileDateInputValue(new Date()),
  });
  if (!payload.clienteId) {
    throw new Error("Selecciona un cliente activo registrado.");
  }
  try {
    const callable = httpsCallable(
      getFirebaseFunctions(FUNCTIONS_REGION),
      "createQuoteWithNumber"
    );
    const response = await callable({
      businessId: uid,
      requestId: stableRequestId,
      quote: payload,
    });
    return adaptStoredQuote(response.data?.quote || response.data || {});
  } catch (err) {
    console.error("Error asignando número de cotización:", err);
    throw normalizeQuoteCallableError(
      err,
      "createQuoteWithNumber",
      "No pudimos asignar el número de cotización. Inténtalo nuevamente."
    );
  }
}

export async function duplicateQuoteAsDraft(uid, sourceId, {requestId} = {}) {
  assertCloudFunctionAllowed("duplicar cotizaciones");
  if (!uid) throw new Error("Usuario no autenticado.");
  if (!sourceId) throw new Error("Selecciona una cotización válida.");
  const stableRequestId = requestId || createQuoteDuplicateRequestId();
  try {
    const callable = httpsCallable(
      getFirebaseFunctions(FUNCTIONS_REGION),
      "duplicateQuoteAsDraft"
    );
    const response = await callable({
      businessId: uid,
      sourceId,
      requestId: stableRequestId,
    });
    return {
      ...response.data,
      quote: adaptStoredQuote(response.data?.quote || {}),
    };
  } catch (error) {
    throw normalizeQuoteCallableError(
      error,
      "duplicateQuoteAsDraft",
      "No pudimos duplicar la cotización. Inténtalo nuevamente."
    );
  }
}

export async function getQuotes(uid) {
  if (!uid) throw new Error("Usuario no autenticado.");
  const snapshot = await getDocs(quotesQuery(uid));
  return snapshot.docs.map((quoteDoc) =>
    adaptStoredQuote({ id: quoteDoc.id, ...quoteDoc.data() })
  );
}

export async function getQuoteClientSuggestions(uid) {
  return buildClientSuggestions(await getQuotes(uid));
}

export async function getQuoteById(uid, quoteId) {
  if (!uid) throw new Error("Usuario no autenticado.");
  if (!quoteId) throw new Error("quoteId es requerido.");

  const snapshot = await getDoc(doc(db, ...quoteDocPath(uid, quoteId)));
  if (!snapshot.exists()) return null;
  return adaptStoredQuote({ id: snapshot.id, ...snapshot.data() });
}

export async function updateQuote(uid, quoteId, data) {
  assertCloudFunctionAllowed("editar cotizaciones");
  if (!uid) throw new Error("Usuario no autenticado.");
  if (!quoteId) throw new Error("quoteId es requerido.");
  const payload = buildQuoteMutationPayload(uid, {
    ...data,
    fecha: data?.fecha || getChileDateInputValue(new Date()),
  });
  const callable = httpsCallable(
    getFirebaseFunctions(FUNCTIONS_REGION),
    "updateQuoteDraft"
  );
  try {
    const response = await callable({ businessId: uid, quoteId, quote: payload });
    return adaptStoredQuote(response.data?.quote || response.data || {});
  } catch (error) {
    throw normalizeQuoteCallableError(
      error,
      "updateQuoteDraft",
      "No se pudo actualizar la cotización. Inténtalo nuevamente."
    );
  }
}

export async function updateQuoteStatus(uid, quoteId, estado, options = {}) {
  assertClientWriteAllowed("cambiar el estado de cotizaciones");
  if (!uid) throw new Error("Usuario no autenticado.");
  if (!quoteId) throw new Error("quoteId es requerido.");
  if (!["borrador", "emitida", "aceptada", "rechazada", "vencida", "archivada"].includes(estado)) {
    throw new Error("Estado de cotización inválido.");
  }

  const payload = {
    estado,
    actualizadoEn: serverTimestamp(),
  };

  if (["borrador", "emitida", "aceptada", "rechazada", "vencida", "archivada"].includes(options.estadoAnterior)) {
    payload.estadoAnterior = options.estadoAnterior;
  }

  await updateDoc(doc(db, ...quoteDocPath(uid, quoteId)), payload);
}

let cachedSimularCotizacionProyecto = null;

function getSimularCotizacionCallable() {
  if (!cachedSimularCotizacionProyecto) {
    assertCloudFunctionAllowed("la simulación de cotizaciones");
    const functions = getFirebaseFunctions();
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
