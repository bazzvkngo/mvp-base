# Taller Automotriz: etapa 9 — aprobación y snapshots

## Resumen

Envío, aprobación, rechazo, revalidación de disponibilidad e invalidación del alcance de OT mediante Functions. Los precios y snapshots los obtiene exclusivamente el backend desde Inventario Core. Estado operacional y aprobación permanecen separados.

## Alcance

- Recepción registrada, al menos un diagnóstico completado y servicios definidos son requisitos de envío y decisión.
- El alcance comprende ServicioOT, ProductoOT y cantidades. No incluye precios manuales.
- No crea reservas, consumos, movimientos, Ventas, Pagos ni Trabajos de Proyectos.
- No modifica el arranque ni los datos persistentes de emuladores.
- La eliminación de ServicioOT se limita a servicios pendientes y sin movimientos de inventario; invalida la aprobación y conserva el evento de auditoría en la OT.

## Implementación

### Transiciones

| Acción / condición | Estado operacional resultante | Aprobación resultante |
|---|---|---|
| Enviar o reenviar, con stock suficiente | esperando_aprobacion | pendiente |
| Enviar o reenviar, con stock insuficiente | esperando_repuestos | pendiente |
| Revalidar esperando_repuestos pendiente, stock suficiente | esperando_aprobacion | pendiente |
| Revalidar esperando_repuestos pendiente, stock insuficiente | esperando_repuestos | pendiente |
| Aprobar desde esperando_aprobacion pendiente, stock suficiente | en_reparacion | aprobada |
| Aprobar desde esperando_aprobacion pendiente, stock insuficiente | esperando_repuestos | aprobada |
| Revalidar esperando_repuestos aprobada, stock suficiente | en_reparacion | aprobada |
| Revalidar esperando_repuestos aprobada, stock insuficiente | esperando_repuestos | aprobada |
| Rechazar desde esperando_aprobacion pendiente | esperando_aprobacion, sin avanzar a reparación | rechazada |
| Editar alcance enviado/aprobado | en_diagnostico con Plaza; en_cola sin Plaza | pendiente; exige nuevo envío |
| Editar planificación todavía no enviada | conserva estado operacional | pendiente |

No se habilitan acciones en ingresada, pendiente_entrega, cerrada o cancelada. No se cambia estado mediante dropdown. Un alcance aprobado no puede reenviarse sin modificarlo previamente. Cambiar solo responsable o guardar la misma cantidad no invalida la aprobación.

### Autoridad y transacciones

- Reutiliza `requireOperationalBusinessAccess` del Core; valida autenticación, usuario habilitado, negocio activo/verificado y membresía activa. La transacción relee negocio, membresía y, cuando existe, perfil con acceso a Taller.
- Capacidad local de aprobación separada de operación: `canApproveWorkOrder`. OWNER/ADMIN del negocio sin perfil restringido pueden aprobar/rechazar; TECNICO/MEMBER y perfiles que solo conceden módulos no heredan aprobación. No agrega permisos persistidos ni cambia la administración global de perfiles. Esta asignación conservadora debe revisarse si se solicita delegación granular.
- Cada acción transaccional relee OT, diagnósticos, servicios y referencias Core. Valida tipo, negocio y estado del ítem. Suma cantidades del mismo producto en todos los servicios antes de comprobar stock.
- Obtiene el precio de venta persistido `precioInterno`, ya formado por Inventario; no recalcula costos/márgenes ni acepta precios enviados por cliente. Congela `precioUnitario`, `servicioSnapshot` y `productoSnapshot` al enviar.
- Los snapshots contienen solo código, nombre, unidad y versión del modelo. Los DTO no exponen costos.
- La actualización de la OT serializa envío/decisión con cambios de alcance. Revisión optimista y huella de alcance impiden aplicar una decisión sobre una versión obsoleta.
- Acciones idempotentes por negocio y requestId; un reintento devuelve su resultado original sin volver a escribir historial. Reutilizar requestId con otros datos se rechaza.
- Cada envío y decisión conserva el alcance completo en un evento inmutable de `ordenesTrabajo/{otId}/historial`. El reenvío reemplaza el snapshot vigente, nunca eventos históricos.
- La lectura del alcance congelado no depende de que un ítem Core siga activo o mantenga nombre/precio. La disponibilidad vuelve a validarse al ejecutar acciones; no es una reserva.

### Colecciones técnicas internas

Bajo `negocios/{businessId}`:

- `otApprovalState/{otId}`: huella y referencia del último envío.
- `otApprovalRequests/{requestId}`: huella de solicitud y resultado idempotente.

El catch-all existente de Firestore deniega acceso SDK cliente a ambas. No se agregan campos de control técnicos a la entidad OT ni se abren reglas de escritura.

### Diferencias y decisiones respecto del punto de partida

1. Etapa 8 bloqueaba cambios de planificación después del envío. Se amplían únicamente los estados compatibles para permitir invalidar y reenviar; servicios ya iniciados/completados siguen sin edición ordinaria.
2. El RBAC existente distinguía operación y administración, no decisión de aprobación. Se agrega un chequeo específico local sobre membresía, sin alterar contratos globales de perfiles.
3. La SPEC exige pendiente y reenvío al invalidar, pero no fija el destino operacional exacto. Se utiliza el estado preparatorio existente según Plaza (en_cola/en_diagnostico), evitando mantener en_reparacion con aprobación pendiente. Es una decisión de integración explícita para revisión, no un estado nuevo.
4. La SPEC fija rechazada sin destino operacional alternativo. Se conserva esperando_aprobacion, mostrando la dimensión rechazada, sin autorizar reparación.
5. Cotizaciones/Ventas aceptan precios editables de líneas: ese contrato no se reutiliza en Taller. Se reutilizan las referencias, precio persistido y patrón de snapshot, no la autoridad de su payload.
6. Límite técnico: 200 líneas sumando servicios y productos por envío, para acotar la transacción/documentos de auditoría. Se rechaza explícitamente el exceso; no se trunca el alcance.
7. El historial completo aún no tiene UI de consulta en esta etapa. Los eventos y snapshots son persistidos en backend; la ficha muestra el alcance vigente.

### UI y patrones Core reutilizados

`ApprovalPanel` se integra en Resumen y Servicios y repuestos, sin pestaña nueva. Reutiliza `Button`, `ResponsiveDialog`, `erp-panel`, `erp-table-region`, `erp-table`, `erp-field`, mensajes y acciones existentes. Contempla carga, vacío, error, permisos, confirmación, progreso y conflicto concurrente. La planificación advierte que editar alcance enviado/aprobado requiere reenviar.

Precedentes revisados: ficha actual de OT, `ServicePlanningPanel`, `DiagnosisPanel`, `functions/quotePersistence.js`, `functions/salePersistence.js`, `functions/inventoryModel.js`, `functions/businessOnboarding.js`, `functions/rbac.js` y `src/domain/rbac.mjs`. Solo se extiende el registro de Functions compartido; no se modifica el contrato de estos módulos Core.

## Archivos principales

- `functions/workOrderPersistence.js`: transacciones, capacidad, snapshots, stock e invalidación.
- `functions/index.js`: cinco callables de aprobación/resumen.
- `src/services/workOrderService.js`: adaptadores cliente sin snapshots en payload.
- `src/features/workOrders/ApprovalPanel.jsx`: resumen y acciones explícitas.
- `src/features/workOrders/ServicePlanningPanel.jsx`: edición con invalidación y valores congelados/vigentes.
- `src/pages/WorkOrderDetailPage.jsx`: integración en ficha única.
- `scripts/work-order-approval-cases.mjs`: escenarios integrados de etapa 9.
- `scripts/work-orders-integrated-local.mjs`, `scripts/work-order-model-smoke.mjs`, `scripts/work-order-ui-smoke.mjs`: ejecución y regresiones.

## Verificaciones

Pruebas incorporadas: diagnóstico/Recepción obligatorios; rechazo de precio/snapshot cliente; referencias Core inválidas; membresías y perfiles; idempotencia; versiones obsoletas; congelación de precio/nombre; consulta tras archivado Core; cambio de responsable sin invalidación; invalidación por servicio/producto/cantidad; rechazo/reenvío; falta de stock antes/después de aprobar; agregación de cantidades; revalidación sin nueva aprobación; decisiones concurrentes; denegación SDK de registros internos; auditoría y stock intacto.

El resultado de las ejecuciones y la revisión visual se informa al finalizar la tarea. No asumir éxito solo por la existencia de los scripts.
