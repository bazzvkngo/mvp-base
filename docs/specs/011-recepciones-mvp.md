# SPEC 011 — Recepciones MVP

> Actualización BRUNO-05: confirmar una Recepción actualiza inventario y crea en
> la misma transacción una Compra modelo 2 ya confirmada por las cantidades
> efectivamente recibidas. Cada Recepción confirmada genera como máximo una
> Compra; los reintentos devuelven ambos documentos sin duplicar stock.

## Objetivo

Separar lo solicitado, lo recibido físicamente y el documento económico:

`Proveedor → Orden de compra → respuesta manual → Recepción → Inventario → Compra`

## Fuente de verdad

- La orden de compra conserva la solicitud histórica y no modifica stock.
- `respuestaProveedor` es una dimensión informativa de la OC: `pendiente`, `confirmada` o `rechazada`.
- La recepción registra lo recibido contra una OC emitida y es la única entrada nueva de abastecimiento.
- La compra registra el documento económico. Las compras modelo 2 no modifican stock.
- Compras y movimientos modelo 1 conservan compatibilidad histórica.

## Persistencia y estados

Las recepciones viven en `negocios/{businessId}/recepciones/{recepcionId}` y usan `REC-AAAA-NNNN`.
Sus estados internos son `borrador`, `confirmada` y `cancelada`; en UI: Preparada, Recibida y Cancelada.

Una recepción guarda snapshots del proveedor, OC y líneas, además de cantidades solicitadas, recibidas anteriormente y recibidas ahora. No modifica la OC histórica.

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
- La misma transacción actualiza stock, `costoPromedio`, `ultimoCosto` y
  `ultimoProveedor`; costo y stock nunca quedan aplicados por separado.
- El promedio usa costo pagado unitario (neto tras descuento más impuesto de
  compra) y bloquea la mezcla con un promedio vigente en otra moneda.
- El cliente no escribe directamente recepciones, contadores, idempotencia ni movimientos.

## Compras y compatibilidad

Una recepción nueva confirmada registra automáticamente una compra confirmada con las cantidades y valores de su snapshot. Functions enlaza Compra, Recepción, OC, adquisiciones y movimientos dentro de la misma transacción. La conversión manual se conserva únicamente para recepciones históricas confirmadas sin Compra.

Una Compra confirmada puede revertirse completamente con motivo obligatorio. La reversión conserva OC, Recepción y Compra, crea movimientos compensatorios deterministas y marca la evidencia económica como revertida. Si el stock disponible de cualquier producto es menor que lo ingresado por esa Recepción, la transacción completa se bloquea.

La compra directa sigue disponible, pero tampoco representa entrada física en el modelo 2. La recepción directa o ajuste queda fuera de este MVP.

No hay migración destructiva. `confirmarCompra` conserva la aplicación de stock sólo para borradores históricos de modelo 1. Toda compra nueva usa `modeloCompraVersion: 2` y `stockGestionadoPor: recepcion`.

Para productos legacy sin promedio, la primera Recepción valoriza el stock anterior con `costoPagado`, o con `costoBase` más su tasa configurada como fallback. Un producto sin adquisiciones continúa funcionando y muestra historial vacío.
