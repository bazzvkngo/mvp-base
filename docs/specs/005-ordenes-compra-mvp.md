# Órdenes de Compra MVP

En una OC nueva o pendiente, “Escanear producto” resuelve por consulta exacta el `barcode` de un producto activo del negocio; un UPC-A de 12 dígitos y el mismo código como EAN-13 con 0 inicial se buscan como equivalentes (ver `003-inventario-mvp.md`). Agrega la línea con costo y unidad del inventario o incrementa su cantidad sin reemplazar costo ni descuento editados; un código inexistente no crea productos. El escaneo es continuo, con el mismo comportamiento que en Cotizaciones (ver `002-clientes-cotizaciones.md`).

> Actualización: la OC representa lo solicitado y no modifica stock. La respuesta del proveedor es una dimensión separada y una OC emitida origina Recepciones, no Compras directas. Ver `011-recepciones-mvp.md`.

## Enmienda 2026-11-06: eliminación permanente de órdenes de compra

> **Estado: implementada, pendiente de desplegar.** Hasta que la Function
> `eliminarOrdenCompra` y el frontend se desplieguen (primero la Function), la
> eliminación física de órdenes sigue sin estar disponible en el producto.

Motivo: poder quitar órdenes de compra creadas por error o canceladas que
nunca se enviaron al proveedor, sin dejar basura en el historial. Cancelar sigue
disponible y es la vía para órdenes con historia. Esta enmienda reemplaza
únicamente los puntos que se indican; el resto de la SPEC y sus invariantes
siguen vigentes (AGENTS.md y SPEC 016: no se eliminan físicamente registros
referenciados ni se reescribe historia).

- **Reemplaza** tres frases que prohibían la eliminación física: «No existe
  eliminación física ni escritura directa desde el SDK cliente» (sección Estados
  y permisos), «eliminación física» en la lista de límites explícitos y «No existe
  eliminación física ni acceso cliente a contadores o solicitudes» en los
  criterios de aceptación. Ahora existe una única vía de eliminación física, la
  Function `eliminarOrdenCompra` (nombre propuesto), y solo en el alcance de
  esta enmienda. La escritura directa desde el SDK cliente sigue prohibida.
- **Alcance (B)**: se puede eliminar una orden en `borrador`, o en `cancelada`
  que **nunca se emitió**. Una orden emitida alguna vez no se elimina, aunque
  después se haya cancelado.
- **Cómo se prueba que nunca se emitió.** Una orden cancelada no guarda su
  estado anterior (solo `canceladaEn` y `canceladaPorUid`), así que la Function
  comprueba la ausencia de todo rastro de emisión: `estado` distinto de
  `emitida`; sin `emitidaEn`, `emitidaPorUid`, `canalEmision` ni
  `destinatarioEmision`; `cantidadEnvios` en cero y sin `ultimoEnvioEn` ni
  `reenviadaEn`; sin respuesta del proveedor registrada; y sin
  `enviadoPorCorreo` verdadero ni `estadoEnvioCorreo` en `enviado` o `enviando`.
  Un envío fallido o simulado (`estadoEnvioCorreo` en `error` o `simulado`) no
  entregó nada y no bloquea.
- **Roles**: eliminan permanentemente solo `OWNER` y `ADMIN`
  (`BUSINESS_MANAGEMENT_ROLES`), como en proveedores y cotizaciones. Crean,
  editan, emiten y cancelan `OWNER`, `ADMIN` y `COMPRAS`
  (`PURCHASE_WRITE_ROLES`); esto corrige la redacción original de la sección
  Estados y permisos, que mencionaba solo `OWNER` y `ADMIN` y estaba
  desactualizada. El rol se valida en el servidor; la interfaz solo oculta el
  botón.
- **`eliminarOrdenCompra`**: exige negocio verificado, membresía activa de
  `OWNER`/`ADMIN` y que el usuario escriba la palabra «permanente» (validada
  también en el backend). Una sola transacción lee la orden, su intento de
  correo y las dependencias, y si ninguna bloquea borra la orden y sus registros
  internos.
- **Dependencias que bloquean** (cualquier estado cuenta): `recepciones` con
  `ordenCompraId` (también en borrador o canceladas), `compras` con
  `ordenCompraId`, el campo `compraId` de la orden (y `comprasDesdeRecepciones`,
  `estadoRecepcion` y `recepcionResumen`, que delatan recepciones), y un intento
  de correo en `purchaseOrderEmailAttempts/{ordenCompraId}` con estado
  `enviando` o `enviado`. Como red de seguridad también bloquean
  `adquisicionesInventario` y `movimientosInventario` con `ordenCompraId`,
  `receptionCreateRequests` y `purchaseOrderConversionRequests` de esa orden, y
  otra orden creada a partir de esta (`purchaseOrderDuplicateRequests` con
  `ordenCompraOrigenId`). Si hay alguna, la Function responde
  `failed-precondition` con un mensaje claro y no borra nada.
- **Se borran junto con la orden**: sus solicitudes idempotentes
  (`purchaseOrderCreateRequests` y `purchaseOrderDuplicateRequests` cuyo
  `ordenCompraId` es la orden) y su intento de correo
  (`purchaseOrderEmailAttempts/{ordenCompraId}`). Sin esto, un reintento con el
  mismo `requestId` fallaría con «La solicitud idempotente está incompleta».
- **Numeración**: el contador `purchaseOrderCounters/{year}` no retrocede y el
  número eliminado no se reutiliza. Queda un hueco en la secuencia (por ejemplo
  `OC-2026-0002` y `OC-2026-0004`), igual que en cotizaciones. El diálogo de
  confirmación avisa de este hueco.
- **Carrera y envíos**: las Functions que crean recepciones, emiten o cancelan
  leen la orden dentro de su propia transacción, así que Firestore las serializa
  con el borrado y no puede quedar una recepción apuntando a una orden
  inexistente. El envío por correo ocurre fuera de la transacción: por eso un
  intento en `enviando` bloquea el borrado. Límite conocido: WhatsApp solo deja
  rastro cuando la persona confirma el envío; el sistema prueba que la orden
  «nunca se registró como enviada», no que «nunca salió del equipo».
- **Proveedores**: una orden eliminada deja de contar como dependencia en
  `eliminarProveedor` (SPEC 004, enmienda 2026-11-05); no hay cambios de código
  en esa Function.
- **Interfaz**: opción «Eliminar» en el borrador (junto a «Cancelar», con
  distinción clara: cancelar conserva la orden, eliminar la quita para siempre),
  en el menú «Más» del detalle de una orden cancelada elegible y como acción en
  la lista; visible solo para `OWNER` y `ADMIN`. Diálogo que pide escribir
  «permanente» y advierte que la acción no se puede deshacer, que el número no se
  vuelve a usar (queda un hueco en la numeración) y que solo se eliminan órdenes
  nunca enviadas y sin recepciones ni compras. Un ayudante del cliente solo
  oculta el botón; decide la Function.
- **Pruebas previstas**: aserciones estáticas en `purchase-orders-model-smoke.mjs`
  (export de la Function, roles, palabra de confirmación, dependencias, Rules sin
  cambios) y una prueba integrada con emulador (borrado y hueco en la
  numeración, roles y negocio ajeno rechazados, cada bloqueo, envío fallido o
  simulado que no bloquea, idempotencia, carrera con crear recepción y
  multiempresa).
- **Verificación previa a producción**: antes de ofrecer el borrado de órdenes
  canceladas, confirmar con una consulta de solo lectura que no existan órdenes
  canceladas que sí se emitieron pero carezcan de `emitidaEn` (datos anteriores
  al modelo vigente). Si no se puede verificar, se habilita primero solo el
  borrador.
- **Decisión sobre el rol `COMPRAS`**: Decidido por el desarrollador el
  2026-11-06: `COMPRAS` crea, edita, emite y cancela, pero no elimina; eliminar
  queda solo para `OWNER` y `ADMIN`. Revisable por Bruno: si decide incluir
  `COMPRAS`, se enmienda este punto y se ajusta la lista de roles en
  `functions/purchaseOrderDeletion.js` y en `purchaseOrderModel.mjs`.
- No cambian las Rules (`delete` directo sigue denegado en `ordenesCompra` y en
  sus colecciones internas) ni los índices (consultas de igualdad sobre un
  campo). Se despliega primero la Function y después el frontend.

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

Solo `borrador` se edita. Una orden puede pasar de `borrador` a `emitida`, y de `borrador` o `emitida` a `cancelada`. Emitir o cancelar nuevamente el mismo estado es idempotente. La eliminación física solo existe como `eliminarOrdenCompra`, para órdenes nunca emitidas y sin recepciones ni compras (enmienda 2026-11-06); no existe escritura directa desde el SDK cliente.

## Interfaz

La navegación incluye Compras con:

- `/ordenes-compra` para historial y filtros;
- `/ordenes-compra/nueva` para crear;
- `/ordenes-compra/{ordenCompraId}/editar` para editar borradores;
- `/ordenes-compra/{ordenCompraId}` para consulta.

El workspace presenta encabezado, selector de proveedor registrado, catálogo de inventario activo, editor de líneas, resumen sticky y secciones de entrega, condiciones, observaciones y vista previa. La vista imprimible muestra empresa compradora, proveedor, fechas, ítems y totales. El envío por correo adjunta el PDF y sólo registra la emisión cuando el proveedor backend confirma el envío; WhatsApp requiere confirmación humana posterior a abrir el canal. Reenviar reutiliza la misma OC y conserva trazabilidad.

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
- eliminación física, salvo la vía única `eliminarOrdenCompra` (enmienda 2026-11-06);
- ingestión automática de respuestas del proveedor; su respuesta se registra
  manualmente por el flujo autoritativo vigente;
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
- No existe escritura ni eliminación directa desde el cliente ni acceso cliente a contadores o solicitudes; la única eliminación física es `eliminarOrdenCompra` (enmienda 2026-11-06).
- Historial, filtros, estado vacío, workspace y vista imprimible están disponibles.
- Los smokes relacionados, Rules, build y lint terminan sin regresiones.
