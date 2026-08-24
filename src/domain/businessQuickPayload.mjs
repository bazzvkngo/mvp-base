export function normalizeBusinessText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function normalizeQuickBusinessPayload(values) {
  const rubroCodigo = String(values.rubroCodigo || "");
  const payload = {
    nombreComercial: normalizeBusinessText(values.nombreComercial),
    rubroCodigo,
  };
  if (values.regionCodigo) {
    payload.regionCodigo = String(values.regionCodigo);
  }
  if (values.paisCodigo) {
    payload.paisCodigo = String(values.paisCodigo).toUpperCase();
  }
  if (rubroCodigo === "OTRO") {
    payload.rubroOtro = normalizeBusinessText(values.rubroOtro).slice(0, 120);
  }
  return payload;
}
