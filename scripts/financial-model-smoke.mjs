import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  aggregateFinancialByCategory,
  aggregateFinancialTimeline,
  buildFinancialCsv,
  compareFinancialSummaries,
  filterFinancialMovements,
  getFinancialPeriodRange,
  getFinancialSourceDocumentId,
  getFinancialSummary,
  getPreviousFinancialPeriod,
  normalizeFinancialMovementInput,
} from "../src/domain/financialMovement.mjs";

const context = { businessId: "business-a", userId: "owner-a" };
const base = {
  type: "income",
  status: "paid",
  amount: 1000,
  date: "2026-08-02",
  concept: "Servicio de prueba",
  categoryId: "services",
  paymentMethodId: "bank_transfer",
  sourceType: "manual",
};

function movement(overrides) {
  return normalizeFinancialMovementInput({ ...base, ...overrides }, context);
}

const cases = [
  movement({ type: "income", status: "paid" }),
  movement({ type: "income", status: "pending", amount: 2000 }),
  movement({ type: "expense", status: "paid", amount: 300, categoryId: "purchases" }),
  movement({ type: "expense", status: "pending", amount: 400, categoryId: "suppliers" }),
];

assert.deepEqual(cases.map((item) => [item.type, item.status]), [
  ["income", "paid"],
  ["income", "pending"],
  ["expense", "paid"],
  ["expense", "pending"],
]);
assert.ok(cases.every((item) => Number.isSafeInteger(item.amount)));
assert.ok(cases.every((item) => item.businessId === "business-a"));
assert.throws(() => movement({ amount: 0 }), /mayor que cero/);
assert.throws(() => movement({ amount: -1 }), /mayor que cero/);
assert.throws(() => movement({ amount: 1.5 }), /entero/);

const summary = getFinancialSummary(cases);
assert.deepEqual(summary, {
  paidIncome: 1000,
  paidExpense: 300,
  netResult: 700,
  receivable: 2000,
  payable: 400,
  count: 4,
});
assert.equal(filterFinancialMovements(cases, { type: "income" }).length, 2);
assert.equal(filterFinancialMovements(cases, { status: "pending" }).length, 2);
assert.equal(filterFinancialMovements(cases, { search: "servicio" }).length, 4);

const augustRange = getFinancialPeriodRange("month", {}, "2026-08-02");
assert.deepEqual(augustRange, {
  start: "2026-08-01",
  end: "2026-08-02",
  period: "month",
  days: 2,
});
assert.deepEqual(getPreviousFinancialPeriod(augustRange), {
  start: "2026-07-30",
  end: "2026-07-31",
  period: "previous",
  days: 2,
});
assert.deepEqual(
  getFinancialPeriodRange("custom", { start: "2026-08-10", end: "2026-08-01" }, "2026-08-02"),
  { start: "2026-08-01", end: "2026-08-10", period: "custom", days: 10 }
);

const categoryTotals = aggregateFinancialByCategory(cases, "income");
assert.equal(categoryTotals[0].value, 3000);
const timeline = aggregateFinancialTimeline(cases, augustRange);
assert.equal(timeline.length, 1);
assert.equal(timeline[0].net, 700);

const comparison = compareFinancialSummaries(summary, getFinancialSummary([]));
assert.equal(comparison.paidIncome.percent, null);
assert.equal(comparison.netResult.absolute, 700);

const summaryWithQuote = getFinancialSummary([
  ...cases,
  { estado: "aceptada", total: 999999, fecha: "2026-08-02" },
]);
assert.equal(summaryWithQuote.paidIncome, summary.paidIncome);
assert.equal(summaryWithQuote.netResult, summary.netResult);

const csv = buildFinancialCsv(cases);
assert.match(csv, /Monto CLP/);
assert.match(csv, /1000/);
assert.doesNotMatch(csv, /\$1\.000/);

const sourceIdA = getFinancialSourceDocumentId("quote", "quote/123");
const sourceIdB = getFinancialSourceDocumentId("quote", "quote/123");
assert.equal(sourceIdA, sourceIdB);
assert.throws(() =>
  normalizeFinancialMovementInput(
    { ...base, type: "income", status: "paid", sourceType: "quote", sourceId: "quote-1" },
    context
  )
);

const otherBusiness = normalizeFinancialMovementInput(
  { ...base, type: "income", status: "paid" },
  { businessId: "business-b", userId: "owner-a" }
);
assert.notEqual(otherBusiness.businessId, cases[0].businessId);

const indexConfig = JSON.parse(
  await readFile(new URL("../firestore.indexes.json", import.meta.url), "utf8")
);
const indexSignatures = new Set(
  indexConfig.indexes.map((index) =>
    index.fields.map((field) => `${field.fieldPath}:${field.order}`).join("|")
  )
);
assert.ok(indexSignatures.has("type:ASCENDING|date:DESCENDING"));
assert.ok(indexSignatures.has("status:ASCENDING|date:DESCENDING"));
assert.ok(
  indexSignatures.has(
    "type:ASCENDING|status:ASCENDING|date:DESCENDING"
  )
);

console.log("FINANCIAL_MODEL_SMOKE_OK");
