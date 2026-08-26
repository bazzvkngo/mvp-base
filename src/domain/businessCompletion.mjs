export const BUSINESS_COMPLETION_WEIGHTS = Object.freeze({
  identity: 15,
  commercialConfiguration: 10,
  fiscalIdentity: 15,
  contact: 10,
  address: 10,
  logo: 10,
  ownerEmail: 10,
  businessVerification: 20,
});

export const BUSINESS_VERIFICATION_STATES = Object.freeze({
  NOT_VERIFIED: "NO_VERIFICADA",
  PENDING: "PENDIENTE",
  VERIFIED: "VERIFICADA",
  REJECTED: "RECHAZADA",
});

const VERIFICATION_LABELS = Object.freeze({
  NO_VERIFICADA: "Empresa no verificada",
  PENDIENTE: "Verificación en revisión",
  VERIFICADA: "Empresa verificada",
  RECHAZADA: "Verificación empresarial rechazada",
});

function hasText(value) {
  return Boolean(String(value || "").trim());
}

function normalizeVerificationStatus(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "EN_REVISION") {
    return BUSINESS_VERIFICATION_STATES.PENDING;
  }
  return Object.values(BUSINESS_VERIFICATION_STATES).includes(normalized)
    ? normalized
    : BUSINESS_VERIFICATION_STATES.NOT_VERIFIED;
}

function getCompletionLabel(percent) {
  if (percent === 100) return "Empresa completa y verificada";
  if (percent >= 70) return "Empresa casi lista";
  if (percent >= 40) return "Perfil en progreso";
  return "Configuración inicial";
}

export function getBusinessCompletionStatus(
  profile = {},
  { ownerEmailVerified = false, verificationStatus } = {}
) {
  const resolvedVerificationStatus = normalizeVerificationStatus(
    verificationStatus || profile.verificacionEmpresa?.estado
  );
  const hasRegion = hasText(
    profile.regionCodigo || profile.regionEstado || profile.regionNombre || profile.region
  );
  const hasCity = hasText(
    profile.comunaCodigo || profile.comunaNombre || profile.ciudad
  );
  const items = [
    {
      id: "identity",
      label: "Nombre y rubro",
      weight: BUSINESS_COMPLETION_WEIGHTS.identity,
      completed:
        hasText(profile.nombreComercial) &&
        hasText(profile.rubroCodigo || profile.rubroNombre),
      actionLabel: "Completar",
      section: "informacion",
    },
    {
      id: "commercialConfiguration",
      label: "País y configuración",
      weight: BUSINESS_COMPLETION_WEIGHTS.commercialConfiguration,
      completed:
        hasText(profile.paisCodigo) &&
        hasText(profile.monedaCodigo) &&
        hasText(profile.locale) &&
        hasText(profile.identificadorFiscalTipo) &&
        hasText(profile.impuestoPredeterminadoId) &&
        hasText(profile.impuestoPredeterminadoNombre),
      actionLabel: "Completar",
      section: "informacion",
    },
    {
      id: "fiscalIdentity",
      label: "Identificación fiscal validada",
      weight: BUSINESS_COMPLETION_WEIGHTS.fiscalIdentity,
      completed:
        resolvedVerificationStatus === BUSINESS_VERIFICATION_STATES.VERIFIED &&
        hasText(profile.identificadorFiscalValor || profile.rut) &&
        hasText(profile.razonSocial),
      actionLabel: "Verificar",
      section: "verificacion",
    },
    {
      id: "contact",
      label: "Datos de contacto",
      weight: BUSINESS_COMPLETION_WEIGHTS.contact,
      completed: hasText(profile.email || profile.telefono),
      actionLabel: "Agregar",
      section: "informacion",
    },
    {
      id: "address",
      label: "Dirección",
      weight: BUSINESS_COMPLETION_WEIGHTS.address,
      completed: hasText(profile.direccion) && hasRegion && hasCity,
      actionLabel: "Completar",
      section: "informacion",
    },
    {
      id: "logo",
      label: "Logo",
      weight: BUSINESS_COMPLETION_WEIGHTS.logo,
      completed: hasText(profile.logoUrl || profile.logoPath),
      actionLabel: "Agregar",
      section: "informacion",
    },
    {
      id: "ownerEmail",
      label: "Correo del propietario",
      weight: BUSINESS_COMPLETION_WEIGHTS.ownerEmail,
      completed: ownerEmailVerified === true,
      actionLabel: "Verificar correo",
      path: "/cuenta?seccion=acceso",
    },
    {
      id: "businessVerification",
      label: "Verificación empresarial",
      weight: BUSINESS_COMPLETION_WEIGHTS.businessVerification,
      completed:
        resolvedVerificationStatus === BUSINESS_VERIFICATION_STATES.VERIFIED,
      actionLabel: "Revisar",
      section: "verificacion",
    },
  ];
  const completedItems = items.filter((item) => item.completed);
  const pendingItems = items.filter((item) => !item.completed);
  const percent = completedItems.reduce((total, item) => total + item.weight, 0);

  return {
    percent,
    completedItems,
    pendingItems,
    verificationStatus: resolvedVerificationStatus,
    verificationLabel: VERIFICATION_LABELS[resolvedVerificationStatus],
    label: getCompletionLabel(percent),
    nextRecommendedAction: pendingItems[0] || null,
    items,
  };
}
