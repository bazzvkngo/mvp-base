const MAX_DOCUMENT_SIZE_BYTES = 5 * 1024 * 1024;
const DOCUMENT_TYPES = new Set(["factura", "boleta", "otro", "sin_documento"]);

const text = (value, max = 2000) => String(value ?? "").trim()
  .replace(/\s+/g, " ").slice(0, max);

const comparable = (value) => text(value, 300).normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const finite = (value, fallback = 0) => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const optionalFinite = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const documentParty = (value = {}) => ({
  nombre: text(value?.nombre, 240),
  identificadorFiscal: text(value?.identificadorFiscal, 80),
});

const lineId = (line) => text(line?.lineaId || line?.ordenLineaId, 160);
const candidateId = (candidate) => text(
  candidate?.itemId || candidate?.inventoryId || candidate?.inventarioId,
  160
);
const candidateInternalCode = (candidate) => text(
  candidate?.codigo || candidate?.sku,
  100
);
const candidateProviderCode = (candidate) => text(
  candidate?.codigoProveedor,
  100
);
const candidateCode = (candidate) =>
  candidateProviderCode(candidate) || candidateInternalCode(candidate);

const fiscalComparable = (value) => text(value, 100).toUpperCase()
  .replace(/[^A-Z0-9]/g, "");

function uniqueMatches(items, predicate) {
  const matches = items.filter(predicate);
  return [...new Map(matches.map((line) => [lineId(line), line])).values()];
}

function matchCandidate(candidate, receptionItems) {
  const knownId = candidateId(candidate);
  if (knownId) {
    const matches = uniqueMatches(receptionItems, (line) =>
      text(line?.itemId || line?.inventarioSnapshot?.inventarioId, 160) === knownId
    );
    if (matches.length) return {kind: "item_id", matches};
  }

  const internalCode = comparable(candidateInternalCode(candidate));
  if (internalCode) {
    const matches = uniqueMatches(receptionItems, (line) => [
      line?.codigo,
      line?.sku,
      line?.inventarioSnapshot?.codigoInterno,
    ].some((value) => comparable(value) === internalCode));
    if (matches.length) return {kind: "codigo", matches};
  }

  const providerCode = comparable(candidateProviderCode(candidate));
  if (providerCode) {
    const providerMatches = uniqueMatches(receptionItems, (line) => [
      line?.codigoProveedor,
      line?.inventarioSnapshot?.codigoProveedor,
    ].some((value) => comparable(value) === providerCode));
    if (providerMatches.length) return {kind: "codigo_proveedor", matches: providerMatches};
  }

  const descriptions = [candidate?.nombre, candidate?.descripcion]
    .map(comparable).filter((value) => value.length >= 4);
  if (descriptions.length) {
    const matches = uniqueMatches(receptionItems, (line) => {
      const targets = [line?.nombre, line?.descripcion, line?.inventarioSnapshot?.nombre]
        .map(comparable).filter(Boolean);
      return descriptions.some((source) => targets.some((target) =>
        source === target || (source.length >= 8 && target.length >= 8 &&
          (source.includes(target) || target.includes(source)))
      ));
    });
    if (matches.length) return {kind: "descripcion", matches};
  }

  return {kind: "none", matches: []};
}

export function getReceptionImportedProviderStatus(analysis = {}, providerSnapshot = {}) {
  const extractedFiscal = fiscalComparable(analysis?.proveedor?.identificadorFiscal);
  const expectedFiscal = fiscalComparable(
    providerSnapshot?.identificadorFiscalValor ||
    providerSnapshot?.identificadorFiscalNormalizado ||
    providerSnapshot?.rut ||
    providerSnapshot?.rutNormalizado
  );
  if (!extractedFiscal) {
    return {
      estado: "no_identificado",
      mensaje: "No pudimos identificar al proveedor del documento. Revisa sus datos antes de asociar las líneas.",
    };
  }
  if (!expectedFiscal) {
    return {
      estado: "sin_datos_oc",
      mensaje: "La orden no tiene una identificación fiscal disponible para comparar. Continúa con revisión manual.",
    };
  }
  if (expectedFiscal && extractedFiscal === expectedFiscal) {
    return {estado: "coincidencia", mensaje: "Proveedor reconocido por identificador fiscal."};
  }
  return {
    estado: "otro_proveedor",
    mensaje: "El documento corresponde a otro proveedor",
  };
}

export function buildReceptionImportPreview(candidates = [], receptionItems = []) {
  return (Array.isArray(candidates) ? candidates : []).map((candidate, index) => {
    const match = matchCandidate(candidate, receptionItems);
    const selectedLineId = match.matches.length === 1 ? lineId(match.matches[0]) : "";
    const ambiguous = match.matches.length > 1;
    const selectedLine = match.matches.length === 1 ? match.matches[0] : null;
    const candidateQuantity = finite(
      candidate?.cantidadOrigen ?? candidate?.cantidadSugerida ?? candidate?.cantidad ?? candidate?.stock,
      1
    );
    const candidateCost = finite(candidate?.costoBase ?? candidate?.costoUnitario, 0);
    const pending = selectedLine
      ? Math.max(0, finite(selectedLine.cantidadSolicitada) - finite(selectedLine.cantidadRecibidaAnterior))
      : 0;
    const quantityExceedsPending = Boolean(selectedLine) && candidateQuantity > pending + 0.000001;
    const priceDiffers = Boolean(selectedLine) &&
      Math.abs(candidateCost - finite(selectedLine.costoUnitario)) > 0.000001;
    const unitDiffers = Boolean(selectedLine) && comparable(candidate?.unidad) &&
      comparable(candidate.unidad) !== comparable(selectedLine.unidad || "unidad");
    const needsReview = candidate?.revisionRequerida === true ||
      match.kind === "descripcion" || ambiguous || quantityExceedsPending || priceDiffers || unitDiffers;
    const warnings = [
      ...(Array.isArray(candidate?.advertencias) ? candidate.advertencias : []),
      ...(candidate?.observacion ? [candidate.observacion] : []),
      ...(ambiguous ? ["Hay más de una coincidencia posible; selecciona el ítem de la OC."] : []),
      ...(quantityExceedsPending ? ["La cantidad supera lo pendiente por recibir."] : []),
      ...(priceDiffers ? ["El costo unitario difiere del registrado en la orden."] : []),
      ...(unitDiffers ? ["La unidad del documento difiere de la orden."] : []),
    ].map((warning) => text(warning, 300)).filter(Boolean);
    return {
      rowId: text(candidate?.id, 160) || `documento-${index + 1}`,
      nombreOrigen: text(candidate?.nombre || candidate?.descripcion, 240) || `Línea ${index + 1}`,
      codigoOrigen: candidateCode(candidate),
      codigoProveedorOrigen: candidateProviderCode(candidate),
      unidadOrigen: text(candidate?.unidad, 80) || "unidad",
      cantidad: candidateQuantity,
      costoUnitario: candidateCost,
      descuentoPct: finite(candidate?.descuentoPct, 0),
      totalLinea: finite(candidate?.totalLinea, 0),
      selectedLineId,
      matchKind: match.kind,
      sourceReviewRequired: candidate?.revisionRequerida === true,
      estado: selectedLineId
        ? (needsReview ? "revisar" : "coincidencia")
        : (ambiguous ? "revisar" : "sin_asociar"),
      advertencias: [...new Set(warnings)],
    };
  });
}

function deriveRowState(row, receptionItems = []) {
  if (!text(row?.selectedLineId, 160)) return "sin_asociar";
  const target = receptionItems.find((line) => lineId(line) === text(row.selectedLineId, 160));
  if (!target || row.sourceReviewRequired || row.matchKind === "descripcion") return "revisar";
  const pending = Math.max(0, finite(target.cantidadSolicitada) - finite(target.cantidadRecibidaAnterior));
  const quantity = finite(row.cantidad, NaN);
  const cost = finite(row.costoUnitario, NaN);
  const discount = finite(row.descuentoPct, NaN);
  const unitDiffers = comparable(row.unidadOrigen) && comparable(row.unidadOrigen) !== comparable(target.unidad || "unidad");
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > pending + 0.000001 ||
    !Number.isFinite(cost) || cost < 0 || Math.abs(cost - finite(target.costoUnitario)) > 0.000001 ||
    !Number.isFinite(discount) || discount < 0 || discount > 100 || unitDiffers) return "revisar";
  return "coincidencia";
}

export function updateReceptionImportRow(rows, rowId, field, value, receptionItems = []) {
  return rows.map((row) => {
    if (row.rowId !== rowId) return row;
    if (field === "selectedLineId") {
      const updated = {
        ...row,
        selectedLineId: text(value, 160),
        matchKind: value ? "seleccion_manual" : "none",
      };
      return {...updated, estado: deriveRowState(updated, receptionItems)};
    }
    if (["cantidad", "costoUnitario", "descuentoPct"].includes(field)) {
      const updated = {...row, [field]: value};
      return {...updated, estado: deriveRowState(updated, receptionItems)};
    }
    return row;
  });
}

export function getReceptionImportSummary(rows = []) {
  const values = Array.isArray(rows) ? rows : [];
  return {
    total: values.length,
    asociadas: values.filter((row) => text(row.selectedLineId, 160)).length,
    revisar: values.filter((row) => row.estado === "revisar").length,
    sinAsociar: values.filter((row) => !text(row.selectedLineId, 160)).length,
  };
}

export function getReceptionOrderImportSummary(rows = [], receptionItems = []) {
  const identifiedLineIds = new Set((Array.isArray(rows) ? rows : [])
    .map((row) => text(row?.selectedLineId, 160)).filter(Boolean));
  const requested = (Array.isArray(receptionItems) ? receptionItems : []).length;
  return {
    solicitados: requested,
    identificados: identifiedLineIds.size,
    pendientes: Math.max(0, requested - identifiedLineIds.size),
  };
}

export function getReceptionImportRowReason(row = {}, receptionItems = []) {
  const selectedLineId = text(row?.selectedLineId, 160);
  if (!selectedLineId) {
    return row?.advertencias?.[0] || "No encontramos una línea equivalente en la orden.";
  }
  const target = (Array.isArray(receptionItems) ? receptionItems : [])
    .find((line) => lineId(line) === selectedLineId);
  if (!target) return "La línea seleccionada ya no está disponible en la orden.";
  const quantity = finite(row?.cantidad, NaN);
  const pending = Math.max(0, finite(target.cantidadSolicitada) - finite(target.cantidadRecibidaAnterior));
  if (!Number.isFinite(quantity) || quantity <= 0) return "Ingresa una cantidad mayor que cero.";
  if (quantity > pending + 0.000001) return "La cantidad supera lo pendiente por recibir.";
  const cost = finite(row?.costoUnitario, NaN);
  if (!Number.isFinite(cost) || cost < 0) return "Ingresa un costo unitario válido.";
  if (Math.abs(cost - finite(target.costoUnitario)) > 0.000001) {
    return "El costo unitario difiere del registrado en la orden.";
  }
  const discount = finite(row?.descuentoPct, NaN);
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
    return "El descuento debe estar entre 0 % y 100 %.";
  }
  if (comparable(row?.unidadOrigen) && comparable(row.unidadOrigen) !== comparable(target.unidad || "unidad")) {
    return "La unidad del documento difiere de la orden.";
  }
  return row?.advertencias?.[0] || (row?.estado === "revisar"
    ? "Revisa la asociación antes de aplicar la propuesta."
    : "Asociación lista para aplicar.");
}

function rounded(value) {
  return Math.round(value * 1000000) / 1000000;
}

export function applyReceptionImportRows(draftItems = [], rows = []) {
  const itemsById = new Map(draftItems.map((line) => [lineId(line), line]));
  const grouped = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const selectedLineId = text(row?.selectedLineId, 160);
    if (!selectedLineId) return;
    const target = itemsById.get(selectedLineId);
    if (!target) throw new Error("Una línea importada no pertenece a la OC de esta recepción.");
    const cantidad = finite(row.cantidad, NaN);
    const costoUnitario = finite(row.costoUnitario, NaN);
    const descuentoPct = finite(row.descuentoPct, NaN);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      throw new Error(`Revisa la cantidad de ${row.nombreOrigen || "una línea importada"}.`);
    }
    if (!Number.isFinite(costoUnitario) || costoUnitario < 0) {
      throw new Error(`Revisa el costo de ${row.nombreOrigen || "una línea importada"}.`);
    }
    if (!Number.isFinite(descuentoPct) || descuentoPct < 0 || descuentoPct > 100) {
      throw new Error(`Revisa el descuento de ${row.nombreOrigen || "una línea importada"}.`);
    }
    const current = grouped.get(selectedLineId) || [];
    current.push({...row, cantidad, costoUnitario, descuentoPct});
    grouped.set(selectedLineId, current);
  });
  if (!grouped.size) throw new Error("Asocia al menos una línea del documento con un ítem de la OC.");

  const items = draftItems.map((line) => {
    const matches = grouped.get(lineId(line));
    if (!matches) return line;
    const cantidad = matches.reduce((sum, row) => sum + row.cantidad, 0);
    const pending = Math.max(0, finite(line.cantidadSolicitada) - finite(line.cantidadRecibidaAnterior));
    if (cantidad > pending + 0.000001) {
      throw new Error(`La cantidad importada de ${line.nombre || "un ítem"} supera lo pendiente por recibir.`);
    }
    const gross = matches.reduce((sum, row) => sum + row.cantidad * row.costoUnitario, 0);
    const discount = matches.reduce((sum, row) =>
      sum + row.cantidad * row.costoUnitario * row.descuentoPct / 100, 0);
    return {
      ...line,
      cantidad: rounded(cantidad),
      costoUnitario: rounded(gross / cantidad),
      descuentoPct: gross > 0 ? rounded(discount * 100 / gross) : 0,
      documentoLineas: matches.slice(0, 20).map((row) => ({
        nombre: text(row.nombreOrigen, 240),
        codigoProveedor: text(row.codigoProveedorOrigen || row.codigoOrigen, 100),
        unidad: text(row.unidadOrigen, 80),
        cantidad: row.cantidad,
        costoUnitario: row.costoUnitario,
        descuentoPct: row.descuentoPct,
      })),
    };
  });
  const summary = getReceptionImportSummary(rows);
  return {items, aplicadas: summary.asociadas, omitidas: summary.sinAsociar};
}

export function buildReceptionDocumentSource(fileData = {}, analysis = {}, fields = {}, rows = []) {
  const size = finite(fileData?.tamanoBytes, 0);
  if (size < 0 || size > MAX_DOCUMENT_SIZE_BYTES) {
    throw new Error("El archivo no puede superar 5 MB.");
  }
  const tipoDetectado = text(fields?.tipoDocumento || analysis?.documentType, 40).toLowerCase();
  const summary = getReceptionImportSummary(rows);
  const extractedDocument = analysis?.documento || {};
  const extractedTotals = analysis?.totales || {};
  return {
    origen: "importador_documental",
    nombreArchivo: text(fileData?.nombreArchivo, 240),
    tipoArchivo: text(fileData?.tipoArchivo, 120),
    extension: text(fileData?.extension, 12).toLowerCase(),
    tamanoBytes: Math.round(size),
    tipoDocumento: DOCUMENT_TYPES.has(tipoDetectado) ? tipoDetectado : "otro",
    numeroDocumento: text(fields?.numeroDocumento, 120),
    fechaDocumento: text(fields?.fechaDocumento, 10),
    fechaVencimiento: text(fields?.fechaVencimiento, 10),
    condicionesPago: text(fields?.condicionesPago, 1000),
    moneda: text(fields?.moneda || extractedDocument.moneda, 12).toUpperCase(),
    proveedorDocumento: documentParty(analysis?.proveedor),
    receptorDocumento: documentParty(analysis?.receptor),
    neto: optionalFinite(fields?.neto ?? extractedTotals.neto),
    impuestoPorcentaje: optionalFinite(
      fields?.impuestoPorcentaje ?? extractedTotals.impuestoPorcentaje
    ),
    impuestoMonto: optionalFinite(fields?.impuestoMonto ?? extractedTotals.impuestoMonto),
    total: optionalFinite(fields?.total ?? extractedTotals.total),
    coherenciaEstado: ["coherente", "revisar", "sin_datos"].includes(
      analysis?.coherencia?.estado
    ) ? analysis.coherencia.estado : "sin_datos",
    lineasDetectadas: summary.total,
    lineasAplicadas: summary.asociadas,
    advertencias: [
      ...(Array.isArray(analysis?.warnings) ? analysis.warnings : []),
      ...(analysis?.warning ? [analysis.warning] : []),
    ].map((warning) => text(warning, 300)).filter(Boolean).slice(0, 20),
  };
}
