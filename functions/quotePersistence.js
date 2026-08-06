const QUOTE_MODEL_VERSION = 2;
const VAT_RATE = 0.19;
const VALID_STATUS = new Set([
  "borrador",
  "emitida",
  "aceptada",
  "rechazada",
  "vencida",
  "archivada",
]);
const VALID_ITEM_TYPES = new Set(["producto", "servicio", "actividad"]);

function safeText(value, maxLength = 2000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function fail(HttpsError, message) {
  throw new HttpsError("invalid-argument", message);
}

function requireNumber(value, label, HttpsError, { allowZero = true } = {}) {
  if (value === "" || value === null || value === undefined) {
    fail(HttpsError, `${label} es obligatorio.`);
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) fail(HttpsError, `${label} debe ser numérico.`);
  if (numberValue < 0 || (!allowZero && numberValue === 0)) {
    fail(
      HttpsError,
      allowZero ? `${label} no puede ser negativo.` : `${label} debe ser mayor que cero.`
    );
  }
  return numberValue;
}

function validateRequestId(value, HttpsError) {
  const requestId = safeText(value, 120);
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(requestId)) {
    fail(HttpsError, "No se pudo validar la solicitud de creación.");
  }
  return requestId;
}

function getChileDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: values.month, day: values.day };
}

function getChileDateValue(date) {
  const parts = getChileDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatCommercialQuoteNumber(year, sequence) {
  return `COT-${year}-${String(sequence).padStart(4, "0")}`;
}

function calculateExpiryDate(issueDate, validityDays) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(issueDate);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + validityDays);
  return date.toISOString().slice(0, 10);
}

function normalizeObjectText(source, fields) {
  return Object.fromEntries(
    fields.map(([field, maxLength]) => [field, safeText(source?.[field], maxLength)])
  );
}

function normalizeCompany(source = {}) {
  const result = normalizeObjectText(source, [
    ["nombreComercial", 200],
    ["razonSocial", 240],
    ["rut", 40],
    ["giro", 240],
    ["email", 240],
    ["telefono", 100],
    ["direccion", 300],
    ["ciudad", 160],
    ["region", 160],
    ["sitioWeb", 300],
    ["logoUrl", 1200],
    ["responsable", 200],
    ["cargoResponsable", 160],
    ["condicionesPago", 2000],
    ["plazoEntregaCotizacion", 1000],
    ["alcanceGeograficoCotizacion", 2000],
    ["garantiaCotizacion", 2000],
    ["exclusionesCotizacion", 4000],
    ["terminosCotizacion", 6000],
    ["textoAceptacionCotizacion", 2000],
    ["notaPieCotizacion", 3000],
  ]);
  result.aceptacionCotizacionHabilitada =
    source.aceptacionCotizacionHabilitada === true;
  const days = Number(source.validezCotizacionDias);
  result.validezCotizacionDias = Number.isInteger(days) && days > 0 && days <= 3650
    ? days
    : 15;
  return result;
}

function normalizeClient(source = {}, HttpsError) {
  const client = normalizeObjectText(source, [
    ["clienteId", 160],
    ["empresa", 240],
    ["rut", 40],
    ["contacto", 200],
    ["direccion", 300],
    ["ciudad", 160],
    ["telefono", 100],
    ["email", 240],
    ["proyecto", 300],
  ]);
  if (!client.empresa) fail(HttpsError, "La empresa o razón social del cliente es obligatoria.");
  return client;
}

function normalizeInventorySnapshot(source = {}) {
  const snapshot = normalizeObjectText(source, [
    ["inventarioId", 160],
    ["codigoInterno", 100],
    ["nombre", 240],
    ["descripcion", 3000],
    ["tipoItem", 30],
    ["areaId", 160],
    ["areaNombre", 160],
    ["categoriaId", 160],
    ["categoria", 160],
    ["unidad", 80],
  ]);
  snapshot.modeloInventarioVersion = Number(source.modeloInventarioVersion || 0) || null;
  return snapshot;
}

function normalizeItems(items, HttpsError) {
  if (!Array.isArray(items) || items.length === 0) {
    fail(HttpsError, "Agrega al menos un ítem a la cotización.");
  }
  if (items.length > 200) fail(HttpsError, "La cotización no puede superar 200 ítems.");

  return items.map((item, index) => {
    const row = `Ítem ${index + 1}`;
    const cantidad = requireNumber(item.cantidad, `${row}: cantidad`, HttpsError, {
      allowZero: false,
    });
    const precioUnitarioEditable = requireNumber(
      item.precioUnitarioEditable,
      `${row}: precio unitario`,
      HttpsError
    );
    const descuentoPorcentaje =
      item.descuentoPorcentaje === "" || item.descuentoPorcentaje === undefined
        ? 0
        : requireNumber(item.descuentoPorcentaje, `${row}: descuento`, HttpsError);
    if (descuentoPorcentaje > 100) fail(HttpsError, `${row}: el descuento no puede superar 100%.`);
    const subtotalLinea = Math.round(cantidad * precioUnitarioEditable);
    const descuentoLinea = Math.round((subtotalLinea * descuentoPorcentaje) / 100);
    const inventorySnapshot = normalizeInventorySnapshot(item.inventarioSnapshot || {});
    const tipoItem = VALID_ITEM_TYPES.has(item.tipoItem)
      ? item.tipoItem
      : VALID_ITEM_TYPES.has(inventorySnapshot.tipoItem)
        ? inventorySnapshot.tipoItem
        : "producto";
    const nombre = safeText(item.nombre || inventorySnapshot.nombre, 240);
    if (!nombre) fail(HttpsError, `${row}: el nombre es obligatorio.`);

    return {
      lineaId: safeText(item.lineaId, 180) || `linea-${index + 1}`,
      itemId: safeText(item.itemId || inventorySnapshot.inventarioId, 160),
      productoId: safeText(item.productoId || inventorySnapshot.inventarioId, 160),
      codigo: safeText(item.codigo || inventorySnapshot.codigoInterno, 100),
      nombre,
      descripcion: safeText(item.descripcionComercial || item.descripcion, 3000),
      descripcionComercial: safeText(
        item.descripcionComercial || item.descripcion,
        3000
      ),
      tipoItem,
      categoria: safeText(item.categoria || inventorySnapshot.categoria, 160),
      unidad: safeText(item.unidad || inventorySnapshot.unidad, 80) || "unidad",
      cantidad,
      precioSugerido: requireNumber(
        item.precioSugerido ?? precioUnitarioEditable,
        `${row}: precio sugerido`,
        HttpsError
      ),
      precioUnitarioEditable,
      descuentoPorcentaje,
      descuentoLinea,
      subtotalLinea,
      totalLinea: subtotalLinea - descuentoLinea,
      inventarioSnapshot: inventorySnapshot,
    };
  });
}

function calculateTotals(items, rawDiscount, affectsVat, HttpsError) {
  const subtotal = items.reduce((sum, item) => sum + item.subtotalLinea, 0);
  const descuentoItems = items.reduce((sum, item) => sum + item.descuentoLinea, 0);
  const descuento =
    rawDiscount === "" || rawDiscount === undefined
      ? 0
      : requireNumber(rawDiscount, "El descuento general", HttpsError);
  if (descuento > subtotal - descuentoItems) {
    fail(HttpsError, "El descuento general no puede superar el monto pendiente.");
  }
  const descuentoTotal = descuentoItems + descuento;
  const neto = subtotal - descuentoTotal;
  const iva = affectsVat ? Math.round(neto * VAT_RATE) : 0;
  return {
    subtotal,
    descuento,
    descuentoItems,
    descuentoTotal,
    neto,
    iva,
    total: neto + iva,
  };
}

function normalizeScopeSections(sections) {
  if (!Array.isArray(sections)) return [];
  return sections.slice(0, 50).map((section, index) => ({
    id: safeText(section.id, 160) || `alcance-${index + 1}`,
    titulo: safeText(section.titulo, 160),
    lineas: (Array.isArray(section.lineas) ? section.lineas : [])
      .slice(0, 100)
      .map((line) => safeText(line, 2000))
      .filter(Boolean),
  })).filter((section) => section.titulo || section.lineas.length);
}

function normalizeConditions(source = {}) {
  return normalizeObjectText(source, [
    ["plazoEntrega", 1000],
    ["formaPago", 2000],
    ["alcanceGeografico", 2000],
    ["garantia", 2000],
    ["observaciones", 4000],
    ["exclusiones", 4000],
    ["terminosAdicionales", 6000],
  ]);
}

function normalizeQuoteInput(uid, raw = {}, issueDate, HttpsError) {
  const company = normalizeCompany(raw.empresa || {});
  const client = normalizeClient(raw.cliente || {
    empresa: raw.clienteNombre,
    rut: raw.clienteRut,
    contacto: raw.clienteContacto,
    direccion: raw.clienteDireccion,
    ciudad: raw.clienteCiudad,
    telefono: raw.clienteTelefono,
    email: raw.clienteEmail,
    proyecto: raw.proyectoNombre,
  }, HttpsError);
  const items = normalizeItems(raw.items, HttpsError);
  const affectsVat = raw.afectaIva !== false;
  const totals = calculateTotals(items, raw.descuento, affectsVat, HttpsError);
  const validity = Number(raw.validezDias);
  const validezDias = Number.isInteger(validity) && validity > 0 && validity <= 3650
    ? validity
    : company.validezCotizacionDias;
  const conditions = normalizeConditions(raw.condiciones || {
    formaPago: raw.condicionesPago,
    observaciones: raw.observaciones,
    exclusiones: raw.exclusiones,
    terminosAdicionales: raw.terminosAdicionales,
  });
  const acceptance = raw.aceptacion || {};

  return {
    modeloCotizacionVersion: QUOTE_MODEL_VERSION,
    moneda: "CLP",
    fecha: issueDate,
    validezDias,
    fechaVencimiento: calculateExpiryDate(issueDate, validezDias),
    estado: VALID_STATUS.has(raw.estado) ? raw.estado : "borrador",
    afectaIva: affectsVat,
    tipoIva: affectsVat ? "afecta" : "exenta",
    tasaIva: affectsVat ? VAT_RATE : 0,
    cliente: client,
    clienteId: client.clienteId,
    clienteNombre: client.empresa,
    clienteRut: client.rut,
    clienteContacto: client.contacto,
    clienteEmail: client.email,
    clienteTelefono: client.telefono,
    clienteDireccion: client.direccion,
    clienteCiudad: client.ciudad,
    proyectoNombre: client.proyecto,
    empresa: company,
    items,
    seccionesAlcance: normalizeScopeSections(raw.seccionesAlcance),
    condiciones: conditions,
    condicionesPago: conditions.formaPago,
    observaciones: conditions.observaciones,
    exclusiones: conditions.exclusiones,
    terminosAdicionales: conditions.terminosAdicionales,
    aceptacion: {
      habilitada: acceptance.habilitada === true,
      texto:
        safeText(acceptance.texto, 2000) ||
        "Acepto los términos y condiciones de esta cotización.",
    },
    ...totals,
    uidUsuario: uid,
  };
}

function isRetryableTransactionError(error) {
  const code = Number(error?.code);
  const details = String(error?.details || error?.message || "").toLowerCase();
  return code === 10 || (code === 3 && details.includes("transaction is invalid or closed"));
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function createQuoteWithNumberHandler({
  request,
  db,
  FieldValue,
  HttpsError,
  requireBusinessAccess,
  now = new Date(),
}) {
  const uid = request?.auth?.uid;
  const { businessId, businessRef: authorizedBusinessRef } =
    await requireBusinessAccess(request, { db, HttpsError });
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const requestId = validateRequestId(request?.data?.requestId, HttpsError);
  const dateParts = getChileDateParts(now);
  const issueDate = getChileDateValue(now);
  const quote = normalizeQuoteInput(uid, request?.data?.quote || {}, issueDate, HttpsError);
  const userRef = authorizedBusinessRef;
  const quoteRef = userRef.collection("cotizaciones").doc();
  const counterRef = userRef.collection("contadores").doc(`cotizaciones_${dateParts.year}`);
  const requestRef = userRef.collection("quoteCreateRequests").doc(requestId);

  const persistQuote = () => db.runTransaction(async (transaction) => {
    const existingRequest = await transaction.get(requestRef);
    if (existingRequest.exists) {
      const existingQuoteId = existingRequest.data()?.quoteId;
      if (!existingQuoteId) {
        throw new HttpsError("internal", "La solicitud idempotente quedó incompleta.");
      }
      const existingQuoteSnapshot = await transaction.get(
        userRef.collection("cotizaciones").doc(existingQuoteId)
      );
      if (!existingQuoteSnapshot.exists) {
        throw new HttpsError("internal", "La cotización idempotente no existe.");
      }
      return {
        quote: { id: existingQuoteSnapshot.id, ...existingQuoteSnapshot.data() },
        requestId,
        idempotent: true,
      };
    }

    const counterSnapshot = await transaction.get(counterRef);
    const current = Number(counterSnapshot.data()?.lastNumber || 0);
    const nextNumber = Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1;
    const numero = formatCommercialQuoteNumber(dateParts.year, nextNumber);
    const timestamp = FieldValue.serverTimestamp();
    const storedQuote = {
      ...quote,
      negocioId: businessId,
      creadoPorUid: uid,
      numero,
      creadoEn: timestamp,
      actualizadoEn: timestamp,
    };

    transaction.set(counterRef, {
      year: dateParts.year,
      lastNumber: nextNumber,
      negocioId: businessId,
      uidUsuario: uid,
      updatedAt: timestamp,
    });
    transaction.set(quoteRef, storedQuote);
    transaction.set(requestRef, {
      quoteId: quoteRef.id,
      numero,
      negocioId: businessId,
      uidUsuario: uid,
      creadoEn: timestamp,
    });

    return {
      quote: { id: quoteRef.id, ...quote, numero },
      requestId,
      idempotent: false,
    };
  });

  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await persistQuote();
    } catch (error) {
      lastError = error;
      if (!isRetryableTransactionError(error) || attempt === 5) throw error;
      await wait(30 * (2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function updateQuoteDraftHandler({
  request,
  db,
  FieldValue,
  HttpsError,
  requireBusinessAccess,
  now = new Date(),
}) {
  const uid = request?.auth?.uid;
  const { businessId, businessRef } = await requireBusinessAccess(
    request,
    { db, HttpsError }
  );
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesiÃ³n.");
  const quoteId = safeText(request?.data?.quoteId, 160);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(quoteId)) {
    fail(HttpsError, "No se pudo validar la cotizaciÃ³n a editar.");
  }
  const quoteRef = businessRef.collection("cotizaciones").doc(quoteId);

  const persistUpdate = () => db.runTransaction(async (transaction) => {
    const existingSnapshot = await transaction.get(quoteRef);
    if (!existingSnapshot.exists) {
      throw new HttpsError("not-found", "No se encontrÃ³ la cotizaciÃ³n.");
    }
    const existing = existingSnapshot.data() || {};
    if (existing.negocioId && existing.negocioId !== businessId) {
      throw new HttpsError("permission-denied", "No puedes editar esta cotizaciÃ³n.");
    }
    if (existing.estado !== "borrador") {
      throw new HttpsError(
        "failed-precondition",
        "Solo se pueden editar cotizaciones en borrador."
      );
    }

    const issueDate = safeText(existing.fecha, 40) || getChileDateValue(now);
    const normalized = normalizeQuoteInput(
      uid,
      request?.data?.quote || {},
      issueDate,
      HttpsError
    );
    const timestamp = FieldValue.serverTimestamp();
    const storedQuote = {
      ...normalized,
      negocioId: businessId,
      uidUsuario: existing.uidUsuario || uid,
      actualizadoPorUid: uid,
      numero: safeText(existing.numero, 120),
      creadoEn: existing.creadoEn || timestamp,
      actualizadoEn: timestamp,
    };
    transaction.set(quoteRef, storedQuote, { merge: true });
    return { quote: { id: quoteId, ...storedQuote, actualizadoEn: null } };
  });

  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await persistUpdate();
    } catch (error) {
      lastError = error;
      if (!isRetryableTransactionError(error) || attempt === 5) throw error;
      await wait(30 * (2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

module.exports = {
  QUOTE_MODEL_VERSION,
  calculateExpiryDate,
  createQuoteWithNumberHandler,
  formatCommercialQuoteNumber,
  getChileDateValue,
  normalizeQuoteInput,
  updateQuoteDraftHandler,
  validateRequestId,
};
