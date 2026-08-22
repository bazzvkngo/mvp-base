const {createHash} = require("node:crypto");
const {adaptDocumentLocalization, documentLocalizationSnapshot} = require("./localization");
const {buildAuthoritativeCompanySnapshot} = require("./companySnapshot");

const PURCHASE_ORDER_MODEL_VERSION = 1;
const VAT_RATE = 0.19;
const WRITE_ROLES = ["OWNER", "ADMIN"];
const ITEM_TYPES = new Set(["producto", "servicio", "actividad"]);
const MAXIMUM_AMOUNT_MESSAGE = "El monto de la orden supera el máximo permitido.";

function fail(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

function safeText(value, maxLength = 2000) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function requireId(value, label, HttpsError) {
  const id = safeText(value, 160);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) {
    fail(HttpsError, "invalid-argument", `${label} no es válido.`);
  }
  return id;
}

function requireRequestId(value, HttpsError) {
  const requestId = safeText(value, 120);
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(requestId)) {
    fail(HttpsError, "invalid-argument", "No se pudo validar la solicitud.");
  }
  return requestId;
}

function requireNumber(value, label, HttpsError, options = {}) {
  const minimum = options.minimum ?? 0;
  const maximum = options.maximum ?? Infinity;
  if (value === "" || value === null || value === undefined) {
    fail(HttpsError, "invalid-argument", `${label} es obligatorio.`);
  }
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    fail(HttpsError, "invalid-argument", `${label} debe ser numérico.`);
  }
  if (number < minimum || number > maximum) {
    fail(
      HttpsError,
      "invalid-argument",
      `${label} debe estar entre ${minimum} y ${maximum}.`
    );
  }
  return number;
}

function assertSafeMoney(values, HttpsError) {
  if (values.some((value) => !Number.isFinite(value) || !Number.isSafeInteger(value))) {
    fail(HttpsError, "invalid-argument", MAXIMUM_AMOUNT_MESSAGE);
  }
}

function getChileDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {year: Number(values.year), month: values.month, day: values.day};
}

function getChileDateValue(date) {
  const parts = getChileDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatPurchaseOrderNumber(year, sequence) {
  return `OC-${year}-${String(sequence).padStart(4, "0")}`;
}

function normalizeOptionalDate(value, label, HttpsError) {
  const date = safeText(value, 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    fail(HttpsError, "invalid-argument", `${label} no es válida.`);
  }
  return date;
}

function normalizeLineInput(raw, index, HttpsError) {
  const label = `Ítem ${index + 1}`;
  const cantidad = requireNumber(raw?.cantidad, `${label}: cantidad`, HttpsError, {
    minimum: Number.MIN_VALUE,
  });
  const costoUnitario = requireNumber(
    raw?.costoUnitario,
    `${label}: costo unitario`,
    HttpsError
  );
  const descuentoPct = requireNumber(
    raw?.descuentoPct ?? 0,
    `${label}: descuento`,
    HttpsError,
    {maximum: 100}
  );
  return {
    lineaId: requireId(raw?.lineaId || `linea-${index + 1}`, "La línea", HttpsError),
    itemId: requireId(raw?.itemId, label, HttpsError),
    cantidad,
    costoUnitario,
    descuentoPct,
  };
}

function normalizePurchaseOrderInput(raw, HttpsError) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail(HttpsError, "invalid-argument", "Los datos de la orden no son válidos.");
  }
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    fail(HttpsError, "invalid-argument", "Agrega al menos un ítem a la orden.");
  }
  if (raw.items.length > 250) {
    fail(HttpsError, "invalid-argument", "La orden admite hasta 250 ítems.");
  }
  const items = raw.items.map((item, index) =>
    normalizeLineInput(item, index, HttpsError)
  );
  if (new Set(items.map((item) => item.lineaId)).size !== items.length) {
    fail(HttpsError, "invalid-argument", "Las líneas de la orden están duplicadas.");
  }
  return {
    proveedorId: requireId(raw.proveedorId, "El proveedor", HttpsError),
    fechaEntregaEstimada: normalizeOptionalDate(
      raw.fechaEntregaEstimada,
      "La fecha de entrega",
      HttpsError
    ),
    direccionEntrega: safeText(raw.direccionEntrega, 500),
    condicionesPago: safeText(raw.condicionesPago, 2000),
    observaciones: safeText(raw.observaciones, 4000),
    items,
  };
}

function providerSnapshotFromDocument(snapshot, context, HttpsError) {
  if (!snapshot.exists) {
    fail(HttpsError, "not-found", "No se encontró el proveedor seleccionado.");
  }
  const stored = snapshot.data() || {};
  if (
    stored.negocioId !== context.businessId ||
    safeText(stored.proveedorId, 160) !== context.proveedorId
  ) {
    fail(HttpsError, "failed-precondition", "El proveedor es inconsistente.");
  }
  if (stored.estado !== "activo") {
    fail(HttpsError, "failed-precondition", "El proveedor no está activo.");
  }
  const razonSocial = safeText(stored.razonSocial, 240);
  if (!razonSocial) {
    fail(HttpsError, "failed-precondition", "El proveedor no tiene razón social.");
  }
  return {
    proveedorId: context.proveedorId,
    rut: safeText(stored.rut, 40),
    razonSocial,
    nombreFantasia: safeText(stored.nombreFantasia, 240),
    giro: safeText(stored.giro, 240),
    personaContacto: safeText(stored.personaContacto, 200),
    email: safeText(stored.email, 240),
    telefono: safeText(stored.telefono, 100),
    direccion: safeText(stored.direccion, 300),
    regionCodigo: safeText(stored.regionCodigo, 20),
    regionNombre: safeText(stored.regionNombre, 160),
    comunaCodigo: safeText(stored.comunaCodigo, 20),
    comunaNombre: safeText(stored.comunaNombre, 160),
    condicionesPago: safeText(stored.condicionesPago, 2000),
    diasCredito: Number.isSafeInteger(Number(stored.diasCredito))
      ? Number(stored.diasCredito)
      : 0,
  };
}

function inventorySnapshotFromDocument(snapshot, context, HttpsError) {
  if (!snapshot.exists) {
    fail(HttpsError, "not-found", `No se encontró el ítem ${context.itemId}.`);
  }
  const stored = snapshot.data() || {};
  if (stored.negocioId && stored.negocioId !== context.businessId) {
    fail(HttpsError, "failed-precondition", "El ítem pertenece a otro negocio.");
  }
  if (stored.estado && stored.estado !== "activo") {
    fail(HttpsError, "failed-precondition", "Solo puedes agregar ítems activos.");
  }
  const tipoItem = ITEM_TYPES.has(stored.tipoItem) ? stored.tipoItem : "producto";
  const nombre = safeText(stored.nombre || stored.descripcionItem, 240);
  if (!nombre) {
    fail(HttpsError, "failed-precondition", "El ítem no tiene un nombre válido.");
  }
  return {
    inventarioId: context.itemId,
    codigoInterno: safeText(stored.codigoInterno || stored.sku, 100),
    nombre,
    descripcion: safeText(stored.descripcion, 3000),
    tipoItem,
    unidad: safeText(stored.unidad, 80) ||
      (tipoItem === "producto" ? "unidad" : tipoItem),
    modeloInventarioVersion: Number(stored.modeloInventarioVersion || 1),
  };
}

function buildStoredLine(input, inventorySnapshot, HttpsError) {
  const subtotalLinea = Math.round(input.cantidad * input.costoUnitario);
  const descuentoLinea = Math.round((subtotalLinea * input.descuentoPct) / 100);
  const totalLinea = subtotalLinea - descuentoLinea;
  assertSafeMoney([subtotalLinea, descuentoLinea, totalLinea], HttpsError);
  return {
    lineaId: input.lineaId,
    itemId: input.itemId,
    codigo: inventorySnapshot.codigoInterno,
    nombre: inventorySnapshot.nombre,
    descripcion: inventorySnapshot.descripcion,
    tipoItem: inventorySnapshot.tipoItem,
    unidad: inventorySnapshot.unidad,
    cantidad: input.cantidad,
    costoUnitario: input.costoUnitario,
    descuentoPct: input.descuentoPct,
    subtotalLinea,
    descuentoLinea,
    totalLinea,
    inventarioSnapshot: inventorySnapshot,
  };
}

function calculateTotals(items, HttpsError, taxRate = VAT_RATE) {
  const subtotal = items.reduce((sum, item) => sum + item.subtotalLinea, 0);
  const descuentoTotal = items.reduce((sum, item) => sum + item.descuentoLinea, 0);
  const neto = subtotal - descuentoTotal;
  const iva = Math.round(neto * taxRate);
  const total = neto + iva;
  assertSafeMoney(
    [subtotal, descuentoTotal, neto, iva, total],
    HttpsError
  );
  return {subtotal, descuentoTotal, neto, iva, total};
}

function orderFingerprint(input) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function isRetryable(error) {
  const code = Number(error?.code);
  const message = String(error?.details || error?.message || "").toLowerCase();
  return code === 10 || (code === 3 && message.includes("transaction is invalid"));
}

async function withTransactionRetry(db, operation) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await db.runTransaction(operation);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 30 * (2 ** (attempt - 1))));
    }
  }
  throw lastError;
}

async function requireWriteAccess(request, dependencies) {
  return dependencies.requireBusinessAccess(
    request,
    {db: dependencies.db, HttpsError: dependencies.HttpsError},
    {roles: WRITE_ROLES}
  );
}

async function crearOrdenCompraHandler(request, dependencies, now = new Date()) {
  const {db, FieldValue, HttpsError} = dependencies;
  const {uid, businessId, businessRef} = await requireWriteAccess(
    request,
    dependencies
  );
  const requestId = requireRequestId(request?.data?.requestId, HttpsError);
  const input = normalizePurchaseOrderInput(request?.data?.ordenCompra, HttpsError);
  const fingerprint = orderFingerprint(input);
  const dateParts = getChileDateParts(now);
  const orderRef = businessRef.collection("ordenesCompra").doc();
  const requestRef = businessRef.collection("purchaseOrderCreateRequests").doc(requestId);
  const counterRef = businessRef.collection("purchaseOrderCounters")
    .doc(String(dateParts.year));

  return withTransactionRetry(db, async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);
    if (requestSnapshot.exists) {
      const requestData = requestSnapshot.data() || {};
      if (requestData.uidUsuario !== uid || requestData.fingerprint !== fingerprint) {
        fail(HttpsError, "already-exists", "La solicitud ya fue usada con otros datos.");
      }
      const existingRef = businessRef.collection("ordenesCompra")
        .doc(requestData.ordenCompraId);
      const existingSnapshot = await transaction.get(existingRef);
      if (!existingSnapshot.exists) {
        fail(HttpsError, "internal", "La solicitud idempotente está incompleta.");
      }
      return {
        ordenCompra: {id: existingSnapshot.id, ...existingSnapshot.data()},
        requestId,
        idempotent: true,
      };
    }

    const providerRef = businessRef.collection("proveedores").doc(input.proveedorId);
    const inventoryRefs = input.items.map((item) =>
      businessRef.collection("inventario").doc(item.itemId)
    );
    const taxSettingsRef = businessRef.collection("configuracion").doc("impuestos");
    const companyProfileRef = businessRef.collection("empresa").doc("perfil");
    const snapshots = await transaction.getAll(providerRef, counterRef, businessRef, taxSettingsRef, companyProfileRef, ...inventoryRefs);
    const proveedorSnapshot = providerSnapshotFromDocument(
      snapshots[0],
      {businessId, proveedorId: input.proveedorId},
      HttpsError
    );
    const items = input.items.map((item, index) => buildStoredLine(
      item,
      inventorySnapshotFromDocument(
        snapshots[index + 5],
        {businessId, itemId: item.itemId},
        HttpsError
      ),
      HttpsError
    ));
    const current = Number(snapshots[1].data()?.lastNumber || 0);
    const next = Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1;
    const numero = formatPurchaseOrderNumber(dateParts.year, next);
    const timestamp = FieldValue.serverTimestamp();
    const localization = documentLocalizationSnapshot(
      snapshots[2].data() || {},
      snapshots[3].data() || {}
    );
    const stored = {
      modeloOrdenCompraVersion: PURCHASE_ORDER_MODEL_VERSION,
      ordenCompraId: orderRef.id,
      negocioId: businessId,
      numero,
      anio: dateParts.year,
      correlativo: next,
      estado: "borrador",
      paisCodigo: localization.paisCodigo,
      moneda: localization.moneda,
      locale: localization.locale,
      impuestoNombre: localization.impuestoNombre,
      tasaIva: localization.tasaIva,
      empresaSnapshot: buildAuthoritativeCompanySnapshot({
        businessId,
        business: snapshots[2].data() || {},
        profile: snapshots[4].data() || {},
      }),
      fechaEmision: getChileDateValue(now),
      fechaEntregaEstimada: input.fechaEntregaEstimada,
      direccionEntrega: input.direccionEntrega,
      condicionesPago: input.condicionesPago || proveedorSnapshot.condicionesPago,
      observaciones: input.observaciones,
      proveedorId: input.proveedorId,
      proveedorSnapshot,
      items,
      ...calculateTotals(items, HttpsError, localization.tasaIva),
      creadoPorUid: uid,
      actualizadoPorUid: uid,
      creadoEn: timestamp,
      actualizadoEn: timestamp,
    };
    transaction.set(counterRef, {
      negocioId: businessId,
      year: dateParts.year,
      lastNumber: next,
      actualizadoEn: timestamp,
    });
    transaction.set(orderRef, stored);
    transaction.set(requestRef, {
      negocioId: businessId,
      ordenCompraId: orderRef.id,
      numero,
      fingerprint,
      uidUsuario: uid,
      creadoEn: timestamp,
    });
    return {
      ordenCompra: {...stored, id: orderRef.id, creadoEn: null, actualizadoEn: null},
      requestId,
      idempotent: false,
    };
  });
}

function historicalPurchaseOrderCopyInput(source = {}) {
  return {
    proveedorId: source.proveedorId || source.proveedorSnapshot?.proveedorId,
    fechaEntregaEstimada: source.fechaEntregaEstimada,
    direccionEntrega: source.direccionEntrega,
    condicionesPago: source.condicionesPago,
    observaciones: source.observaciones,
    items: (Array.isArray(source.items) ? source.items : []).map((item, index) => ({
      lineaId: item?.lineaId || `linea-${index + 1}`,
      itemId: item?.itemId || item?.inventarioId || item?.inventarioSnapshot?.inventarioId,
      cantidad: item?.cantidad,
      costoUnitario: item?.costoUnitario ?? item?.costo ?? item?.costoBase,
      descuentoPct: item?.descuentoPct ?? item?.descuentoPorcentaje ?? 0,
    })),
  };
}

async function duplicarOrdenCompraComoBorradorHandler(
  request,
  dependencies,
  now = new Date()
) {
  const {db, FieldValue, HttpsError} = dependencies;
  const {uid, businessId, businessRef} = await requireWriteAccess(
    request,
    dependencies
  );
  const requestId = requireRequestId(request?.data?.requestId, HttpsError);
  const sourceId = requireId(request?.data?.sourceId, "La orden original", HttpsError);
  const sourceRef = businessRef.collection("ordenesCompra").doc(sourceId);
  const orderRef = businessRef.collection("ordenesCompra").doc();
  const requestRef = businessRef.collection("purchaseOrderDuplicateRequests")
    .doc(requestId);
  const dateParts = getChileDateParts(now);
  const counterRef = businessRef.collection("purchaseOrderCounters")
    .doc(String(dateParts.year));

  return withTransactionRetry(db, async (transaction) => {
    const existingRequest = await transaction.get(requestRef);
    if (existingRequest.exists) {
      const requestData = existingRequest.data() || {};
      if (requestData.uidUsuario !== uid || requestData.ordenCompraOrigenId !== sourceId) {
        fail(
          HttpsError,
          "already-exists",
          "La solicitud ya fue usada para otra duplicación."
        );
      }
      const existingSnapshot = await transaction.get(
        businessRef.collection("ordenesCompra").doc(requestData.ordenCompraId)
      );
      if (!existingSnapshot.exists) {
        fail(HttpsError, "internal", "La duplicación idempotente está incompleta.");
      }
      return {
        ordenCompra: {id: existingSnapshot.id, ...existingSnapshot.data()},
        requestId,
        idempotent: true,
      };
    }

    const sourceSnapshot = await transaction.get(sourceRef);
    if (!sourceSnapshot.exists) {
      fail(HttpsError, "not-found", "No se encontró la orden original.");
    }
    const source = sourceSnapshot.data() || {};
    if (source.negocioId !== businessId) {
      fail(HttpsError, "permission-denied", "No puedes duplicar esta orden.");
    }
    if (!["emitida", "cancelada"].includes(source.estado)) {
      fail(
        HttpsError,
        "failed-precondition",
        "Los borradores se editan directamente y no necesitan duplicarse."
      );
    }

    const input = normalizePurchaseOrderInput(
      historicalPurchaseOrderCopyInput(source),
      HttpsError
    );
    const providerRef = businessRef.collection("proveedores").doc(input.proveedorId);
    const inventoryRefs = input.items.map((item) =>
      businessRef.collection("inventario").doc(item.itemId)
    );
    const companyProfileRef = businessRef.collection("empresa").doc("perfil");
    const snapshots = await transaction.getAll(
      providerRef,
      counterRef,
      businessRef,
      companyProfileRef,
      ...inventoryRefs
    );
    if (snapshots[0].exists && snapshots[0].data()?.estado === "archivado") {
      fail(
        HttpsError,
        "failed-precondition",
        "El proveedor de la orden original está archivado. Reactívalo para crear una nueva orden."
      );
    }
    const proveedorSnapshot = providerSnapshotFromDocument(
      snapshots[0],
      {businessId, proveedorId: input.proveedorId},
      HttpsError
    );
    const items = input.items.map((item, index) => buildStoredLine(
      item,
      inventorySnapshotFromDocument(
        snapshots[index + 4],
        {businessId, itemId: item.itemId},
        HttpsError
      ),
      HttpsError
    ));
    const current = Number(snapshots[1].data()?.lastNumber || 0);
    const next = Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1;
    const numero = formatPurchaseOrderNumber(dateParts.year, next);
    const timestamp = FieldValue.serverTimestamp();
    const originNumber = safeText(source.numero || source.numeroOrdenCompra, 120);
    const localization = adaptDocumentLocalization(source);
    const stored = {
      modeloOrdenCompraVersion: PURCHASE_ORDER_MODEL_VERSION,
      ordenCompraId: orderRef.id,
      negocioId: businessId,
      numero,
      anio: dateParts.year,
      correlativo: next,
      estado: "borrador",
      paisCodigo: localization.paisCodigo,
      moneda: localization.moneda,
      locale: localization.locale,
      impuestoNombre: localization.impuestoNombre,
      tasaIva: localization.tasaIva,
      empresaSnapshot: buildAuthoritativeCompanySnapshot({
        businessId,
        business: snapshots[2].data() || {},
        profile: snapshots[3].data() || {},
      }),
      fechaEmision: getChileDateValue(now),
      fechaEntregaEstimada: input.fechaEntregaEstimada,
      direccionEntrega: input.direccionEntrega,
      condicionesPago: input.condicionesPago || proveedorSnapshot.condicionesPago,
      observaciones: input.observaciones,
      proveedorId: input.proveedorId,
      proveedorSnapshot,
      items,
      ...calculateTotals(items, HttpsError, localization.tasaIva),
      ordenCompraOrigenId: sourceId,
      ordenCompraOrigenNumero: originNumber,
      creadoPorUid: uid,
      actualizadoPorUid: uid,
      creadoEn: timestamp,
      actualizadoEn: timestamp,
    };
    transaction.set(counterRef, {
      negocioId: businessId,
      year: dateParts.year,
      lastNumber: next,
      actualizadoEn: timestamp,
    });
    transaction.set(orderRef, stored);
    transaction.set(requestRef, {
      negocioId: businessId,
      ordenCompraId: orderRef.id,
      numero,
      uidUsuario: uid,
      ordenCompraOrigenId: sourceId,
      ordenCompraOrigenNumero: originNumber,
      creadoEn: timestamp,
    });
    return {
      ordenCompra: {...stored, id: orderRef.id, creadoEn: null, actualizadoEn: null},
      requestId,
      idempotent: false,
    };
  });
}

function preservedInventorySnapshot(line) {
  const raw = line?.inventarioSnapshot || {};
  return {
    inventarioId: safeText(raw.inventarioId || line?.itemId, 160),
    codigoInterno: safeText(raw.codigoInterno || line?.codigo, 100),
    nombre: safeText(raw.nombre || line?.nombre, 240),
    descripcion: safeText(raw.descripcion || line?.descripcion, 3000),
    tipoItem: ITEM_TYPES.has(raw.tipoItem || line?.tipoItem)
      ? raw.tipoItem || line.tipoItem
      : "producto",
    unidad: safeText(raw.unidad || line?.unidad, 80) || "unidad",
    modeloInventarioVersion: Number(raw.modeloInventarioVersion || 1),
  };
}

function preservedProviderSnapshot(order) {
  const raw = order?.proveedorSnapshot || order?.proveedor || {};
  return {
    proveedorId: safeText(
      raw.proveedorId || order?.proveedorId,
      160
    ),
    rut: safeText(raw.rut || order?.proveedorRut, 40),
    razonSocial: safeText(
      raw.razonSocial || raw.nombre || order?.proveedorNombre,
      240
    ),
    nombreFantasia: safeText(raw.nombreFantasia, 240),
    giro: safeText(raw.giro, 240),
    personaContacto: safeText(raw.personaContacto || raw.contacto, 200),
    email: safeText(raw.email || raw.correo, 240),
    telefono: safeText(raw.telefono, 100),
    direccion: safeText(raw.direccion, 300),
    regionCodigo: safeText(raw.regionCodigo, 20),
    regionNombre: safeText(raw.regionNombre || raw.region, 160),
    comunaCodigo: safeText(raw.comunaCodigo, 20),
    comunaNombre: safeText(raw.comunaNombre || raw.comuna, 160),
    condicionesPago: safeText(raw.condicionesPago, 2000),
    diasCredito: Number.isSafeInteger(Number(raw.diasCredito))
      ? Number(raw.diasCredito)
      : 0,
  };
}

async function actualizarOrdenCompraBorradorHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const {uid, businessId, businessRef} = await requireWriteAccess(
    request,
    dependencies
  );
  const orderId = requireId(request?.data?.ordenCompraId, "La orden", HttpsError);
  const input = normalizePurchaseOrderInput(request?.data?.ordenCompra, HttpsError);
  const orderRef = businessRef.collection("ordenesCompra").doc(orderId);

  return withTransactionRetry(db, async (transaction) => {
    const existingSnapshot = await transaction.get(orderRef);
    if (!existingSnapshot.exists) fail(HttpsError, "not-found", "La orden no existe.");
    const existing = existingSnapshot.data() || {};
    if (existing.negocioId !== businessId) {
      fail(HttpsError, "permission-denied", "No puedes editar esta orden.");
    }
    if (existing.estado !== "borrador") {
      fail(HttpsError, "failed-precondition", "Solo puedes editar órdenes en borrador.");
    }

    const providerChanged = input.proveedorId !== existing.proveedorId;
    const existingByLine = new Map(
      (Array.isArray(existing.items) ? existing.items : [])
        .map((line) => [safeText(line.lineaId, 160), line])
    );
    const itemNeedsRead = input.items.map((item) => {
      const previous = existingByLine.get(item.lineaId);
      return !previous || safeText(previous.itemId, 160) !== item.itemId;
    });
    const refs = [];
    if (providerChanged) {
      refs.push(businessRef.collection("proveedores").doc(input.proveedorId));
    }
    input.items.forEach((item, index) => {
      if (itemNeedsRead[index]) {
        refs.push(businessRef.collection("inventario").doc(item.itemId));
      }
    });
    const snapshots = refs.length ? await transaction.getAll(...refs) : [];
    let snapshotIndex = 0;
    const proveedorSnapshot = providerChanged
      ? providerSnapshotFromDocument(
        snapshots[snapshotIndex++],
        {businessId, proveedorId: input.proveedorId},
        HttpsError
      )
      : preservedProviderSnapshot(existing);
    const items = input.items.map((item, index) => {
      const previous = existingByLine.get(item.lineaId);
      const inventorySnapshot = itemNeedsRead[index]
        ? inventorySnapshotFromDocument(
          snapshots[snapshotIndex++],
          {businessId, itemId: item.itemId},
          HttpsError
        )
        : preservedInventorySnapshot(previous);
      return buildStoredLine(item, inventorySnapshot, HttpsError);
    });
    const timestamp = FieldValue.serverTimestamp();
    const updated = {
      fechaEntregaEstimada: input.fechaEntregaEstimada,
      direccionEntrega: input.direccionEntrega,
      condicionesPago: input.condicionesPago,
      observaciones: input.observaciones,
      proveedorId: input.proveedorId,
      proveedorSnapshot,
      items,
      ...calculateTotals(items, HttpsError, adaptDocumentLocalization(existing).tasaIva),
      actualizadoPorUid: uid,
      actualizadoEn: timestamp,
    };
    transaction.update(orderRef, updated);
    return {ordenCompra: {id: orderId, ...existing, ...updated, actualizadoEn: null}};
  });
}

async function transitionOrder(request, dependencies, targetStatus) {
  const {db, FieldValue, HttpsError} = dependencies;
  const {uid, businessId, businessRef} = await requireWriteAccess(
    request,
    dependencies
  );
  const orderId = requireId(request?.data?.ordenCompraId, "La orden", HttpsError);
  const orderRef = businessRef.collection("ordenesCompra").doc(orderId);
  return withTransactionRetry(db, async (transaction) => {
    const snapshot = await transaction.get(orderRef);
    if (!snapshot.exists) fail(HttpsError, "not-found", "La orden no existe.");
    const existing = snapshot.data() || {};
    if (existing.negocioId !== businessId) {
      fail(HttpsError, "permission-denied", "No puedes modificar esta orden.");
    }
    const hasExplicitEmission = Boolean(
      request?.data?.canalEmision || request?.data?.destinatario
    );
    if (
      existing.estado === targetStatus &&
      (targetStatus !== "emitida" || !hasExplicitEmission)
    ) {
      return {ordenCompra: {id: orderId, ...existing}, idempotent: true};
    }
    if (targetStatus === "emitida" && !["borrador", "emitida"].includes(existing.estado)) {
      fail(HttpsError, "failed-precondition", "Solo puedes emitir una orden en borrador.");
    }
    if (targetStatus === "cancelada" && !["borrador", "emitida"].includes(existing.estado)) {
      fail(HttpsError, "failed-precondition", "La orden no se puede cancelar.");
    }
    const timestamp = FieldValue.serverTimestamp();
    const emissionChannel = safeText(
      request?.data?.canalEmision || "manual",
      20
    ).toLowerCase();
    if (
      targetStatus === "emitida" &&
      !["correo", "whatsapp", "manual"].includes(emissionChannel)
    ) {
      fail(HttpsError, "invalid-argument", "El canal de emisión no es válido.");
    }
    const emissionDestination = safeText(
      request?.data?.destinatario || "",
      180
    );
    if (/\r|\n/.test(emissionDestination)) {
      fail(HttpsError, "invalid-argument", "El destino de emisión no es válido.");
    }
    const isResend = targetStatus === "emitida" && existing.estado === "emitida";
    const update = {
      estado: targetStatus,
      actualizadoPorUid: uid,
      actualizadoEn: timestamp,
      ...(targetStatus === "emitida" ? {
        ...(isResend ? {} : {
          emitidaEn: timestamp,
          emitidaPorUid: uid,
          canalEmision: emissionChannel,
          destinatarioEmision: emissionDestination,
        }),
        cantidadEnvios: Number(existing.cantidadEnvios || 0) + 1,
        ultimoEnvioEn: timestamp,
        ultimoEnvioPorUid: uid,
        ultimoCanalEnvio: emissionChannel,
        ultimoDestinatarioEnvio: emissionDestination,
        ...(isResend ? {
          reenviadaEn: timestamp,
          reenviadaPorUid: uid,
        } : {}),
      } : {canceladaEn: timestamp, canceladaPorUid: uid}),
    };
    transaction.update(orderRef, update);
    return {
      ordenCompra: {id: orderId, ...existing, ...update, actualizadoEn: null},
      idempotent: false,
    };
  });
}

function emitirOrdenCompraHandler(request, dependencies) {
  return transitionOrder(request, dependencies, "emitida");
}

function cancelarOrdenCompraHandler(request, dependencies) {
  return transitionOrder(request, dependencies, "cancelada");
}

async function registrarRespuestaProveedorHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const {uid, businessId, businessRef} = await requireWriteAccess(
    request,
    dependencies
  );
  const orderId = requireId(request?.data?.ordenCompraId, "La orden", HttpsError);
  const state = safeText(request?.data?.estado, 20).toLowerCase();
  if (!["confirmada", "rechazada"].includes(state)) {
    fail(HttpsError, "invalid-argument", "Selecciona una respuesta valida.");
  }
  const orderRef = businessRef.collection("ordenesCompra").doc(orderId);
  return withTransactionRetry(db, async (transaction) => {
    const snapshot = await transaction.get(orderRef);
    if (!snapshot.exists) fail(HttpsError, "not-found", "La orden no existe.");
    const order = snapshot.data() || {};
    if (order.negocioId !== businessId) {
      fail(HttpsError, "permission-denied", "No puedes modificar esta orden.");
    }
    if (order.estado !== "emitida") {
      fail(HttpsError, "failed-precondition", "La respuesta solo se registra en ordenes emitidas.");
    }
    const timestamp = FieldValue.serverTimestamp();
    const answer = {
      estado: state,
      fecha: timestamp,
      registradaPorUid: uid,
      registradaPorNombre: safeText(request.auth?.token?.name, 160),
      registradaPorEmail: safeText(request.auth?.token?.email, 240),
      comentario: safeText(request?.data?.comentario, 2000),
    };
    const update = {
      respuestaProveedor: answer,
      actualizadoPorUid: uid,
      actualizadoEn: timestamp,
    };
    transaction.update(orderRef, update);
    return {
      ordenCompra: {id: orderId, ...order, ...update, actualizadoEn: null},
    };
  });
}

module.exports = {
  PURCHASE_ORDER_MODEL_VERSION,
  actualizarOrdenCompraBorradorHandler,
  cancelarOrdenCompraHandler,
  calculateTotals,
  crearOrdenCompraHandler,
  duplicarOrdenCompraComoBorradorHandler,
  emitirOrdenCompraHandler,
  formatPurchaseOrderNumber,
  getChileDateValue,
  inventorySnapshotFromDocument,
  historicalPurchaseOrderCopyInput,
  normalizePurchaseOrderInput,
  providerSnapshotFromDocument,
  registrarRespuestaProveedorHandler,
};
