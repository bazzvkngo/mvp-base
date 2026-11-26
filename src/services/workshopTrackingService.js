import {httpsCallable} from "firebase/functions";
import {getFirebaseFunctions} from "../firebase/firebaseConfig";
import {TRACKING_TOKEN_PATTERN} from "../domain/workOrderTrackingModel.mjs";

// Consultas públicas (sin sesión) del seguimiento del Taller. Los mensajes de error son genéricos a propósito:
// no revelan si el vehículo, el taller o el enlace existen.
const FUNCTIONS_REGION = "us-central1";
const INACTIVE_LINK = "Este enlace ya no está activo.";
const NOT_FOUND = "No encontramos un vehículo en el taller con esos datos.";

function trackingError(error, fallback) {
  const code = String(error?.code || "");
  const failure = new Error(fallback);
  if (code.includes("resource-exhausted")) {
    failure.message = "Demasiados intentos. Intenta nuevamente en unos minutos.";
    failure.blocked = true;
  } else if (code.includes("invalid-argument") && error?.message) {
    failure.message = error.message;
  }
  return failure;
}

export async function consultarSeguimientoTaller(token) {
  if (!TRACKING_TOKEN_PATTERN.test(String(token || ""))) throw new Error(INACTIVE_LINK);
  try {
    const response = await httpsCallable(getFirebaseFunctions(FUNCTIONS_REGION), "consultarSeguimientoTaller")({token});
    return response.data?.seguimiento || null;
  } catch (error) {
    throw trackingError(error, INACTIVE_LINK);
  }
}

export async function buscarSeguimientoTaller(patente, rut) {
  try {
    const response = await httpsCallable(getFirebaseFunctions(FUNCTIONS_REGION), "buscarSeguimientoTaller")({patente, rut});
    return response.data?.seguimiento || null;
  } catch (error) {
    throw trackingError(error, NOT_FOUND);
  }
}
