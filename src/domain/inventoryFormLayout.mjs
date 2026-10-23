// Organización visual del formulario de ítem de inventario. Solo decide qué
// campos viven en la sección plegable "Más detalles" y cuál es el primer campo
// con error; no valida ni calcula nada (eso sigue en inventoryMvp.mjs).

// Campos del borrador que se muestran dentro de "Más detalles". Las claves son
// las del borrador y las de validateInventoryDraft (codigoBarras, no barcode).
// Área y categoría ya no viven aquí: están visibles junto a Identificación.
export const INVENTORY_DETAIL_FIELDS = Object.freeze([
  "marca",
  "modelo",
  "codigoBarras",
  "descripcion",
  "proveedorNombre",
  "proveedorRut",
  "fechaCompraReferencia",
  "numeroFacturaReferencia",
]);

// Orden visual del formulario, de arriba hacia abajo, para llevar el foco al
// primer error que el usuario encontraría al leer la pantalla.
const INVENTORY_FIELD_ORDER = Object.freeze([
  "tipoItem",
  "nombre",
  "unidad",
  "areaId",
  "categoriaId",
  "costoBase",
  "exentoIva",
  "margenDeseado",
  "precioManual",
  "stock",
  "stockMinimo",
  ...INVENTORY_DETAIL_FIELDS,
]);

const hasValue = (value) => String(value ?? "").trim() !== "";

// "Más detalles" arranca abierto al editar un ítem que ya tiene datos ahí.
export function inventoryDraftHasDetails(draft = {}) {
  return INVENTORY_DETAIL_FIELDS.some((field) => hasValue(draft[field]));
}

// Hay un error en un campo oculto mientras la sección está plegada.
export function inventoryErrorsInDetails(errors = {}) {
  return INVENTORY_DETAIL_FIELDS.some((field) => hasValue(errors[field]));
}

export function getFirstInventoryErrorField(errors = {}) {
  const keys = Object.keys(errors).filter((field) => hasValue(errors[field]));
  if (!keys.length) return "";
  return INVENTORY_FIELD_ORDER.find((field) => keys.includes(field)) || keys[0];
}
