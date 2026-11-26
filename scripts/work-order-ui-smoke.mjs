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
  "Estado",
  "Aprobación",
  "Plaza",
  "Actualización",
]) {
  assert.match(list, new RegExp(column));
}
assert.match(list, /matchesWorkOrderSearch/);
assert.match(list, /listarOrdenesTrabajo/);
assert.match(list, /className="erp-module-intro"/);
assert.match(list, /placeholder=\{countryCopy\.workOrderSearchExample\}/);
assert.match(list, /formatDate\(order\.actualizadoEn, locale\)/);
assert.doesNotMatch(list, /Cliente histórico|listarClientes|clientsById/);

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
// Al crear la OT se abre su ficha directamente.
assert.match(creation, /navigate\(`\/taller\/ordenes\/\$\{order\.otId\}`/);
assert.doesNotMatch(creation, /numeroOT\s*:/);
assert.doesNotMatch(creation, /clienteId\s*:/);

const detail = fs.readFileSync("src/pages/WorkOrderDetailPage.jsx", "utf8");
// Flujo único sin pestañas: Recepción → Aprobación → Ejecución → Entrega.
for (const step of ["Recepción", "Aprobación", "Ejecución", "Entrega"]) {
  assert.match(detail, new RegExp(`label: "${step}"`));
}
assert.doesNotMatch(detail, /role="tablist"|role="tab"|<DiagnosisPanel/);
assert.match(detail, /aria-current=\{activeStep === step\.id \? "step" : undefined\}/);
assert.match(detail, /obtenerOrdenTrabajo/);
assert.match(detail, /order\.plazaId/);
assert.match(detail, /getWorkOrderDisplayStatusLabel/);
assert.match(detail, /getWorkOrderApprovalLabel/);
// Al registrar la recepción por primera vez la pantalla avanza sola a la aprobación (sin volver a Recepción).
assert.match(detail, /justRegistered = !hadReceptionRef\.current && Boolean\(currentOrder\.recepcion\)/);
assert.match(detail, /setSelectedStep\(\(current\) => \(justRegistered \? null : current \|\| "recepcion"\)\)/);
assert.match(detail, /hadReceptionRef\.current = Boolean\(order\.recepcion\)/);
assert.match(detail, /<ReceptionPanel businessId=\{businessId\} onSaved=\{refreshOrder\}/);
assert.doesNotMatch(detail, /RECEPTION_CHECKLIST_FIELDS|Selecciona una opción|ReceptionPhotosPanel|function ReceptionPanel/);
assert.match(detail, /<ExecutionPanel/);
assert.match(detail, /<ApprovalPanel/);
assert.match(detail, /<WorkOrderPlazaControl/);
assert.match(detail, /listarPlazasTaller/);
assert.match(detail, /plazas\.find\(\(plaza\) => plaza\.plazaId === order\.plazaId\)\?\.nombre \|\| "Sin asignar"/);
assert.match(detail, /Finalizar ejecución/);
assert.match(detail, /Registrar entrega/);
assert.match(detail, /Cancelar OT/);
assert.match(detail, /beginClosure\("cancelar"\)/);
assert.match(detail, /<ExecutionPanel businessId=\{businessId\} currentUserUid=\{currentUserUid\}/);
assert.match(detail, /ejecutarCierreOT/);
const adminCards = fs.readFileSync("src/features/workOrders/AdminOverviewCards.jsx", "utf8");
assert.match(adminCards, /obtenerHistorialOT/);
assert.match(detail, /AdminOverviewCards/);
assert.match(adminCards, /Ocupación del taller/);
assert.match(adminCards, /Auditoría/);
assert.match(adminCards, /Ver auditoría/);
assert.match(adminCards, /if \(!open\) return undefined;/);
assert.doesNotMatch(adminCards, /Solo Owner y Administrador/);
assert.doesNotMatch(adminCards, /precio|monto|subtotal|formatBusinessMoney|costo/i);
// Navegación: solo Owner/Administrador cambian de paso.
assert.match(detail, /canManage && selectedStep \? selectedStep : flowStep/);
assert.match(detail, /disabled=\{!canManage\}/);
assert.match(detail, /const canManage = hasBusinessPermission\(role, BUSINESS_PERMISSIONS\.TALLER_MANAGE\)/);
assert.match(detail, /canManage && <AdminOverviewCards/);
assert.doesNotMatch(detail, /Cliente histórico|listarClientes|clientLabel/);
assert.match(adminCards, /work-order-history-list/);
assert.match(adminCards, /getWorkOrderHistoryEventLabel/);
assert.match(adminCards, /getWorkOrderHistoryDetail/);
assert.match(detail, /ResponsiveDialog/);
// La recepción solo se edita antes de aprobar el ingreso y fuera de los estados finales.
assert.match(fs.readFileSync("src/domain/workOrderReceptionPhotoModel.mjs", "utf8"), /RECEPTION_PHOTO_LOCKED_STATES = Object\.freeze\(\["pendiente_entrega", "cerrada", "cancelada"\]\)/);
assert.match(fs.readFileSync("src/features/workOrders/ReceptionPanel.jsx", "utf8"), /canRegisterReceptionPhotos\(order\)/);
assert.doesNotMatch(detail, /updateDoc|setDoc|pendiente_pago/);
const historyModel = fs.readFileSync("src/domain/workOrderHistoryModel.mjs", "utf8");
for (const event of ["ot_creada", "recepcion_registrada", "diagnostico_completado", "vehiculo_entregado", "ot_cancelada"]) {
  assert.match(historyModel, new RegExp(event));
}
assert.doesNotMatch(historyModel, /costoUnitario|costoTotal|scopeHash/);
const plazasPage = fs.readFileSync("src/pages/WorkshopPlazasPage.jsx", "utf8");
// Plazas en vista gráfica (prototipo): ocupación, bahías por estado, detalle de la plaza y cola de espera, sin montos.
for (const text of ["Ocupación del taller", "plazas activas", "En revisión", "En reparación", "Listo para retiro", "Inactiva", "Libre",
  "Disponible", "No recibe vehículos", "Cola de espera", "Cuando se libera o se crea una plaza, entra el primero de la cola.",
  "Las plazas con historial no se eliminan, se inactivan.", "Abrir OT", "Nueva Plaza", "Editar", "Activar", "Inactivar"]) {
  assert.ok(plazasPage.includes(text), `Plazas: falta «${text}»`);
}
assert.match(plazasPage, /deriveWorkshopPlazaOccupancy/);
assert.match(plazasPage, /workshopOccupancySummary\(plazas, occupancy\)/);
assert.match(plazasPage, /workshopWaitingQueue\(orders\)/);
assert.match(plazasPage, /aria-pressed=\{selected\}/);
assert.match(plazasPage, /role="progressbar"/);
assert.doesNotMatch(plazasPage.replace(/^\s*\/\/.*$/gm, ""), /precio|monto|subtotal|Solo Owner y Administrador/i);
assert.match(plazasPage, /canManageWorkshopPlazas/);
assert.match(plazasPage, /if \(canManage\) load\(\)/);
assert.match(plazasPage, /if \(!canManage\)/);
assert.match(plazasPage, /El acceso a Plazas está restringido para tu perfil/);
assert.match(plazasPage, /Propietario o Administrador pueden administrar esta sección/);
assert.doesNotMatch(plazasPage, /OWNER o ADMIN/);
assert.match(plazasPage, /className="erp-module-intro"/);
assert.doesNotMatch(plazasPage, /className="erp-page-header"/);
assert.doesNotMatch(plazasPage, /setDoc|updateDoc|estado:\s*["'](?:ocupada|disponible)["']/);
const plazaControl = fs.readFileSync("src/features/workOrders/WorkOrderPlazaControl.jsx", "utf8");
assert.match(plazaControl, /Asignar Plaza/);
assert.match(plazaControl, /Cambiar Plaza/);
assert.match(plazaControl, /Liberar Plaza/);
assert.match(plazaControl, /plaza\.estado !== "activa"/);
assert.doesNotMatch(plazaControl, /setDoc|updateDoc/);
const approvalPanel = fs.readFileSync("src/features/workOrders/ApprovalPanel.jsx", "utf8");
for (const action of ["Aprobar ingreso", "En espera", "Anulada", "Elige responsable", "Elegir técnico"]) {
  assert.ok(approvalPanel.includes(action));
}
assert.match(approvalPanel, /summary\.puedeAprobar/);
// Compuerta de ingreso: motivo obligatorio al rechazar, sin alcance, totales ni montos.
assert.match(approvalPanel, /Motivo obligatorio \(falta algo para continuar\)/);
assert.match(approvalPanel, /if \(!reason\.trim\(\)\)/);
assert.match(approvalPanel, /Esperando la aprobación de Administración u Owner/);
assert.match(approvalPanel, /se asigna automáticamente/);
assert.doesNotMatch(approvalPanel, /Enviar a aprobación|Revalidar|summary\.alcance|calculateWorkOrderScopeTotal|precioUnitario|Subtotal|<th>Precio<\/th>|amount\(|formatBusinessMoney/);
assert.match(approvalPanel, /<LoadingState variant="section" label="Cargando aprobación\.\.\." \/>/);
assert.match(approvalPanel, /summary\.revision/);
assert.doesNotMatch(approvalPanel, /erp-empty-state" role="status">Cargando/);
assert.doesNotMatch(approvalPanel, /setDoc|updateDoc|type="number"/);
const diagnosisPanel = fs.readFileSync("src/features/workOrders/DiagnosisPanel.jsx", "utf8");
assert.match(diagnosisPanel, /Guardar borrador/);
assert.match(diagnosisPanel, /Completar diagnóstico/);
assert.match(diagnosisPanel, /diagnosis\.estado === "borrador"/);
assert.match(diagnosisPanel, /"pendiente_entrega", "cerrada", "cancelada"/);
assert.match(diagnosisPanel, /useBusinessFormat/);
assert.match(diagnosisPanel, /formatTimestamp\(value, locale\)/);
assert.doesNotMatch(diagnosisPanel, /toLocaleString\("es-CL"/);
const executionPanel = fs.readFileSync("src/features/workOrders/ExecutionPanel.jsx", "utf8");
const workItem = fs.readFileSync("src/features/workOrders/ExecutionWorkItem.jsx", "utf8");
const workPhotos = fs.readFileSync("src/features/workOrders/ServiceWorkPhotos.jsx", "utf8");
const executionModelSource = fs.readFileSync("src/domain/workOrderExecutionModel.mjs", "utf8");
const workOrderService = fs.readFileSync("src/services/workOrderService.js", "utf8");
assert.ok(!fs.existsSync("src/features/workOrders/ServicePlanningPanel.jsx"), "la planificación anterior fue reemplazada por la ejecución");
// Pantalla de ejecución del prototipo: tarjetas, catálogo, trabajos en acordeón y requisitos para finalizar.
for (const title of ["Motivo del cliente", "Trabajos", "Para finalizar la ejecución"]) {
  assert.match(executionPanel, new RegExp(`"${title}"`));
}
assert.match(executionPanel, /Ver recepción/);
// La recepción de solo lectura (tras enviarla a aprobación) también permite ver la foto del tablero.
assert.match(fs.readFileSync("src/features/workOrders/ReceptionPanel.jsx", "utf8"), /<Card title="4\. Tablero">\s*<DashboardPhotoControl photos=\{photos\} \/>\s*<dl/);
assert.match(executionPanel, /Ocultar recepción/);
assert.match(executionPanel, /Fotos selladas/);
assert.match(executionPanel, /Daños previos/);
assert.match(executionPanel, /listarCatalogoTaller/);
assert.match(executionPanel, /<LoadingState variant="section" label="Cargando catálogo\.\.\." \/>/);
assert.match(executionPanel, /tipoItem === "servicio"/);
assert.match(executionPanel, /tipoItem === "producto"/);
assert.match(executionPanel, /Solo el responsable \(\{order\.responsableNombre/);
assert.match(executionPanel, /Finalizar ejecución/);
assert.match(executionPanel, /Trabajos terminados\. El Administrador o el Owner pueden finalizar la ejecución\./);
assert.match(executionPanel, /canManage && progress\.complete/);
assert.match(executionPanel, /reloadInventory/);
assert.match(executionPanel, /crearServicioOT\(businessId, otId, \{itemId: newItemId\}/);
assert.doesNotMatch(executionPanel, /responsableUid/);
assert.doesNotMatch(executionPanel, /getInventoryItems/);
// Cada trabajo: acordeón con estado, repuestos (inventario, cliente o ninguno), fotos y acciones por estado.
assert.match(workItem, /aria-expanded=\{open\}/);
for (const text of ["Del inventario", "Define los repuestos de este servicio.", "Iniciar trabajo", "Terminar trabajo", "Reabrir trabajo", "Quitar trabajo",
  "Trabajo cerrado: solo Owner o Administrador pueden editarlo.", "Desde hallazgo", "Quitar"]) {
  assert.ok(workItem.includes(text), `falta «${text}» en el trabajo`);
}
assert.match(workItem, /disabled=\{busy \|\| !defined\}/);
assert.match(workItem, /Stock: \{formatStock\(core\)\}/);
assert.match(workItem, /no se reserva para esta OT/);
assert.match(workItem, /type="number" min="1" step="1"/);
assert.match(workItem, /existing \? "Actualizar" : "Agregar"/);
assert.match(workPhotos, /Fotos del trabajo \(opcional\)/);
assert.match(workPhotos, /capture="environment"/);
assert.match(workPhotos, /receptionImageAsJpeg/);
assert.match(executionModelSource, /canOperateOrderWorks/);
// El taller no muestra montos: ni valores de servicio, ni precios, ni subtotales.
for (const source of [executionPanel, workItem, workPhotos]) {
  assert.doesNotMatch(source, /Valor Servicio|Precio vigente|priceLabel|currentPrice|precioEfectivo|formatBusinessMoney|Intl\.NumberFormat|precioUnitario/);
  assert.doesNotMatch(source, /ServiceMaterialsPanel|obtenerMaterialesOT|Registrar consumo|Registrar devolución|movimientos de inventario/);
}
const persistenceForStock = fs.readFileSync("functions/workOrderPersistence.js", "utf8");
assert.doesNotMatch(persistenceForStock, /readCommittedProductUnits|STOCK_COMMITTING_STATES/);
assert.match(persistenceForStock, /Stock insuficiente de «\$\{nombre\}»: stock actual/);
assert.match(persistenceForStock, /Solo el responsable de la OT, el Administrador o el Owner operan los trabajos\./);
for (const name of ["reabrirServicioOT", "definirRepuestosServicioOT", "subirFotoServicioOT", "leerFotoServicioOT"]) {
  assert.match(workOrderService, new RegExp(`export (async )?function ${name}`));
}
assert.doesNotMatch(workOrderService, /registrarSalidaMaterialOT|registrarDevolucionMaterialOT|obtenerMaterialesOT/);
// El responsable de la OT se elige al aprobar.
assert.match(approvalPanel, /Responsable de la ejecución/);
assert.match(approvalPanel, /listarPersonasAsignablesTaller/);
assert.doesNotMatch(approvalPanel, /work-order-approval-table/);
assert.match(approvalPanel, /work-order-approval-actions/);
const tallerStyles = fs.readFileSync("src/features/taller/taller.css", "utf8");
const interiorStyles = fs.readFileSync("src/styles/interior.css", "utf8");
assert.match(tallerStyles, /\.work-order-products-table__quantity/);
assert.doesNotMatch(tallerStyles, /\.work-order-material-history/);
assert.doesNotMatch(interiorStyles, /\.work-order-products-table__quantity/);
assert.doesNotMatch(detail, /value=\{order\.estado\}/);
assert.match(fs.readFileSync("src/features/workOrders/ReceptionPanel.jsx", "utf8"), /Recepción registrada correctamente\./);
assert.match(detail, /onSaved=\{refreshOrder\}/);
assert.doesNotMatch(detail, /¿Confirmas esta acción para/);
assert.match(detail, /¿Confirmas que la ejecución de \$\{otLabel\} está terminada\?/);
const navigation = fs.readFileSync("src/app/navigation.js", "utf8");
const layout = fs.readFileSync("src/layout/AppLayout.jsx", "utf8");
for (const path of ["ordenes", "vehiculos", "plazas"]) {
  assert.ok(navigation.includes(`path: "${path}"`));
}
assert.match(navigation, /requiredPermission: BUSINESS_PERMISSIONS\.TALLER_MANAGE/);
assert.match(navigation, /const to = path \? `\$\{basePath\}\/\$\{path\}` : basePath;/);
assert.match(navigation, /pathname === to \|\| pathname\.startsWith\(`\$\{to\}\/`\)/);
assert.match(layout, /item\.children/);
assert.match(layout, /nav-module__items/);
assert.match(layout, /: pathname === item\.to;/);
assert.doesNotMatch(layout, /: pathname === item\.to \|\| pathname\.startsWith/);
assert.match(layout, /idPrefix="desktop"/);
assert.match(layout, /idPrefix="mobile"/);
const layoutStyles = fs.readFileSync("src/styles/layout.css", "utf8");
assert.match(layoutStyles, /\.nav-module__label[\s\S]*font-size: var\(--font-size-xs\)/);
assert.match(layoutStyles, /\.nav-module__label[\s\S]*color: var\(--color-text-muted\)/);
// Plaza automática: la lista, la ficha y la aprobación muestran la espera sin montos.
assert.match(list, /getWorkOrderDisplayStatusLabel\(order\)/);
assert.doesNotMatch(list, /getWorkOrderStatusLabel\(order\.estado\)/);
assert.match(detail, /getWorkOrderDisplayStatusLabel\(order\)/);
assert.match(detail, /La ejecución comienza cuando se asigne una plaza\./);
assert.match(approvalPanel, /isWorkOrderWaitingForPlaza\(order\)/);
assert.match(approvalPanel, /En cola de plaza\./);
assert.match(approvalPanel, /result\?\.enEsperaDePlaza/);
assert.doesNotMatch(approvalPanel, /precio|monto|subtotal|formatBusinessMoney/i);
const plazaAssignment = fs.readFileSync("functions/workOrderPlazaAssignment.js", "utf8");
assert.doesNotMatch(plazaAssignment, /require\("\.\/workOrder(Persistence|Plazas)"\)/);
assert.match(fs.readFileSync("functions/package.json", "utf8"), /workOrderPlazaAssignment\.js/);
// El negocio conserva al menos una Plaza activa: aprobar e inactivar lo validan en el servidor.
assert.match(fs.readFileSync("functions/workOrderPersistence.js", "utf8"), /Crea al menos una Plaza activa en Taller > Plazas antes de aprobar el ingreso\./);
assert.match(fs.readFileSync("functions/workOrderPlazas.js", "utf8"), /El negocio debe tener al menos una Plaza activa\./);
// Fotos de recepción (prototipo «Panel del Taller»): silueta con seis zonas, tablero aparte,
// captura guiada en pasos, daños con marcas y fotos selladas. Sin montos.
const photosPanel = fs.readFileSync("src/features/workOrders/ReceptionPhotosPanel.jsx", "utf8");
const photoCapture = fs.readFileSync("src/features/workOrders/ReceptionPhotoCapture.jsx", "utf8");
const vehicleShapes = fs.readFileSync("src/features/workOrders/receptionVehicleShapes.js", "utf8");
const receptionPanel = fs.readFileSync("src/features/workOrders/ReceptionPanel.jsx", "utf8");
const carSilhouette = fs.readFileSync("src/features/workOrders/CarSilhouette.jsx", "utf8");
// Formulario de recepción del prototipo: relato, fotos, tablero y requisitos, en una sola pantalla.
const cardTitles = ["1. Relato del cliente", "2. Quién entrega el vehículo", "3. Fotos del vehículo", "4. Tablero", "Para registrar la recepción"];
cardTitles.forEach((title) => assert.ok(receptionPanel.includes(`title="${title}"`), `tarjeta «${title}»`));
const formMarkup = receptionPanel.slice(receptionPanel.indexOf('<form className="work-order-reception"'));
const formOrder = ['title="1. Relato del cliente"', 'title="2. Quién entrega el vehículo"', "{vehicleCard}", 'title="4. Tablero"', 'title="Para registrar la recepción"'].map((part) => formMarkup.indexOf(part));
assert.ok(formOrder.every((position, index) => position > 0 && (index === 0 || position > formOrder[index - 1])),
  "las tarjetas del formulario siguen el orden del prototipo");
assert.match(receptionPanel, /Motivo de ingreso: lo que el cliente indica\./);
assert.match(receptionPanel, /RECEPTION_QUICK_REASONS\.map/);
// Quién entrega el vehículo (puede no ser el titular): nombre y RUT; el RUT solo lo ve Owner/Administrador.
for (const text of ["Nombre de quien entrega *", "RUT de quien entrega *", "Puede no ser el titular"]) {
  assert.ok(receptionPanel.includes(text), `Recepción: falta «${text}»`);
}
assert.doesNotMatch(receptionPanel, /ingresaRelacion/);
assert.match(receptionPanel, /canSeeBearerDocument && stored\.ingresaTieneDocumento/);
assert.match(fs.readFileSync("functions/workOrderDelivery.js", "utf8"), /operation === "ingreso"[\s\S]{0,200}hasTallerCapability\(context\.membership, "manage"\)/);
assert.match(fs.readFileSync("functions/workOrderPersistence.js", "utf8"), /recepcionActa/);
assert.match(receptionPanel, /hint="Foto obligatoria"/);
assert.match(receptionPanel, /¿Sensores encendidos en el tablero\?/);
assert.match(receptionPanel, /RECEPTION_FUEL_LEVELS\.map/);
assert.match(receptionPanel, /RECEPTION_WARNING_LIGHTS\.map/);
assert.match(receptionPanel, /max=\{MAX_RECEPTION_MILEAGE_KM\}/);
assert.match(receptionPanel, /registrarRecepcionOrdenTrabajo/);
assert.match(receptionPanel, /Faltan \$\{pending\} requisito\(s\)/);
assert.match(receptionPanel, /disabled=\{saving \|\| pending > 0\}/);
assert.match(receptionPanel, /\[storedKey\]/, "guardar una foto no borra lo que se está escribiendo");
assert.doesNotMatch(receptionPanel, /<select|RECEPTION_CHECKLIST|accesoriosTexto/);
assert.match(photosPanel, /export function useReceptionPhotos/);
assert.match(photosPanel, /<CarSilhouette zones=\{progress\.zones\}/);
// La silueta tiene forma de auto: carrocería, ruedas, espejos, luces, parabrisas, vidrio trasero y techo.
for (const part of ["__body", "__wheel", "__mirror", "__light", "__glass", "__roof", "__cabin"]) {
  assert.ok(carSilhouette.includes(`work-order-silhouette${part}`), `silueta: ${part}`);
}
assert.match(carSilhouette, /clipPath/);
assert.doesNotMatch(carSilhouette, /radius/);
assert.equal((carSilhouette.match(/C\d/g) || []).length >= 4, true, "el contorno es curvo, no un rectángulo");
assert.match(photosPanel, /Toca una zona para abrir la cámara con la guía de encuadre de esa parte del vehículo\./);
assert.match(photosPanel, /La foto queda sellada con fecha y usuario, y no se puede editar\./);
assert.match(photosPanel, /· con daños/);
assert.doesNotMatch(photosPanel, /quitarFotoRecepcionOT|Reemplazar foto|Quitar foto/);
assert.match(photoCapture, /accept="image\/\*" capture="environment"/);
assert.match(photoCapture, /Alinea el vehículo con el contorno/);
assert.match(photoCapture, /¿Se ve completa y nítida la zona\?/);
assert.match(photoCapture, /Repetir/);
assert.match(photoCapture, /Estado de esta zona/);
assert.match(photoCapture, /Sin daños/);
assert.match(photoCapture, /Con daños/);
assert.match(photoCapture, /Toca la foto para marcar cada daño y escribe una nota\./);
assert.match(photoCapture, /Guardar y volver a la silueta/);
assert.doesNotMatch(photoCapture, /Zona guardada|Aceptar y continuar/, "al guardar vuelve directo a la selección de zonas");
assert.match(photoCapture, /await onSaved\(\);\r?\n\s*onDone\(\);/);
assert.match(photoCapture, /Cancelar captura/);
assert.match(vehicleShapes, /"lateral-derecho-delantero": \{parts: SIDE_FRONT, mirror: true\}/);
for (const source of [photosPanel, photoCapture, receptionPanel, carSilhouette]) {
  assert.doesNotMatch(source, /precio|monto|subtotal|formatBusinessMoney|getDownloadURL|firebase\/storage/i);
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,6}\b/, "colores solo con tokens");
}
const photoImage = fs.readFileSync("src/features/workOrders/receptionPhotoImage.js", "utf8");
assert.match(photoImage, /canvas\.toBlob\(resolve, "image\/jpeg", quality\)/);
assert.match(photoImage, /2 \* 1024 \* 1024/);
const photoModelSource = fs.readFileSync("src/domain/workOrderReceptionPhotoModel.mjs", "utf8");
const serverZoneSource = fs.readFileSync("functions/workOrderReceptionPhotoZones.js", "utf8");
const clientZones = [...photoModelSource.matchAll(/\bid: "([a-z-]+)"/g)].map((match) => match[1]);
const serverZones = [...serverZoneSource.matchAll(/\bid: "([a-z-]+)"/g)].map((match) => match[1]);
assert.equal(serverZones.length, 7, "seis zonas exteriores y el tablero");
assert.deepEqual(clientZones, serverZones, "las zonas del cliente coinciden con las del servidor");
assert.match(fs.readFileSync("functions/index.js", "utf8"), /exports\.fotosRecepcionOT = onCall\(/);
{
  const indexSource = fs.readFileSync("functions/index.js", "utf8");
  for (const name of ["fotosServicioOT", "reabrirServicioOT", "definirRepuestosServicioOT"]) {
    assert.match(indexSource, new RegExp(`exports\\.${name} = onCall\\(`));
  }
  const servicePhotos = fs.readFileSync("functions/workOrderServicePhotos.js", "utf8");
  assert.match(servicePhotos, /La foto «\$\{MOMENT_LABELS\[moment\]\}» de este trabajo ya fue registrada y no se puede modificar\./);
  assert.match(servicePhotos, /assertWorkOperator/);
  assert.match(servicePhotos, /file\.delete\(\{ignoreNotFound: true\}\)/);
  assert.match(servicePhotos, /service\.estado === "completado"/);
}
assert.match(fs.readFileSync("functions/package.json", "utf8"), /workOrderReceptionPhotos\.js workOrderReceptionPhotoZones\.js/);
assert.doesNotMatch(fs.readFileSync("storage.rules", "utf8"), /ordenesTrabajo/, "Storage no abre las fotos de recepción al cliente");
// Fotos obligatorias para registrar la recepción; la aprobación revalida y muestra los daños previos.
const persistenceForPhotos = fs.readFileSync("functions/workOrderPersistence.js", "utf8");
assert.match(persistenceForPhotos, /Complétalas antes de registrar la recepción\./);
assert.match(persistenceForPhotos, /danosPrevios: receptionPhotoDamages\(order\)/);
assert.match(receptionPanel, /receptionRequirements\(values, photos\.progress\)/);
assert.match(approvalPanel, /summary\?\.fotosFaltantes/);
assert.match(approvalPanel, /summary\?\.danosPrevios/);
assert.match(approvalPanel, /Fotos de las 6 zonas y del tablero/);
assert.match(approvalPanel, /Motivo del cliente registrado/);
assert.match(approvalPanel, /Kilometraje, combustible y sensores/);
assert.match(approvalPanel, /disabled=\{busy \|\| !responsableUid \|\| missingPhotos\.length > 0\}/);
assert.doesNotMatch(fs.readFileSync("storage.rules", "utf8"), /ordenesTrabajo/, "Storage no abre las fotos de recepción al cliente");
console.log("OK UI OT: rutas, listado real, selección por patente y reutilización de Vehículos");
// Hallazgos de la ejecución: foto obligatoria, prioridad, conversión solo para Owner/Administrador, sin montos.
const findings = fs.readFileSync("src/features/workOrders/ExecutionFindings.jsx", "utf8");
for (const text of ["¿Qué encontraste?", "Urgente · seguridad", "Recomendado", "Foto (opcional)", "Guardar hallazgo",
  "Convertido en trabajo", "Observación", "Agregar como trabajo"]) {
  assert.ok(findings.includes(text), `Hallazgos: falta «${text}»`);
}
assert.match(findings, /running && canConvert && !finding\.convertido/);
assert.match(findings, /!draft\.descripcion\.trim\(\) \|\| draft\.urgente === null\)/);
assert.doesNotMatch(findings, /Foto \(obligatoria\)/);
assert.doesNotMatch(findings, /precio|monto|subtotal|formatBusinessMoney|costo/i);
assert.match(fs.readFileSync("src/features/workOrders/ExecutionPanel.jsx", "utf8"), /canConvert=\{canManage\} canReport=\{canOperate\}/);
assert.match(fs.readFileSync("src/features/workOrders/ExecutionWorkItem.jsx", "utf8"), /service\.origenHallazgoId/);
const findingsServer = fs.readFileSync("functions/workOrderFindings.js", "utf8");
assert.match(findingsServer, /operation === "convertir" \? "manage"/);
console.log("OK UI OT: hallazgos con foto opcional y conversión solo para Owner/Administrador");
// Entrega con trazabilidad y contacto rápido con el cliente.
const delivery = fs.readFileSync("src/features/workOrders/DeliveryPanel.jsx", "utf8");
for (const text of ["Nombre de quien retira *", "RUT de quien retira *", "Observaciones del cliente (opcional)",
  "lo recibe en el estado que muestran las fotos de entrega", "Registrar entrega", "Recepción · cómo llegó", "Entrega · cómo se retiró", "Acta de entrega"]) {
  assert.ok(delivery.includes(text), `Entrega: falta «${text}»`);
}
assert.match(delivery, /disabled=\{!ready \|\| registering\}/);
assert.match(delivery, /closed && canManage/);
assert.match(delivery, /<CarSilhouette zones=\{zones\}/);
assert.match(delivery, /onUpload: \(base64\) => subirFotoEntregaOT/);
assert.match(delivery, /obtenerActaEntregaOT\(businessId, otId\)/);
assert.doesNotMatch(delivery, /precio|subtotal|formatBusinessMoney|costo/i);
assert.match(detail, /<DeliveryPanel/);
// La ejecución terminada sigue visible, solo lectura.
assert.match(detail, /\["en_reparacion", "pendiente_entrega", "cerrada"\]\.includes\(order\.estado\)/);
assert.match(executionPanel, /"Trabajos realizados"/);
assert.doesNotMatch(executionPanel, /· Sin montos/);
assert.match(executionPanel, /readOnly=\{finished\}/);
assert.match(executionPanel, /\{!finished && <Card title="Para finalizar la ejecución">/);
const contact = fs.readFileSync("src/features/workOrders/ClientContactCard.jsx", "utf8");
assert.match(contact, /href=\{`tel:\+\$\{phone\.telefonoInternacional\}`\}/);
assert.match(contact, /https:\/\/wa\.me\//);
assert.match(contact, /rel="noopener noreferrer"/);
assert.match(delivery, /<ClientContactCard/);
assert.doesNotMatch(detail, /ClientContactCard/);
assert.match(contact, /Sin teléfono registrado/);
assert.match(contact, /aria-disabled="true"/);
const deliveryServer = fs.readFileSync("functions/workOrderDelivery.js", "utf8");
assert.match(deliveryServer, /hasTallerCapability\(context\.membership, "manage"\)/);
assert.match(fs.readFileSync("functions/index.js", "utf8"), /exports\.entregaOT = onCall\(/);
assert.match(fs.readFileSync("functions/workOrderPersistence.js", "utf8"), /missingDeliveryZones\(actaSnapshot\.exists/);
console.log("OK UI OT: entrega con fotos, acta y contacto con el cliente");
// Seguimiento público: ruta sin sesión, página sin montos y enlace solo con el ingreso aprobado.
const appSource = fs.readFileSync("src/app/App.jsx", "utf8");
assert.match(appSource, /import PublicWorkshopTrackingPage from "\.\.\/pages\/PublicWorkshopTrackingPage";/);
assert.ok(appSource.indexOf("PublicWorkshopTrackingPage />") < appSource.indexOf("if (loading) return <LoadingScreen />;"), "la ruta pública va antes de exigir sesión");
const trackingPage = fs.readFileSync("src/pages/PublicWorkshopTrackingPage.jsx", "utf8");
assert.doesNotMatch(trackingPage.replace(/^\s*\/\/.*$/gm, ""), /precio|monto|subtotal|responsable|plaza|foto/i);
for (const text of ["Seguimiento de tu vehículo", "Avance de los trabajos", "Observaciones del taller", "Ver estado",
  "Este enlace ya no está activo.", "También puedes entrar con el enlace que te envió el taller."]) {
  assert.ok(trackingPage.includes(text), `Seguimiento: falta «${text}»`);
}
assert.doesNotMatch(trackingPage, /localStorage|sessionStorage/, "el seguimiento no guarda la patente ni el RUT en el navegador");
assert.match(detail, /<TrackingLinkCard/);
assert.match(detail, /activeStep === "ejecucion" && order\.estadoAprobacion === "aprobada" &&\s*\["en_reparacion", "pendiente_entrega"\]\.includes\(order\.estado\)/);
assert.doesNotMatch(detail, /\["ejecucion", "entrega"\]\.includes\(activeStep\)/, "el seguimiento del cliente solo aparece en Ejecución, no en Entrega");
const trackingCard = fs.readFileSync("src/features/workOrders/TrackingLinkCard.jsx", "utf8");
assert.match(trackingCard, /Es único, no contiene la patente ni el RUT/);
assert.match(trackingCard, /El cliente también puede consultar con su patente y RUT en/);
assert.doesNotMatch(trackingCard, /Copiar página de consulta/, "la consulta con patente y RUT es una ruta pública, no un botón");
assert.ok(appSource.includes("/^\\/seguimiento(\\/(taller\\/)?[^/]+)?\\/?$/"), "ruta pública /seguimiento para toda la plataforma");
assert.doesNotMatch(trackingCard, /Sin montos, técnico ni fotos|work-order-tracking__url/, "sin texto redundante ni el enlace escrito dos veces");
assert.match(trackingCard, /rel="noopener noreferrer"/);
// La consulta con patente + RUT queda apagada hasta contar con App Check o captcha: la pantalla y la tarjeta lo respetan.
const trackingService = fs.readFileSync("src/services/workshopTrackingService.js", "utf8");
assert.match(trackingService, /VITE_SEGUIMIENTO_CONSULTA_PUBLICA === "true"/);
assert.match(trackingPage, /isPublicLookupEnabled\(\) \? <ManualTracking \/> : <InactiveLink message=\{LOOKUP_UNAVAILABLE\} \/>/);
assert.match(trackingCard, /isPublicLookupEnabled\(\) && <p/);
assert.doesNotMatch(trackingPage, /PRGZ63|ABCD12/, "la pantalla pública no muestra una patente de ejemplo de un solo país");
// La patente de ejemplo sale del país del negocio (countryFormCopy), no de un texto fijo.
const newOrderPage = fs.readFileSync("src/pages/NewWorkOrderPage.jsx", "utf8");
assert.match(newOrderPage, /getCountryFormCopy\(countryCode\)\.vehiclePlateExample/);
assert.doesNotMatch(newOrderPage, /ABCD12/, "Nueva OT: la patente de ejemplo depende del país");
const trackingServer = fs.readFileSync("functions/workOrderTracking.js", "utf8");
assert.match(trackingServer, /requireTallerAccess\(request, dependencies, "operate"\)/);
assert.match(fs.readFileSync("functions/index.js", "utf8"), /exports\.consultarSeguimientoTaller = onCall\(/);
assert.match(fs.readFileSync("functions/index.js", "utf8"), /exports\.buscarSeguimientoTaller = onCall\(/);
assert.match(fs.readFileSync("functions/index.js", "utf8"), /exports\.seguimientoOT = onCall\(/);
assert.match(fs.readFileSync("functions/workOrderPersistence.js", "utf8"),
  /collection\("tallerSeguimientoTokens"\)\.doc\(trackingTokenHash\), \{\s*estado: "inactivo"/, "la entrega inactiva el enlace en la misma transacción");
console.log("OK UI OT: seguimiento público por enlace o patente + RUT, sin montos");
// Panel del taller: ruta base del módulo, al comienzo de la sección «Inicio» del menú y vistas de Administración y técnico, sin montos.
const homePage = fs.readFileSync("src/pages/WorkshopHomePage.jsx", "utf8");
assert.match(appSource, /path="\/taller"\s*element=\{\s*<WorkshopHomePage/);
assert.doesNotMatch(appSource, /<Route path="\/taller" element=\{<Navigate to="\/taller\/ordenes" replace \/>\} \/>/);
{
  // El panel del taller va al comienzo de la sección «Inicio», junto a Reportes, y no se llama «Inicio».
  const {buildNavigationSections} = await import("../src/app/navigation.js");
  const {VERTICAL_MODULES} = await import("../src/domain/verticalModules.mjs");
  const sections = buildNavigationSections(VERTICAL_MODULES, {primaryModules: ["taller"]});
  const home = sections.find((section) => section.label === "Inicio");
  assert.deepEqual(home.items.map((item) => item.to), ["/taller", "/reportes"]);
  assert.equal(home.items[0].label, "Panel del taller");
  assert.ok(home.items[0].activeWhen("/taller") && !home.items[0].activeWhen("/taller/ordenes"));
  const operation = sections.find((section) => section.label === "Operación");
  assert.ok(!operation.items.some((item) => item.to === "/taller"), "el panel no se repite en Operación");
  assert.deepEqual(operation.items.filter((item) => item.to.startsWith("/taller")).map((item) => item.to),
    ["/taller/ordenes", "/taller/vehiculos", "/taller/plazas"]);
}
for (const text of ["Nueva recepción", "Buscar por patente", "Por aprobar", "En reparación", "En cola",
  "Listos para retiro", "Requiere atención", "Plazas de un vistazo", "Actividad de hoy",
  "Mis trabajos", "OT a mi cargo", "Trabajos pendientes"]) {
  assert.ok(homePage.includes(text), `Inicio: falta «${text}»`);
}
assert.doesNotMatch(homePage.replace(/^\s*\/\/.*$/gm, ""), /precio|subtotal|Solo Owner y Administrador|no se muestran montos/i);
assert.match(homePage, /canManage \? listarPlazasTaller\(businessId\) : \[\]/, "el técnico no consulta plazas");
assert.match(homePage, /if \(canManage\) \{\s*Promise\.all\(executing/, "solo Administración consulta hallazgos");
assert.match(homePage, /className="workshop-home__works"/, "Mis trabajos lista los trabajos de cada OT");
assert.match(homePage, /WORK_STATUS_LABELS\[service\.estado\]/, "cada trabajo muestra su estado");
assert.doesNotMatch(homePage, /<span>Pendientes<\/span>/, "la tarjeta se llama Trabajos pendientes");
assert.match(homePage, /greetingPersonName\(profile\)/, "el saludo usa nombre y apellido del perfil");
assert.match(homePage, /profileName \|\| fallbackUserName\(\)/, "sin nombre y apellido se conserva el saludo actual");
assert.doesNotMatch(homePage, /Flujo del taller/, "sin flujo por etapa: repetía los indicadores");
assert.match(homePage, /icon=\{Warehouse\} onClick=\{\(\) => navigate\("\/taller\/plazas"\)\}>Plazas</, "mismo ícono de Plazas que el menú");
assert.match(fs.readFileSync("src/app/navigation.js", "utf8"), /label: "Plazas",\s*title: "Plazas",\s*icon: Warehouse/);
assert.match(homePage, /REFRESH_MS = 2 \* 60 \* 1000/);
assert.match(homePage, /visibilitychange/);
assert.match(homePage, /to=\{view\("por-aprobar"\)\}/);
assert.doesNotMatch(homePage, /Entregados hoy|Por recibir/);
// «Trabajos pendientes» solo existe en la vista del técnico (Administración no lo muestra).
assert.equal((homePage.match(/<span>Trabajos pendientes<\/span>/g) || []).length, 1);
assert.ok(homePage.indexOf("<span>Trabajos pendientes</span>") > homePage.indexOf("function TechnicianHome"), "Trabajos pendientes es solo del técnico");
assert.match(homePage, /canManage \? listarCatalogoTaller\(businessId\)\.catch\(\(\) => \[\]\) : \[\]/, "el stock bajo no bloquea el panel");
assert.match(homePage, /lowStockAttention\(catalog\)/);
assert.match(homePage, /<Link to=\{`\/taller\/ordenes\/\$\{order\.otId\}`\} aria-label=\{label\} data-kind="occupied">/, "la plaza ocupada abre su OT");
const ordersPage = fs.readFileSync("src/pages/WorkOrdersPage.jsx", "utf8");
assert.match(ordersPage, /workOrdersForView\(orders, homeView\)/);
assert.match(ordersPage, /Quitar filtro/);
console.log("OK UI Taller: Inicio para Administración y técnico");
console.log("WORK_ORDER_UI_SMOKE_OK");
