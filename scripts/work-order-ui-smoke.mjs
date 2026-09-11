import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync("src/app/App.jsx", "utf8");
assert.match(app, /path="\/taller\/ordenes"/);
assert.match(app, /<WorkOrdersPage/);
assert.match(app, /<NewWorkOrderPage/);
assert.match(app, /path="\/taller\/ordenes\/:otId"/);
assert.match(app, /<WorkOrderDetailPage/);

const list = fs.readFileSync("src/pages/WorkOrdersPage.jsx", "utf8");
for (const column of [
  "Número OT",
  "Patente",
  "Vehículo",
  "Cliente histórico",
  "Estado",
  "Aprobación",
  "Plaza",
  "Actualización",
]) {
  assert.match(list, new RegExp(column));
}
assert.match(list, /matchesWorkOrderSearch/);
assert.match(list, /listarOrdenesTrabajo/);
assert.match(list, /order\.clienteId/);
assert.doesNotMatch(list, /vehicle\.clienteId.*Cliente histórico/);

const creation = fs.readFileSync("src/pages/NewWorkOrderPage.jsx", "utf8");
assert.match(creation, /normalizeVehiclePlate/);
assert.match(creation, /listarVehiculos/);
assert.match(creation, /if \(!normalizedSearch\) return vehicles/);
assert.match(creation, /Vehículos disponibles/);
assert.match(creation, /Crear vehículo/);
assert.match(creation, /\/taller\/vehiculos\/nuevo/);
assert.match(creation, /createWorkOrderRequestId/);
assert.doesNotMatch(creation, /numeroOT\s*:/);
assert.doesNotMatch(creation, /clienteId\s*:/);

const detail = fs.readFileSync("src/pages/WorkOrderDetailPage.jsx", "utf8");
for (const section of [
  "Resumen",
  "Recepción",
  "Diagnósticos",
  "Servicios y repuestos",
  "Historial",
]) {
  assert.match(detail, new RegExp(section));
}
assert.match(detail, /obtenerOrdenTrabajo/);
assert.match(detail, /order\.clienteId/);
assert.match(detail, /order\.plazaId/);
assert.match(detail, /getWorkOrderStatusLabel/);
assert.match(detail, /getWorkOrderApprovalLabel/);
assert.match(detail, /RECEPTION_CHECKLIST_FIELDS/);
assert.match(detail, /RECEPTION_FUEL_LEVELS/);
assert.match(detail, /Selecciona una opción/);
assert.match(detail, /registrarRecepcionOrdenTrabajo/);
assert.doesNotMatch(detail, /value=\{order\.estado\}/);
console.log("OK UI OT: rutas, listado real, selección por patente y reutilización de Vehículos");
console.log("WORK_ORDER_UI_SMOKE_OK");
