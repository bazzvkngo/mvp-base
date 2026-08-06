const ERROR_MESSAGES = Object.freeze({
  batchTooLarge:
    "El lote contiene demasiadas filas para guardarlo de forma atómica. Excluye filas o divídelas en otra importación.",
  catalogChanged:
    "El catálogo cambió desde la previsualización. Revisa nuevamente Área y Categoría antes de guardar.",
  aiUnavailable:
    "El servicio de IA no está disponible temporalmente. Intenta nuevamente más tarde.",
  emptyFile:
    "El archivo no contiene filas utilizables. Revisa que tenga datos y encabezados legibles.",
  emulatorUnavailable:
    "No fue posible completar la solicitud en el emulador local de Firebase Functions. Inícialo y vuelve a intentar.",
  fileTooLarge:
    "El archivo es demasiado grande para analizarlo. Reduce su tamaño e intenta nuevamente.",
  internal:
    "No pudimos analizar el archivo por un problema interno del servicio. Intenta nuevamente más tarde o revisa el estado de la función de importación.",
  invalidFile:
    "El archivo no es válido o no contiene un formato compatible. Revisa el documento e intenta nuevamente.",
  invalidResponse:
    "El servicio de IA devolvió una respuesta que no se pudo validar. Intenta nuevamente más tarde.",
  invalidRows:
    "Hay filas incompletas o incompatibles con el nuevo modelo. Corrige los campos indicados antes de guardar.",
  network:
    "No fue posible conectar con el servicio de importación. Revisa tu conexión e intenta nuevamente.",
  permissionDenied:
    "Tu cuenta no tiene permiso para utilizar la importación inteligente.",
  quota:
    "El servicio inteligente alcanzó el límite de uso disponible. Intenta nuevamente más tarde.",
  rateLimitContractMissing:
    "La previsualización se generó con una versión anterior del servicio, pero no fue posible verificar sus límites de IA. Será necesario desplegar IA-1.",
  serviceMismatch:
    "La función de importación inteligente no está desplegada o no es compatible con esta versión. Revisa el despliegue de Firebase Functions.",
  timeout:
    "El análisis tardó demasiado y fue cancelado. Intenta nuevamente con un archivo más pequeño.",
  unauthenticated:
    "Tu sesión expiró o no es válida. Inicia sesión nuevamente para analizar el archivo.",
  availabilityUnknown:
    "No fue posible verificar la disponibilidad de IA. La función de control puede no estar desplegada o estar temporalmente inaccesible.",
});

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_./-]+/g, "-");
}

function getErrorDetails(error) {
  if (error?.details && typeof error.details === "object") return error.details;
  if (error?.customData?.details && typeof error.customData.details === "object") {
    return error.customData.details;
  }
  return {};
}

function getErrorSignals(error) {
  const details = getErrorDetails(error);
  const code = normalizeToken(
    [
      error?.code,
      details?.code,
      details?.internalCode,
      error?.customData?.code,
      error?.name,
    ]
      .filter(Boolean)
      .join(" ")
  );
  const reason = normalizeToken(details?.reason);
  const message = String(error?.message || "").trim();
  const searchable = normalizeToken(`${code} ${reason} ${message}`);
  return { code, details, message, reason, searchable };
}

function includesAny(value, tokens) {
  return tokens.some((token) => value.includes(token));
}

function result(kind, code, message, retryable = true) {
  return { code: code || "unknown", kind, message, retryable };
}

export function createInvalidInventoryAiResponseError() {
  const error = new Error(ERROR_MESSAGES.invalidResponse);
  error.name = "InventoryAiContractError";
  error.code = "invalid-ai-response";
  return error;
}

export function createMissingAiRateLimitStatusError() {
  const error = new Error(ERROR_MESSAGES.rateLimitContractMissing);
  error.name = "InventoryAiCompatibilityError";
  error.code = "functions/incompatible-contract";
  error.details = { internalCode: "rate_limit_contract_missing" };
  return error;
}

export function normalizeInventoryAiResponse(data) {
  const source = data && typeof data === "object" ? data : null;
  const normalized = Array.isArray(source?.items)
    ? source
    : Array.isArray(source?.result?.items)
      ? source.result
      : null;

  if (!normalized || !Array.isArray(normalized.items)) {
    throw createInvalidInventoryAiResponseError();
  }

  return normalized;
}

export function translateInventoryAiError(error, { operation = "analysis" } = {}) {
  const { code, message, reason, searchable } = getErrorSignals(error);

  if (includesAny(searchable, ["unauthenticated", "auth/user-token-expired"])) {
    return result("unauthenticated", code, ERROR_MESSAGES.unauthenticated, false);
  }
  if (searchable.includes("permission-denied")) {
    return result("permission_denied", code, ERROR_MESSAGES.permissionDenied, false);
  }
  if (searchable.includes("inventory_import_batch_too_large")) {
    return result("batch_too_large", code, ERROR_MESSAGES.batchTooLarge, false);
  }
  if (searchable.includes("inventory_import_catalog_changed")) {
    return result("catalog_changed", code, ERROR_MESSAGES.catalogChanged, false);
  }
  if (searchable.includes("inventory_import_request_conflict")) {
    return result(
      "request_conflict",
      code,
      "La solicitud de guardado cambió. Revisa la previsualización y vuelve a confirmar.",
      false
    );
  }
  if (
    operation === "save" &&
    includesAny(searchable, [
      "inventory_import_empty_batch",
      "inventory_import_invalid_row",
      "inventory_import_duplicate_row",
      "inventory_import_server_fields",
    ])
  ) {
    return result("invalid_rows", code, ERROR_MESSAGES.invalidRows, false);
  }
  if (searchable.includes("rate_limit_contract_missing")) {
    return result(
      "rate_limit_contract_missing",
      code,
      ERROR_MESSAGES.rateLimitContractMissing,
      false
    );
  }
  if (
    includesAny(searchable, ["emulator_unavailable", "emulator-unavailable"])
  ) {
    return result(
      "emulator_unavailable",
      code,
      ERROR_MESSAGES.emulatorUnavailable
    );
  }
  if (
    includesAny(searchable, [
      "resource-exhausted",
      "daily_quota",
      "daily-limit",
      "provider_rate_limit",
      "quota",
    ])
  ) {
    return result("quota", code, ERROR_MESSAGES.quota);
  }
  if (includesAny(searchable, ["deadline-exceeded", "timeout", "timed-out"])) {
    return result("timeout", code, ERROR_MESSAGES.timeout);
  }
  if (
    includesAny(searchable, [
      "invalid-ai-response",
      "inventoryaicontracterror",
      "invalid_response",
      "invalid-response",
    ])
  ) {
    return result("invalid_response", code, ERROR_MESSAGES.invalidResponse);
  }
  if (
    includesAny(searchable, [
      "functions/not-found",
      "functions/unimplemented",
      "service_not_deployed",
      "incompatible_contract",
      "incompatible-response",
    ])
  ) {
    return result("service_mismatch", code, ERROR_MESSAGES.serviceMismatch, false);
  }
  if (
    includesAny(searchable, [
      "too-large",
      "payload-too-large",
      "demasiado-grande",
      "no-puede-superar-5-mb",
      "no-puede-contener-mas-de-500-filas",
      "request-entity-too-large",
    ])
  ) {
    return result("file_too_large", code, ERROR_MESSAGES.fileTooLarge, false);
  }
  if (
    includesAny(searchable, [
      "sin-filas",
      "filas-utilizables",
      "no-contiene-hojas-o-filas",
      "no-contiene-hojas-legibles",
      "entre-1-y-500-filas",
    ])
  ) {
    return result("empty_file", code, ERROR_MESSAGES.emptyFile, false);
  }
  if (
    code.includes("invalid-argument") ||
    includesAny(searchable, [
      "archivo-corrupto",
      "archivo-parece-estar-corrupto",
      "debe-contener-entre-1-y-8-hojas",
      "extension-no-coincide",
      "firma-real-del-archivo",
      "formato-admitido",
      "formato-compatible",
      "imagen-esta-vacia",
      "navegador-no-informo",
      "no-contiene-paginas-legibles",
      "no-puede-contener-mas-de-8-hojas",
      "pdf-esta-vacio",
      "pdf-protegido",
      "selecciona-un-archivo",
      "selecciona-un-documento",
      "usa-un-archivo",
    ])
  ) {
    if (operation === "save") {
      return result("invalid_rows", code, ERROR_MESSAGES.invalidRows, false);
    }
    return result(
      "invalid_file",
      code,
      message && message.toLowerCase() !== "internal"
        ? message
        : ERROR_MESSAGES.invalidFile,
      false
    );
  }
  if (
    includesAny(searchable, [
      "failed-to-fetch",
      "network-request-failed",
      "networkerror",
      "offline",
      "connection-refused",
      "econnreset",
    ]) ||
    (code.includes("typeerror") && searchable.includes("fetch"))
  ) {
    return result("network", code, ERROR_MESSAGES.network);
  }
  if (
    reason === "provider_error" ||
    includesAny(searchable, ["provider-error", "temporarily-unavailable"])
  ) {
    return result("ai_unavailable", code, ERROR_MESSAGES.aiUnavailable);
  }
  if (code.includes("functions/unavailable") || code === "unavailable") {
    return result("ai_unavailable", code, ERROR_MESSAGES.aiUnavailable);
  }
  if (
    operation === "availability" &&
    includesAny(searchable, ["functions/internal", "internal", "unknown"])
  ) {
    return result(
      "availability_unknown",
      code,
      ERROR_MESSAGES.availabilityUnknown
    );
  }
  if (includesAny(searchable, ["functions/internal", "internal", "unknown"])) {
    return result(
      "internal",
      code,
      operation === "save"
        ? "No pudimos guardar la importación por un problema interno del servicio. Intenta nuevamente más tarde."
        : ERROR_MESSAGES.internal
    );
  }

  return result(
    "internal",
    code,
    operation === "save"
      ? "No pudimos guardar la importación por un problema interno del servicio. Intenta nuevamente más tarde."
      : ERROR_MESSAGES.internal
  );
}

export function getAiAvailabilityErrorStatus(error, model = "") {
  const translated = translateInventoryAiError(error, {
    operation: "availability",
  });
  const { details, reason } = getErrorSignals(error);
  const isUnavailable = ["ai_unavailable", "quota"].includes(translated.kind);

  return {
    allowed: !isUnavailable,
    reason:
      translated.kind === "quota"
        ? reason === "daily_limit"
          ? "daily_limit"
          : "provider_rate_limit"
        : isUnavailable
          ? "provider_error"
          : "status_error",
    model,
    retryAt: details?.retryAt ? String(details.retryAt) : null,
    retryAfterSeconds: Math.max(Number(details?.retryAfterSeconds || 0), 0),
    nextResetAt: details?.nextResetAt ? String(details.nextResetAt) : null,
    message: translated.message,
  };
}

function safeIdentifier(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_.:-]/g, "")
    .slice(0, 100);
}

export function getSafeInventoryAiLogDetails(
  error,
  {
    operation = "inventory_ai_import",
    stage = "unknown",
    rowCount = 0,
    durationMs = 0,
    status = "failed",
  } = {}
) {
  const translated = translateInventoryAiError(error);
  const details = getErrorDetails(error);
  const requestId = safeIdentifier(details?.requestId || details?.traceId);

  return {
    operation,
    stage,
    code: translated.code,
    category: translated.kind,
    ...(requestId ? { requestId } : {}),
    rowCount: Math.max(Number(rowCount || 0), 0),
    durationMs: Math.max(Number(durationMs || 0), 0),
    status,
  };
}

export async function runInventoryAnalysisSingleFlight(lockRef, task, callbacks = {}) {
  if (!lockRef || lockRef.current) {
    return { started: false, value: undefined };
  }

  lockRef.current = true;
  callbacks.onStart?.();
  try {
    return { started: true, value: await task() };
  } finally {
    lockRef.current = false;
    callbacks.onFinish?.();
  }
}

export { ERROR_MESSAGES as INVENTORY_AI_ERROR_MESSAGES };
