import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import * as layout from "../src/domain/inventoryFormLayout.mjs";
import {
  INVENTORY_PRODUCT_FIELD_ORDER,
  INVENTORY_SERVICE_FIELD_ORDER,
  getFirstInventoryErrorField,
  getInventoryFieldOrder,
  getInventoryLowStockHelperText,
  getInventoryUnitChangeWarning,
} from "../src/domain/inventoryFormLayout.mjs";
import {isLowStockByRule} from "../src/domain/inventoryLowStock.mjs";
import {validateInventoryDraft} from "../src/domain/inventoryMvp.mjs";

const baseDraft = {
  tipoItem: "producto",
  nombre: "Cámara IP",
  unidad: "unidad",
  unidadStock: "unidad",
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

// Ya no hay plegable: el módulo no exporta nada de apertura automática.
for (const removed of ["inventoryDraftHasDetails", "inventoryErrorsInDetails", "INVENTORY_DETAIL_FIELDS", "INVENTORY_DETAIL_TEXT_FIELDS"]) {
  assert.equal(removed in layout, false, `${removed} se retiró junto con el plegable.`);
}

// Orden visual (producto): nombre, marca, modelo, barras, área, categoría, costo,
// exención, recargo, precio manual, stock, mínimo, unidad, descripción y origen.
assert.deepEqual(INVENTORY_PRODUCT_FIELD_ORDER, [
  "tipoItem", "nombre", "marca", "modelo", "codigoBarras", "areaId", "categoriaId",
  "costoBase", "exentoIva", "margenDeseado", "precioManual",
  "stock", "stockMinimo", "unidad",
  "descripcion", "proveedorNombre", "proveedorRut", "fechaCompraReferencia", "numeroFacturaReferencia",
]);
// Servicio y actividad: sin marca/modelo/barras/existencias; la unidad junto al costo y al recargo.
assert.deepEqual(INVENTORY_SERVICE_FIELD_ORDER, [
  "tipoItem", "nombre", "areaId", "categoriaId", "costoBase", "margenDeseado", "unidad", "precioManual", "descripcion",
]);
assert.equal(getInventoryFieldOrder("producto"), INVENTORY_PRODUCT_FIELD_ORDER);
assert.equal(getInventoryFieldOrder("servicio"), INVENTORY_SERVICE_FIELD_ORDER);
assert.equal(getInventoryFieldOrder("actividad"), INVENTORY_SERVICE_FIELD_ORDER);
assert.equal(getInventoryFieldOrder(), INVENTORY_PRODUCT_FIELD_ORDER);

// Todo error que puede dar la validación tiene su lugar en el orden: nada queda sin foco.
const allErrorsProduct = validateInventoryDraft({...baseDraft, nombre: "", unidad: "", categoriaId: "c", costoBase: "", margenDeseado: "", precioManual: "-5",
  stock: "-1", stockMinimo: "-1", exentoIva: "quizás", marca: "m".repeat(101), modelo: "m".repeat(101), codigoBarras: "1".repeat(121),
  proveedorNombre: "p".repeat(181), proveedorRut: "1".repeat(21), numeroFacturaReferencia: "f".repeat(121), fechaCompraReferencia: "2026-13-45"});
for (const key of Object.keys(allErrorsProduct)) {
  assert.ok(INVENTORY_PRODUCT_FIELD_ORDER.includes(key), `El error ${key} tiene lugar en el orden visual del producto.`);
}
assert.equal(Object.keys(allErrorsProduct).length, INVENTORY_PRODUCT_FIELD_ORDER.length - 3, "Producto: todos los campos con validación fallan (salvo tipo, área y descripción).");
for (const key of Object.keys(validateInventoryDraft({...baseDraft, tipoItem: "servicio", nombre: "", unidad: "", categoriaId: "c", costoBase: "", margenDeseado: "", precioManual: "-5"}))) {
  assert.ok(INVENTORY_SERVICE_FIELD_ORDER.includes(key), `El error ${key} tiene lugar en el orden de servicio.`);
}

// Errores en cualquier campo: el foco va al primero en orden visual.
assert.equal(getFirstInventoryErrorField({}), "");
assert.equal(getFirstInventoryErrorField(validateInventoryDraft({...baseDraft, nombre: "", marca: "m".repeat(101)})), "nombre");
assert.equal(getFirstInventoryErrorField(validateInventoryDraft({...baseDraft, costoBase: "", marca: "m".repeat(101)})), "marca", "Marca va antes que el costo.");
assert.equal(getFirstInventoryErrorField(validateInventoryDraft({...baseDraft, codigoBarras: "1".repeat(121), categoriaId: "c"})), "codigoBarras", "Barras va antes que área y categoría.");
assert.equal(getFirstInventoryErrorField(validateInventoryDraft({...baseDraft, costoBase: "", modelo: "m".repeat(101), marca: "m".repeat(101)})), "marca");
assert.equal(getFirstInventoryErrorField(validateInventoryDraft({...baseDraft, categoriaId: "cat-1", areaId: "", costoBase: ""})), "categoriaId");
assert.equal(getFirstInventoryErrorField(validateInventoryDraft({...baseDraft, costoBase: "", margenDeseado: ""})), "costoBase");
assert.equal(getFirstInventoryErrorField(validateInventoryDraft({...baseDraft, margenDeseado: "", stock: "-1"})), "margenDeseado");
assert.equal(getFirstInventoryErrorField(validateInventoryDraft({...baseDraft, exentoIva: "quizás", margenDeseado: ""})), "exentoIva", "La exención va junto al costo, antes del recargo.");
assert.equal(getFirstInventoryErrorField(validateInventoryDraft({...baseDraft, precioManual: "-5", stock: "-1"})), "precioManual");
assert.equal(getFirstInventoryErrorField(validateInventoryDraft({...baseDraft, stock: "-1", stockMinimo: "-1"})), "stock");
assert.equal(getFirstInventoryErrorField(validateInventoryDraft({...baseDraft, stockMinimo: "-1", proveedorRut: "1".repeat(21)})), "stockMinimo", "El mínimo va antes que descripción y origen.");
assert.equal(getFirstInventoryErrorField({unidad: "e", stockMinimo: "e"}), "stockMinimo");
assert.equal(getFirstInventoryErrorField({proveedorRut: "e", numeroFacturaReferencia: "e", fechaCompraReferencia: "e"}), "proveedorRut");
assert.equal(getFirstInventoryErrorField({campoNuevo: "e", marca: "e"}), "marca");
assert.equal(getFirstInventoryErrorField({campoNuevo: "e"}), "campoNuevo");
// Servicio: la unidad va junto al recargo, antes del precio manual (en producto va después).
assert.equal(getFirstInventoryErrorField({precioManual: "e", unidad: "e"}, "servicio"), "unidad");
assert.equal(getFirstInventoryErrorField({precioManual: "e", unidad: "e"}, "actividad"), "unidad");
assert.equal(getFirstInventoryErrorField({precioManual: "e", unidad: "e"}, "producto"), "precioManual");
assert.equal(getFirstInventoryErrorField({marca: "e", costoBase: "e"}, "servicio"), "costoBase");
assert.equal(getFirstInventoryErrorField({margenDeseado: "e", unidad: "e", costoBase: "e"}, "servicio"), "costoBase");
// El recargo 0 es válido (obligatorio, pero 0 está permitido); el vacío es error.
assert.deepEqual(validateInventoryDraft({...baseDraft, margenDeseado: "0"}), {});
assert.ok(validateInventoryDraft({...baseDraft, margenDeseado: ""}).margenDeseado);

// Ayuda de stock bajo: refleja la regla real (inventoryLowStock.mjs), sin cambiarla.
const defaultSettings = {alertasStockBajo: true, umbralStockBajo: 5};
const ownMinimumText = getInventoryLowStockHelperText("3", defaultSettings);
assert.match(ownMinimumText, /3 o menos/);
assert.match(ownMinimumText, /mínimo de este ítem/);
assert.doesNotMatch(ownMinimumText, /umbral/i, "Con mínimo propio manda el mínimo, no el umbral.");
for (const zero of ["0", "", "   ", "0,0"]) {
  const text = getInventoryLowStockHelperText(zero, defaultSettings);
  assert.match(text, /umbral general del negocio/, `mínimo ${JSON.stringify(zero)}`);
  assert.match(text, /5 o menos/);
}
assert.match(getInventoryLowStockHelperText("0", {alertasStockBajo: true, umbralStockBajo: 12}), /12 o menos/);
for (const off of [{alertasStockBajo: false, umbralStockBajo: 5}, {alertasStockBajo: true, umbralStockBajo: 0}, undefined, null]) {
  assert.match(getInventoryLowStockHelperText("0", off), /no se marcará como stock bajo/, JSON.stringify(off));
}
assert.equal(isLowStockByRule({stock: 0, stockMinimo: 0}, defaultSettings), true, "Stock 0 y mínimo 0 con umbral 5 queda marcado.");
assert.equal(isLowStockByRule({stock: 5, stockMinimo: 0}, defaultSettings), true, "Igual al umbral queda marcado.");
assert.equal(isLowStockByRule({stock: 6, stockMinimo: 0}, defaultSettings), false);
assert.equal(isLowStockByRule({stock: 3, stockMinimo: 3}, defaultSettings), true, "Igual al mínimo propio queda marcado.");
assert.equal(isLowStockByRule({stock: 4, stockMinimo: 3}, defaultSettings), false, "Con mínimo propio no rige el umbral.");
assert.equal(isLowStockByRule({stock: 0, stockMinimo: 0}, {alertasStockBajo: false, umbralStockBajo: 5}), false);

// Advertencia al cambiar la unidad de un ítem con stock (solo al editar).
const unitChange = {editing: true, previousUnit: "m", nextUnit: "kg", stockUnit: "kg", stock: 50};
const warningFollowing = getInventoryUnitChangeWarning(unitChange);
assert.match(warningFollowing, /Cambiaste la unidad de Metro \(m\) a Kilogramo \(kg\)/);
assert.match(warningFollowing, /50 en stock/);
assert.match(warningFollowing, /no se convierte/);
assert.match(warningFollowing, /50 kg/, "Dice cómo pasará a mostrarse el stock.");
const warningDivergent = getInventoryUnitChangeWarning({...unitChange, stockUnit: "unidad"});
assert.match(warningDivergent, /se mantiene en unidad/, "Con unidad de stock legada distinta, lo dice.");
assert.match(warningDivergent, /no se convierte/);
assert.match(getInventoryUnitChangeWarning({...unitChange, stockUnit: ""}), /50 kg/, "Sin unidad de stock guardada, sigue a la nueva.");
assert.match(getInventoryUnitChangeWarning({...unitChange, previousUnit: "caja", nextUnit: "cajón"}), /de caja a cajón/, "Unidades fuera del catálogo se muestran tal cual.");
assert.equal(getInventoryUnitChangeWarning({...unitChange, editing: false}), "", "Creando no advierte.");
assert.equal(getInventoryUnitChangeWarning({...unitChange, stock: 0}), "", "Sin stock no advierte.");
assert.equal(getInventoryUnitChangeWarning({...unitChange, stock: undefined}), "");
assert.equal(getInventoryUnitChangeWarning({...unitChange, stock: -2}), "", "Stock negativo no advierte.");
assert.equal(getInventoryUnitChangeWarning({...unitChange, nextUnit: "m"}), "", "Sin cambio de unidad no advierte.");
assert.equal(getInventoryUnitChangeWarning({...unitChange, nextUnit: " m "}), "");
assert.equal(getInventoryUnitChangeWarning(), "");

// ---- Cableado en el formulario ----
const manager = await readFile(new URL("../src/features/inventory/InventoryManager.jsx", import.meta.url), "utf8");
const formStart = manager.indexOf('<form id="inventory-item-form"');
const formEnd = manager.indexOf("</form>", formStart);
assert.ok(formStart > 0 && formEnd > formStart);
const form = manager.slice(formStart, formEnd);

// Sin plegable ni apertura automática.
assert.doesNotMatch(manager, /Disclosure|detailsOpen|setDetailsOpen|inventoryDraftHasDetails|inventoryErrorsInDetails|Más detalles|inventory-more/);
assert.doesNotMatch(manager, /defaultExentoIva/);
assert.match(manager, /setFocusField\(getFirstInventoryErrorField\(errors, draft\.tipoItem\)\);/, "El foco sigue el orden visual del tipo de ítem.");
assert.match(manager, /querySelector\(`#inventory-item-form \[data-inventory-field="\$\{focusField\}"\]`\)/);
assert.match(manager, /const EMPTY_DRAFT = Object\.freeze\(\{[\s\S]*?margenDeseado: "30",/, "El recargo parte en 30 (editable, 0 permitido).");

// Posición de cada campo en el fuente: sigue el orden visual.
const at = (marker, from = 0) => { const i = form.indexOf(marker, from); assert.ok(i >= 0, `Falta ${marker}`); return i; };
const positions = ["nombre", "marca", "modelo", "codigoBarras", "areaId", "categoriaId", "costoBase", "exentoIva", "margenDeseado", "precioManual", "stock", "stockMinimo", "descripcion", "proveedorNombre", "proveedorRut", "fechaCompraReferencia", "numeroFacturaReferencia"]
  .map((field) => [field, at(`field="${field}"`)]);
for (let i = 1; i < positions.length; i += 1) {
  assert.ok(positions[i][1] > positions[i - 1][1], `${positions[i][0]} va después de ${positions[i - 1][0]}.`);
}
// Todos los campos del orden de producto existen en el formulario (ninguno se quitó).
for (const field of INVENTORY_PRODUCT_FIELD_ORDER.filter((f) => !["tipoItem", "unidad"].includes(f))) {
  assert.ok(form.includes(`field="${field}"`), `El campo ${field} sigue en el formulario y puede recibir el foco.`);
}
assert.ok(form.includes('aria-label="Tipo de ítem"'));

// 2. Identificación: nombre, marca, modelo, código de barras con Escanear, área y categoría + enlace.
const identityStart = at("<h3>Identificación</h3>");
const priceStart = at("inventory-price-card");
const identity = form.slice(identityStart, priceStart);
for (const marker of ['<Field field="nombre"', '<Field field="marca"', '<Field field="modelo"', '<Field field="codigoBarras"', '<CatalogSelect field="areaId"', '<CatalogSelect field="categoriaId"']) {
  assert.ok(identity.includes(marker), `${marker} está en Identificación.`);
}
assert.match(identity, /<div className="inventory-grid-12">/);
assert.match(identity, /isProductDraft && <Field field="marca" span=\{3\}/);
assert.match(identity, /isProductDraft && <Field field="modelo" span=\{3\}/);
assert.match(identity, /isProductDraft && <Field field="codigoBarras" span=\{4\}/);
assert.ok(identity.includes('<BarcodeInput actionLabel="Escanear"'));
assert.match(identity, /<Field field="nombre" span=\{isProductDraft \? 6 : 12\}/);
assert.match(identity, /<CatalogSelect field="areaId" span=\{isProductDraft \? 4 : 6\}/);
assert.match(identity, /<CatalogSelect field="categoriaId" span=\{isProductDraft \? 4 : 6\}/);
assert.ok(identity.indexOf('<CatalogSelect field="areaId"') > identity.indexOf('<Field field="codigoBarras"'));
assert.match(identity, /<div className="inventory-identity-meta-row">\s*<button type="button" className="inventory-link-button" onClick=\{openCatalogManager\}>Administrar áreas y categorías<\/button>/);
assert.doesNotMatch(manager, /<h4>Clasificación<\/h4>/);
assert.match(manager, /onCreate=\{\(\) => openQuickCreate\("area"\)\}/);
assert.match(manager, /onCreate=\{\(\) => openQuickCreate\("category"\)\}/);
assert.ok(manager.includes('onClick={onCreate}><span aria-hidden="true">+</span> Crear</button>'), "El + lleva texto visible.");
assert.ok(manager.includes("aria-label={`Crear ${label.toLowerCase()}`}"), "El + conserva aria-label.");
assert.ok(manager.includes("title={createTitle || `Crear ${label.toLowerCase()}`}"), "El + conserva title.");

// 3. Precio: costo neto con "Exento de IVA" al lado, recargo, precio manual y una fila de resultado.
const price = form.slice(priceStart, at('<h3>Existencias</h3>'));
const costPos = price.indexOf('<Field field="costoBase" label={draft.exentoIva');
const exemptPos = price.indexOf('data-inventory-field="exentoIva"');
const markupPos = price.indexOf('<Field field="margenDeseado"');
const serviceUnitPos = price.indexOf("{!isProductDraft && unitField}");
const manualTogglePos = price.indexOf("Definir precio de venta manual");
assert.ok(costPos >= 0 && costPos < exemptPos && exemptPos < markupPos, "Costo, Exento de IVA y Recargo van en ese orden.");
assert.ok(markupPos < serviceUnitPos && serviceUnitPos < manualTogglePos, "En servicio/actividad la unidad va tras el recargo.");
assert.match(price, /\{isProductDraft && <label data-inventory-field="exentoIva" className="inventory-manual-price-toggle inventory-tax-exempt-toggle">/);
assert.ok(price.includes("<span>Exento de IVA</span>") && price.includes("disabled={exemptionLocked}") && price.includes("fieldErrors.exentoIva"));
assert.match(price, /<div className="inventory-price-grid">\s*\{isProductDraft/, "Costo, exención y recargo en una fila de 3 columnas.");
assert.ok(price.includes("Definir precio de venta manual"), "El precio manual es visible dentro del bloque de precio.");
assert.match(price, /Precio de venta \(neto\): <strong>\{formatBusinessAmount\(effectivePrice\)\}<\/strong> · con IVA: <strong>/);
assert.equal((price.match(/inventory-price-line/g) || []).length, 1, "Una sola fila de resultado de precio.");
// El IVA de venta usa SIEMPRE la tasa del negocio: la marca de exención afecta solo al costo (compra).
assert.match(manager, /calculateInventoryPriceWithTax\(effectivePrice, businessTaxRate\)/, "El con IVA usa la tasa del negocio sin excepción.");
assert.doesNotMatch(manager, /calculateInventoryPriceWithTax\([^)]*exentoIva/, "La exención no entra al precio con IVA.");
assert.doesNotMatch(price, /\(exento de IVA\)"\}|\(exento de IVA\)<\/strong>/, "La fila no agrega leyendas de exención.");
// El recuadro "Costo con IVA (referencia)" del formulario se retiró; la ficha del ítem conserva el suyo.
assert.equal((manager.match(/Costo con IVA \(referencia\)/g) || []).length, 1, "Solo queda el de la ficha.");
assert.ok(manager.includes('<Detail label="Costo con IVA (referencia)"'));
assert.doesNotMatch(manager, /paidCostDetail|<PriceResult label="Costo con IVA/);
// "Sugerido" solo con precio manual.
assert.equal((manager.match(/<PriceResult label="Precio sugerido"/g) || []).length, 1, "Un solo cuadro de Sugerido en el formulario.");
assert.match(manager, /\{manualPriceEnabled && <div className="inventory-price-grid inventory-price-grid--pair">.*<PriceResult label="Precio sugerido"/, "Sugerido vive dentro del bloque de precio manual.");
assert.match(manager, /\{manualPriceEnabled && <small>Sugerido \{formatBusinessAmount\(calculatedPrice\)\}<\/small>\}/, "El pie también oculta Sugerido sin precio manual.");
assert.doesNotMatch(manager, /<PriceResult label="Precio de venta final"|tone="final"/);
assert.match(manager, /legacyV2SuggestedPrice !== null && legacyV2SuggestedPrice !== calculatedPrice/, "El aviso de precio v2 se conserva.");

// 4. Existencias: stock inicial, stock mínimo y unidad en una fila de 3 columnas, con la ayuda de stock bajo.
assert.match(manager, /draft\.tipoItem === "producto" && <section className="inventory-form-section"><h3>Existencias<\/h3>/);
const stockSection = manager.slice(manager.indexOf("<h3>Existencias</h3>"), manager.indexOf("</section>}", manager.indexOf("<h3>Existencias</h3>")));
assert.match(stockSection, /<div className="inventory-form-grid inventory-form-grid--three">/);
const stockPos = stockSection.indexOf('field="stock"');
const minPos = stockSection.indexOf('field="stockMinimo"');
const unitPos = stockSection.indexOf("{unitField}");
assert.ok(stockPos > 0 && stockPos < minPos && minPos < unitPos, "Stock inicial, stock mínimo y unidad, en ese orden.");
assert.match(stockSection, /label=\{editingItem \? "Stock actual" : "Stock inicial"\}/);
assert.match(stockSection, /<p className="inventory-stock-helper">\{stockHelperText\}<\/p>/);
assert.match(manager, /getInventoryLowStockHelperText\(draft\.stockMinimo, settings\)/);
assert.doesNotMatch(manager, /Se marcará como stock bajo al alcanzar el mínimo\./, "Texto antiguo e incompleto retirado.");
assert.match(stockSection, /\{unitChangeWarning && <p className="inventory-feedback inventory-feedback--notice" role="status">\{unitChangeWarning\}<\/p>\}/);
assert.match(manager, /getInventoryUnitChangeWarning\(\{[\s\S]*?editing: Boolean\(editingAdapted\)[\s\S]*?previousUnit: editingAdapted\?\.unidad[\s\S]*?nextUnit: draft\.unidad[\s\S]*?stockUnit: draft\.unidadStock[\s\S]*?stock: editingAdapted\?\.stock/);
assert.ok(manager.indexOf("<h3>Existencias</h3>") > priceStart, "Existencias va después del precio.");

// 5. Al final: descripción y origen de compra (proveedor en texto libre, RUT, fecha y factura).
const closingStart = at('<h3>{isProductDraft ? "Descripción y origen de compra" : "Descripción"}</h3>');
assert.ok(closingStart > manager.indexOf("<h3>Existencias</h3>") - formStart, "Descripción y origen van al final, tras las existencias.");
const closing = form.slice(closingStart);
assert.ok(closing.indexOf('field="descripcion"') > 0 && closing.indexOf('field="descripcion"') < closing.indexOf('aria-label="Origen de compra"'));
for (const field of ["proveedorNombre", "proveedorRut", "fechaCompraReferencia", "numeroFacturaReferencia"]) assert.ok(closing.includes(`field="${field}"`), field);
// Sin título duplicado: el encabezado de la sección ya dice "origen de compra"; el grupo conserva su nombre accesible.
assert.ok(closing.includes('draft.tipoItem === "producto" && <div className="inventory-purchase-origin-grid" role="group" aria-label="Origen de compra">'));
assert.doesNotMatch(form, /<h4>/, "El formulario no tiene títulos h4 duplicados.");
assert.equal((form.match(/Origen de compra/gi) || []).length, 2, "Solo el título de la sección y el nombre accesible del grupo.");
assert.match(closing, /type="date" value=\{draft\.fechaCompraReferencia\}/);
assert.doesNotMatch(form, /proveedorId/, "El proveedor sigue siendo texto libre.");

// Una sola unidad: no queda el selector "Unidad de inventario" y la de stock sigue a la unidad.
assert.equal((manager.match(/<UnitSelector/g) || []).length, 1, "Un solo selector de unidad.");
assert.doesNotMatch(manager, /Unidad de inventario/);
assert.doesNotMatch(manager, /updateDraft\("unidadStock"/);
assert.match(manager, /if \(field === "unidad"\) next\.unidadStock = followInventoryStockUnit\(current\.unidad, current\.unidadStock, value\);/);
// La unidad por defecto de Servicio y Actividad no cambia (sigue la unidad actual al cambiar de tipo).
assert.match(manager, /next\.unidad = current\.unidad \|\| getDefaultUnitForType\(value\);/);

// Textos de ayuda: base real del recargo y placeholders por tipo.
assert.match(manager, /"Se aplica sobre el costo unitario\."/);
assert.match(manager, /"Se aplica sobre el costo \(exento de IVA\)\."/);
assert.match(manager, /"Se aplica sobre el costo neto \(sin IVA\)\."/);
assert.match(manager, /label="Recargo \(%\)" required hint=\{markupBaseHint\}/);
assert.match(manager, /producto: "Ej\. Cámara IP modelo X100"/);
assert.match(manager, /servicio: "Ej\. Instalación y configuración de cámaras"/);
assert.match(manager, /actividad: "Ej\. Hora técnica en terreno"/);
assert.match(manager, /placeholder=\{INVENTORY_NAME_PLACEHOLDERS\[draft\.tipoItem\]\}/);
assert.match(manager, /servicio: "Costo por unidad del servicio"/);
assert.match(manager, /actividad: "Costo por unidad de la actividad"/);
assert.match(manager, /placeholder=\{INVENTORY_UNIT_COST_PLACEHOLDERS\[draft\.tipoItem\]\}/);
assert.doesNotMatch(manager, /placeholder="Ej\. Cámara IP modelo X100"/);

// Servicio y actividad: sin marca, modelo, código de barras, existencias ni origen de compra.
for (const productOnly of ['isProductDraft && <Field field="marca"', 'isProductDraft && <Field field="modelo"', 'isProductDraft && <Field field="codigoBarras"', 'draft.tipoItem === "producto" && <section className="inventory-form-section"><h3>Existencias', 'draft.tipoItem === "producto" && <div className="inventory-purchase-origin-grid" role="group" aria-label="Origen de compra">']) {
  assert.ok(form.includes(productOnly), `${productOnly} solo aparece en productos.`);
}

// Pie del diálogo: precio de venta neto, sin sticky, y un solo botón principal.
assert.match(manager, /footer=\{<><div className="inventory-footer-price"><span>Precio de venta \(neto\)<\/span>/);
const dialogHead = manager.slice(manager.indexOf('className="inventory-item-dialog"'), formStart);
assert.equal((dialogHead.match(/<Button type="submit"/g) || []).length, 1, "Un solo botón principal en el diálogo del ítem.");
assert.equal((dialogHead.match(/variant="secondary"/g) || []).length, 1, "Cancelar es el único secundario.");

// Estilos: solo tokens en las reglas nuevas y sin restos del plegable propio.
const css = await readFile(new URL("../src/features/inventory/inventory.css", import.meta.url), "utf8");
assert.doesNotMatch(css, /inventory-more|inventory-manual-price-field|inventory-field--wide|inventory-essentials-grid/);
for (const rule of [/\.inventory-grid-12\s*\{[^}]*\}/, /\.inventory-span-3\s*\{[^}]*\}/, /\.inventory-span-4\s*\{[^}]*\}/, /\.inventory-span-6\s*\{[^}]*\}/, /\.inventory-span-12\s*\{[^}]*\}/, /\.inventory-identity-meta-row\s*\{[^}]*\}/, /\.inventory-price-grid--pair\s*\{[^}]*\}/, /\.inventory-price-line\s*\{[^}]*\}/, /\.inventory-price-line strong\s*\{[^}]*\}/]) {
  const block = css.match(rule)?.[0];
  assert.ok(block, `Falta la regla ${rule}`);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\\u[0-9a-fA-F]{4}/, `Sin literales en ${rule}`);
}
// Responsive: en móvil las columnas se apilan y los spans se anulan.
assert.match(css, /@media \(max-width: 767px\) \{\s*\.inventory-span-3, \.inventory-span-4, \.inventory-span-6, \.inventory-span-12 \{ grid-column: auto; \}/);
assert.match(css, /\.inventory-grid-12, \.inventory-identity-primary/);
assert.match(css, /@media \(max-width: 1100px\) \{\s*\.inventory-span-3, \.inventory-span-4 \{ grid-column: span 6; \}/);
assert.doesNotMatch(manager, /\\u[0-9a-fA-F]{4}/, "Sin secuencias \\uXXXX en el formulario.");

console.log("INVENTORY_FORM_LAYOUT_SMOKE_OK");
