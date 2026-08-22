import {adaptStoredFiscalIdentifier} from "./fiscalIdentifier.mjs";

export const QUOTE_MODEL_VERSION = 2;
export const CLP_CURRENCY = "CLP";
export const CHILE_VAT_RATE = 0.19;
export const DEFAULT_QUOTE_VALIDITY_DAYS = 15;
export const DRAFT_QUOTE_NUMBER_LABEL = "Número pendiente";

export const QUOTE_STATUS_LABELS = Object.freeze({
  borrador: "Pendiente",
  emitida: "Emitida",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  vencida: "Vencida",
  archivada: "Archivada",
});

export function getQuoteStatusLabel(status) {
  const normalized = safeQuoteText(status, 30) || "borrador";
  return QUOTE_STATUS_LABELS[normalized] || normalized;
}

const VALID_QUOTE_STATUS = new Set([
  "borrador",
  "emitida",
  "aceptada",
  "rechazada",
  "vencida",
  "archivada",
]);

const VALID_ITEM_TYPES = new Set(["producto", "servicio", "actividad"]);

export const DEFAULT_QUOTE_CONDITIONS = Object.freeze({
  plazoEntrega: "",
  formaPago: "",
  alcanceGeografico: "",
  garantia: "",
  observaciones: "",
  exclusiones: "",
  terminosAdicionales: "",
});

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

export function safeQuoteText(value, maxLength = 2000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function canDuplicateQuotes(role) {
  return ["OWNER", "ADMIN"].includes(String(role || "").toUpperCase());
}

function normalizeIdentifier(value, fallback = "") {
  return safeQuoteText(value, 160).replace(/[^a-zA-Z0-9_.:-]/g, "-") || fallback;
}

function numericError(field, message) {
  const error = new Error(`${field} ${message}`);
  error.code = "quote/invalid-number";
  error.field = field;
  return error;
}

export function readNonNegativeQuoteNumber(value, field, { allowZero = true } = {}) {
  if (value === "" || value === null || value === undefined) {
    throw numericError(field, "es obligatorio.");
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw numericError(field, "debe ser un número válido.");
  }
  if (numberValue < 0 || (!allowZero && numberValue === 0)) {
    throw numericError(
      field,
      allowZero ? "no puede ser negativo." : "debe ser mayor que cero."
    );
  }
  return numberValue;
}

function readOptionalNonNegativeNumber(value, field, fallback = 0) {
  if (value === "" || value === null || value === undefined) return fallback;
  return readNonNegativeQuoteNumber(value, field);
}

export function getQuoteDisplayNumber(quote, fallback = DRAFT_QUOTE_NUMBER_LABEL) {
  return (
    safeQuoteText(quote?.numero || quote?.numeroCotizacion || quote?.quoteNumber, 120) ||
    fallback
  );
}

export function calculateQuoteLineAmounts(item, index = 0) {
  const rowLabel = `Ítem ${index + 1}`;
  const cantidad = readNonNegativeQuoteNumber(item?.cantidad, `${rowLabel}: cantidad`, {
    allowZero: false,
  });
  const precioUnitario = readNonNegativeQuoteNumber(
    item?.precioUnitarioEditable ??
      item?.precioUnitario ??
      item?.precio ??
      item?.precioSugerido,
    `${rowLabel}: precio unitario`
  );
  const descuentoPorcentaje = readOptionalNonNegativeNumber(
    item?.descuentoPorcentaje,
    `${rowLabel}: descuento`,
    0
  );
  if (descuentoPorcentaje > 100) {
    throw numericError(`${rowLabel}: descuento`, "no puede superar 100%.");
  }

  const bruto = Math.round(cantidad * precioUnitario);
  const descuentoLinea = Math.round((bruto * descuentoPorcentaje) / 100);
  const totalLinea = Math.max(bruto - descuentoLinea, 0);

  return {
    cantidad,
    precioUnitario,
    descuentoPorcentaje,
    bruto,
    descuentoLinea,
    totalLinea,
  };
}

export function calculateQuoteLineTotal(item, index = 0) {
  return calculateQuoteLineAmounts(item, index).totalLinea;
}

export function calculateQuoteTotals(
  items,
  descuentoGeneral = 0,
  { afectaIva = true, tasaIva = CHILE_VAT_RATE } = {}
) {
  if (!Array.isArray(items)) {
    throw new Error("Los ítems de la cotización deben ser una lista.");
  }
  const lineAmounts = items.map((item, index) =>
    calculateQuoteLineAmounts(item, index)
  );
  const subtotal = lineAmounts.reduce((sum, line) => sum + line.bruto, 0);
  const descuentoItems = lineAmounts.reduce(
    (sum, line) => sum + line.descuentoLinea,
    0
  );
  const discount = readOptionalNonNegativeNumber(
    descuentoGeneral,
    "El descuento general",
    0
  );
  const maxGeneralDiscount = Math.max(subtotal - descuentoItems, 0);
  if (discount > maxGeneralDiscount) {
    throw numericError(
      "El descuento general",
      "no puede superar el monto pendiente de la cotización."
    );
  }
  const safeVatRate = Number(tasaIva);
  if (!Number.isFinite(safeVatRate) || safeVatRate < 0 || safeVatRate > 1) {
    throw numericError("La tasa de IVA", "es inválida.");
  }

  const descuentoTotal = descuentoItems + discount;
  const neto = Math.max(subtotal - descuentoTotal, 0);
  const iva = afectaIva ? Math.round(neto * safeVatRate) : 0;

  return {
    subtotal,
    descuentoItems,
    descuentoGeneral: discount,
    descuento: discount,
    descuentoTotal,
    neto,
    tasaIva: afectaIva ? safeVatRate : 0,
    afectaIva: Boolean(afectaIva),
    iva,
    total: neto + iva,
    lineAmounts,
  };
}

export function tryCalculateQuoteTotals(items, descuentoGeneral, options) {
  try {
    return { totals: calculateQuoteTotals(items, descuentoGeneral, options), error: null };
  } catch (error) {
    return {
      totals: {
        subtotal: 0,
        descuentoItems: 0,
        descuentoGeneral: 0,
        descuento: 0,
        descuentoTotal: 0,
        neto: 0,
        tasaIva: options?.afectaIva === false ? 0 : CHILE_VAT_RATE,
        afectaIva: options?.afectaIva !== false,
        iva: 0,
        total: 0,
        lineAmounts: [],
      },
      error,
    };
  }
}

export function normalizeInventorySnapshot(item = {}) {
  const source = item?.inventarioSnapshot || item?.item || item;
  return {
    inventarioId: safeQuoteText(
      source.inventarioId || source.id || item.itemId || item.productoId,
      160
    ),
    codigoInterno: safeQuoteText(
      source.codigoInterno || source.codigo || source.sku,
      100
    ),
    nombre: safeQuoteText(source.nombre || item.nombre, 240),
    descripcion: safeQuoteText(source.descripcion || item.descripcion, 3000),
    tipoItem: VALID_ITEM_TYPES.has(source.tipoItem || item.tipoItem)
      ? source.tipoItem || item.tipoItem
      : "producto",
    areaId: safeQuoteText(source.areaId || item.areaId, 160),
    areaNombre: safeQuoteText(source.areaNombre || item.areaNombre, 160),
    categoriaId: safeQuoteText(source.categoriaId || item.categoriaId, 160),
    categoria: safeQuoteText(source.categoria || item.categoria, 160),
    unidad: safeQuoteText(source.unidad || item.unidad, 80) || "unidad",
    modeloInventarioVersion: Number(source.modeloInventarioVersion || 0) || null,
  };
}

export function normalizeQuoteItem(item = {}, index = 0, { strict = false } = {}) {
  const inventorySnapshot = normalizeInventorySnapshot(item);
  let amounts;
  if (strict) {
    amounts = calculateQuoteLineAmounts(item, index);
  } else {
    try {
      amounts = calculateQuoteLineAmounts(item, index);
    } catch {
      const cantidad = Math.max(Number(item?.cantidad) || 1, 0);
      const precioUnitario = Math.max(
        Number(
          item?.precioUnitarioEditable ??
            item?.precioUnitario ??
            item?.precio ??
            item?.precioSugerido
        ) || 0,
        0
      );
      const descuentoPorcentaje = Math.min(
        Math.max(Number(item?.descuentoPorcentaje) || 0, 0),
        100
      );
      const bruto = Math.round(cantidad * precioUnitario);
      const descuentoLinea = Math.round((bruto * descuentoPorcentaje) / 100);
      amounts = {
        cantidad,
        precioUnitario,
        descuentoPorcentaje,
        bruto,
        descuentoLinea,
        totalLinea: bruto - descuentoLinea,
      };
    }
  }

  const inventoryId = inventorySnapshot.inventarioId;
  return {
    lineaId: normalizeIdentifier(
      item.lineaId,
      `linea-${inventoryId || "manual"}-${index + 1}`
    ),
    itemId: safeQuoteText(item.itemId || inventoryId, 160),
    productoId: safeQuoteText(item.productoId || inventoryId, 160),
    codigo: safeQuoteText(
      item.codigo || item.codigoInterno || inventorySnapshot.codigoInterno,
      100
    ),
    nombre: safeQuoteText(item.nombre || inventorySnapshot.nombre, 240) || "Ítem sin nombre",
    descripcion: safeQuoteText(
      item.descripcionComercial ?? item.descripcion ?? inventorySnapshot.descripcion,
      3000
    ),
    descripcionComercial: safeQuoteText(
      item.descripcionComercial ?? item.descripcion ?? inventorySnapshot.descripcion,
      3000
    ),
    tipoItem: VALID_ITEM_TYPES.has(item.tipoItem)
      ? item.tipoItem
      : inventorySnapshot.tipoItem,
    categoria: safeQuoteText(item.categoria || inventorySnapshot.categoria, 160),
    unidad: safeQuoteText(item.unidad || inventorySnapshot.unidad, 80) || "unidad",
    cantidad: amounts.cantidad,
    precioSugerido: Math.max(Number(item.precioSugerido) || amounts.precioUnitario, 0),
    precioUnitarioEditable: amounts.precioUnitario,
    descuentoPorcentaje: amounts.descuentoPorcentaje,
    descuentoLinea: amounts.descuentoLinea,
    subtotalLinea: amounts.bruto,
    totalLinea: amounts.totalLinea,
    inventarioSnapshot: inventorySnapshot,
  };
}

export function normalizeQuoteItems(items, options) {
  return Array.isArray(items)
    ? items.map((item, index) => normalizeQuoteItem(item, index, options))
    : [];
}

export function normalizeScopeSections(sections) {
  if (!Array.isArray(sections)) return [];
  return sections
    .map((section, index) => ({
      id: normalizeIdentifier(section?.id, `alcance-${index + 1}`),
      titulo: safeQuoteText(section?.titulo, 160),
      lineas: Array.isArray(section?.lineas)
        ? section.lineas.map((line) => safeQuoteText(line, 2000)).filter(Boolean)
        : safeQuoteText(section?.descripcion, 6000)
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean),
    }))
    .filter((section) => section.titulo || section.lineas.length > 0);
}

export function normalizeQuoteConditions(raw = {}, company = {}) {
  const conditions = raw?.condiciones && typeof raw.condiciones === "object"
    ? raw.condiciones
    : raw;
  return {
    plazoEntrega: safeQuoteText(conditions.plazoEntrega || conditions.plazoEjecucion, 1000),
    formaPago: safeQuoteText(
      conditions.formaPago || raw.condicionesPago || company.condicionesPago,
      2000
    ),
    alcanceGeografico: safeQuoteText(conditions.alcanceGeografico, 2000),
    garantia: safeQuoteText(conditions.garantia, 2000),
    observaciones: safeQuoteText(conditions.observaciones || raw.observaciones, 4000),
    exclusiones: safeQuoteText(conditions.exclusiones || raw.exclusiones, 4000),
    terminosAdicionales: safeQuoteText(
      conditions.terminosAdicionales || raw.terminosAdicionales,
      6000
    ),
  };
}

export function normalizeCompanySnapshot(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    negocioId: safeQuoteText(source.negocioId || source.businessId, 160),
    nombreComercial: safeQuoteText(source.nombreComercial, 200),
    razonSocial: safeQuoteText(source.razonSocial, 240),
    rut: safeQuoteText(source.rut || source.identificadorFiscalValor, 40),
    identificadorFiscalTipo: safeQuoteText(source.identificadorFiscalTipo, 40) || "RUT",
    identificadorFiscalValor: safeQuoteText(source.identificadorFiscalValor || source.rut, 80),
    giro: safeQuoteText(source.giro, 240),
    email: safeQuoteText(source.email, 240),
    telefono: safeQuoteText(source.telefono, 100),
    direccion: safeQuoteText(source.direccion, 300),
    ciudad: safeQuoteText(source.ciudad, 160),
    region: safeQuoteText(source.region || source.regionNombre, 160),
    regionNombre: safeQuoteText(source.regionNombre || source.region, 160),
    comunaCodigo: safeQuoteText(source.comunaCodigo, 20),
    comunaNombre: safeQuoteText(source.comunaNombre, 160),
    regionEstado: safeQuoteText(source.regionEstado || source.region, 160),
    codigoPostal: safeQuoteText(source.codigoPostal, 30),
    sitioWeb: safeQuoteText(source.sitioWeb, 300),
    logoUrl: safeQuoteText(source.logoUrl, 1200),
    responsable: safeQuoteText(
      source.responsable || source.nombreResponsable || source.ejecutivo,
      200
    ),
    cargoResponsable: safeQuoteText(source.cargoResponsable, 160),
    condicionesPago: safeQuoteText(source.condicionesPago, 2000),
    plazoEntregaCotizacion: safeQuoteText(source.plazoEntregaCotizacion, 1000),
    alcanceGeograficoCotizacion: safeQuoteText(
      source.alcanceGeograficoCotizacion,
      2000
    ),
    garantiaCotizacion: safeQuoteText(source.garantiaCotizacion, 2000),
    exclusionesCotizacion: safeQuoteText(source.exclusionesCotizacion, 4000),
    terminosCotizacion: safeQuoteText(source.terminosCotizacion, 6000),
    aceptacionCotizacionHabilitada:
      source.aceptacionCotizacionHabilitada === true,
    textoAceptacionCotizacion: safeQuoteText(
      source.textoAceptacionCotizacion,
      2000
    ),
    validezCotizacionDias: normalizeValidityDays(
      source.validezCotizacionDias,
      DEFAULT_QUOTE_VALIDITY_DAYS
    ),
    notaPieCotizacion: safeQuoteText(source.notaPieCotizacion, 3000),
  };
}

export function normalizeClientSnapshot(raw = {}) {
  const hasNestedClient = raw?.cliente && typeof raw.cliente === "object";
  const source = hasNestedClient ? raw.cliente : {};
  const nombreRazonSocial = safeQuoteText(
    source.nombreRazonSocial ||
      source.empresa ||
      source.razonSocial ||
      raw.clienteNombre ||
      (!hasNestedClient && typeof raw.empresa === "string" ? raw.empresa : ""),
    240
  );
  const personaContacto = safeQuoteText(
    source.personaContacto || source.contacto || raw.clienteContacto,
    200
  );
  const comunaNombre = safeQuoteText(
    source.comunaNombre || source.ciudad || raw.clienteCiudad,
    160
  );
  return {
    clienteId: safeQuoteText(
      source.clienteId || raw.clienteId || source.clientId || raw.clientId,
      160
    ),
    tipoCliente: safeQuoteText(source.tipoCliente, 20),
    ...adaptStoredFiscalIdentifier({...source, rut: source.rut || raw.clienteRut}),
    nombreRazonSocial,
    giro: safeQuoteText(source.giro, 240),
    email: safeQuoteText(source.email || raw.clienteEmail, 240),
    telefono: safeQuoteText(source.telefono || raw.clienteTelefono, 100),
    direccion: safeQuoteText(source.direccion || raw.clienteDireccion, 300),
    regionCodigo: safeQuoteText(source.regionCodigo, 20),
    regionNombre: safeQuoteText(source.regionNombre, 160),
    comunaCodigo: safeQuoteText(source.comunaCodigo, 20),
    comunaNombre,
    personaContacto,
    empresa: nombreRazonSocial,
    contacto: personaContacto,
    ciudad: comunaNombre,
    proyecto: safeQuoteText(raw.proyectoNombre || source.proyecto, 300),
  };
}

export function resolveQuoteClientSelectionSnapshot(
  selectedClient,
  {originalClienteId = "", originalClientSnapshot = null} = {}
) {
  const selectedSnapshot = normalizeClientSnapshot({cliente: selectedClient});
  const normalizedOriginalId = safeQuoteText(originalClienteId, 160);

  if (
    normalizedOriginalId &&
    selectedSnapshot.clienteId === normalizedOriginalId &&
    originalClientSnapshot
  ) {
    return normalizeClientSnapshot({
      cliente: {
        ...originalClientSnapshot,
        clienteId: normalizedOriginalId,
      },
    });
  }

  return selectedSnapshot;
}

export function normalizeValidityDays(value, fallback = DEFAULT_QUOTE_VALIDITY_DAYS) {
  const days = Number(value);
  return Number.isInteger(days) && days > 0 && days <= 3650 ? days : fallback;
}

export function calculateQuoteExpiryDate(issueDate, validityDays) {
  const dateText = safeQuoteText(issueDate, 40);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!match) return "";
  const days = normalizeValidityDays(validityDays);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function normalizeAcceptance(raw = {}) {
  const source = raw?.aceptacion && typeof raw.aceptacion === "object"
    ? raw.aceptacion
    : raw;
  return {
    habilitada: source.habilitada === true || raw.aceptacionHabilitada === true,
    texto:
      safeQuoteText(source.texto || raw.textoAceptacion, 2000) ||
      "Acepto los términos y condiciones de esta cotización.",
  };
}

export function validateQuoteDraft(raw = {}) {
  const fieldErrors = {};
  const client = normalizeClientSnapshot(raw);
  if (!client.empresa) fieldErrors.clienteNombre = "Ingresa la empresa o razón social.";
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    fieldErrors.items = "Agrega al menos un ítem valorizado.";
  }
  try {
    calculateQuoteTotals(raw.items || [], raw.descuento ?? raw.descuentoGeneral, {
      afectaIva: raw.afectaIva !== false,
    });
  } catch (error) {
    fieldErrors.numericos = error.message;
  }
  normalizeScopeSections(raw.seccionesAlcance).forEach((section, index) => {
    if (!section.titulo) {
      fieldErrors[`alcance.${index}.titulo`] = "Agrega un título a la sección.";
    }
    if (section.lineas.length === 0) {
      fieldErrors[`alcance.${index}.lineas`] = "Agrega al menos una línea descriptiva.";
    }
  });
  return { isValid: Object.keys(fieldErrors).length === 0, fieldErrors };
}

export function buildQuotePayload(uid, raw = {}, { issueDate } = {}) {
  if (!safeQuoteText(uid, 160)) throw new Error("Usuario no autenticado.");
  const company = normalizeCompanySnapshot(raw.empresa || {});
  const client = normalizeClientSnapshot(raw);
  const items = normalizeQuoteItems(raw.items, { strict: true });
  const afectaIva = raw.afectaIva !== false;
  const totals = calculateQuoteTotals(items, raw.descuento ?? raw.descuentoGeneral, {
    afectaIva,
  });
  const fecha = safeQuoteText(raw.fecha || issueDate, 40);
  const validezDias = normalizeValidityDays(
    raw.validezDias ?? raw.validezCotizacionDias,
    company.validezCotizacionDias
  );
  const condiciones = normalizeQuoteConditions(raw, company);
  const estado = VALID_QUOTE_STATUS.has(raw.estado) ? raw.estado : "borrador";

  return {
    modeloCotizacionVersion: QUOTE_MODEL_VERSION,
    moneda: CLP_CURRENCY,
    numero: safeQuoteText(raw.numero, 120),
    trabajoId: safeQuoteText(raw.trabajoId, 160),
    fecha,
    validezDias,
    fechaVencimiento: calculateQuoteExpiryDate(fecha, validezDias),
    estado,
    afectaIva,
    tipoIva: afectaIva ? "afecta" : "exenta",
    tasaIva: totals.tasaIva,
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
    condiciones,
    condicionesPago: condiciones.formaPago,
    observaciones: condiciones.observaciones,
    exclusiones: condiciones.exclusiones,
    terminosAdicionales: condiciones.terminosAdicionales,
    aceptacion: normalizeAcceptance(raw),
    subtotal: totals.subtotal,
    descuento: totals.descuentoGeneral,
    descuentoItems: totals.descuentoItems,
    descuentoTotal: totals.descuentoTotal,
    neto: totals.neto,
    iva: totals.iva,
    total: totals.total,
    uidUsuario: safeQuoteText(uid, 160),
  };
}

export function buildQuoteMutationPayload(uid, raw = {}, options = {}) {
  const payload = buildQuotePayload(uid, raw, options);
  delete payload.empresa;
  if (!payload.clienteId) return payload;

  const mutationPayload = {...payload};
  [
    "cliente",
    "clienteNombre",
    "clienteRut",
    "clienteContacto",
    "clienteEmail",
    "clienteTelefono",
    "clienteDireccion",
    "clienteCiudad",
  ].forEach((field) => delete mutationPayload[field]);
  return mutationPayload;
}

export function adaptStoredQuote(raw = {}) {
  const { clientId: legacyClientId, ...stored } = raw;
  const isCurrent = Number(raw.modeloCotizacionVersion) >= QUOTE_MODEL_VERSION;
  const company = normalizeCompanySnapshot(raw.empresaSnapshot || raw.empresa || {});
  const client = normalizeClientSnapshot({
    ...raw,
    clienteId: raw.clienteId || legacyClientId,
  });
  const items = normalizeQuoteItems(raw.items, { strict: false });
  const legacyTaxUndefined = !isCurrent && !hasOwn(raw, "afectaIva");
  const afectaIva = legacyTaxUndefined ? false : raw.afectaIva !== false;
  const localization = adaptDocumentLocalization(raw);
  const fallbackTotals = tryCalculateQuoteTotals(items, raw.descuento, {
    afectaIva,
    tasaIva: localization.tasaIva,
  }).totals;
  const conditions = normalizeQuoteConditions(raw, company);
  const validezDias = normalizeValidityDays(
    raw.validezDias ?? raw.validezCotizacionDias,
    company.validezCotizacionDias
  );
  const fecha = safeQuoteText(raw.fecha, 40);
  const storedTotal = Number(raw.total);

  return {
    ...stored,
    ...localization,
    modeloCotizacionVersion: isCurrent
      ? Number(raw.modeloCotizacionVersion)
      : 1,
    numero: getQuoteDisplayNumber(raw, ""),
    trabajoId: safeQuoteText(raw.trabajoId, 160),
    trabajoNumero: safeQuoteText(raw.trabajoNumero, 120),
    trabajoTitulo: safeQuoteText(raw.trabajoTitulo, 180),
    fecha,
    validezDias,
    fechaVencimiento:
      safeQuoteText(raw.fechaVencimiento, 40) ||
      calculateQuoteExpiryDate(fecha, validezDias),
    estado: VALID_QUOTE_STATUS.has(raw.estado) ? raw.estado : "borrador",
    afectaIva,
    tipoIva: legacyTaxUndefined ? "legacy_sin_definir" : afectaIva ? "afecta" : "exenta",
    legacyIvaNoDefinido: legacyTaxUndefined,
    empresaSnapshot: company,
    empresa: company,
    cliente: client,
    clienteId: client.clienteId,
    clienteHistoricoNoVinculado:
      !client.clienteId && Boolean(client.empresa || client.rut),
    clienteNombre: client.empresa,
    clienteRut: client.rut,
    clienteContacto: client.contacto,
    clienteEmail: client.email,
    clienteTelefono: client.telefono,
    clienteDireccion: client.direccion,
    clienteCiudad: client.ciudad,
    proyectoNombre: client.proyecto,
    items,
    seccionesAlcance: normalizeScopeSections(raw.seccionesAlcance),
    condiciones: conditions,
    condicionesPago: conditions.formaPago,
    observaciones: conditions.observaciones,
    exclusiones: conditions.exclusiones,
    terminosAdicionales: conditions.terminosAdicionales,
    aceptacion: normalizeAcceptance(raw),
    subtotal: Number.isFinite(Number(raw.subtotal))
      ? Number(raw.subtotal)
      : fallbackTotals.subtotal,
    descuento: Number.isFinite(Number(raw.descuento))
      ? Number(raw.descuento)
      : fallbackTotals.descuentoGeneral,
    descuentoItems: Number(raw.descuentoItems) || fallbackTotals.descuentoItems,
    descuentoTotal: Number(raw.descuentoTotal) || fallbackTotals.descuentoTotal,
    neto: Number.isFinite(Number(raw.neto))
      ? Number(raw.neto)
      : legacyTaxUndefined && Number.isFinite(storedTotal)
        ? storedTotal
        : fallbackTotals.neto,
    iva: legacyTaxUndefined ? 0 : Number(raw.iva) || fallbackTotals.iva,
    total: Number.isFinite(storedTotal) ? storedTotal : fallbackTotals.total,
  };
}

export function buildClientSuggestions(quotes) {
  const byIdentity = new Map();
  (Array.isArray(quotes) ? quotes : []).forEach((quote) => {
    const client = normalizeClientSnapshot(quote);
    const key = (client.rut || client.empresa).toLocaleLowerCase("es-CL");
    if (key && client.empresa && !byIdentity.has(key)) byIdentity.set(key, client);
  });
  return [...byIdentity.values()].sort((left, right) =>
    left.empresa.localeCompare(right.empresa, "es-CL")
  );
}

export function getQuotePdfFileName(quote) {
  const cleanPart = (value, fallback) =>
    safeQuoteText(value, 100)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || fallback;
  const number = cleanPart(getQuoteDisplayNumber(quote, quote?.id || ""), "Cotizacion");
  const client = cleanPart(normalizeClientSnapshot(quote).empresa, "Cliente");
  return `Cotizacion_${number}_${client}.pdf`;
}
import {adaptDocumentLocalization} from "./localization.mjs";
