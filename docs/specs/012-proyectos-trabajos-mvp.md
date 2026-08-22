# Proyectos y trabajos MVP

## Objetivo

Registrar, asignar y seguir trabajos operativos genéricos por empresa, conservando una trazabilidad legible de cambios, tareas, costos, balance y notas. El módulo no administra todavía facturación ni pagos.

## Modelo

El documento principal vive en:

```text
negocios/{businessId}/trabajos/{trabajoId}
```

Mantiene `modeloTrabajoVersion`, `trabajoId`, `negocioId`, correlativo `TRB-AAAA-NNNN`, título, descripción, cliente y snapshot opcionales, responsable y snapshot opcionales, participantes y snapshots, estado, prioridad, fechas, contadores de tareas y auditoría.

Estados canónicos: `pendiente`, `en_progreso`, `en_espera`, `completado` y `cancelado`. Prioridades: `baja`, `normal`, `alta` y `urgente`.

Las tareas, notas e historial se separan para evitar crecimiento ilimitado del documento:

```text
negocios/{businessId}/trabajos/{trabajoId}/tareas/{tareaId}
negocios/{businessId}/trabajos/{trabajoId}/notas/{notaId}
negocios/{businessId}/trabajos/{trabajoId}/historial/{eventoId}
negocios/{businessId}/trabajos/{trabajoId}/vinculos/{tipo}__{documentoId}
```

## Expediente comercial V2 / fase 1

Una Cotización creada desde un Proyecto conserva `trabajoId`, `trabajoNumero` y `trabajoTitulo` resueltos por Functions. Al convertir una Cotización aceptada, la Venta hereda los mismos campos después de revalidar que el TRB pertenece al negocio. El cliente sólo propone `trabajoId`; números y títulos son snapshots autoritativos.

`vinculos` es un índice append-only con una referencia y snapshot mínimo al momento de vincular (tipo, ID, número, estado y total), nunca una copia completa del documento comercial. El estado vigente se consulta desde la COT/VEN canónica. El historial agrega eventos inmutables `cotizacion_vinculada`, `cotizacion_respuesta` y `venta_vinculada`; rechazar una propuesta no borra su vínculo y otra COT puede agregarse al mismo TRB.

El documento raíz declara `modeloExpedienteVersion`, `cotizacionesVinculadas` y `ventasVinculadas`. Registros legacy sin estos campos ni subcolección continúan válidos con contadores cero. Esta separación deja espacio para futuras categorías de vínculo sin implementar aún gastos, horas hombre, materiales ni balance.

## Tareas operativas V2 / fase 2

Las tareas nuevas usan `modeloTareaVersion: 2`, título, descripción, `responsableUid` y snapshot autoritativo, estado `pendiente`/`completada`, autoría, fechas y responsable del cierre. `completada` se conserva como campo compatible. Una tarea legacy sin versión se adapta como versión 1 y OWNER/ADMIN puede completarla o reabrirla sin migración previa.

La documentación es append-only en `tareas/{tareaId}/documentacion/{documentacionId}`. Cada alta, asignación/reasignación, documentación, completado y reapertura agrega además un evento al historial del TRB. `workTaskRequests/{requestId}` es interno y hace idempotentes las operaciones que producen eventos. Las tareas V2 no se eliminan físicamente; sólo el checklist legacy incompleto conserva la eliminación compatible.

OWNER/ADMIN crea, asigna, reasigna, completa y reabre. Mientras no exista RBAC técnico granular, `MEMBER` representa al técnico operativo: Functions sólo le permite documentar o completar una tarea cuyo `responsableUid` coincide con su UID y cuya membresía sigue activa. La ficha compartida conserva la lectura empresarial actual para no romper legacy; una política futura podrá restringir visibilidad por asignación sin cambiar este contrato persistido.

## Costos reales / fase 3

Los gastos viven en `trabajos/{trabajoId}/gastos/{gastoId}` y las horas valorizadas en `trabajos/{trabajoId}/horasHombre/{horasHombreId}`. Cada registro es inmutable salvo la transición autoritativa `vigente → anulado`; una corrección se expresa anulando el original y creando el reemplazo. Ambos documentos y sus eventos permanecen en el expediente.

Los gastos usan categorías `MATERIAL`, `MANO_DE_OBRA`, `OPERATIVO`, `SERVICIO_EXTERNO`, `ADMINISTRATIVO` y `OTRO`. `ADMINISTRATIVO` se clasifica como `INDIRECTO`; las demás son `DIRECTO`. HH conserva técnico, horas, costo unitario y `total` calculado por Functions con precisión de dos decimales. El frontend nunca decide el total.

La primera operación financiera fija `moneda` en el TRB desde la moneda autoritativa del negocio; operaciones posteriores reutilizan ese snapshot y no existe conversión FX. OWNER/ADMIN registra y anula. En la transición RBAC actual, MEMBER puede registrar gastos y HH sólo asociados a su propio UID; no puede anular. Toda persona asociada se revalida como miembro activo.

`workCostRequests/{requestId}` es interno e idempotente. El historial agrega `gasto_registrado`, `gasto_anulado`, `horas_hombre_registradas` y `horas_hombre_anuladas`. TRB legacy sin moneda, gastos, HH o contadores se adapta con totales cero sin migración.

## Materiales / fase 4

Las salidas y devoluciones del TRB reutilizan el libro empresarial `movimientosInventario`. `SALIDA_PROYECTO` descuenta stock y `DEVOLUCION_PROYECTO` lo restituye; ambos movimientos son inmutables, conservan `trabajoId`, `itemId`, cantidad, costo unitario y total, moneda, stock anterior/posterior, actor, fecha y snapshot mínimo del producto. La devolución referencia siempre su `movimientoOrigenId`.

Functions ejecuta movimiento y stock en una misma transacción. Sólo admite `tipoItem: producto`, valida stock y congela primero `costoPromedio` cuando existe; en su ausencia usa `costoBase` y fallbacks de costo legacy. La devolución usa exclusivamente el costo congelado de la salida, aunque el costo vigente cambie después.

`workMaterialRequests/{requestId}` hace idempotentes las operaciones. `workMaterialBalances/{movimientoOrigenId}` es un control interno mutable para impedir sobre-devoluciones concurrentes sin reescribir el movimiento original. Rules niega todo acceso SDK a ambos; el libro de movimientos sólo admite lectura empresarial y ninguna escritura directa. MEMBER activo puede registrar consumos propios en la transición RBAC actual; sólo OWNER/ADMIN devuelve y gestiona. TRB legacy adapta contadores y costo de materiales a cero.

## Balance y rentabilidad / fase 5

`obtenerBalanceTrabajo` recalcula bajo demanda y no persiste el margen. Sólo OWNER/ADMIN puede invocarla. La fuente de ingreso son exclusivamente Ventas canónicas `confirmada` vinculadas por `trabajoId`; las COT, incluidas las rechazadas, nunca constituyen ingreso. Sin Venta confirmada el balance queda `PARCIAL_SIN_VENTA`: los costos se muestran, pero valor comercial, resultado y rentabilidad permanecen `null`.

La fórmula coherente es `costoTotal = materiales netos + HH vigentes + gastos directos vigentes + gastos indirectos vigentes`, `resultado = valorComercial - costoTotal` y `rentabilidadPct = resultado / valorComercial × 100`. Cuando existe al menos una salida de Inventario, ese libro es la autoridad de materiales y los gastos vigentes con categoría `MATERIAL` quedan informados pero excluidos del costo para evitar doble imputación. Sin libro de materiales se conservan como costo directo legacy.

La moneda base es el snapshot del TRB o, para legacy, la moneda del negocio. Una moneda incluida distinta produce `INCONSISTENTE_MONEDA`: todos los agregados quedan `null` y sólo se entrega desglose separado por moneda, sin FX. MEMBER no recibe la respuesta de balance ni ve su componente en la ficha.

El historial mantiene referencias mínimas append-only y ahora expresa montos/origen en gastos, HH, materiales, devoluciones y Ventas. La confirmación de una Venta vinculada agrega `venta_confirmada`; creación, cambios, tareas/documentación, COT/respuestas y cierre conservan sus eventos existentes.

El contador anual y la idempotencia de creación son internos:

```text
negocios/{businessId}/workCounters/{year}
negocios/{businessId}/workCreateRequests/{requestId}
```

## Autoridad y permisos

Todos los miembros activos pueden leer trabajos y sus subcolecciones. Sólo `OWNER` y `ADMIN` pueden mutar mediante Cloud Functions. Rules bloquea toda escritura directa, incluidos historial, notas y tareas. Cada Callable valida autenticación, negocio activo, membresía y aislamiento multiempresa.

Los clientes se resuelven dentro del negocio y Functions construye el snapshot histórico. Responsables y participantes deben poseer membresía activa; sus nombres se resuelven desde perfil/Auth sin confiar en etiquetas enviadas por el cliente. No se crea RBAC adicional.

## Operaciones

- Crear y editar un trabajo.
- Cambiar estado explícitamente, completando o limpiando `fechaCompletado` según corresponda.
- Agregar, completar, reabrir y eliminar tareas incompletas mientras el trabajo no sea terminal.
- Agregar notas sin editar ni eliminar las existentes.
- Cancelar conservando documento y trazabilidad.

El historial registra creación, cambios de estado y responsable, participantes agregados o retirados, tareas, notas, completado, cancelación y reapertura. Cada evento conserva fecha de servidor, UID del actor y snapshot legible. La UI nunca presenta el UID crudo.

## Interfaz

La ruta `/trabajos` ofrece búsqueda y filtros, lista responsive y tablero sin drag-and-drop. El formulario inicial contiene información y planificación. Tras crear se abre una ficha con resumen, descripción, checklist, notas e historial cronológico. Cancelar exige confirmación con `ResponsiveDialog`.

## Límites

- Sin facturación, pagos ni conversión FX.
- Sin archivos adjuntos, comentarios anidados, subtareas o dependencias.
- Sin drag-and-drop.
