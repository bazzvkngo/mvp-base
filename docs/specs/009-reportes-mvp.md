# Reportes simplificados

## Estado documental post-demo

**Implementado:** el resumen actual presenta Ventas confirmadas, Compras
confirmadas y resultado/rentabilidad autoritativa de Proyectos, separados por
moneda y permisos.

**Confirmado pendiente:** evolucionar Reportes para distinguir ingresos, gastos,
margen comercial de Ventas y resultado/rentabilidad de Proyectos. Debe entregar
métricas útiles aunque una Venta no tenga Proyecto, sin convertir Reportes en
contabilidad formal ni SII. La definición exacta de “ingresos” y “gastos” frente
a documentos confirmados, pagos y movimientos financieros queda pendiente de
diseño; no se inventa en esta SPEC.

## Objetivo

`/reportes` entrega un resumen operacional de solo lectura para responder cuánto vendió,
cuánto compró y cuánto ganó en sus proyectos la empresa activa. Reportes no es
contabilidad, no reemplaza Finanzas y no calcula utilidad general de la empresa.

## Fuentes autoritativas

Todas las lecturas se limitan a `negocios/{businessId}/...` y requieren una membresía
activa con el permiso correspondiente.

- Ventas: documentos en estado `confirmada` o `activa`, usando `fechaVenta`.
- Compras: documentos en estado `confirmada` o `activa`, usando `fechaCompra`.
- Ganancia de proyectos: resultado actual devuelto por `obtenerBalanceTrabajo`.

Las ventas canceladas o preparadas y las compras revertidas o no confirmadas se
excluyen. No se leen cotizaciones, inventario ni movimientos financieros para construir
el resumen.

## Ganancia de proyectos

La ganancia usa exclusivamente el balance autoritativo existente de cada Proyecto:

`venta vinculada - materiales - horas hombre - gastos directos e indirectos = resultado`

Sólo se agregan balances `COMPLETO` con un resultado numérico. Un proyecto sin venta
vinculada o con monedas inconsistentes no aporta un resultado. Nunca se presenta
`ventas - compras` como ganancia.

El balance de Proyecto es actual y no posee atribución histórica rigurosa por período;
la interfaz debe explicitarlo y no filtrarlo artificialmente con el selector de fechas.

## Margen comercial de ventas — target pendiente

Una Venta confirmada de productos puede tener margen comercial aunque no exista
Proyecto. El costo histórico congelado en sus efectos de inventario es la fuente
preferida cuando está disponible; un registro legacy sin costo histórico no debe
completarse con el costo vigente. La fórmula agregada, los estados parciales y la
regla exacta para no duplicar resultado cuando la misma Venta participa en un
Proyecto quedan pendientes de diseño e implementación.

Margen comercial y rentabilidad de Proyectos son métricas distintas. Ninguna de
las dos equivale a `ventas - compras`.

## Presentación

- Encabezado: `Reportes` y `Resumen de ventas, compras y resultados de tus proyectos.`
- Selector de período existente y filtro de moneda.
- Tarjetas principales de Ventas, Compras y Ganancia de proyectos con conteos mínimos.
- Un único gráfico comparativo de Ventas y Compras.
- Enlaces a los módulos de origen sólo cuando el perfil puede navegar a ellos.
- Estados de carga, error y vacío visibles; los vacíos comerciales muestran cero.

Las monedas se muestran por separado. No existe conversión cambiaria ni suma entre
monedas diferentes.

## Permisos

El acceso a `/reportes` respeta el módulo personalizado introducido en BRUNO-09A.
Ventas y Compras se cargan sólo con sus permisos de lectura. Los balances de Proyecto
sólo se solicitan y muestran con `profitability.read`; tener únicamente el módulo
Reportes no concede rentabilidad.

## Compatibilidad y límites

`/estadisticas` puede seguir redirigiendo a `/reportes`. Los helpers anteriores usados
por otros consumidores se conservan, pero la pantalla simplificada no expone pestañas,
CSV, inventario, cotizaciones ni Finanzas. No se agregan índices ni Cloud Functions.

## Criterios de aceptación

- Las cifras comerciales consideran sólo operaciones activas o confirmadas del período.
- Cancelaciones, preparaciones, reversiones y borradores no alteran los totales.
- La ganancia proviene del balance de Proyecto y no de restar compras a ventas.
- La pantalla vigente no presenta todavía margen comercial general como si ya
  estuviera implementado.
- Los resultados se separan por moneda y nunca producen `NaN`.
- Un perfil sin rentabilidad no recibe balances de Proyecto.
- Los enlaces respetan las rutas habilitadas para perfiles personalizados.
