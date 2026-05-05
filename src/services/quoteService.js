import { getFunctions, httpsCallable } from "firebase/functions";
import "../firebase/firebaseConfig";
import {
  generarPropuestaCotizacion,
  normalizarPropuesta,
} from "../domain/pricing";

let cachedSimularCotizacionProyecto = null;

function getSimularCotizacionCallable() {
  if (!cachedSimularCotizacionProyecto) {
    const functions = getFunctions();
    cachedSimularCotizacionProyecto = httpsCallable(
      functions,
      "simularCotizacionProyecto"
    );
  }
  return cachedSimularCotizacionProyecto;
}

export { generarPropuestaCotizacion, normalizarPropuesta };

export async function cotizarProyecto(params) {
  const {
    tipoProyecto,
    descripcionProyecto,
    distanciaKm,
    nivelCalidad,
    presupuestoReferencia,
    respuestasCuestionario,
  } = params || {};

  const callable = getSimularCotizacionCallable();
  const response = await callable({
    tipoProyecto: tipoProyecto || "",
    descripcion: descripcionProyecto || "",
    distanciaKm:
      distanciaKm !== undefined && distanciaKm !== null
        ? Number(distanciaKm)
        : null,
    nivelCalidad: nivelCalidad || "",
    presupuestoReferencia:
      presupuestoReferencia !== undefined && presupuestoReferencia !== null
        ? Number(presupuestoReferencia)
        : null,
    respuestasCuestionario: respuestasCuestionario || null,
  });

  return response.data;
}
