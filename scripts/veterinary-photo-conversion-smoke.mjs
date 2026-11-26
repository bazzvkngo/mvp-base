import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source = readFileSync(new URL("../src/features/veterinary/attention/VeterinaryPhotoMap.jsx", import.meta.url), "utf8");
const encodingSource = readFileSync(new URL("../src/features/veterinary/domain/photoEncoding.mjs", import.meta.url), "utf8");
const convert = encodingSource.replace("export async function", "async function");
async function run(blobs, options) {
  let closed = false;
  const qualities = [];
  const context = vm.createContext({
    createImageBitmap: async () => ({width: 2400, height: 1200, close: () => { closed = true; }}),
    document: {createElement: () => ({getContext: () => ({fillRect() {}, drawImage() {}}), toBlob: (callback, type, quality) => { qualities.push(quality); callback(blobs.shift()); }})},
    FileReader: class { readAsDataURL() { this.result = "data:image/jpeg;base64,TEST"; this.onload(); } },
  });
  try { return {value: await vm.runInContext(convert + "imageAsJpeg({}, " + JSON.stringify(options) + ")", context), qualities}; }
  finally { assert.equal(closed, true); }
}
for (const blob of [null, {type: "image/png", size: 10}, {type: "image/jpeg", size: 0}]) {
  await assert.rejects(run([blob]), /No se pudo convertir la foto a JPEG/);
}
const large = {type: "image/jpeg", size: 2 * 1024 * 1024 + 1};
await assert.rejects(run([large, large, large]), /supera los 2 MiB/);
assert.deepEqual(await run([large, {type: "image/jpeg", size: 100}]), {value: "TEST", qualities: [0.82, 0.65]});
const avatarOptions = {maxSide: 512, maxBytes: 192 * 1024, sizeLabel: "192 KiB"};
await assert.rejects(run([large, large, large], avatarOptions), /supera los 192 KiB/);
assert.deepEqual(await run([{type: "image/jpeg", size: 100}], avatarOptions), {value: "TEST", qualities: [0.82]});

// Una sola lista de nombres de vista: pestañas y "Vistas que faltan" usan los mismos textos.
assert.doesNotMatch(source, /viewButtons|"Frente"|"Atrás"|"Arriba"|"Abajo"/);
assert.match(source, /Object\.entries\(views\)\.filter/);
// El conteo de fotos sale de la atención, no del lote recién subido.
assert.match(source, /Fotos guardadas en la atención: \{photos\.length\} de 12\./);
assert.doesNotMatch(source, /uploaded === 1 \? "1 foto guardada\./);
// Se avisa cuando una foto se reduce para cumplir el límite de 2 MiB.
assert.match(source, /se redujo a .* para cumplir el límite de 2 MiB/s);
// Solo lectura (historial y atención cerrada): sin textos de edición.
assert.match(source, /\{!closed && \(\s*<>\s*<p>Agrega fotos de esta mascota/);
assert.match(source, /closed \? "Fotos clínicas"/);
const attentionSource = readFileSync(new URL("../src/features/veterinary/attention/VeterinaryAttention.jsx", import.meta.url), "utf8");
assert.match(attentionSource, /Guardar borrador/);
assert.match(attentionSource, /"borrador"/);
assert.match(attentionSource, /attention\.borrador/);
const detailSource = readFileSync(new URL("../src/features/veterinary/patients/PatientDetail.jsx", import.meta.url), "utf8");
assert.match(detailSource, /Resultado clínico:/);
assert.doesNotMatch(detailSource, /Edad al registro/);
const patientsSource = readFileSync(new URL("../src/features/veterinary/patients/VeterinaryPatients.jsx", import.meta.url), "utf8");
assert.doesNotMatch(patientsSource, /Edad al registro/);
console.log("VETERINARY_PHOTO_CONVERSION_SMOKE_OK");
