# Compras MVP

> Actualización BRUNO POST-DEMO B: las Compras directas nuevas usan
> `modeloCompraVersion: 3` y `stockGestionadoPor: compra_directa`. Crear, editar o
> importar una factura sólo prepara el borrador; confirmar incrementa de forma
> autoritativa y atómica el stock de productos. Servicios y actividades no
> modifican existencias.

> Las Compras V1 y V2 conservan sin migración su semántica histórica. La
> conversión legacy directa desde OC continúa creando V2. Las Compras nuevas
> producidas por una Recepción usan V3 con `stockGestionadoPor: recepcion` y no
> duplican la entrada física. Ver `011-recepciones-mvp.md`.
>
> Actualización BRUNO-05: la misma confirmación de Recepción crea la Compra
> correspondiente directamente en estado `confirmada`; ya no existe una segunda
> preparación o confirmación económica para este origen. Una recepción parcial
> produce sólo su Compra y varias recepciones de una OC producen Compras distintas.

## Objetivo

Registrar compras directas o derivadas de una recepción como documentos
económicos y conservar su evidencia histórica. En V3, `stockGestionadoPor`
distingue la Compra directa que aplica su propia entrada física de aquella cuyo
stock ya fue aplicado por Recepción. V1/V2 mantienen compatibilidad histórica.
Este módulo no implementa pagos, cuentas por pagar, contabilidad ni ajustes
manuales.

## Modelo Firestore

Colecciones operacionales:

```text
negocios/{businessId}/compras/{compraId}
negocios/{businessId}/movimientosInventario/{movimientoId}
negocios/{businessId}/adquisicionesInventario/{adquisicionId}
```

`compraId` y `movimientoId` son nombres canónicos. Cada compra guarda:

- `numero` con formato `COM-YYYY-NNNN`, `anio` y `correlativo`;
- `estado`: `borrador`, `confirmada`, `cancelada` o `revertida` cuando se aplica
  la reversión autoritativa;
- `proveedorId` y `proveedorSnapshot` histórico;
- origen opcional `recepcionId`/`recepcionNumero` y `ordenCompraId`/`ordenCompraNumero`;
- documento del proveedor, fechas, condiciones y observaciones;
- líneas con `lineaId`, `itemId`, snapshot autoritativo, cantidad, costo unitario editable, descuento y totales;
- `subtotal`, `descuentoTotal`, `neto`, `iva` y `total` en CLP;
- `stockAplicado`, autoría y timestamps canónicos.
- `modeloCompraVersion` y `stockGestionadoPor` para fijar la semántica física;
- `documentoOrigen` sanitizado cuando el borrador se preparó desde factura,
  sin Base64 ni archivo persistido.

Las colecciones internas son:

```text
negocios/{businessId}/purchaseCounters/{year}
negocios/{businessId}/purchaseCreateRequests/{requestId}
negocios/{businessId}/purchaseConfirmRequests/{requestId}
negocios/{businessId}/purchaseOrderConversionRequests/{requestId}
negocios/{businessId}/receptionPurchaseConversionRequests/{requestId}
```

Todas están cerradas al SDK cliente. La numeración es transaccional e independiente por negocio y año.

## Autoridad y snapshots

El frontend envía únicamente campos editables, IDs, cantidades, costos y descuentos. Functions valida una membresía activa `OWNER` o `ADMIN`, resuelve siempre el negocio autorizado y vuelve a leer proveedores e inventario dentro de ese negocio. Número, estado, snapshots, totales y aplicación de stock son autoritativos.

En una compra directa, proveedor e ítems nuevos deben estar activos. Conservar proveedor o línea durante la edición mantiene exactamente su snapshot existente; cambiar la referencia exige un maestro activo y crea un snapshot nuevo. Al confirmar se vuelven a leer el proveedor y todos los ítems únicos dentro de la misma transacción: deben seguir existiendo, pertenecer al negocio, conservar su tipo y continuar activos. Esto incluye productos, servicios y actividades; en V3 directa sólo los productos incrementan stock.

Una compra originada desde una Recepción usa exclusivamente el proveedor, los ítems y las cantidades efectivamente recibidas en ese documento. Conserva además la referencia a la OC. Una compra legacy originada directamente desde una OC usa los snapshots históricos ya autorizados de la orden emitida. Ninguna de las dos reconstruye esos datos desde maestros vivos. Mientras permanece en borrador, proveedor, cantidad de líneas, `lineaId`, `itemId` y snapshots quedan bloqueados; sólo pueden ajustarse cantidades, costos, descuentos y los campos editables de documento, condiciones y observaciones.

## Creación desde Recepción y compatibilidad desde OC

El flujo canónico crea una Compra V3 confirmada con
`stockGestionadoPor: recepcion` dentro de la transacción que confirma la
Recepción y aplica stock. Cada Recepción conserva su propio `compraId`, por lo
que repetir la operación con el mismo u otro `requestId` devuelve la misma
Compra. Recepciones parciales diferentes de una misma OC producen Compras
económicas diferentes; no existe una regla general `una OC = una Compra`.

## Reversión

`revertirCompra` exige un rol de escritura autorizado por el RBAC de Compras,
motivo y `requestId`. Una transacción marca la Compra y sus adquisiciones como
`revertida`, conserva sus documentos de origen y genera una única salida
compensatoria determinista por cada entrada física. El efecto económico actual
resta la cantidad y el costo pagado total original de la adquisición; no hace
replay ni reescribe snapshots históricos de Ventas o Proyectos.
`purchaseReversalRequests` y el estado final impiden dobles descuentos. La
Recepción permanece `confirmada` y evidencia el estado revertido de su Compra.
Se bloquea íntegramente por stock insuficiente, costo original no demostrable,
moneda incompatible, saldo negativo/inconsistente o valor residual con stock
cero. Si se revierte la última adquisición, el resumen vuelve a la anterior
vigente sólo cuando su cronología es demostrable; en caso contrario se limpia a
`null`. No existen reversiones parciales en V1.

La Callable legacy `crearCompraDesdeOrden` se conserva como compatibilidad controlada:

1. si la OC ya tiene `compraId`, devuelve la Compra histórica vinculada de forma idempotente;
2. si la OC ya posee cualquier Recepción, rechaza una nueva conversión legacy y exige preparar la Compra desde cada Recepción confirmada;
3. si todavía no existen Recepciones, puede crear la Compra legacy por la OC completa y registra `compraId` en la orden;
4. si luego se registran Recepciones para mover stock, esas Recepciones no pueden crear Compras adicionales porque el hecho económico ya fue representado por la Compra legacy.

Las validaciones se ejecutan dentro de transacciones. `purchaseOrderConversionRequests` y `receptionPurchaseConversionRequests` protegen reintentos, mientras `ordenCompra.compraId` y `recepcion.compraId` preservan la compatibilidad histórica y la idempotencia de cada origen.

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

Cantidad debe ser finita y mayor que cero; costo finito y no negativo; descuento finito entre 0 y 100. Los montos persistidos deben ser enteros seguros de JavaScript. Functions recalcula todo e ignora totales manipulados.

Una compra admite como máximo 200 líneas de documento. La confirmación y la
reversión calculan además, antes de aplicar efectos, un presupuesto atómico
compartido de 450 escrituras: cuentan movimientos, adquisiciones, productos
únicos y documentos fijos. Servicios y actividades no consumen presupuesto de
efectos físicos. Si las líneas físicas requieren más escrituras, la operación
completa falla con `failed-precondition`; no se divide en batches ni deja stock,
ledger o requests parciales.

## Confirmación y stock

Para una Compra V3 directa, confirmar ejecuta una sola transacción:

- comprueba borrador, proveedor activo e ítems activos del mismo negocio;
- rechaza un origen documental con líneas todavía sin resolver;
- incrementa únicamente productos y crea movimientos deterministas
  `entrada_compra` con `tipoOrigen: compra_directa`;
- aplica el mismo cálculo de adquisición que Recepción, suma el costo pagado al
  saldo perpetuo de valor, recalcula el promedio y crea
  `adquisicionesInventario/{compraId__lineaId}` con estado `vigente`;
- actualiza último costo, proveedor y última adquisición sin inventar OC o
  Recepción;
- confirma el documento y marca `stockAplicado: true` sólo cuando existen
  productos cuya entrada fue aplicada; una compra compuesta únicamente por
  servicios/actividades conserva `stockAplicado: false`;
- no actualiza `costoBase`, `costoPagado` comercial, margen ni precio de venta.

Una Compra V3 con `stockGestionadoPor: recepcion` no suma stock ni crea un
segundo movimiento: la Recepción ya registró `entrada_recepcion`, adquisición y
costos técnicos. V2 continúa siendo exclusivamente económica y V1 conserva su
ruta histórica `entrada_compra`.

La idempotencia tiene doble defensa: `purchaseConfirmRequests/{requestId}` protege reintentos de transporte y el propio estado `confirmada`/`stockAplicado` impide aplicar stock otra vez con un request diferente. Las transacciones de inventario preservan incrementos concurrentes.

Cada movimiento guarda negocio, producto, compra, número, cantidad, stock y
valor anterior/posterior, costo promedio, moneda, snapshot mínimo, autoría y
timestamp. No existe edición ni eliminación cliente de movimientos.

## Estados y permisos

- `OWNER` y `ADMIN`: crear, editar borradores, convertir OCs emitidas, confirmar y cancelar borradores mediante Callables.
- `MEMBER`: consultar historial, detalle y movimientos del negocio sin controles de escritura.
- Usuarios sin membresía activa: sin acceso.

Solo `borrador` es editable. `confirmada` y `cancelada` son finales y se muestran en modo lectura. No existe eliminación física.

## Interfaz

Rutas:

- `/compras`: historial, búsqueda y filtros por estado/origen;
- `/compras/nueva`: compra directa;
- `/compras/{compraId}/editar`: edición de borrador;
- `/compras/{compraId}`: detalle de solo lectura.

Órdenes emitidas ofrecen registrar Recepciones. Una Recepción nueva confirmada
ya queda vinculada a su Compra automática y ofrece `Ver compra`; `Registrar
compra` se conserva sólo para Recepciones históricas confirmadas sin Compra. El
workspace reutiliza la identidad visual de Órdenes de Compra, pero mantiene
componentes propios para líneas, resumen, catálogo, detalle y documento
imprimible. La vista móvil usa tarjetas y no depende de scroll horizontal.

Nueva compra ofrece `Importar factura`. El extractor documental existente
acepta exclusivamente PDF, JPG/JPEG, PNG o WebP y propone proveedor, folio,
fechas, líneas, cantidades, costos, descuentos y totales; el usuario debe
resolver proveedor e ítems existentes antes de aplicar la propuesta. Aplicar
deja un borrador y no confirma ni mueve stock. Excel/CSV permanece en la carga
maestra de Inventario. El acceso desde Inventario se muestra sólo con permiso de
escritura de Compras.

Antes de confirmar, V3 directa informa que incrementará el stock de productos.
Una Compra derivada de Recepción informa que el stock ya fue gestionado allí.
El detalle confirmado distingue `stockAplicado` de
`stockGestionadoPor: recepcion`.

## Límites explícitos

No se implementan:

- ventas;
- recepción directa sin OC como documento separado: esa adquisición se registra
  mediante Compra directa V3;
- pagos o cuentas por pagar;
- integración SII, contabilidad o finanzas;
- edición de movimientos; la reversión completa autoritativa ya implementada no
  habilita edición ni eliminación de movimientos;
- actualización de `costoBase`;
- ajustes manuales de inventario;
- creación automática de proveedores o productos desde IA/OCR; el extractor
  existente sólo propone datos sujetos a revisión humana.

## Pruebas

`purchase-model-smoke.mjs` cubre cálculos, overflow, payload mínimo, máximo de 200 líneas en frontend/backend, adaptación, búsqueda, roles y presencia de defensas backend/rules.

`purchases-integrated-local.mjs` cubre V3 directa sin stock al crear/editar,
entrada económica de productos al confirmar, adquisición y promedio, exclusión de servicios/actividades,
`stockAplicado: false` cuando no existen productos, reversión compensatoria,
movimientos, MEMBER, aislamiento, reintentos, concurrencia, rollback, documento
incompleto, costo base intacto, reversión segura de Q/V, snapshots de Venta,
moneda y compatibilidad V1/V2.

`purchase-document-import-smoke.mjs` cubre match fiscal/nombre de proveedor,
barcode/código interno/nombre de líneas, revisión manual, bloqueo de líneas sin
resolver, datos tributarios y separación entre aplicar y confirmar.

`receptions-integrated-local.mjs` cubre Recepciones parciales, una Compra V3
independiente e idempotente por Recepción, ausencia de doble stock y la exclusión
mutua con la conversión legacy por OC.

La aceptación requiere además regresiones de Órdenes de Compra, Inventario, Proveedores, Cotizaciones, Clientes y Rules; build, lint de Functions, revisión de diff y revisión visual manual. El módulo no se marca completado en `000-mvp-profesor.md` hasta que esa revisión visual sea aprobada.

## Criterios de aceptación

- La autoridad de negocio, roles, referencias, snapshots, cálculos y estados reside en Functions.
- Una Recepción confirmada produce como máximo una Compra y conserva su evidencia histórica.
- Varias Recepciones parciales de una OC pueden producir Compras distintas sin superponerse con una Compra legacy por la OC completa.
- Confirmar una Compra V3 directa incrementa productos una sola vez; una V3 de
  Recepción no duplica la entrada y V1/V2 preservan su semántica.
- La Compra directa mantiene Q/V, promedio, último costo y ledger con el mismo
  algoritmo económico que Recepción.
- Reintentos y concurrencia no duplican ni pierden stock.
- Un fallo revierte la confirmación completa.
- No se modifica `costoBase` ni se crean efectos financieros.
- Las escrituras cliente y colecciones internas están cerradas.
- Historial, detalle, edición de borrador, filtros, responsive e impresión están disponibles.
