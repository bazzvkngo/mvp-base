const crypto = require("node:crypto");
const {SALES_WRITE_ROLES} = require("./rbac");
const {
  buildAuthoritativeCompanySnapshot,
  getHistoricalCompanySnapshot,
} = require("./companySnapshot");
const {
  buildQuoteEvent,
  normalizeLifecycleRequestId,
  quoteEventRef,
  quoteHasActiveResponse,
  quoteOpportunityVersion,
} = require("./quoteLifecycle");
const {
  linkedWorkFields,
  writeQuoteResponseEvent,
} = require("./workPersistence");
const {resolveBaseTaxSettings} = require("./businessJurisdiction");
const {assertBusinessCanOperate} = require("./businessOperations");
const {createConfirmedSaleFromQuoteInTransaction} = require("./salePersistence");

const PUBLIC_TOKEN_COLLECTION = "quotePublicTokens";
const PUBLIC_TOKEN_BYTES = 32;
const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PUBLIC_TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const PUBLIC_BASE_URL = "https://valoracloud.bagner.cl";
const EMULATOR_PUBLIC_BASE_URL = "http://localhost:5173";
const CHILE_TIME_ZONE = "America/Santiago";
const MAX_REJECTION_COMMENT_LENGTH = 500;
const COPY_LINK_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const REJECTION_REASONS = new Set([
  "precio",
  "plazo",
  "requerimiento_cambio",
  "otra_alternativa",
  "otro",
  "no_indica",
]);

function safeText(value, maxLength = 2000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function safePublicAssetUrl(value, prohibitedValues = []) {
  const text = safeText(value, 1200);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") return "";
    const decoded = decodeURIComponent(url.href);
    if (
      prohibitedValues
        .map((item) => safeText(item, 160))
        .filter(Boolean)
        .some((item) => decoded.includes(item))
    ) {
      return "";
    }
    return url.href;
  } catch {
    return "";
  }
}

function isEmulatorEnvironment(env = process.env) {
  return env.FUNCTIONS_EMULATOR === "true" || Boolean(env.FIRESTORE_EMULATOR_HOST);
}

function getPublicBaseUrl(env = process.env) {
  if (!isEmulatorEnvironment(env)) return PUBLIC_BASE_URL;
  const configured = safeText(env.PUBLIC_BASE_URL, 500).replace(/\/+$/, "");
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configured)) {
    return configured;
  }
  return EMULATOR_PUBLIC_BASE_URL;
}

function createPublicTokenMaterial(randomBytes = crypto.randomBytes) {
  const rawToken = randomBytes(PUBLIC_TOKEN_BYTES).toString("base64url");
  return {
    rawToken,
    tokenHash: hashPublicToken(rawToken),
  };
}

function hashPublicToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken || "")).digest("hex");
}

function validateAndHashPublicToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!PUBLIC_TOKEN_PATTERN.test(token)) return "";
  return hashPublicToken(token);
}

function getTimestampMillis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getDateKeyInTimeZone(date, timeZone = CHILE_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function calculateEmissionExpiryDate(quote = {}, emissionDate = new Date()) {
  const validityDays = Number(quote.validezDias);
  if (!Number.isInteger(validityDays) || validityDays <= 0 || validityDays > 3650) {
    return "";
  }
  const issueDate = getDateKeyInTimeZone(emissionDate);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(issueDate);
  const expiry = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  );
  expiry.setUTCDate(expiry.getUTCDate() + validityDays);
  return expiry.toISOString().slice(0, 10);
}

function buildQuoteEmissionPatch({
  channel,
  FieldValue,
  now = new Date(),
  quote,
  detectedBy = "",
}) {
  const fechaVencimiento = calculateEmissionExpiryDate(quote, now);
  if (!fechaVencimiento) {
    throw new Error("La cotización no tiene una vigencia válida.");
  }
  return {
    estado: "emitida",
    canalEmision: channel,
    fechaEmision: FieldValue.serverTimestamp(),
    fechaVencimiento,
    ...(detectedBy ? { emisionDetectadaPor: detectedBy } : {}),
  };
}

function calculateQuoteExpiryDate(quote = {}) {
  const storedExpiry = safeText(quote.fechaVencimiento, 40);
  if (
    quoteOpportunityVersion(quote) > 1 &&
    /^\d{4}-\d{2}-\d{2}$/.test(storedExpiry)
  ) {
    return storedExpiry;
  }
  const emissionMillis = getTimestampMillis(quote.fechaEmision);
  if (emissionMillis > 0) {
    const fromEmission = calculateEmissionExpiryDate(
      quote,
      new Date(emissionMillis)
    );
    if (fromEmission) return fromEmission;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(storedExpiry)) return storedExpiry;
  const issueDate = safeText(quote.fecha, 40);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(issueDate);
  const validityDays = Number(quote.validezDias);
  if (!match || !Number.isInteger(validityDays) || validityDays <= 0) return "";
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  );
  date.setUTCDate(date.getUTCDate() + validityDays);
  return date.toISOString().slice(0, 10);
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    timeZoneName: "longOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const zoneName = parts.find((part) => part.type === "timeZoneName")?.value || "";
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(zoneName);
  if (!match) return 0;
  const sign = match[1] === "+" ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3])) * 60 * 1000;
}

function quoteExpiryInstant(quote = {}) {
  const expiryDate = calculateQuoteExpiryDate(quote);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiryDate);
  if (!match) return null;
  const nextLocalMidnightUtcGuess = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + 1
  );
  let result = nextLocalMidnightUtcGuess;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    result = nextLocalMidnightUtcGuess - getTimeZoneOffsetMs(
      new Date(result),
      CHILE_TIME_ZONE
    );
  }
  return new Date(result);
}

function pendingTokenExpiryInstant(quote = {}, now = new Date()) {
  return quoteExpiryInstant({
    ...quote,
    fechaVencimiento: calculateEmissionExpiryDate(quote, now),
  });
}

function effectiveQuoteExpiryMillis(quote = {}, tokenData = {}) {
  if (
    tokenData.respuestaHabilitada !== false &&
    quote.estado === "emitida" &&
    quote.fechaEmision
  ) {
    return quoteExpiryInstant(quote)?.getTime() || 0;
  }
  return getTimestampMillis(tokenData.expiraEn);
}

function publicTokenStatusForQuote(quote = {}) {
  if (quote.estado === "aceptada") return { estado: "responded", respuesta: "accepted" };
  if (quote.estado === "rechazada") return { estado: "responded", respuesta: "rejected" };
  if (quote.estado === "vencida") return { estado: "expired", respuesta: null };
  return { estado: "active", respuesta: null };
}

function sanitizePublicQuote(quote = {}, { effectiveStatus = "" } = {}) {
  const company = quote.empresaSnapshot && typeof quote.empresaSnapshot === "object"
    ? quote.empresaSnapshot
    : quote.empresa && typeof quote.empresa === "object"
      ? quote.empresa
      : {};
  const client = quote.cliente && typeof quote.cliente === "object"
    ? quote.cliente
    : quote.clienteSnapshot && typeof quote.clienteSnapshot === "object"
      ? quote.clienteSnapshot
      : {};
  const conditions = quote.condiciones && typeof quote.condiciones === "object"
    ? quote.condiciones
    : {};

  return {
    numero: safeText(quote.numero, 120),
    fecha: safeText(quote.fecha, 40),
    fechaVencimiento: calculateQuoteExpiryDate(quote),
    validezDias: Number(quote.validezDias) || null,
    estado: effectiveStatus || safeText(quote.estado, 30),
    paisCodigo: safeText(quote.paisCodigo, 10) || "CL",
    moneda: safeText(quote.moneda, 10) || "CLP",
    locale: safeText(quote.locale, 40) || "es-CL",
    impuestoNombre: safeText(quote.impuestoNombre, 60) || "IVA",
    empresa: {
      nombreComercial: safeText(company.nombreComercial, 200),
      razonSocial: safeText(company.razonSocial, 240),
      rut: safeText(company.rut || company.identificadorFiscalValor, 80),
      identificadorFiscalTipo: safeText(company.identificadorFiscalTipo, 40) || "RUT",
      identificadorFiscalValor: safeText(company.identificadorFiscalValor || company.rut, 80),
      giro: safeText(company.giro, 240),
      email: safeText(company.email, 240),
      telefono: safeText(company.telefono, 100),
      direccion: safeText(company.direccion, 300),
      ciudad: safeText(company.ciudad, 160),
      region: safeText(company.region || company.regionNombre, 160),
      sitioWeb: safeText(company.sitioWeb, 300),
      logoUrl: safePublicAssetUrl(company.logoUrl, [quote.negocioId]),
      responsable: safeText(company.responsable, 200),
    },
    cliente: {
      empresa: safeText(
        client.nombreRazonSocial || client.empresa || quote.clienteNombre,
        240
      ),
      contacto: safeText(
        client.personaContacto || client.contacto || quote.clienteContacto,
        200
      ),
      proyecto: safeText(quote.proyectoNombre || client.proyecto, 300),
    },
    clienteNombre: safeText(
      client.nombreRazonSocial || client.empresa || quote.clienteNombre,
      240
    ),
    proyectoNombre: safeText(quote.proyectoNombre || client.proyecto, 300),
    items: (Array.isArray(quote.items) ? quote.items : []).slice(0, 200).map((item) => ({
      nombre: safeText(item.nombre, 240),
      descripcionComercial: safeText(
        item.descripcionComercial || item.descripcion,
        3000
      ),
      unidad: safeText(item.unidad, 80),
      cantidad: Number(item.cantidad) || 0,
      precioUnitarioEditable: Number(
        item.precioUnitarioEditable ?? item.precioUnitario
      ) || 0,
      descuentoPorcentaje: Number(item.descuentoPorcentaje) || 0,
      descuentoLinea: Number(item.descuentoLinea) || 0,
      subtotalLinea: Number(item.subtotalLinea) || 0,
      totalLinea: Number(item.totalLinea) || 0,
    })),
    seccionesAlcance: (Array.isArray(quote.seccionesAlcance)
      ? quote.seccionesAlcance
      : []).slice(0, 50).map((section) => ({
        titulo: safeText(section.titulo, 160),
        lineas: (Array.isArray(section.lineas) ? section.lineas : [])
          .slice(0, 100)
          .map((line) => safeText(line, 2000))
          .filter(Boolean),
      })),
    condiciones: {
      plazoEntrega: safeText(conditions.plazoEntrega, 1000),
      formaPago: safeText(conditions.formaPago || quote.condicionesPago, 2000),
      alcanceGeografico: safeText(conditions.alcanceGeografico, 2000),
      garantia: safeText(conditions.garantia, 2000),
      observaciones: safeText(conditions.observaciones || quote.observaciones, 4000),
      exclusiones: safeText(conditions.exclusiones || quote.exclusiones, 4000),
      terminosAdicionales: safeText(
        conditions.terminosAdicionales || quote.terminosAdicionales,
        6000
      ),
    },
    subtotal: Number(quote.subtotal) || 0,
    descuento: Number(quote.descuento) || 0,
    descuentoItems: Number(quote.descuentoItems) || 0,
    descuentoTotal: Number(quote.descuentoTotal) || 0,
    neto: Number(quote.neto) || 0,
    afectaIva: quote.afectaIva !== false,
    tasaIva: Number(quote.tasaIva) || 0,
    iva: Number(quote.iva) || 0,
    total: Number(quote.total) || 0,
    aceptacion: { habilitada: false, texto: "" },
    respuestaCliente: safeText(quote.respuestaCliente, 30),
  };
}

function genericPublicProposalError(HttpsError) {
  return new HttpsError(
    "not-found",
    "No pudimos abrir esta propuesta. Revisa el enlace o contacta a la empresa emisora."
  );
}

function validateStoredTokenLink(tokenData, quote, tokenHash) {
  return Boolean(
    tokenData &&
      PUBLIC_TOKEN_HASH_PATTERN.test(tokenHash) &&
      safeText(tokenData.negocioId, 160) &&
      safeText(tokenData.cotizacionId, 160) &&
      quote &&
      (!quote.negocioId || quote.negocioId === tokenData.negocioId)
  );
}

async function createPublicQuoteToken({
  businessId,
  channel = "",
  db,
  FieldValue,
  HttpsError,
  Timestamp,
  now = new Date(),
  publicBaseUrl = getPublicBaseUrl(),
  quoteRef,
  requestId = "",
  responseEnabled,
  uid = "",
}) {
  const tokenMaterial = createPublicTokenMaterial();
  const tokenRef = db.collection(PUBLIC_TOKEN_COLLECTION).doc(tokenMaterial.tokenHash);
  const publicUrl = `${publicBaseUrl.replace(/\/+$/, "")}/propuesta/${tokenMaterial.rawToken}`;
  const requestRef = requestId
    ? db.collection("negocios").doc(businessId)
      .collection("quoteLifecycleRequests").doc(requestId)
    : null;
  let expiryAt;
  let resolvedPublicUrl = publicUrl;
  let resolvedTokenHash = tokenMaterial.tokenHash;
  let idempotent = false;

  await db.runTransaction(async (transaction) => {
    const [quoteSnapshot, previousRequest] = await Promise.all([
      transaction.get(quoteRef),
      requestRef ? transaction.get(requestRef) : Promise.resolve(null),
    ]);
    if (previousRequest?.exists) {
      const stored = previousRequest.data() || {};
      if (
        stored.cotizacionId !== quoteRef.id ||
        stored.accion !== `preparar_${safeText(channel, 30)}` ||
        stored.uidUsuario !== uid
      ) {
        throw new HttpsError(
          "already-exists",
          "El requestId ya fue utilizado para otra operación."
        );
      }
      resolvedPublicUrl = safeText(stored.enlacePublico, 1200);
      resolvedTokenHash = safeText(stored.tokenHash, 64);
      expiryAt = new Date(getTimestampMillis(stored.expiraEn));
      idempotent = true;
      return;
    }
    if (!quoteSnapshot.exists) throw genericPublicProposalError(HttpsError);
    const quote = quoteSnapshot.data() || {};
    if (quote.negocioId && quote.negocioId !== businessId) {
      throw new HttpsError("permission-denied", "No puedes publicar esta cotización.");
    }
    const canRespond = responseEnabled ?? ["borrador", "emitida"].includes(
      quote.estado
    );
    if (canRespond && !["borrador", "emitida"].includes(quote.estado)) {
      throw new HttpsError(
        "failed-precondition",
        "Sólo las cotizaciones pendientes o emitidas pueden compartirse."
      );
    }
    if (!canRespond && !["emitida", "aceptada", "rechazada", "vencida"].includes(
      quote.estado
    )) {
      throw new HttpsError(
        "failed-precondition",
        "La cotización no puede reenviarse desde su estado actual."
      );
    }
    expiryAt = !canRespond
      ? new Date(now.getTime() + COPY_LINK_DURATION_MS)
      : quote.estado === "borrador"
        ? pendingTokenExpiryInstant(quote, now)
        : quoteExpiryInstant(quote);
    if (!expiryAt) {
      throw new HttpsError(
        "failed-precondition",
        "La cotización no tiene una fecha de vencimiento válida."
      );
    }
    if (expiryAt.getTime() <= now.getTime()) {
      throw new HttpsError(
        "failed-precondition",
        "La cotización ya alcanzó su fecha de vencimiento."
      );
    }

    const tokenState = canRespond
      ? publicTokenStatusForQuote(quote)
      : {estado: "active", respuesta: null};
    transaction.create(tokenRef, {
      negocioId: safeText(businessId, 160),
      cotizacionId: quoteRef.id,
      canalOrigen: safeText(channel, 30),
      creadoEn: FieldValue.serverTimestamp(),
      expiraEn: Timestamp.fromDate(expiryAt),
      estado: tokenState.estado,
      respondidoEn: null,
      respuesta: tokenState.respuesta,
      respuestaHabilitada: canRespond,
      oportunidadVersion: quoteOpportunityVersion(quote),
      primeraAperturaEn: null,
      ultimaAperturaEn: null,
      aperturas: 0,
    });
    transaction.update(quoteRef, {
      tokenPublicoHash: tokenMaterial.tokenHash,
      propuestaPublicaCreadaEn: FieldValue.serverTimestamp(),
      propuestaPublicaExpiraEn: Timestamp.fromDate(expiryAt),
      ...(canRespond && quote.estado === "emitida" && quote.fechaEmision
        ? { fechaVencimiento: calculateQuoteExpiryDate(quote) }
        : {}),
      ...(channel === "whatsapp"
        ? {
            tokenWhatsappHash: tokenMaterial.tokenHash,
            whatsappPreparadoEn: FieldValue.serverTimestamp(),
          }
        : {}),
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    if (requestRef) {
      transaction.create(requestRef, {
        negocioId: businessId,
        cotizacionId: quoteRef.id,
        accion: `preparar_${safeText(channel, 30)}`,
        uidUsuario: uid,
        enlacePublico: publicUrl,
        tokenHash: tokenMaterial.tokenHash,
        expiraEn: Timestamp.fromDate(expiryAt),
        creadoEn: FieldValue.serverTimestamp(),
      });
    }
  });

  return {
    expiresAt: expiryAt,
    publicUrl: resolvedPublicUrl,
    tokenHash: resolvedTokenHash,
    idempotent,
  };
}

async function prepareQuoteWhatsAppShareHandler(request, dependencies) {
  const {
    db,
    FieldValue,
    getPublicBaseUrl: resolvePublicBaseUrl,
    HttpsError,
    requireBusinessAccess,
    Timestamp,
  } = dependencies;
  if (!request?.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  const {businessId, businessRef, uid} = await requireBusinessAccess(
    request,
    dependencies,
    {roles: SALES_WRITE_ROLES, requiresVerifiedBusiness: true}
  );
  const quoteId = safeText(request?.data?.quoteId, 160);
  const requestId = normalizeLifecycleRequestId(
    request?.data?.requestId,
    HttpsError
  );
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(quoteId)) {
    throw new HttpsError("invalid-argument", "Selecciona una cotización válida.");
  }
  const created = await createPublicQuoteToken({
    businessId,
    channel: "whatsapp",
    db,
    FieldValue,
    HttpsError,
    now: new Date(dependencies.now?.() || Date.now()),
    publicBaseUrl: resolvePublicBaseUrl(),
    quoteRef: businessRef.collection("cotizaciones").doc(quoteId),
    requestId,
    Timestamp,
    uid,
  });
  return {
    publicUrl: created.publicUrl,
    expiresAt: created.expiresAt.toISOString(),
    requestId,
  };
}

async function markQuoteEmittedManuallyHandler(request, dependencies) {
  const { FieldValue, HttpsError, requireBusinessAccess } = dependencies;
  if (!request?.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  const {businessId, businessRef, uid} = await requireBusinessAccess(
    request,
    dependencies,
    {roles: SALES_WRITE_ROLES, requiresVerifiedBusiness: true}
  );
  const quoteId = safeText(request?.data?.quoteId, 160);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(quoteId)) {
    throw new HttpsError("invalid-argument", "Selecciona una cotización válida.");
  }

  const quoteRef = businessRef.collection("cotizaciones").doc(quoteId);
  const eventRef = quoteRef.collection("eventos").doc();
  const emissionNow = new Date(dependencies.now?.() || Date.now());
  let quoteStatus = null;
  await businessRef.firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(quoteRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "No se encontró la cotización.");
    }
    const quote = snapshot.data() || {};
    if (quote.negocioId && quote.negocioId !== businessId) {
      throw new HttpsError("permission-denied", "No puedes emitir esta cotización.");
    }
    if (!["borrador", "emitida"].includes(quote.estado)) {
      throw new HttpsError(
        "failed-precondition",
        "La cotización no puede marcarse como emitida desde su estado actual."
      );
    }

    if (quote.estado === "emitida") {
      quoteStatus = {
        estado: "emitida",
        canalEmision: quote.canalEmision || "",
        fechaEmision: quote.fechaEmision || null,
        fechaVencimiento: quote.fechaVencimiento || calculateQuoteExpiryDate(quote),
      };
      return;
    }

    const hasPriorEmission = getTimestampMillis(quote.fechaEmision) > 0;
    const emissionPatch = hasPriorEmission
      ? { estado: "emitida" }
      : buildQuoteEmissionPatch({
          channel: "manual",
          detectedBy: "confirmacion_usuario",
          FieldValue,
          now: emissionNow,
          quote,
        });
    transaction.update(quoteRef, {
      ...emissionPatch,
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    transaction.create(eventRef, buildQuoteEvent({
      businessId,
      eventType: "estado_cambiado",
      FieldValue,
      medium: "manual",
      quoteId,
      requestId: `legacy-manual-${eventRef.id}`,
      resultingStatus: "emitida",
      previousStatus: quote.estado,
      uid,
    }));
    quoteStatus = {
      estado: "emitida",
      canalEmision: emissionPatch.canalEmision || quote.canalEmision || "",
      fechaEmision: hasPriorEmission ? quote.fechaEmision : emissionNow.toISOString(),
      fechaVencimiento:
        emissionPatch.fechaVencimiento ||
        safeText(quote.fechaVencimiento, 40) ||
        calculateQuoteExpiryDate(quote),
    };
  });

  return { success: true, quoteStatus };
}

async function reopenQuoteHandler(request, dependencies) {
  const {
    db,
    FieldValue,
    getPublicBaseUrl: resolvePublicBaseUrl,
    HttpsError,
    requireBusinessAccess,
    Timestamp,
  } = dependencies;
  if (!request?.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  const {businessId, businessRef, uid} = await requireBusinessAccess(
    request,
    dependencies,
    {roles: SALES_WRITE_ROLES, requiresVerifiedBusiness: true}
  );
  const quoteId = safeText(request?.data?.quoteId, 160);
  const requestId = normalizeLifecycleRequestId(
    request?.data?.requestId,
    HttpsError
  );
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(quoteId)) {
    throw new HttpsError("invalid-argument", "Selecciona una cotización válida.");
  }

  const tokenMaterial = createPublicTokenMaterial();
  const publicUrl = `${resolvePublicBaseUrl().replace(/\/+$/, "")}/propuesta/${tokenMaterial.rawToken}`;
  const quoteRef = businessRef.collection("cotizaciones").doc(quoteId);
  const requestRef = businessRef.collection("quoteLifecycleRequests").doc(requestId);
  const tokenRef = db.collection(PUBLIC_TOKEN_COLLECTION).doc(tokenMaterial.tokenHash);
  const eventRef = quoteEventRef(quoteRef, `reapertura__${requestId}`);
  const reopenNow = new Date(dependencies.now?.() || Date.now());
  let result;

  await db.runTransaction(async (transaction) => {
    const [previousRequest, quoteSnapshot] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(quoteRef),
    ]);
    if (previousRequest.exists) {
      const stored = previousRequest.data() || {};
      if (
        stored.cotizacionId !== quoteId ||
        stored.accion !== "reabrir" ||
        stored.uidUsuario !== uid
      ) {
        throw new HttpsError(
          "already-exists",
          "El requestId ya fue utilizado para otra operación."
        );
      }
      result = {...(stored.resultado || {}), idempotent: true};
      return;
    }
    if (!quoteSnapshot.exists) {
      throw new HttpsError("not-found", "No se encontró la cotización.");
    }
    const quote = quoteSnapshot.data() || {};
    if (quote.negocioId && quote.negocioId !== businessId) {
      throw new HttpsError("permission-denied", "No puedes reabrir esta cotización.");
    }
    if (!["aceptada", "rechazada", "vencida"].includes(quote.estado)) {
      throw new HttpsError(
        "failed-precondition",
        "Sólo una cotización aceptada, rechazada o vencida puede reabrirse."
      );
    }
    if (safeText(quote.ventaId, 160)) {
      throw new HttpsError(
        "failed-precondition",
        "La cotización ya originó una venta y no puede reabrirse."
      );
    }
    const previousStatus = quote.estado;
    const previousVersion = quoteOpportunityVersion(quote);
    const nextVersion = previousVersion + 1;
    const fechaVencimiento = calculateEmissionExpiryDate(quote, reopenNow);
    if (!fechaVencimiento) {
      throw new HttpsError(
        "failed-precondition",
        "La cotización no tiene una vigencia válida."
      );
    }
    const expiryAt = quoteExpiryInstant({
      ...quote,
      oportunidadVersion: nextVersion,
      fechaVencimiento,
    });

    if (quote.respuestaCliente) {
      const legacyResponseRef = quoteEventRef(
        quoteRef,
        `respuesta_legacy__${previousVersion}`
      );
      const previousResponseEvent = await transaction.get(legacyResponseRef);
      if (!previousResponseEvent.exists) {
        transaction.create(legacyResponseRef, buildQuoteEvent({
          businessId,
          eventType: "respuesta_cliente",
          FieldValue,
          medium: quote.respuestaClienteOrigen || "legacy",
          quoteId,
          requestId: `legacy-${previousVersion}`,
          resultingStatus: quote.respuestaCliente,
          previousStatus: "emitida",
          details: {
            respuesta: safeText(quote.respuestaCliente, 30),
            motivo: safeText(quote.motivoRechazoCliente, 40),
            comentario: safeText(quote.comentarioRechazoCliente, 500),
            fechaRespuesta: quote.respuestaClienteEn || null,
            oportunidadVersion: previousVersion,
            importadoDesdeLegacy: true,
          },
        }));
      }
    }

    transaction.create(tokenRef, {
      negocioId: businessId,
      cotizacionId: quoteId,
      canalOrigen: "reapertura",
      creadoEn: FieldValue.serverTimestamp(),
      expiraEn: Timestamp.fromDate(expiryAt),
      estado: "active",
      respondidoEn: null,
      respuesta: null,
      respuestaHabilitada: true,
      oportunidadVersion: nextVersion,
      primeraAperturaEn: null,
      ultimaAperturaEn: null,
      aperturas: 0,
    });
    transaction.update(quoteRef, {
      estado: "emitida",
      estadoAnterior: previousStatus,
      oportunidadVersion: nextVersion,
      fechaReapertura: FieldValue.serverTimestamp(),
      fechaVencimiento,
      reabiertaEn: FieldValue.serverTimestamp(),
      reabiertaPorUid: uid,
      tokenPublicoHash: tokenMaterial.tokenHash,
      propuestaPublicaCreadaEn: FieldValue.serverTimestamp(),
      propuestaPublicaExpiraEn: Timestamp.fromDate(expiryAt),
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    transaction.create(eventRef, buildQuoteEvent({
      businessId,
      eventType: "cotizacion_reabierta",
      FieldValue,
      medium: "manual",
      quoteId,
      requestId,
      resultingStatus: "emitida",
      previousStatus,
      uid,
      details: {
        oportunidadVersionAnterior: previousVersion,
        oportunidadVersion: nextVersion,
        fechaVencimiento,
      },
    }));
    result = {
      estado: "emitida",
      estadoAnterior: previousStatus,
      oportunidadVersion: nextVersion,
      fechaVencimiento,
      publicUrl,
      expiresAt: expiryAt.toISOString(),
      idempotent: false,
    };
    transaction.create(requestRef, {
      negocioId: businessId,
      cotizacionId: quoteId,
      accion: "reabrir",
      uidUsuario: uid,
      resultado: result,
      creadoEn: FieldValue.serverTimestamp(),
    });
  });
  return {success: true, quoteStatus: result};
}

async function confirmQuoteWhatsAppSentHandler(request, dependencies) {
  const { FieldValue, HttpsError, requireBusinessAccess, Timestamp } = dependencies;
  if (!request?.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  const { businessId, businessRef, uid } = await requireBusinessAccess(
    request,
    dependencies,
    {roles: SALES_WRITE_ROLES, requiresVerifiedBusiness: true}
  );
  const quoteId = safeText(request?.data?.quoteId, 160);
  const requestId = normalizeLifecycleRequestId(
    request?.data?.requestId,
    HttpsError
  );
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(quoteId)) {
    throw new HttpsError("invalid-argument", "Selecciona una cotización válida.");
  }
  const quoteRef = businessRef.collection("cotizaciones").doc(quoteId);
  const eventRef = quoteEventRef(quoteRef, `reenvio_whatsapp__${requestId}`);
  const confirmationNow = new Date(dependencies.now?.() || Date.now());
  let quoteStatus = null;
  await businessRef.firestore.runTransaction(async (transaction) => {
    const [snapshot, previousEvent] = await Promise.all([
      transaction.get(quoteRef),
      transaction.get(eventRef),
    ]);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "No se encontró la cotización.");
    }
    const quote = snapshot.data() || {};
    if (quote.negocioId && quote.negocioId !== businessId) {
      throw new HttpsError("permission-denied", "No puedes compartir esta cotización.");
    }
    if (!["borrador", "emitida", "aceptada", "rechazada", "vencida"].includes(
      quote.estado
    )) {
      throw new HttpsError(
        "failed-precondition",
        "La cotización ya no admite un nuevo envío."
      );
    }
    if (!quote.whatsappPreparadoEn || quote.tokenWhatsappHash === "") {
      throw new HttpsError(
        "failed-precondition",
        "Prepara el enlace público antes de registrar el envío."
      );
    }
    if (previousEvent.exists) {
      if ((previousEvent.data() || {}).uidUsuario !== uid) {
        throw new HttpsError(
          "already-exists",
          "El requestId ya fue utilizado para otro envío."
        );
      }
      quoteStatus = {
        estado: quote.estado,
        idempotent: true,
      };
      return;
    }
    const emissionPatch = quote.estado === "borrador"
      ? buildQuoteEmissionPatch({
          channel: "whatsapp",
          detectedBy: "confirmacion_usuario",
          FieldValue,
          now: confirmationNow,
          quote,
        })
      : {};
    quoteStatus = {
      estado: quote.estado === "borrador" ? "emitida" : quote.estado,
      canalEmision: emissionPatch.canalEmision || quote.canalEmision || "whatsapp",
      fechaEmision: quote.estado === "borrador"
        ? confirmationNow.toISOString()
        : quote.fechaEmision || null,
      fechaVencimiento:
        emissionPatch.fechaVencimiento || quote.fechaVencimiento || "",
    };
    transaction.update(quoteRef, {
      ...emissionPatch,
      envioWhatsappConfirmadoEn: FieldValue.serverTimestamp(),
      envioWhatsappConfirmadoPorUid: uid,
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    transaction.create(eventRef, buildQuoteEvent({
      businessId,
      eventType: quote.estado === "borrador"
        ? "cotizacion_enviada"
        : "cotizacion_reenviada",
      FieldValue,
      medium: "whatsapp",
      quoteId,
      requestId,
      resultingStatus: quoteStatus.estado,
      previousStatus: quote.estado,
      recipient: safeText(
        quote.cliente?.telefono ||
        quote.clienteSnapshot?.telefono ||
        quote.clienteTelefono ||
        quote.cliente?.email ||
        quote.clienteSnapshot?.email ||
        quote.clienteNombre ||
        "cliente de la cotización",
        100
      ),
      uid,
    }));

    const tokenHash = safeText(quote.tokenWhatsappHash, 64);
    if (PUBLIC_TOKEN_HASH_PATTERN.test(tokenHash) && emissionPatch.fechaVencimiento) {
      const tokenRef = businessRef.firestore
        .collection(PUBLIC_TOKEN_COLLECTION)
        .doc(tokenHash);
      transaction.set(tokenRef, {
        expiraEn: Timestamp.fromDate(
          quoteExpiryInstant({ fechaVencimiento: emissionPatch.fechaVencimiento })
        ),
      }, { merge: true });
    }
  });
  return {
    success: true,
    quoteStatus,
  };
}

async function getPublicQuoteProposalHandler(request, dependencies) {
  const { db, FieldValue, HttpsError, Timestamp } = dependencies;
  const tokenHash = validateAndHashPublicToken(request?.data?.token);
  if (!tokenHash) throw genericPublicProposalError(HttpsError);
  const now = new Date(dependencies.now?.() || Date.now());
  const tokenRef = db.collection(PUBLIC_TOKEN_COLLECTION).doc(tokenHash);

  const result = await db.runTransaction(async (transaction) => {
    const tokenSnapshot = await transaction.get(tokenRef);
    if (!tokenSnapshot.exists) return null;
    const tokenData = tokenSnapshot.data() || {};
    if (tokenData.estado === "revoked") return null;
    const businessId = safeText(tokenData.negocioId, 160);
    const quoteId = safeText(tokenData.cotizacionId, 160);
    if (!businessId || !quoteId) return null;
    const quoteRef = db.collection("negocios").doc(businessId)
      .collection("cotizaciones").doc(quoteId);
    const quoteSnapshot = await transaction.get(quoteRef);
    if (!quoteSnapshot.exists) return null;
    const quote = quoteSnapshot.data() || {};
    if (!validateStoredTokenLink(tokenData, quote, tokenHash)) return null;

    const expiryMillis = effectiveQuoteExpiryMillis(quote, tokenData);
    const responseEnabled = tokenData.respuestaHabilitada !== false;
    const expired =
      tokenData.estado === "expired" ||
      (
      tokenData.estado === "active" &&
      responseEnabled &&
      !quoteHasActiveResponse(quote) &&
      expiryMillis > 0 &&
      expiryMillis <= now.getTime()
      );
    const channel = safeText(tokenData.canalOrigen || tokenData.canal, 30);
    const emitsFromWhatsAppOpening =
      !expired &&
      responseEnabled &&
      tokenData.estado === "active" &&
      quote.estado === "borrador" &&
      channel === "whatsapp";
    if (emitsFromWhatsAppOpening) {
      const businessRef = db.collection("negocios").doc(businessId);
      const [businessSnapshot, taxSnapshot] = await Promise.all([
        transaction.get(businessRef),
        transaction.get(businessRef.collection("configuracion").doc("impuestos")),
      ]);
      const business = businessSnapshot.data() || {};
      assertBusinessCanOperate(
        business,
        resolveBaseTaxSettings(business, taxSnapshot.data() || {}),
        HttpsError
      );
    }
    const emissionPatch = emitsFromWhatsAppOpening
      ? buildQuoteEmissionPatch({
          channel: "whatsapp",
          detectedBy: "apertura_cliente",
          FieldValue,
          now,
          quote,
        })
      : {};
    const effectiveQuote = { ...quote, ...emissionPatch };
    let proposalQuote = effectiveQuote;
    if (!getHistoricalCompanySnapshot(effectiveQuote)) {
      const businessRef = db.collection("negocios").doc(businessId);
      const [businessSnapshot, companyProfileSnapshot] = await Promise.all([
        transaction.get(businessRef),
        transaction.get(businessRef.collection("empresa").doc("perfil")),
      ]);
      proposalQuote = {
        ...effectiveQuote,
        empresaSnapshot: buildAuthoritativeCompanySnapshot({
          businessId,
          business: businessSnapshot.data() || {},
          profile: companyProfileSnapshot.data() || {},
        }),
      };
    }
    const effectiveStatus = expired ? "vencida" : effectiveQuote.estado;
    const openingPatch = {
      ultimaAperturaEn: FieldValue.serverTimestamp(),
      aperturas: Number(tokenData.aperturas || 0) + 1,
      ...(tokenData.primeraAperturaEn
        ? {}
        : { primeraAperturaEn: FieldValue.serverTimestamp() }),
    };
    if (
      quote.estado === "emitida" &&
      expiryMillis > 0 &&
      expiryMillis !== getTimestampMillis(tokenData.expiraEn)
    ) {
      openingPatch.expiraEn = Timestamp.fromDate(new Date(expiryMillis));
    }
    if (expired && tokenData.estado === "active") {
      openingPatch.estado = "expired";
      openingPatch.expiradoEn = FieldValue.serverTimestamp();
    }
    if (emitsFromWhatsAppOpening) {
      openingPatch.expiraEn = Timestamp.fromDate(
        quoteExpiryInstant({ fechaVencimiento: emissionPatch.fechaVencimiento })
      );
    }
    transaction.set(tokenRef, openingPatch, { merge: true });

    const quotePatch = {
      ...emissionPatch,
      ultimaVistaPropuestaPublicaEn: FieldValue.serverTimestamp(),
      ...(quote.propuestaPublicaVistaEn
        ? {}
        : { propuestaPublicaVistaEn: FieldValue.serverTimestamp() }),
    };
    if (expired && quote.estado === "emitida" && !quoteHasActiveResponse(quote)) {
      Object.assign(quotePatch, {
        estado: "vencida",
        vencidaEn: FieldValue.serverTimestamp(),
        vencidaAutomaticamente: true,
        actualizadoEn: FieldValue.serverTimestamp(),
      });
      transaction.create(
        quoteEventRef(quoteRef, `vencimiento__${tokenHash}`),
        buildQuoteEvent({
          businessId,
          eventType: "estado_cambiado",
          FieldValue,
          medium: "sistema",
          quoteId,
          requestId: `token-${tokenHash}`,
          resultingStatus: "vencida",
          previousStatus: "emitida",
          details: {automatico: true},
        })
      );
    }
    if (emitsFromWhatsAppOpening) {
      transaction.create(
        quoteEventRef(quoteRef, `emision__${tokenHash}`),
        buildQuoteEvent({
          businessId,
          eventType: "estado_cambiado",
          FieldValue,
          medium: "whatsapp",
          quoteId,
          requestId: `token-${tokenHash}`,
          resultingStatus: "emitida",
          previousStatus: "borrador",
          details: {detectadoPor: "apertura_cliente"},
        })
      );
    }
    transaction.update(quoteRef, quotePatch);
    return sanitizePublicQuote(proposalQuote, { effectiveStatus });
  });

  if (!result) throw genericPublicProposalError(HttpsError);
  return { proposal: result };
}

function normalizePublicResponseInput(data, HttpsError) {
  const allowedKeys = new Set(["token", "action", "motivo", "comentario"]);
  if (Object.keys(data || {}).some((key) => !allowedKeys.has(key))) {
    throw new HttpsError("invalid-argument", "La respuesta contiene campos no permitidos.");
  }
  const action = safeText(data?.action, 20);
  if (!["accept", "reject"].includes(action)) {
    throw new HttpsError("invalid-argument", "Selecciona una respuesta válida.");
  }
  const rawComment = String(data?.comentario || "");
  if (rawComment.length > MAX_REJECTION_COMMENT_LENGTH) {
    throw new HttpsError(
      "invalid-argument",
      `El comentario no puede superar ${MAX_REJECTION_COMMENT_LENGTH} caracteres.`
    );
  }
  if (/[<>]/.test(rawComment)) {
    throw new HttpsError("invalid-argument", "El comentario debe ser texto simple.");
  }
  const reason = action === "reject"
    ? safeText(data?.motivo, 40) || "no_indica"
    : "";
  if (action === "reject" && !REJECTION_REASONS.has(reason)) {
    throw new HttpsError("invalid-argument", "Selecciona un motivo válido.");
  }
  return {
    action,
    comment: action === "reject" ? safeText(rawComment, MAX_REJECTION_COMMENT_LENGTH) : "",
    reason,
  };
}

function evaluatePublicResponse({ action, nowMs, quote, tokenData }) {
  const requestedResponse = action === "accept" ? "accepted" : "rejected";
  const requestedQuoteStatus = action === "accept" ? "aceptada" : "rechazada";
  if (tokenData.estado === "responded") {
    return tokenData.respuesta === requestedResponse
      ? { outcome: "idempotent", quoteStatus: requestedQuoteStatus }
      : { outcome: "conflict" };
  }
  if (tokenData.respuestaHabilitada === false) return { outcome: "unavailable" };
  const tokenVersion = Number(tokenData.oportunidadVersion) || 1;
  if (tokenVersion !== quoteOpportunityVersion(quote)) {
    return { outcome: "unavailable" };
  }
  if (effectiveQuoteExpiryMillis(quote, tokenData) <= nowMs) {
    return { outcome: "expired" };
  }
  if (tokenData.estado !== "active") return { outcome: "unavailable" };
  if (quote.estado === requestedQuoteStatus) {
    return { outcome: "idempotent", quoteStatus: requestedQuoteStatus };
  }
  if (["aceptada", "rechazada"].includes(quote.estado)) return { outcome: "conflict" };
  const tokenChannel = safeText(tokenData.canalOrigen || tokenData.canal, 30);
  if (quote.estado === "borrador" && tokenChannel === "whatsapp") {
    return {
      outcome: "apply",
      quoteStatus: requestedQuoteStatus,
      response: requestedResponse,
      requiresWhatsAppEmission: true,
    };
  }
  if (quote.estado !== "emitida" || quoteHasActiveResponse(quote)) {
    return { outcome: "unavailable" };
  }
  return { outcome: "apply", quoteStatus: requestedQuoteStatus, response: requestedResponse };
}

async function respondPublicQuoteProposalHandler(request, dependencies) {
  const { db, FieldValue, HttpsError, Timestamp } = dependencies;
  const input = normalizePublicResponseInput(request?.data || {}, HttpsError);
  const tokenHash = validateAndHashPublicToken(request?.data?.token);
  if (!tokenHash) throw genericPublicProposalError(HttpsError);
  const now = new Date(dependencies.now?.() || Date.now());
  const tokenRef = db.collection(PUBLIC_TOKEN_COLLECTION).doc(tokenHash);

  const result = await db.runTransaction(async (transaction) => {
    const tokenSnapshot = await transaction.get(tokenRef);
    if (!tokenSnapshot.exists) return { outcome: "invalid" };
    const tokenData = tokenSnapshot.data() || {};
    const businessId = safeText(tokenData.negocioId, 160);
    const quoteId = safeText(tokenData.cotizacionId, 160);
    if (!businessId || !quoteId || tokenData.estado === "revoked") {
      return { outcome: "invalid" };
    }
    const businessRef = db.collection("negocios").doc(businessId);
    const quoteRef = businessRef.collection("cotizaciones").doc(quoteId);
    const [quoteSnapshot, businessSnapshot, taxSnapshot] = await Promise.all([
      transaction.get(quoteRef),
      transaction.get(businessRef),
      transaction.get(businessRef.collection("configuracion").doc("impuestos")),
    ]);
    if (!quoteSnapshot.exists) return { outcome: "invalid" };
    try {
      const business = businessSnapshot.data() || {};
      assertBusinessCanOperate(
        business,
        resolveBaseTaxSettings(business, taxSnapshot.data() || {}),
        HttpsError
      );
    } catch {
      return {outcome: "business_blocked"};
    }
    const quote = quoteSnapshot.data() || {};
    if (!validateStoredTokenLink(tokenData, quote, tokenHash)) {
      return { outcome: "invalid" };
    }
    const workRef = quote.trabajoId
      ? db.collection("negocios").doc(businessId)
        .collection("trabajos").doc(safeText(quote.trabajoId, 160))
      : null;
    const workSnapshot = workRef ? await transaction.get(workRef) : null;
    if (workRef) linkedWorkFields(workSnapshot, businessId, HttpsError);

    const decision = evaluatePublicResponse({
      action: input.action,
      nowMs: now.getTime(),
      quote,
      tokenData,
    });
    if (decision.outcome === "expired") {
      transaction.set(tokenRef, {
        estado: "expired",
        expiradoEn: FieldValue.serverTimestamp(),
      }, { merge: true });
      if (quote.estado === "emitida" && !quoteHasActiveResponse(quote)) {
        transaction.update(quoteRef, {
          estado: "vencida",
          vencidaEn: FieldValue.serverTimestamp(),
          vencidaAutomaticamente: true,
          actualizadoEn: FieldValue.serverTimestamp(),
        });
        transaction.create(
          quoteEventRef(quoteRef, `vencimiento__${tokenHash}`),
          buildQuoteEvent({
            businessId,
            eventType: "estado_cambiado",
            FieldValue,
            medium: "sistema",
            quoteId,
            requestId: `token-${tokenHash}`,
            resultingStatus: "vencida",
            previousStatus: "emitida",
            details: {automatico: true},
          })
        );
      }
      return decision;
    }
    if (decision.outcome === "idempotent" && tokenData.estado === "active") {
      transaction.set(tokenRef, {
        estado: "responded",
        respuesta: decision.response ||
          (decision.quoteStatus === "aceptada" ? "accepted" : "rejected"),
        respondidoEn: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    if (decision.outcome !== "apply") {
      return {
        ...decision,
        ...(quote.ventaId ? {
          ventaId: quote.ventaId,
          ventaNumero: quote.ventaNumero || "",
        } : {}),
      };
    }

    const acceptedSale = decision.quoteStatus === "aceptada"
      ? await createConfirmedSaleFromQuoteInTransaction({
          actor: {
            nombre: quote.clienteNombre || quote.cliente?.nombreRazonSocial ||
              quote.cliente?.empresa || "Cliente",
            correo: quote.clienteEmail || quote.cliente?.email || "",
            origen: "portal_publico",
          },
          businessId,
          businessRef,
          clock: now,
          dependencies,
          quote,
          quoteId,
          transaction,
        })
      : null;

    const emissionPatch = decision.requiresWhatsAppEmission
      ? buildQuoteEmissionPatch({
          channel: "whatsapp",
          detectedBy: "apertura_cliente",
          FieldValue,
          now,
          quote,
        })
      : {};
    const quotePatch = {
      ...emissionPatch,
      ...(acceptedSale?.quotePatch || {}),
      estado: decision.quoteStatus,
      respuestaCliente: decision.quoteStatus,
      respuestaClienteEn: FieldValue.serverTimestamp(),
      respuestaClienteOrigen: "portal_publico",
      respuestaOportunidadVersion: quoteOpportunityVersion(quote),
      ...(decision.requiresWhatsAppEmission
        ? {
            ultimaVistaPropuestaPublicaEn: FieldValue.serverTimestamp(),
            ...(quote.propuestaPublicaVistaEn
              ? {}
              : { propuestaPublicaVistaEn: FieldValue.serverTimestamp() }),
          }
        : {}),
      actualizadoEn: FieldValue.serverTimestamp(),
    };
    if (input.action === "reject") {
      quotePatch.motivoRechazoCliente = input.reason;
      quotePatch.comentarioRechazoCliente = input.comment;
    } else {
      quotePatch.motivoRechazoCliente = "";
      quotePatch.comentarioRechazoCliente = "";
    }
    transaction.update(quoteRef, quotePatch);
    transaction.create(
      quoteEventRef(quoteRef, `respuesta_publica__${tokenHash}`),
      buildQuoteEvent({
        businessId,
        eventType: "respuesta_cliente",
        FieldValue,
        medium: "portal_publico",
        quoteId,
        requestId: `token-${tokenHash}`,
        resultingStatus: decision.quoteStatus,
        previousStatus: quote.estado,
        details: {
          respuesta: decision.quoteStatus,
          motivo: input.reason,
          comentario: input.comment,
          oportunidadVersion: quoteOpportunityVersion(quote),
        },
      })
    );
    if (workRef) {
      writeQuoteResponseEvent(transaction, workRef, {
        actor: {
          nombre: quote.clienteNombre || quote.cliente?.nombreRazonSocial || "Cliente",
          correo: quote.clienteEmail || quote.cliente?.email || "",
        },
        businessId,
        eventKey: tokenHash,
        quoteId,
        quoteNumber: quote.numero,
        response: decision.quoteStatus,
        detail: {
          motivo: input.reason,
          comentario: input.comment,
          oportunidadVersion: quoteOpportunityVersion(quote),
        },
        timestamp: FieldValue.serverTimestamp(),
      });
    }
    const tokenPatch = {
      estado: "responded",
      respuesta: decision.response,
      respondidoEn: FieldValue.serverTimestamp(),
      ...(decision.requiresWhatsAppEmission
        ? {
            primeraAperturaEn: tokenData.primeraAperturaEn || FieldValue.serverTimestamp(),
            ultimaAperturaEn: FieldValue.serverTimestamp(),
            aperturas: Number(tokenData.aperturas || 0) + 1,
            expiraEn: Timestamp.fromDate(
              quoteExpiryInstant({ fechaVencimiento: emissionPatch.fechaVencimiento })
            ),
          }
        : {}),
    };
    transaction.set(tokenRef, tokenPatch, { merge: true });
    return {
      ...decision,
      ...(acceptedSale ? {
        ventaId: acceptedSale.sale.id,
        ventaNumero: acceptedSale.sale.numero,
        estadoStock: acceptedSale.sale.estadoStock,
        alertasStock: acceptedSale.sale.alertasStock,
      } : {}),
    };
  });

  if (result.outcome === "invalid") throw genericPublicProposalError(HttpsError);
  if (result.outcome === "expired") {
    throw new HttpsError("failed-precondition", "Esta propuesta ha vencido.");
  }
  if (result.outcome === "conflict") {
    throw new HttpsError("failed-precondition", "La propuesta ya tiene una respuesta diferente.");
  }
  if (result.outcome === "unavailable") {
    throw new HttpsError("failed-precondition", "Esta propuesta ya no admite respuestas.");
  }
  if (result.outcome === "business_blocked") {
    throw new HttpsError(
      "failed-precondition",
      "La empresa emisora debe completar su verificación antes de registrar la respuesta."
    );
  }
  return {
    success: true,
    estado: result.quoteStatus,
    idempotent: result.outcome === "idempotent",
    ...(result.ventaId ? {
      ventaId: result.ventaId,
      ventaNumero: result.ventaNumero || "",
      estadoStock: result.estadoStock || "",
      alertasStock: result.alertasStock || [],
    } : {}),
  };
}

function evaluateExpiration({ nowMs, quote, tokenData }) {
  if (tokenData.estado !== "active") {
    return { outcome: "skip" };
  }
  if (tokenData.respuestaHabilitada === false) {
    return effectiveQuoteExpiryMillis(quote, tokenData) <= nowMs
      ? {outcome: "preserve_quote", tokenStatus: "expired", response: null}
      : {outcome: "skip"};
  }
  if ((Number(tokenData.oportunidadVersion) || 1) !== quoteOpportunityVersion(quote)) {
    return {outcome: "preserve_quote", tokenStatus: "expired", response: null};
  }
  const expiryMs = effectiveQuoteExpiryMillis(quote, tokenData);
  const storedExpiryMs = getTimestampMillis(tokenData.expiraEn);
  if (
    quote.estado === "emitida" &&
    storedExpiryMs <= nowMs &&
    expiryMs > nowMs
  ) {
    return { outcome: "reschedule", expiresAtMs: expiryMs };
  }
  if (!expiryMs || expiryMs > nowMs) return { outcome: "skip" };
  if (quote.estado === "emitida" && !quoteHasActiveResponse(quote)) {
    return { outcome: "expire_quote", tokenStatus: "expired" };
  }
  if (quote.estado === "aceptada") {
    return { outcome: "preserve_quote", tokenStatus: "responded", response: "accepted" };
  }
  if (quote.estado === "rechazada") {
    return { outcome: "preserve_quote", tokenStatus: "responded", response: "rejected" };
  }
  if (quote.estado === "borrador") {
    return { outcome: "preserve_quote", tokenStatus: "expired", response: null };
  }
  return { outcome: "preserve_quote", tokenStatus: "expired", response: null };
}

async function expireOnePublicQuoteProposal(tokenSnapshot, dependencies, now) {
  const { db, FieldValue, Timestamp } = dependencies;
  const tokenRef = tokenSnapshot.ref;
  return db.runTransaction(async (transaction) => {
    const currentTokenSnapshot = await transaction.get(tokenRef);
    if (!currentTokenSnapshot.exists) return "skip";
    const tokenData = currentTokenSnapshot.data() || {};
    const businessId = safeText(tokenData.negocioId, 160);
    const quoteId = safeText(tokenData.cotizacionId, 160);
    if (!businessId || !quoteId) {
      transaction.set(tokenRef, { estado: "revoked" }, { merge: true });
      return "revoked";
    }
    const quoteRef = db.collection("negocios").doc(businessId)
      .collection("cotizaciones").doc(quoteId);
    const quoteSnapshot = await transaction.get(quoteRef);
    if (!quoteSnapshot.exists) {
      transaction.set(tokenRef, { estado: "revoked" }, { merge: true });
      return "revoked";
    }
    const quote = quoteSnapshot.data() || {};
    if (!validateStoredTokenLink(tokenData, quote, tokenRef.id)) {
      transaction.set(tokenRef, { estado: "revoked" }, { merge: true });
      return "revoked";
    }
    const decision = evaluateExpiration({
      nowMs: now.getTime(),
      quote,
      tokenData,
    });
    if (decision.outcome === "skip") return "skip";
    if (decision.outcome === "reschedule") {
      transaction.set(tokenRef, {
        expiraEn: Timestamp.fromDate(new Date(decision.expiresAtMs)),
      }, { merge: true });
      return "reschedule";
    }
    transaction.set(tokenRef, {
      estado: decision.tokenStatus,
      respuesta: decision.response || null,
      expiradoEn: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (decision.outcome === "expire_quote") {
      transaction.update(quoteRef, {
        estado: "vencida",
        vencidaEn: FieldValue.serverTimestamp(),
        vencidaAutomaticamente: true,
        actualizadoEn: FieldValue.serverTimestamp(),
      });
      transaction.create(
        quoteEventRef(quoteRef, `vencimiento__${tokenRef.id}`),
        buildQuoteEvent({
          businessId,
          eventType: "estado_cambiado",
          FieldValue,
          medium: "sistema",
          quoteId,
          requestId: `token-${tokenRef.id}`,
          resultingStatus: "vencida",
          previousStatus: "emitida",
          details: {automatico: true},
        })
      );
    }
    return decision.outcome;
  });
}

async function expirePublicQuoteProposalsHandler(dependencies) {
  const { db } = dependencies;
  const now = new Date(dependencies.now?.() || Date.now());
  let processed = 0;
  let expired = 0;
  let preserved = 0;

  for (let batch = 0; batch < 5; batch += 1) {
    const snapshot = await db.collection(PUBLIC_TOKEN_COLLECTION)
      .where("estado", "==", "active")
      .where("expiraEn", "<=", now)
      .limit(200)
      .get();
    if (snapshot.empty) break;
    for (const tokenSnapshot of snapshot.docs) {
      const outcome = await expireOnePublicQuoteProposal(tokenSnapshot, dependencies, now);
      processed += 1;
      if (outcome === "expire_quote") expired += 1;
      if (outcome === "preserve_quote") preserved += 1;
    }
  }
  return { processed, expired, preserved };
}

module.exports = {
  MAX_REJECTION_COMMENT_LENGTH,
  PUBLIC_BASE_URL,
  PUBLIC_TOKEN_COLLECTION,
  REJECTION_REASONS,
  buildQuoteEmissionPatch,
  calculateEmissionExpiryDate,
  calculateQuoteExpiryDate,
  createPublicQuoteToken,
  createPublicTokenMaterial,
  evaluateExpiration,
  evaluatePublicResponse,
  expireOnePublicQuoteProposal,
  expirePublicQuoteProposalsHandler,
  getPublicBaseUrl,
  getPublicQuoteProposalHandler,
  hashPublicToken,
  isEmulatorEnvironment,
  markQuoteEmittedManuallyHandler,
  normalizePublicResponseInput,
  confirmQuoteWhatsAppSentHandler,
  prepareQuoteWhatsAppShareHandler,
  quoteExpiryInstant,
  reopenQuoteHandler,
  respondPublicQuoteProposalHandler,
  sanitizePublicQuote,
  validateAndHashPublicToken,
};
