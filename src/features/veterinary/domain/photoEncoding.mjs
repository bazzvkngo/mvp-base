export async function imageAsJpeg(file, {maxSide = 1800, maxBytes = 2 * 1024 * 1024, sizeLabel = "2 MiB"} = {}) {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("No se pudo leer la imagen. Comprueba que sea un JPEG, PNG o WebP válido.");
  });
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", {alpha: false});
    if (!context) throw new Error("No se pudo preparar la imagen para guardarla.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.65, 0.45]) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob || blob.type !== "image/jpeg" || !blob.size) {
        throw new Error("No se pudo convertir la foto a JPEG. Prueba con otra imagen o navegador.");
      }
      if (blob.size <= maxBytes) {
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(new Error("No se pudo preparar la foto para subirla."));
          reader.readAsDataURL(blob);
        });
      }
    }
    throw new Error("El JPEG convertido supera los " + sizeLabel + ". Reduce el tamaño de la imagen o elige otra foto.");
  } finally {
    bitmap.close();
  }
}
