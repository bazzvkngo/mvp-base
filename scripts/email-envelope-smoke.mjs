import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  buildQuoteReplyLine,
  buildSenderDisplayName,
  normalizeReplyAddress as clientNormalizeReplyAddress,
  resolveCopyPreview,
  resolveReplyToHint,
  resolveReplyToPreview,
  sanitizeSenderName as clientSanitizeSenderName,
} from "../src/domain/emailReplyTo.mjs";

const require = createRequire(import.meta.url);
const {
  buildDeliveryEnvelope,
  buildSenderFrom,
  extractSenderAddress,
  normalizeReplyAddress,
  resolveAccountEmail,
  resolveCopyRecipient,
  resolveReplyTo,
  sanitizeSenderName,
} = require("../functions/emailEnvelope.js");

const CONFIGURED = "ValoraCloud - Bagner <cotizaciones@cotizaciones.bagner.cl>";

// From: nombre comercial saneado + dirección del dominio de envío sin cambios.
assert.equal(
  buildSenderFrom({ configuredFrom: CONFIGURED, businessName: "Bagner" }),
  '"Bagner (vía ValoraCloud)" <cotizaciones@cotizaciones.bagner.cl>'
);
assert.equal(
  buildSenderFrom({
    configuredFrom: "cotizaciones@cotizaciones.bagner.cl",
    businessName: "Bagner",
  }),
  '"Bagner (vía ValoraCloud)" <cotizaciones@cotizaciones.bagner.cl>'
);
assert.equal(
  buildSenderFrom({ configuredFrom: CONFIGURED, businessName: "" }),
  '"ValoraCloud (vía ValoraCloud)" <cotizaciones@cotizaciones.bagner.cl>'
);

// Nombre con caracteres raros: sin saltos de línea, comillas ni ángulos.
assert.equal(
  sanitizeSenderName('Taller "El Rápido"\r\nBcc: x@y.cl <a@b.cl>'),
  "Taller El Rápido Bcc: x@y.cl a@b.cl"
);
assert.equal(sanitizeSenderName("Ñandú\\ “Ltda.” «Sur»"), "Ñandú Ltda. Sur");
assert.equal(sanitizeSenderName("a\u0000b c"), "a b c");
assert.equal(sanitizeSenderName("x".repeat(200)).length, 60);
{
  const from = buildSenderFrom({
    configuredFrom: CONFIGURED,
    businessName: 'Evil"\r\nBcc: atacante@x.cl\n<atacante@x.cl>',
  });
  assert.doesNotMatch(from, /[\r\n]/);
  assert.equal(from.match(/"/g).length, 2, "solo las comillas que agrega el armado");
  assert.equal(from.match(/</g).length, 1);
  assert.ok(from.endsWith("<cotizaciones@cotizaciones.bagner.cl>"));
}
// Un From configurado sin dirección válida no se reescribe.
assert.equal(
  buildSenderFrom({ configuredFrom: "no es un correo", businessName: "Bagner" }),
  "no es un correo"
);
assert.equal(buildSenderFrom({ configuredFrom: "", businessName: "Bagner" }), "");
assert.equal(extractSenderAddress("A <b@c.cl>\r\nBcc: x@y.cl"), "");

// Reply-To: contacto de la empresa, luego cuenta de quien envía, luego nada.
assert.deepEqual(
  resolveReplyTo({ companyEmail: " Contacto@Bagner.CL ", accountEmail: "yo@x.cl" }),
  { replyTo: "contacto@bagner.cl", source: "empresa" }
);
assert.deepEqual(
  resolveReplyTo({ companyEmail: "", accountEmail: "Yo@X.cl" }),
  { replyTo: "yo@x.cl", source: "cuenta" }
);
assert.deepEqual(
  resolveReplyTo({ companyEmail: "no-es-correo", accountEmail: "yo@x.cl" }),
  { replyTo: "yo@x.cl", source: "cuenta" }
);
assert.deepEqual(resolveReplyTo({ companyEmail: "mal", accountEmail: "peor" }), {
  replyTo: "",
  source: "",
});
assert.deepEqual(resolveReplyTo(), { replyTo: "", source: "" });
for (const invalid of [
  "a@b.cl,c@d.cl",
  "a@b.cl;c@d.cl",
  "a@b.cl\nBcc: x@y.cl",
  "Nombre <a@b.cl>",
  '"a"@b.cl',
  "a b@c.cl",
  "a@b",
  `${"a".repeat(200)}@b.cl`,
  ["a@b.cl"],
  null,
  undefined,
  42,
]) {
  assert.equal(normalizeReplyAddress(invalid), "", String(invalid));
  assert.equal(clientNormalizeReplyAddress(invalid), "", String(invalid));
}

// El correo de la cuenta solo cuenta si el token lo declara verificado.
assert.equal(resolveAccountEmail({ email: "Yo@X.cl", email_verified: true }), "yo@x.cl");
assert.equal(resolveAccountEmail({ email: "yo@x.cl", email_verified: false }), "");
assert.equal(resolveAccountEmail({ email: "yo@x.cl" }), "");
assert.equal(resolveAccountEmail({ email: "mal", email_verified: true }), "");
assert.equal(resolveAccountEmail(undefined), "");
assert.equal(resolveAccountEmail(null), "");

// Copia oculta: solo si se pide, solo a la cuenta verificada, nunca duplicada.
assert.deepEqual(
  resolveCopyRecipient({ sendCopy: true, accountEmail: "yo@x.cl", to: "c@d.cl" }),
  ["yo@x.cl"]
);
assert.deepEqual(
  resolveCopyRecipient({ sendCopy: false, accountEmail: "yo@x.cl", to: "c@d.cl" }),
  []
);
assert.deepEqual(
  resolveCopyRecipient({ sendCopy: "true", accountEmail: "yo@x.cl", to: "c@d.cl" }),
  []
);
assert.deepEqual(
  resolveCopyRecipient({ sendCopy: true, accountEmail: "", to: "c@d.cl" }),
  []
);
assert.deepEqual(
  resolveCopyRecipient({ sendCopy: true, accountEmail: "yo@x.cl", to: "Yo@X.cl" }),
  []
);

// Armado completo.
{
  const envelope = buildDeliveryEnvelope({
    accountEmail: "yo@x.cl",
    businessName: "Bagner",
    companyEmail: "contacto@bagner.cl",
    configuredFrom: CONFIGURED,
    sendCopy: true,
    to: "cliente@c.cl",
  });
  assert.deepEqual(envelope, {
    from: '"Bagner (vía ValoraCloud)" <cotizaciones@cotizaciones.bagner.cl>',
    replyTo: "contacto@bagner.cl",
    replyToSource: "empresa",
    bcc: ["yo@x.cl"],
  });
}
{
  const envelope = buildDeliveryEnvelope({
    businessName: "Bagner",
    companyEmail: "",
    configuredFrom: CONFIGURED,
    to: "cliente@c.cl",
  });
  assert.equal(envelope.replyTo, "");
  assert.equal("bcc" in envelope, false);
}

// Texto del correo (cliente): la frase solo aparece con Reply-To válido.
assert.equal(
  resolveReplyToHint({ companyEmail: "contacto@bagner.cl", accountEmail: "" }),
  "contacto@bagner.cl"
);
assert.equal(
  resolveReplyToHint({ companyEmail: "mal", accountEmail: "yo@x.cl" }),
  "yo@x.cl"
);
assert.equal(resolveReplyToHint({ companyEmail: "mal", accountEmail: "" }), "");
assert.match(buildQuoteReplyLine(true), /responde a este correo/);
assert.doesNotMatch(buildQuoteReplyLine(false), /responde a este correo/);
// Sin Reply-To no se agrega una segunda frase del enlace (era el texto duplicado).
assert.equal(buildQuoteReplyLine(false), "");

// Paridad: lo que el panel muestra como remitente, Reply-To y copia sale de las
// mismas reglas que arma el servidor, para cualquier combinación de entradas.
{
  const names = [
    "Bagner",
    "",
    undefined,
    null,
    "  Comercial   Andina  SpA ",
    'Taller "El Rápido"\r\nBcc: x@y.cl <a@b.cl>',
    "Ñandú\\ “Ltda.” «Sur»",
    "a\u0000b c\u0085d",
    "x".repeat(200),
    `${"y".repeat(59)}   z`,
    '<>"',
    "   ",
    12345,
  ];
  for (const name of names) {
    assert.equal(clientSanitizeSenderName(name), sanitizeSenderName(name), String(name));
    const serverFrom = buildSenderFrom({ configuredFrom: CONFIGURED, businessName: name });
    const serverDisplay = serverFrom.match(/^"(.*)" <[^<>]+>$/)?.[1];
    assert.equal(buildSenderDisplayName(name), serverDisplay, String(name));
  }

  const emails = [
    "contacto@bagner.cl",
    " Contacto@Bagner.CL ",
    "",
    undefined,
    null,
    "mal",
    "a@b.cl,c@d.cl",
    "a@b.cl\nBcc: x@y.cl",
    "Nombre <a@b.cl>",
    `${"a".repeat(200)}@b.cl`,
    ["a@b.cl"],
    "yo@x.cl",
  ];
  for (const companyEmail of emails) {
    for (const accountEmail of emails) {
      const server = resolveReplyTo({ companyEmail, accountEmail });
      const client = resolveReplyToPreview({ companyEmail, accountEmail });
      assert.deepEqual(client, server, `${companyEmail} | ${accountEmail}`);
      assert.equal(resolveReplyToHint({ companyEmail, accountEmail }), server.replyTo);
    }
  }
  for (const sendCopy of [true, false, "true", 1, undefined]) {
    for (const accountEmail of ["yo@x.cl", "Yo@X.cl", "", "mal", undefined]) {
      for (const to of ["c@d.cl", "yo@x.cl", "YO@X.CL", "", undefined]) {
        const server = resolveCopyRecipient({ sendCopy, accountEmail, to })[0] || "";
        assert.equal(
          resolveCopyPreview({ sendCopy, accountEmail, to }),
          server,
          `${sendCopy} | ${accountEmail} | ${to}`
        );
      }
    }
  }

  // El envelope completo coincide con lo que muestra el panel.
  const envelope = buildDeliveryEnvelope({
    accountEmail: "yo@x.cl",
    businessName: "Bagner",
    companyEmail: "contacto@bagner.cl",
    configuredFrom: CONFIGURED,
    sendCopy: true,
    to: "cliente@c.cl",
  });
  assert.equal(
    envelope.from,
    `"${buildSenderDisplayName("Bagner")}" <cotizaciones@cotizaciones.bagner.cl>`
  );
  assert.equal(
    envelope.replyTo,
    resolveReplyToPreview({ companyEmail: "contacto@bagner.cl", accountEmail: "yo@x.cl" }).replyTo
  );
  assert.deepEqual(envelope.bcc, [
    resolveCopyPreview({ sendCopy: true, accountEmail: "yo@x.cl", to: "cliente@c.cl" }),
  ]);
}

console.log(
  "EMAIL_ENVELOPE_SMOKE_OK From saneado, Reply-To con respaldo, copia oculta, texto de respuesta y paridad cliente/servidor"
);
