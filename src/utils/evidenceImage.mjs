// Reduce una foto (JPG o PNG) a JPEG en el navegador hasta que quepa en el límite de la evidencia, ANTES de rechazarla
// por tamaño. Una foto de cámara de celular suele pasar de 5 MB y la persona no debería tener que reducirla a mano.
//
// - Solo toca JPG y PNG que superan el límite: lo que ya cabe, y cualquier otro tipo (el PDF, por ejemplo), se devuelve
//   tal cual; la validación de tipo y tamaño sigue siendo la de siempre (validateWorkExpenseEvidenceSelection).
// - Estrategia: dibuja la imagen en un canvas (fondo blanco, porque JPEG no tiene transparencia) y prueba calidades
//   decrecientes; si ninguna cabe, reduce el lado mayor y vuelve a probar. Se detiene en un lado mínimo para no dejar el
//   documento ilegible y, si aun así no cabe, falla con un mensaje claro.
// - `decode` y `encode` son inyectables: los de navegador (createImageBitmap y canvas) son los de por defecto y la prueba
//   (scripts/evidence-image-smoke.mjs) usa unos falsos. Sin importar Firebase ni servicios.

export const EVIDENCE_IMAGE_QUALITIES = Object.freeze([0.85, 0.7, 0.55, 0.4]);
export const EVIDENCE_IMAGE_MAX_SIDE = 2400;
export const EVIDENCE_IMAGE_MIN_SIDE = 900;
const COMPRESSIBLE_TYPES = new Set(["image/jpeg", "image/png"]);
const SIDE_STEP = 0.75;

export const EVIDENCE_IMAGE_MESSAGES = Object.freeze({
  unreadable: "No pudimos leer la imagen. Prueba con otra foto o con un PDF.",
  convertFailed: "No pudimos convertir la foto a JPEG. Prueba con otra foto o con un PDF.",
  stillTooLarge: (maxBytes) => `Aun reduciendo la foto no cabe en ${Math.round(maxBytes / (1024 * 1024))} MB. Toma la foto de nuevo con menos resolución o elige otro archivo.`,
});

async function browserDecode(file) {
  if (typeof createImageBitmap !== "function") throw new Error("createImageBitmap no disponible");
  const bitmap = await createImageBitmap(file);
  return {width: bitmap.width, height: bitmap.height, source: bitmap, release: () => bitmap.close?.()};
}

async function browserEncode(image, {width, height, quality}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", {alpha: false});
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
  context.drawImage(image.source, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

const jpegName = (name) => `${String(name || "foto").replace(/\.[^./\\]+$/, "") || "foto"}.jpg`;

function browserMakeFile(blob, name) {
  return new File([blob], name, {type: "image/jpeg", lastModified: Date.now()});
}

// Devuelve {file, compressed, originalSize}. `file` es el mismo archivo si no hizo falta tocarlo.
export async function fitEvidenceImageToLimit(file, {maxBytes, decode = browserDecode, encode = browserEncode, makeFile = browserMakeFile, qualities = EVIDENCE_IMAGE_QUALITIES, maxSide = EVIDENCE_IMAGE_MAX_SIDE, minSide = EVIDENCE_IMAGE_MIN_SIDE} = {}) {
  if (!file || !COMPRESSIBLE_TYPES.has(file.type) || !(file.size > maxBytes)) return {file, compressed: false, originalSize: file?.size || 0};
  let image;
  try {
    image = await decode(file);
  } catch {
    throw new Error(EVIDENCE_IMAGE_MESSAGES.unreadable);
  }
  try {
    const longSide = Math.max(image.width, image.height);
    if (!(longSide > 0)) throw new Error(EVIDENCE_IMAGE_MESSAGES.unreadable);
    // Lado mayor de partida: nunca se agranda; luego baja de a 25 % hasta el mínimo (o hasta el tamaño original si ya era menor).
    const floorSide = Math.min(longSide, minSide);
    for (let side = Math.min(longSide, maxSide); ; side = Math.max(floorSide, Math.round(side * SIDE_STEP))) {
      const scale = side / longSide;
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      for (const quality of qualities) {
        const blob = await encode(image, {width, height, quality});
        if (!blob || !(blob.size > 0)) throw new Error(EVIDENCE_IMAGE_MESSAGES.convertFailed);
        if (blob.size <= maxBytes) return {file: makeFile(blob, jpegName(file.name)), compressed: true, originalSize: file.size};
      }
      if (side <= floorSide) break;
    }
    throw new Error(EVIDENCE_IMAGE_MESSAGES.stillTooLarge(maxBytes));
  } finally {
    image.release?.();
  }
}
