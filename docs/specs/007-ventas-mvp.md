# Ventas MVP

## Estado post-demo sobre margen comercial

**Implementado:** toda Venta confirmada congela el costo histórico disponible de
los productos en sus efectos de inventario, incluso cuando no está vinculada a
un Proyecto. Esa trazabilidad permite calcular margen comercial sin consultar
el costo vigente ni exigir un `trabajoId`. En el detalle, cancelar una venta
confirmada originada desde cotización está disponible en las acciones superiores;
el estado de stock usa un único mensaje y el descuento cero se presenta como
`$0`, nunca como un monto negativo.

**Confirmado pendiente:** Reportes debe mostrar el margen comercial de Ventas
separado del resultado/rentabilidad de Proyectos. La agregación, el tratamiento
de registros legacy sin costo congelado y la prevención de doble
contabilización cuando una Venta también pertenece a un Proyecto deben diseñarse
y probarse antes de exponer la métrica. Nunca se calculará como ventas menos
compras.

## Objetivo y modelo

Ventas registra operaciones comerciales directas o derivadas de una cotización aceptada. El documento canónico vive en `negocios/{businessId}/ventas/{ventaId}` y usa un único identificador `ventaId`. Guarda número, estado, cliente y snapshot, origen opcional, líneas y snapshots, totales, documento, condiciones, observaciones, aplicación de stock, autoría y timestamps.

Los estados son `borrador`, `confirmada` y `cancelada`. Sólo el borrador directo se edita. Las ventas nuevas originadas desde cotización nacen `confirmada`; confirmada y cancelada son históricas, de sólo lectura y no se eliminan ni regresan a borrador. Los documentos antiguos se mantienen legibles sin migración masiva.

## Numeración e idempotencia

Functions asigna `VTA-YYYY-NNNN` mediante `saleCounters/{year}` dentro de la misma transacción que crea la venta. Los correlativos son independientes por negocio y año. `saleCreateRequests/{requestId}` hace idempotente la creación directa; solicitudes concurrentes distintas obtienen números distintos. Para cotizaciones, el vínculo y el ID determinista `cotizacion__{cotizacionId}` garantizan una sola venta.

`saleConfirmRequests/{requestId}` protege la confirmación de ventas directas. La aceptación manual y pública converge en la misma operación transaccional de creación confirmada. `saleCancellationRequests/{requestId}` protege la cancelación y la reversa exacta; `quoteSaleConversionRequests/{requestId}` queda como compatibilidad para cotizaciones aceptadas históricas sin venta.

## Venta directa y autoridad

Una venta directa requiere cliente activo e ítems activos del inventario del negocio: productos, servicios o actividades. El frontend envía IDs y campos editables; Functions vuelve a leer los maestros y construye `clienteSnapshot` y los snapshots de línea. Número, estado, negocio, correlativo, snapshots, totales, stock, movimientos, autoría y timestamps nunca se aceptan desde el cliente.

El precio sugerido inicial usa el precio comercial efectivo ya expuesto como `precioInterno`. El usuario puede modificarlo en el borrador; confirmar no cambia precios ni costos del inventario. Las líneas admiten cantidad positiva, precio no negativo y descuento entre 0 y 100. La venta soporta además `descuento` general CLP, `descuentoItems`, `descuentoTotal`, `afectaIva` y `tasaIva`. Una venta directa usa por defecto descuento general cero y tratamiento afecto a IVA 19%. Functions recalcula todos los montos, rechaza descuentos generales negativos, no finitos o superiores al remanente, además de overflow y montos fuera del rango entero seguro. El máximo es 200 líneas.

El cálculo autoritativo es `subtotal - descuentoItems - descuento = neto`. Si `afectaIva` es verdadero, `iva = round(neto × 0.19)`; si es exenta, `tasaIva` e `iva` son cero. `total = neto + iva`.

Al confirmar una venta directa se revalidan cliente e ítems dentro de la transacción. Todos deben existir, pertenecer al negocio, mantener su tipo y seguir activos, incluidos servicios y actividades.

## Venta desde cotización

Aceptar una cotización emitida, tanto manualmente como desde la propuesta pública, crea dentro de la misma transacción una venta `confirmada`. Se conservan número y origen de aceptación, snapshot histórico de empresa y cliente, snapshots comerciales de líneas, cantidades, precios, descuentos, impuestos, moneda, condiciones y totales. La cotización permanece `aceptada` y recibe autoritativamente `ventaId`, `ventaNumero`, `ventaEstado` y la fecha del vínculo; la venta conserva `cotizacionId` y `cotizacionNumero`.

Una venta nueva originada desde cotización no vuelve a editar cliente, ítems, cantidades, precios ni descuentos y no ofrece una segunda acción de confirmación. La compatibilidad `crearVentaDesdeCotizacion` tampoco crea nuevos borradores: consolida directamente una venta confirmada.

El cliente histórico puede estar archivado. Servicios y actividades usan sólo su snapshot histórico y no alteran stock. Los productos se resuelven dentro del negocio y pueden estar inactivos si fueron archivados después de cotizar; no se reactivan automáticamente.

## Stock, atomicidad y movimientos

La aceptación ejecuta una sola transacción que lee cotización, correlativo y productos; crea la venta confirmada, descuenta hasta la disponibilidad sin producir stock negativo y crea movimientos inmutables. Servicios y actividades no tienen stock ni movimiento.

Cada salida genera un movimiento inmutable `salida_venta` con venta, cotización, producto, cantidad aplicada y solicitada, stock anterior/posterior, snapshot mínimo, origen y timestamp. En el mismo instante congela el costo unitario autoritativo del producto, su fuente, moneda y costo total; la venta replica ese snapshot mínimo en `efectosInventario` para revertir exactamente la salida y valorizar un Proyecto vinculado sin consultar el costo vigente. Un registro legacy sin costo histórico se identifica como no disponible y nunca se completa con el costo actual. Si falta stock, la aceptación no se deshace: se aplica lo disponible, el stock queda como mínimo en cero y la venta registra `parcial_pendiente` o `pendiente_abastecimiento` con faltantes explícitos.

Cancelar exige motivo y registra usuario, fecha, evento e idempotencia. La venta queda `cancelada`, la cotización sigue históricamente `aceptada` y cada efecto aplicado se compensa una sola vez con `entrada_cancelacion_venta`; no se infiere ni revierte stock ajeno.

## Roles, multiempresa y Rules

`OWNER`, `ADMIN` y los roles comerciales autorizados aceptan, crean, editan o cancelan mediante Callables según RBAC; `MEMBER` sólo lee. Todas las operaciones validan una membresía activa y empresa verificada; `negocioActivoId` no autoriza. Cliente, ítems, cotización y venta se resuelven dentro del negocio autorizado.

Firestore permite a miembros activos leer ventas de su negocio y deniega toda escritura SDK. `saleCounters`, `saleCreateRequests`, `saleConfirmRequests`, `saleCancellationRequests` y `quoteSaleConversionRequests` no permiten lectura ni escritura cliente. Los movimientos conservan su política inmutable y el catch-all sigue cerrado.

## Interfaz e impresión

Rutas:

- `/ventas`: historial con búsqueda, filtros y acciones;
- `/ventas/nueva`: venta directa;
- `/ventas/{ventaId}/editar`: borrador editable;
- `/ventas/{ventaId}`: detalle histórico.

Cotizaciones emitidas ofrecen `Aceptar cotización` y un diálogo `Registrar aceptación`; al terminar muestran el estado aceptado y el vínculo `Ver venta`, sin paso intermedio. El historial de Ventas muestra número, cliente, total, origen, estado, stock y fecha. El detalle de una venta desde cotización es de lectura, muestra aceptación, ítems, condiciones, totales y abastecimiento, y permite cancelar con motivo a quien tenga permiso.

Si se pierde la respuesta de aceptación, el mismo request idempotente o una nueva lectura de la cotización reutilizan la venta ya vinculada. Reintentar la cancelación reutiliza su request o detecta el estado cancelado sin crear otra devolución.

## Fuera de alcance

No incluye facturación electrónica, SII, pagos, cuentas por cobrar, finanzas automáticas, devoluciones comerciales, notas de crédito, consumo por proyecto, actualización de costos, ventas masivas ni IA.

Un PDF o documento comercial generado por ValoraCloud no debe denominarse
“factura electrónica” mientras no exista una integración tributaria oficial.

## Pruebas y aceptación

`sale-model-smoke.mjs` cubre cálculos, adaptación, estados históricos, historial, stock y defensas declaradas. `sales-integrated-local.mjs` cubre venta directa existente y, para cotizaciones, aceptación manual automática, venta confirmada única, snapshots, reintentos, producto suficiente, servicio sin stock, faltantes sin rollback comercial, cancelación con motivo, reversa única, historial, RBAC, verificación y Rules. `quote-public-proposal-smoke.mjs` cubre la misma consecuencia autoritativa desde aceptación pública.

La aceptación exige los smokes e integrados específicos de Cotizaciones y Ventas, BRUNO-01, build, lint y `git diff --check`.
