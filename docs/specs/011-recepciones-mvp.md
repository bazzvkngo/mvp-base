# SPEC 011 — Recepciones MVP

> Estado post-demo: este flujo ligado a OC continúa vigente y separado de la
> Compra directa. Ya están implementados el límite por cantidad pendiente, el
> rechazo de líneas ajenas, la trazabilidad histórica y la revisión documental
> con Neto / IVA (tasa) / Total. Los valores extraídos también se muestran en el
> origen documental aplicado a la Recepción. Queda pendiente uniformar esa
> presentación tributaria en otros resúmenes y detalles donde los valores existan.

> Actualización BRUNO-10: el contexto documental `reception` extrae por separado
> documento, emisor/proveedor, receptor, totales y líneas económicas. La respuesta
> se normaliza determinísticamente, omite copias ORIGINAL/CEDIBLE repetidas y marca
> `Revisar totales` cuando las líneas, neto, impuesto y total no concilian. Los
> códigos de la factura son `codigoProveedor`, nunca SKU ni barcode. La identidad
> fiscal extraída sólo se compara con el proveedor autoritativo de la OC; no crea ni
> sustituye proveedores automáticamente.

> Actualización BRUNO-06: un borrador de Recepción puede usar el importador
> documental existente para generar una propuesta editable y reconciliarla con
> las líneas de la OC. Importar o aplicar la propuesta no modifica inventario;
> sólo `confirmarRecepcion` conserva la autoridad para stock y Compra automática.

> Actualización BRUNO POST-DEMO B: confirmar una Recepción actualiza inventario y crea en
> la misma transacción una Compra modelo 3, `stockGestionadoPor: recepcion`, ya confirmada por las cantidades
> efectivamente recibidas. Cada Recepción confirmada genera como máximo una
> Compra; los reintentos devuelven ambos documentos sin duplicar stock.

## Objetivo

Separar lo solicitado, lo recibido físicamente y el documento económico:

`Proveedor → Orden de compra → respuesta manual → Recepción → Inventario → Compra`

## Fuente de verdad

- La orden de compra conserva la solicitud histórica y no modifica stock.
- `respuestaProveedor` es una dimensión informativa de la OC: `pendiente`, `confirmada`, `rechazada` o `confirmada_con_observaciones`. Esta última se trata como confirmada al evaluar la recepción.
- La recepción registra lo recibido contra una OC emitida y es la única entrada nueva de abastecimiento.
- La compra registra el documento económico. Una Compra V3 de Recepción no
  modifica stock nuevamente; V1/V2 conservan compatibilidad histórica.
- Compras y movimientos modelo 1 conservan compatibilidad histórica.

## Persistencia y estados

Las recepciones viven en `negocios/{businessId}/recepciones/{recepcionId}` y usan `REC-AAAA-NNNN`.
Sus estados internos son `borrador`, `confirmada` y `cancelada`; en UI: Preparada, Recibida y Cancelada.

Una recepción guarda snapshots del proveedor, OC y líneas, además de cantidades solicitadas, recibidas anteriormente y recibidas ahora. No modifica la OC histórica.

Cuando se usa el importador, `documentoOrigen` conserva únicamente metadatos
sanitizados (nombre, tipo, tamaño, datos económicos ingresados y resumen de
reconciliación). El Base64 temporal nunca se persiste. Las líneas sin asociación
válida con la OC quedan fuera de la propuesta aplicada.

## Invariantes autoritativas

- Sólo OWNER/ADMIN escribe.
- La OC debe pertenecer al negocio y estar emitida.
- Sin respuesta no bloquea; una respuesta rechazada bloquea el camino principal hasta corregirla.
- La suma confirmada por línea nunca supera la cantidad solicitada.
- Guardar un borrador no cambia stock.
- Confirmar suma stock sólo para productos; servicios y actividades no lo modifican.
- `requestId`, `stockAplicado`, transacción y movimientos deterministas evitan doble aplicación.
- Los movimientos nuevos usan `tipoOrigen: recepcion` y referencian recepción y OC.
- Cada línea de producto crea además una adquisición inmutable en
  `adquisicionesInventario` con ID determinista `recepcionId__lineaId`.
- Antes de esos efectos, la confirmación calcula el presupuesto atómico
  compartido de 450 escrituras según líneas físicas, productos únicos y
  documentos fijos. Un exceso se rechaza íntegramente; servicios y actividades
  no cuentan como efectos físicos y la operación nunca se divide en batches.
- La misma transacción actualiza stock, saldo perpetuo `valorInventario`,
  `costoPromedio`, `ultimoCosto` y `ultimoProveedor`; cantidad y valor nunca
  quedan aplicados por separado.
- El promedio usa costo pagado unitario (neto tras descuento más impuesto de
  compra) y bloquea la mezcla con un promedio vigente en otra moneda.
- El cliente no escribe directamente recepciones, contadores, idempotencia ni movimientos.

`costoBase` conserva su significado comercial/manual y no se modifica. El
detalle de Inventario distingue promedio vigente, último costo y ledger
histórico; ninguno sustituye al costo congelado de Ventas o Proyectos.

## Compras y compatibilidad

Una recepción nueva confirmada registra automáticamente una compra confirmada con las cantidades y valores de su snapshot. Functions enlaza Compra, Recepción, OC, adquisiciones y movimientos dentro de la misma transacción. La conversión manual se conserva únicamente para recepciones históricas confirmadas sin Compra.

Una Compra confirmada puede revertirse completamente con motivo obligatorio. La
reversión conserva OC, Recepción y Compra, resta hoy de Q/V el costo pagado
original, crea movimientos compensatorios deterministas y marca cada adquisición
como revertida. La transacción completa se bloquea por stock insuficiente, costo
o moneda no demostrables, V negativo/inconsistente o residual con Q cero.

La Compra directa V3 ya incorpora su propia entrada física al confirmar desde
Nueva compra. Este flujo separado no permite introducir líneas ajenas ni superar
pendientes dentro de una Recepción ligada a OC.

No hay migración destructiva. `confirmarCompra` conserva las semánticas V1/V2.
Toda Compra nueva producida por Recepción usa `modeloCompraVersion: 3` y
`stockGestionadoPor: recepcion`; reintentar su confirmación no vuelve a sumar
stock.

Para productos legacy, la primera mutación económica usa primero un promedio
válido y luego el fallback `costoPagado` o `costoBase` con la tasa configurada.
Persiste metadata mínima del baseline sin crear una adquisición falsa. Un
producto sin adquisiciones continúa funcionando y muestra historial vacío.
