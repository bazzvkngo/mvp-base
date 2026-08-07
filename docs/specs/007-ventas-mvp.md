# Ventas MVP

## Objetivo y modelo

Ventas registra operaciones comerciales directas o derivadas de una cotización aceptada. El documento canónico vive en `negocios/{businessId}/ventas/{ventaId}` y usa un único identificador `ventaId`. Guarda número, estado, cliente y snapshot, origen opcional, líneas y snapshots, totales, documento, condiciones, observaciones, aplicación de stock, autoría y timestamps.

Los estados son `borrador`, `confirmada` y `cancelada`. Sólo el borrador se edita y cancela. Confirmada y cancelada son históricas, de sólo lectura y no se eliminan ni regresan a borrador. Guardar, editar o cancelar un borrador no modifica inventario.

## Numeración e idempotencia

Functions asigna `VTA-YYYY-NNNN` mediante `saleCounters/{year}` dentro de la misma transacción que crea la venta. Los correlativos son independientes por negocio y año. `saleCreateRequests/{requestId}` hace idempotente la creación; solicitudes concurrentes distintas obtienen números distintos.

`saleConfirmRequests/{requestId}` protege la confirmación. Además, `estado` y `stockAplicado` impiden un segundo descuento con otro request. `quoteSaleConversionRequests/{requestId}` protege la conversión y el vínculo `ventaId` en la cotización impide más de una venta por cotización.

## Venta directa y autoridad

Una venta directa requiere cliente activo e ítems activos del inventario del negocio: productos, servicios o actividades. El frontend envía IDs y campos editables; Functions vuelve a leer los maestros y construye `clienteSnapshot` y los snapshots de línea. Número, estado, negocio, correlativo, snapshots, totales, stock, movimientos, autoría y timestamps nunca se aceptan desde el cliente.

El precio sugerido inicial usa el precio comercial efectivo ya expuesto como `precioInterno`. El usuario puede modificarlo en el borrador; confirmar no cambia precios ni costos del inventario. Las líneas admiten cantidad positiva, precio no negativo y descuento entre 0 y 100. La venta soporta además `descuento` general CLP, `descuentoItems`, `descuentoTotal`, `afectaIva` y `tasaIva`. Una venta directa usa por defecto descuento general cero y tratamiento afecto a IVA 19%. Functions recalcula todos los montos, rechaza descuentos generales negativos, no finitos o superiores al remanente, además de overflow y montos fuera del rango entero seguro. El máximo es 200 líneas.

El cálculo autoritativo es `subtotal - descuentoItems - descuento = neto`. Si `afectaIva` es verdadero, `iva = round(neto × 0.19)`; si es exenta, `tasaIva` e `iva` son cero. `total = neto + iva`.

Al confirmar una venta directa se revalidan cliente e ítems dentro de la transacción. Todos deben existir, pertenecer al negocio, mantener su tipo y seguir activos, incluidos servicios y actividades.

## Venta desde cotización

Sólo una cotización en estado real `aceptada` puede convertirse. Se conservan su número, snapshot histórico de cliente, snapshots comerciales de líneas, descuento general y tratamiento tributario; no se refrescan desde maestros vivos ni se aceptan esos valores desde el frontend durante la conversión. Antes de cualquier edición, `subtotal`, descuentos, `neto`, `iva` y `total` de la venta son idénticos a los del documento aceptado, tanto en cotizaciones afectas como exentas. La cotización permanece histórica y recibe autoritativamente `ventaId`, `ventaNumero` y la fecha del vínculo.

En el borrador originado desde cotización quedan bloqueados cliente, cantidad de líneas, `lineaId` e `itemId`. Cantidad, precio, descuento, documento, condiciones y observaciones siguen editables. La cantidad puede reducirse, pero no superar la cantidad cotizada.

Al confirmar, el cliente histórico puede estar archivado. Servicios y actividades usan sólo su snapshot histórico. Cada producto debe seguir existiendo en el negocio, conservar el tipo producto y tener stock suficiente; puede estar inactivo si fue archivado después de la cotización. No se reactiva automáticamente.

## Stock, atomicidad y movimientos

Confirmar ejecuta una sola transacción que lee la venta y todos los productos, comprueba stock, descuenta todas las cantidades, crea movimientos y marca la venta confirmada. Servicios y actividades no tienen stock ni movimiento. Si cualquier producto falla, la venta permanece en borrador y ningún stock ni movimiento cambia.

Cada producto genera un movimiento inmutable en `movimientosInventario` con tipo `salida_venta`, venta, producto, cantidad, stock anterior/posterior, snapshot mínimo, autoría y timestamp. Stock insuficiente se informa con el nombre del producto y su disponibilidad. Las lecturas y escrituras transaccionales garantizan que dos ventas concurrentes no produzcan stock negativo; si ambas requieren más que el disponible, sólo una confirma.

No existe reversa automática. Una devolución futura deberá crear movimientos compensatorios explícitos.

## Roles, multiempresa y Rules

`OWNER` y `ADMIN` crean, editan, confirman, cancelan y convierten mediante Callables. `MEMBER` sólo lee. Todas las operaciones validan una membresía activa; `negocioActivoId` no autoriza. Cliente, ítems, cotización y venta se resuelven dentro del negocio autorizado.

Firestore permite a miembros activos leer ventas de su negocio y deniega toda escritura SDK. `saleCounters`, `saleCreateRequests`, `saleConfirmRequests` y `quoteSaleConversionRequests` no permiten lectura ni escritura cliente. Los movimientos conservan su política inmutable y el catch-all sigue cerrado.

## Interfaz e impresión

Rutas:

- `/ventas`: historial con búsqueda, filtros y acciones;
- `/ventas/nueva`: venta directa;
- `/ventas/{ventaId}/editar`: borrador editable;
- `/ventas/{ventaId}`: detalle histórico.

Cotizaciones aceptadas ofrecen `Registrar venta` y, una vez vinculadas, `Ver venta`. El formulario muestra cliente, editor compacto, stock disponible para productos, advertencia local, resumen separado de descuentos de ítems y descuento general, tratamiento afecto/exento, subtotal/neto/IVA/total, documento, condiciones, observaciones e impresión. El historial mantiene tabla desktop y tarjetas móviles sin scroll horizontal.

Si la respuesta de confirmación se pierde, el workspace consulta nuevamente la venta. Un estado autoritativo `confirmada` o `stockAplicado: true` se trata como éxito; si continúa en borrador, se conserva el mismo request idempotente para reintentar sin volver a guardar ciegamente sobre una venta potencialmente confirmada.

## Fuera de alcance

No incluye facturación electrónica, SII, pagos, cuentas por cobrar, finanzas automáticas, devoluciones, notas de crédito, reversas, actualización de costos, ventas masivas ni IA.

## Pruebas y aceptación

`sale-model-smoke.mjs` cubre cálculos afectos y exentos, descuentos por línea y general, payload mínimo, estados, roles, búsqueda, 200/201 líneas, valores inválidos y overflow. `sales-integrated-local.mjs` cubre OWNER/ADMIN/MEMBER, multiempresa, numeración, idempotencia, snapshots, borradores sin stock, revalidación directa, productos/servicios/actividades, stock insuficiente, rollback, concurrencia, movimientos, rechazo de descuento excesivo, conversión afecta/exenta con igualdad de totales, conversión elegible/no elegible, conversión única, snapshots históricos, bloqueo de referencias y Rules.

La aceptación exige además regresiones de Compras, Órdenes de Compra, Inventario, Clientes, Cotizaciones y Proveedores; Rules, build, lint y revisión visual manual. `000-mvp-profesor.md` permanece pendiente hasta que esa revisión manual sea aprobada.
