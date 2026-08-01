import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createAiRateLimiter,
  evaluateReservation,
  getLogicalConsumptionWindow,
  getProviderFailureDetails,
} = require("../functions/aiRateLimiter.js");
const {
  AI_MODELS,
  AI_RATE_LIMIT_CONFIG,
} = require("../functions/aiConfig.js");
const {
  classifyGeminiServiceError,
} = require("../functions/inventoryDocumentImport.js");

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

class FakeSnapshot {
  constructor(value) {
    this.value = clone(value);
    this.exists = value !== undefined;
  }

  data() {
    return clone(this.value);
  }
}

class FakeFirestore {
  constructor() {
    this.records = new Map();
    this.transactionQueue = Promise.resolve();
  }

  collection(collectionName) {
    return {
      doc: (documentId) => {
        const key = `${collectionName}/${documentId}`;
        return {
          key,
          get: async () => new FakeSnapshot(this.records.get(key)),
        };
      },
    };
  }

  runTransaction(callback) {
    const run = this.transactionQueue.then(async () => {
      const writes = [];
      const transaction = {
        get: async (ref) => new FakeSnapshot(this.records.get(ref.key)),
        set: (ref, value) => writes.push([ref.key, clone(value)]),
      };
      const result = await callback(transaction);
      writes.forEach(([key, value]) => this.records.set(key, value));
      return result;
    });
    this.transactionQueue = run.catch(() => undefined);
    return run;
  }
}

function completedRecord(decision) {
  return {
    ...decision.update,
    inProgress: false,
    inProgressRequestId: null,
    lockExpiresAt: null,
    consumedCount: decision.update.consumedCount + 1,
  };
}

function makeProviderError({ retryDelay = null } = {}) {
  const error = new Error("Synthetic provider quota response");
  error.code = 429;
  error.status = "RESOURCE_EXHAUSTED";
  error.error = {
    code: 429,
    status: "RESOURCE_EXHAUSTED",
    details: retryDelay
      ? [
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay,
          },
        ]
      : [],
  };
  return error;
}

const flash = AI_MODELS.DOCUMENT_IMPORT;
const flashLite = AI_MODELS.QUOTE_SUGGESTIONS;
const initialNow = new Date("2026-08-01T15:00:00.000Z");

const first = evaluateReservation(null, flash, {
  functionName: "normalizeInventoryDocument",
  now: initialNow,
  requestId: "first-request",
});
assert.equal(first.allowed, true);
assert.equal(first.update.reservedCount, 1);
assert.equal(first.status.retryAfterSeconds, 20);
console.log("OK limitador: primera solicitud permitida");

const duringCooldown = evaluateReservation(completedRecord(first), flash, {
  now: new Date(initialNow.getTime() + 5000),
  requestId: "cooldown-request",
});
assert.equal(duringCooldown.allowed, false);
assert.equal(duringCooldown.status.reason, "cooldown");
assert.equal(duringCooldown.status.retryAfterSeconds, 15);
console.log("OK limitador: solicitud dentro del cooldown rechazada sin reserva");

const afterCooldown = evaluateReservation(completedRecord(first), flash, {
  now: new Date(initialNow.getTime() + 20000),
  requestId: "after-cooldown-request",
});
assert.equal(afterCooldown.allowed, true);
assert.equal(afterCooldown.update.reservedCount, 2);
console.log("OK limitador: solicitud permitida al finalizar el cooldown");

let concurrentNow = new Date("2026-08-01T16:00:00.000Z");
let requestSequence = 0;
const concurrentDb = new FakeFirestore();
const concurrentLimiter = createAiRateLimiter({
  db: concurrentDb,
  nowFn: () => concurrentNow,
  requestIdFactory: () => `concurrent-${++requestSequence}`,
});
const concurrentResults = await Promise.all([
  concurrentLimiter.reserve(flash, "document-one"),
  concurrentLimiter.reserve(flash, "document-two"),
]);
assert.equal(concurrentResults.filter((result) => result.allowed).length, 1);
assert.equal(
  concurrentResults.find((result) => !result.allowed)?.reason,
  "in_progress"
);
console.log("OK limitador: una transaccion serializa solicitudes simultaneas");

const logicalWindow = getLogicalConsumptionWindow(initialNow);
const dailyRecord = {
  logicalDate: logicalWindow.logicalDate,
  reservedCount: AI_RATE_LIMIT_CONFIG[flash].protectedDailyLimit,
  consumedCount: AI_RATE_LIMIT_CONFIG[flash].protectedDailyLimit,
  nextAllowedAt: new Date(initialNow.getTime() - 1000),
  inProgress: false,
};
const dailyLimit = evaluateReservation(dailyRecord, flash, {
  now: initialNow,
  requestId: "daily-request",
});
assert.equal(dailyLimit.allowed, false);
assert.equal(dailyLimit.status.reason, "daily_limit");
assert.equal(dailyLimit.status.retryAt, logicalWindow.nextResetAt.toISOString());
console.log("OK limitador: limite diario protegido en 15 reservas");

const nextLogicalDay = new Date("2026-08-02T15:00:00.000Z");
const afterDailyReset = evaluateReservation(dailyRecord, flash, {
  now: nextLogicalDay,
  requestId: "new-day-request",
});
assert.equal(afterDailyReset.allowed, true);
assert.equal(afterDailyReset.update.reservedCount, 1);
assert.equal(afterDailyReset.update.logicalDate, "2026-08-02");
console.log("OK limitador: el nuevo dia logico reinicia el conteo");

const expiredLockRecord = {
  ...completedRecord(first),
  inProgress: true,
  inProgressRequestId: "abandoned-request",
  lockExpiresAt: new Date(initialNow.getTime() - 1000),
  nextAllowedAt: new Date(initialNow.getTime() - 1000),
};
const afterExpiredLock = evaluateReservation(expiredLockRecord, flash, {
  now: initialNow,
  requestId: "replacement-request",
});
assert.equal(afterExpiredLock.allowed, true);
assert.equal(afterExpiredLock.requestId, "replacement-request");
console.log("OK limitador: un bloqueo en curso vencido no queda permanente");

const separateDb = new FakeFirestore();
const separateLimiter = createAiRateLimiter({
  db: separateDb,
  nowFn: () => initialNow,
  requestIdFactory: () => `separate-${++requestSequence}`,
});
const [flashReservation, liteReservation] = await Promise.all([
  separateLimiter.reserve(flash, "document-import"),
  separateLimiter.reserve(flashLite, "quote-suggestions"),
]);
assert.equal(flashReservation.allowed, true);
assert.equal(liteReservation.allowed, true);
assert.equal(flashReservation.retryAfterSeconds, 20);
assert.equal(liteReservation.retryAfterSeconds, 10);
assert.equal(separateDb.records.size, 2);
console.log("OK limitador: ambos modelos mantienen cuotas independientes");

const known429Classification = classifyGeminiServiceError(
  makeProviderError({ retryDelay: "30s" })
);
assert.equal(known429Classification.category, "transient_rate_limit");
assert.equal(known429Classification.retryDelayMs, 30000);
const known429Failure = getProviderFailureDetails(
  first.update,
  flash,
  first.requestId,
  known429Classification,
  initialNow
);
assert.equal(known429Failure.details.reason, "provider_rate_limit");
assert.equal(
  known429Failure.details.retryAt,
  new Date(initialNow.getTime() + 30000).toISOString()
);
assert.equal(
  known429Failure.update.lastQuotaError.retryAt.toISOString(),
  known429Failure.details.retryAt
);
assert.equal(
  known429Failure.update.lastQuotaError.providerRetryAt.toISOString(),
  new Date(initialNow.getTime() + 30000).toISOString()
);
console.log("OK errores: 429 con retryDelay persiste retryAt conocido");

const unknown429Classification = classifyGeminiServiceError(makeProviderError());
assert.equal(unknown429Classification.category, "transient_rate_limit");
assert.equal(unknown429Classification.retryDelayMs, null);
const unknown429Failure = getProviderFailureDetails(
  first.update,
  flash,
  first.requestId,
  unknown429Classification,
  initialNow
);
assert.equal(unknown429Failure.details.reason, "provider_rate_limit");
assert.equal(unknown429Failure.details.retryAfterSeconds, 20);
console.log("OK errores: 429 sin retryDelay conserva el cooldown anti-spam");

const normalProviderFailure = getProviderFailureDetails(
  first.update,
  flash,
  first.requestId,
  classifyGeminiServiceError(new Error("Synthetic provider failure")),
  initialNow
);
assert.equal(normalProviderFailure.details.reason, "provider_error");
assert.equal(normalProviderFailure.details.retryAfterSeconds, 20);
assert.equal(normalProviderFailure.update.inProgress, false);
console.log("OK errores: fallo normal libera el bloqueo con espera recuperable");

const springWindow = getLogicalConsumptionWindow(
  new Date("2026-03-08T12:00:00.000Z")
);
assert.equal(springWindow.logicalDate, "2026-03-08");
assert.equal(springWindow.nextResetAt.toISOString(), "2026-03-09T07:00:00.000Z");
const fallWindow = getLogicalConsumptionWindow(
  new Date("2026-11-01T12:00:00.000Z")
);
assert.equal(fallWindow.logicalDate, "2026-11-01");
assert.equal(fallWindow.nextResetAt.toISOString(), "2026-11-02T08:00:00.000Z");
console.log("OK fechas: reinicio a medianoche de Los Angeles respeta DST");

const importerSource = readFileSync(
  new URL("../src/features/inventory/InventoryAiImporter.jsx", import.meta.url),
  "utf8"
);
const analyzeStart = importerSource.indexOf("const handleAnalyze");
const saveStart = importerSource.indexOf("const handleSave");
const saveEnd = importerSource.indexOf("const handle", saveStart + 12);
assert.ok(analyzeStart >= 0 && saveStart > analyzeStart);
assert.ok(
  importerSource
    .slice(analyzeStart, saveStart)
    .includes("normalizeInventorySourceWithAi")
);
assert.equal(
  importerSource
    .slice(saveStart, saveEnd >= 0 ? saveEnd : importerSource.length)
    .includes("normalizeInventorySourceWithAi"),
  false
);
console.log("OK conteo: confirmar una vista previa no vuelve a invocar Gemini");

console.log("AI_RATE_LIMITER_SMOKE_OK");
