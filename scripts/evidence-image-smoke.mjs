import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {EVIDENCE_IMAGE_MESSAGES, EVIDENCE_IMAGE_QUALITIES, fitEvidenceImageToLimit} from "../src/utils/evidenceImage.mjs";

// Reducción de fotos de evidencia a JPEG antes de rechazarlas por tamaño (src/utils/evidenceImage.mjs). El navegador
// (createImageBitmap y canvas) no existe aquí: se prueba la estrategia con un codificador falso cuyo tamaño depende de
// los píxeles y de la calidad, y la integración en los dos controles de evidencia por texto fuente.

const MB = 1024 * 1024;
const MAX = 5 * MB;
const file = (name, type, size) => ({name, type, size});

// Tamaño del JPEG falso: proporcional a los píxeles y a la calidad.
const makeEnvironment = ({width = 4000, height = 3000, bytesPerPixel = 1, decodeFails = false, emptyBlob = false} = {}) => {
  const calls = {encode: [], released: 0};
  return {
    calls,
    options: {
      maxBytes: MAX,
      decode: async () => { if (decodeFails) throw new Error("formato no soportado"); return {width, height, source: {}, release: () => { calls.released += 1; }}; },
      encode: async (_image, {width: w, height: h, quality}) => { calls.encode.push({w, h, quality}); return emptyBlob ? null : {size: Math.round(w * h * quality * bytesPerPixel), type: "image/jpeg"}; },
      makeFile: (blob, name) => ({name, type: "image/jpeg", size: blob.size}),
    },
  };
};

// 1. Lo que no hay que tocar se devuelve igual: PDF (aunque pese más), imágenes que ya caben y archivos de otro tipo.
{
  const env = makeEnvironment();
  for (const original of [file("planilla.pdf", "application/pdf", 9 * MB), file("boleta.jpg", "image/jpeg", 4 * MB), file("boleta.png", "image/png", MAX), file("foto.webp", "image/webp", 8 * MB)]) {
    const result = await fitEvidenceImageToLimit(original, env.options);
    assert.equal(result.file, original, `${original.name}: sin tocar`); assert.equal(result.compressed, false);
  }
  assert.equal(env.calls.encode.length, 0, "no se codifica nada");
  assert.deepEqual(await fitEvidenceImageToLimit(null, env.options), {file: null, compressed: false, originalSize: 0});
}

// 2. Una foto de cámara de 8 MB (JPG o PNG) se reduce a JPEG, con calidades decrecientes, y queda dentro del límite.
for (const [name, type] of [["IMG 2041.JPG", "image/jpeg"], ["captura.png", "image/png"]]) {
  const env = makeEnvironment({width: 4000, height: 3000, bytesPerPixel: 0.6});
  const result = await fitEvidenceImageToLimit(file(name, type, 8 * MB), env.options);
  assert.equal(result.compressed, true); assert.equal(result.originalSize, 8 * MB);
  assert.equal(result.file.type, "image/jpeg"); assert.ok(result.file.size > 0 && result.file.size <= MAX, `${name}: cabe en 5 MB (${result.file.size})`);
  assert.match(result.file.name, /\.jpg$/, "siempre .jpg, aunque entrara PNG");
  assert.equal(env.calls.released, 1, "la imagen decodificada se libera");
  // Las calidades se prueban de mayor a menor en cada tamaño, sin repetir una que ya falló en ese tamaño.
  let lastSize = ""; let lastQuality = 2;
  for (const call of env.calls.encode) {
    const size = `${call.w}x${call.h}`;
    if (size !== lastSize) { lastSize = size; lastQuality = 2; }
    assert.ok(call.quality < lastQuality, "calidad decreciente dentro de cada tamaño"); lastQuality = call.quality;
    assert.ok(EVIDENCE_IMAGE_QUALITIES.includes(call.quality));
  }
  const last = env.calls.encode.at(-1); assert.ok(last.w <= 2400 && last.h <= 2400, "el lado mayor parte de 2400 como máximo");
}
// Elige la mejor calidad que cabe: con un tamaño que cabe a 0,7 pero no a 0,85, no baja más.
{
  const env = makeEnvironment({width: 2000, height: 1500, bytesPerPixel: 2.4});
  const result = await fitEvidenceImageToLimit(file("foto.jpg", "image/jpeg", 6 * MB), env.options);
  assert.deepEqual(env.calls.encode.map((call) => call.quality), [0.85, 0.7], "se detiene en la primera calidad que cabe");
  assert.ok(result.file.size <= MAX);
}
// Si ninguna calidad cabe, reduce el tamaño de la imagen (nunca la agranda) y vuelve a probar.
{
  const env = makeEnvironment({width: 6000, height: 4000, bytesPerPixel: 8});
  const result = await fitEvidenceImageToLimit(file("foto.jpg", "image/jpeg", 12 * MB), env.options);
  const sizes = [...new Set(env.calls.encode.map((call) => call.w))];
  assert.ok(sizes.length > 1 && sizes.every((width, index) => index === 0 || width < sizes[index - 1]), "cada ronda usa una imagen más chica");
  assert.equal(sizes[0], 2400, "parte del tope de 2400 px en el lado mayor");
  assert.ok(result.file.size <= MAX);
  const small = makeEnvironment({width: 1000, height: 800, bytesPerPixel: 9});
  await fitEvidenceImageToLimit(file("chica.png", "image/png", 7 * MB), small.options).catch(() => {});
  assert.ok(small.calls.encode.every((call) => call.w <= 1000 && call.h <= 800), "una imagen chica nunca se agranda");
}

// 3. Si aun así no cabe: mensaje claro con el límite, y termina (no queda en un ciclo).
{
  const env = makeEnvironment({width: 8000, height: 6000, bytesPerPixel: 400});
  await assert.rejects(() => fitEvidenceImageToLimit(file("enorme.png", "image/png", 40 * MB), env.options), {message: EVIDENCE_IMAGE_MESSAGES.stillTooLarge(MAX)});
  assert.match(EVIDENCE_IMAGE_MESSAGES.stillTooLarge(MAX), /no cabe en 5 MB/); assert.ok(env.calls.encode.length <= EVIDENCE_IMAGE_QUALITIES.length * 8, "intentos acotados");
  assert.ok(env.calls.encode.every((call) => Math.max(call.w, call.h) >= 900), "no baja de 900 px en el lado mayor");
  assert.equal(env.calls.released, 1, "también se libera si falla");
}

// 4. Errores de lectura y de conversión, con su mensaje.
await assert.rejects(() => fitEvidenceImageToLimit(file("rota.jpg", "image/jpeg", 8 * MB), makeEnvironment({decodeFails: true}).options), {message: EVIDENCE_IMAGE_MESSAGES.unreadable});
await assert.rejects(() => fitEvidenceImageToLimit(file("vacia.jpg", "image/jpeg", 8 * MB), makeEnvironment({emptyBlob: true}).options), {message: EVIDENCE_IMAGE_MESSAGES.convertFailed});
await assert.rejects(() => fitEvidenceImageToLimit(file("sinnavegador.jpg", "image/jpeg", 8 * MB), {maxBytes: MAX}), {message: EVIDENCE_IMAGE_MESSAGES.unreadable}, "sin canvas ni createImageBitmap (como en Node) falla con el mensaje de lectura");

// 5. Nombres: espacios, mayúsculas y sin nombre.
for (const [original, expected] of [["Foto de la boleta.PNG", "Foto de la boleta.jpg"], ["sin-extension", "sin-extension.jpg"], ["", "foto.jpg"]]) {
  const result = await fitEvidenceImageToLimit(file(original, "image/png", 8 * MB), makeEnvironment({bytesPerPixel: 0.3}).options);
  assert.equal(result.file.name, expected);
}
// El archivo real (File de Node) también se arma bien con el valor por defecto de makeFile.
{
  const env = makeEnvironment({bytesPerPixel: 0.3}); delete env.options.makeFile;
  const result = await fitEvidenceImageToLimit(file("real.png", "image/png", 8 * MB), env.options);
  assert.ok(result.file instanceof File); assert.equal(result.file.type, "image/jpeg"); assert.equal(result.file.name, "real.jpg");
}

// 6. Integración: los dos controles reducen la foto ANTES de validar el tamaño y muestran el mensaje claro.
{
  const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
  const quick = await read("../src/features/works/WorkQuickPurchase.jsx");
  const evidence = await read("../src/features/works/WorkExpenseEvidence.jsx");
  for (const [label, source, validateCall] of [["compra al paso", quick, "validateWorkExpenseEvidenceSelection(selected, 0)"], ["evidencia de gastos", evidence, "validateWorkExpenseEvidenceSelection(file, entries.length)"]]) {
    assert.match(source, /import \{fitEvidenceImageToLimit\} from "\.\.\/\.\.\/utils\/evidenceImage\.mjs";/, `${label}: usa la utilidad`);
    assert.match(source, /fitEvidenceImageToLimit\(picked, \{maxBytes: MAX_WORK_EXPENSE_EVIDENCE_BYTES\}\)/, `${label}: con el límite de la evidencia`);
    assert.ok(source.indexOf("fitEvidenceImageToLimit(picked") < source.indexOf(validateCall), `${label}: reduce antes de validar el tamaño`);
    assert.match(source, /catch \(failure\) \{\s*setFileError\(failure\.message\)|\(failure\) => setSelectionError\(failure\.message\)/, `${label}: muestra el mensaje claro si no cabe`);
  }
  assert.match(quick, /<LoadingState variant="inline" label="Preparando la foto\.\.\." \/>/, "avisa mientras prepara la foto, con el componente del sistema");
  assert.doesNotMatch(await read("../src/utils/evidenceImage.mjs"), /from ["'](firebase|\.\.\/services)/, "sin Firebase ni servicios");
}

console.log("EVIDENCE_IMAGE_SMOKE_OK");
