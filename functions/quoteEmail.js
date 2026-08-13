const SENDABLE_QUOTE_STATUSES = new Set([
  "borrador",
  "emitida",
]);
const QUOTE_EMAIL_COOLDOWN_MS = 30 * 1000;
const QUOTE_EMAIL_LEASE_MS = 2 * 60 * 1000;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i.test(
    normalizeEmail(value)
  );
}

function normalizeSingleRecipient(value, HttpsError) {
  if (
    typeof value !== "string" ||
    value.length > 180 ||
    /[\r\n,;]/.test(value)
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Ingresa un único correo de cliente válido."
    );
  }

  const email = normalizeEmail(value);
  if (!isValidEmail(email)) {
    throw new HttpsError(
      "invalid-argument",
      "Ingresa un correo de cliente válido."
    );
  }

  return email;
}

function getStoredQuoteClientEmail(quote = {}) {
  return normalizeEmail(
    quote.cliente?.email ||
      quote.clienteSnapshot?.email ||
      quote.clienteEmail
  );
}

function validateStoredQuoteForEmail(
  quote,
  { businessId, emailCliente, HttpsError }
) {
  if (quote.negocioId && quote.negocioId !== businessId) {
    throw new HttpsError(
      "permission-denied",
      "No puedes enviar esta cotización."
    );
  }

  if (!SENDABLE_QUOTE_STATUSES.has(String(quote.estado || "").toLowerCase())) {
    throw new HttpsError(
      "failed-precondition",
      "Sólo las cotizaciones pendientes o emitidas pueden enviarse."
    );
  }

  const storedEmail = getStoredQuoteClientEmail(quote);
  const destinationEmail = normalizeSingleRecipient(emailCliente, HttpsError);

  return {
    correoOriginalCliente: isValidEmail(storedEmail) ? storedEmail : "",
    destinatarioAlternativo:
      !isValidEmail(storedEmail) || storedEmail !== destinationEmail,
    emailClienteDestino: destinationEmail,
  };
}

function assertQuoteEmailAttemptAvailable(
  previousAttempt,
  nowMs,
  HttpsError
) {
  if (!previousAttempt) return;

  const leaseUntilMs = Number(previousAttempt.leaseUntilMs || 0);
  const nextAllowedAtMs = Number(previousAttempt.nextAllowedAtMs || 0);
  if (
    previousAttempt.estado === "enviando" &&
    leaseUntilMs > nowMs
  ) {
    throw new HttpsError(
      "aborted",
      "Ya hay un envío de esta cotización en curso."
    );
  }
  if (nextAllowedAtMs > nowMs) {
    throw new HttpsError(
      "resource-exhausted",
      "Espera unos segundos antes de volver a enviar esta cotización."
    );
  }
}

async function reserveQuoteEmailAttempt({
  businessId,
  businessRef,
  emailCliente,
  FieldValue,
  HttpsError,
  nowMs,
  quoteId,
  uid,
}) {
  const quoteRef = businessRef.collection("cotizaciones").doc(quoteId);
  const attemptRef = businessRef
    .collection("enviosCotizaciones")
    .doc(quoteId);

  const reservation = await businessRef.firestore.runTransaction(
    async (transaction) => {
      const [quoteSnapshot, attemptSnapshot] = await Promise.all([
        transaction.get(quoteRef),
        transaction.get(attemptRef),
      ]);
      if (!quoteSnapshot.exists) {
        throw new HttpsError("not-found", "No se encontró la cotización.");
      }

      const storedQuote = {
        id: quoteSnapshot.id,
        ...quoteSnapshot.data(),
      };
      const recipient = validateStoredQuoteForEmail(storedQuote, {
        businessId,
        emailCliente,
        HttpsError,
      });
      const previousAttempt = attemptSnapshot.exists
        ? attemptSnapshot.data() || {}
        : null;
      assertQuoteEmailAttemptAvailable(previousAttempt, nowMs, HttpsError);

      transaction.set(
        attemptRef,
        {
          negocioId: businessId,
          cotizacionId: quoteId,
          estado: "enviando",
          correoOriginalCliente: recipient.correoOriginalCliente,
          destinatarioAlternativo: recipient.destinatarioAlternativo,
          emailClienteDestino: recipient.emailClienteDestino,
          intentos: Number(previousAttempt?.intentos || 0) + 1,
          iniciadoEn: FieldValue.serverTimestamp(),
          iniciadoPorUid: uid,
          leaseUntilMs: nowMs + QUOTE_EMAIL_LEASE_MS,
          nextAllowedAtMs: nowMs + QUOTE_EMAIL_COOLDOWN_MS,
        },
        { merge: true }
      );
      transaction.update(quoteRef, {
        estadoEnvioCorreo: "enviando",
        correoOriginalCliente: recipient.correoOriginalCliente,
        destinatarioAlternativo: recipient.destinatarioAlternativo,
        emailClienteDestino: recipient.emailClienteDestino,
        fechaIntentoEnvioCorreo: FieldValue.serverTimestamp(),
        ultimoIntentoEnvioPorUid: uid,
        actualizadoEn: FieldValue.serverTimestamp(),
      });

      return { quote: storedQuote, recipient };
    }
  );

  return {
    attemptRef,
    quote: reservation.quote,
    quoteRef,
    recipient: reservation.recipient,
  };
}

async function finishQuoteEmailAttempt({
  attemptRef,
  errorCode = "",
  FieldValue,
  nowMs,
  provider = "resend",
  providerId = "",
  status,
}) {
  await attemptRef.set(
    {
      estado: status,
      finalizadoEn: FieldValue.serverTimestamp(),
      leaseUntilMs: nowMs,
      nextAllowedAtMs: nowMs + QUOTE_EMAIL_COOLDOWN_MS,
      proveedorCorreo: provider,
      idEnvioCorreoProveedor: providerId,
      ultimoCodigoError: errorCode,
    },
    { merge: true }
  );
}

async function sendQuoteEmailHandler(request, dependencies) {
  const {
    buildQuoteEmissionPatch,
    buildPlainQuoteEmail,
    buildQuoteEmailHtml,
    createPublicQuoteToken,
    FieldValue,
    getCompanyProfileForQuote,
    getPublicBaseUrl,
    getQuoteEmailSender,
    getResendApiKey,
    HttpsError,
    isEmulatorEnvironment,
    normalizePdfAttachment,
    requireBusinessAccess,
    safeText,
    sendQuoteEmailWithProvider,
    Timestamp,
  } = dependencies;

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }

  const { businessId, businessRef, uid } = await requireBusinessAccess(
    request,
    dependencies,
    { roles: ["OWNER", "ADMIN"] }
  );
  const data = request.data || {};
  const rawEmailCliente =
    data.emailCliente ?? data.emailClienteDestino ?? "";
  const rawAsunto = String(data.asunto || "");
  const rawMensaje = String(data.mensaje || "");
  const quoteId = safeText(data.quoteId, 100);
  const emailCliente = normalizeSingleRecipient(rawEmailCliente, HttpsError);
  const asunto = safeText(rawAsunto, 180);
  const mensaje = safeText(rawMensaje, 2000);

  if (!quoteId) {
    throw new HttpsError("invalid-argument", "quoteId es requerido.");
  }
  if (!asunto) {
    throw new HttpsError("invalid-argument", "El asunto es obligatorio.");
  }
  if (rawAsunto.length > 180) {
    throw new HttpsError(
      "invalid-argument",
      "El asunto debe tener 180 caracteres o menos."
    );
  }
  if (/[\r\n]/.test(asunto)) {
    throw new HttpsError(
      "invalid-argument",
      "El asunto no puede contener saltos de línea."
    );
  }
  if (!mensaje) {
    throw new HttpsError("invalid-argument", "El mensaje es obligatorio.");
  }
  if (rawMensaje.length > 2000) {
    throw new HttpsError(
      "invalid-argument",
      "El mensaje debe tener 2000 caracteres o menos."
    );
  }

  const pdfAttachment = normalizePdfAttachment(data);
  if (!pdfAttachment) {
    throw new HttpsError("invalid-argument", "El PDF adjunto es obligatorio.");
  }

  const attemptedAt = new Date(dependencies.now?.() || Date.now());
  const reservation = await (
    dependencies.reserveQuoteEmailAttempt || reserveQuoteEmailAttempt
  )({
    businessId,
    businessRef,
    emailCliente,
    FieldValue,
    HttpsError,
    nowMs: attemptedAt.getTime(),
    quoteId,
    uid,
  });
  const { attemptRef, quoteRef } = reservation;
  const recipient =
    reservation.recipient ||
    validateStoredQuoteForEmail(reservation.quote, {
      businessId,
      emailCliente,
      HttpsError,
    });
  let publicToken;
  let quote;
  try {
    quote = {
      ...reservation.quote,
      empresa: await getCompanyProfileForQuote(
        businessRef,
        reservation.quote
      ),
    };
    publicToken = await createPublicQuoteToken({
      businessId,
      channel: "correo",
      db: dependencies.db,
      FieldValue,
      HttpsError,
      now: attemptedAt,
      publicBaseUrl: getPublicBaseUrl(),
      quoteRef,
      Timestamp,
    });
  } catch (error) {
    await quoteRef.update({
      estadoEnvioCorreo: "error",
      ultimoErrorEnvio: "No fue posible preparar el enlace seguro de la propuesta.",
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    await finishQuoteEmailAttempt({
      attemptRef,
      errorCode: "public_token",
      FieldValue,
      nowMs: dependencies.now?.() || Date.now(),
      status: "error",
    });
    throw error;
  }
  const html = buildQuoteEmailHtml({
    quote,
    asunto,
    mensaje,
    proposalUrl: publicToken.publicUrl,
  });
  const text = buildPlainQuoteEmail({
    quote,
    asunto,
    mensaje,
    proposalUrl: publicToken.publicUrl,
  });
  const apiKey = getResendApiKey();
  const from = getQuoteEmailSender();
  const baseEmailPatch = {
    correoOriginalCliente: recipient.correoOriginalCliente,
    destinatarioAlternativo: recipient.destinatarioAlternativo,
    emailClienteDestino: emailCliente,
    fechaEnvioCorreo: FieldValue.serverTimestamp(),
    asuntoCorreo: asunto,
    mensajeCorreo: mensaje,
    archivoAdjuntoCorreo: pdfAttachment.filename,
    actualizadoEn: FieldValue.serverTimestamp(),
  };
  const safeProviderError =
    "No fue posible enviar la cotización. Intenta nuevamente más tarde.";
  const emissionPatch = quote.estado === "borrador"
    ? buildQuoteEmissionPatch({
        channel: "correo",
        FieldValue,
        now: attemptedAt,
        quote,
      })
    : { estado: "emitida" };

  if (isEmulatorEnvironment()) {
    const patch = {
      ...baseEmailPatch,
      enviadoPorCorreo: false,
      estadoEnvioCorreo: "simulado",
      proveedorCorreo: "emulator",
      ultimoErrorEnvio: "",
    };
    await quoteRef.update(patch);
    await finishQuoteEmailAttempt({
      attemptRef,
      FieldValue,
      nowMs: dependencies.now?.() || Date.now(),
      provider: "emulator",
      status: "simulado",
    });
    return {
      success: true,
      simulated: true,
      provider: "emulator",
      qaPublicUrl: publicToken.publicUrl,
      quoteEmailStatus: {
        correoOriginalCliente: recipient.correoOriginalCliente,
        destinatarioAlternativo: recipient.destinatarioAlternativo,
        emailClienteDestino: emailCliente,
        asuntoCorreo: asunto,
        mensajeCorreo: mensaje,
        archivoAdjuntoCorreo: pdfAttachment.filename,
        enviadoPorCorreo: false,
        estadoEnvioCorreo: "simulado",
        proveedorCorreo: "emulator",
        ultimoErrorEnvio: "",
        fechaEnvioCorreo: attemptedAt.toISOString(),
      },
    };
  }

  if (!apiKey || !from) {
    const patch = {
      ...baseEmailPatch,
      enviadoPorCorreo: false,
      estadoEnvioCorreo: "error",
      proveedorCorreo: "resend",
      ultimoErrorEnvio: safeProviderError,
    };
    await quoteRef.update(patch);
    await finishQuoteEmailAttempt({
      attemptRef,
      errorCode: "configuration",
      FieldValue,
      nowMs: dependencies.now?.() || Date.now(),
      status: "error",
    });
    return {
      success: false,
      provider: "resend",
      error: safeProviderError,
      quoteEmailStatus: {
        correoOriginalCliente: recipient.correoOriginalCliente,
        destinatarioAlternativo: recipient.destinatarioAlternativo,
        emailClienteDestino: emailCliente,
        asuntoCorreo: asunto,
        mensajeCorreo: mensaje,
        archivoAdjuntoCorreo: pdfAttachment.filename,
        enviadoPorCorreo: false,
        estadoEnvioCorreo: "error",
        proveedorCorreo: "resend",
        ultimoErrorEnvio: safeProviderError,
        fechaEnvioCorreo: attemptedAt.toISOString(),
      },
    };
  }

  try {
    const providerResponse = await sendQuoteEmailWithProvider({
      apiKey,
      from,
      to: emailCliente,
      subject: asunto,
      html,
      text,
      attachments: [pdfAttachment],
    });
    const providerId = safeText(providerResponse.id, 120);
    const patch = {
      ...baseEmailPatch,
      ...emissionPatch,
      enviadoPorCorreo: true,
      estadoEnvioCorreo: "enviado",
      ultimoErrorEnvio: "",
      proveedorCorreo: "resend",
      idEnvioCorreoProveedor: providerId,
    };
    await quoteRef.update(patch);
    await finishQuoteEmailAttempt({
      attemptRef,
      FieldValue,
      nowMs: dependencies.now?.() || Date.now(),
      providerId,
      status: "enviado",
    });
    return {
      success: true,
      provider: "resend",
      quoteEmailStatus: {
        estado: "emitida",
        ...(quote.estado === "borrador"
          ? {
              canalEmision: "correo",
              fechaEmision: attemptedAt.toISOString(),
              fechaVencimiento: emissionPatch.fechaVencimiento,
            }
          : {}),
        correoOriginalCliente: recipient.correoOriginalCliente,
        destinatarioAlternativo: recipient.destinatarioAlternativo,
        emailClienteDestino: emailCliente,
        asuntoCorreo: asunto,
        mensajeCorreo: mensaje,
        archivoAdjuntoCorreo: pdfAttachment.filename,
        enviadoPorCorreo: true,
        estadoEnvioCorreo: "enviado",
        proveedorCorreo: "resend",
        ultimoErrorEnvio: "",
        idEnvioCorreoProveedor: providerId,
        fechaEnvioCorreo: attemptedAt.toISOString(),
      },
    };
  } catch (error) {
    console.error("sendQuoteEmail: proveedor falló.", {
      message: error.message,
      name: error.name,
    });
    const patch = {
      ...baseEmailPatch,
      enviadoPorCorreo: false,
      estadoEnvioCorreo: "error",
      ultimoErrorEnvio: safeProviderError,
      proveedorCorreo: "resend",
    };
    await quoteRef.update(patch);
    await finishQuoteEmailAttempt({
      attemptRef,
      errorCode: "provider",
      FieldValue,
      nowMs: dependencies.now?.() || Date.now(),
      status: "error",
    });
    return {
      success: false,
      provider: "resend",
      error: safeProviderError,
      quoteEmailStatus: {
        correoOriginalCliente: recipient.correoOriginalCliente,
        destinatarioAlternativo: recipient.destinatarioAlternativo,
        emailClienteDestino: emailCliente,
        asuntoCorreo: asunto,
        mensajeCorreo: mensaje,
        archivoAdjuntoCorreo: pdfAttachment.filename,
        enviadoPorCorreo: false,
        estadoEnvioCorreo: "error",
        proveedorCorreo: "resend",
        ultimoErrorEnvio: safeProviderError,
        fechaEnvioCorreo: attemptedAt.toISOString(),
      },
    };
  }
}

module.exports = {
  QUOTE_EMAIL_COOLDOWN_MS,
  assertQuoteEmailAttemptAvailable,
  getStoredQuoteClientEmail,
  normalizeSingleRecipient,
  sendQuoteEmailHandler,
  validateStoredQuoteForEmail,
};
