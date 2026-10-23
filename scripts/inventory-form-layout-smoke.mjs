import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
  INVENTORY_DETAIL_FIELDS,
  getFirstInventoryErrorField,
  inventoryDraftHasDetails,
  inventoryErrorsInDetails,
} from "../src/domain/inventoryFormLayout.mjs";
import {validateInventoryDraft} from "../src/domain/inventoryMvp.mjs";

const baseDraft = {
  tipoItem: "producto",
  nombre: "Cámara IP",
  unidad: "unidad",
  costoBase: "1000",
  margenDeseado: "30",
  precioManual: "",
  exentoIva: false,
  stock: "0",
  stockMinimo: "0",
  marca: "",
  modelo: "",
  codigoBarras: "",
  descripcion: "",
  proveedorNombre: "",
  proveedorRut: "",
  fechaCompraReferencia: "",
  numeroFacturaReferencia: "",
  areaId: "",
  categoriaId: "",
};

// "Más detalles" abierta al editar solo si hay datos en esa sección.
assert.equal(inventoryDraftHasDetails(baseDraft), false);
assert.equal(inventoryDraftHasDetails({...baseDraft, unidad: "metro"}), false, "La unidad es visible y no cuenta.");
for (const field of INVENTORY_DETAIL_FIELDS) {
  assert.equal(inventoryDraftHasDetails({...baseDraft, [field]: "x"}), true, field);
  assert.equal(inventoryDraftHasDetails({...baseDraft, [field]: "   "}), false, `${field} en blanco`);
}

// Errores reales de validación dentro de la sección plegada la abren.
const detailErrorCases = {
  marca: {marca: "m".repeat(101)},
  modelo: {modelo: "m".repeat(101)},
  codigoBarras: {codigoBarras: "1".repeat(121)},
  proveedorNombre: {proveedorNombre: "p".repeat(181)},
  proveedorRut: {proveedorRut: "1".repeat(21)},
  numeroFacturaReferencia: {numeroFacturaReferencia: "f".repeat(121)},
  fechaCompraReferencia: {fechaCompraReferencia: "2026-13-45"},
  categoriaId: {categoriaId: "cat-1", areaId: ""},
};
for (const [field, overrides] of Object.entries(detailErrorCases)) {
  const errors = validateInventoryDraft({...baseDraft, ...overrides});
  assert.ok(errors[field], `validateInventoryDraft debe marcar ${field}`);
  assert.equal(inventoryErrorsInDetails(errors), true, `${field} abre Más detalles`);
  assert.equal(getFirstInventoryErrorField(errors), field);
}

// Errores en campos siempre visibles no abren la sección.
for (const overrides of [{nombre: ""}, {unidad: ""}, {costoBase: ""}, {margenDeseado: "2000"}, {stock: "-1"}]) {
  const errors = validateInventoryDraft({...baseDraft, ...overrides});
  assert.ok(Object.keys(errors).length > 0);
  assert.equal(inventoryErrorsInDetails(errors), false, JSON.stringify(overrides));
}
assert.equal(inventoryErrorsInDetails({}), false);
assert.equal(inventoryErrorsInDetails({marca: ""}), false);

// El foco va al primer error en el orden visual del formulario.
assert.equal(getFirstInventoryErrorField({}), "");
assert.equal(
  getFirstInventoryErrorField(validateInventoryDraft({...baseDraft, nombre: "", marca: "m".repeat(101)})),
  "nombre"
);
assert.equal(
  getFirstInventoryErrorField(validateInventoryDraft({...baseDraft, costoBase: "", modelo: "m".repeat(101), marca: "m".repeat(101)})),
  "costoBase"
);
assert.equal(
  getFirstInventoryErrorField({proveedorRut: "e", marca: "e", numeroFacturaReferencia: "e"}),
  "marca"
);
assert.equal(getFirstInventoryErrorField({campoNuevo: "e"}), "campoNuevo");

// Cableado en el formulario.
const manager = await readFile(new URL("../src/features/inventory/InventoryManager.jsx", import.meta.url), "utf8");
assert.match(manager, /if \(inventoryErrorsInDetails\(errors\)\) setDetailsOpen\(true\);\s*setFocusField\(getFirstInventoryErrorField\(errors\)\);/);
assert.match(manager, /setDetailsOpen\(inventoryDraftHasDetails\(editDraft\)\);/, "Editar abre si hay datos.");
assert.match(manager, /setDraft\(\{ \.\.\.EMPTY_DRAFT, exentoIva: defaultExemptFromTax \}\);\s*setManualPriceEnabled\(false\);\s*setDetailsOpen\(false\);/, "Nuevo arranca cerrado.");
assert.match(manager, /const \[detailsOpen, setDetailsOpen\] = useState\(false\);/, "El estado vive en InventoryManager.");
assert.match(manager, /querySelector\(`#inventory-item-form \[data-inventory-field="\$\{focusField\}"\]`\)/);
assert.match(manager, /aria-expanded=\{detailsOpen\}/);
assert.match(manager, /\{detailsOpen && <div id="inventory-more-details"/);
for (const field of INVENTORY_DETAIL_FIELDS) {
  assert.ok(manager.includes(`field="${field}"`), `El campo ${field} debe poder recibir el foco (data-inventory-field).`);
}
for (const field of ["nombre", "costoBase", "margenDeseado", "precioManual", "stock", "stockMinimo", "unidad"]) {
  assert.ok(manager.includes(`field="${field}"`) || manager.includes(`data-inventory-field="${field}"`), field);
}
// Unidad visible, fuera de "Más detalles"; existencias solo para productos.
const moreStart = manager.indexOf('className="inventory-more"');
assert.ok(moreStart > 0);
assert.ok(manager.indexOf("<UnitSelector") < moreStart, "UnitSelector queda antes de Más detalles.");
assert.ok(manager.indexOf("<h3>Existencias</h3>") < moreStart);
assert.match(manager, /draft\.tipoItem === "producto" && <section className="inventory-form-section"><h3>Existencias<\/h3>/);
// Resumen de precio en el pie del diálogo, sin sticky.
assert.match(manager, /footer=\{<><div className="inventory-footer-price">/);

console.log("INVENTORY_FORM_LAYOUT_SMOKE_OK");
