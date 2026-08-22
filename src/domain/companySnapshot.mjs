const text = (value, max = 300) => String(value || "").trim()
  .replace(/\s+/g, " ").slice(0, max);

export function adaptCompanySnapshot(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    negocioId: text(source.negocioId || source.businessId, 160),
    nombreComercial: text(source.nombreComercial, 200),
    razonSocial: text(source.razonSocial, 240),
    identificadorFiscalTipo: text(source.identificadorFiscalTipo, 40),
    identificadorFiscalValor: text(source.identificadorFiscalValor || source.rut, 80),
    giro: text(source.giro, 240),
    email: text(source.email, 240),
    telefono: text(source.telefono, 100),
    direccion: text(source.direccion, 300),
    comunaCodigo: text(source.comunaCodigo, 20),
    comunaNombre: text(source.comunaNombre, 160),
    ciudad: text(source.ciudad, 160),
    regionCodigo: text(source.regionCodigo, 20),
    regionNombre: text(source.regionNombre || source.region, 160),
    regionEstado: text(source.regionEstado, 160),
    codigoPostal: text(source.codigoPostal, 30),
    sitioWeb: text(source.sitioWeb, 300),
    logoUrl: text(source.logoUrl, 1200),
    responsable: text(source.responsable, 200),
    cargoResponsable: text(source.cargoResponsable, 160),
  };
}

export function resolveDocumentCompany(document = {}, liveProfile = {}) {
  const candidates = [document?.empresaSnapshot, document?.empresa, liveProfile];
  const source = candidates.find((candidate) => candidate && typeof candidate === "object" && (
    text(candidate.nombreComercial, 200) ||
    text(candidate.razonSocial, 240) ||
    text(candidate.identificadorFiscalValor || candidate.rut, 80)
  )) || liveProfile || {};
  return adaptCompanySnapshot(source);
}
