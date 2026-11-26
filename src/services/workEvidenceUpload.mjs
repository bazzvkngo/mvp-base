// Paso de subida del archivo de evidencia de un gasto (subirEvidenciaGastoTrabajo, workService.js), sin Firebase para
// poder ejecutarlo en las pruebas integradas con el SDK real de los emuladores.
//
// Storage es create-only (storage.rules): subir otra vez la misma ruta se rechaza. Cuando el llamador fija el nombre del
// archivo (`stableFileName`, la compra al paso) un reintento llega a la misma ruta; si en el intento anterior el
// archivo SÍ se había subido y solo falló el registro de su metadata, ese rechazo es esperable y no es un error: se
// comprueba que el objeto exista y se sigue al registro, sin subir de nuevo. Sin nombre fijo no hay reintento sobre la
// misma ruta, así que cualquier fallo de subida es un error.
export async function uploadEvidenceObject({upload, objectExists, stableFileName = ""}) {
  try {
    await upload();
    return {uploaded: true, alreadyUploaded: false};
  } catch (uploadFailure) {
    const alreadyUploaded = stableFileName ? await Promise.resolve().then(objectExists).then(() => true, () => false) : false;
    if (alreadyUploaded) return {uploaded: false, alreadyUploaded: true};
    const error = new Error("No pudimos subir el documento. Intenta nuevamente.");
    error.cause = uploadFailure;
    throw error;
  }
}
