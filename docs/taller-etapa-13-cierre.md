# Taller · etapa 13: finalización y entrega

## Contrato

- `finalizarReparacionOT`: exige OT `en_reparacion`, aprobación vigente y al menos un ServicioOT; todos los servicios de la OT deben estar `completado`. Deja la OT en `pendiente_entrega`.
- `registrarEntregaOT`: exige OT `pendiente_entrega`. Deja la OT en `cerrada`, estado terminal.
- Ambas acciones validan en Functions el negocio verificado, la membresía activa y la capacidad operacional de Taller (`OWNER`, `ADMIN`, `TECNICO`, `MEMBER`, sujeta al perfil de módulos). El cliente no puede escribir el estado.
- Ninguna acción crea Venta, condiciona la entrega al pago ni modifica stock.

## Persistencia y auditoría

- OT: `negocios/{businessId}/ordenesTrabajo/{otId}`. Cambian `estado`, `actualizadoPorUid` y `actualizadoEn`; `estadoAprobacion` conserva su valor. Al registrar la entrega se libera la Plaza actual (`plazaId: null`) y su clave técnica de exclusividad; la Plaza liberada queda registrada en la auditoría del evento de entrega.
- Auditoría append-only: `.../ordenesTrabajo/{otId}/historial/{eventoId}` con tipos `reparacion_finalizada` y `vehiculo_entregado`, actor, fecha y estados anterior/nuevo.
- Idempotencia interna: `negocios/{businessId}/otClosureRequests/{requestId}`. Guarda huella de OT, acción, revisión y actor, más resultado y fecha. Firestore Rules niega acceso directo al SDK cliente mediante la regla final de denegación del negocio.
- La revisión `expectedActualizadoEn` y las lecturas transaccionales impiden aplicar una acción a una versión obsoleta. Reintentar con el mismo `requestId` y el mismo contenido devuelve el resultado guardado sin repetir el evento.
- `obtenerEventosCierreOT` expone únicamente fecha, tipo y nombre del actor de estos dos eventos para la ficha, después de validar acceso a la OT del mismo negocio.

## Verificación

`test:work-orders-integrated` cubre servicios pendientes/en progreso, estados incompatibles, permisos, negocio ajeno, concurrencia, reintentos, auditoría, cierre terminal, lectura restringida y ausencia de Venta o movimiento de Inventario por estas acciones.

La pestaña Historial muestra en esta etapa solo finalización y entrega. El historial completo de la OT corresponde a una etapa posterior.
