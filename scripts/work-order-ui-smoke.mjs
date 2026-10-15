import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync("src/app/App.jsx", "utf8");
assert.match(app, /path="\/taller\/ordenes"/);
assert.match(app, /<WorkOrdersPage/);
assert.match(app, /<NewWorkOrderPage/);
assert.match(app, /path="\/taller\/ordenes\/:otId"/);
assert.match(app, /<WorkOrderDetailPage/);
assert.match(app, /path="\/taller\/plazas"/);
assert.match(app, /<WorkshopPlazasPage/);

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
assert.match(creation, /listarClientesSeleccionablesTaller/);
assert.match(creation, /hasBusinessPermission\(role, BUSINESS_PERMISSIONS.TALLER_CREATE\)/);
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
assert.match(detail, /<DiagnosisPanel/);
assert.match(detail, /<ServicePlanningPanel/);
assert.match(detail, /<ApprovalPanel/);
assert.match(detail, /<WorkOrderPlazaControl/);
assert.match(detail, /listarPlazasTaller/);
assert.match(detail, /Finalizar orden de trabajo/);
assert.match(detail, /Registrar entrega/);
assert.match(detail, /Cancelar OT/);
assert.match(detail, /beginClosure\("cancelar"\)/);
assert.match(detail, /allServicesCompleted/);
assert.match(detail, /ejecutarCierreOT/);
assert.match(detail, /obtenerHistorialOT/);
assert.match(detail, /work-order-history-list/);
assert.match(detail, /getWorkOrderHistoryEventLabel/);
assert.match(detail, /getWorkOrderHistoryDetail/);
assert.match(detail, /ResponsiveDialog/);
assert.match(detail, /\["pendiente_entrega", "cerrada", "cancelada"\]\.includes\(order\.estado\)/);
assert.doesNotMatch(detail, /updateDoc|setDoc|pendiente_pago/);
const historyModel = fs.readFileSync("src/domain/workOrderHistoryModel.mjs", "utf8");
for (const event of ["ot_creada", "recepcion_registrada", "diagnostico_completado", "vehiculo_entregado", "ot_cancelada"]) {
  assert.match(historyModel, new RegExp(event));
}
assert.doesNotMatch(historyModel, /costoUnitario|costoTotal|scopeHash/);
const plazasPage = fs.readFileSync("src/pages/WorkshopPlazasPage.jsx", "utf8");
for (const text of ["Nombre", "Estado", "Ocupación actual", "OT asignada", "Vehículo asignado", "Disponible", "En uso", "Nueva Plaza", "Editar", "Activar", "Inactivar"]) {
  assert.ok(plazasPage.includes(text));
}
assert.match(plazasPage, /deriveWorkshopPlazaOccupancy/);
assert.match(plazasPage, /canManageWorkshopPlazas/);
assert.match(plazasPage, /erp-table/);
assert.match(plazasPage, /erp-card-list erp-mobile-only/);
assert.doesNotMatch(plazasPage, /setDoc|updateDoc|estado:\s*["'](?:ocupada|disponible)["']/);
const plazaControl = fs.readFileSync("src/features/workOrders/WorkOrderPlazaControl.jsx", "utf8");
assert.match(plazaControl, /Asignar Plaza/);
assert.match(plazaControl, /Cambiar Plaza/);
assert.match(plazaControl, /Liberar Plaza/);
assert.match(plazaControl, /plaza\.estado !== "activa"/);
assert.doesNotMatch(plazaControl, /setDoc|updateDoc/);
const approvalPanel = fs.readFileSync("src/features/workOrders/ApprovalPanel.jsx", "utf8");
for (const action of ["Enviar a aprobación", "Aprobar", "Rechazar", "Revalidar disponibilidad"]) {
  assert.ok(approvalPanel.includes(action));
}
assert.match(approvalPanel, /summary\.puedeAprobar/);
assert.match(approvalPanel, /ResponsiveDialog/);
assert.match(approvalPanel, /confirmation\.revision/);
assert.doesNotMatch(approvalPanel, /setDoc|updateDoc|<select|type="number"/);
const diagnosisPanel = fs.readFileSync("src/features/workOrders/DiagnosisPanel.jsx", "utf8");
assert.match(diagnosisPanel, /Guardar borrador/);
assert.match(diagnosisPanel, /Completar diagnóstico/);
assert.match(diagnosisPanel, /diagnosis\.estado === "borrador"/);
assert.match(diagnosisPanel, /"pendiente_entrega", "cerrada", "cancelada"/);
const planningPanel = fs.readFileSync("src/features/workOrders/ServicePlanningPanel.jsx", "utf8");
const workOrderService = fs.readFileSync("src/services/workOrderService.js", "utf8");
assert.match(planningPanel, /listarCatalogoTaller/);
assert.doesNotMatch(planningPanel, /getInventoryItems/);
assert.match(planningPanel, /tipoItem === "servicio"/);
assert.match(planningPanel, /tipoItem === "producto"/);
assert.match(planningPanel, /cantidad planificada/i);
assert.match(planningPanel, /Stock actual Core/);
assert.match(planningPanel, /Valor Servicio/);
assert.match(planningPanel, /Iniciar servicio/);
assert.match(planningPanel, /Completar servicio/);
assert.match(planningPanel, /Eliminar servicio/);
assert.match(planningPanel, /Agregar servicio/);
assert.match(planningPanel, /Finalizar orden de trabajo/);
assert.match(planningPanel, /canFinalizeWorkOrder/);
assert.match(planningPanel, /className="work-order-finalize-button"/);
assert.match(planningPanel, /eliminarServicioOT/);
assert.match(planningPanel, /service\.estado === "pendiente"/);
assert.match(planningPanel, /service\.estado === "en_progreso"/);
assert.match(planningPanel, /order\.estado === "en_reparacion" && order\.estadoAprobacion === "aprobada"/);
assert.doesNotMatch(planningPanel, /Productos planificados/);
assert.doesNotMatch(planningPanel, /<th>Stock actual Core<\/th>/);
assert.match(planningPanel, /type="number" min="1" step="1"/);
assert.doesNotMatch(planningPanel, /type="number"[^>]*precio/);
assert.match(planningPanel, /className="erp-table work-order-products-table"/);
assert.match(planningPanel, /<th>Producto<\/th><th>Cantidad<\/th><th>Precio<\/th>/);
assert.match(planningPanel, /Sin productos planificados/);
assert.doesNotMatch(planningPanel, /ServiceMaterialsPanel|obtenerMaterialesOT|Registrar consumo|Registrar devolución|movimientos de inventario/);
assert.doesNotMatch(workOrderService, /registrarSalidaMaterialOT|registrarDevolucionMaterialOT|obtenerMaterialesOT/);
assert.match(approvalPanel, /work-order-approval-table/);
assert.match(approvalPanel, /work-order-approval-actions/);
const interiorStyles = fs.readFileSync("src/styles/interior.css", "utf8");
assert.match(interiorStyles, /\.work-order-products-table__quantity/);
assert.doesNotMatch(interiorStyles, /\.work-order-material-history/);
assert.doesNotMatch(detail, /value=\{order\.estado\}/);
console.log("OK UI OT: rutas, listado real, selección por patente y reutilización de Vehículos");
console.log("WORK_ORDER_UI_SMOKE_OK");
