# Proyectos y trabajos MVP

## Objetivo

Registrar, asignar y seguir trabajos operativos genéricos por empresa, conservando una trazabilidad legible de cambios, tareas y notas. El módulo no administra materiales, costos, rentabilidad, facturación, pagos ni horas valorizadas.

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
```

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

- Sin materiales ni integración con inventario.
- Sin costos, rentabilidad, horas valorizadas, facturación o pagos.
- Sin archivos adjuntos, comentarios anidados, subtareas o dependencias.
- Sin drag-and-drop.
