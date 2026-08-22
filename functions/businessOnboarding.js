const { createHash } = require("node:crypto");
const catalog = require("./businessCatalog.json");

const BUSINESS_ROLES = Object.freeze(["OWNER", "ADMIN", "MEMBER"]);
const ACTIVE_STATUS = "activo";
const DELETED_STATUS = "eliminada";
const FREE_PLAN_OWNER_BUSINESS_LIMIT = 2;

const countriesByCode = new Map(
  catalog.countries.map((country) => [country.code, country])
);
const currenciesByCode = new Map(
  catalog.currencies.map((currency) => [currency.code, currency])
);
const categoriesByCode = new Map(
  catalog.businessCategories.map((category) => [category.code, category])
);
const regionsByCode = new Map(
  catalog.regions.map((region) => [region.code, region])
);

function safeText(value, maxLength = 180) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizeRut(value) {
  return safeText(value, 20).toUpperCase().replace(/\./g, "").replace(/\s/g, "");
}

function isValidChileanRut(value) {
  const rut = normalizeRut(value);
  if (!/^\d{7,8}-[\dK]$/.test(rut)) return false;

  const [body, suppliedDigit] = rut.split("-");
  let sum = 0;
  let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  const expectedDigit = remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder);
  return suppliedDigit === expectedDigit;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function requireAuthenticatedUid(request, HttpsError) {
  const uid = request?.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  return uid;
}

function validateRequestId(value, HttpsError) {
  const requestId = safeText(value, 120);
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(requestId)) {
    throw new HttpsError(
      "invalid-argument",
      "No se pudo validar la solicitud de creación."
    );
  }
  return requestId;
}

function validateBusinessCategory(
  data,
  HttpsError,
  { existingBusiness = null } = {}
) {
  const code = safeText(data.rubroCodigo, 80);
  const category = categoriesByCode.get(code);
  const existingCode = safeText(existingBusiness?.rubroCodigo, 80);
  const existingName = safeText(existingBusiness?.rubroNombre, 120);
  const preservesExistingCode = Boolean(
    existingBusiness && code && code === existingCode
  );

  if (
    category &&
    category.active !== false &&
    (category.selectable !== false || preservesExistingCode)
  ) {
    if (category.code !== "OTRO") {
      return {
        rubroCodigo: category.code,
        rubroNombre: category.name,
      };
    }

    const existingCustomName =
      existingCode === "OTRO"
        ? safeText(
            existingBusiness?.rubroOtro ||
              (existingName !== category.name ? existingName : ""),
            120
          )
        : "";
    const customName =
      safeText(data.rubroOtro, 120) || existingCustomName;
    if (customName.length < 2) {
      throw new HttpsError(
        "invalid-argument",
        "Describe la categoría de tu negocio."
      );
    }
    return {
      rubroCodigo: category.code,
      rubroNombre: customName,
      rubroOtro: customName,
    };
  }

  if (existingBusiness && code && code === existingCode && existingName) {
    return {
      rubroCodigo: existingCode,
      rubroNombre: existingName,
      ...(safeText(existingBusiness.rubroOtro, 120)
        ? { rubroOtro: safeText(existingBusiness.rubroOtro, 120) }
        : {}),
    };
  }

  if (existingBusiness && !code && !existingCode && existingName) {
    const submittedName = safeText(data.rubroNombre, 120);
    if (!submittedName || submittedName === existingName) {
      return { rubroNombre: existingName };
    }
  }

  throw new HttpsError("invalid-argument", "Selecciona un rubro válido.");
}

function validateRequiredBusinessFields(
  rawData,
  HttpsError,
  { existingBusiness = null } = {}
) {
  const data = rawData && typeof rawData === "object" ? rawData : {};
  const nombreComercial = safeText(data.nombreComercial, 120);
  if (nombreComercial.length < 2) {
    throw new HttpsError(
      "invalid-argument",
      "El nombre comercial debe tener al menos 2 caracteres."
    );
  }

  const requestedCountryCode = safeText(data.paisCodigo, 10).toUpperCase() || "CL";
  const requestedCurrencyCode = safeText(data.monedaCodigo, 10).toUpperCase() || "CLP";
  const country = countriesByCode.get(requestedCountryCode);
  const currency = currenciesByCode.get(requestedCurrencyCode);
  if (!country?.active || !currency?.active) {
    throw new HttpsError("invalid-argument", "Selecciona un país y una moneda válidos.");
  }
  const categoryFields = validateBusinessCategory(data, HttpsError, {
    existingBusiness,
  });
  const regionCode = safeText(data.regionCodigo, 2);
  const region = country.code === "CL"
    ? regionsByCode.get(regionCode)
    : { code: "", name: safeText(data.regionEstado, 120), communes: [] };
  if (!region || (country.code !== "CL" && !region.name)) {
    throw new HttpsError("invalid-argument", "Selecciona una región válida.");
  }
  const communeCode = safeText(data.comunaCodigo, 5);
  const commune = communeCode
    ? region.communes.find((item) => item.code === communeCode)
    : null;
  if (country.code === "CL" && communeCode && !commune) {
    throw new HttpsError(
      "invalid-argument",
      "Selecciona una comuna perteneciente a la región indicada."
    );
  }

  let locale;
  try {
    locale = Intl.getCanonicalLocales(
      safeText(data.locale, 40) || country.defaultLocale || "es-CL"
    )[0];
  } catch {
    throw new HttpsError("invalid-argument", "Ingresa un formato regional válido.");
  }

  const normalized = {
    nombreComercial,
    ...categoryFields,
    paisCodigo: country.code,
    paisNombre: country.name,
    locale,
    regionCodigo: region.code,
    regionNombre: region.name,
    regionEstado: region.name,
    ciudad: commune?.name || safeText(data.ciudad, 120),
    monedaCodigo: currency.code,
    monedaNombre: currency.name,
    ...(commune
      ? { comunaCodigo: commune.code, comunaNombre: commune.name }
      : {}),
  };

  return normalized;
}

function validateBusinessCreationInput(rawData, HttpsError) {
  return validateRequiredBusinessFields(rawData, HttpsError);
}

function normalizeHttpUrl(value, fieldLabel, HttpsError) {
  const normalized = safeText(value, 500);
  if (!normalized) return "";
  try {
    const parsed = new URL(normalized);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("protocol");
    }
    return parsed.href;
  } catch {
    throw new HttpsError(
      "invalid-argument",
      `${fieldLabel} debe comenzar con http:// o https://.`
    );
  }
}

function validateBusinessProfileInput(
  rawData,
  HttpsError,
  { existingBusiness = null } = {}
) {
  const data = rawData && typeof rawData === "object" ? rawData : {};
  const base = validateRequiredBusinessFields(data, HttpsError, {
    existingBusiness,
  });

  const fiscalValue = safeText(data.identificadorFiscalValor || data.rut, 80);
  const rut = base.paisCodigo === "CL" ? normalizeRut(fiscalValue) : safeText(data.rut, 80);
  if (base.paisCodigo === "CL" && rut && !isValidChileanRut(rut)) {
    throw new HttpsError("invalid-argument", "Ingresa un RUT válido.");
  }
  const email = safeText(data.email, 180).toLowerCase();
  if (email && !isValidEmail(email)) {
    throw new HttpsError("invalid-argument", "Ingresa un correo comercial válido.");
  }

  const validityDays = Number(data.validezCotizacionDias || 15);
  if (!Number.isFinite(validityDays) || validityDays < 1 || validityDays > 365) {
    throw new HttpsError(
      "invalid-argument",
      "La validez de la cotización debe estar entre 1 y 365 días."
    );
  }

  return {
    ...base,
    rut,
    identificadorFiscalTipo:
      safeText(data.identificadorFiscalTipo, 40) ||
      countriesByCode.get(base.paisCodigo)?.defaultFiscalIdentifierLabel ||
      "Identificación fiscal",
    identificadorFiscalValor: fiscalValue,
    direccion: safeText(data.direccion, 240),
    codigoPostal: safeText(data.codigoPostal, 30),
    telefono: safeText(data.telefono, 40),
    email,
    razonSocial: safeText(data.razonSocial, 180),
    giro: safeText(data.giro, 500),
    sitioWeb: normalizeHttpUrl(data.sitioWeb, "El sitio web", HttpsError),
    responsable: safeText(data.responsable, 180),
    cargoResponsable: safeText(data.cargoResponsable, 180),
    condicionesPago: safeText(data.condicionesPago, 500),
    plazoEntregaCotizacion: safeText(data.plazoEntregaCotizacion, 240),
    alcanceGeograficoCotizacion: safeText(
      data.alcanceGeograficoCotizacion,
      500
    ),
    garantiaCotizacion: safeText(data.garantiaCotizacion, 500),
    exclusionesCotizacion: safeText(data.exclusionesCotizacion, 1200),
    terminosCotizacion: safeText(data.terminosCotizacion, 1200),
    validezCotizacionDias: Math.round(validityDays),
    aceptacionCotizacionHabilitada:
      data.aceptacionCotizacionHabilitada === true,
    textoAceptacionCotizacion: safeText(
      data.textoAceptacionCotizacion,
      500
    ),
    notaPieCotizacion: safeText(data.notaPieCotizacion, 500),
  };
}

function getBusinessProfileCompletion(profile = {}) {
  const missingMinimum = [];
  const missingRecommended = [];

  if (!safeText(profile.nombreComercial, 120)) missingMinimum.push("nombreComercial");
  if (
    !safeText(profile.rubroCodigo, 80) &&
    !safeText(profile.rubroNombre, 120)
  ) {
    missingMinimum.push("rubroCodigo");
  }
  if (!safeText(profile.regionCodigo || profile.regionEstado, 120)) {
    missingMinimum.push("regionEstado");
  }
  if (!safeText(profile.paisCodigo, 2)) missingMinimum.push("paisCodigo");
  if (!safeText(profile.monedaCodigo, 8)) missingMinimum.push("monedaCodigo");

  if (!safeText(profile.identificadorFiscalValor || profile.rut, 80)) {
    missingRecommended.push("identificadorFiscalValor");
  }
  if (
    !safeText(profile.comunaCodigo, 5) &&
    !safeText(profile.ciudad, 120)
  ) {
    missingRecommended.push("comuna");
  }
  if (!safeText(profile.direccion, 240)) missingRecommended.push("direccion");
  if (
    !safeText(profile.telefono, 40) &&
    !safeText(profile.email, 180)
  ) {
    missingRecommended.push("contacto");
  }

  return {
    minimumComplete: missingMinimum.length === 0,
    recommendedComplete: missingRecommended.length === 0,
    missingMinimum,
    missingRecommended,
  };
}

function quickCompanyProfile(input, businessId) {
  return {
    negocioId: businessId,
    nombreComercial: input.nombreComercial,
    rubroCodigo: input.rubroCodigo,
    rubroNombre: input.rubroNombre,
    ...(input.rubroOtro ? { rubroOtro: input.rubroOtro } : {}),
    paisCodigo: input.paisCodigo,
    paisNombre: input.paisNombre,
    monedaCodigo: input.monedaCodigo,
    monedaNombre: input.monedaNombre,
    locale: input.locale,
    identificadorFiscalTipo:
      input.identificadorFiscalTipo ||
      countriesByCode.get(input.paisCodigo)?.defaultFiscalIdentifierLabel ||
      "Identificación fiscal",
    identificadorFiscalValor: input.identificadorFiscalValor || "",
    regionCodigo: input.regionCodigo,
    regionNombre: input.regionNombre,
    regionEstado: input.regionEstado || input.regionNombre,
    region: input.regionNombre,
    ...(input.comunaCodigo
      ? {
          comunaCodigo: input.comunaCodigo,
          comunaNombre: input.comunaNombre,
          ciudad: input.comunaNombre,
        }
      : {}),
  };
}

function membershipDocumentId(businessId, uid) {
  return `${businessId}__${uid}`;
}

function fingerprintBusinessInput(input) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function businessResponse(snapshot, membershipData = null) {
  if (!snapshot?.exists) return null;
  const data = snapshot.data() || {};
  return {
    id: snapshot.id,
    nombreComercial: data.nombreComercial || "",
    rubroCodigo: data.rubroCodigo || "",
    rubroNombre: data.rubroNombre || "",
    rubroOtro: data.rubroOtro || "",
    paisCodigo: data.paisCodigo || "",
    paisNombre: data.paisNombre || "",
    regionCodigo: data.regionCodigo || "",
    regionNombre: data.regionNombre || "",
    comunaCodigo: data.comunaCodigo || "",
    comunaNombre: data.comunaNombre || "",
    monedaCodigo: data.monedaCodigo || "",
    monedaNombre: data.monedaNombre || "",
    rut: data.rut || "",
    direccion: data.direccion || "",
    telefono: data.telefono || "",
    email: data.email || "",
    estado: data.estado || "inactivo",
    role: membershipData?.rol || null,
  };
}

function planResponse(ownedBusinessCount) {
  const normalizedCount = Math.max(Number(ownedBusinessCount || 0), 0);
  return {
    code: "FREE",
    ownerBusinessLimit: FREE_PLAN_OWNER_BUSINESS_LIMIT,
    ownedBusinessCount: normalizedCount,
    canCreateBusiness: normalizedCount < FREE_PLAN_OWNER_BUSINESS_LIMIT,
  };
}

function isAvailableBusinessSnapshot(snapshot) {
  return Boolean(
    snapshot?.exists &&
      snapshot.data()?.estado === ACTIVE_STATUS &&
      !snapshot.data()?.eliminadoEn
  );
}

function sortBusinessEntries(left, right) {
  const byName = String(
    left.snapshot.data()?.nombreComercial || ""
  ).localeCompare(
    String(right.snapshot.data()?.nombreComercial || ""),
    "es"
  );
  return byName || left.snapshot.id.localeCompare(right.snapshot.id);
}

async function requireBusinessAccess(
  request,
  { db, HttpsError },
  { roles = BUSINESS_ROLES } = {}
) {
  const uid = requireAuthenticatedUid(request, HttpsError);
  const businessId = safeText(request?.data?.businessId, 160);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(businessId)) {
    throw new HttpsError("invalid-argument", "Selecciona un negocio válido.");
  }

  const businessRef = db.collection("negocios").doc(businessId);
  const membershipRef = db
    .collection("membresias")
    .doc(membershipDocumentId(businessId, uid));
  const [businessSnapshot, membershipSnapshot] = await Promise.all([
    businessRef.get(),
    membershipRef.get(),
  ]);
  const membership = membershipSnapshot.data() || {};

  if (
    !membershipSnapshot.exists ||
    membership.uid !== uid ||
    membership.negocioId !== businessId ||
    membership.estado !== ACTIVE_STATUS ||
    !roles.includes(membership.rol)
  ) {
    throw new HttpsError(
      "permission-denied",
      "No tienes acceso al negocio seleccionado."
    );
  }
  if (
    !businessSnapshot.exists ||
    businessSnapshot.data()?.estado !== ACTIVE_STATUS ||
    businessSnapshot.data()?.eliminadoEn
  ) {
    throw new HttpsError(
      "failed-precondition",
      "El negocio seleccionado ya no está disponible."
    );
  }

  return {
    uid,
    businessId,
    businessRef,
    businessSnapshot,
    membership,
    membershipRef,
  };
}

async function createFirstBusinessHandler(
  request,
  { db, HttpsError, FieldValue }
) {
  const uid = requireAuthenticatedUid(request, HttpsError);
  const requestId = validateRequestId(request?.data?.requestId, HttpsError);
  const input = validateBusinessCreationInput(request?.data, HttpsError);
  const fingerprint = fingerprintBusinessInput(input);
  const userRef = db.collection("usuarios").doc(uid);
  const lockRef = userRef.collection("sistema").doc("primerNegocio");
  const ownerPlanRef = userRef.collection("sistema").doc("negociosPropios");
  const membershipsQuery = db
    .collection("membresias")
    .where("uid", "==", uid);
  const requestRef = userRef
    .collection("businessCreateRequests")
    .doc(requestId);
  const proposedBusinessRef = db.collection("negocios").doc();

  return db.runTransaction(async (transaction) => {
    const [
      userSnapshot,
      lockSnapshot,
      requestSnapshot,
      ownerPlanSnapshot,
      membershipsSnapshot,
    ] =
      await Promise.all([
        transaction.get(userRef),
        transaction.get(lockRef),
        transaction.get(requestRef),
        transaction.get(ownerPlanRef),
        transaction.get(membershipsQuery),
      ]);

    if (requestSnapshot.exists) {
      const requestData = requestSnapshot.data() || {};
      if (requestData.fingerprint !== fingerprint) {
        throw new HttpsError(
          "failed-precondition",
          "La misma solicitud ya fue utilizada con otros datos."
        );
      }
      const existingBusinessRef = db
        .collection("negocios")
        .doc(requestData.negocioId);
      const existingBusinessSnapshot = await transaction.get(
        existingBusinessRef
      );
      if (!existingBusinessSnapshot.exists) {
        throw new HttpsError(
          "failed-precondition",
          "El negocio asociado a esta solicitud ya no está disponible."
        );
      }
      return {
        business: businessResponse(existingBusinessSnapshot, { rol: "OWNER" }),
        idempotent: true,
      };
    }

    const userData = userSnapshot.data() || {};
    const memberships = membershipsSnapshot.docs
      .map((snapshot) => snapshot.data() || {})
      .filter(
        (membership) =>
          membership.uid === uid &&
          BUSINESS_ROLES.includes(membership.rol)
      );
    const membershipBusinesses = await Promise.all(
      memberships.map((membership) =>
        transaction.get(db.collection("negocios").doc(membership.negocioId))
      )
    );
    const validMembershipIndex = membershipBusinesses.findIndex(
      (snapshot, index) =>
        memberships[index].estado === ACTIVE_STATUS &&
        isAvailableBusinessSnapshot(snapshot)
    );

    if (validMembershipIndex >= 0) {
      const businessSnapshot = membershipBusinesses[validMembershipIndex];
      const membershipData = memberships[validMembershipIndex];
      const now = FieldValue.serverTimestamp();
      transaction.set(
        userRef,
        {
          negocioActivoId: businessSnapshot.id,
          actualizadoEn: now,
          ...(userSnapshot.exists
            ? {}
            : {
                email: request?.auth?.token?.email || null,
                creadoEn: now,
              }),
        },
        { merge: true }
      );
      transaction.set(
        lockRef,
        {
          uid,
          negocioId: businessSnapshot.id,
          actualizadoEn: now,
          ...(lockSnapshot.exists ? {} : { creadoEn: now }),
        },
        { merge: true }
      );
      transaction.create(requestRef, {
        uid,
        negocioId: businessSnapshot.id,
        fingerprint,
        tipo: "inicial",
        creadoEn: now,
      });
      return {
        business: businessResponse(businessSnapshot, membershipData),
        idempotent: true,
      };
    }

    const ownedBusinessCount = membershipBusinesses.filter(
      (snapshot, index) =>
        memberships[index].rol === "OWNER" &&
        isAvailableBusinessSnapshot(snapshot)
    ).length;
    if (ownedBusinessCount >= FREE_PLAN_OWNER_BUSINESS_LIMIT) {
      throw new HttpsError(
        "resource-exhausted",
        `Tu plan actual permite administrar hasta ${FREE_PLAN_OWNER_BUSINESS_LIMIT} negocios como propietario.`,
        {
          reason: "owner-business-limit",
          ownerBusinessLimit: FREE_PLAN_OWNER_BUSINESS_LIMIT,
          ownedBusinessCount,
        }
      );
    }

    const businessRef = proposedBusinessRef;
    const membershipRef = db
      .collection("membresias")
      .doc(membershipDocumentId(businessRef.id, uid));
    const companyProfileRef = businessRef.collection("empresa").doc("perfil");
    const now = FieldValue.serverTimestamp();

    transaction.create(businessRef, {
      ...input,
      estado: ACTIVE_STATUS,
      modeloNegocioVersion: 2,
      creacionRapidaVersion: 1,
      creadoPorUid: uid,
      creadoEn: now,
      actualizadoEn: now,
    });
    transaction.create(membershipRef, {
      negocioId: businessRef.id,
      uid,
      rol: "OWNER",
      estado: ACTIVE_STATUS,
      creadoEn: now,
      actualizadoEn: now,
    });
    transaction.create(companyProfileRef, {
      ...quickCompanyProfile(input, businessRef.id),
      creadoPorUid: uid,
      creadoEn: now,
      actualizadoEn: now,
    });
    transaction.set(
      userRef,
      {
        email: request?.auth?.token?.email || userData.email || null,
        negocioActivoId: businessRef.id,
        primerNegocioId: businessRef.id,
        actualizadoEn: now,
        ...(userSnapshot.exists ? {} : { creadoEn: now }),
      },
      { merge: true }
    );
    transaction.set(
      lockRef,
      {
        uid,
        negocioId: businessRef.id,
        actualizadoEn: now,
        ...(lockSnapshot.exists ? {} : { creadoEn: now }),
      },
      { merge: true }
    );
    transaction.create(requestRef, {
      uid,
      negocioId: businessRef.id,
      fingerprint,
      tipo: "inicial",
      creadoEn: now,
    });
    transaction.set(
      ownerPlanRef,
      {
        uid,
        plan: "FREE",
        limite: FREE_PLAN_OWNER_BUSINESS_LIMIT,
        cantidad: ownedBusinessCount + 1,
        actualizadoEn: now,
        ...(ownerPlanSnapshot.exists ? {} : { creadoEn: now }),
      },
      { merge: true }
    );

    return {
      business: {
        id: businessRef.id,
        ...input,
        estado: ACTIVE_STATUS,
        role: "OWNER",
      },
      idempotent: false,
    };
  });
}

async function createAdditionalBusinessHandler(
  request,
  { db, HttpsError, FieldValue }
) {
  const uid = requireAuthenticatedUid(request, HttpsError);
  const requestId = validateRequestId(request?.data?.requestId, HttpsError);
  const input = validateBusinessCreationInput(request?.data, HttpsError);
  const fingerprint = fingerprintBusinessInput(input);
  const userRef = db.collection("usuarios").doc(uid);
  const requestRef = userRef
    .collection("businessCreateRequests")
    .doc(requestId);
  const ownerPlanRef = userRef.collection("sistema").doc("negociosPropios");
  const ownerMembershipsQuery = db
    .collection("membresias")
    .where("uid", "==", uid);
  const proposedBusinessRef = db.collection("negocios").doc();

  return db.runTransaction(async (transaction) => {
    const [userSnapshot, requestSnapshot, ownerPlanSnapshot, membershipsSnapshot] =
      await Promise.all([
        transaction.get(userRef),
        transaction.get(requestRef),
        transaction.get(ownerPlanRef),
        transaction.get(ownerMembershipsQuery),
      ]);

    if (requestSnapshot.exists) {
      const previousRequest = requestSnapshot.data() || {};
      if (
        previousRequest.tipo !== "adicional" ||
        previousRequest.fingerprint !== fingerprint
      ) {
        throw new HttpsError(
          "failed-precondition",
          "La misma solicitud ya fue utilizada con otros datos."
        );
      }
      const existingBusinessSnapshot = await transaction.get(
        db.collection("negocios").doc(previousRequest.negocioId)
      );
      if (!existingBusinessSnapshot.exists) {
        throw new HttpsError(
          "failed-precondition",
          "El negocio asociado a esta solicitud ya no está disponible."
        );
      }
      return {
        business: businessResponse(existingBusinessSnapshot, { rol: "OWNER" }),
        idempotent: true,
        plan: planResponse(ownerPlanSnapshot.data()?.cantidad),
      };
    }

    const ownerMemberships = membershipsSnapshot.docs
      .map((snapshot) => snapshot.data() || {})
      .filter(
        (membership) =>
          membership.uid === uid && membership.rol === "OWNER"
      );
    const ownerBusinessSnapshots = await Promise.all(
      ownerMemberships.map((membership) =>
        transaction.get(db.collection("negocios").doc(membership.negocioId))
      )
    );
    const ownedBusinessCount = ownerBusinessSnapshots.filter(
      isAvailableBusinessSnapshot
    ).length;

    if (ownedBusinessCount >= FREE_PLAN_OWNER_BUSINESS_LIMIT) {
      throw new HttpsError(
        "resource-exhausted",
        `Tu plan actual permite administrar hasta ${FREE_PLAN_OWNER_BUSINESS_LIMIT} negocios como propietario.`,
        {
          reason: "owner-business-limit",
          ownerBusinessLimit: FREE_PLAN_OWNER_BUSINESS_LIMIT,
          ownedBusinessCount,
        }
      );
    }

    const businessRef = proposedBusinessRef;
    const membershipRef = db
      .collection("membresias")
      .doc(membershipDocumentId(businessRef.id, uid));
    const companyProfileRef = businessRef.collection("empresa").doc("perfil");
    const now = FieldValue.serverTimestamp();

    transaction.create(businessRef, {
      ...input,
      estado: ACTIVE_STATUS,
      modeloNegocioVersion: 2,
      creacionRapidaVersion: 1,
      creadoPorUid: uid,
      creadoEn: now,
      actualizadoEn: now,
    });
    transaction.create(membershipRef, {
      negocioId: businessRef.id,
      uid,
      rol: "OWNER",
      estado: ACTIVE_STATUS,
      creadoEn: now,
      actualizadoEn: now,
    });
    transaction.create(companyProfileRef, {
      ...quickCompanyProfile(input, businessRef.id),
      creadoPorUid: uid,
      creadoEn: now,
      actualizadoEn: now,
    });
    transaction.set(
      userRef,
      {
        email: request?.auth?.token?.email || userSnapshot.data()?.email || null,
        negocioActivoId: businessRef.id,
        actualizadoEn: now,
        ...(userSnapshot.exists ? {} : { creadoEn: now }),
      },
      { merge: true }
    );
    transaction.set(
      ownerPlanRef,
      {
        uid,
        plan: "FREE",
        limite: FREE_PLAN_OWNER_BUSINESS_LIMIT,
        cantidad: ownedBusinessCount + 1,
        actualizadoEn: now,
        ...(ownerPlanSnapshot.exists ? {} : { creadoEn: now }),
      },
      { merge: true }
    );
    transaction.create(requestRef, {
      uid,
      negocioId: businessRef.id,
      fingerprint,
      tipo: "adicional",
      creadoEn: now,
    });

    return {
      business: {
        id: businessRef.id,
        ...input,
        estado: ACTIVE_STATUS,
        role: "OWNER",
      },
      idempotent: false,
      plan: planResponse(ownedBusinessCount + 1),
    };
  });
}

async function deleteBusinessHandler(
  request,
  { db, HttpsError, FieldValue }
) {
  const uid = requireAuthenticatedUid(request, HttpsError);
  const requestId = validateRequestId(request?.data?.requestId, HttpsError);
  const businessId = safeText(request?.data?.businessId, 160);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(businessId)) {
    throw new HttpsError("invalid-argument", "Selecciona un negocio válido.");
  }

  const userRef = db.collection("usuarios").doc(uid);
  const businessRef = db.collection("negocios").doc(businessId);
  const membershipRef = db
    .collection("membresias")
    .doc(membershipDocumentId(businessId, uid));
  const requestRef = userRef
    .collection("businessDeleteRequests")
    .doc(requestId);
  const ownerPlanRef = userRef.collection("sistema").doc("negociosPropios");
  const membershipsQuery = db
    .collection("membresias")
    .where("uid", "==", uid);

  return db.runTransaction(async (transaction) => {
    const [
      userSnapshot,
      businessSnapshot,
      membershipSnapshot,
      requestSnapshot,
      ownerPlanSnapshot,
      membershipsSnapshot,
    ] = await Promise.all([
      transaction.get(userRef),
      transaction.get(businessRef),
      transaction.get(membershipRef),
      transaction.get(requestRef),
      transaction.get(ownerPlanRef),
      transaction.get(membershipsQuery),
    ]);

    if (requestSnapshot.exists) {
      const previousRequest = requestSnapshot.data() || {};
      if (
        previousRequest.tipo !== "eliminacion" ||
        previousRequest.negocioId !== businessId
      ) {
        throw new HttpsError(
          "failed-precondition",
          "La misma solicitud ya fue utilizada para otro negocio."
        );
      }
      return {
        businessId,
        estado: DELETED_STATUS,
        nextBusinessId: previousRequest.nextBusinessId || null,
        needsOnboarding: Boolean(previousRequest.needsOnboarding),
        idempotent: true,
      };
    }

    const membership = membershipSnapshot.data() || {};
    if (
      !businessSnapshot.exists ||
      !membershipSnapshot.exists ||
      membership.uid !== uid ||
      membership.negocioId !== businessId ||
      membership.estado !== ACTIVE_STATUS ||
      membership.rol !== "OWNER"
    ) {
      throw new HttpsError(
        "permission-denied",
        "Sólo el propietario puede eliminar esta empresa."
      );
    }

    const memberships = membershipsSnapshot.docs
      .map((snapshot) => snapshot.data() || {})
      .filter(
        (item) => item.uid === uid && BUSINESS_ROLES.includes(item.rol)
      );
    const businessSnapshots = await Promise.all(
      memberships.map((item) =>
        transaction.get(db.collection("negocios").doc(item.negocioId))
      )
    );
    const entries = businessSnapshots.map((snapshot, index) => ({
      snapshot,
      membership: memberships[index],
    }));
    const availableAlternatives = entries
      .filter(
        ({ snapshot, membership: item }) =>
          snapshot.id !== businessId &&
          item.estado === ACTIVE_STATUS &&
          isAvailableBusinessSnapshot(snapshot)
      )
      .sort(sortBusinessEntries);
    const activeOwnedBusinessCount = entries.filter(
      ({ snapshot, membership: item }) =>
        snapshot.id !== businessId &&
        item.rol === "OWNER" &&
        isAvailableBusinessSnapshot(snapshot)
    ).length;
    const userData = userSnapshot.data() || {};
    const currentAlternative = availableAlternatives.find(
      ({ snapshot }) => snapshot.id === userData.negocioActivoId
    );
    const nextBusiness = currentAlternative || availableAlternatives[0] || null;
    const deletingActiveBusiness = userData.negocioActivoId === businessId;
    const shouldRepairActiveBusiness = deletingActiveBusiness ||
      !availableAlternatives.some(
        ({ snapshot }) => snapshot.id === userData.negocioActivoId
      );
    const nextBusinessId = shouldRepairActiveBusiness
      ? nextBusiness?.snapshot.id || null
      : userData.negocioActivoId;
    const needsOnboarding = !nextBusinessId;
    const now = FieldValue.serverTimestamp();
    const businessData = businessSnapshot.data() || {};
    const alreadyDeleted =
      businessData.estado === DELETED_STATUS || Boolean(businessData.eliminadoEn);

    if (!alreadyDeleted) {
      transaction.update(businessRef, {
        estado: DELETED_STATUS,
        eliminadoEn: now,
        eliminadoPorUid: uid,
        actualizadoEn: now,
      });
    }
    if (shouldRepairActiveBusiness) {
      transaction.set(
        userRef,
        {
          negocioActivoId: nextBusinessId || FieldValue.delete(),
          actualizadoEn: now,
          ...(userSnapshot.exists
            ? {}
            : {
                email: request?.auth?.token?.email || null,
                creadoEn: now,
              }),
        },
        { merge: true }
      );
    }
    transaction.set(
      ownerPlanRef,
      {
        uid,
        plan: "FREE",
        limite: FREE_PLAN_OWNER_BUSINESS_LIMIT,
        cantidad: activeOwnedBusinessCount,
        actualizadoEn: now,
        ...(ownerPlanSnapshot.exists ? {} : { creadoEn: now }),
      },
      { merge: true }
    );
    transaction.create(requestRef, {
      uid,
      negocioId: businessId,
      tipo: "eliminacion",
      nextBusinessId: nextBusinessId || null,
      needsOnboarding,
      creadoEn: now,
    });

    return {
      businessId,
      estado: DELETED_STATUS,
      nextBusinessId,
      needsOnboarding,
      idempotent: alreadyDeleted,
    };
  });
}

async function updateBusinessProfileHandler(
  request,
  { db, HttpsError, FieldValue }
) {
  const context = await requireBusinessAccess(
    request,
    { db, HttpsError },
    { roles: ["OWNER", "ADMIN"] }
  );
  const profileInput = validateBusinessProfileInput(
    request?.data?.profile,
    HttpsError,
    { existingBusiness: context.businessSnapshot.data() || {} }
  );
  const profileRef = context.businessRef.collection("empresa").doc("perfil");
  const now = FieldValue.serverTimestamp();
  const hasCommune = Boolean(profileInput.comunaCodigo);
  const responseProfilePayload = {
    ...profileInput,
    negocioId: context.businessId,
    region: profileInput.regionNombre,
    ciudad: profileInput.comunaNombre || "",
    comunaCodigo: profileInput.comunaCodigo || "",
    comunaNombre: profileInput.comunaNombre || "",
    actualizadoPorUid: context.uid,
    actualizadoEn: null,
  };
  const categoryStoragePatch = {
    rubroCodigo: profileInput.rubroCodigo || FieldValue.delete(),
    rubroNombre: profileInput.rubroNombre,
    rubroOtro: profileInput.rubroOtro || FieldValue.delete(),
  };
  const businessCommuneStoragePatch = hasCommune
    ? {
        comunaCodigo: profileInput.comunaCodigo,
        comunaNombre: profileInput.comunaNombre,
      }
    : {
        comunaCodigo: FieldValue.delete(),
        comunaNombre: FieldValue.delete(),
      };
  const profileCommuneStoragePatch = hasCommune
    ? {
        ...businessCommuneStoragePatch,
        ciudad: profileInput.comunaNombre,
      }
    : {
        ...businessCommuneStoragePatch,
        ciudad: FieldValue.delete(),
      };
  const storedProfilePayload = {
    ...profileInput,
    ...categoryStoragePatch,
    ...profileCommuneStoragePatch,
    negocioId: context.businessId,
    region: profileInput.regionNombre,
    actualizadoPorUid: context.uid,
    actualizadoEn: now,
  };

  await db.runTransaction(async (transaction) => {
    const currentProfile = await transaction.get(profileRef);
    transaction.update(context.businessRef, {
      nombreComercial: profileInput.nombreComercial,
      ...categoryStoragePatch,
      paisCodigo: profileInput.paisCodigo,
      paisNombre: profileInput.paisNombre,
      monedaCodigo: profileInput.monedaCodigo,
      monedaNombre: profileInput.monedaNombre,
      locale: profileInput.locale,
      identificadorFiscalTipo: profileInput.identificadorFiscalTipo,
      identificadorFiscalValor: profileInput.identificadorFiscalValor || FieldValue.delete(),
      rut: profileInput.rut || FieldValue.delete(),
      regionCodigo: profileInput.regionCodigo,
      regionNombre: profileInput.regionNombre,
      regionEstado: profileInput.regionEstado,
      ciudad: profileInput.ciudad || FieldValue.delete(),
      codigoPostal: profileInput.codigoPostal || FieldValue.delete(),
      ...businessCommuneStoragePatch,
      actualizadoPorUid: context.uid,
      actualizadoEn: now,
    });
    transaction.set(
      profileRef,
      {
        ...storedProfilePayload,
        ...(currentProfile.exists
          ? {}
          : { creadoPorUid: context.uid, creadoEn: now }),
      },
      { merge: true }
    );
  });

  return {
    profile: responseProfilePayload,
    completion: getBusinessProfileCompletion(responseProfilePayload),
  };
}

async function setActiveBusinessHandler(
  request,
  { db, HttpsError, FieldValue }
) {
  const context = await requireBusinessAccess(request, { db, HttpsError });
  const userRef = db.collection("usuarios").doc(context.uid);
  await userRef.set(
    {
      negocioActivoId: context.businessId,
      actualizadoEn: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    activeBusiness: businessResponse(
      context.businessSnapshot,
      context.membership
    ),
  };
}

async function getBusinessSessionHandler(
  request,
  { db, HttpsError, FieldValue }
) {
  const uid = requireAuthenticatedUid(request, HttpsError);
  const userRef = db.collection("usuarios").doc(uid);
  const [userSnapshot, membershipsSnapshot] = await Promise.all([
    userRef.get(),
    db.collection("membresias").where("uid", "==", uid).get(),
  ]);
  const userData = userSnapshot.data() || {};
  const memberships = membershipsSnapshot.docs
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
    .filter(
      (membership) =>
        membership.uid === uid && BUSINESS_ROLES.includes(membership.rol)
    );
  const businessSnapshots = await Promise.all(
    memberships.map((membership) =>
      db.collection("negocios").doc(membership.negocioId).get()
    )
  );
  const available = businessSnapshots
    .map((snapshot, index) => ({
      snapshot,
      membership: memberships[index],
    }))
    .filter(
      ({ snapshot, membership }) =>
        membership.estado === ACTIVE_STATUS &&
        isAvailableBusinessSnapshot(snapshot)
    )
    .sort(sortBusinessEntries);

  const availableBusinesses = available.map(({ snapshot, membership }) =>
    businessResponse(snapshot, membership)
  );
  const ownedBusinessCount = businessSnapshots.filter(
    (snapshot, index) =>
      memberships[index].rol === "OWNER" &&
      isAvailableBusinessSnapshot(snapshot)
  ).length;

  const preferred = available.find(
    ({ snapshot }) => snapshot.id === userData.negocioActivoId
  );
  const selected = preferred || available[0] || null;

  if (selected) {
    if (selected.snapshot.id !== userData.negocioActivoId) {
      const now = FieldValue.serverTimestamp();
      await userRef.set(
        {
          negocioActivoId: selected.snapshot.id,
          actualizadoEn: now,
          ...(userSnapshot.exists
            ? {}
            : {
                email: request?.auth?.token?.email || null,
                creadoEn: now,
              }),
        },
        { merge: true }
      );
    }
    return {
      accessState: "active",
      needsOnboarding: false,
      activeBusiness: businessResponse(
        selected.snapshot,
        selected.membership
      ),
      businesses: availableBusinesses,
      membershipCount: memberships.length,
      plan: planResponse(ownedBusinessCount),
    };
  }

  if (userSnapshot.exists && userData.negocioActivoId) {
    await userRef.set(
      {
        negocioActivoId: FieldValue.delete(),
        actualizadoEn: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  return {
    accessState: "onboarding",
    needsOnboarding: true,
    activeBusiness: null,
    businesses: [],
    membershipCount: memberships.length,
    plan: planResponse(ownedBusinessCount),
  };
}

function buildBusinessCatalogSeedEntries() {
  const entries = [];
  for (const country of catalog.countries) {
    entries.push({ collection: "paises", id: country.code, data: country });
  }
  for (const currency of catalog.currencies) {
    entries.push({ collection: "monedas", id: currency.code, data: currency });
  }
  for (const category of catalog.businessCategories) {
    entries.push({ collection: "rubros", id: category.code, data: category });
  }
  for (const region of catalog.regions) {
    entries.push({
      collection: "regiones",
      id: region.code,
      data: {
        code: region.code,
        name: region.name,
        abbreviation: region.abbreviation,
        countryCode: "CL",
        active: true,
      },
    });
    for (const commune of region.communes) {
      entries.push({
        collection: "comunas",
        id: commune.code,
        data: {
          ...commune,
          regionCode: region.code,
          countryCode: "CL",
          active: true,
        },
      });
    }
  }
  entries.push({
    collection: "metadatos",
    id: "esquema",
    data: {
      schemaVersion: catalog.schemaVersion,
      catalogSource: catalog.source,
      countries: catalog.countries.length,
      currencies: catalog.currencies.length,
      businessCategories: catalog.businessCategories.length,
      regions: catalog.regions.length,
      communes: catalog.regions.reduce(
        (total, region) => total + region.communes.length,
        0
      ),
    },
  });
  return entries;
}

module.exports = {
  ACTIVE_STATUS,
  BUSINESS_ROLES,
  DELETED_STATUS,
  FREE_PLAN_OWNER_BUSINESS_LIMIT,
  buildBusinessCatalogSeedEntries,
  createAdditionalBusinessHandler,
  createFirstBusinessHandler,
  deleteBusinessHandler,
  getBusinessSessionHandler,
  membershipDocumentId,
  requireBusinessAccess,
  setActiveBusinessHandler,
  updateBusinessProfileHandler,
  validateBusinessCreationInput,
  validateBusinessProfileInput,
  getBusinessProfileCompletion,
};
