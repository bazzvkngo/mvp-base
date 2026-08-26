function text(value, max = 300) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function normalizeCompanySnapshot(raw = {}, businessId = "") {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    negocioId: text(businessId || source.negocioId || source.businessId, 160),
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

function buildAuthoritativeCompanySnapshot({businessId, business = {}, profile = {}} = {}) {
  const verification = business.verificacionEmpresa || {};
  const verifiedFiscal = verification.estado === "VERIFICADA"
    ? {
        identificadorFiscalTipo:
          verification.identificadorFiscalTipo || business.identificadorFiscalTipo,
        identificadorFiscalValor:
          verification.identificadorFiscalValor || business.identificadorFiscalValor,
      }
    : {};
  return normalizeCompanySnapshot(
    {...business, ...profile, ...verifiedFiscal},
    businessId
  );
}

function getHistoricalCompanySnapshot(document = {}) {
  const source = document?.empresaSnapshot && typeof document.empresaSnapshot === "object"
    ? document.empresaSnapshot
    : document?.empresa && typeof document.empresa === "object"
      ? document.empresa
      : null;
  if (!source) return null;
  const snapshot = normalizeCompanySnapshot(source, document.negocioId);
  return snapshot.nombreComercial || snapshot.razonSocial || snapshot.identificadorFiscalValor
    ? snapshot
    : null;
}

function resolveCompanySnapshot(document = {}, fallback = {}) {
  return getHistoricalCompanySnapshot(document) || normalizeCompanySnapshot(
    fallback,
    document?.negocioId || fallback?.negocioId || fallback?.businessId
  );
}

module.exports = {
  buildAuthoritativeCompanySnapshot,
  getHistoricalCompanySnapshot,
  normalizeCompanySnapshot,
  resolveCompanySnapshot,
};
