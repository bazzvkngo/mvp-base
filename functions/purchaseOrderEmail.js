const {PURCHASE_WRITE_ROLES} = require("./rbac");
const SENDABLE_STATUSES = new Set(["borrador", "emitida"]);
const PURCHASE_ORDER_EMAIL_COOLDOWN_MS = 30 * 1000;
const PURCHASE_ORDER_EMAIL_LEASE_MS = 2 * 60 * 1000;

function safeText(value, maxLength = 2000) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i.test(
    normalizeEmail(value)
  );
}

function normalizeSingleRecipient(value, HttpsError) {
  if (typeof value !== "string" || value.length > 180 || /[\r\n,;]/.test(value)) {
    throw new HttpsError(
      "invalid-argument",
      "Ingresa un único correo de proveedor válido."
    );
  }
  const email = normalizeEmail(value);
  if (!isValidEmail(email)) {
    throw new HttpsError(
      "invalid-argument",
      "Ingresa un correo de proveedor válido."
    );
  }
  return email;
}

function normalizeEmailSubject(value, HttpsError) {
  if (value == null) return "";
  // eslint-disable-next-line no-control-regex
  if (typeof value !== "string" || value.length > 180 || /[\r\n\u0000-\u001f\u007f]/.test(value)) {
    throw new HttpsError("invalid-argument", "Ingresa un asunto válido de hasta 180 caracteres.");
  }
  const subject = value.trim();
  if (!subject) throw new HttpsError("invalid-argument", "Ingresa el asunto del correo.");
  return subject;
}

function normalizeEmailMessage(value, HttpsError) {
  if (value == null) return "";
  // eslint-disable-next-line no-control-regex
  if (typeof value !== "string" || value.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new HttpsError("invalid-argument", "Ingresa un mensaje válido de hasta 2000 caracteres.");
  }
  const message = value.replace(/\r\n?/g, "\n").trim();
  if (!message) throw new HttpsError("invalid-argument", "Ingresa el mensaje del correo.");
  return message;
}

function resolveCompanyReplyTo(company = {}) {
  const email = normalizeEmail(company.email);
  return typeof company.email === "string" && company.email.length <= 180 &&
    !/[\r\n,;]/.test(company.email) && isValidEmail(email)
    ? email
    : "";
}

function resolveEmailLocale(order = {}) {
  try {
    return Intl.getCanonicalLocales(String(order.locale || "es-CL"))[0] || "es-CL";
  } catch {
    return "es-CL";
  }
}

function formatEmailDate(value, locale) {
  if (!value) return "";
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : value?.toDate?.() || new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function validateStoredOrder(order, {businessId, emailProveedor, HttpsError}) {
  if (order.negocioId !== businessId) {
    throw new HttpsError("permission-denied", "No puedes enviar esta orden de compra.");
  }
  if (!SENDABLE_STATUSES.has(String(order.estado || "").toLowerCase())) {
    throw new HttpsError(
      "failed-precondition",
      "Solo las órdenes pendientes o emitidas pueden enviarse."
    );
  }
  const storedEmail = normalizeEmail(order.proveedorSnapshot?.email);
  const destinationEmail = normalizeSingleRecipient(emailProveedor, HttpsError);
  return {
    correoOriginalProveedor: isValidEmail(storedEmail) ? storedEmail : "",
    destinatarioAlternativo: !isValidEmail(storedEmail) || storedEmail !== destinationEmail,
    emailProveedorDestino: destinationEmail,
  };
}

function assertAttemptAvailable(previous, nowMs, HttpsError) {
  if (!previous) return;
  if (previous.estado === "enviando" && Number(previous.leaseUntilMs || 0) > nowMs) {
    throw new HttpsError("aborted", "Ya hay un envío de esta orden en curso.");
  }
  if (Number(previous.nextAllowedAtMs || 0) > nowMs) {
    throw new HttpsError(
      "resource-exhausted",
      "Espera unos segundos antes de volver a enviar esta orden."
    );
  }
}

async function reserveAttempt({
  businessId,
  businessRef,
  emailProveedor,
  FieldValue,
  HttpsError,
  nowMs,
  orderId,
  uid,
}) {
  const orderRef = businessRef.collection("ordenesCompra").doc(orderId);
  const attemptRef = businessRef.collection("purchaseOrderEmailAttempts").doc(orderId);
  return businessRef.firestore.runTransaction(async (transaction) => {
    const [orderSnapshot, attemptSnapshot] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(attemptRef),
    ]);
    if (!orderSnapshot.exists) {
      throw new HttpsError("not-found", "No se encontró la orden de compra.");
    }
    const order = {id: orderSnapshot.id, ...orderSnapshot.data()};
    const recipient = validateStoredOrder(order, {
      businessId,
      emailProveedor,
      HttpsError,
    });
    const previous = attemptSnapshot.exists ? attemptSnapshot.data() || {} : null;
    assertAttemptAvailable(previous, nowMs, HttpsError);
    const timestamp = FieldValue.serverTimestamp();
    transaction.set(attemptRef, {
      negocioId: businessId,
      ordenCompraId: orderId,
      estado: "enviando",
      ...recipient,
      intentos: Number(previous?.intentos || 0) + 1,
      iniciadoEn: timestamp,
      iniciadoPorUid: uid,
      leaseUntilMs: nowMs + PURCHASE_ORDER_EMAIL_LEASE_MS,
      nextAllowedAtMs: nowMs + PURCHASE_ORDER_EMAIL_COOLDOWN_MS,
    }, {merge: true});
    transaction.update(orderRef, {
      estadoEnvioCorreo: "enviando",
      ...recipient,
      fechaIntentoEnvioCorreo: timestamp,
      ultimoIntentoEnvioPorUid: uid,
      actualizadoEn: timestamp,
      actualizadoPorUid: uid,
    });
    return {attemptRef, order, orderRef, recipient};
  });
}

async function finishAttempt({attemptRef, FieldValue, nowMs, providerId = "", status}) {
  await attemptRef.set({
    estado: status,
    finalizadoEn: FieldValue.serverTimestamp(),
    leaseUntilMs: nowMs,
    nextAllowedAtMs: nowMs + PURCHASE_ORDER_EMAIL_COOLDOWN_MS,
    proveedorCorreo: status === "simulado" ? "emulator" : "resend",
    idEnvioCorreoProveedor: providerId,
  }, {merge: true});
}

async function finalizeSuccessfulSend({
  basePatch,
  businessRef,
  emailProveedor,
  FieldValue,
  HttpsError,
  orderRef,
  providerId,
  uid,
}) {
  return businessRef.firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(orderRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "No se encontró la orden de compra.");
    }
    const current = snapshot.data() || {};
    if (!SENDABLE_STATUSES.has(String(current.estado || "").toLowerCase())) {
      transaction.update(orderRef, {
        ...basePatch,
        enviadoPorCorreo: true,
        estadoEnvioCorreo: "enviado",
        proveedorCorreo: "resend",
        idEnvioCorreoProveedor: providerId,
        ultimoErrorEnvio: "",
      });
      return {emitted: false, resent: false, finalStatus: current.estado};
    }
    const timestamp = FieldValue.serverTimestamp();
    const isResend = current.estado === "emitida";
    transaction.update(orderRef, {
      ...basePatch,
      estado: "emitida",
      enviadoPorCorreo: true,
      estadoEnvioCorreo: "enviado",
      proveedorCorreo: "resend",
      idEnvioCorreoProveedor: providerId,
      ultimoErrorEnvio: "",
      cantidadEnvios: Number(current.cantidadEnvios || 0) + 1,
      ultimoEnvioEn: timestamp,
      ultimoEnvioPorUid: uid,
      ultimoCanalEnvio: "correo",
      ultimoDestinatarioEnvio: emailProveedor,
      ...(isResend ? {reenviadaEn: timestamp, reenviadaPorUid: uid} : {
        emitidaEn: timestamp,
        emitidaPorUid: uid,
        canalEmision: "correo",
        destinatarioEmision: emailProveedor,
      }),
    });
    return {emitted: !isResend, resent: isResend, finalStatus: "emitida"};
  });
}

function responseInstructionIncluded(message) {
  const normalized = String(message || "").toLocaleLowerCase("es-CL")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /responde[^.\n]{0,80}correo|confirma[^.\n]{0,80}recepcion|canal habitual/.test(normalized);
}

function buildEmailSubject({asunto = "", company, order}) {
  const companyName = company.nombreComercial || company.razonSocial || "Empresa compradora";
  return asunto || `Orden de compra ${order.numero} | ${companyName}`;
}

function buildCommercialMessage({company, mensaje = "", order}) {
  if (mensaje) return mensaje;
  const companyName = company.nombreComercial || company.razonSocial || "Empresa compradora";
  const providerName = order.proveedorSnapshot?.razonSocial || "Proveedor";
  return `Estimado/a ${providerName}:\n\nAdjuntamos la orden de compra ${order.numero} para su revisión.\n\nSaludos,\n${companyName}`;
}

function buildPlainEmail({company, mensaje = "", order}) {
  const companyName = company.nombreComercial || company.razonSocial || "Empresa compradora";
  const locale = resolveEmailLocale(order);
  const replyTo = resolveCompanyReplyTo(company);
  const commercialMessage = buildCommercialMessage({company, mensaje, order});
  const responseInstruction = replyTo
    ? "Por favor, responde a este correo para confirmar la orden, informar observaciones o indicar cualquier diferencia en cantidades, precios o fecha de entrega."
    : "Por favor, confirma la orden por el canal habitual e informa cualquier observación o diferencia en cantidades, precios o fecha de entrega.";
  return [
    companyName,
    "",
    commercialMessage,
    "",
    `Orden de compra: ${order.numero}`,
    `Total: ${Number(order.total || 0).toLocaleString(locale, {style: "currency", currency: order.moneda || "CLP", maximumFractionDigits: 0})}`,
    order.condicionesPago ? `Condiciones: ${humanPayment(order.condicionesPago)}` : "",
    order.fechaEntregaEstimada ? `Entrega estimada: ${formatEmailDate(order.fechaEntregaEstimada, locale)}` : "",
    "",
    "El detalle completo se encuentra en el PDF adjunto.",
    responseInstructionIncluded(commercialMessage) ? "" : responseInstruction,
  ].join("\n");
}

function humanPayment(value) {
  return ({
    contado: "Contado",
    transferencia: "Transferencia",
    credito: "Crédito",
    otro: "Otro",
  })[value] || value;
}

function buildHtmlEmail({company, mensaje = "", order, escapeHtml}) {
  const companyName = company.nombreComercial || company.razonSocial || "Empresa compradora";
  const locale = resolveEmailLocale(order);
  const replyTo = resolveCompanyReplyTo(company);
  const commercialMessage = buildCommercialMessage({company, mensaje, order});
  const responseInstruction = replyTo
    ? "Por favor, responde a este correo para confirmar la orden, informar observaciones o indicar cualquier diferencia en cantidades, precios o fecha de entrega."
    : "Por favor, confirma la orden por el canal habitual e informa cualquier observación o diferencia en cantidades, precios o fecha de entrega.";
  const total = Number(order.total || 0).toLocaleString(locale, {
    style: "currency",
    currency: order.moneda || "CLP",
    maximumFractionDigits: 0,
  });
  const deliveryDate = formatEmailDate(order.fechaEntregaEstimada, locale);
  return `<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#141f32"><div style="max-width:640px;margin:0 auto;padding:24px"><div style="background:#fff;border:1px solid #d3dce9;border-radius:8px;overflow:hidden"><div style="background:#07285d;color:#fff;padding:22px 24px;border-bottom:4px solid #d22430"><h1 style="font-size:22px;margin:0">${escapeHtml(companyName)}</h1><p style="margin:6px 0 0">Orden de compra</p></div><div style="padding:24px"><p style="line-height:1.6;white-space:pre-wrap">${escapeHtml(commercialMessage)}</p><div style="background:#f4f7fb;border:1px solid #d3dce9;border-radius:6px;padding:14px;margin:18px 0"><p style="margin:0 0 8px"><strong>${escapeHtml(order.numero)}</strong></p><p style="margin:0 0 6px">Total: <strong>${escapeHtml(total)}</strong></p>${order.condicionesPago ? `<p style="margin:0 0 6px">Condiciones: ${escapeHtml(humanPayment(order.condicionesPago))}</p>` : ""}${deliveryDate ? `<p style="margin:0">Entrega estimada: ${escapeHtml(deliveryDate)}</p>` : ""}</div><p>El detalle completo se encuentra en el PDF adjunto.</p>${responseInstructionIncluded(commercialMessage) ? "" : `<p>${escapeHtml(responseInstruction)}</p>`}<p style="color:#4f5d75;margin-top:24px">Este correo fue generado desde ValoraCloud.</p></div></div></div></body></html>`;
}

async function sendPurchaseOrderEmailHandler(request, dependencies) {
  const {
    escapeHtml,
    FieldValue,
    getCompanyProfile,
    getEmailSender,
    getResendApiKey,
    HttpsError,
    isEmulatorEnvironment,
    normalizePdfAttachment,
    requireBusinessAccess,
    sendEmailWithProvider,
  } = dependencies;
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  const {businessId, businessRef, uid} = await requireBusinessAccess(
    request,
    dependencies,
    {roles: PURCHASE_WRITE_ROLES, requiresVerifiedBusiness: true}
  );
  const orderId = safeText(request.data?.ordenCompraId, 160);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(orderId)) {
    throw new HttpsError("invalid-argument", "La orden de compra no es válida.");
  }
  const emailProveedor = normalizeSingleRecipient(
    request.data?.emailProveedor,
    HttpsError
  );
  const requestedSubject = normalizeEmailSubject(request.data?.asunto, HttpsError);
  const requestedMessage = normalizeEmailMessage(request.data?.mensaje, HttpsError);
  const pdfAttachment = normalizePdfAttachment(request.data);
  if (!pdfAttachment) {
    throw new HttpsError("invalid-argument", "El PDF adjunto es obligatorio.");
  }
  const nowMs = dependencies.now?.() || Date.now();
  const reservation = await (dependencies.reserveAttempt || reserveAttempt)({
    businessId,
    businessRef,
    emailProveedor,
    FieldValue,
    HttpsError,
    nowMs,
    orderId,
    uid,
  });
  const company = await getCompanyProfile(businessRef, reservation.order);
  const replyTo = resolveCompanyReplyTo(company);
  const subject = buildEmailSubject({asunto: requestedSubject, company, order: reservation.order});
  const html = buildHtmlEmail({company, mensaje: requestedMessage, order: reservation.order, escapeHtml});
  const text = buildPlainEmail({company, mensaje: requestedMessage, order: reservation.order});
  const basePatch = {
    ...reservation.recipient,
    fechaEnvioCorreo: FieldValue.serverTimestamp(),
    archivoAdjuntoCorreo: pdfAttachment.filename,
    actualizadoEn: FieldValue.serverTimestamp(),
    actualizadoPorUid: uid,
  };
  if (isEmulatorEnvironment()) {
    await reservation.orderRef.update({
      ...basePatch,
      enviadoPorCorreo: false,
      estadoEnvioCorreo: "simulado",
      proveedorCorreo: "emulator",
      ultimoErrorEnvio: "",
    });
    await finishAttempt({attemptRef: reservation.attemptRef, FieldValue, nowMs, status: "simulado"});
    return {success: true, simulated: true, provider: "emulator"};
  }
  const apiKey = getResendApiKey();
  const from = getEmailSender();
  const safeError = "No fue posible enviar la orden de compra. Intenta nuevamente más tarde.";
  if (!apiKey || !from) {
    await reservation.orderRef.update({...basePatch, enviadoPorCorreo: false, estadoEnvioCorreo: "error", proveedorCorreo: "resend", ultimoErrorEnvio: safeError});
    await finishAttempt({attemptRef: reservation.attemptRef, FieldValue, nowMs, status: "error"});
    return {success: false, provider: "resend", error: safeError};
  }
  try {
    const providerResponse = await sendEmailWithProvider({
      apiKey,
      from,
      to: emailProveedor,
      subject,
      html,
      text,
      attachments: [pdfAttachment],
      ...(replyTo ? {replyTo} : {}),
    });
    const providerId = safeText(providerResponse.id, 120);
    const finalization = await (
      dependencies.finalizeSuccessfulSend || finalizeSuccessfulSend
    )({
      basePatch,
      businessRef,
      emailProveedor,
      FieldValue,
      HttpsError,
      orderRef: reservation.orderRef,
      providerId,
      uid,
    });
    try {
      await finishAttempt({attemptRef: reservation.attemptRef, FieldValue, nowMs, providerId, status: "enviado"});
    } catch (trackingError) {
      console.error("sendPurchaseOrderEmail: no se pudo cerrar la traza.", {
        message: trackingError.message,
        name: trackingError.name,
      });
    }
    return {success: true, provider: "resend", replyToConfigured: Boolean(replyTo), ...finalization};
  } catch (error) {
    console.error("sendPurchaseOrderEmail: proveedor falló.", {message: error.message, name: error.name});
    await reservation.orderRef.update({...basePatch, enviadoPorCorreo: false, estadoEnvioCorreo: "error", proveedorCorreo: "resend", ultimoErrorEnvio: safeError});
    await finishAttempt({attemptRef: reservation.attemptRef, FieldValue, nowMs, status: "error"});
    return {success: false, provider: "resend", error: safeError};
  }
}

module.exports = {
  PURCHASE_ORDER_EMAIL_COOLDOWN_MS,
  PURCHASE_ORDER_EMAIL_LEASE_MS,
  assertAttemptAvailable,
  buildEmailSubject,
  buildHtmlEmail,
  buildPlainEmail,
  finalizeSuccessfulSend,
  normalizeSingleRecipient,
  normalizeEmailMessage,
  normalizeEmailSubject,
  resolveCompanyReplyTo,
  sendPurchaseOrderEmailHandler,
  validateStoredOrder,
};
