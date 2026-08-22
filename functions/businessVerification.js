const {createHash} = require("node:crypto");
const {
  adaptStoredFiscalIdentifier,
  buildFiscalIdentifier,
  isValidFiscalIdentifier,
  normalizeCountryCode,
} = require("./fiscalIdentifier");

const PLATFORM_SUPERADMIN = "PLATFORM_SUPERADMIN";
const VERIFICATION_STATES = Object.freeze({
  NOT_VERIFIED: "NO_VERIFICADA",
  PENDING: "PENDIENTE",
  VERIFIED: "VERIFICADA",
  REJECTED: "RECHAZADA",
});
const ACTIVE_STATUS = "activo";
const EVIDENCE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

function fail(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

function text(value, max = 1000) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function requestId(value, HttpsError) {
  const normalized = text(value, 120);
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(normalized)) {
    fail(HttpsError, "invalid-argument", "No se pudo validar la solicitud.");
  }
  return normalized;
}

function documentId(value, label, HttpsError) {
  const normalized = text(value, 160);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(normalized)) {
    fail(HttpsError, "invalid-argument", `${label} no es valido.`);
  }
  return normalized;
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function currentVerification(business = {}) {
  const verification = business.verificacionEmpresa || {};
  const state = Object.values(VERIFICATION_STATES).includes(verification.estado)
    ? verification.estado
    : VERIFICATION_STATES.NOT_VERIFIED;
  return {...verification, estado: state};
}

function businessIdentity(business = {}, profile = {}) {
  const source = {
    paisCodigo: profile.paisCodigo || business.paisCodigo || "CL",
    identificadorFiscalTipo:
      profile.identificadorFiscalTipo || business.identificadorFiscalTipo,
    identificadorFiscalValor:
      profile.identificadorFiscalValor || profile.rut ||
      business.identificadorFiscalValor || business.rut,
  };
  return adaptStoredFiscalIdentifier(source, source.paisCodigo);
}

function legalName(business = {}, profile = {}) {
  return text(profile.razonSocial || business.razonSocial, 180);
}

function verificationIdentityKey(countryCode, normalized) {
  const country = normalizeCountryCode(countryCode);
  const value = text(normalized, 80).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${country}__${value}`;
}

function fiscalDataChanged(business, profile, nextProfile) {
  const current = businessIdentity(business, profile);
  const next = buildFiscalIdentifier(
    nextProfile.paisCodigo,
    nextProfile.identificadorFiscalValor || nextProfile.rut
  );
  return current.paisCodigo !== next.paisCodigo ||
    current.identificadorFiscalNormalizado !== next.identificadorFiscalNormalizado ||
    text(current.identificadorFiscalTipo, 40) !==
      text(nextProfile.identificadorFiscalTipo || next.identificadorFiscalTipo, 40) ||
    legalName(business, profile) !== text(nextProfile.razonSocial, 180);
}

async function buildVerificationInvalidationPlan({
  business,
  businessId,
  businessRef,
  db,
  FieldValue,
  nextProfile,
  profile,
  transaction,
  uid,
}) {
  const verification = currentVerification(business);
  if (![VERIFICATION_STATES.PENDING, VERIFICATION_STATES.VERIFIED]
    .includes(verification.estado) ||
    !fiscalDataChanged(business, profile, nextProfile)) {
    return null;
  }
  const previousIdentity = businessIdentity(business, profile);
  const nextIdentity = buildFiscalIdentifier(
    nextProfile.paisCodigo,
    nextProfile.identificadorFiscalValor || nextProfile.rut
  );
  let reservationRef = null;
  let reservation = null;
  if (verification.estado === VERIFICATION_STATES.VERIFIED) {
    const key = verificationIdentityKey(
      verification.paisCodigo || previousIdentity.paisCodigo,
      verification.identificadorFiscalNormalizado ||
        previousIdentity.identificadorFiscalNormalizado
    );
    reservationRef = db.collection("identidadesFiscalesVerificadas").doc(key);
    reservation = await transaction.get(reservationRef);
  }
  const timestamp = FieldValue.serverTimestamp();
  return {
    businessPatch: {
      verificacionEmpresa: {
        estado: VERIFICATION_STATES.NOT_VERIFIED,
        solicitudIdAnterior: text(verification.solicitudIdActual, 160),
        invalidadaPorUid: uid,
        invalidadaEn: timestamp,
        motivoInvalidacion: "CAMBIO_DATOS_FISCALES",
      },
    },
    eventRef: businessRef.collection("eventosVerificacionEmpresa").doc(),
    event: {
      negocioId: businessId,
      tipo: "VERIFICACION_INVALIDADA",
      estadoAnterior: verification.estado,
      estadoResultante: VERIFICATION_STATES.NOT_VERIFIED,
      solicitudId: text(verification.solicitudIdActual, 160),
      identidadAnterior: previousIdentity,
      identidadNueva: nextIdentity,
      razonSocialAnterior: legalName(business, profile),
      razonSocialNueva: text(nextProfile.razonSocial, 180),
      motivo: "CAMBIO_DATOS_FISCALES",
      creadoPorUid: uid,
      creadoEn: timestamp,
    },
    reservationRef,
    releaseReservation: Boolean(
      reservation?.exists && reservation.data()?.negocioId === businessId
    ),
  };
}

function applyVerificationInvalidation(transaction, plan) {
  if (!plan) return;
  transaction.create(plan.eventRef, plan.event);
  if (plan.releaseReservation) transaction.delete(plan.reservationRef);
}

function normalizeEvidence(raw, {businessId, uid, operationId, HttpsError}) {
  if (!raw) return null;
  const path = text(raw.ruta, 500);
  const expectedPrefix = `negocios/${businessId}/verificacion/${uid}/${operationId}/`;
  const contentType = text(raw.tipoContenido, 100).toLowerCase();
  const size = Number(raw.tamanoBytes);
  if (!path.startsWith(expectedPrefix) || path.slice(expectedPrefix.length).includes("/")) {
    fail(HttpsError, "invalid-argument", "El documento acreditativo no es valido.");
  }
  if (!EVIDENCE_TYPES.has(contentType) || !Number.isFinite(size) ||
    size <= 0 || size > MAX_EVIDENCE_BYTES) {
    fail(HttpsError, "invalid-argument", "El documento debe ser PDF, JPG o PNG y pesar hasta 5 MB.");
  }
  return {
    ruta: path,
    nombreOriginal: text(raw.nombreOriginal, 240),
    tipoContenido: contentType,
    tamanoBytes: size,
  };
}

async function verifyEvidence(evidence, bucket, HttpsError) {
  if (!evidence) return null;
  if (!bucket) fail(HttpsError, "failed-precondition", "Storage no esta disponible.");
  try {
    const [metadata] = await bucket.file(evidence.ruta).getMetadata();
    const storedSize = Number(metadata.size);
    const storedType = text(metadata.contentType, 100).toLowerCase();
    if (!EVIDENCE_TYPES.has(storedType) || !Number.isFinite(storedSize) ||
      storedSize <= 0 || storedSize > MAX_EVIDENCE_BYTES) {
      fail(HttpsError, "invalid-argument", "El documento acreditativo no es valido.");
    }
    return {...evidence, tipoContenido: storedType, tamanoBytes: storedSize};
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    fail(HttpsError, "invalid-argument", "No se encontro el documento acreditativo.");
  }
}

function normalizeRequestPayload(raw = {}, HttpsError) {
  const country = normalizeCountryCode(raw.paisCodigo);
  const fiscal = buildFiscalIdentifier(country, raw.identificadorFiscalValor);
  const normalized = {
    razonSocial: text(raw.razonSocial, 180),
    ...fiscal,
    relacionSolicitante: text(raw.relacionSolicitante, 160),
    correoSolicitante: text(raw.correoSolicitante, 180).toLowerCase(),
    telefonoSolicitante: text(raw.telefonoSolicitante, 40),
    observaciones: text(raw.observaciones, 4000),
  };
  if (!normalized.razonSocial || normalized.relacionSolicitante.length < 2 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.correoSolicitante) ||
    normalized.telefonoSolicitante.length < 6 ||
    !isValidFiscalIdentifier(country, raw.identificadorFiscalValor)) {
    fail(HttpsError, "invalid-argument", "Completa datos empresariales y de contacto validos.");
  }
  return normalized;
}

async function solicitarVerificacionEmpresaHandler(request, dependencies) {
  const {bucket, db, FieldValue, HttpsError, requireBusinessAccess} = dependencies;
  const context = await requireBusinessAccess(
    request,
    {db, HttpsError},
    {roles: ["OWNER"]}
  );
  const operationId = requestId(request?.data?.requestId, HttpsError);
  const supplied = normalizeRequestPayload(request?.data?.solicitud, HttpsError);
  let evidence = normalizeEvidence(request?.data?.solicitud?.documentoAcreditativo, {
    businessId: context.businessId,
    uid: context.uid,
    operationId,
    HttpsError,
  });
  evidence = await verifyEvidence(evidence, bucket, HttpsError);
  const requestFingerprint = fingerprint({...supplied, documentoAcreditativo: evidence});
  const operationRef = context.businessRef.collection("businessVerificationRequests")
    .doc(operationId);
  const profileRef = context.businessRef.collection("empresa").doc("perfil");
  const verificationRequestRef = context.businessRef
    .collection("solicitudesVerificacionEmpresa").doc();
  const eventRef = context.businessRef.collection("eventosVerificacionEmpresa").doc();

  return db.runTransaction(async (transaction) => {
    const [operation, businessSnapshot, profileSnapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(context.businessRef),
      transaction.get(profileRef),
    ]);
    const business = businessSnapshot.data() || {};
    if (operation.exists) {
      const previous = operation.data() || {};
      if (previous.uidUsuario !== context.uid ||
        previous.fingerprint !== requestFingerprint) {
        fail(HttpsError, "already-exists", "La solicitud ya fue utilizada con otros datos.");
      }
      return {
        solicitudId: previous.solicitudId,
        estado: currentVerification(business).estado,
        idempotent: true,
      };
    }
    if (!businessSnapshot.exists || business.estado !== ACTIVE_STATUS || business.eliminadoEn) {
      fail(HttpsError, "failed-precondition", "La empresa no esta disponible.");
    }
    const verification = currentVerification(business);
    if (verification.estado === VERIFICATION_STATES.PENDING) {
      fail(HttpsError, "failed-precondition", "La empresa ya tiene una solicitud pendiente.");
    }
    if (verification.estado === VERIFICATION_STATES.VERIFIED) {
      fail(HttpsError, "failed-precondition", "La empresa ya esta verificada.");
    }
    const profile = profileSnapshot.data() || {};
    const authoritativeIdentity = businessIdentity(business, profile);
    const authoritativeLegalName = legalName(business, profile);
    if (!authoritativeLegalName || supplied.razonSocial !== authoritativeLegalName ||
      supplied.paisCodigo !== authoritativeIdentity.paisCodigo ||
      supplied.identificadorFiscalNormalizado !==
        authoritativeIdentity.identificadorFiscalNormalizado) {
      fail(HttpsError, "failed-precondition", "Guarda primero los datos fiscales vigentes de la empresa.");
    }
    const timestamp = FieldValue.serverTimestamp();
    const stored = {
      modeloVerificacionVersion: 1,
      solicitudVerificacionId: verificationRequestRef.id,
      negocioId: context.businessId,
      razonSocial: authoritativeLegalName,
      paisCodigo: authoritativeIdentity.paisCodigo,
      identificadorFiscalTipo: authoritativeIdentity.identificadorFiscalTipo,
      identificadorFiscalValor: authoritativeIdentity.identificadorFiscalValor,
      identificadorFiscalNormalizado:
        authoritativeIdentity.identificadorFiscalNormalizado,
      relacionSolicitante: supplied.relacionSolicitante,
      correoSolicitante: supplied.correoSolicitante,
      telefonoSolicitante: supplied.telefonoSolicitante,
      observaciones: supplied.observaciones,
      ...(evidence ? {documentoAcreditativo: evidence} : {}),
      solicitadoPorUid: context.uid,
      solicitadoEn: timestamp,
    };
    transaction.create(verificationRequestRef, stored);
    transaction.create(eventRef, {
      negocioId: context.businessId,
      solicitudId: verificationRequestRef.id,
      tipo: "VERIFICACION_SOLICITADA",
      estadoAnterior: verification.estado,
      estadoResultante: VERIFICATION_STATES.PENDING,
      creadoPorUid: context.uid,
      creadoEn: timestamp,
    });
    transaction.update(context.businessRef, {
      verificacionEmpresa: {
        estado: VERIFICATION_STATES.PENDING,
        solicitudIdActual: verificationRequestRef.id,
        solicitadoPorUid: context.uid,
        solicitadoEn: timestamp,
      },
      actualizadoEn: timestamp,
    });
    transaction.create(operationRef, {
      negocioId: context.businessId,
      solicitudId: verificationRequestRef.id,
      uidUsuario: context.uid,
      fingerprint: requestFingerprint,
      creadoEn: timestamp,
    });
    return {
      solicitudId: verificationRequestRef.id,
      estado: VERIFICATION_STATES.PENDING,
      idempotent: false,
    };
  });
}

function requirePlatformSuperadmin(request, HttpsError) {
  const uid = request?.auth?.uid;
  if (!uid) fail(HttpsError, "unauthenticated", "Debes iniciar sesion.");
  if (request?.auth?.token?.platformRole !== PLATFORM_SUPERADMIN) {
    fail(HttpsError, "permission-denied", "Se requiere autoridad de plataforma.");
  }
  return uid;
}

async function resolverVerificacionEmpresaHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const uid = requirePlatformSuperadmin(request, HttpsError);
  const businessId = documentId(request?.data?.businessId, "El negocio", HttpsError);
  const verificationRequestId = documentId(
    request?.data?.solicitudId,
    "La solicitud",
    HttpsError
  );
  const operationId = requestId(request?.data?.requestId, HttpsError);
  const decision = text(request?.data?.decision, 20).toUpperCase();
  if (!new Set(["APROBAR", "RECHAZAR"]).has(decision)) {
    fail(HttpsError, "invalid-argument", "Selecciona una decision valida.");
  }
  const rejectionReason = text(request?.data?.motivo, 1000);
  if (decision === "RECHAZAR" && !rejectionReason) {
    fail(HttpsError, "invalid-argument", "Indica el motivo del rechazo.");
  }
  const decisionFingerprint = fingerprint({
    businessId,
    verificationRequestId,
    decision,
    rejectionReason,
  });
  const businessRef = db.collection("negocios").doc(businessId);
  const verificationRequestRef = businessRef
    .collection("solicitudesVerificacionEmpresa").doc(verificationRequestId);
  const operationRef = businessRef.collection("platformVerificationDecisionRequests")
    .doc(operationId);
  const membershipRef = db.collection("membresias").doc(`${businessId}__${uid}`);
  const eventRef = businessRef.collection("eventosVerificacionEmpresa").doc();
  const profileRef = businessRef.collection("empresa").doc("perfil");

  return db.runTransaction(async (transaction) => {
    const [operation, businessSnapshot, profileSnapshot, verificationRequest, membership] =
      await Promise.all([
        transaction.get(operationRef),
        transaction.get(businessRef),
        transaction.get(profileRef),
        transaction.get(verificationRequestRef),
        transaction.get(membershipRef),
      ]);
    const business = businessSnapshot.data() || {};
    if (operation.exists) {
      const previous = operation.data() || {};
      if (previous.uidUsuario !== uid || previous.fingerprint !== decisionFingerprint) {
        fail(HttpsError, "already-exists", "La decision ya fue utilizada con otros datos.");
      }
      return {
        estado: currentVerification(business).estado,
        solicitudId: verificationRequestId,
        idempotent: true,
      };
    }
    if (!businessSnapshot.exists || business.estado !== ACTIVE_STATUS || business.eliminadoEn) {
      fail(HttpsError, "failed-precondition", "La empresa no esta disponible.");
    }
    const membershipData = membership.data() || {};
    if (membership.exists && membershipData.estado === ACTIVE_STATUS &&
      ["OWNER", "ADMIN"].includes(membershipData.rol)) {
      fail(HttpsError, "permission-denied", "No puedes resolver la verificacion de tu propia empresa.");
    }
    if (!verificationRequest.exists ||
      verificationRequest.data()?.negocioId !== businessId) {
      fail(HttpsError, "not-found", "No se encontro la solicitud de verificacion.");
    }
    const verification = currentVerification(business);
    if (verification.estado !== VERIFICATION_STATES.PENDING ||
      verification.solicitudIdActual !== verificationRequestId) {
      fail(HttpsError, "failed-precondition", "La solicitud ya no esta pendiente.");
    }
    const requestData = verificationRequest.data() || {};
    const currentIdentity = businessIdentity(business, profileSnapshot.data() || {});
    if (currentIdentity.paisCodigo !== requestData.paisCodigo ||
      currentIdentity.identificadorFiscalNormalizado !==
        requestData.identificadorFiscalNormalizado ||
      legalName(business, profileSnapshot.data() || {}) !== requestData.razonSocial) {
      fail(HttpsError, "failed-precondition", "Los datos fiscales cambiaron desde la solicitud.");
    }
    const identityKey = verificationIdentityKey(
      requestData.paisCodigo,
      requestData.identificadorFiscalNormalizado
    );
    const identityRef = db.collection("identidadesFiscalesVerificadas")
      .doc(identityKey);
    const identityReservation = decision === "APROBAR"
      ? await transaction.get(identityRef)
      : null;
    if (identityReservation?.exists &&
      identityReservation.data()?.negocioId !== businessId) {
      fail(HttpsError, "already-exists", "La identidad fiscal ya pertenece a otra empresa verificada.");
    }
    const timestamp = FieldValue.serverTimestamp();
    const resultingState = decision === "APROBAR"
      ? VERIFICATION_STATES.VERIFIED
      : VERIFICATION_STATES.REJECTED;
    if (decision === "APROBAR" && !identityReservation.exists) {
      transaction.create(identityRef, {
        identidadFiscalClave: identityKey,
        negocioId: businessId,
        solicitudId: verificationRequestId,
        paisCodigo: requestData.paisCodigo,
        identificadorFiscalTipo: requestData.identificadorFiscalTipo,
        identificadorFiscalNormalizado: requestData.identificadorFiscalNormalizado,
        reservadoPorUid: uid,
        reservadoEn: timestamp,
      });
    }
    const verificationPatch = {
      estado: resultingState,
      solicitudIdActual: verificationRequestId,
      solicitadoPorUid: requestData.solicitadoPorUid,
      solicitadoEn: requestData.solicitadoEn,
      decididoPorUid: uid,
      decididoEn: timestamp,
      ...(decision === "APROBAR"
        ? {
            razonSocialVerificada: requestData.razonSocial,
            paisCodigo: requestData.paisCodigo,
            identificadorFiscalTipo: requestData.identificadorFiscalTipo,
            identificadorFiscalValor: requestData.identificadorFiscalValor,
            identificadorFiscalNormalizado:
              requestData.identificadorFiscalNormalizado,
          }
        : {motivoRechazo: rejectionReason}),
    };
    transaction.update(businessRef, {
      verificacionEmpresa: verificationPatch,
      actualizadoEn: timestamp,
    });
    transaction.create(eventRef, {
      negocioId: businessId,
      solicitudId: verificationRequestId,
      tipo: decision === "APROBAR"
        ? "VERIFICACION_APROBADA"
        : "VERIFICACION_RECHAZADA",
      estadoAnterior: VERIFICATION_STATES.PENDING,
      estadoResultante: resultingState,
      ...(rejectionReason ? {motivo: rejectionReason} : {}),
      creadoPorUid: uid,
      creadoEn: timestamp,
    });
    transaction.create(operationRef, {
      negocioId: businessId,
      solicitudId: verificationRequestId,
      uidUsuario: uid,
      decision,
      fingerprint: decisionFingerprint,
      creadoEn: timestamp,
    });
    return {
      estado: resultingState,
      solicitudId: verificationRequestId,
      idempotent: false,
    };
  });
}

module.exports = {
  MAX_EVIDENCE_BYTES,
  PLATFORM_SUPERADMIN,
  VERIFICATION_STATES,
  applyVerificationInvalidation,
  buildVerificationInvalidationPlan,
  businessIdentity,
  currentVerification,
  fiscalDataChanged,
  resolverVerificacionEmpresaHandler,
  solicitarVerificacionEmpresaHandler,
  verificationIdentityKey,
};
