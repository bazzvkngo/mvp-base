import {
  calculateBasePrice,
  calculateEffectiveInternalPrice,
} from "./pricing.js";
import {formatChileanRut} from "./fiscalIdentifier.mjs";

export const INVENTORY_TYPES = Object.freeze([
  { value: "producto", label: "Producto", description: "Ítem físico con control de stock." },
  { value: "servicio", label: "Servicio", description: "Prestación valorizada sin stock." },
  { value: "actividad", label: "Actividad", description: "Trabajo o tarea valorizada sin stock." },
]);

export const INVENTORY_UNITS = Object.freeze([
  { value: "unidad", label: "Unidad (und)", group: "Generales" },
  { value: "servicio", label: "Servicio", group: "Generales" },
  { value: "actividad", label: "Actividad", group: "Generales" },
  { value: "tarea", label: "Tarea", group: "Generales" },
  { value: "proyecto", label: "Proyecto", group: "Generales" },
  { value: "hora", label: "Hora (h)", group: "Generales" },
  { value: "jornada", label: "Jornada", group: "Generales" },
  { value: "dia", label: "Día", group: "Generales" },
  { value: "mes", label: "Mes", group: "Generales" },
  { value: "kg", label: "Kilogramo (kg)", group: "Peso" },
  { value: "g", label: "Gramo (g)", group: "Peso" },
  { value: "mg", label: "Miligramo (mg)", group: "Peso" },
  { value: "L", label: "Litro (L)", group: "Volumen" },
  { value: "mL", label: "Mililitro (mL)", group: "Volumen" },
  { value: "m", label: "Metro (m)", group: "Longitud" },
  { value: "cm", label: "Centímetro (cm)", group: "Longitud" },
  { value: "mm", label: "Milímetro (mm)", group: "Longitud" },
  { value: "in", label: "Pulgada (in)", group: "Longitud" },
  { value: "m2", label: "Metro cuadrado (m²)", group: "Superficie y volumen" },
  { value: "cm2", label: "Centímetro cuadrado (cm²)", group: "Superficie y volumen" },
  { value: "m3", label: "Metro cúbico (m³)", group: "Superficie y volumen" },
]);

const TYPE_VALUES = new Set(INVENTORY_TYPES.map(({ value }) => value));

export const INVENTORY_PRICE_FORMATION_VERSION = 2;

export function normalizeInventoryText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeInventoryRequestedCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "-");
}

export function parseInventoryNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^-?[\d\s.,$%]+$/.test(raw)) return null;
  const compact = raw.replace(/[\s$%]/g, "");
  if (!/^-?\d+(?:[.,]\d+)*$/.test(compact)) return null;

  const negative = compact.startsWith("-");
  const unsigned = negative ? compact.slice(1) : compact;
  const isThousandsGrouping = (text, separator) => {
    const groups = text.split(separator);
    return groups.length > 1 && /^\d{1,3}$/.test(groups[0]) &&
      groups.slice(1).every((group) => /^\d{3}$/.test(group));
  };
  const commaCount = (unsigned.match(/,/g) || []).length;
  const dotCount = (unsigned.match(/\./g) || []).length;
  let normalized = unsigned;

  if (commaCount && dotCount) {
    const decimalSeparator = unsigned.lastIndexOf(",") > unsigned.lastIndexOf(".")
      ? ","
      : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    const decimalParts = unsigned.split(decimalSeparator);
    if (decimalParts.length !== 2 || !/^\d+$/.test(decimalParts[1])) return null;
    const integerPart = decimalParts[0];
    if (
      integerPart.includes(thousandsSeparator) &&
      !isThousandsGrouping(integerPart, thousandsSeparator)
    ) return null;
    if (!integerPart.includes(thousandsSeparator) && !/^\d+$/.test(integerPart)) {
      return null;
    }
    normalized = `${integerPart.split(thousandsSeparator).join("")}.${decimalParts[1]}`;
  } else if (commaCount || dotCount) {
    const separator = commaCount ? "," : ".";
    const separatorCount = commaCount || dotCount;
    const parts = unsigned.split(separator);
    if (separatorCount > 1) {
      if (!isThousandsGrouping(unsigned, separator)) return null;
      normalized = parts.join("");
    } else if (
      separator === "." &&
      parts[1].length === 3 &&
      isThousandsGrouping(unsigned, separator)
    ) {
      normalized = parts.join("");
    } else {
      normalized = `${parts[0]}.${parts[1]}`;
    }
  }

  if (negative) normalized = `-${normalized}`;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function getDefaultUnitForType(type) {
  if (type === "servicio") return "servicio";
  if (type === "actividad") return "actividad";
  return "unidad";
}

export function getInventoryTypeLabel(type) {
  return INVENTORY_TYPES.find(({ value }) => value === type)?.label || "Ítem";
}

export function hasPurchaseTaxPriceFormation(item = {}) {
  return item.tipoItem === "producto" &&
    Number(item.formacionPrecioVersion) === INVENTORY_PRICE_FORMATION_VERSION;
}

export function calculateInventoryPriceFormation(item = {}) {
  const costoBase = Number(item.costoBase);
  const tasaImpuestoCompra = Number(item.tasaImpuestoCompra);
  const margenDeseado = Number(item.margenDeseado);
  const safeCost = Number.isFinite(costoBase) ? Math.max(costoBase, 0) : 0;
  const safeTaxRate = Number.isFinite(tasaImpuestoCompra)
    ? Math.min(Math.max(tasaImpuestoCompra, 0), 100)
    : 0;
  const safeMarkup = Number.isFinite(margenDeseado) ? Math.max(margenDeseado, 0) : 0;
  const montoImpuestoCompra = Math.round(safeCost * safeTaxRate / 100);
  const costoPagado = Math.round(safeCost * (1 + safeTaxRate / 100));
  const precioVentaSugerido = Math.round(
    safeCost * (1 + safeTaxRate / 100) * (1 + safeMarkup / 100)
  );
  const manualPrice = Number(item.precioInterno);
  const hasManualPrice = item.precioManual === true &&
    Number.isFinite(manualPrice) && manualPrice > 0;

  return {
    tasaImpuestoCompra: safeTaxRate,
    montoImpuestoCompra,
    costoPagado,
    precioVentaSugerido,
    precioVentaFinal: hasManualPrice ? manualPrice : precioVentaSugerido,
  };
}

export function adaptInventoryItem(item = {}) {
  const type = TYPE_VALUES.has(item.tipoItem) ? item.tipoItem : "producto";
  const barcode = type === "producto"
    ? String(item.barcode || item.codigoBarras || "").trim()
    : "";
  const cost = Number(
    item.costoBase ?? item.costo ?? item.precioCompra ?? item.precio ?? 0
  );
  const margin = Number(item.margenDeseado ?? item.margen ?? 0);
  const adapted = {
    ...item,
    codigoInterno: String(item.codigoInterno || item.sku || "").trim(),
    tipoItem: type,
    estado: item.estado || "activo",
    nombre: String(item.nombre || item.descripcionItem || "Ítem sin nombre").trim(),
    marca: type === "producto" ? String(item.marca || "").trim() : "",
    modelo: type === "producto" ? String(item.modelo || "").trim() : "",
    barcode,
    codigoBarras: barcode,
    proveedorNombre: type === "producto" ? String(item.proveedorNombre || "").trim() : "",
    proveedorRut: type === "producto" ? formatChileanRut(item.proveedorRut || "") : "",
    fechaCompraReferencia: type === "producto"
      ? String(item.fechaCompraReferencia || "").trim()
      : "",
    numeroFacturaReferencia: type === "producto"
      ? String(item.numeroFacturaReferencia || "").trim()
      : "",
    unidad: String(item.unidad || getDefaultUnitForType(type)).trim(),
    costoBase: Number.isFinite(cost) ? cost : 0,
    margenDeseado: Number.isFinite(margin) ? margin : 0,
    stock: type === "producto" && Number.isFinite(Number(item.stock)) ? Number(item.stock) : 0,
    stockMinimo:
      type === "producto" && Number.isFinite(Number(item.stockMinimo))
        ? Number(item.stockMinimo)
        : 0,
  };
  if (hasPurchaseTaxPriceFormation(adapted)) {
    const formation = calculateInventoryPriceFormation(adapted);
    Object.assign(adapted, formation);
    adapted.precioCalculado = formation.precioVentaSugerido;
    adapted.precioEfectivo = Math.round(formation.precioVentaFinal);
  } else {
    adapted.tasaImpuestoCompra = 0;
    adapted.montoImpuestoCompra = 0;
    adapted.costoPagado = adapted.costoBase;
    adapted.precioVentaSugerido = Math.round(calculateBasePrice(adapted));
    adapted.precioCalculado = adapted.precioVentaSugerido;
    adapted.precioEfectivo = Math.round(calculateEffectiveInternalPrice(adapted));
  }
  const averageCost = item.costoPromedio === "" || item.costoPromedio == null
    ? null
    : Number(item.costoPromedio);
  const lastCost = item.ultimoCosto === "" || item.ultimoCosto == null
    ? null
    : Number(item.ultimoCosto);
  const inventoryValue = item.valorInventario === "" || item.valorInventario == null
    ? null
    : Number(item.valorInventario);
  adapted.costoPromedio = Number.isFinite(averageCost) ? averageCost : null;
  adapted.costoPromedioMoneda = String(item.costoPromedioMoneda || "").trim().toUpperCase();
  adapted.ultimoCosto = Number.isFinite(lastCost) ? lastCost : null;
  adapted.modeloCostoInventarioVersion = Number(item.modeloCostoInventarioVersion || 0);
  adapted.valorInventario = Number.isFinite(inventoryValue) ? inventoryValue : null;
  adapted.valorInventarioMoneda = String(item.valorInventarioMoneda || "").trim().toUpperCase();
  adapted.ultimoProveedor = item.ultimoProveedor && typeof item.ultimoProveedor === "object"
    ? item.ultimoProveedor
    : null;
  return adapted;
}

export function isInventoryLowStock(item) {
  const adapted = adaptInventoryItem(item);
  return (
    adapted.tipoItem === "producto" &&
    adapted.estado === "activo" &&
    adapted.stockMinimo > 0 &&
    adapted.stock <= adapted.stockMinimo
  );
}

export function summarizeInventory(items) {
  const active = (Array.isArray(items) ? items : [])
    .map(adaptInventoryItem)
    .filter((item) => item.estado === "activo");
  const products = active.filter((item) => item.tipoItem === "producto");
  return {
    total: active.length,
    products: products.length,
    servicesAndActivities: active.length - products.length,
    lowStock: products.filter((item) => isInventoryLowStock(item)).length,
    inventoryCost: products.reduce(
      (total, item) => total + item.costoBase * Math.max(item.stock, 0),
      0
    ),
  };
}

export function filterInventoryItems(items, filters = {}) {
  const query = normalizeInventoryText(filters.query);
  return (Array.isArray(items) ? items : []).map(adaptInventoryItem).filter((item) => {
    if (filters.type && filters.type !== "todos" && item.tipoItem !== filters.type) return false;
    if (filters.status && filters.status !== "todos" && item.estado !== filters.status) return false;
    if (filters.areaId === "sin_area" && item.areaId) return false;
    if (filters.areaId && !["todas", "sin_area"].includes(filters.areaId) && item.areaId !== filters.areaId) return false;
    if (filters.categoryId === "sin_categoria" && item.categoriaId) return false;
    if (filters.categoryId && !["todas", "sin_categoria"].includes(filters.categoryId) && item.categoriaId !== filters.categoryId) return false;
    if (!query) return true;
    return normalizeInventoryText(
      [
        item.codigoInterno,
        item.sku,
        item.nombre,
        item.descripcion,
        item.barcode,
        item.codigoBarras,
        item.marca,
        item.modelo,
      ].filter(Boolean).join(" ")
    ).includes(query);
  });
}

export function validateInventoryDraft(draft = {}) {
  const errors = {};
  if (!TYPE_VALUES.has(draft.tipoItem)) errors.tipoItem = "Selecciona un tipo de ítem.";
  if (!String(draft.nombre || "").trim()) errors.nombre = "El nombre es obligatorio.";
  if (String(draft.nombre || "").trim().length > 140) errors.nombre = "El nombre admite hasta 140 caracteres.";
  if (!String(draft.unidad || "").trim()) errors.unidad = "Selecciona una unidad.";
  if (draft.categoriaId && !draft.areaId) errors.categoriaId = "Selecciona primero un área.";
  const requestedCode = normalizeInventoryRequestedCode(draft.codigoSolicitado);
  if (requestedCode && !/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(requestedCode)) {
    errors.codigoSolicitado = "Usa entre 2 y 40 letras, números, puntos, guiones o guiones bajos.";
  } else if (/^(PR|SV|AC)-\d+$/.test(requestedCode)) {
    errors.codigoSolicitado = "Los prefijos PR, SV y AC están reservados para códigos automáticos.";
  }
  if (draft.tipoItem === "producto") {
    if (String(draft.marca || "").trim().length > 100) errors.marca = "La marca admite hasta 100 caracteres.";
    if (String(draft.modelo || "").trim().length > 100) errors.modelo = "El modelo admite hasta 100 caracteres.";
    if (String(draft.barcode ?? draft.codigoBarras ?? "").trim().length > 120) errors.codigoBarras = "El código de barras admite hasta 120 caracteres.";
    if (String(draft.proveedorNombre || "").trim().length > 180) errors.proveedorNombre = "El proveedor admite hasta 180 caracteres.";
    if (String(draft.proveedorRut || "").trim().length > 20) errors.proveedorRut = "El RUT proveedor admite hasta 20 caracteres.";
    if (String(draft.numeroFacturaReferencia || "").trim().length > 120) errors.numeroFacturaReferencia = "El número de factura admite hasta 120 caracteres.";
    const purchaseDate = String(draft.fechaCompraReferencia || "").trim();
    if (purchaseDate && !isValidInventoryReferenceDate(purchaseDate)) {
      errors.fechaCompraReferencia = "Selecciona una fecha de compra válida.";
    }
  }

  const numericFields = [
    ["costoBase", "El costo base"],
    ["margenDeseado", "El recargo"],
  ];
  if (
    draft.precioManual !== false &&
    draft.precioManual !== null &&
    draft.precioManual !== undefined &&
    String(draft.precioManual).trim() !== ""
  ) {
    numericFields.push(["precioManual", "El ajuste manual"]);
  }
  if (draft.tipoItem === "producto") {
    numericFields.push(["stock", "El stock"], ["stockMinimo", "El stock mínimo"]);
    if (Number(draft.formacionPrecioVersion) === INVENTORY_PRICE_FORMATION_VERSION) {
      numericFields.push(["tasaImpuestoCompra", "El IVA de compra"]);
    }
  }
  numericFields.forEach(([field, label]) => {
    const number = parseInventoryNumber(draft[field]);
    if (number === null || number < 0) errors[field] = `${label} debe ser un número mayor o igual a cero.`;
  });
  const margin = parseInventoryNumber(draft.margenDeseado);
  if (margin !== null && margin > 1000) errors.margenDeseado = "El recargo no puede superar 1000%.";
  const purchaseTaxRate = parseInventoryNumber(draft.tasaImpuestoCompra);
  if (
    draft.tipoItem === "producto" &&
    Number(draft.formacionPrecioVersion) === INVENTORY_PRICE_FORMATION_VERSION &&
    purchaseTaxRate !== null &&
    purchaseTaxRate > 100
  ) {
    errors.tasaImpuestoCompra = "El IVA de compra no puede superar 100%.";
  }
  return errors;
}

export function buildInventoryPayload(
  draft,
  categories = [],
  { authorizedStatus = "activo", allowRequestedCode = true } = {}
) {
  const validatedDraft = allowRequestedCode
    ? draft
    : {...draft, codigoSolicitado: ""};
  const errors = validateInventoryDraft(validatedDraft);
  if (Object.keys(errors).length) {
    const error = new Error(Object.values(errors)[0]);
    error.fields = errors;
    throw error;
  }
  const cost = parseInventoryNumber(draft.costoBase);
  const margin = parseInventoryNumber(draft.margenDeseado);
  const manual = parseInventoryNumber(draft.precioManual);
  const category = categories.find((item) => item.id === draft.categoriaId);
  const payload = {
    tipoItem: draft.tipoItem,
    nombre: String(draft.nombre).trim(),
    descripcion: String(draft.descripcion || "").trim(),
    unidad: String(draft.unidad).trim(),
    costoBase: cost,
    margenDeseado: margin,
    precioInterno: manual === null || manual <= 0
      ? Math.round(cost + (cost * margin) / 100)
      : manual,
    precioManual: manual !== null && manual > 0,
    estado: authorizedStatus,
    areaId: String(draft.areaId || "").trim(),
    categoriaId: String(draft.categoriaId || "").trim(),
    categoria: category?.nombre || "",
  };
  const requestedCode = allowRequestedCode
    ? normalizeInventoryRequestedCode(draft.codigoSolicitado)
    : "";
  if (requestedCode) payload.codigoSolicitado = requestedCode;
  if (draft.tipoItem === "producto") {
    payload.marca = String(draft.marca || "").trim();
    payload.modelo = String(draft.modelo || "").trim();
    payload.barcode = String(draft.barcode ?? draft.codigoBarras ?? "").trim();
    payload.proveedorNombre = String(draft.proveedorNombre || "").trim();
    payload.proveedorRut = formatChileanRut(draft.proveedorRut || "");
    payload.fechaCompraReferencia = String(draft.fechaCompraReferencia || "").trim();
    payload.numeroFacturaReferencia = String(draft.numeroFacturaReferencia || "").trim();
    payload.stock = parseInventoryNumber(draft.stock);
    payload.stockMinimo = parseInventoryNumber(draft.stockMinimo);
    payload.unidadStock = String(draft.unidadStock || draft.unidad).trim();
    if (Number(draft.formacionPrecioVersion) === INVENTORY_PRICE_FORMATION_VERSION) {
      const formation = calculateInventoryPriceFormation({
        costoBase: cost,
        tasaImpuestoCompra: parseInventoryNumber(draft.tasaImpuestoCompra),
        margenDeseado: margin,
        precioInterno: manual,
        precioManual: manual !== null && manual > 0,
      });
      payload.formacionPrecioVersion = INVENTORY_PRICE_FORMATION_VERSION;
      payload.tasaImpuestoCompra = formation.tasaImpuestoCompra;
      payload.montoImpuestoCompra = formation.montoImpuestoCompra;
      payload.costoPagado = formation.costoPagado;
      payload.precioVentaSugerido = formation.precioVentaSugerido;
      payload.precioInterno = formation.precioVentaFinal;
    }
  }
  return payload;
}

function isValidInventoryReferenceDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
