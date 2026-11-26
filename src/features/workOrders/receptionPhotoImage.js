// Convierte la foto elegida o tomada con la cámara a JPEG de hasta 2 MiB (mismo patrón que las fotos clínicas).
// Redibujar en un canvas descarta los metadatos del archivo original (ubicación, dispositivo, fecha);
// el servidor vuelve a quitarlos antes de guardar.
export const RECEPTION_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

export async function receptionImageAsJpeg(file) {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("No se pudo leer la imagen. Comprueba que sea un JPEG, PNG o WebP válido.");
  });
  try {
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", {alpha: false});
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.65, 0.45]) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob || blob.type !== "image/jpeg" || !blob.size) {
        throw new Error("No se pudo convertir la foto a JPEG. Prueba con otra imagen o navegador.");
      }
      if (blob.size <= RECEPTION_PHOTO_MAX_BYTES) {
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(new Error("No se pudo preparar la foto para subirla."));
          reader.readAsDataURL(blob);
        });
      }
    }
    throw new Error("La foto supera los 2 MiB incluso reducida. Toma la foto con menos resolución o elige otra.");
  } finally {
    bitmap.close();
  }
}
