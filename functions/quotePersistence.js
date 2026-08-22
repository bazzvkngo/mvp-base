const QUOTE_MODEL_VERSION = 2;
const VAT_RATE = 0.19;
const {documentLocalizationSnapshot, adaptDocumentLocalization} = require("./localization");
const {
  buildAuthoritativeCompanySnapshot,
  getHistoricalCompanySnapshot,
} = require("./companySnapshot");
const VALID_STATUS = new Set([
  "borrador",
  "emitida",
  "aceptada",
  "rechazada",
  "vencida",
  "archivada",
]);
const VALID_ITEM_TYPES = new Set(["producto", "servicio", "actividad"]);
const VALID_CLIENT_TYPES = new Set(["persona", "empresa"]);
const QUOTE_WRITE_ROLES = ["OWNER", "ADMIN"];

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

function validateClienteId(value, HttpsError, {required = true} = {}) {
  if (value == null || value === "") {
    if (!required) return "";
    throw new HttpsError(
      "invalid-argument",
      "Selecciona un cliente activo registrado."
    );
  }
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "Selecciona un cliente válido.");
  }
  const clienteId = value.trim();
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(clienteId)) {
    throw new HttpsError("invalid-argument", "Selecciona un cliente válido.");
  }
  return clienteId;
}

function registeredClientQuoteFields(
  clientSnapshot,
  {businessId, clienteId, archivedMessage},
  HttpsError
) {
  if (!clientSnapshot.exists) {
    throw new HttpsError("not-found", "No se encontró el cliente seleccionado.");
  }
  const stored = clientSnapshot.data() || {};
  if (stored.negocioId !== businessId || stored.clienteId !== clienteId) {
    throw new HttpsError(
      "failed-precondition",
      "Los datos del cliente seleccionado son inconsistentes."
    );
  }
  if (stored.estado === "archivado") {
    throw new HttpsError(
      "failed-precondition",
      archivedMessage ||
        "El cliente seleccionado está archivado. Reactívalo antes de usarlo."
    );
  }
  if (stored.estado !== "activo") {
    throw new HttpsError(
      "failed-precondition",
      "El cliente seleccionado no está activo."
    );
  }

  const tipoCliente = safeText(stored.tipoCliente, 20).toLowerCase();
  const snapshot = {
    clienteId,
    tipoCliente,
    rut: safeText(stored.rut, 40),
    nombreRazonSocial: safeText(stored.nombreRazonSocial, 240),
    giro: safeText(stored.giro, 240),
    email: safeText(stored.email, 240),
    telefono: safeText(stored.telefono, 100),
    direccion: safeText(stored.direccion, 300),
    regionCodigo: safeText(stored.regionCodigo, 20),
    regionNombre: safeText(stored.regionNombre, 160),
    comunaCodigo: safeText(stored.comunaCodigo, 20),
    comunaNombre: safeText(stored.comunaNombre, 160),
    personaContacto: safeText(stored.personaContacto, 200),
  };
  if (
    !VALID_CLIENT_TYPES.has(tipoCliente) ||
    !snapshot.rut ||
    !snapshot.nombreRazonSocial
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Los datos del cliente seleccionado están incompletos."
    );
  }

  return {
    cliente: snapshot,
    clienteId,
    clienteNombre: snapshot.nombreRazonSocial,
    clienteRut: snapshot.rut,
    clienteContacto: snapshot.personaContacto,
    clienteEmail: snapshot.email,
    clienteTelefono: snapshot.telefono,
    clienteDireccion: snapshot.direccion,
    clienteCiudad: snapshot.comunaNombre,
  };
}

function legacyClientQuoteFields(raw, HttpsError) {
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
  return {
    cliente: client,
    clienteId: client.clienteId,
    clienteNombre: client.empresa,
    clienteRut: client.rut,
    clienteContacto: client.contacto,
    clienteEmail: client.email,
    clienteTelefono: client.telefono,
    clienteDireccion: client.direccion,
    clienteCiudad: client.ciudad,
  };
}

function preservedClientQuoteFields(existing = {}) {
  return {
    cliente: existing.cliente || {
      empresa: safeText(existing.clienteNombre, 240),
      rut: safeText(existing.clienteRut, 40),
      contacto: safeText(existing.clienteContacto, 200),
      email: safeText(existing.clienteEmail, 240),
      telefono: safeText(existing.clienteTelefono, 100),
      direccion: safeText(existing.clienteDireccion, 300),
      ciudad: safeText(existing.clienteCiudad, 160),
    },
    clienteId: getStoredClienteId(existing),
    clienteNombre: safeText(existing.clienteNombre, 240),
    clienteRut: safeText(existing.clienteRut, 40),
    clienteContacto: safeText(existing.clienteContacto, 200),
    clienteEmail: safeText(existing.clienteEmail, 240),
    clienteTelefono: safeText(existing.clienteTelefono, 100),
    clienteDireccion: safeText(existing.clienteDireccion, 300),
    clienteCiudad: safeText(existing.clienteCiudad, 160),
  };
}

function getStoredClienteId(existing = {}) {
  return safeText(
    existing.clienteId ||
      existing.clientId ||
      existing.cliente?.clienteId ||
      existing.cliente?.clientId,
    160
  );
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

function calculateTotals(items, rawDiscount, affectsVat, HttpsError, taxRate = VAT_RATE) {
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
  const iva = affectsVat ? Math.round(neto * taxRate) : 0;
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

function normalizeQuoteInput(
  uid,
  raw = {},
  issueDate,
  HttpsError,
  {clientFields = null, localization = null, companySnapshot = null} = {}
) {
  const company = companySnapshot || {};
  const resolvedClientFields =
    clientFields || legacyClientQuoteFields(raw, HttpsError);
  const items = normalizeItems(raw.items, HttpsError);
  const affectsVat = raw.afectaIva !== false;
  const location = localization || adaptDocumentLocalization(raw);
  const taxRate = affectsVat ? location.tasaIva : 0;
  const totals = calculateTotals(items, raw.descuento, affectsVat, HttpsError, taxRate);
  const validity = Number(raw.validezDias);
  const validezDias = Number.isInteger(validity) && validity > 0 && validity <= 3650
    ? validity
    : 15;
  const conditions = normalizeConditions(raw.condiciones || {
    formaPago: raw.condicionesPago,
    observaciones: raw.observaciones,
    exclusiones: raw.exclusiones,
    terminosAdicionales: raw.terminosAdicionales,
  });
  const acceptance = raw.aceptacion || {};

  return {
    modeloCotizacionVersion: QUOTE_MODEL_VERSION,
    paisCodigo: location.paisCodigo,
    moneda: location.moneda,
    locale: location.locale,
    impuestoNombre: location.impuestoNombre,
    fecha: issueDate,
    validezDias,
    fechaVencimiento: calculateExpiryDate(issueDate, validezDias),
    estado: VALID_STATUS.has(raw.estado) ? raw.estado : "borrador",
    afectaIva: affectsVat,
    tipoIva: affectsVat ? "afecta" : "exenta",
    tasaIva: taxRate,
    ...resolvedClientFields,
    proyectoNombre: safeText(
      raw.proyectoNombre || raw.cliente?.proyecto,
      300
    ),
    empresaSnapshot: company,
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
  await requireBusinessAccess(
    request,
    { db, HttpsError },
    { roles: QUOTE_WRITE_ROLES }
  );
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const requestId = validateRequestId(request?.data?.requestId, HttpsError);
  const dateParts = getChileDateParts(now);
  const issueDate = getChileDateValue(now);
  const rawQuote = request?.data?.quote || {};
  const clienteId = validateClienteId(rawQuote.clienteId, HttpsError);
  const userRef = authorizedBusinessRef;
  const quoteRef = userRef.collection("cotizaciones").doc();
  const clientRef = userRef.collection("clientes").doc(clienteId);
  const companyProfileRef = userRef.collection("empresa").doc("perfil");
  const taxSettingsRef = userRef.collection("configuracion").doc("impuestos");
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

    const [clientSnapshot, counterSnapshot, businessSnapshot, taxSettingsSnapshot, companyProfileSnapshot] =
      await Promise.all([
        transaction.get(clientRef),
        transaction.get(counterRef),
        transaction.get(userRef),
        transaction.get(taxSettingsRef),
        transaction.get(companyProfileRef),
      ]);
    const clientFields = registeredClientQuoteFields(
      clientSnapshot,
      {businessId, clienteId},
      HttpsError
    );
    const quote = normalizeQuoteInput(
      uid,
      rawQuote,
      issueDate,
      HttpsError,
      {
        clientFields,
        localization: documentLocalizationSnapshot(
          businessSnapshot.data() || {},
          taxSettingsSnapshot.data() || {}
        ),
        companySnapshot: buildAuthoritativeCompanySnapshot({
          businessId,
          business: businessSnapshot.data() || {},
          profile: companyProfileSnapshot.data() || {},
        }),
      }
    );
    const current = Number(counterSnapshot.data()?.lastNumber || 0);
    const nextNumber = Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1;
    const numero = formatCommercialQuoteNumber(dateParts.year, nextNumber);
    const timestamp = FieldValue.serverTimestamp();
    const storedQuote = {
      ...quote,
      estado: "borrador",
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
      quote: { id: quoteRef.id, ...quote, estado: "borrador", numero },
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

function historicalQuoteCopyInput(source = {}) {
  const items = (Array.isArray(source.items) ? source.items : []).map((item) => {
    const unitPrice =
      item?.precioUnitarioEditable ?? item?.precioUnitario ?? item?.precio ?? 0;
    return {
      ...item,
      precioSugerido: item?.precioSugerido ?? unitPrice,
      precioUnitarioEditable: unitPrice,
      descuentoPorcentaje:
        item?.descuentoPorcentaje ?? item?.descuentoPct ?? 0,
    };
  });
  return {
    clienteId: getStoredClienteId(source),
    proyectoNombre: source.proyectoNombre || source.cliente?.proyecto,
    items,
    descuento: source.descuento ?? source.descuentoGeneral ?? 0,
    seccionesAlcance: source.seccionesAlcance,
    condiciones: source.condiciones || {
      formaPago: source.condicionesPago,
      observaciones: source.observaciones,
      exclusiones: source.exclusiones,
      terminosAdicionales: source.terminosAdicionales,
    },
    aceptacion: source.aceptacion,
    afectaIva: source.afectaIva !== false,
    validezDias: source.validezDias,
    estado: "borrador",
  };
}

async function duplicateQuoteAsDraftHandler({
  request,
  db,
  FieldValue,
  HttpsError,
  requireBusinessAccess,
  now = new Date(),
}) {
  const uid = request?.auth?.uid;
  const {businessId, businessRef} = await requireBusinessAccess(
    request,
    {db, HttpsError},
    {roles: QUOTE_WRITE_ROLES}
  );
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const requestId = validateRequestId(request?.data?.requestId, HttpsError);
  const sourceId = safeText(request?.data?.sourceId, 160);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(sourceId)) {
    fail(HttpsError, "No se pudo validar la cotización original.");
  }

  const dateParts = getChileDateParts(now);
  const issueDate = getChileDateValue(now);
  const sourceRef = businessRef.collection("cotizaciones").doc(sourceId);
  const quoteRef = businessRef.collection("cotizaciones").doc();
  const counterRef = businessRef.collection("contadores")
    .doc(`cotizaciones_${dateParts.year}`);
  const requestRef = businessRef.collection("quoteDuplicateRequests").doc(requestId);

  const persistDuplicate = () => db.runTransaction(async (transaction) => {
    const existingRequest = await transaction.get(requestRef);
    if (existingRequest.exists) {
      const requestData = existingRequest.data() || {};
      if (requestData.uidUsuario !== uid || requestData.cotizacionOrigenId !== sourceId) {
        throw new HttpsError(
          "already-exists",
          "La solicitud ya fue usada para otra duplicación."
        );
      }
      const existingQuoteSnapshot = await transaction.get(
        businessRef.collection("cotizaciones").doc(requestData.quoteId)
      );
      if (!existingQuoteSnapshot.exists) {
        throw new HttpsError("internal", "La duplicación idempotente está incompleta.");
      }
      return {
        quote: {id: existingQuoteSnapshot.id, ...existingQuoteSnapshot.data()},
        requestId,
        idempotent: true,
      };
    }

    const sourceSnapshot = await transaction.get(sourceRef);
    if (!sourceSnapshot.exists) {
      throw new HttpsError("not-found", "No se encontró la cotización original.");
    }
    const source = sourceSnapshot.data() || {};
    if (source.negocioId && source.negocioId !== businessId) {
      throw new HttpsError("permission-denied", "No puedes duplicar esta cotización.");
    }
    const sourceStatus = source.estado || "borrador";
    if (!VALID_STATUS.has(sourceStatus) || sourceStatus === "borrador") {
      throw new HttpsError(
        "failed-precondition",
        "Los borradores se editan directamente y no necesitan duplicarse."
      );
    }
    const clienteId = validateClienteId(getStoredClienteId(source), HttpsError);
    const clientRef = businessRef.collection("clientes").doc(clienteId);
    const companyProfileRef = businessRef.collection("empresa").doc("perfil");
    const [clientSnapshot, counterSnapshot, businessSnapshot, companyProfileSnapshot] = await Promise.all([
      transaction.get(clientRef),
      transaction.get(counterRef),
      transaction.get(businessRef),
      transaction.get(companyProfileRef),
    ]);
    const clientFields = registeredClientQuoteFields(
      clientSnapshot,
      {
        businessId,
        clienteId,
        archivedMessage:
          "El cliente de la cotización original está archivado. Reactívalo para crear una nueva cotización.",
      },
      HttpsError
    );
    const quote = normalizeQuoteInput(
      uid,
      historicalQuoteCopyInput(source),
      issueDate,
      HttpsError,
      {
        clientFields,
        localization: adaptDocumentLocalization(source),
        companySnapshot: buildAuthoritativeCompanySnapshot({
          businessId,
          business: businessSnapshot.data() || {},
          profile: companyProfileSnapshot.data() || {},
        }),
      }
    );
    const current = Number(counterSnapshot.data()?.lastNumber || 0);
    const nextNumber = Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1;
    const numero = formatCommercialQuoteNumber(dateParts.year, nextNumber);
    const timestamp = FieldValue.serverTimestamp();
    const originNumber = safeText(source.numero || source.numeroCotizacion, 120);
    const storedQuote = {
      ...quote,
      negocioId: businessId,
      creadoPorUid: uid,
      numero,
      cotizacionOrigenId: sourceId,
      cotizacionOrigenNumero: originNumber,
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
      cotizacionOrigenId: sourceId,
      cotizacionOrigenNumero: originNumber,
      creadoEn: timestamp,
    });
    return {
      quote: {
        id: quoteRef.id,
        ...quote,
        numero,
        cotizacionOrigenId: sourceId,
        cotizacionOrigenNumero: originNumber,
      },
      requestId,
      idempotent: false,
    };
  });

  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await persistDuplicate();
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
  { db, HttpsError },
  { roles: QUOTE_WRITE_ROLES }
);
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesiÃ³n.");
  const quoteId = safeText(request?.data?.quoteId, 160);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(quoteId)) {
    fail(HttpsError, "No se pudo validar la cotizaciÃ³n a editar.");
  }
  const rawQuote = request?.data?.quote || {};
  const requestedClienteId = validateClienteId(
    rawQuote.clienteId,
    HttpsError,
    {required: false}
  );
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

    const existingClienteId = getStoredClienteId(existing);
    let clientFields;
    if (requestedClienteId && requestedClienteId !== existingClienteId) {
      const clientSnapshot = await transaction.get(
        businessRef.collection("clientes").doc(requestedClienteId)
      );
      clientFields = registeredClientQuoteFields(
        clientSnapshot,
        {businessId, clienteId: requestedClienteId},
        HttpsError
      );
    } else if (existingClienteId) {
      clientFields = preservedClientQuoteFields(existing);
    } else {
      clientFields = legacyClientQuoteFields(rawQuote, HttpsError);
    }

    const issueDate = safeText(existing.fecha, 40) || getChileDateValue(now);
    const normalized = normalizeQuoteInput(
      uid,
      rawQuote,
      issueDate,
      HttpsError,
      {
        clientFields,
        localization: adaptDocumentLocalization(existing),
        companySnapshot: getHistoricalCompanySnapshot(existing) || {},
      }
    );
    delete normalized.empresaSnapshot;
    const companyFields = existing.empresaSnapshot
      ? {empresaSnapshot: existing.empresaSnapshot}
      : existing.empresa
        ? {empresa: existing.empresa}
        : {};
    const timestamp = FieldValue.serverTimestamp();
    const storedQuote = {
      ...normalized,
      ...companyFields,
      estado: "borrador",
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
  duplicateQuoteAsDraftHandler,
  formatCommercialQuoteNumber,
  getChileDateValue,
  historicalQuoteCopyInput,
  normalizeQuoteInput,
  updateQuoteDraftHandler,
  validateRequestId,
};
