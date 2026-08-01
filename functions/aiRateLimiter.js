const { randomUUID } = require("node:crypto");
const {
  AI_RATE_LIMIT_CONFIG,
  AI_RATE_LIMIT_TIME_ZONE,
  getAiModelConfig,
} = require("./aiConfig");

const formatterCache = new Map();

function getDateTimeFormatter(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(
      timeZone,
      new Intl.DateTimeFormat("en-CA", {
        day: "2-digit",
        hour: "2-digit",
        hourCycle: "h23",
        minute: "2-digit",
        month: "2-digit",
        second: "2-digit",
        timeZone,
        year: "numeric",
      })
    );
  }
  return formatterCache.get(timeZone);
}

function getZonedParts(date, timeZone = AI_RATE_LIMIT_TIME_ZONE) {
  const parts = {};
  getDateTimeFormatter(timeZone)
    .formatToParts(date)
    .forEach((part) => {
      if (part.type !== "literal") parts[part.type] = Number(part.value);
    });
  return parts;
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = getZonedParts(date, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return representedAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function zonedDateTimeToUtc(parts, timeZone = AI_RATE_LIMIT_TIME_ZONE) {
  const desiredAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0
  );
  let candidate = desiredAsUtc;

  for (let index = 0; index < 4; index += 1) {
    const nextCandidate = desiredAsUtc - getTimeZoneOffsetMs(
      new Date(candidate),
      timeZone
    );
    if (nextCandidate === candidate) break;
    candidate = nextCandidate;
  }

  return new Date(candidate);
}

function addCalendarDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function getLogicalConsumptionWindow(
  now = new Date(),
  timeZone = AI_RATE_LIMIT_TIME_ZONE
) {
  const currentParts = getZonedParts(now, timeZone);
  const nextDayParts = addCalendarDays(currentParts, 1);
  return {
    logicalDate: `${currentParts.year}-${pad(currentParts.month)}-${pad(
      currentParts.day
    )}`,
    nextResetAt: zonedDateTimeToUtc(nextDayParts, timeZone),
  };
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function toIso(value) {
  const milliseconds = toMillis(value);
  return milliseconds ? new Date(milliseconds).toISOString() : null;
}

function secondsUntil(value, now) {
  const milliseconds = toMillis(value) - now.getTime();
  return Math.max(0, Math.ceil(milliseconds / 1000));
}

function normalizeRateLimitRecord(record, config, now = new Date()) {
  const window = getLogicalConsumptionWindow(now);
  const sameLogicalDate = record?.logicalDate === window.logicalDate;

  return {
    model: config.model,
    logicalDate: window.logicalDate,
    reservedCount: sameLogicalDate ? Number(record?.reservedCount || 0) : 0,
    consumedCount: sameLogicalDate ? Number(record?.consumedCount || 0) : 0,
    lastAcceptedAt: sameLogicalDate ? record?.lastAcceptedAt || null : null,
    nextAllowedAt: sameLogicalDate ? record?.nextAllowedAt || null : null,
    inProgress: sameLogicalDate ? record?.inProgress === true : false,
    inProgressRequestId: sameLogicalDate
      ? record?.inProgressRequestId || null
      : null,
    lockExpiresAt: sameLogicalDate ? record?.lockExpiresAt || null : null,
    nextResetAt: window.nextResetAt,
    lastQuotaError: sameLogicalDate ? record?.lastQuotaError || null : null,
  };
}

function getActiveReason(state, config, now = new Date()) {
  const nowMs = now.getTime();
  const lockExpiresMs = toMillis(state.lockExpiresAt);
  if (state.inProgress && lockExpiresMs > nowMs) {
    return { reason: "in_progress", retryAt: state.lockExpiresAt };
  }
  if (state.reservedCount >= config.protectedDailyLimit) {
    return { reason: "daily_limit", retryAt: state.nextResetAt };
  }
  const nextAllowedMs = toMillis(state.nextAllowedAt);
  if (nextAllowedMs > nowMs) {
    const quotaErrorRetryMs = toMillis(state.lastQuotaError?.retryAt);
    const quotaErrorReason = state.lastQuotaError?.reason;
    if (
      ["provider_rate_limit", "provider_error"].includes(quotaErrorReason) &&
      quotaErrorRetryMs > nowMs
    ) {
      return { reason: quotaErrorReason, retryAt: state.lastQuotaError.retryAt };
    }
    return { reason: "cooldown", retryAt: state.nextAllowedAt };
  }
  return null;
}

function buildPublicStatus(record, model, now = new Date()) {
  const config = getAiModelConfig(model);
  const state = normalizeRateLimitRecord(record, config, now);
  const activeReason = getActiveReason(state, config, now);
  const retryAt = activeReason?.retryAt || null;

  return {
    allowed: !activeReason,
    reason: activeReason?.reason || "available",
    model,
    retryAt: toIso(retryAt),
    retryAfterSeconds: retryAt ? secondsUntil(retryAt, now) : 0,
    logicalDate: state.logicalDate,
    reservedCount: state.reservedCount,
    consumedCount: state.consumedCount,
    protectedDailyLimit: config.protectedDailyLimit,
    providerDailyLimit: config.providerDailyLimit,
    nextResetAt: toIso(state.nextResetAt),
  };
}

function evaluateReservation(
  record,
  model,
  {
    functionName = "unknown",
    now = new Date(),
    requestId = randomUUID(),
  } = {}
) {
  const config = getAiModelConfig(model);
  const state = normalizeRateLimitRecord(record, config, now);
  const activeReason = getActiveReason(state, config, now);

  if (activeReason) {
    return {
      allowed: false,
      status: buildPublicStatus(state, model, now),
      update: null,
    };
  }

  const nextAllowedAt = new Date(
    now.getTime() + config.cooldownSeconds * 1000
  );
  const lockExpiresAt = new Date(
    now.getTime() + config.inProgressTtlSeconds * 1000
  );
  const update = {
    ...state,
    reservedCount: state.reservedCount + 1,
    lastAcceptedAt: now,
    nextAllowedAt,
    inProgress: true,
    inProgressRequestId: requestId,
    lockExpiresAt,
    lastFunctionName: String(functionName || "unknown").slice(0, 80),
    updatedAt: now,
  };

  return {
    allowed: true,
    requestId,
    status: {
      ...buildPublicStatus(update, model, now),
      allowed: true,
      reason: "accepted",
      retryAt: nextAllowedAt.toISOString(),
      retryAfterSeconds: config.cooldownSeconds,
    },
    update,
  };
}

function getProviderFailureDetails(
  record,
  model,
  requestId,
  classification,
  now = new Date()
) {
  const config = getAiModelConfig(model);
  const state = normalizeRateLimitRecord(record, config, now);
  const isRateLimit = ["daily_quota", "transient_rate_limit"].includes(
    classification?.category
  );
  const reason = isRateLimit ? "provider_rate_limit" : "provider_error";
  const providerRetryAt = classification?.retryDelayMs
    ? new Date(now.getTime() + classification.retryDelayMs)
    : classification?.category === "daily_quota"
      ? state.nextResetAt
      : null;
  const cooldownRetryAt = toMillis(state.nextAllowedAt) > now.getTime()
    ? new Date(toMillis(state.nextAllowedAt))
    : new Date(now.getTime() + config.cooldownSeconds * 1000);
  const retryAt = new Date(
    Math.max(providerRetryAt?.getTime() || 0, cooldownRetryAt.getTime())
  );
  const nextAllowedAt = new Date(
    Math.max(toMillis(state.nextAllowedAt), retryAt.getTime())
  );
  const ownsLock = state.inProgressRequestId === requestId;
  const message = isRateLimit
    ? "El servicio de IA alcanzo temporalmente un limite del proveedor."
    : "El servicio de IA no pudo completar la solicitud.";

  return {
    details: {
      allowed: false,
      reason,
      model,
      retryAt: retryAt.toISOString(),
      retryAfterSeconds: secondsUntil(retryAt, now),
      message,
    },
    update: {
      ...state,
      consumedCount: state.consumedCount + 1,
      nextAllowedAt,
      inProgress: ownsLock ? false : state.inProgress,
      inProgressRequestId: ownsLock ? null : state.inProgressRequestId,
      lockExpiresAt: ownsLock ? null : state.lockExpiresAt,
      lastQuotaError: {
        reason,
        category: String(classification?.category || "unknown").slice(0, 40),
        code: classification?.originalStatus || null,
        retryAt,
        providerRetryAt: providerRetryAt || null,
        occurredAt: now,
      },
      updatedAt: now,
    },
  };
}

function createAiRateLimiter({
  db,
  nowFn = () => new Date(),
  requestIdFactory = randomUUID,
} = {}) {
  if (!db) throw new Error("Firestore es requerido para el limitador de IA.");

  const getRef = (model) => {
    getAiModelConfig(model);
    return db.collection("aiRateLimits").doc(model);
  };

  return {
    async getStatus(model) {
      const snapshot = await getRef(model).get();
      return buildPublicStatus(snapshot.exists ? snapshot.data() : null, model, nowFn());
    },

    async getAllStatuses() {
      const models = Object.keys(AI_RATE_LIMIT_CONFIG);
      const statuses = await Promise.all(models.map((model) => this.getStatus(model)));
      return Object.fromEntries(statuses.map((status) => [status.model, status]));
    },

    async reserve(model, functionName) {
      const ref = getRef(model);
      return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const decision = evaluateReservation(
          snapshot.exists ? snapshot.data() : null,
          model,
          {
            functionName,
            now: nowFn(),
            requestId: requestIdFactory(),
          }
        );
        if (decision.update) transaction.set(ref, decision.update, { merge: false });
        return {
          allowed: decision.allowed,
          requestId: decision.requestId || null,
          ...decision.status,
        };
      });
    },

    async complete(model, requestId) {
      const ref = getRef(model);
      return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const now = nowFn();
        const config = getAiModelConfig(model);
        const state = normalizeRateLimitRecord(
          snapshot.exists ? snapshot.data() : null,
          config,
          now
        );
        const ownsLock = state.inProgressRequestId === requestId;
        const update = {
          ...state,
          consumedCount: state.consumedCount + 1,
          inProgress: ownsLock ? false : state.inProgress,
          inProgressRequestId: ownsLock ? null : state.inProgressRequestId,
          lockExpiresAt: ownsLock ? null : state.lockExpiresAt,
          lastCompletedAt: now,
          updatedAt: now,
        };
        transaction.set(ref, update, { merge: false });
        return buildPublicStatus(update, model, now);
      });
    },

    async fail(model, requestId, classification) {
      const ref = getRef(model);
      return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const now = nowFn();
        const failure = getProviderFailureDetails(
          snapshot.exists ? snapshot.data() : null,
          model,
          requestId,
          classification,
          now
        );
        transaction.set(ref, failure.update, { merge: false });
        return failure.details;
      });
    },
  };
}

module.exports = {
  buildPublicStatus,
  createAiRateLimiter,
  evaluateReservation,
  getLogicalConsumptionWindow,
  getProviderFailureDetails,
  getZonedParts,
  normalizeRateLimitRecord,
  toMillis,
  zonedDateTimeToUtc,
};
