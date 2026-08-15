# Compras MVP

> Actualización: las compras nuevas (`modeloCompraVersion: 2`) son documentos económicos y no modifican stock. La entrada física ocurre al confirmar una Recepción. El comportamiento anterior se conserva para documentos históricos de modelo 1. Ver `011-recepciones-mvp.md`.

## Objetivo

Registrar compras directas o derivadas de una recepción como documentos económicos y conservar su evidencia histórica. En el modelo 2, confirmar una compra no modifica stock: la entrada física y las recepciones parciales se registran en Recepciones conforme a la SPEC 011. El modelo 1 conserva compatibilidad histórica con su comportamiento anterior. Este módulo no implementa pagos, cuentas por pagar, contabilidad ni ajustes manuales.

## Modelo Firestore

Colecciones operacionales:

```text
negocios/{businessId}/compras/{compraId}
negocios/{businessId}/movimientosInventario/{movimientoId}
```

`compraId` y `movimientoId` son nombres canónicos. Cada compra guarda:

- `numero` con formato `COM-YYYY-NNNN`, `anio` y `correlativo`;
- `estado`: `borrador`, `confirmada` o `cancelada`;
- `proveedorId` y `proveedorSnapshot` histórico;
- origen opcional `ordenCompraId` y `ordenCompraNumero`;
- documento del proveedor, fechas, condiciones y observaciones;
- líneas con `lineaId`, `itemId`, snapshot autoritativo, cantidad, costo unitario editable, descuento y totales;
- `subtotal`, `descuentoTotal`, `neto`, `iva` y `total` en CLP;
- `stockAplicado`, autoría y timestamps canónicos.

Las colecciones internas son:

```text
negocios/{businessId}/purchaseCounters/{year}
negocios/{businessId}/purchaseCreateRequests/{requestId}
negocios/{businessId}/purchaseConfirmRequests/{requestId}
negocios/{businessId}/purchaseOrderConversionRequests/{requestId}
```

Todas están cerradas al SDK cliente. La numeración es transaccional e independiente por negocio y año.

## Autoridad y snapshots

El frontend envía únicamente campos editables, IDs, cantidades, costos y descuentos. Functions valida una membresía activa `OWNER` o `ADMIN`, resuelve siempre el negocio autorizado y vuelve a leer proveedores e inventario dentro de ese negocio. Número, estado, snapshots, totales y aplicación de stock son autoritativos.

En una compra directa, proveedor e ítems nuevos deben estar activos. Conservar proveedor o línea durante la edición mantiene exactamente su snapshot existente; cambiar la referencia exige un maestro activo y crea un snapshot nuevo. Al confirmar se vuelven a leer el proveedor y todos los ítems únicos dentro de la misma transacción: deben seguir existiendo, pertenecer al negocio, conservar su tipo y continuar activos. Esto incluye productos, servicios y actividades, aunque sólo los productos modifiquen stock.

Una compra originada desde una OC usa exclusivamente el proveedor y los ítems históricos ya autorizados de la orden emitida. No reconstruye esos datos desde maestros vivos. Mientras permanece en borrador, proveedor, cantidad de líneas, `lineaId`, `itemId` y snapshots quedan bloqueados; sólo pueden ajustarse cantidades, costos, descuentos y los campos editables de documento, condiciones y observaciones. Esto permite confirmar una compra histórica aunque el producto haya sido archivado después de emitirse la orden, siempre que el documento de inventario aún exista, pertenezca al negocio y continúe siendo de tipo `producto`.

## Creación desde orden de compra

Solo una OC `emitida` puede convertirse. La operación:

1. valida acceso y estado en backend;
2. crea un único borrador de compra con numeración propia;
3. conserva los snapshots históricos de la OC;
4. registra en la orden `compraId`, `compraNumero` y fecha de vínculo.

`purchaseOrderConversionRequests` protege reintentos. Además, el vínculo `compraId` de la orden impide crear una segunda compra aun con otro `requestId`. Una OC en borrador o cancelada se rechaza.

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

Una compra admite como máximo 200 líneas. Este límite mantiene la confirmación completa bajo el máximo práctico de escrituras de una sola transacción sin dividir la atomicidad.

## Confirmación y stock

Confirmar ejecuta una única transacción Firestore:

- comprueba que la compra esté en borrador y `stockAplicado` sea falso;
- lee todos los productos involucrados;
- suma `cantidad` a su `stock` actual sin modificar `costoBase`;
- crea un movimiento inmutable `entrada_compra` por cada línea de producto;
- marca la compra `confirmada`, `stockAplicado: true` y registra autoría y fecha.

Servicios y actividades permanecen en el documento de compra, pero no reciben `stock` ni generan movimientos. Si cualquier producto falta o es inconsistente, toda la transacción se revierte: ningún stock, movimiento ni estado queda parcialmente escrito.

La idempotencia tiene doble defensa: `purchaseConfirmRequests/{requestId}` protege reintentos de transporte y el propio estado `confirmada`/`stockAplicado` impide aplicar stock otra vez con un request diferente. Las transacciones de inventario preservan incrementos concurrentes.

Cada movimiento guarda negocio, producto, compra, número, cantidad, stock anterior/posterior, snapshot mínimo, autoría y timestamp. No existe edición ni eliminación cliente de movimientos.

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

Órdenes emitidas ofrecen `Registrar compra`; una orden ya vinculada ofrece `Ver compra`. El workspace reutiliza la identidad visual de Órdenes de Compra, pero mantiene componentes propios para líneas, resumen, catálogo, detalle y documento imprimible. La vista móvil usa tarjetas y no depende de scroll horizontal.

Antes de confirmar se advierte que se actualizará stock y la compra ya no podrá editarse. El detalle confirmado muestra el origen y si el stock fue aplicado.

## Límites explícitos

No se implementan:

- ventas;
- recepción parcial o devoluciones;
- pagos o cuentas por pagar;
- integración SII, contabilidad o finanzas;
- reversas o edición de movimientos;
- actualización de `costoBase`;
- ajustes manuales de inventario;
- inteligencia artificial.

## Pruebas

`purchase-model-smoke.mjs` cubre cálculos, overflow, payload mínimo, máximo de 200 líneas en frontend/backend, adaptación, búsqueda, roles y presencia de defensas backend/rules.

`purchases-integrated-local.mjs` cubre creación directa OWNER/ADMIN, rechazo MEMBER, aislamiento entre empresas, snapshots autoritativos, manipulación, numeración e idempotencia, conversión exclusiva de OC emitida, bloqueo de referencias de compras desde OC, edición comercial permitida, revalidación de proveedor/productos/servicios/actividades directos, doble conversión, movimientos, costo base intacto, reintentos, concurrencia, rollback atómico, productos históricos archivados y reglas de acceso.

La aceptación requiere además regresiones de Órdenes de Compra, Inventario, Proveedores, Cotizaciones, Clientes y Rules; build, lint de Functions, revisión de diff y revisión visual manual. El módulo no se marca completado en `000-mvp-profesor.md` hasta que esa revisión visual sea aprobada.

## Criterios de aceptación

- La autoridad de negocio, roles, referencias, snapshots, cálculos y estados reside en Functions.
- Una OC emitida produce como máximo una compra y conserva su evidencia histórica.
- Confirmar aumenta stock únicamente de productos y genera movimientos inmutables.
- Reintentos y concurrencia no duplican ni pierden stock.
- Un fallo revierte la confirmación completa.
- No se modifica `costoBase` ni se crean efectos financieros.
- Las escrituras cliente y colecciones internas están cerradas.
- Historial, detalle, edición de borrador, filtros, responsive e impresión están disponibles.
