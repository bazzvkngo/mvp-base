const { createHash } = require("node:crypto");
const {INVENTORY_WRITE_ROLES} = require("./rbac");

const INVENTORY_MODEL_VERSION = 2;
const INVENTORY_PRICE_FORMATION_VERSION = 2;
const MAX_INVENTORY_IMPORT_BATCH_SIZE = 200;
const INVENTORY_TYPES = Object.freeze(["producto", "servicio", "actividad"]);
const INTERNAL_CODE_PREFIXES = Object.freeze({
  producto: "PR",
  servicio: "SV",
  actividad: "AC",
});
const INITIAL_INVENTORY_AREAS = Object.freeze([
  Object.freeze({ id: "area_informatica", nombre: "Informática" }),
  Object.freeze({
    id: "area_sistemas_seguridad",
    nombre: "Sistemas de seguridad",
  }),
  Object.freeze({ id: "area_electricidad", nombre: "Electricidad" }),
  Object.freeze({ id: "area_obra_civil", nombre: "Obra civil" }),
]);
const INITIAL_INVENTORY_CATEGORIES = Object.freeze([
  Object.freeze({
    id: "cat_soporte_tecnico_hardware",
    areaId: "area_informatica",
    nombre: "Soporte técnico y hardware",
  }),
  Object.freeze({
    id: "cat_sistemas_operativos",
    areaId: "area_informatica",
    nombre: "Sistemas operativos",
  }),
  Object.freeze({
    id: "cat_redes_conectividad",
    areaId: "area_informatica",
    nombre: "Redes y conectividad",
  }),
  Object.freeze({
    id: "cat_desarrollo_web_software",
    areaId: "area_informatica",
    nombre: "Desarrollo web y software",
  }),
  Object.freeze({
    id: "cat_bases_datos",
    areaId: "area_informatica",
    nombre: "Bases de datos",
  }),
  Object.freeze({
    id: "cat_cloud_despliegue",
    areaId: "area_informatica",
    nombre: "Cloud y despliegue",
  }),
  Object.freeze({
    id: "cat_seguridad_informatica",
    areaId: "area_informatica",
    nombre: "Seguridad informática",
  }),
  Object.freeze({
    id: "cat_aseguramiento_calidad",
    areaId: "area_informatica",
    nombre: "Aseguramiento de calidad",
  }),
  Object.freeze({
    id: "cat_gestion_ti_consultoria",
    areaId: "area_informatica",
    nombre: "Gestión TI y consultoría",
  }),
]);

function normalizeCatalogName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function safeText(value, maxLength = 180) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function toFiniteNumber(
  value,
  fieldLabel,
  HttpsError,
  { allowNegative = false } = {}
) {
  if (value === "" || value === null || value === undefined) {
    throw new HttpsError("invalid-argument", `${fieldLabel} es obligatorio.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || (!allowNegative && number < 0)) {
    throw new HttpsError(
      "invalid-argument",
      `${fieldLabel} debe ser un número mayor o igual a cero.`
    );
  }
  return number;
}

function requireText(value, fieldLabel, maxLength, HttpsError) {
  const normalized = safeText(value, maxLength);
  if (!normalized) {
    throw new HttpsError("invalid-argument", `${fieldLabel} es obligatorio.`);
  }
  return normalized;
}

function formatInternalCode(tipoItem, sequence) {
  const prefix = INTERNAL_CODE_PREFIXES[tipoItem];
  const number = Number(sequence);
  if (!prefix || !Number.isSafeInteger(number) || number <= 0) {
    throw new Error("No se pudo construir el código interno de inventario.");
  }
  return `${prefix}-${String(number).padStart(4, "0")}`;
}

function normalizeRequestedInventoryCode(value, HttpsError) {
  const raw = safeText(value, 40).toUpperCase().replace(/\s+/g, "-");
  if (!raw) return "";
  if (!/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(raw)) {
    throw new HttpsError(
      "invalid-argument",
      "El código debe contener entre 2 y 40 letras, números, puntos, guiones o guiones bajos."
    );
  }
  if (/^(PR|SV|AC)-\d+$/.test(raw)) {
    throw new HttpsError(
      "invalid-argument",
      "Los prefijos PR, SV y AC están reservados para códigos automáticos."
    );
  }
  return raw;
}

function catalogKeyId(kind, scope, normalizedName) {
  const raw = `${kind}|${scope || "root"}|${normalizedName}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

function inventoryCodeKeyId(code) {
  return Buffer.from(String(code || "").toUpperCase(), "utf8").toString("base64url");
}

function normalizeInventoryCodeForComparison(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "-");
}

function inventoryPersistenceData(item) {
  const { codigoSolicitado, ...data } = item;
  if (!data.areaId) delete data.areaId;
  if (!data.categoriaId) delete data.categoriaId;
  return data;
}

function calculateInventoryPriceFormation({
  costoBase,
  tasaImpuestoCompra,
  margenDeseado,
  precioInterno,
  precioManual,
}) {
  const montoImpuestoCompra = Math.round(costoBase * tasaImpuestoCompra / 100);
  const costoPagado = Math.round(costoBase * (1 + tasaImpuestoCompra / 100));
  const precioVentaSugerido = Math.round(
    costoBase * (1 + tasaImpuestoCompra / 100) * (1 + margenDeseado / 100)
  );
  return {
    tasaImpuestoCompra,
    montoImpuestoCompra,
    costoPagado,
    precioVentaSugerido,
    precioInterno: precioManual ? precioInterno : precioVentaSugerido,
  };
}

async function assertRequestedCodesAvailable(userRef, codes, HttpsError) {
  const requestedCodes = new Set(
    codes.map(normalizeInventoryCodeForComparison).filter(Boolean)
  );
  if (!requestedCodes.size) return;

  const inventorySnapshot = await userRef.collection("inventario").get();
  for (const documentSnapshot of inventorySnapshot.docs) {
    const existingItem = documentSnapshot.data() || {};
    const occupiedCode = [existingItem.codigoInterno, existingItem.sku]
      .map(normalizeInventoryCodeForComparison)
      .find((code) => requestedCodes.has(code));
    if (occupiedCode) {
      throw new HttpsError(
        "already-exists",
        `El código ${occupiedCode} ya existe en el inventario.`
      );
    }
  }
}

function validateCatalogName(value, HttpsError) {
  const nombre = requireText(value, "El nombre", 80, HttpsError);
  const nombreNormalizado = normalizeCatalogName(nombre);
  if (nombreNormalizado.length < 2) {
    throw new HttpsError(
      "invalid-argument",
      "El nombre debe contener al menos dos caracteres."
    );
  }
  return { nombre, nombreNormalizado };
}

function normalizeCatalogStatus(value) {
  return value === "inactivo" ? "inactivo" : "activo";
}

async function readDocumentSnapshot(db, reference) {
  if (typeof reference.get === "function") return reference.get();
  return db.runTransaction((transaction) => transaction.get(reference));
}

function getInventoryTaxFields(item, rawSettings = {}) {
  if (item.tipoItem !== "producto") return {};
  const options = {
    IVA_GENERAL: { impuestoId: "IVA_GENERAL", impuestoTasa: 19 },
    IVA_EXENTO: { impuestoId: "IVA_EXENTO", impuestoTasa: 0 },
    SIN_IMPUESTO: { impuestoId: "SIN_IMPUESTO", impuestoTasa: 0 },
  };
  return options[rawSettings.impuestoPredeterminadoId] || options.IVA_GENERAL;
}

function validateInventoryItemInput(
  data,
  HttpsError,
  { allowNegativeStock = false } = {}
) {
  const source = data && typeof data === "object" ? data : {};
  const tipoItem = safeText(source.tipoItem, 20).toLowerCase();
  if (!INVENTORY_TYPES.includes(tipoItem)) {
    throw new HttpsError(
      "invalid-argument",
      "Selecciona un tipo de ítem válido."
    );
  }

  const areaId = safeText(source.areaId, 120);
  const categoriaId = safeText(source.categoriaId, 120);
  if (categoriaId && !areaId) {
    throw new HttpsError(
      "invalid-argument",
      "Una categoría debe pertenecer a un área."
    );
  }
  const nombre = requireText(source.nombre, "El nombre", 140, HttpsError);
  const unidad = requireText(source.unidad, "La unidad", 40, HttpsError);
  const costoBase = toFiniteNumber(source.costoBase, "El costo base", HttpsError);
  const margenDeseado = toFiniteNumber(
    source.margenDeseado,
    "El recargo",
    HttpsError
  );
  if (margenDeseado > 1000) {
    throw new HttpsError(
      "invalid-argument",
      "El recargo no puede superar 1000%."
    );
  }
  const usesPurchaseTaxPriceFormation = tipoItem === "producto" &&
    Number(source.formacionPrecioVersion) === INVENTORY_PRICE_FORMATION_VERSION;
  const calculatedPrice = Math.round(
    costoBase + (costoBase * margenDeseado) / 100
  );
  const precioManual = source.precioManual === true;
  let precioInterno = precioManual
    ? toFiniteNumber(source.precioInterno, "El precio interno", HttpsError)
    : calculatedPrice;

  const result = {
    areaId,
    categoriaId,
    nombre,
    tipoItem,
    descripcion: safeText(source.descripcion, 1200),
    unidad,
    costoBase,
    margenDeseado,
    precioInterno,
    precioManual,
    estado: "activo",
  };

  const codigoSolicitado = normalizeRequestedInventoryCode(
    source.codigoSolicitado,
    HttpsError
  );
  if (codigoSolicitado) result.codigoSolicitado = codigoSolicitado;

  if (tipoItem === "producto") {
    if (usesPurchaseTaxPriceFormation) {
      const tasaImpuestoCompra = toFiniteNumber(
        source.tasaImpuestoCompra,
        "El IVA de compra",
        HttpsError
      );
      if (tasaImpuestoCompra > 100) {
        throw new HttpsError(
          "invalid-argument",
          "El IVA de compra no puede superar 100%."
        );
      }
      const formation = calculateInventoryPriceFormation({
        costoBase,
        tasaImpuestoCompra,
        margenDeseado,
        precioInterno,
        precioManual,
      });
      precioInterno = formation.precioInterno;
      result.precioInterno = precioInterno;
      result.formacionPrecioVersion = INVENTORY_PRICE_FORMATION_VERSION;
      result.tasaImpuestoCompra = formation.tasaImpuestoCompra;
      result.montoImpuestoCompra = formation.montoImpuestoCompra;
      result.costoPagado = formation.costoPagado;
      result.precioVentaSugerido = formation.precioVentaSugerido;
    }
    const marca = safeText(source.marca, 100);
    const modelo = safeText(source.modelo, 100);
    if (marca) result.marca = marca;
    if (modelo) result.modelo = modelo;
    result.stock = toFiniteNumber(source.stock ?? 0, "El stock actual", HttpsError, {
      allowNegative: allowNegativeStock,
    });
    result.stockMinimo = toFiniteNumber(
      source.stockMinimo ?? 0,
      "El stock mínimo",
      HttpsError
    );
    const unidadStock = safeText(source.unidadStock, 40);
    if (unidadStock) result.unidadStock = unidadStock;
    const codigoBarras = safeText(source.codigoBarras, 120);
    if (codigoBarras) result.codigoBarras = codigoBarras;
  }

  const origen = safeText(source.origen, 80);
  if (
    [
      "importacion_documental_multiformato",
      "importacion_inteligente_archivo",
      "importacion_excel_local",
    ].includes(origen)
  ) {
    result.origen = origen;
  }
  const justificacionSugerencia = safeText(
    source.justificacionSugerencia,
    500
  );
  if (justificacionSugerencia) {
    result.justificacionSugerencia = justificacionSugerencia;
  }
  if (
    source.confianzaPrecio !== "" &&
    source.confianzaPrecio !== null &&
    source.confianzaPrecio !== undefined
  ) {
    const confianzaPrecio = Number(source.confianzaPrecio);
    if (
      !Number.isFinite(confianzaPrecio) ||
      confianzaPrecio < 0 ||
      confianzaPrecio > 100
    ) {
      throw new HttpsError(
        "invalid-argument",
        "La confianza informada debe estar entre 0 y 100."
      );
    }
    result.confianzaPrecio = confianzaPrecio;
  }

  return result;
}

function validateRequestId(value, HttpsError) {
  const requestId = safeText(value, 120);
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(requestId)) {
    throw new HttpsError(
      "invalid-argument",
      "No se pudo validar la solicitud de creación."
    );
  }
  return requestId;
}

async function resolveBusinessContext(
  request,
  { db, HttpsError, requireBusinessAccess }
) {
  if (typeof requireBusinessAccess === "function") {
    return requireBusinessAccess(
      request,
      { db, HttpsError },
      { roles: INVENTORY_WRITE_ROLES }
    );
  }
  const uid = request?.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  return {
    uid,
    businessId: uid,
    businessRef: db.collection("usuarios").doc(uid),
  };
}

function validateImportRowId(value, HttpsError) {
  const rowId = safeText(value, 120);
  if (!/^[a-zA-Z0-9_.:-]{1,120}$/.test(rowId)) {
    throw new HttpsError(
      "invalid-argument",
      "No se pudo relacionar una fila de la importación."
    );
  }
  return rowId;
}

function getImportRequestFingerprint(rows) {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function getInventoryUpdateFingerprint(itemId, item) {
  return createHash("sha256")
    .update(JSON.stringify({itemId, item}))
    .digest("hex");
}

function optionalField(value, FieldValue) {
  return value ? value : FieldValue.delete();
}

function inventoryEditableUpdate(item, categoryName, FieldValue) {
  const update = {
    nombre: item.nombre,
    descripcion: item.descripcion,
    unidad: item.unidad,
    costoBase: item.costoBase,
    margenDeseado: item.margenDeseado,
    precioInterno: item.precioInterno,
    precioManual: item.precioManual,
    areaId: optionalField(item.areaId, FieldValue),
    categoriaId: optionalField(item.categoriaId, FieldValue),
    categoria: categoryName || "",
  };
  if (item.tipoItem !== "producto") return update;
  return {
    ...update,
    marca: optionalField(item.marca, FieldValue),
    modelo: optionalField(item.modelo, FieldValue),
    codigoBarras: optionalField(item.codigoBarras, FieldValue),
    unidadStock: item.unidadStock || item.unidad,
    stockMinimo: item.stockMinimo,
    formacionPrecioVersion: item.formacionPrecioVersion || FieldValue.delete(),
    tasaImpuestoCompra: item.formacionPrecioVersion
      ? item.tasaImpuestoCompra
      : FieldValue.delete(),
    montoImpuestoCompra: item.formacionPrecioVersion
      ? item.montoImpuestoCompra
      : FieldValue.delete(),
    costoPagado: item.formacionPrecioVersion
      ? item.costoPagado
      : FieldValue.delete(),
    precioVentaSugerido: item.formacionPrecioVersion
      ? item.precioVentaSugerido
      : FieldValue.delete(),
  };
}

function normalizeInventoryImportRows(
  rawRows,
  HttpsError,
  { allowNegativeStock = false } = {}
) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    throw new HttpsError(
      "invalid-argument",
      "Selecciona al menos una fila válida para guardar.",
      { internalCode: "inventory_import_empty_batch" }
    );
  }
  if (rawRows.length > MAX_INVENTORY_IMPORT_BATCH_SIZE) {
    throw new HttpsError(
      "invalid-argument",
      `La confirmación admite un máximo de ${MAX_INVENTORY_IMPORT_BATCH_SIZE} filas por lote. Excluye filas o divídelas en otra importación.`,
      { internalCode: "inventory_import_batch_too_large" }
    );
  }

  const seenRowIds = new Set();
  return rawRows.map((rawRow, index) => {
    const rowId = validateImportRowId(rawRow?.rowId, HttpsError);
    if (seenRowIds.has(rowId)) {
      throw new HttpsError(
        "invalid-argument",
        "Cada fila del lote debe tener un identificador independiente.",
        { internalCode: "inventory_import_duplicate_row", rowId }
      );
    }
    seenRowIds.add(rowId);

    const rawItem = rawRow?.item;
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      throw new HttpsError(
        "invalid-argument",
        `La fila ${index + 1} está incompleta.`,
        { internalCode: "inventory_import_invalid_row", rowId }
      );
    }
    if (
      [
        "codigoInterno",
        "negocioId",
        "uidUsuario",
        "modeloInventarioVersion",
        "creadoEn",
        "actualizadoEn",
      ].some((field) => Object.prototype.hasOwnProperty.call(rawItem, field))
    ) {
      throw new HttpsError(
        "invalid-argument",
        `La fila ${index + 1} contiene campos administrados por el servidor.`,
        { internalCode: "inventory_import_server_fields", rowId }
      );
    }

    try {
      return {
        rowId,
        item: validateInventoryItemInput(rawItem, HttpsError, {
          allowNegativeStock,
        }),
      };
    } catch (error) {
      throw new HttpsError(
        error?.code || "invalid-argument",
        `Fila ${index + 1}: ${error?.message || "datos incompletos"}`,
        { internalCode: "inventory_import_invalid_row", rowId }
      );
    }
  });
}

async function initializeInventoryCatalogHandler(
  request,
  { db, HttpsError, FieldValue, requireBusinessAccess }
) {
  const { uid, businessId, businessRef: userRef } =
    await resolveBusinessContext(request, { db, HttpsError, requireBusinessAccess });
  const areasRef = userRef.collection("areas");
  const categoriesRef = userRef.collection("categoriasInventario");
  const keysRef = userRef.collection("inventoryCatalogKeys");

  const [existingAreasSnapshot, existingCategoriesSnapshot] = await Promise.all([
    areasRef.get(),
    categoriesRef.get(),
  ]);
  const existingAreasByName = new Map(
    existingAreasSnapshot.docs.map((areaDoc) => {
      const data = areaDoc.data() || {};
      return [
        normalizeCatalogName(data.nombreNormalizado || data.nombre),
        { id: areaDoc.id, data },
      ];
    })
  );
  const resolvedAreaIds = new Map(
    INITIAL_INVENTORY_AREAS.map((area) => [
      area.id,
      existingAreasByName.get(normalizeCatalogName(area.nombre))?.id || area.id,
    ])
  );
  const existingCategoriesByScope = new Map(
    existingCategoriesSnapshot.docs.map((categoryDoc) => {
      const data = categoryDoc.data() || {};
      return [
        `${data.areaId || ""}|${normalizeCatalogName(
          data.nombreNormalizado || data.nombre
        )}`,
        { id: categoryDoc.id, data },
      ];
    })
  );

  await db.runTransaction(async (transaction) => {
    const areaEntries = INITIAL_INVENTORY_AREAS.map((area) => {
      const normalizedName = normalizeCatalogName(area.nombre);
      const existing = existingAreasByName.get(normalizedName);
      const resolvedId = existing?.id || area.id;
      return {
        area,
        existing,
        areaRef: areasRef.doc(resolvedId),
        keyRef: keysRef.doc(catalogKeyId("area", "root", normalizedName)),
        normalizedName,
      };
    });
    const categoryEntries = INITIAL_INVENTORY_CATEGORIES.map((category) => {
      const areaId = resolvedAreaIds.get(category.areaId) || category.areaId;
      const normalizedName = normalizeCatalogName(category.nombre);
      const existing = existingCategoriesByScope.get(
        `${areaId}|${normalizedName}`
      );
      return {
        category,
        areaId,
        existing,
        categoryRef: categoriesRef.doc(existing?.id || category.id),
        keyRef: keysRef.doc(
          catalogKeyId("categoria", areaId, normalizedName)
        ),
        normalizedName,
      };
    });
    const snapshots = await Promise.all(
      [...areaEntries, ...categoryEntries].flatMap((entry) => [
          transaction.get(entry.areaRef || entry.categoryRef),
          transaction.get(entry.keyRef),
        ])
    );

    areaEntries.forEach((entry, index) => {
      const areaSnapshot = snapshots[index * 2];
      const keySnapshot = snapshots[index * 2 + 1];
      if (!entry.existing && !areaSnapshot.exists && !keySnapshot.exists) {
        transaction.set(entry.areaRef, {
          nombre: entry.area.nombre,
          nombreNormalizado: entry.normalizedName,
          estado: "activo",
          negocioId: businessId,
          uidUsuario: uid,
          creadoEn: FieldValue.serverTimestamp(),
          actualizadoEn: FieldValue.serverTimestamp(),
        });
      }
      if (!keySnapshot.exists) {
        transaction.set(entry.keyRef, {
          tipo: "area",
          objetivoId: entry.areaRef.id,
          negocioId: businessId,
          uidUsuario: uid,
        });
      }
    });

    const categoryOffset = areaEntries.length * 2;
    categoryEntries.forEach((entry, index) => {
      const categorySnapshot = snapshots[categoryOffset + index * 2];
      const keySnapshot = snapshots[categoryOffset + index * 2 + 1];
      if (!entry.existing && !categorySnapshot.exists && !keySnapshot.exists) {
        transaction.set(entry.categoryRef, {
          areaId: entry.areaId,
          nombre: entry.category.nombre,
          nombreNormalizado: entry.normalizedName,
          estado: "activo",
          negocioId: businessId,
          uidUsuario: uid,
          creadoEn: FieldValue.serverTimestamp(),
          actualizadoEn: FieldValue.serverTimestamp(),
        });
      }
      if (!keySnapshot.exists) {
        transaction.set(entry.keyRef, {
          tipo: "categoria",
          objetivoId: entry.categoryRef.id,
          negocioId: businessId,
          uidUsuario: uid,
        });
      }
    });
  });

  return { initialized: true };
}

async function saveInventoryAreaHandler(
  request,
  { db, HttpsError, FieldValue, requireBusinessAccess }
) {
  const { uid, businessId, businessRef: userRef } =
    await resolveBusinessContext(request, { db, HttpsError, requireBusinessAccess });
  const { nombre, nombreNormalizado } = validateCatalogName(
    request.data?.nombre,
    HttpsError
  );
  const areaId = safeText(request.data?.areaId, 120);
  const estado = normalizeCatalogStatus(request.data?.estado);
  const areaRef = areaId
    ? userRef.collection("areas").doc(areaId)
    : userRef.collection("areas").doc();
  const keyRef = userRef
    .collection("inventoryCatalogKeys")
    .doc(catalogKeyId("area", "root", nombreNormalizado));

  await db.runTransaction(async (transaction) => {
    const [areaSnapshot, keySnapshot] = await Promise.all([
      areaId ? transaction.get(areaRef) : Promise.resolve(null),
      transaction.get(keyRef),
    ]);
    if (areaId && !areaSnapshot.exists) {
      throw new HttpsError("not-found", "El área ya no existe.");
    }
    if (keySnapshot.exists && keySnapshot.data()?.objetivoId !== areaRef.id) {
      throw new HttpsError("already-exists", "Ya existe un área con ese nombre.");
    }

    const previousNormalizedName = areaSnapshot?.data()?.nombreNormalizado || "";
    if (previousNormalizedName && previousNormalizedName !== nombreNormalizado) {
      const previousKeyRef = userRef
        .collection("inventoryCatalogKeys")
        .doc(catalogKeyId("area", "root", previousNormalizedName));
      transaction.delete(previousKeyRef);
    }
    transaction.set(
      areaRef,
      {
        nombre,
        nombreNormalizado,
        estado,
        negocioId: businessId,
        uidUsuario: uid,
        ...(areaId ? {} : { creadoEn: FieldValue.serverTimestamp() }),
        actualizadoEn: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(keyRef, {
      tipo: "area",
      objetivoId: areaRef.id,
      negocioId: businessId,
      uidUsuario: uid,
    });
  });

  return { areaId: areaRef.id };
}

async function saveInventoryCategoryHandler(
  request,
  { db, HttpsError, FieldValue, requireBusinessAccess }
) {
  const { uid, businessId, businessRef: userRef } =
    await resolveBusinessContext(request, { db, HttpsError, requireBusinessAccess });
  const { nombre, nombreNormalizado } = validateCatalogName(
    request.data?.nombre,
    HttpsError
  );
  const categoriaId = safeText(request.data?.categoriaId, 120);
  const areaId = requireText(request.data?.areaId, "El área", 120, HttpsError);
  const estado = normalizeCatalogStatus(request.data?.estado);
  const areaRef = userRef.collection("areas").doc(areaId);
  const categoryRef = categoriaId
    ? userRef.collection("categoriasInventario").doc(categoriaId)
    : userRef.collection("categoriasInventario").doc();
  const keyRef = userRef
    .collection("inventoryCatalogKeys")
    .doc(catalogKeyId("categoria", areaId, nombreNormalizado));

  await db.runTransaction(async (transaction) => {
    const [areaSnapshot, categorySnapshot, keySnapshot] = await Promise.all([
      transaction.get(areaRef),
      categoriaId ? transaction.get(categoryRef) : Promise.resolve(null),
      transaction.get(keyRef),
    ]);
    if (!areaSnapshot.exists || areaSnapshot.data()?.estado !== "activo") {
      throw new HttpsError(
        "failed-precondition",
        "Selecciona un área activa."
      );
    }
    if (categoriaId && !categorySnapshot.exists) {
      throw new HttpsError("not-found", "La categoría ya no existe.");
    }
    if (
      categoriaId &&
      categorySnapshot.data()?.areaId &&
      categorySnapshot.data().areaId !== areaId
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Una categoría existente no puede moverse a otra área. Crea una categoría nueva."
      );
    }
    if (keySnapshot.exists && keySnapshot.data()?.objetivoId !== categoryRef.id) {
      throw new HttpsError(
        "already-exists",
        "Ya existe una categoría con ese nombre dentro del área."
      );
    }

    const previous = categorySnapshot?.data() || {};
    if (
      previous.nombreNormalizado &&
      (previous.nombreNormalizado !== nombreNormalizado || previous.areaId !== areaId)
    ) {
      const previousKeyRef = userRef
        .collection("inventoryCatalogKeys")
        .doc(
          catalogKeyId(
            "categoria",
            previous.areaId,
            previous.nombreNormalizado
          )
        );
      transaction.delete(previousKeyRef);
    }
    transaction.set(
      categoryRef,
      {
        areaId,
        nombre,
        nombreNormalizado,
        estado,
        negocioId: businessId,
        uidUsuario: uid,
        ...(categoriaId ? {} : { creadoEn: FieldValue.serverTimestamp() }),
        actualizadoEn: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(keyRef, {
      tipo: "categoria",
      objetivoId: categoryRef.id,
      areaId,
      negocioId: businessId,
      uidUsuario: uid,
    });
  });

  return { categoriaId: categoryRef.id };
}

async function createInventoryItemWithCodeHandler(
  request,
  { db, HttpsError, FieldValue, requireBusinessAccess }
) {
  const { uid, businessId, businessRef: userRef } =
    await resolveBusinessContext(request, { db, HttpsError, requireBusinessAccess });
  const requestId = validateRequestId(request.data?.requestId, HttpsError);
  const [inventorySettingsSnapshot, taxSettingsSnapshot] = await Promise.all([
    readDocumentSnapshot(
      db,
      userRef.collection("configuracion").doc("inventario")
    ),
    readDocumentSnapshot(
      db,
      userRef.collection("configuracion").doc("impuestos")
    ),
  ]);
  const item = validateInventoryItemInput(request.data?.item, HttpsError, {
    allowNegativeStock:
      inventorySettingsSnapshot.data()?.permitirStockNegativo === true,
  });
  const requestRef = userRef.collection("inventoryCreateRequests").doc(requestId);
  const previousRequest = await readDocumentSnapshot(db, requestRef);
  if (previousRequest.exists) {
    return {
      itemId: previousRequest.data().itemId,
      codigoInterno: previousRequest.data().codigoInterno,
      idempotent: true,
    };
  }
  await assertRequestedCodesAvailable(
    userRef,
    [item.codigoSolicitado],
    HttpsError
  );
  const counterRef = userRef
    .collection("inventarioContadores")
    .doc(item.tipoItem);
  const areaRef = item.areaId
    ? userRef.collection("areas").doc(item.areaId)
    : null;
  const categoryRef = item.categoriaId
    ? userRef.collection("categoriasInventario").doc(item.categoriaId)
    : null;
  const requestedCodeKeyRef = item.codigoSolicitado
    ? userRef.collection("inventoryCodeKeys").doc(
      inventoryCodeKeyId(item.codigoSolicitado)
    )
    : null;
  const itemRef = userRef.collection("inventario").doc();

  return db.runTransaction(async (transaction) => {
    const [requestSnapshot, counterSnapshot, areaSnapshot, categorySnapshot,
      requestedCodeKeySnapshot] =
      await Promise.all([
        transaction.get(requestRef),
        transaction.get(counterRef),
        areaRef ? transaction.get(areaRef) : Promise.resolve(null),
        categoryRef ? transaction.get(categoryRef) : Promise.resolve(null),
        requestedCodeKeyRef
          ? transaction.get(requestedCodeKeyRef)
          : Promise.resolve(null),
      ]);

    if (requestSnapshot.exists) {
      return {
        itemId: requestSnapshot.data().itemId,
        codigoInterno: requestSnapshot.data().codigoInterno,
        idempotent: true,
      };
    }
    if (areaRef && (!areaSnapshot?.exists || areaSnapshot.data()?.estado !== "activo")) {
      throw new HttpsError("failed-precondition", "Selecciona un área activa.");
    }
    if (
      categoryRef && (
      !categorySnapshot?.exists ||
      categorySnapshot.data()?.estado !== "activo" ||
      categorySnapshot.data()?.areaId !== item.areaId)
    ) {
      throw new HttpsError(
        "failed-precondition",
        "La categoría debe estar activa y pertenecer al área seleccionada."
      );
    }

    if (requestedCodeKeySnapshot?.exists) {
      throw new HttpsError(
        "already-exists",
        `El código ${item.codigoSolicitado} ya está reservado.`
      );
    }

    const lastNumber = Number(counterSnapshot.data()?.ultimoNumero || 0);
    const nextNumber = Number.isSafeInteger(lastNumber) ? lastNumber + 1 : 1;
    const codigoInterno = item.codigoSolicitado ||
      formatInternalCode(item.tipoItem, nextNumber);
    const timestamp = FieldValue.serverTimestamp();

    if (!item.codigoSolicitado) {
      transaction.set(counterRef, {
        tipoItem: item.tipoItem,
        ultimoNumero: nextNumber,
        negocioId: businessId,
        uidUsuario: uid,
        actualizadoEn: timestamp,
      });
    }
    transaction.set(itemRef, {
      ...inventoryPersistenceData(item),
      ...getInventoryTaxFields(item, taxSettingsSnapshot.data() || {}),
      categoria: categorySnapshot?.data()?.nombre || "",
      codigoInterno,
      modeloInventarioVersion: INVENTORY_MODEL_VERSION,
      negocioId: businessId,
      uidUsuario: uid,
      creadoEn: timestamp,
      actualizadoEn: timestamp,
    });
    if (requestedCodeKeyRef) {
      transaction.set(requestedCodeKeyRef, {
        codigoInterno,
        itemId: itemRef.id,
        negocioId: businessId,
        uidUsuario: uid,
        creadoEn: timestamp,
      });
    }
    transaction.set(requestRef, {
      itemId: itemRef.id,
      codigoInterno,
      tipoItem: item.tipoItem,
      negocioId: businessId,
      uidUsuario: uid,
      creadoEn: timestamp,
    });

    return { itemId: itemRef.id, codigoInterno, idempotent: false };
  });
}

async function updateInventoryItemHandler(
  request,
  { db, HttpsError, FieldValue, requireBusinessAccess }
) {
  const { uid, businessId, businessRef } = await resolveBusinessContext(
    request,
    {db, HttpsError, requireBusinessAccess}
  );
  const itemId = safeText(request.data?.itemId, 160);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(itemId)) {
    throw new HttpsError("invalid-argument", "Selecciona un ítem válido.");
  }
  const requestId = validateRequestId(request.data?.requestId, HttpsError);
  const inventorySettingsSnapshot = await readDocumentSnapshot(
    db,
    businessRef.collection("configuracion").doc("inventario")
  );
  const item = validateInventoryItemInput(request.data?.item, HttpsError, {
    allowNegativeStock:
      inventorySettingsSnapshot.data()?.permitirStockNegativo === true,
  });
  if (Math.abs(Number(item.stock || 0)) > Number.MAX_SAFE_INTEGER) {
    throw new HttpsError(
      "invalid-argument",
      "El stock está fuera del rango permitido."
    );
  }
  const fingerprint = getInventoryUpdateFingerprint(itemId, item);
  const itemRef = businessRef.collection("inventario").doc(itemId);
  const requestRef = businessRef.collection("inventoryUpdateRequests").doc(requestId);
  const areaRef = item.areaId
    ? businessRef.collection("areas").doc(item.areaId)
    : null;
  const categoryRef = item.categoriaId
    ? businessRef.collection("categoriasInventario").doc(item.categoriaId)
    : null;
  const movementRef = businessRef.collection("movimientosInventario")
    .doc(`ajuste__${requestId}`);

  return db.runTransaction(async (transaction) => {
    const [requestSnapshot, itemSnapshot, areaSnapshot, categorySnapshot] =
      await Promise.all([
        transaction.get(requestRef),
        transaction.get(itemRef),
        areaRef ? transaction.get(areaRef) : Promise.resolve(null),
        categoryRef ? transaction.get(categoryRef) : Promise.resolve(null),
      ]);
    if (requestSnapshot.exists) {
      const previous = requestSnapshot.data() || {};
      if (previous.fingerprint !== fingerprint) {
        throw new HttpsError(
          "failed-precondition",
          "La solicitud ya fue utilizada con una edición diferente."
        );
      }
      return {...(previous.resultado || {}), idempotent: true};
    }
    if (!itemSnapshot.exists) {
      throw new HttpsError("not-found", "El ítem ya no existe.");
    }
    const current = itemSnapshot.data() || {};
    if (current.negocioId && current.negocioId !== businessId) {
      throw new HttpsError("permission-denied", "El ítem no pertenece al negocio.");
    }
    const currentType = INVENTORY_TYPES.includes(current.tipoItem)
      ? current.tipoItem
      : "producto";
    if (currentType !== item.tipoItem) {
      throw new HttpsError(
        "failed-precondition",
        "El tipo de un ítem existente no se puede modificar."
      );
    }
    if (areaRef && (!areaSnapshot?.exists || areaSnapshot.data()?.estado !== "activo")) {
      throw new HttpsError("failed-precondition", "Selecciona un área activa.");
    }
    if (
      categoryRef && (
        !categorySnapshot?.exists ||
        categorySnapshot.data()?.estado !== "activo" ||
        categorySnapshot.data()?.areaId !== item.areaId
      )
    ) {
      throw new HttpsError(
        "failed-precondition",
        "La categoría debe estar activa y pertenecer al área seleccionada."
      );
    }

    const timestamp = FieldValue.serverTimestamp();
    const stockAnterior = Number(current.stock || 0);
    const stockPosterior = item.tipoItem === "producto" ? item.stock : null;
    if (!Number.isFinite(stockAnterior)) {
      throw new HttpsError(
        "failed-precondition",
        "El stock actual no puede ajustarse de forma segura."
      );
    }
    const stockChanged = item.tipoItem === "producto" &&
      stockPosterior !== stockAnterior;
    const update = {
      ...inventoryEditableUpdate(
        item,
        categorySnapshot?.data()?.nombre || "",
        FieldValue
      ),
      ...(stockChanged ? {stock: stockPosterior} : {}),
      actualizadoPorUid: uid,
      actualizadoEn: timestamp,
    };
    transaction.update(itemRef, update);

    if (stockChanged) {
      const delta = stockPosterior - stockAnterior;
      transaction.create(movementRef, {
        movimientoId: movementRef.id,
        negocioId: businessId,
        itemId,
        tipo: "AJUSTE_STOCK",
        direccion: delta > 0 ? "ENTRADA" : "SALIDA",
        cantidad: Math.abs(delta),
        diferenciaStock: delta,
        stockAnterior,
        stockPosterior,
        motivo: "Ajuste manual desde Inventario",
        productoSnapshot: {
          codigoInterno: safeText(current.codigoInterno || current.sku, 80),
          nombre: item.nombre,
          unidad: item.unidadStock || item.unidad,
        },
        creadoPorUid: uid,
        creadoEn: timestamp,
      });
    }
    const result = {
      itemId,
      movimientoId: stockChanged ? movementRef.id : null,
      stockAnterior: item.tipoItem === "producto" ? stockAnterior : null,
      stockPosterior,
      idempotent: false,
    };
    transaction.create(requestRef, {
      negocioId: businessId,
      itemId,
      fingerprint,
      resultado: result,
      creadoPorUid: uid,
      creadoEn: timestamp,
    });
    return result;
  });
}

async function confirmInventoryImportV2Handler(
  request,
  { db, HttpsError, FieldValue, requireBusinessAccess }
) {
  const { uid, businessId, businessRef: userRef } =
    await resolveBusinessContext(request, { db, HttpsError, requireBusinessAccess });
  const requestId = validateRequestId(request.data?.requestId, HttpsError);
  const [inventorySettingsSnapshot, taxSettingsSnapshot] = await Promise.all([
    readDocumentSnapshot(
      db,
      userRef.collection("configuracion").doc("inventario")
    ),
    readDocumentSnapshot(
      db,
      userRef.collection("configuracion").doc("impuestos")
    ),
  ]);
  const rows = normalizeInventoryImportRows(request.data?.rows, HttpsError, {
    allowNegativeStock:
      inventorySettingsSnapshot.data()?.permitirStockNegativo === true,
  });
  const requestedCodes = rows
    .map((row) => row.item.codigoSolicitado)
    .filter(Boolean);
  if (new Set(requestedCodes).size !== requestedCodes.length) {
    throw new HttpsError(
      "invalid-argument",
      "El archivo contiene códigos internos repetidos.",
      { internalCode: "inventory_import_duplicate_code" }
    );
  }
  const fingerprint = getImportRequestFingerprint(rows);
  const importRequestRef = userRef
    .collection("inventoryImportRequests")
    .doc(requestId);
  const previousRequest = await readDocumentSnapshot(db, importRequestRef);
  if (previousRequest.exists) {
    const previous = previousRequest.data() || {};
    if (previous.fingerprint !== fingerprint) {
      throw new HttpsError(
        "failed-precondition",
        "La solicitud ya fue utilizada con un contenido diferente. Vuelve a preparar la importación.",
        { internalCode: "inventory_import_request_conflict" }
      );
    }
    return {
      requestId,
      results: Array.isArray(previous.results) ? previous.results : [],
      total: Number(previous.total || 0),
      idempotent: true,
    };
  }
  await assertRequestedCodesAvailable(userRef, requestedCodes, HttpsError);
  const counterRefs = new Map(
    [...new Set(rows.filter((row) => !row.item.codigoSolicitado)
      .map((row) => row.item.tipoItem))].map((tipoItem) => [
      tipoItem,
      userRef.collection("inventarioContadores").doc(tipoItem),
    ])
  );
  const areaRefs = new Map(
    [...new Set(rows.map((row) => row.item.areaId).filter(Boolean))].map((areaId) => [
      areaId,
      userRef.collection("areas").doc(areaId),
    ])
  );
  const categoryRefs = new Map(
    [...new Set(rows.map((row) => row.item.categoriaId).filter(Boolean))].map((categoriaId) => [
      categoriaId,
      userRef.collection("categoriasInventario").doc(categoriaId),
    ])
  );
  const codeKeyRefs = new Map(
    requestedCodes.map((code) => [
      code,
      userRef.collection("inventoryCodeKeys").doc(inventoryCodeKeyId(code)),
    ])
  );
  const itemRefs = rows.map(() => userRef.collection("inventario").doc());

  return db.runTransaction(async (transaction) => {
    const existingRequest = await transaction.get(importRequestRef);
    if (existingRequest.exists) {
      const previous = existingRequest.data() || {};
      if (previous.fingerprint !== fingerprint) {
        throw new HttpsError(
          "failed-precondition",
          "La solicitud ya fue utilizada con un contenido diferente. Vuelve a preparar la importación.",
          { internalCode: "inventory_import_request_conflict" }
        );
      }
      return {
        requestId,
        results: Array.isArray(previous.results) ? previous.results : [],
        total: Number(previous.total || 0),
        idempotent: true,
      };
    }

    const [counterSnapshots, areaSnapshots, categorySnapshots, codeKeySnapshots] =
      await Promise.all([
        Promise.all(
          [...counterRefs.entries()].map(async ([key, reference]) => [
            key,
            await transaction.get(reference),
          ])
        ),
        Promise.all(
          [...areaRefs.entries()].map(async ([key, reference]) => [
            key,
            await transaction.get(reference),
          ])
        ),
        Promise.all(
          [...categoryRefs.entries()].map(async ([key, reference]) => [
            key,
            await transaction.get(reference),
          ])
        ),
        Promise.all(
          [...codeKeyRefs.entries()].map(async ([key, reference]) => [
            key,
            await transaction.get(reference),
          ])
        ),
      ]);
    const countersByType = new Map(counterSnapshots);
    const areasById = new Map(areaSnapshots);
    const categoriesById = new Map(categorySnapshots);
    const codeKeysByCode = new Map(codeKeySnapshots);

    rows.forEach((row, index) => {
      const areaSnapshot = areasById.get(row.item.areaId);
      const categorySnapshot = categoriesById.get(row.item.categoriaId);
      if (row.item.areaId && (!areaSnapshot?.exists || areaSnapshot.data()?.estado !== "activo")) {
        throw new HttpsError(
          "failed-precondition",
          `La fila ${index + 1} utiliza un Área que ya no está activa. Actualiza la previsualización.`,
          {
            internalCode: "inventory_import_catalog_changed",
            rowId: row.rowId,
          }
        );
      }
      if (
        row.item.categoriaId && (
        !categorySnapshot?.exists ||
        categorySnapshot.data()?.estado !== "activo" ||
        categorySnapshot.data()?.areaId !== row.item.areaId)
      ) {
        throw new HttpsError(
          "failed-precondition",
          `La fila ${index + 1} utiliza una Categoría que cambió o ya no está activa. Actualiza la previsualización.`,
          {
            internalCode: "inventory_import_catalog_changed",
            rowId: row.rowId,
          }
        );
      }
      if (row.item.codigoSolicitado && codeKeysByCode.get(row.item.codigoSolicitado)?.exists) {
        throw new HttpsError(
          "already-exists",
          `La fila ${index + 1} utiliza un código que ya está reservado.`,
          { internalCode: "inventory_import_duplicate_code", rowId: row.rowId }
        );
      }
    });

    const nextNumberByType = new Map(
      [...countersByType.entries()].map(([tipoItem, snapshot]) => {
        const current = Number(snapshot.data()?.ultimoNumero || 0);
        return [tipoItem, Number.isSafeInteger(current) && current >= 0 ? current : 0];
      })
    );
    const timestamp = FieldValue.serverTimestamp();
    const results = rows.map((row, index) => {
      const nextNumber = row.item.codigoSolicitado
        ? null
        : (nextNumberByType.get(row.item.tipoItem) || 0) + 1;
      if (nextNumber !== null) nextNumberByType.set(row.item.tipoItem, nextNumber);
      const codigoInterno = row.item.codigoSolicitado ||
        formatInternalCode(row.item.tipoItem, nextNumber);
      const categorySnapshot = categoriesById.get(row.item.categoriaId);
      const itemRef = itemRefs[index];

      transaction.set(itemRef, {
        ...inventoryPersistenceData(row.item),
        ...getInventoryTaxFields(row.item, taxSettingsSnapshot.data() || {}),
        categoria: categorySnapshot?.data()?.nombre || "",
        codigoInterno,
        modeloInventarioVersion: INVENTORY_MODEL_VERSION,
        negocioId: businessId,
        uidUsuario: uid,
        creadoEn: timestamp,
        actualizadoEn: timestamp,
      });
      if (row.item.codigoSolicitado) {
        transaction.set(codeKeyRefs.get(row.item.codigoSolicitado), {
          codigoInterno,
          itemId: itemRef.id,
          negocioId: businessId,
          uidUsuario: uid,
          creadoEn: timestamp,
        });
      }
      return {
        rowId: row.rowId,
        itemId: itemRef.id,
        codigoInterno,
      };
    });

    nextNumberByType.forEach((ultimoNumero, tipoItem) => {
      transaction.set(counterRefs.get(tipoItem), {
        tipoItem,
        ultimoNumero,
        negocioId: businessId,
        uidUsuario: uid,
        actualizadoEn: timestamp,
      });
    });
    transaction.set(importRequestRef, {
      fingerprint,
      results,
      total: results.length,
      negocioId: businessId,
      uidUsuario: uid,
      creadoEn: timestamp,
    });

    return {
      requestId,
      results,
      total: results.length,
      idempotent: false,
    };
  });
}

module.exports = {
  INITIAL_INVENTORY_AREAS,
  INITIAL_INVENTORY_CATEGORIES,
  INTERNAL_CODE_PREFIXES,
  INVENTORY_MODEL_VERSION,
  INVENTORY_TYPES,
  MAX_INVENTORY_IMPORT_BATCH_SIZE,
  confirmInventoryImportV2Handler,
  createInventoryItemWithCodeHandler,
  formatInternalCode,
  initializeInventoryCatalogHandler,
  normalizeCatalogName,
  saveInventoryAreaHandler,
  saveInventoryCategoryHandler,
  updateInventoryItemHandler,
  validateInventoryItemInput,
};
