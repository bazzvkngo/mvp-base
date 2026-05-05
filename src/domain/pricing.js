const DEFAULT_CONFIG = {
  valorHoraBase: 15000,
  margenEcon: 0.15,
  margenStd: 0.25,
  margenPremium: 0.35,
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

export function seleccionarMateriales(inventario, descripcionProyecto) {
  const lista = Array.isArray(inventario) ? inventario : [];
  const desc = (descripcionProyecto || "").toLowerCase();

  if (!desc && lista.length <= 20) {
    return lista.filter((item) => (item.tipoItem || "producto") !== "servicio");
  }

  const tokens = desc
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);

  return lista.filter((item) => {
    const tipo = (item.tipoItem || "producto").toLowerCase();
    if (tipo === "servicio") return false;

    const texto = `${item.nombre || ""} ${item.categoria || ""} ${
      item.sku || ""
    }`
      .toLowerCase()
      .trim();

    return texto && tokens.some((token) => texto.includes(token));
  });
}

export function calcularPreciosPorMargen(costoBase, nivelCalidad, configNegocio) {
  const cfg = normalizarConfigNegocio(configNegocio);
  const calidad = nivelCalidad || "estandar";

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

  return {
    precioMin,
    precioRecomendado,
    precioMax,
    margenAprox,
    estrategia: `heuristica_local_${calidad}`,
  };
}

export const pricingStrategies = {
  margen_simple: calcularPreciosPorMargen,
};

export function getPricingStrategy(strategyName = "margen_simple") {
  return pricingStrategies[strategyName] || pricingStrategies.margen_simple;
}

export function generarPropuestaCotizacion({
  inventario,
  tipoProyecto,
  nivelCalidad,
  distanciaKm = 0,
  presupuestoReferencia = null,
  descripcionProyecto,
  configNegocio,
  strategyName = "margen_simple",
}) {
  const cfg = normalizarConfigNegocio(configNegocio);
  const calidad = nivelCalidad || "estandar";
  const dist = normalizarNumero(distanciaKm, 0);
  const desc = descripcionProyecto || "";
  const tipo = tipoProyecto || "";

  const materialesBase = seleccionarMateriales(inventario, desc);
  const materialesSeleccionados = materialesBase.map((item, index) => {
    const cantidad = 1;
    const precioUnitario = normalizarNumero(
      item.precio ?? item.precioInterno,
      0
    );

    return {
      id: item.id || `item-${index}`,
      nombre: item.nombre || "Item sin nombre",
      categoria: item.categoria || "",
      unidad: item.unidad || "unidad",
      cantidad,
      precioUnitario,
      subtotal: cantidad * precioUnitario,
    };
  });

  const costoMateriales = materialesSeleccionados.reduce(
    (acc, item) => acc + item.subtotal,
    0
  );

  let horasTecnico = 4 + materialesSeleccionados.length * 0.5;
  const tipoLower = tipo.toLowerCase();
  if (tipoLower.includes("camara") || tipoLower.includes("cámara")) {
    horasTecnico += 2;
  }
  if (tipoLower.includes("red") || tipoLower.includes("network")) {
    horasTecnico += 1;
  }

  horasTecnico = Math.max(2, Math.round(horasTecnico));
  const costoManoObra = horasTecnico * cfg.valorHoraBase;
  const costoTransporte = dist > 0 ? 5000 + dist * 500 : 0;
  const costoBase =
    Math.round(costoMateriales) +
    Math.round(costoManoObra) +
    Math.round(costoTransporte);

  const strategy = getPricingStrategy(strategyName);
  const precios = strategy(costoBase, calidad, cfg);

  return {
    costoBase,
    ...precios,
    materialesSeleccionados,
    manoObra: {
      horasTecnico,
      valorHora: cfg.valorHoraBase,
      costoManoObra: Math.round(costoManoObra),
    },
    transporte: {
      distanciaKm: dist,
      costoTransporte: Math.round(costoTransporte),
    },
    presupuestoReferencia: presupuestoReferencia ?? null,
    tipoProyecto,
    nivelCalidad: calidad,
    descripcionProyecto: desc,
  };
}

export function normalizarPropuesta(propuesta) {
  return propuesta;
}
