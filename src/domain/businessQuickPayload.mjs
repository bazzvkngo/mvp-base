export function normalizeBusinessText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function normalizeQuickBusinessPayload(values) {
  const rubroCodigo = String(values.rubroCodigo || "");
  const payload = {
    nombreComercial: normalizeBusinessText(values.nombreComercial),
    rubroCodigo,
    regionCodigo: String(values.regionCodigo || ""),
  };
  if (rubroCodigo === "OTRO") {
    payload.rubroOtro = normalizeBusinessText(values.rubroOtro).slice(0, 120);
  }
  return payload;
}
