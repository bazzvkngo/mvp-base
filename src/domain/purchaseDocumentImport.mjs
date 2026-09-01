import {adaptStoredFiscalIdentifier} from "./fiscalIdentifier.mjs";

const MAX_DOCUMENT_SIZE_BYTES = 5 * 1024 * 1024;
const DOCUMENT_TYPES = new Set(["factura", "boleta", "otro", "sin_documento"]);

const text = (value, max = 2000) => String(value ?? "").trim()
  .replace(/\s+/g, " ").slice(0, max);

const comparable = (value) => text(value, 400).normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const fiscalComparable = (value) => text(value, 100).toUpperCase()
  .replace(/[^A-Z0-9]/g, "");

const finite = (value, fallback = 0) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const optionalFinite = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const providerId = (provider) => text(provider?.proveedorId || provider?.id, 160);
const itemId = (item) => text(item?.id || item?.itemId || item?.inventarioId, 160);

function providerFiscal(provider = {}) {
  if (provider.paisCodigo) {
    return fiscalComparable(
      adaptStoredFiscalIdentifier(provider, provider.paisCodigo)
        .identificadorFiscalNormalizado
    );
  }
  return fiscalComparable(
    provider.identificadorFiscalNormalizado ||
    provider.identificadorFiscalValor ||
    provider.rutNormalizado ||
    provider.rut
  );
}

function providerNames(provider = {}) {
  return [provider.razonSocial, provider.nombreFantasia, provider.nombre]
    .map(comparable).filter(Boolean);
}

export function matchPurchaseDocumentProvider(analysis = {}, providers = []) {
  const available = (Array.isArray(providers) ? providers : [])
    .filter((provider) => (provider.estado || "activo") === "activo" && providerId(provider));
  const extractedFiscal = fiscalComparable(analysis?.proveedor?.identificadorFiscal);
  if (extractedFiscal) {
    const matches = available.filter((provider) => providerFiscal(provider) === extractedFiscal);
    if (matches.length === 1) {
      return {
        estado: "vinculado",
        proveedorId: providerId(matches[0]),
        criterio: "identificador_fiscal",
        mensaje: "Proveedor reconocido por identificador fiscal.",
      };
    }
  }

  const extractedName = comparable(analysis?.proveedor?.nombre);
  if (extractedName) {
    const exact = available.filter((provider) => providerNames(provider).includes(extractedName));
    const reasonable = exact.length ? exact : available.filter((provider) =>
      providerNames(provider).some((name) => name.length >= 5 && extractedName.length >= 5 &&
        (name.includes(extractedName) || extractedName.includes(name)))
    );
    if (reasonable.length === 1) {
      return {
        estado: "revisar",
        proveedorId: providerId(reasonable[0]),
        criterio: "nombre",
        mensaje: "Encontramos un proveedor por nombre. Confirma la selección antes de aplicar.",
      };
    }
  }

  return {
    estado: "sin_coincidencia",
    proveedorId: "",
    criterio: "ninguno",
    mensaje: "No encontramos un proveedor existente para este documento.",
  };
}

function uniqueMatches(items, predicate) {
  const matches = items.filter(predicate);
  return [...new Map(matches.map((item) => [itemId(item), item])).values()];
}

function matchPurchaseDocumentItem(candidate, inventory) {
  const active = inventory.filter((item) =>
    (item.estado || "activo") === "activo" && itemId(item)
  );
  const barcode = text(candidate?.codigoBarras, 120);
  if (barcode) {
    const matches = uniqueMatches(active, (item) =>
      text(item.barcode || item.codigoBarras, 120) === barcode
    );
    if (matches.length) return {kind: "barcode", matches};
  }

  const internalCodes = [candidate?.sku, candidate?.codigo]
    .map(comparable).filter(Boolean);
  if (internalCodes.length) {
    const matches = uniqueMatches(active, (item) => {
      const current = comparable(item.codigoInterno || item.sku);
      return current && internalCodes.includes(current);
    });
    if (matches.length) return {kind: "codigo_interno", matches};
  }

  const descriptions = [candidate?.nombre, candidate?.descripcion]
    .map(comparable).filter((value) => value.length >= 4);
  if (descriptions.length) {
    const exact = uniqueMatches(active, (item) => {
      const targets = [item.nombre, item.descripcion].map(comparable).filter(Boolean);
      return descriptions.some((source) => targets.includes(source));
    });
    if (exact.length) return {kind: "nombre", matches: exact};
    const contained = uniqueMatches(active, (item) => {
      const targets = [item.nombre, item.descripcion].map(comparable).filter(Boolean);
      return descriptions.some((source) => targets.some((target) =>
        source.length >= 8 && target.length >= 8 &&
        (source.includes(target) || target.includes(source))
      ));
    });
    if (contained.length) return {kind: "descripcion", matches: contained};
  }

  return {kind: "ninguno", matches: []};
}

function deriveRowState(row, inventory) {
  const selected = inventory.find((item) => itemId(item) === text(row.selectedItemId, 160));
  if (!selected || (selected.estado || "activo") !== "activo") return "sin_coincidencia";
  const cantidad = finite(row.cantidad, NaN);
  const costoUnitario = finite(row.costoUnitario, NaN);
  const descuentoPct = finite(row.descuentoPct, NaN);
  if (!Number.isFinite(cantidad) || cantidad <= 0 ||
    !Number.isFinite(costoUnitario) || costoUnitario < 0 ||
    !Number.isFinite(descuentoPct) || descuentoPct < 0 || descuentoPct > 100) {
    return "revisar";
  }
  if (row.revisionAceptada === true) return "vinculada";
  return ["barcode", "codigo_interno"].includes(row.matchKind) &&
    row.sourceReviewRequired !== true ? "vinculada" : "revisar";
}

export function buildPurchaseDocumentPreview(candidates = [], inventory = []) {
  return (Array.isArray(candidates) ? candidates : []).map((candidate, index) => {
    const match = matchPurchaseDocumentItem(candidate, Array.isArray(inventory) ? inventory : []);
    const selectedItemId = match.matches.length === 1 ? itemId(match.matches[0]) : "";
    const row = {
      rowId: text(candidate?.id, 160) || `documento-${index + 1}`,
      nombreOrigen: text(candidate?.nombre || candidate?.descripcion, 240) || `Línea ${index + 1}`,
      codigoOrigen: text(candidate?.codigoBarras || candidate?.sku || candidate?.codigoProveedor, 120),
      unidadOrigen: text(candidate?.unidad, 80) || "unidad",
      cantidad: finite(candidate?.cantidadOrigen ?? candidate?.cantidadSugerida, 1),
      costoUnitario: finite(candidate?.costoUnitario ?? candidate?.costoBase, 0),
      descuentoPct: finite(candidate?.descuentoPct, 0),
      totalLinea: finite(candidate?.totalLinea, 0),
      selectedItemId,
      matchKind: match.kind,
      sourceReviewRequired: candidate?.revisionRequerida === true,
      revisionAceptada: false,
      advertencias: (Array.isArray(candidate?.advertencias) ? candidate.advertencias : [])
        .map((warning) => text(warning, 300)).filter(Boolean),
    };
    return {...row, estado: deriveRowState(row, inventory)};
  });
}

export function updatePurchaseDocumentRow(rows, rowId, field, value, inventory = []) {
  return rows.map((row) => {
    if (row.rowId !== rowId) return row;
    let updated = {...row};
    if (field === "selectedItemId") {
      updated = {
        ...updated,
        selectedItemId: text(value, 160),
        matchKind: value ? "seleccion_manual" : "ninguno",
        revisionAceptada: Boolean(value),
      };
    } else if (field === "revisionAceptada") {
      updated.revisionAceptada = value === true;
    } else if (["cantidad", "costoUnitario", "descuentoPct"].includes(field)) {
      updated[field] = value;
    }
    return {...updated, estado: deriveRowState(updated, inventory)};
  });
}

export function getPurchaseDocumentImportSummary(rows = []) {
  const values = Array.isArray(rows) ? rows : [];
  return {
    total: values.length,
    vinculadas: values.filter((row) => row.estado === "vinculada").length,
    revisar: values.filter((row) => row.estado === "revisar").length,
    sinCoincidencia: values.filter((row) => row.estado === "sin_coincidencia").length,
    lista: values.length > 0 && values.every((row) => row.estado === "vinculada"),
  };
}

function documentParty(value = {}) {
  return {
    nombre: text(value.nombre, 240),
    identificadorFiscal: text(value.identificadorFiscal, 80),
  };
}

export function buildPurchaseDocumentSource(fileData = {}, analysis = {}, fields = {}, rows = [], providerMatch = {}) {
  const size = finite(fileData.tamanoBytes, 0);
  if (size < 0 || size > MAX_DOCUMENT_SIZE_BYTES) {
    throw new Error("El archivo no puede superar 5 MB.");
  }
  const summary = getPurchaseDocumentImportSummary(rows);
  if (!summary.lista) {
    throw new Error("Resuelve y revisa todas las líneas antes de aplicar la factura.");
  }
  const detectedType = text(fields.tipoDocumento || analysis.documentType, 40).toLowerCase();
  return {
    origen: "importador_documental",
    nombreArchivo: text(fileData.nombreArchivo, 240),
    tipoArchivo: text(fileData.tipoArchivo, 120),
    extension: text(fileData.extension, 12).toLowerCase(),
    tamanoBytes: Math.round(size),
    tipoDocumento: DOCUMENT_TYPES.has(detectedType) ? detectedType : "otro",
    numeroDocumento: text(fields.numeroDocumento, 120),
    fechaDocumento: text(fields.fechaDocumento, 10),
    fechaVencimiento: text(fields.fechaVencimiento, 10),
    condicionesPago: text(fields.condicionesPago, 1000),
    moneda: text(fields.moneda || analysis?.documento?.moneda, 12).toUpperCase(),
    proveedorDocumento: documentParty(analysis.proveedor),
    receptorDocumento: documentParty(analysis.receptor),
    neto: optionalFinite(fields.neto ?? analysis?.totales?.neto),
    impuestoPorcentaje: optionalFinite(fields.impuestoPorcentaje ?? analysis?.totales?.impuestoPorcentaje),
    impuestoMonto: optionalFinite(fields.impuestoMonto ?? analysis?.totales?.impuestoMonto),
    total: optionalFinite(fields.total ?? analysis?.totales?.total),
    coherenciaEstado: ["coherente", "revisar", "sin_datos"].includes(analysis?.coherencia?.estado)
      ? analysis.coherencia.estado : "sin_datos",
    proveedorCoincidencia: text(providerMatch.criterio, 40),
    lineasDetectadas: summary.total,
    lineasAplicadas: summary.vinculadas,
    advertencias: [
      ...(Array.isArray(analysis.warnings) ? analysis.warnings : []),
      ...(analysis.warning ? [analysis.warning] : []),
    ].map((warning) => text(warning, 300)).filter(Boolean).slice(0, 20),
  };
}

export function applyPurchaseDocumentImport({analysis = {}, fields = {}, fileData = {}, inventory = [], providerMatch = {}, rows = [], selectedProviderId = ""} = {}) {
  const resolvedProviderId = text(selectedProviderId, 160);
  if (!resolvedProviderId) {
    throw new Error("Selecciona un proveedor existente antes de aplicar la factura.");
  }
  const summary = getPurchaseDocumentImportSummary(rows);
  if (!summary.lista) {
    throw new Error("Resuelve y revisa todas las líneas antes de aplicar la factura.");
  }
  const inventoryById = new Map(inventory.map((item) => [itemId(item), item]));
  const items = rows.map((row, index) => {
    const selected = inventoryById.get(text(row.selectedItemId, 160));
    if (!selected || (selected.estado || "activo") !== "activo") {
      throw new Error(`El vínculo de ${row.nombreOrigen || `la línea ${index + 1}`} ya no está disponible.`);
    }
    const cantidad = finite(row.cantidad, NaN);
    const costoUnitario = finite(row.costoUnitario, NaN);
    const descuentoPct = finite(row.descuentoPct, NaN);
    if (!Number.isFinite(cantidad) || cantidad <= 0 ||
      !Number.isFinite(costoUnitario) || costoUnitario < 0 ||
      !Number.isFinite(descuentoPct) || descuentoPct < 0 || descuentoPct > 100) {
      throw new Error(`Revisa cantidad, costo y descuento de ${row.nombreOrigen || `la línea ${index + 1}`}.`);
    }
    return {
      lineaId: `linea-documento-${index + 1}`,
      itemId: itemId(selected),
      codigo: text(selected.codigoInterno || selected.sku, 100),
      nombre: text(selected.nombre, 240),
      descripcion: text(selected.descripcion, 3000),
      tipoItem: text(selected.tipoItem, 20) || "producto",
      unidad: text(selected.unidad, 80) || "unidad",
      cantidad,
      costoUnitario,
      descuentoPct,
    };
  });
  const documentoOrigen = buildPurchaseDocumentSource(
    fileData,
    analysis,
    fields,
    rows,
    providerMatch
  );
  return {
    proveedorId: resolvedProviderId,
    fechaCompra: text(fields.fechaDocumento, 10),
    fechaDocumento: text(fields.fechaDocumento, 10),
    tipoDocumento: documentoOrigen.tipoDocumento,
    numeroDocumentoProveedor: documentoOrigen.numeroDocumento,
    condicionesPago: documentoOrigen.condicionesPago,
    items,
    documentoOrigen,
  };
}
