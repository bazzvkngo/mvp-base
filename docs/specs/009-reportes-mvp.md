# Reportes MVP

## Objetivo

Entregar una consulta operacional consolidada, de solo lectura, para la empresa activa de ValoraCloud. Reportes evoluciona la implementación existente de Estadísticas y utiliza `/reportes` como ruta canónica.

Reportes **no es contabilidad** y no reemplaza libros contables, declaraciones tributarias, facturación electrónica ni conciliación bancaria.

## Alcance

Reportes V1 contiene las pestañas Resumen, Ventas, Compras, Inventario, Cotizaciones y Finanzas. Permite filtrar por periodo, consultar documentos, revisar indicadores operacionales y exportar la pestaña activa a CSV.

La ruta legacy `/estadisticas` redirige a `/reportes`. Finanzas continúa como módulo independiente en `/finanzas`.

## Fuentes de datos

Todas las fuentes se consultan bajo `negocios/{businessId}/...`, usando el negocio derivado de la sesión y una membresía activa:

- `ventas`: documentos comerciales de venta.
- `compras`: documentos comerciales de compra.
- `inventario`: estado actual de productos.
- `movimientosInventario`: entradas por compra y salidas por venta.
- `cotizaciones`: propuestas comerciales.
- `financialMovements`: movimientos registrados en Finanzas.

Ventas y Compras no alimentan Finanzas automáticamente actualmente. Las cifras operacionales y financieras permanecen separadas.

## Semántica de las métricas

### Ventas

- Cantidad, total vendido, ticket promedio y clientes distintos consideran exclusivamente ventas `confirmada` cuya `fechaVenta` está en el periodo.
- Borradores y canceladas pueden consultarse en el listado, pero no forman parte de las métricas operacionales.

### Compras

- Cantidad, total comprado, compra promedio y proveedores distintos consideran exclusivamente compras `confirmada` cuya `fechaCompra` está en el periodo.
- Borradores y canceladas pueden consultarse en el listado, pero no forman parte de las métricas operacionales.

### Inventario

- Corresponde al **estado actual del inventario**, no a una fotografía histórica completa.
- Productos activos considera sólo ítems de tipo `producto` y estado activo.
- Stock bajo significa stock actual menor o igual al stock mínimo.
- La valorización usa `costoBase × stock actual` y sólo se presenta como total confiable cuando todos los productos activos poseen costo mayor que cero y stock válido.
- La cobertura de costos informa qué proporción de los productos activos puede valorizarse.
- El periodo se aplica únicamente a movimientos. No se suman unidades de productos con unidades diferentes.
- Reportes normaliza en lectura los timestamps históricos `createdAt` y `creadoEn`.

### Cotizaciones

- Se consideran cotizaciones cuya `fecha` está dentro del periodo.
- Los estados mostrados son el **estado actual** de una cotización fechada en el periodo; no se afirma que la transición ocurrió dentro del mismo periodo.
- Conversión corresponde a `aceptadas / (aceptadas + rechazadas)`. Sin decisiones, la conversión queda sin base.
- Los montos se presentan por estado.
- Las cotizaciones **no son ingresos** y no se utiliza la definición “Total cotizado vigente”.

### Finanzas

- Corresponde exclusivamente a **movimientos financieros registrados**.
- Muestra ingresos pagados, egresos pagados, resultado neto, por cobrar y por pagar.
- No representa automáticamente el total vendido ni el total comprado.

No existe costo de venta histórico suficiente para calcular utilidad, margen o ganancia histórica real. Reportes no calcula `ventas - compras` ni presenta esa diferencia como resultado empresarial.

## Filtros

- Periodos: semana, mes, últimos 3 meses, últimos 6 meses, año y personalizado.
- Ventas: estado y búsqueda por número o cliente.
- Compras: estado y búsqueda por número o proveedor.
- Cotizaciones: estado y búsqueda por número o cliente.
- Inventario: tipo de movimiento, entrada o salida.

## Permisos

OWNER, ADMIN y MEMBER con membresía activa pueden consultar y exportar Reportes. El módulo no crea, actualiza ni elimina información.

## Exportación

La única exportación del MVP es CSV. Se exporta la pestaña activa con encabezados claros y los filtros visibles. No se generan XLSX, PDF, impresiones avanzadas ni gráficos exportables.

## Limitaciones conocidas

- Las colecciones se leen y agregan en cliente; no existe paginación ni agregación backend.
- Las lecturas de varias colecciones no constituyen una instantánea atómica.
- El estado de cotización no conserva un historial completo de transiciones.
- Los movimientos de inventario históricos usan dos nombres de timestamp.
- Un costo cero se trata conservadoramente como costo sin cobertura.
- El stock mostrado siempre es actual, aunque se seleccione un periodo anterior.
- Finanzas depende de los movimientos que los usuarios hayan registrado expresamente.

Con alto volumen serán necesarias consultas por fecha/estado, paginación, índices y, eventualmente, agregaciones backend.

## Criterios de aceptación

- `/reportes` es la ruta canónica y `/estadisticas` redirige hacia ella.
- Navegación muestra Reportes y mantiene Finanzas separado.
- Existen las seis pestañas definidas y son responsive.
- Las métricas de Ventas y Compras excluyen borradores y canceladas.
- Inventario diferencia estado actual de movimientos del periodo.
- Cotizaciones presentan estado actual, conversión segura y no se confunden con ingresos.
- Finanzas identifica visiblemente que corresponde a movimientos registrados.
- Cada pestaña puede exportarse a CSV.
- Los estados de carga, vacío y error son visibles.
- Las lecturas respetan el negocio activo y las reglas de membresía existentes.

## Límites explícitos del MVP

Quedan fuera: contabilidad formal, SII, IVA tributario avanzado, libros contables, utilidad histórica, costo de venta histórico, conciliación bancaria, remuneraciones, forecasting, IA, BI avanzado, nuevos índices y nuevas Cloud Functions.
