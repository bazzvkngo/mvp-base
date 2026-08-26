const TAX_OPTIONS = Object.freeze({
  IVA_GENERAL: Object.freeze({ id: "IVA_GENERAL", nombre: "IVA general", tasa: 19 }),
  IVA_EXENTO: Object.freeze({ id: "IVA_EXENTO", nombre: "IVA exento", tasa: 0 }),
  SIN_IMPUESTO: Object.freeze({ id: "SIN_IMPUESTO", nombre: "Sin impuesto", tasa: 0 }),
});

const PERSONAL_DOCUMENT_TYPES = Object.freeze(["RUT", "CI", "PASAPORTE", "OTRO"]);
const {
  applyVerificationInvalidation,
  buildVerificationInvalidationPlan,
} = require("./businessVerification");
const {
  authoritativeBusinessFields,
  buildProfileInputWithAuthoritativeFields,
} = require("./businessJurisdiction");

function safeText(value, maxLength = 180) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function multilineText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function optionalPatch(fieldValue, value) {
  return value ? value : fieldValue.delete();
}

function validateTaxSettings(rawData, HttpsError) {
  const legacy = TAX_OPTIONS[safeText(rawData?.impuestoPredeterminadoId, 40).toUpperCase()];
  const nombre = safeText(rawData?.impuestoPredeterminadoNombre, 60) || legacy?.nombre || "";
  const tasa = rawData?.impuestoPredeterminadoTasa === undefined
    ? Number(legacy?.tasa)
    : Number(rawData.impuestoPredeterminadoTasa);
  if (!nombre) {
    throw new HttpsError("invalid-argument", "Selecciona un impuesto válido.");
  }
  if (!Number.isFinite(tasa) || tasa < 0 || tasa > 100) {
    throw new HttpsError("invalid-argument", "La tasa debe estar entre 0 y 100.");
  }
  return {
    impuestoPredeterminadoId: legacy?.id || "PERSONALIZADO",
    impuestoPredeterminadoNombre: nombre,
    impuestoPredeterminadoTasa: tasa,
  };
}

function validateInventorySettings(rawData, HttpsError) {
  const threshold = Number(rawData?.umbralStockBajo);
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 999999) {
    throw new HttpsError(
      "invalid-argument",
      "El umbral de stock bajo debe ser un número entero mayor o igual a cero."
    );
  }
  return {
    alertasStockBajo: rawData?.alertasStockBajo !== false,
    umbralStockBajo: threshold,
    permitirStockNegativo: rawData?.permitirStockNegativo === true,
  };
}

function validateQuoteSettings(rawData, HttpsError) {
  const validityDays = Number(rawData?.validezCotizacionDias);
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 365) {
    throw new HttpsError(
      "invalid-argument",
      "La validez predeterminada debe estar entre 1 y 365 días."
    );
  }
  const condicionesPago = multilineText(rawData?.condicionesPago, 500);
  const plazoEntregaCotizacion = multilineText(
    rawData?.plazoEntregaCotizacion,
    1000
  );
  const alcanceGeograficoCotizacion = multilineText(
    rawData?.alcanceGeograficoCotizacion,
    2000
  );
  const garantiaCotizacion = multilineText(
    rawData?.garantiaCotizacion,
    2000
  );
  const exclusionesCotizacion = multilineText(
    rawData?.exclusionesCotizacion,
    4000
  );
  const notaFinalCotizacion = multilineText(rawData?.notaFinalCotizacion, 1200);
  const terminosCotizacion = multilineText(rawData?.terminosCotizacion, 2000);
  const notaPieCotizacion = multilineText(rawData?.notaPieCotizacion, 500);
  const textoAceptacionCotizacion = multilineText(
    rawData?.textoAceptacionCotizacion,
    500
  );
  return {
    ...(condicionesPago ? { condicionesPago } : {}),
    ...(plazoEntregaCotizacion ? { plazoEntregaCotizacion } : {}),
    ...(alcanceGeograficoCotizacion
      ? { alcanceGeograficoCotizacion }
      : {}),
    ...(garantiaCotizacion ? { garantiaCotizacion } : {}),
    ...(exclusionesCotizacion ? { exclusionesCotizacion } : {}),
    validezCotizacionDias: validityDays,
    ...(notaFinalCotizacion ? { notaFinalCotizacion } : {}),
    ...(terminosCotizacion ? { terminosCotizacion } : {}),
    ...(notaPieCotizacion ? { notaPieCotizacion } : {}),
    aceptacionCotizacionHabilitada: false,
    ...(textoAceptacionCotizacion ? { textoAceptacionCotizacion } : {}),
  };
}

function validatePersonalProfile(rawData, HttpsError) {
  const nombres = safeText(rawData?.nombres, 120);
  if (!nombres) {
    throw new HttpsError("invalid-argument", "Ingresa tu nombre.");
  }
  const tipoDocumento = safeText(rawData?.tipoDocumento, 20).toUpperCase();
  if (tipoDocumento && !PERSONAL_DOCUMENT_TYPES.includes(tipoDocumento)) {
    throw new HttpsError("invalid-argument", "Selecciona un tipo de documento válido.");
  }
  const apellidos = safeText(rawData?.apellidos, 160);
  const numeroDocumento = safeText(rawData?.numeroDocumento, 60);
  const telefonoPersonal = safeText(rawData?.telefonoPersonal, 40);
  return {
    nombres,
    ...(apellidos ? { apellidos } : {}),
    ...(tipoDocumento ? { tipoDocumento } : {}),
    ...(numeroDocumento ? { numeroDocumento } : {}),
    ...(telefonoPersonal ? { telefonoPersonal } : {}),
  };
}

function sectionValidator(section, data, HttpsError) {
  if (section === "impuestos") return validateTaxSettings(data, HttpsError);
  if (section === "inventario") return validateInventorySettings(data, HttpsError);
  if (section === "cotizaciones") return validateQuoteSettings(data, HttpsError);
  throw new HttpsError("invalid-argument", "Selecciona una sección válida.");
}

async function updateBusinessInformationHandler(
  request,
  { db, HttpsError, FieldValue, requireBusinessAccess, validateBusinessProfileInput }
) {
  const context = await requireBusinessAccess(
    request,
    { db, HttpsError },
    { roles: ["OWNER", "ADMIN"] }
  );
  const now = FieldValue.serverTimestamp();
  const profileRef = context.businessRef.collection("empresa").doc("perfil");
  const existingProfileSnapshot = await profileRef.get();
  const existingBusiness = context.businessSnapshot.data() || {};
  const rawProfile = buildProfileInputWithAuthoritativeFields(
    request?.data?.profile || {},
    existingBusiness,
    existingProfileSnapshot.data() || {},
    HttpsError
  );
  const input = validateBusinessProfileInput(rawProfile, HttpsError, {
    existingBusiness,
  });
  const categoryPatch = {
    rubroCodigo: optionalPatch(FieldValue, input.rubroCodigo),
    rubroNombre: input.rubroNombre,
    rubroOtro: optionalPatch(FieldValue, input.rubroOtro),
  };
  const communePatch = {
    comunaCodigo: optionalPatch(FieldValue, input.comunaCodigo),
    comunaNombre: optionalPatch(FieldValue, input.comunaNombre),
  };
  const optionalFields = {
    razonSocial: optionalPatch(FieldValue, input.razonSocial),
    giro: optionalPatch(FieldValue, input.giro),
    email: optionalPatch(FieldValue, input.email),
    telefono: optionalPatch(FieldValue, input.telefono),
    direccion: optionalPatch(FieldValue, input.direccion),
    sitioWeb: optionalPatch(FieldValue, input.sitioWeb),
    ciudad: optionalPatch(FieldValue, input.ciudad || input.comunaNombre),
    regionEstado: optionalPatch(FieldValue, input.regionEstado),
    codigoPostal: optionalPatch(FieldValue, input.codigoPostal),
  };

  await db.runTransaction(async (transaction) => {
    const [currentBusiness, currentProfile] = await Promise.all([
      transaction.get(context.businessRef),
      transaction.get(profileRef),
    ]);
    const invalidation = await buildVerificationInvalidationPlan({
      business: currentBusiness.data() || {},
      businessId: context.businessId,
      businessRef: context.businessRef,
      db,
      FieldValue,
      nextProfile: {
        ...input,
        ...authoritativeBusinessFields(
          currentBusiness.data() || {},
          currentProfile.data() || {}
        ),
      },
      profile: currentProfile.data() || {},
      transaction,
      uid: context.uid,
    });
    transaction.update(context.businessRef, {
      nombreComercial: input.nombreComercial,
      ...categoryPatch,
      regionCodigo: input.regionCodigo,
      regionNombre: input.regionNombre,
      ...communePatch,
      ...(invalidation?.businessPatch || {}),
      actualizadoPorUid: context.uid,
      actualizadoEn: now,
    });
    transaction.set(
      profileRef,
      {
        negocioId: context.businessId,
        nombreComercial: input.nombreComercial,
        ...categoryPatch,
        regionCodigo: input.regionCodigo,
        regionNombre: input.regionNombre,
        region: input.regionNombre,
        ...communePatch,
        ...optionalFields,
        actualizadoPorUid: context.uid,
        actualizadoEn: now,
      },
      { merge: true }
    );
    applyVerificationInvalidation(transaction, invalidation);
  });

  return {
    profile: {
      nombreComercial: input.nombreComercial,
      rubroCodigo: input.rubroCodigo,
      rubroNombre: input.rubroNombre,
      rubroOtro: input.rubroOtro,
      paisCodigo: input.paisCodigo,
      paisNombre: input.paisNombre,
      monedaCodigo: input.monedaCodigo,
      monedaNombre: input.monedaNombre,
      locale: input.locale,
      identificadorFiscalTipo: input.identificadorFiscalTipo,
      identificadorFiscalValor: input.identificadorFiscalValor,
      regionCodigo: input.regionCodigo,
      regionNombre: input.regionNombre,
      comunaCodigo: input.comunaCodigo || "",
      comunaNombre: input.comunaNombre || "",
      razonSocial: input.razonSocial,
      rut: input.rut,
      giro: input.giro,
      email: input.email,
      telefono: input.telefono,
      direccion: input.direccion,
      ciudad: input.ciudad,
      regionEstado: input.regionEstado,
      codigoPostal: input.codigoPostal,
      sitioWeb: input.sitioWeb,
    },
  };
}

async function updateBusinessSettingsHandler(
  request,
  { db, HttpsError, FieldValue, requireBusinessAccess }
) {
  const context = await requireBusinessAccess(
    request,
    { db, HttpsError },
    { roles: ["OWNER", "ADMIN"] }
  );
  const section = safeText(request?.data?.section, 40).toLowerCase();
  if (section === "impuestos") {
    throw new HttpsError(
      "failed-precondition",
      "La configuración tributaria base se determina por el país y no admite edición directa."
    );
  }
  const settings = sectionValidator(section, request?.data?.settings, HttpsError);
  const ref = context.businessRef.collection("configuracion").doc(section);
  await ref.set({
    ...settings,
    negocioId: context.businessId,
    actualizadoPorUid: context.uid,
    actualizadoEn: FieldValue.serverTimestamp(),
  });
  return { section, settings };
}

async function updatePersonalProfileHandler(
  request,
  { db, HttpsError, FieldValue }
) {
  const uid = request?.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  const profile = validatePersonalProfile(request?.data?.profile, HttpsError);
  const ref = db.collection("usuarios").doc(uid).collection("cuenta").doc("perfil");
  await ref.set({
    ...profile,
    uid,
    actualizadoEn: FieldValue.serverTimestamp(),
  });
  return { profile: { ...profile, email: request.auth.token?.email || "" } };
}

module.exports = {
  TAX_OPTIONS,
  updateBusinessInformationHandler,
  updateBusinessSettingsHandler,
  updatePersonalProfileHandler,
  validateInventorySettings,
  validatePersonalProfile,
  validateQuoteSettings,
  validateTaxSettings,
};
