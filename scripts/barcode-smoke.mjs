import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";
import {
  acceptCameraBarcodeRead,
  BARCODE_CAMERA_REARM_MS,
  BARCODE_CONFIRMATION_WINDOW_MS,
  barcodeCameraErrorMessage,
  barcodeSupportMessage,
  BARCODE_CAMERA_LABELS,
  clearCameraNotice,
  clearScanError,
  describeBarcodeCamera,
  confirmCameraBarcodeRead,
  EMPTY_SCAN_SESSION,
  getBarcodeCameraSupport,
  getBarcodeLookupCandidates,
  incrementScannedItem,
  isDuplicateBarcodeRead,
  normalizeBarcode,
  recordScanError,
  recordScanSuccess,
  requiredBarcodeConfirmations,
  stopBarcodeCamera,
} from "../src/domain/barcode.mjs";
import {
  BARCODE_DECODE_ERROR_LIMIT,
  createBarcodeDecoderSession,
  isBarcodeVideoReady,
  isZxingRetryableError,
  NATIVE_DECODER_FALLBACK_MS,
  startBarcodeCameraLoop,
  toBarcodeRead,
  waitForBarcodeVideoReady,
  watchPageVisibility,
} from "../src/services/barcodeDecoder.js";

// Las sesiones devuelven lecturas {rawValue, format, source}; varias pruebas solo miran el texto.
const rawOf = async (pendingRead) => (await pendingRead).rawValue;

assert.equal(normalizeBarcode(" 0012345678905\n"), "0012345678905");
assert.equal(normalizeBarcode(""), "");

// UPC-A de 12 dígitos y EAN-13 con 0 inicial se buscan como equivalentes; el resto queda exacto.
assert.deepEqual(getBarcodeLookupCandidates(" 012345678905 "), ["012345678905", "0012345678905"]);
assert.deepEqual(getBarcodeLookupCandidates("0012345678905"), ["0012345678905", "012345678905"]);
assert.deepEqual(getBarcodeLookupCandidates("7801234567890"), ["7801234567890"]);
assert.deepEqual(getBarcodeLookupCandidates("96385074"), ["96385074"]);
assert.deepEqual(getBarcodeLookupCandidates("ABC-123"), ["ABC-123"]);
assert.deepEqual(getBarcodeLookupCandidates("  "), []);

// Sin contexto seguro el motivo explica HTTPS, aunque exista BarcodeDetector.
const insecureCamera = await getBarcodeCameraSupport({
  BarcodeDetectorClass: class Detector {},
  mediaDevices: {getUserMedia() {}},
  secureContext: false,
});
assert.deepEqual(insecureCamera, {
  supported: false,
  reason: "insecure-context",
  decoder: "manual",
  formats: [],
});
assert.match(barcodeSupportMessage("insecure-context"), /HTTPS/);
assert.match(barcodeSupportMessage("insecure-context"), /lector USB/);

const unsupportedCamera = await getBarcodeCameraSupport({
  BarcodeDetectorClass: class Detector {},
  mediaDevices: {},
});
assert.deepEqual(unsupportedCamera, {
  supported: false,
  reason: "camera-api-unavailable",
  decoder: "manual",
  formats: [],
});

class SupportedDetector {
  static async getSupportedFormats() {
    return ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"];
  }
}
const supportedCamera = await getBarcodeCameraSupport({
  BarcodeDetectorClass: SupportedDetector,
  mediaDevices: {getUserMedia() {}},
});
assert.deepEqual(supportedCamera, {
  supported: true,
  reason: "",
  decoder: "native",
  formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
});
const fallbackCamera = await getBarcodeCameraSupport({
  BarcodeDetectorClass: undefined,
  mediaDevices: {getUserMedia() {}},
});
assert.deepEqual(fallbackCamera, {
  supported: true,
  reason: "",
  decoder: "zxing",
  formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
});
const unverifiableNativeCamera = await getBarcodeCameraSupport({
  BarcodeDetectorClass: class DetectorWithoutFormatProbe {},
  mediaDevices: {getUserMedia() {}},
});
assert.equal(unverifiableNativeCamera.decoder, "zxing");
assert.match(barcodeSupportMessage("camera-api-unavailable"), /lector USB/);
assert.match(barcodeCameraErrorMessage({name: "NotAllowedError"}), /Habilita el permiso/);
assert.match(barcodeCameraErrorMessage({name: "NotFoundError"}), /No se encontró una cámara/);
assert.equal(isDuplicateBarcodeRead({barcode: "001234", readAt: 1000}, "001234", 2000), true);
assert.equal(isDuplicateBarcodeRead({barcode: "001234", readAt: 1000}, "001234", 2500), false);
assert.equal(isDuplicateBarcodeRead({barcode: "001234", readAt: 1000}, "987", 1100), false);

// Cámara: un código quieto en cuadro no se repite; vuelve a contar al salir de cuadro.
let cameraRead = acceptCameraBarcodeRead(null, " 7801234567890 ", 0);
assert.equal(cameraRead.accepted, true);
assert.equal(cameraRead.barcode, "7801234567890");
cameraRead = acceptCameraBarcodeRead(cameraRead.state, "7801234567890", 300);
assert.equal(cameraRead.accepted, false, "El mismo código en cuadro no se vuelve a contar.");
cameraRead = acceptCameraBarcodeRead(cameraRead.state, "7801234567890", 300 + BARCODE_CAMERA_REARM_MS - 1);
assert.equal(cameraRead.accepted, false, "Cada cuadro con el código renueva la presencia.");
const blankRead = acceptCameraBarcodeRead(cameraRead.state, "", 5000);
assert.equal(blankRead.accepted, false);
assert.deepEqual(blankRead.state, cameraRead.state, "Un cuadro sin lectura no renueva la presencia.");
cameraRead = acceptCameraBarcodeRead(blankRead.state, "7801234567890", cameraRead.state.seenAt + BARCODE_CAMERA_REARM_MS);
assert.equal(cameraRead.accepted, true, "Tras salir de cuadro, el mismo código vuelve a contar.");
assert.equal(acceptCameraBarcodeRead(cameraRead.state, "96385074", cameraRead.state.seenAt + 10).accepted, true, "Un código distinto se acepta de inmediato.");

const created = incrementScannedItem([], "product-1", () => ({
  lineaId: "line-1",
  itemId: "product-1",
  cantidad: 1,
  costoUnitario: 100,
  descuentoPct: 5,
}));
const incremented = incrementScannedItem(created, "product-1", () => {
  throw new Error("No debe crear una segunda línea.");
});
assert.equal(incremented.length, 1);
assert.equal(incremented[0].cantidad, 2);
assert.equal(incremented[0].costoUnitario, 100);
assert.equal(incremented[0].descuentoPct, 5);

let stopped = 0;
stopBarcodeCamera({getTracks: () => [
  {stop: () => { stopped += 1; }},
  {stop: () => { stopped += 1; }},
]});
assert.equal(stopped, 2, "Cerrar el escáner debe detener todas las pistas.");

const readyVideo = {readyState: 2, videoWidth: 1280, videoHeight: 720};

// A. Native detecta y entrega el valor sin crear ZXing.
const nativeCreates = [];
const nativeSession = await createBarcodeDecoderSession({
  decoder: "native",
  formats: supportedCamera.formats,
  createDecoder: async ({decoder}) => {
    nativeCreates.push(decoder);
    return {kind: decoder, detect: async () => "0012345678905", stop() {}};
  },
  now: () => 0,
});
assert.equal(await rawOf(nativeSession.detect(readyVideo)), "0012345678905");
assert.deepEqual(nativeCreates, ["native"]);
nativeSession.stop();

// B y C. Pasada la ventana, ZXing se suma sin detener el nativo y ambos se alternan por intento.
let scanClock = 0;
const decoderEvents = [];
let nativeValue = "";
let zxingValue = "";
const fallbackSession = await createBarcodeDecoderSession({
  decoder: "native",
  formats: supportedCamera.formats,
  now: () => scanClock,
  createDecoder: async ({decoder}) => {
    decoderEvents.push(`create:${decoder}`);
    return decoder === "native"
      ? {
          kind: "native",
          detect: async () => { decoderEvents.push("detect:native"); return nativeValue; },
          stop: () => decoderEvents.push("stop:native"),
        }
      : {
          kind: "zxing",
          detect: async () => { decoderEvents.push("detect:zxing"); return zxingValue; },
          stop: () => decoderEvents.push("stop:zxing"),
        };
  },
  onFallback: () => decoderEvents.push("fallback"),
});
assert.equal(await rawOf(fallbackSession.detect(readyVideo)), "");
assert.equal(fallbackSession.kind, "native");
scanClock = NATIVE_DECODER_FALLBACK_MS + 1;
assert.equal(await rawOf(fallbackSession.detect(readyVideo)), "");
assert.equal(fallbackSession.kind, "alternating");
assert.equal(await rawOf(fallbackSession.detect(readyVideo)), "");
assert.equal(await rawOf(fallbackSession.detect(readyVideo)), "");
assert.deepEqual(decoderEvents, [
  "create:native",
  "detect:native",
  "create:zxing",
  "fallback",
  "detect:zxing",
  "detect:native",
  "detect:zxing",
]);
assert.equal(decoderEvents.includes("stop:native"), false, "El nativo no se detiene al sumar ZXing.");
nativeValue = "7801234567890";
assert.equal(await rawOf(fallbackSession.detect(readyVideo)), "7801234567890", "El nativo sigue leyendo tras la ventana.");
nativeValue = "";
zxingValue = " 00012345 ";
assert.equal(normalizeBarcode(await rawOf(fallbackSession.detect(readyVideo))), "00012345");
assert.equal(decoderEvents.filter((event) => event === "create:zxing").length, 1, "ZXing se crea una sola vez.");

// Un error del nativo es un cuadro sin lectura; si ZXing no carga, el nativo sigue solo.
const nativeOnlySession = await createBarcodeDecoderSession({
  decoder: "native",
  formats: supportedCamera.formats,
  now: () => NATIVE_DECODER_FALLBACK_MS + 1,
  createDecoder: async ({decoder}) => {
    if (decoder === "zxing") throw new Error("ZXing no disponible");
    let calls = 0;
    return {
      kind: "native",
      async detect() {
        calls += 1;
        if (calls === 1) throw new Error("cuadro inválido");
        return "96385074";
      },
      stop() {},
    };
  },
});
assert.equal(await rawOf(nativeOnlySession.detect(readyVideo)), "");
assert.equal(nativeOnlySession.kind, "native");
assert.equal(await rawOf(nativeOnlySession.detect(readyVideo)), "96385074");
nativeOnlySession.stop();

// Los errores no recuperables de ZXing se propagan para que el componente los cuente.
const failingZxingSession = await createBarcodeDecoderSession({
  decoder: "zxing",
  formats: supportedCamera.formats,
  createDecoder: async () => ({
    kind: "zxing",
    detect: async () => { throw new Error("canvas no disponible"); },
    stop() {},
  }),
});
await assert.rejects(failingZxingSession.detect(readyVideo), /canvas no disponible/);
failingZxingSession.stop();

// D. NotFound/Checksum/Format de ZXing son reintentos normales.
const {
  ChecksumException,
  FormatException,
  NotFoundException,
} = await import("@zxing/library");
const retryableTypes = [NotFoundException, ChecksumException, FormatException];
for (const RetryableError of retryableTypes) {
  assert.equal(isZxingRetryableError(new RetryableError(), retryableTypes), true);
}
assert.equal(isZxingRetryableError(new Error("inesperado"), retryableTypes), false);

// E. No se decodifica hasta tener estado y dimensiones reales del video.
let earlyDetectCalls = 0;
const waitingSession = await createBarcodeDecoderSession({
  decoder: "zxing",
  formats: supportedCamera.formats,
  createDecoder: async () => ({
    kind: "zxing",
    detect: async () => { earlyDetectCalls += 1; return "123"; },
    stop() {},
  }),
});
assert.equal(isBarcodeVideoReady({readyState: 1, videoWidth: 0, videoHeight: 0}), false);
assert.equal(await rawOf(waitingSession.detect({readyState: 1, videoWidth: 0, videoHeight: 0})), "");
assert.equal(earlyDetectCalls, 0);
class MockVideo extends EventTarget {
  readyState = 1;
  videoWidth = 0;
  videoHeight = 0;
}
const loadingVideo = new MockVideo();
let videoReadyResolved = false;
const videoReadyPromise = waitForBarcodeVideoReady(loadingVideo).then(() => {
  videoReadyResolved = true;
});
await Promise.resolve();
assert.equal(videoReadyResolved, false);
loadingVideo.readyState = 2;
loadingVideo.videoWidth = 1280;
loadingVideo.videoHeight = 720;
loadingVideo.dispatchEvent(new Event("loadeddata"));
await videoReadyPromise;
assert.equal(videoReadyResolved, true);
waitingSession.stop();

// F. Cerrar detiene ambos decoders; el stream y los recursos del loop se validan abajo.
fallbackSession.stop();
assert.deepEqual(decoderEvents.slice(-2), ["stop:native", "stop:zxing"]);
assert.equal(await rawOf(fallbackSession.detect(readyVideo)), "", "Una sesión detenida no vuelve a decodificar.");

// G. Una sesión nunca ejecuta dos intentos de decoder simultáneamente.
let activeDecodes = 0;
let maxActiveDecodes = 0;
let finishDecode;
const exclusiveSession = await createBarcodeDecoderSession({
  decoder: "native",
  formats: supportedCamera.formats,
  now: () => 0,
  createDecoder: async () => ({
    kind: "native",
    async detect() {
      activeDecodes += 1;
      maxActiveDecodes = Math.max(maxActiveDecodes, activeDecodes);
      const result = await new Promise((resolve) => { finishDecode = resolve; });
      activeDecodes -= 1;
      return result;
    },
    stop() {},
  }),
});
const firstDetection = exclusiveSession.detect(readyVideo);
assert.equal(await rawOf(exclusiveSession.detect(readyVideo)), "");
finishDecode("987654321");
assert.equal(await rawOf(firstDetection), "987654321");
assert.equal(maxActiveDecodes, 1);
exclusiveSession.stop();

// H. Hallazgo 2: una búsqueda fallida no detiene la cámara ni el ciclo de lectura.
// El ciclo nunca toca el stream ni video.srcObject; solo el componente libera la cámara.
function createLoopHarness({continuous, reads, submitResult, detectError = null}) {
  const stream = {id: "stream-1", active: true};
  const video = {...readyVideo, srcObject: stream};
  const scheduled = [];
  const statuses = [];
  const submitted = [];
  let fatalErrors = 0;
  let clock = 0;
  const queue = [...reads];
  const loop = startBarcodeCameraLoop({
    continuous,
    decoder: {
      kind: "native",
      async detect() {
        if (detectError) throw detectError;
        return queue.length ? queue.shift() : "";
      },
    },
    getVideo: () => video,
    now: () => clock,
    onFatalError: () => { fatalErrors += 1; },
    onStatus: (status) => statuses.push(status),
    schedule: (run) => scheduled.push(run),
    submit: async (barcode) => {
      submitted.push(barcode);
      return submitResult(barcode);
    },
  });
  return {
    loop,
    scheduled,
    statuses,
    stream,
    submitted,
    video,
    get fatalErrors() { return fatalErrors; },
    async tick(ms = 120) {
      clock += ms;
      const run = scheduled.shift();
      assert.ok(run, "El ciclo debe tener una lectura programada.");
      await run();
    },
  };
}

for (const continuous of [true, false]) {
  const notFound = createLoopHarness({
    continuous,
    reads: ["7754487116367", "7754487116367", "7754487116367", "", "7801234567890", "7801234567890"],
    submitResult: (barcode) => barcode !== "7754487116367",
  });
  await notFound.tick();
  assert.deepEqual(notFound.statuses, [], "Una sola lectura de un EAN-13 todavía no se confirma.");
  await notFound.tick();
  assert.deepEqual(notFound.statuses, ["processing", "ready"], "Tras 'no encontrado' vuelve a 'Cámara lista'.");
  assert.equal(notFound.scheduled.length, 1, "Tras 'no encontrado' el ciclo sigue leyendo.");
  assert.equal(notFound.video.srcObject, notFound.stream, "El video conserva su stream.");
  assert.equal(notFound.loop.stopped, false);
  await notFound.tick();
  assert.deepEqual(notFound.submitted, ["7754487116367"], "El código rechazado y aún en cuadro no se reenvía.");
  await notFound.tick(BARCODE_CAMERA_REARM_MS);
  await notFound.tick();
  await notFound.tick();
  assert.deepEqual(notFound.submitted, ["7754487116367", "7801234567890"], "La cámara sigue leyendo códigos nuevos.");
  assert.equal(notFound.fatalErrors, 0);
  if (continuous) {
    assert.equal(notFound.scheduled.length, 1, "En modo continuo una lectura aceptada mantiene el ciclo.");
    assert.equal(notFound.loop.stopped, false);
  } else {
    assert.equal(notFound.scheduled.length, 0, "En lectura única, la lectura aceptada termina el ciclo.");
    assert.equal(notFound.loop.stopped, true);
  }
  notFound.loop.stop();
}

const brokenDecoder = createLoopHarness({
  continuous: true,
  reads: [],
  submitResult: () => true,
  detectError: new Error("canvas no disponible"),
});
for (let attempt = 0; attempt < BARCODE_DECODE_ERROR_LIMIT; attempt += 1) await brokenDecoder.tick();
assert.equal(brokenDecoder.fatalErrors, 1, "Solo errores repetidos del decoder liberan la cámara.");
assert.equal(brokenDecoder.scheduled.length, 0);

const stoppedLoop = createLoopHarness({continuous: true, reads: ["7754487116367"], submitResult: () => true});
stoppedLoop.loop.stop();
await stoppedLoop.tick();
assert.deepEqual(stoppedLoop.submitted, [], "Un ciclo detenido no vuelve a leer.");

// J. Punto 3: lecturas falsas. Confirmación por lecturas idénticas, más exigente con EAN-8/UPC-E.
const ean13 = (rawValue = "7754487116367") => ({rawValue, format: "ean_13"});
const ean8 = (rawValue = "14081163") => ({rawValue, format: "ean_8"});
assert.equal(requiredBarcodeConfirmations({barcode: "7754487116367", format: "ean_13"}), 2);
assert.equal(requiredBarcodeConfirmations({barcode: "012345678905", format: "upc_a"}), 2);
assert.equal(requiredBarcodeConfirmations({barcode: "ABC-123", format: "code_128"}), 2);
assert.equal(requiredBarcodeConfirmations({barcode: "14081163", format: "ean_8"}), 3);
assert.equal(requiredBarcodeConfirmations({barcode: "01234565", format: "upc_e"}), 3);
assert.equal(requiredBarcodeConfirmations({barcode: "14081163", format: ""}), 3, "Sin formato, 8 dígitos se trata como corto.");
assert.equal(requiredBarcodeConfirmations({barcode: "7754487116367", format: ""}), 2);
assert.equal(requiredBarcodeConfirmations({barcode: "ABC12345", format: ""}), 2, "Un alfanumérico no es EAN-8.");

const confirmSequence = (reads) => {
  let state = null;
  return reads.map(([detection, at]) => {
    const result = confirmCameraBarcodeRead(state, detection, at);
    state = result.state;
    return result;
  });
};
// Secuencia real reportada: un EAN-8 inventado y luego el EAN-13 verdadero.
const reported = confirmSequence([[ean8(), 0], [ean13(), 120], [ean8(), 240], [ean13(), 360]]);
assert.deepEqual(reported.map((result) => result.confirmed), [false, false, false, true]);
assert.equal(reported[2].ignored, true, "Un EAN-8 tras un EAN-13 reciente se ignora.");
assert.equal(reported[3].barcode, "7754487116367");
// Un EAN-8 solo necesita 3 lecturas; un EAN-13, 2.
assert.deepEqual(confirmSequence([[ean8("96385074"), 0], [ean8("96385074"), 120], [ean8("96385074"), 240]]).map((r) => r.confirmed), [false, false, true]);
assert.deepEqual(confirmSequence([[ean13(), 0], [ean13(), 120]]).map((r) => r.confirmed), [false, true]);
// Un código distinto reinicia la cuenta; un cuadro vacío no.
assert.deepEqual(confirmSequence([[ean13("7801234567890"), 0], [ean13(), 120], [ean13("7801234567890"), 240], [ean13("7801234567890"), 360]]).map((r) => r.confirmed), [false, false, false, true]);
assert.deepEqual(confirmSequence([[ean13(), 0], ["", 100], [ean13(), 600]]).map((r) => r.confirmed), [false, false, true]);
// Ventana de 1,5 s: las lecturas deben caer dentro de ella desde la primera.
assert.deepEqual(confirmSequence([[ean13(), 0], [ean13(), BARCODE_CONFIRMATION_WINDOW_MS + 100], [ean13(), BARCODE_CONFIRMATION_WINDOW_MS + 200]]).map((r) => r.confirmed), [false, false, true]);
assert.deepEqual(confirmSequence([[ean8(), 0], [ean8(), 1000], [ean8(), 1600]]).map((r) => r.confirmed), [false, false, false], "Tres lecturas cortas fuera de la ventana no confirman.");
// Ya confirmado, sigue confirmado mientras se siga leyendo sin pausas mayores a la ventana.
assert.deepEqual(confirmSequence([[ean13(), 0], [ean13(), 100], [ean13(), 1500], [ean13(), 3100]]).map((r) => r.confirmed), [false, true, true, false]);
// La preferencia por el código largo dura solo la ventana.
assert.equal(confirmSequence([[ean13(), 0], [ean8(), BARCODE_CONFIRMATION_WINDOW_MS + 1]])[1].ignored, false);
assert.deepEqual(toBarcodeRead("96385074", "zxing"), {rawValue: "96385074", format: "", source: "zxing"});
assert.deepEqual(toBarcodeRead({rawValue: "7754487116367", format: "EAN_13"}, "native"), {rawValue: "7754487116367", format: "ean_13", source: "native"});

// El ciclo aplica la confirmación: la secuencia reportada solo entrega el EAN-13.
const falseReads = createLoopHarness({
  continuous: true,
  reads: [ean8(), ean13(), ean8(), ean13(), ean8(), ean8()],
  submitResult: () => true,
});
for (let frame = 0; frame < 6; frame += 1) await falseReads.tick();
assert.deepEqual(falseReads.submitted, ["7754487116367"], "El EAN-8 inventado nunca se entrega.");
const shortOnly = createLoopHarness({continuous: true, reads: [ean8("96385074"), ean8("96385074"), ean8("96385074")], submitResult: () => true});
await shortOnly.tick();
await shortOnly.tick();
assert.deepEqual(shortOnly.submitted, [], "Dos lecturas de un EAN-8 no bastan.");
await shortOnly.tick();
assert.deepEqual(shortOnly.submitted, ["96385074"], "Un EAN-8 real se acepta con 3 lecturas.");

// K. Un solo mensaje visible: cada resultado reemplaza al anterior.
let scanSession = recordScanError(EMPTY_SCAN_SESSION, "Código 111: Producto no encontrado para este código.");
assert.deepEqual(scanSession.message, {tone: "error", text: "Código 111: Producto no encontrado para este código.", source: "scan"});
scanSession = recordScanSuccess(scanSession, {key: "p1", label: "Cable UTP"});
assert.deepEqual(scanSession.message, {tone: "success", text: "Agregado: Cable UTP (×1)"}, "Un éxito reemplaza el error anterior.");
scanSession = recordScanError(scanSession, "Código 222: Producto no encontrado para este código.");
assert.equal(scanSession.message.tone, "error", "Un error reemplaza el éxito anterior.");
assert.deepEqual(scanSession.entries, [{key: "p1", label: "Cable UTP", count: 1}], "Un error no altera la lista.");
scanSession = recordScanSuccess(scanSession, {key: "p1", label: "Cable UTP"});
assert.equal(scanSession.message.text, "Agregado: Cable UTP (×2)", "Dos lecturas iguales seguidas se distinguen.");
scanSession = recordScanSuccess(scanSession, {key: "p2", label: "Conector RJ45"});
assert.deepEqual(scanSession.entries.map((entry) => [entry.key, entry.count]), [["p2", 1], ["p1", 2]]);
assert.equal(clearScanError(scanSession), scanSession, "Escribir no borra un éxito.");
assert.equal(clearScanError(recordScanError(scanSession, "x")).message, null, "Escribir borra un error.");
assert.deepEqual(EMPTY_SCAN_SESSION, {entries: [], message: null});

// L. Página oculta (llamada, notificación, otra pestaña): la cámara se pausa y,
// al volver, se reactiva sola sin cerrar el cuadro ni perder la lista.
const visibleReady = describeBarcodeCamera({supported: true, pageVisible: true, cameraStatus: "ready"});
assert.deepEqual(visibleReady, {shouldRun: true, canRetry: false, label: BARCODE_CAMERA_LABELS.ready});
const hidden = describeBarcodeCamera({supported: true, pageVisible: false, cameraStatus: "ready"});
assert.deepEqual(hidden, {shouldRun: false, canRetry: false, label: BARCODE_CAMERA_LABELS.paused});
assert.doesNotMatch(hidden.label, /[Cc]ierra/, "La pausa no pide cerrar el cuadro.");
assert.match(hidden.label, /se reactivará/);
assert.equal(describeBarcodeCamera({supported: true, pageVisible: true, cameraStatus: "starting"}).shouldRun, true, "Al volver, la cámara se reactiva sola.");
const failedRestart = describeBarcodeCamera({supported: true, pageVisible: true, cameraStatus: "unavailable"});
assert.equal(failedRestart.canRetry, true, "Si no se reactiva, se ofrece 'Reactivar cámara'.");
assert.equal(failedRestart.shouldRun, true);
assert.equal(describeBarcodeCamera({supported: false, pageVisible: true, cameraStatus: "unavailable"}).canRetry, false, "Sin cámara disponible (p. ej. sin HTTPS) no hay reintento.");

// Un aviso de cámara se borra al reactivarse; el último resultado de lectura se conserva.
const withEntries = recordScanSuccess(EMPTY_SCAN_SESSION, {key: "p1", label: "Cable UTP"});
const withCameraNotice = recordScanError(withEntries, "No se autorizó la cámara.", "camera");
assert.equal(withCameraNotice.message.source, "camera");
const afterResume = clearCameraNotice(withCameraNotice);
assert.equal(afterResume.message, null);
assert.deepEqual(afterResume.entries, withEntries.entries, "Reactivar la cámara conserva la lista de la sesión.");
assert.equal(clearCameraNotice(withEntries), withEntries, "Reactivar no borra el último 'Agregado'.");

// watchPageVisibility informa ocultar/volver y deja de escuchar al limpiar.
class FakeDocument extends EventTarget {
  visibilityState = "visible";
}
const fakeDocument = new FakeDocument();
const visibilityChanges = [];
const stopWatching = watchPageVisibility(fakeDocument, (visible) => visibilityChanges.push(visible));
fakeDocument.visibilityState = "hidden";
fakeDocument.dispatchEvent(new Event("visibilitychange"));
fakeDocument.visibilityState = "visible";
fakeDocument.dispatchEvent(new Event("visibilitychange"));
stopWatching();
fakeDocument.visibilityState = "hidden";
fakeDocument.dispatchEvent(new Event("visibilitychange"));
assert.deepEqual(visibilityChanges, [false, true]);
assert.equal(typeof watchPageVisibility(undefined, () => {}), "function", "Sin document (SSR) no falla.");

const [scanner, decoder, inventoryService, inventoryUi, quotePage, quoteEditor, poPage, poEditor, barcodeDomain] =
  await Promise.all([
    readFile(new URL("../src/components/barcode/BarcodeInput.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/barcodeDecoder.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/inventoryService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/features/inventory/InventoryManager.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/NewQuotePage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/quotes/QuoteItemsEditor.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/NewPurchaseOrderPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ui/DocumentItemsEditor.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/domain/barcode.mjs", import.meta.url), "utf8"),
  ]);

assert.match(decoder, /BarcodeDetector/);
assert.match(scanner, /getUserMedia/);
assert.match(scanner, /releaseCamera\(\)/);
assert.match(scanner, /event\.key !== "Enter"/);
assert.match(scanner, /getBarcodeCameraSupport/);
assert.match(scanner, /isDuplicateBarcodeRead/);
assert.match(scanner, /getUserMedia[\s\S]*createBarcodeDecoderSession/);
assert.match(scanner, /width: \{ideal: 1280\}/);
assert.match(scanner, /height: \{ideal: 720\}/);
assert.match(scanner, /focusMode\.includes\("continuous"\)/);
assert.match(scanner, /waitForBarcodeVideoReady/);
assert.match(scanner, /import\.meta\.env\.DEV/);
assert.match(scanner, /cancelAnimationFrame/);
assert.match(scanner, /clearTimeout/);
assert.match(scanner, /cameraAbortRef\.current\?\.abort/);
assert.match(scanner, /decoderRef\.current\?\.stop/);
assert.match(scanner, /stopBarcodeCamera/);
assert.match(decoder, /decoder === "native"/);
assert.match(decoder, /NATIVE_DECODER_FALLBACK_MS = 2000/);
assert.match(decoder, /fallbackTurn = !fallbackTurn/);
assert.doesNotMatch(decoder, /currentKind = "zxing"/, "El paso a ZXing ya no es permanente.");
assert.match(scanner, /if \(kind !== "native"\)/);
assert.match(barcodeDomain, /isSecureContext/);
// Hallazgo 2: la cámara no se libera antes de buscar; solo se cierra tras una lectura única exitosa.
assert.match(scanner, /cameraLoopRef\.current = startBarcodeCameraLoop\(/);
assert.match(scanner, /cameraLoopRef\.current\?\.stop\(\)/);
assert.doesNotMatch(scanner, /releaseCamera\(\);\s*setManualValue/);
assert.doesNotMatch(decoder, /releaseCamera|srcObject|getTracks/, "El ciclo no libera la cámara por su cuenta.");
assert.match(decoder, /confirmCameraBarcodeRead\(confirmationState, detection, readAt\)/);
assert.match(decoder, /acceptCameraBarcodeRead\(state, confirmation\.confirmed \? confirmation\.barcode : "", readAt\)/);
assert.match(decoder, /TRY_HARDER, true/, "La búsqueda exhaustiva de ZXing se mantiene.");
// Un solo mensaje: una región persistente reemplaza éxito y error.
assert.equal((scanner.match(/aria-live="polite"/g) || []).length, 1, "Hay una sola región de mensajes.");
assert.doesNotMatch(scanner, /barcode-scanner__error|barcode-scanner__last|setLastScan/);
assert.match(scanner, /recordScanSuccess\(current, \{key, label\}\)/);
assert.match(scanner, /recordScanError\(current, text\)/);
assert.match(scanner, /onDetection: import\.meta\.env\.DEV/);
// Visibilidad: el efecto de cámara depende de pageVisible/cameraRun y no reinicia la sesión.
assert.doesNotMatch(scanner, /Cierra este cuadro|vuelve a abrirlo/, "Ningún mensaje pide cerrar y abrir el cuadro.");
assert.match(scanner, /if \(!open \|\| !cameraSupport\?\.supported \|\| !pageVisible\) return undefined;/);
assert.match(scanner, /\}, \[cameraRun, cameraSupport, continuous, open, pageVisible, releaseCamera, showCameraError, submit\]\);/);
assert.match(scanner, /return watchPageVisibility\(globalThis\.document, setPageVisible\);/);
assert.match(scanner, /setScanSession\(clearCameraNotice\)/);
assert.match(scanner, /\{camera\.canRetry && \(/);
assert.match(scanner, /Reactivar cámara/);
assert.match(scanner, /setCameraRun\(\(current\) => current \+ 1\)/);
assert.equal((scanner.match(/setScanSession\(EMPTY_SCAN_SESSION\)/g) || []).length, 2, "Solo abrir o cerrar el cuadro reinicia la lista.");
assert.match(decoder, /if \(used && !continuous\)/);
// Modo continuo: cola ordenada, lista de la sesión, aviso accesible y cierre manual.
assert.match(scanner, /continuous = false/);
assert.match(scanner, /submitQueueRef\.current\.then/);
assert.match(scanner, /Escaneados en esta sesión/);
assert.match(scanner, /aria-live="polite"/);
assert.match(scanner, /continuous \? "Terminar" : "Cancelar"/);
assert.match(scanner, /if \(!continuous\) close\(\);\s*else if \(session === sessionRef\.current\) recordScan\(result, barcode\);/);
assert.match(scanner, /sessionRef\.current \+= 1/);
assert.match(decoder, /import\("@zxing\/library"\)/);
for (const format of ["EAN_13", "EAN_8", "UPC_A", "UPC_E", "CODE_128"]) {
  assert.match(decoder, new RegExp(format));
}
assert.doesNotMatch(decoder, /QR_CODE/);
assert.match(inventoryService, /getBarcodeLookupCandidates\(rawBarcode\)/);
assert.match(inventoryService, /where\("barcode", "in", candidates\)/);
assert.match(inventoryService, /where\("codigoBarras", "in", candidates\)/);
assert.doesNotMatch(inventoryService, /findActiveProductByBarcode[\s\S]*?getInventoryItems/);
assert.match(inventoryUi, /Código de barras/);
assert.match(inventoryUi, /BarcodeInput/);
// Etapa 3: buscar escaneando en /inventario (lectura única). El botón es el compartido, primero en las acciones del encabezado.
assert.match(inventoryUi, /<ScanProductButton continuous=\{false\} disabled=\{loading\} onSubmit=\{handleScanSearch\} \/>/);
assert.match(inventoryUi, /const result = resolveInventoryBarcodeScan\(items, barcode\);/);
assert.match(inventoryUi, /window\.setTimeout\(\(\) => setDetailItem\(result\.item\), 0\)/);
assert.match(inventoryUi, /setLowStockOnly\(false\);\s*setFilters\(\{ \.\.\.DEFAULT_INVENTORY_FILTERS, query: result\.query, status: result\.status \}\);/);
assert.doesNotMatch(inventoryUi, /<label className="erp-field inventory-search">/, "El botón Escanear no va dentro del label del buscador.");
// El editor de la cotización usa el bloque compartido DocumentItemsEditor, que es quien dibuja el escáner continuo.
assert.match(quoteEditor, /<DocumentItemsEditor/);
assert.match(quoteEditor, /onScanProduct=\{onScanProduct\}/, "la cotización entrega su escáner al bloque compartido");
assert.match(poEditor, /Escanear producto/);
// El editor de la orden usa el bloque compartido DocumentItemsEditor, que es quien dibuja el escáner continuo.
assert.match(poEditor, /<ScanProductButton onSubmit=\{onScanProduct\} \/>/);
assert.match(await readFile(new URL("../src/features/purchaseOrders/PurchaseOrderItemsEditor.jsx", import.meta.url), "utf8"), /onScanProduct=\{onScanProduct\}/, "la orden entrega su escáner al bloque compartido");
assert.match(quotePage, /return \{key: product\.id, label: product\.nombre\}/);
assert.match(poPage, /return \{key: product\.id, label: product\.nombre\}/);
assert.doesNotMatch(poPage, /title: "Producto agregado"/);
assert.match(quotePage, /Producto no encontrado para este código\./);
// El escaneo repetido suma cantidad con la regla compartida de reagrupado (inventoryLineAdd.mjs), no con una suma propia.
assert.match(quotePage, /addInventoryItemToLines\(items, valuation, \{[\s\S]*quantity: quantityToAdd,/);
assert.match(poEditor, /Escanear producto/);
assert.match(poPage, /incrementScannedItem/);
assert.match(poPage, /Producto no encontrado para este código\./);
assert.doesNotMatch(`${quotePage}\n${poPage}`, /crear.*producto.*barcode/i);

// I. Render real (Vite SSR): `continuous` llega a BarcodeInput desde los editores.
// data-scan-mode refleja el modo con que se abrirá el cuadro.
const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
try {
  const {default: BarcodeInput} = await vite.ssrLoadModule("/src/components/barcode/BarcodeInput.jsx");
  const {default: QuoteItemsEditor} = await vite.ssrLoadModule("/src/features/quotes/QuoteItemsEditor.jsx");
  const {default: PurchaseOrderItemsEditor} = await vite.ssrLoadModule("/src/features/purchaseOrders/PurchaseOrderItemsEditor.jsx");
  const noop = () => {};
  const scanModes = (markup) => [...markup.matchAll(/<button[^>]*data-scan-mode="([^"]*)"[^>]*>/g)].map((match) => match[1]);

  const quoteMarkup = renderToStaticMarkup(React.createElement(QuoteItemsEditor, {
    feedback: "",
    highlightedItemId: "",
    items: [],
    onMove: noop,
    onOpenCatalog: noop,
    onRemove: noop,
    onScanProduct: async () => ({key: "p1", label: "Producto"}),
    onUpdate: noop,
    subtotal: 0,
    validationError: "",
  }));
  assert.match(quoteMarkup, /Escanear producto/);
  assert.deepEqual(scanModes(quoteMarkup), ["continuous"], "Nueva cotización abre el escaneo continuo.");

  const poProps = {items: [], onChange: noop, onOpenCatalog: noop, onScanProduct: async () => ({key: "p1", label: "Producto"}), readOnly: false};
  assert.deepEqual(scanModes(renderToStaticMarkup(React.createElement(PurchaseOrderItemsEditor, {...poProps, disabled: false}))), ["continuous"], "Nueva OC abre el escaneo continuo.");
  assert.deepEqual(scanModes(renderToStaticMarkup(React.createElement(PurchaseOrderItemsEditor, {...poProps, disabled: true}))), [], "Una OC no editable no ofrece escaneo.");

  assert.deepEqual(scanModes(renderToStaticMarkup(React.createElement(BarcodeInput, {actionOnly: true}))), ["single"], "Sin continuous se mantiene la lectura única.");
  assert.deepEqual(scanModes(renderToStaticMarkup(React.createElement(BarcodeInput, {value: "780", onChange: noop}))), ["single"], "El campo de Inventario sigue en lectura única.");
} finally {
  await vite.close();
}

console.log("BARCODE_SMOKE_OK");
