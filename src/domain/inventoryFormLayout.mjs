// Organización del formulario de ítem de inventario: orden visual de los campos
// (para llevar el foco al primer error), texto de ayuda de stock bajo y
// advertencia al cambiar la unidad de un ítem con stock. No valida ni calcula
// precios (eso sigue en inventoryMvp.mjs) ni cambia la regla de stock bajo (que
// sigue en inventoryLowStock.mjs). Todos los campos están siempre visibles: no hay
// secciones plegables.
import { getGeneralLowStockThreshold } from "./inventoryLowStock.mjs";
import { INVENTORY_UNITS, parseInventoryNumber } from "./inventoryMvp.mjs";

// Orden visual de los campos, de arriba hacia abajo y de izquierda a derecha, tal
// como se ven en pantalla. Las claves son las del borrador y las de
// validateInventoryDraft (codigoBarras, no barcode).
export const INVENTORY_PRODUCT_FIELD_ORDER = Object.freeze([
  "tipoItem",
  "nombre",
  "marca",
  "modelo",
  "codigoBarras",
  "areaId",
  "categoriaId",
  "costoBase",
  "exentoIva",
  "margenDeseado",
  "precioManual",
  "stock",
  "stockMinimo",
  "unidad",
  "descripcion",
  "proveedorNombre",
  "proveedorRut",
  "fechaCompraReferencia",
  "numeroFacturaReferencia",
]);

// Servicio y actividad: sin marca, modelo, código de barras ni existencias; la
// unidad va junto al costo y al recargo.
export const INVENTORY_SERVICE_FIELD_ORDER = Object.freeze([
  "tipoItem",
  "nombre",
  "areaId",
  "categoriaId",
  "costoBase",
  "margenDeseado",
  "unidad",
  "precioManual",
  "descripcion",
]);

export function getInventoryFieldOrder(tipoItem = "producto") {
  return tipoItem === "producto" ? INVENTORY_PRODUCT_FIELD_ORDER : INVENTORY_SERVICE_FIELD_ORDER;
}

const hasValue = (value) => String(value ?? "").trim() !== "";

// Primer campo con error en el orden visual. Una clave desconocida va al final.
export function getFirstInventoryErrorField(errors = {}, tipoItem = "producto") {
  const keys = Object.keys(errors).filter((field) => hasValue(errors[field]));
  if (!keys.length) return "";
  return getInventoryFieldOrder(tipoItem).find((field) => keys.includes(field)) || keys[0];
}

// Ayuda bajo el stock: describe la regla real de inventoryLowStock.mjs. Con
// mínimo propio (> 0) manda ese mínimo; con mínimo 0 rige el umbral general del
// negocio (si sus alertas están activas). En ambos casos se compara "igual o menor".
export function getInventoryLowStockHelperText(stockMinimo, lowStockSettings) {
  const minimum = parseInventoryNumber(stockMinimo);
  if (minimum !== null && minimum > 0) {
    return `Se marcará como stock bajo cuando el stock sea ${minimum} o menos (el mínimo de este ítem).`;
  }
  const threshold = getGeneralLowStockThreshold(lowStockSettings);
  if (threshold > 0) {
    return `Sin stock mínimo propio, rige el umbral general del negocio: se marcará como stock bajo con ${threshold} o menos.`;
  }
  return "Sin stock mínimo propio y sin umbral general activo en el negocio, este ítem no se marcará como stock bajo.";
}

// Advertencia al cambiar la unidad de un ítem que ya tiene stock (solo al editar).
// La cantidad no se convierte: solo cambia el rótulo con que se muestra. `stockUnit`
// es la unidad de stock del borrador; si coincide con la nueva unidad, la existencia
// pasará a mostrarse en ella. Sin cambio, sin stock o creando: sin advertencia.
export function getInventoryUnitChangeWarning({ editing = false, previousUnit, nextUnit, stockUnit, stock } = {}) {
  const quantity = Number(stock);
  if (!editing || !Number.isFinite(quantity) || quantity <= 0) return "";
  const previous = String(previousUnit ?? "").trim();
  const next = String(nextUnit ?? "").trim();
  if (!previous || !next || previous === next) return "";
  const label = (value) => INVENTORY_UNITS.find((unit) => unit.value === value)?.label || value;
  const head = `Cambiaste la unidad de ${label(previous)} a ${label(next)} en un ítem con ${quantity} en stock. La cantidad no se convierte: `;
  const shownStockUnit = String(stockUnit ?? "").trim();
  if (!shownStockUnit || shownStockUnit === next) {
    return `${head}el stock pasará a mostrarse como ${quantity} ${next}. Revisa que siga siendo correcto antes de guardar.`;
  }
  return `${head}la unidad de stock se mantiene en ${shownStockUnit}. Revisa que el ítem siga bien antes de guardar.`;
}
