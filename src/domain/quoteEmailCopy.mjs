export function buildQuoteValidityEmailLine(quote = {}, formatDate) {
  const validityDays = Number(quote.validezDias);
  if (!Number.isInteger(validityDays) || validityDays <= 0) return "";

  const pendingEmission = quote.estado === "borrador" && !quote.fechaEmision;
  if (pendingEmission) {
    return `La propuesta tiene una vigencia de ${validityDays} días desde su emisión.`;
  }

  const expiryDate = String(quote.fechaVencimiento || "").trim();
  return expiryDate
    ? `La propuesta está vigente hasta el ${formatDate(expiryDate)}.`
    : `La propuesta tiene una vigencia de ${validityDays} días desde su emisión.`;
}
