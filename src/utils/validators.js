export function isNonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}
