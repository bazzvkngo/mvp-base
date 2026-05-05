// src/services/cotizacionService.js

// ---------------------------------------------------------------------------
// Capa de infraestructura: conexión con Cloud Functions (backend)
// ---------------------------------------------------------------------------
import { getFunctions, httpsCallable } from "firebase/functions";
import "../firebaseConfig"; // inicializa la app por defecto

/**
 * Usamos un pequeño "cache" para no recrear el callable en cada llamada.
 * Esto sigue siendo simple, pero ordenado para la tesis.
 */
let cachedSimularCotizacionProyecto = null;

function getSimularCotizacionCallable() {
  if (!cachedSimularCotizacionProyecto) {
    const functions = getFunctions(); // usa la app por defecto
    cachedSimularCotizacionProyecto = httpsCallable(
      functions,
      "simularCotizacionProyecto"
    );
  }
  return cachedSimularCotizacionProyecto;
}

// ---------------------------------------------------------------------------
// Capa de dominio: lógica pura de generación de propuesta (TESTEABLE)
//  (Este es tu código original)
// ---------------------------------------------------------------------------

// Config por defecto (se mezcla con la configuración guardada del negocio)
const DEFAULT_CONFIG = {
  valorHoraBase: 15000, // CLP
  margenEcon: 0.15, // 15%
  margenStd: 0.25, // 25%
  margenPremium: 0.35, // 35%
};

function normalizarNumero(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizarConfigNegocio(configNegocio) {
  const raw = configNegocio || {};
  return {
    valorHoraBase: normalizarNumero(
      raw.valorHoraBase,
      DEFAULT_CONFIG.valorHoraBase
    ),
    margenEcon:
      typeof raw.margenEcon === "number"
        ? raw.margenEcon
        : DEFAULT_CONFIG.margenEcon,
    margenStd:
      typeof raw.margenStd === "number"
        ? raw.margenStd
        : DEFAULT_CONFIG.margenStd,
    margenPremium:
      typeof raw.margenPremium === "number"
        ? raw.margenPremium
        : DEFAULT_CONFIG.margenPremium,
  };
}

/**
 * Selecciona materiales "relevantes" desde el inventario
 * según el texto del proyecto.
 *
 * Esta heurística es simple y transparente, pensada para el MVP.
 */
function seleccionarMateriales(inventario, descripcionProyecto) {
  const lista = Array.isArray(inventario) ? inventario : [];
  const desc = (descripcionProyecto || "").toLowerCase();

  if (!desc && lista.length <= 20) {
    // Sin descripción, pero inventario pequeño → tomamos todo como base
    return lista.filter((item) => (item.tipoItem || "producto") !== "servicio");
  }

  const tokens = desc
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4);

  return lista.filter((item) => {
    const tipo = (item.tipoItem || "producto").toLowerCase();
    if (tipo === "servicio") return false;

    const texto = `${item.nombre || ""} ${item.categoria || ""} ${
      item.sku || ""
    }`
      .toLowerCase()
      .trim();

    if (!texto) return false;

    // match básico por palabra clave
    const hayMatch = tokens.some((tk) => texto.includes(tk));

    return hayMatch;
  });
}

/**
 * Genera una propuesta de cotización en base al inventario y a los
 * parámetros del proyecto. No depende de Firebase ni de la UI.
 *
 * Parámetros esperados:
 * - inventario: array de productos/servicios
 * - tipoProyecto: string
 * - nivelCalidad: "economico" | "estandar" | "premium"
 * - distanciaKm: number
 * - presupuestoReferencia: number | null
 * - descripcionProyecto: string
 * - configNegocio: objeto de config (opcional)
 */
export function generarPropuestaCotizacion({
  inventario,
  tipoProyecto,
  nivelCalidad,
  distanciaKm = 0,
  presupuestoReferencia = null,
  descripcionProyecto,
  configNegocio,
}) {
  const cfg = normalizarConfigNegocio(configNegocio);
  const calidad = nivelCalidad || "estandar";
  const dist = normalizarNumero(distanciaKm, 0);
  const desc = descripcionProyecto || "";
  const tipo = tipoProyecto || "";

  // 1) Seleccionar materiales relevantes
  const materialesBase = seleccionarMateriales(inventario, desc);

  // Cantidad sugerida simple: 1 de cada uno (MVP).
  const materialesSeleccionados = materialesBase.map((item, index) => {
    const cantidad = 1;
    const precioUnitario = normalizarNumero(
      item.precio ?? item.precioInterno,
      0
    );
    const subtotal = cantidad * precioUnitario;

    return {
      id: item.id || `item-${index}`,
      nombre: item.nombre || "Ítem sin nombre",
      categoria: item.categoria || "",
      unidad: item.unidad || "unidad",
      cantidad,
      precioUnitario,
      subtotal,
    };
  });

  const costoMateriales = materialesSeleccionados.reduce(
    (acc, item) => acc + item.subtotal,
    0
  );

  // 2) Mano de obra: heurística básica según cantidad de materiales
  const baseHoras = 4; // proyecto chico
  const horasPorMaterial = 0.5;
  let horasTecnico =
    baseHoras + materialesSeleccionados.length * horasPorMaterial;

  // Ajuste simple por tipo de proyecto
  const tipoLower = tipo.toLowerCase();
  if (tipoLower.includes("cámara") || tipoLower.includes("camara")) {
    horasTecnico += 2;
  }
  if (tipoLower.includes("red") || tipoLower.includes("network")) {
    horasTecnico += 1;
  }

  horasTecnico = Math.max(2, Math.round(horasTecnico));
  const costoManoObra = horasTecnico * cfg.valorHoraBase;

  // 3) Transporte: depende de kilómetros de referencia
  let costoTransporte = 0;
  if (dist > 0) {
    // Cobro base + costo variable por km
    costoTransporte = 5000 + dist * 500;
  }

  // 4) Costo base = materiales + mano de obra + transporte
  const costoBase =
    Math.round(costoMateriales) +
    Math.round(costoManoObra) +
    Math.round(costoTransporte);

  // 5) Aplicar márgenes según nivel de calidad
  let margenBase = cfg.margenStd;
  if (calidad === "economico") margenBase = cfg.margenEcon;
  if (calidad === "premium") margenBase = cfg.margenPremium;

  const precioMin = Math.round(costoBase * (1 + margenBase * 0.7));
  const precioRecomendado = Math.round(costoBase * (1 + margenBase));
  const precioMax = Math.round(costoBase * (1 + margenBase * 1.35));

  const margenAprox =
    precioRecomendado > 0
      ? ((precioRecomendado - costoBase) / precioRecomendado) * 100
      : margenBase * 100;

  const manoObra = {
    horasTecnico,
    valorHora: cfg.valorHoraBase,
    costoManoObra: Math.round(costoManoObra),
  };

  const transporte = {
    distanciaKm: dist,
    costoTransporte: Math.round(costoTransporte),
  };

  const estrategia = `heuristica_local_${calidad}`;

  return {
    // KPIs esperados por el componente Cotizador.jsx
    costoBase: Math.round(costoBase),
    precioMin,
    precioRecomendado,
    precioMax,
    margenAprox,

    // Sección de materiales
    materialesSeleccionados,

    // Mano de obra y transporte
    manoObra,
    transporte,

    // Metadatos
    estrategia,
    presupuestoReferencia: presupuestoReferencia ?? null,
    tipoProyecto,
    nivelCalidad: calidad,
    descripcionProyecto: desc,
  };
}

/**
 * Hook para normalizar propuestas si más adelante queremos
 * persistirlas o versionarlas. Por ahora solo devuelve lo mismo.
 */
export function normalizarPropuesta(propuesta) {
  return propuesta;
}

// ---------------------------------------------------------------------------
// Capa de servicio: fachada principal orientada a la UI / flujo de tesis
// ---------------------------------------------------------------------------

/**
 * cotizarProyecto
 *
 * Esta es la función que debería usar un flujo que llame a la Cloud Function
 * `simularCotizacionProyecto`. La dejamos lista aunque hoy Cotizador.jsx
 * usa sólo la función local generarPropuestaCotizacion.
 */
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

  const payload = {
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
  };

  const response = await callable(payload);
  return response.data;
}
