// Mensajes de error para la persona: el helper traduce errores del SDK de
// Firebase, del navegador, de red y de cuota a español, conserva los mensajes
// que ya vienen en español (HttpsError del servidor, validaciones propias) y las
// pantallas prioritarias lo usan en vez de mostrar error.message crudo.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  AUTH_ERROR_MESSAGES,
  AUTH_GENERIC_MESSAGE,
  GENERIC_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  PERMISSION_ERROR_MESSAGE,
  QUOTA_ERROR_MESSAGE,
  SESSION_ERROR_MESSAGE,
  authErrorMessage,
  isTechnicalErrorMessage,
  serverMessage,
  userErrorMessage,
} from "../src/domain/userFacingError.mjs";

const fbError = (code, message) => Object.assign(new Error(message), {name: "FirebaseError", code});
const TECHNICAL_LEAK = /firebase|firestore|auth\/|functions\/|\binternal\b|undefined|failed to fetch|clipboard|resource-exhausted|unavailable|deadline/i;

// --- Autenticación: nunca "Firebase: Error (auth/...)" ---------------------
assert.equal(
  userErrorMessage(fbError("auth/invalid-credential", "Firebase: Error (auth/invalid-credential).")),
  "Credenciales inválidas."
);
assert.equal(
  userErrorMessage(fbError("auth/network-request-failed", "Firebase: Error (auth/network-request-failed).")),
  AUTH_ERROR_MESSAGES["auth/network-request-failed"]
);
assert.equal(
  userErrorMessage(new Error("Firebase: Error (auth/too-many-requests).")),
  AUTH_ERROR_MESSAGES["auth/too-many-requests"],
  "el código incrustado en el texto también se traduce"
);
assert.equal(userErrorMessage(new Error("auth/email-required")), AUTH_ERROR_MESSAGES["auth/email-required"]);
assert.equal(
  userErrorMessage(fbError("auth/internal-error", "Firebase: Error (auth/internal-error)."), AUTH_GENERIC_MESSAGE),
  AUTH_GENERIC_MESSAGE
);
assert.equal(authErrorMessage("auth/codigo-que-no-existe"), AUTH_GENERIC_MESSAGE);
assert.equal(authErrorMessage(undefined), AUTH_GENERIC_MESSAGE);
for (const [code, message] of Object.entries(AUTH_ERROR_MESSAGES)) {
  assert.ok(message && !TECHNICAL_LEAK.test(message), `${code} muestra jerga técnica: ${message}`);
  assert.equal(userErrorMessage(fbError(code, `Firebase: Error (${code}).`)), message);
}

// --- Functions / Firestore / Storage sin mensaje propio del servidor -------
assert.equal(userErrorMessage(fbError("functions/internal", "internal")), GENERIC_ERROR_MESSAGE);
assert.equal(
  userErrorMessage(fbError("functions/internal", "internal"), "No pudimos guardar la venta."),
  "No pudimos guardar la venta.",
  "el mensaje de contexto de la pantalla manda sobre el general"
);
assert.equal(userErrorMessage(fbError("functions/unavailable", "unavailable")), NETWORK_ERROR_MESSAGE);
assert.equal(userErrorMessage(fbError("functions/deadline-exceeded", "deadline-exceeded")), NETWORK_ERROR_MESSAGE);
assert.equal(userErrorMessage(fbError("functions/resource-exhausted", "resource-exhausted")), QUOTA_ERROR_MESSAGE);
assert.equal(userErrorMessage(fbError("resource-exhausted", "Quota exceeded.")), QUOTA_ERROR_MESSAGE);
assert.equal(userErrorMessage(fbError("functions/permission-denied", "permission-denied")), PERMISSION_ERROR_MESSAGE);
assert.equal(userErrorMessage(fbError("permission-denied", "Missing or insufficient permissions.")), PERMISSION_ERROR_MESSAGE);
assert.equal(userErrorMessage(fbError("functions/unauthenticated", "unauthenticated")), SESSION_ERROR_MESSAGE);
assert.equal(userErrorMessage(fbError("storage/unauthorized", "Firebase Storage: User does not have permission to access 'x'.")), PERMISSION_ERROR_MESSAGE);
assert.equal(userErrorMessage(fbError("functions/unknown", "unknown")), GENERIC_ERROR_MESSAGE);
// Sin código, o con un código que no coincide con el texto, el nombre del código también es técnico.
assert.equal(userErrorMessage(new Error("internal")), GENERIC_ERROR_MESSAGE);
assert.equal(userErrorMessage(fbError("functions/unavailable", "deadline-exceeded")), NETWORK_ERROR_MESSAGE);
assert.equal(userErrorMessage(new Error("Firebase Storage: Object not found."), "No pudimos cargar el archivo."), "No pudimos cargar el archivo.");
assert.equal(userErrorMessage(fbError("functions/invalid-argument", "invalid-argument"), "Revisa los datos."), "Revisa los datos.");

// Ningún código del SDK sin mensaje propio llega a la pantalla.
for (const code of [
  "cancelled", "unknown", "invalid-argument", "deadline-exceeded", "not-found", "already-exists",
  "permission-denied", "resource-exhausted", "failed-precondition", "aborted", "out-of-range",
  "unimplemented", "internal", "unavailable", "data-loss", "unauthenticated",
]) {
  const shown = userErrorMessage(fbError(`functions/${code}`, code));
  assert.notEqual(shown, code, `${code} llegó crudo a la pantalla`);
  assert.ok(/[ñáéíóúÁÉÍÓÚ ]/.test(shown) && !TECHNICAL_LEAK.test(shown), `${code} -> ${shown}`);
}

// --- Errores del navegador (red, Clipboard API, permisos) ------------------
const failedFetch = Object.assign(new TypeError("Failed to fetch"), {});
assert.equal(userErrorMessage(failedFetch), NETWORK_ERROR_MESSAGE);
assert.equal(userErrorMessage(new TypeError("NetworkError when attempting to fetch resource.")), NETWORK_ERROR_MESSAGE);
assert.equal(userErrorMessage(new TypeError("Load failed")), NETWORK_ERROR_MESSAGE);
assert.equal(
  userErrorMessage(Object.assign(new Error("Write permission denied."), {name: "NotAllowedError"}), "No pudimos copiar el enlace."),
  "No pudimos copiar el enlace."
);
assert.equal(
  userErrorMessage(new Error("Clipboard API no disponible."), "No pudimos copiar el enlace."),
  "No pudimos copiar el enlace."
);
assert.equal(userErrorMessage(new TypeError("Cannot read properties of undefined (reading 'x')")), GENERIC_ERROR_MESSAGE);
assert.equal(userErrorMessage(new SyntaxError("Unexpected token < in JSON at position 0")), GENERIC_ERROR_MESSAGE);
assert.equal(userErrorMessage(null), GENERIC_ERROR_MESSAGE);
assert.equal(userErrorMessage(undefined, "No pudimos cargar."), "No pudimos cargar.");
assert.equal(userErrorMessage({}), GENERIC_ERROR_MESSAGE);

// --- Los mensajes en español del servidor y de la app se conservan ---------
for (const [code, message] of [
  ["functions/failed-precondition", "Stock insuficiente para Cable UTP: disponible 2, solicitado 5."],
  ["functions/invalid-argument", "El número de documento ya fue confirmado para este proveedor."],
  ["functions/not-found", "No se encontró la compra."],
  ["functions/already-exists", "Ya existe una factura confirmada con ese número."],
  ["functions/permission-denied", "Tu membresía no permite administrar compras."],
  ["functions/resource-exhausted", "Alcanzaste el límite de análisis con IA de este mes."],
  ["functions/unauthenticated", "Debes iniciar sesión nuevamente."],
  ["functions/unavailable", "No pudimos conectar con el servicio. Intenta nuevamente."],
]) {
  assert.equal(userErrorMessage(fbError(code, message), "otro"), message, `${code} perdió su mensaje`);
  assert.equal(serverMessage(fbError(code, message)), message);
}
assert.equal(userErrorMessage(new Error("Selecciona una fecha de recepción válida.")), "Selecciona una fecha de recepción válida.");
assert.equal(userErrorMessage(new Error("Registra al menos una cantidad recibida.")), "Registra al menos una cantidad recibida.");
assert.equal(userErrorMessage("Escribe el nombre del área."), "Escribe el nombre del área.");

// serverMessage devuelve "" para lo técnico: el llamador usa su texto propio.
assert.equal(serverMessage(fbError("functions/internal", "internal")), "");
assert.equal(serverMessage(new TypeError("Failed to fetch")), "");
assert.equal(serverMessage(fbError("auth/invalid-credential", "Firebase: Error (auth/invalid-credential).")), "");
assert.equal(serverMessage(null), "");
assert.equal(isTechnicalErrorMessage(""), true);
assert.equal(isTechnicalErrorMessage("No se encontró la orden."), false);
assert.equal(isTechnicalErrorMessage("Firestore confirmó 1 de 2"), true);

// --- Las pantallas usan el helper en vez de error.message crudo ------------
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const PRIORITY_SCREENS = [
  "src/pages/NewPurchaseOrderPage.jsx", "src/pages/PurchaseOrdersPage.jsx",
  "src/pages/NewPurchasePage.jsx", "src/pages/PurchasesPage.jsx",
  "src/pages/NewSalePage.jsx", "src/pages/SalesPage.jsx",
  "src/pages/NewReceptionPage.jsx", "src/pages/ReceptionsPage.jsx",
  "src/pages/QuoteHistoryPage.jsx", "src/pages/NewQuotePage.jsx", "src/pages/PublicQuoteProposalPage.jsx",
  "src/pages/FinancePage.jsx", "src/pages/StatisticsPage.jsx",
  "src/features/inventory/InventoryManager.jsx", "src/features/inventory/InventoryCatalogManager.jsx",
  "src/features/inventory/InventoryImportDialog.jsx", "src/features/purchases/PurchaseDocumentImportDialog.jsx",
  "src/features/receptions/ReceptionDocumentImportDialog.jsx", "src/components/finance/FinancialMovementDialog.jsx",
  "src/features/reports/OperationalNetProfitBreakdown.jsx", "src/features/reports/ReportProfitabilityV4Section.jsx",
  "src/features/references/MarketPriceReferencesView.jsx",
];
const rawMessage = /\b(?:error|err|loadError|saveError|toggleError|acceptError|analysisError|applyError|reopenError|duplicateError|deleteError)\??\.message\b/;
for (const file of PRIORITY_SCREENS) {
  const source = read(file);
  assert.match(source, /import \{userErrorMessage\} from "(?:\.\.\/)+domain\/userFacingError\.mjs";/, `${file} no importa el helper`);
  assert.match(source, /userErrorMessage\(/, `${file} no usa el helper`);
  const raw = source.split("\n").map((line, index) => ({line, number: index + 1}))
    .filter(({line}) => rawMessage.test(line) && !/console\.|^\s*\/\//.test(line))
    // ReportRangeError trae un mensaje propio en español, no del SDK.
    .filter(({line}) => !/ReportRangeError/.test(line) && !/\?\s*error\.message$/.test(line.trim()));
  assert.deepEqual(raw.map(({number, line}) => `${file}:${number} ${line.trim()}`), [], `${file} muestra error.message crudo`);
}

// Crear empresa: el mensaje del servidor solo se muestra si no es técnico.
const businessForm = read("src/domain/businessForm.js");
assert.match(businessForm, /import \{ serverMessage \} from "\.\/userFacingError\.mjs";/);
assert.doesNotMatch(businessForm, /return error\?\.message \|\|/);
assert.equal((businessForm.match(/serverMessage\(error\) \|\|/g) || []).length, 3);

// Login, registro y recuperación: un solo selector de mensajes de autenticación.
const login = read("src/features/auth/Login.jsx");
assert.match(login, /userErrorMessage\(error, AUTH_GENERIC_MESSAGE\)/);
assert.doesNotMatch(login, /case "auth\//, "Login volvió a tener su propia tabla de códigos");
assert.doesNotMatch(login, /conectar con Firebase/);
assert.doesNotMatch(login, /Error al procesar la solicitud/);

console.log("User-facing error smoke: OK");
