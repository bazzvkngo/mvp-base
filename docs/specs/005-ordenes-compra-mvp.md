# Órdenes de Compra MVP

En una OC nueva o pendiente, “Escanear producto” resuelve por consulta exacta el `barcode` de un producto activo del negocio. Agrega la línea con costo y unidad del inventario o incrementa su cantidad sin reemplazar costo ni descuento editados; un código inexistente no crea productos.

> Actualización: la OC representa lo solicitado y no modifica stock. La respuesta del proveedor es una dimensión separada y una OC emitida origina Recepciones, no Compras directas. Ver `011-recepciones-mvp.md`.

## Objetivo

Registrar órdenes de compra vinculadas a proveedores e inventario del negocio, con numeración transaccional, snapshots históricos autoritativos, cálculo de IVA y estados de ciclo de vida. Este módulo no recibe mercadería, no mueve stock y no genera cuentas por pagar.

## Modelo Firestore

Colección operacional:

```text
negocios/{businessId}/ordenesCompra/{ordenCompraId}
```

`ordenCompraId` es el identificador canónico. No se persiste `purchaseOrderId`.

Cada documento guarda:

- `numero` con formato `OC-YYYY-NNNN`, `anio` y `correlativo`;
- `estado`: `borrador`, `emitida` o `cancelada`;
- `proveedorId` y `proveedorSnapshot`;
- `items` con `lineaId`, `itemId`, snapshot de inventario, cantidad, costo editable, descuento y totales de línea;
- `subtotal`, `descuentoTotal`, `neto`, `iva` y `total`;
- moneda `CLP` y tasa IVA `0.19`;
- fecha de emisión y entrega estimada;
- dirección de entrega, condiciones y observaciones;
- autoría y timestamps canónicos.

La numeración usa el contador interno por negocio y año:

```text
negocios/{businessId}/purchaseOrderCounters/{year}
```

La idempotencia de creación usa:

```text
negocios/{businessId}/purchaseOrderCreateRequests/{requestId}
```

La idempotencia de duplicación usa:

```text
negocios/{businessId}/purchaseOrderDuplicateRequests/{requestId}
```

Ambas colecciones internas están cerradas al SDK cliente. La misma solicitud con el mismo contenido devuelve el documento previo sin consumir otro número; reutilizarla con contenido diferente se rechaza.

## Autoridad y snapshots

El frontend envía solamente `proveedorId`, los IDs de inventario, cantidad, costo unitario, descuento y campos editables generales. Functions ignora snapshots, número, estado y totales enviados por el cliente.

Al crear, Functions lee el proveedor activo y cada ítem activo dentro de `negocios/{businessId}`. Desde esos documentos arma los snapshots históricos. El costo inicial sugerido en interfaz proviene de `costoBase`, pero `costoUnitario` es editable y se valida en backend.

Al editar un borrador:

- conservar el mismo `proveedorId` preserva exactamente el snapshot existente, incluso si el proveedor cambió o fue archivado;
- cambiar de proveedor exige que el nuevo esté activo y reconstruye el snapshot;
- conservar una línea con el mismo `lineaId` e `itemId` preserva su snapshot de inventario;
- agregar o cambiar un ítem exige que el documento actual esté activo y reconstruye su snapshot.

Los metadatos históricos no se actualizan desde cambios posteriores en Proveedores o Inventario. Los documentos legacy se adaptan solo en lectura.

## Duplicación de documentos históricos

Una orden `emitida` o `cancelada` puede reutilizarse sin editar ni reactivar el documento original:

```text
Documento histórico inmutable → Duplicar como borrador → Nuevo documento independiente
```

La Callable recibe exclusivamente `businessId`, `sourceId` y `requestId`. Functions valida autenticación, membresía `OWNER` o `ADMIN`, negocio y documento original. Luego vuelve a leer autoritativamente el proveedor y cada ítem desde el mismo negocio. El proveedor y los ítems deben continuar activos; ninguno se reactiva automáticamente. Los snapshots del nuevo documento se construyen con los maestros actuales, mientras cantidades, costos unitarios editables, descuentos, entrega, dirección, condiciones y observaciones se toman del original autorizado. Los totales siempre se recalculan.

La copia obtiene ID, número, creador, fecha y timestamps nuevos mediante el contador transaccional vigente, queda en estado `borrador` y guarda `ordenCompraOrigenId` y `ordenCompraOrigenNumero` como trazabilidad informativa construida por backend. El `requestId` hace que doble clic y reintentos devuelvan la misma copia sin consumir otro correlativo.

La operación no escribe la orden original, Inventario, stock, `costoBase`, Compras, movimientos financieros ni movimientos de inventario. `MEMBER` puede consultar el original, pero no ve la acción y el backend rechaza intentos directos.

## Cálculos

Por línea:

```text
subtotalLinea = round(cantidad × costoUnitario)
descuentoLinea = round(subtotalLinea × descuentoPct / 100)
totalLinea = subtotalLinea - descuentoLinea
```

Totales:

```text
subtotal = suma(subtotalLinea)
descuentoTotal = suma(descuentoLinea)
neto = subtotal - descuentoTotal
iva = round(neto × 0.19)
total = neto + iva
```

Cantidad debe ser finita y mayor que cero; costo finito y mayor o igual a cero; descuento finito entre 0 y 100. Functions siempre recalcula.

## Estados y permisos

Los miembros activos `OWNER`, `ADMIN` y `MEMBER` pueden leer órdenes del negocio. Solo `OWNER` y `ADMIN` pueden ejecutar:

- `crearOrdenCompra`;
- `actualizarOrdenCompraBorrador`;
- `emitirOrdenCompra`;
- `cancelarOrdenCompra`.

Solo `borrador` se edita. Una orden puede pasar de `borrador` a `emitida`, y de `borrador` o `emitida` a `cancelada`. Emitir o cancelar nuevamente el mismo estado es idempotente. No existe eliminación física ni escritura directa desde el SDK cliente.

## Interfaz

La navegación incluye Compras con:

- `/ordenes-compra` para historial y filtros;
- `/ordenes-compra/nueva` para crear;
- `/ordenes-compra/{ordenCompraId}/editar` para editar borradores;
- `/ordenes-compra/{ordenCompraId}` para consulta.

El workspace presenta encabezado, selector de proveedor registrado, catálogo de inventario activo, editor de líneas, resumen sticky y secciones de entrega, condiciones, observaciones y vista previa. La vista imprimible muestra empresa compradora, proveedor, fechas, ítems y totales. No se envían correos.

`MEMBER` puede consultar documentos e imprimirlos, pero no recibe acciones de escritura. Los estados emitido y cancelado son de solo lectura.

## Documento comercial V2

La vista previa, impresión y PDF comparten una jerarquía documental consistente
con Cotización V2, manteniendo el propósito propio de la OC: empresa compradora,
identidad y estado del documento, proveedor, entrega, condiciones, detalle de
ítems y totales. Código, unidad y descuento se muestran únicamente cuando aportan
información, y las acciones de correo, WhatsApp, descarga, impresión y edición
permanecen fuera de la hoja comercial.

El documento consume los snapshots históricos ya almacenados de empresa,
proveedor, ítems, costos, moneda, impuesto y condiciones. No consulta maestros
vivos para renderizar una OC emitida. El nombre y la tasa del impuesto se presentan
desde la localización persistida, sin asumir una tasa fija. Este rediseño no cambia
creación, estados, preview posterior a creación, Recepciones ni Compras automáticas.

## Límites explícitos

Este MVP no implementa:

- recepción total o parcial;
- compras, facturas o pagos;
- cuentas por pagar;
- movimientos o ajustes de inventario;
- cambios de stock o `costoBase`;
- vínculo automático con finanzas;
- eliminación física;
- correo de órdenes;
- inteligencia artificial.

## Pruebas

`purchase-orders-model-smoke.mjs` cubre cálculos, rangos, contrato de mutación, adaptación legacy, roles y desacoplamiento.

`purchase-orders-integrated-local.mjs` cubre roles, aislamiento, proveedor e inventario activos, snapshots autoritativos e históricos, manipulación, recalculo, edición, estados, idempotencia, numeración concurrente y reglas de acceso.

También cubre duplicación de órdenes emitidas y canceladas, original intacto, nuevo ID/número/borrador, reintento concurrente, trazabilidad, reconstrucción autoritativa de proveedor e ítems, preservación de costos editables, rechazo de `MEMBER`, aislamiento entre negocios, proveedor archivado y ausencia de efectos sobre Inventario, Compras y movimientos financieros.

La aceptación requiere además los smokes de Proveedores, Inventario, Cotizaciones, Rules, build, lint de Functions y revisión responsive manual.

## Criterios de aceptación

- OWNER y ADMIN crean, editan, emiten y cancelan exclusivamente mediante Functions.
- MEMBER consulta sin recibir controles de escritura.
- Numeración e idempotencia son transaccionales e independientes por negocio.
- Proveedor e ítems se validan dentro del negocio y sus snapshots no se refrescan solos.
- Los totales persistidos son los recalculados por backend.
- No se modifica inventario, stock ni costo base.
- No existe eliminación física ni acceso cliente a contadores o solicitudes.
- Historial, filtros, estado vacío, workspace y vista imprimible están disponibles.
- Los smokes relacionados, Rules, build y lint terminan sin regresiones.
