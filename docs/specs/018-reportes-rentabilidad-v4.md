# SPEC 018 — Reportes de rentabilidad V4

## 1. Propósito y estado

Definir `REPORTES_RENTABILIDAD_V4` como una ampliación pequeña y de solo lectura
del resumen operacional de ValoraCloud. V4 consume el margen comercial de
Ventas V1 y el balance autoritativo de Proyectos ya existentes, sin crear una
contabilidad paralela ni revalorizar operaciones históricas.

- Fecha conceptual: 2 de septiembre de 2026.
- Estado: especificada; implementación pendiente.
- Alcance: Core de ValoraCloud. Las verticales estudiantiles quedan excluidas.
- Precedencia: `AGENTS.md` y SPEC 016 conservan autoridad. La SPEC 017 sigue
  siendo la única definición del margen comercial individual de una Venta.
- Esta SPEC no declara implementada ninguna métrica nueva.

## 2. Principios obligatorios

1. Reportes consume modelos económicos existentes; no los reemplaza.
2. El margen de Venta se obtiene invocando
   `calculateSaleCommercialMarginV1`; su fórmula no se copia en Reportes.
3. La rentabilidad de Proyecto se obtiene de `obtenerBalanceTrabajo`; no se
   recalcula desde documentos cliente ni desde compras del período.
4. Un costo histórico de producto proviene de
   `efectosInventario[].costoTotal`. Nunca se consulta `costoBase`,
   `costoPromedio`, `ultimoCosto`, adquisiciones ni el inventario vigente para
   completar una Venta histórica.
5. Servicios y actividades no reciben costo cero ni margen ficticio.
6. Margen comercial de productos y resultado de Proyecto son familias de
   métricas diferentes. Pueden verse en la misma página, pero nunca se suman ni
   forman una “utilidad total”.
7. Las monedas se agrupan por separado. V4 no convierte ni suma monedas.
8. Borradores, cancelaciones y reversiones no se transforman en importes
   negativos compensatorios.
9. V4 no inventa impuestos, costos, pagos, flujo de caja ni contabilidad.
10. La incertidumbre se muestra; un subtotal incompleto no se etiqueta como
    total completo.

## 3. Auditoría del módulo actual

### 3.1 Reportes visibles

La ruta vigente `/reportes` muestra una sola página, `StatisticsPage`, con:

- tarjetas por moneda de Ventas confirmadas, Compras confirmadas, resultado de
  Proyectos y margen de Proyectos;
- resumen de rentabilidad de Proyectos con composición de materiales, HH,
  gastos directos e indirectos;
- tabla/tarjetas de hasta seis Proyectos por moneda, ordenados por resultado
  absoluto;
- un gráfico de Ventas versus Compras confirmadas;
- `/estadisticas` como redirección compatible a `/reportes`.

`REPORT_TABS`, helpers detallados y exportadores CSV aún existen en
`reportModel.mjs`, pero la pantalla simplificada no expone pestañas ni CSV. El
`loadReportData` amplio sigue siendo consumidor del Dashboard; `/reportes` usa
`loadSimplifiedReportData`.

### 3.2 Métricas actuales

- Ventas: cantidad, suma de `total`, promedio y clientes distintos para
  operaciones confirmadas dentro del período.
- Compras: cantidad, suma de `total`, promedio y proveedores distintos para
  operaciones confirmadas dentro del período.
- Proyectos: suma de `balance.resultado` para balances `COMPLETO`.
- Rentabilidad de Proyectos: suma de valor comercial, materiales, HH, gastos
  directos/indirectos, costo, resultado y porcentaje agregado
  `resultado / valorComercial`.
- Evolución: Ventas y Compras por día hasta 92 días y por mes sobre 92 días.

Las sumas de Ventas y Compras vigentes usan `total`, que incluye el tratamiento
tributario ya almacenado por cada documento. No equivalen a ingresos cobrados,
gastos pagados ni utilidad.

### 3.3 Filtros actuales

- empresa activa recibida como `businessId`;
- período: semana, mes, últimos tres meses, últimos seis meses, año o rango
  personalizado;
- moneda: una moneda o todas separadas.

El modelo contiene helpers de búsqueda y estado, pero la página simplificada no
expone esos controles. El rango personalizado no tiene máximo. El filtro se
aplica en memoria después de cargar los documentos.

### 3.4 Datos y autoridad

`loadSimplifiedReportData` consulta todas las Ventas, todas las Compras y todos
los Proyectos visibles del negocio. Luego solicita un Callable
`obtenerBalanceTrabajo` por cada Proyecto autorizado.

- Los totales y efectos almacenados de Ventas/Compras fueron validados por
  Functions al confirmar; los adaptadores cliente normalizan su lectura.
- El margen de Venta V1 es una derivación pura y determinista de esos snapshots.
- El balance individual de Proyecto es autoritativo porque una Function vuelve
  a validar membresía y calcula desde Ventas, materiales, HH y gastos.
- Las agregaciones, filtros, porcentajes y gráficos de Reportes se calculan en
  frontend sobre datos ya obtenidos.

### 3.5 Limitaciones actuales

- Ventas y Compras descargan el historial completo del negocio sin límite,
  paginación ni restricción Firestore por fecha.
- La lista de Proyectos tampoco tiene límite y genera un patrón N+1 de Callables
  para sus balances. La UI limita lo mostrado, no lo leído.
- No existen índices compuestos para `negocioId + fechaVenta` ni
  `negocioId + fechaCompra`.
- El balance de Proyecto es actual; no hay snapshot de balance al cierre ni
  atribución histórica rigurosa por período.
- `balance.estado === "COMPLETO"` significa que existe una Venta confirmada y
  que la moneda es consistente. No demuestra que el usuario haya registrado
  todo costo real. `fuentes.materialesVentaSinCosto` sí revela una omisión
  histórica conocida que Reportes debe comunicar.
- El balance de Proyecto usa el `total` de la Venta, mientras Margen V1 usa
  ingreso neto asignado a productos. No comparten base y no son sumables.
- El helper de Reportes reconoce alias legacy de Compras, pero
  `adaptStoredPurchase` normaliza estados no canónicos a borrador. V4 no debe
  prometer compatibilidad de Compras legacy que el flujo real no demuestre.

## 4. Fuentes económicas disponibles

| Fuente | Datos disponibles | Clasificación para V4 |
| --- | --- | --- |
| Venta confirmada | `neto`, `total`, moneda, fecha, ítems, descuentos, `trabajoId`, `efectosInventario` | Documento comercial autoritativo; fuente del margen derivado V1 |
| `calculateSaleCommercialMarginV1` | ingreso neto de productos, costo histórico, margen, porcentaje y cobertura | Única fuente derivada para margen de Venta; no persistida |
| Venta cancelada | estado, reversa y snapshots conservados | Histórica/informativa; excluida de agregados |
| Balance de Proyecto | valor comercial, materiales, HH, gastos, costo, resultado, rentabilidad, moneda y fuentes | Fuente autoritativa para resultado de Proyecto |
| Gastos/HH/materiales de Proyecto en cliente | detalle operativo y resúmenes de UI | Informativos para Reportes; no sustituyen al balance Callable |
| Inventario Q/V | stock, `valorInventario`, `costoPromedio`, `ultimoCosto` | Autoritativo para saldo vigente, no para margen histórico |
| Movimientos/adquisiciones | entradas, salidas, valores antes/después, costos y reversas | Trazabilidad autoritativa; no son una segunda fórmula de margen |
| Compra confirmada | `neto`, impuesto existente, `total`, moneda, fecha y estado | Documento operacional autoritativo; no equivale a gasto contable ni costo de Venta |
| Compra cancelada/revertida/borrador | estado e historia | Excluida de totales confirmados |

### 4.1 Ventas

- Estados canónicos: `borrador`, `confirmada`, `cancelada`.
- Alias de lectura confirmada: `confirmado`, `activa`, `activo`; el adaptador no
  reescribe documentos.
- Sólo una Venta confirmada entra en Ventas netas o margen.
- Una cancelada se excluye, aunque conserve efectos y reversas.
- `neto` es el importe antes del impuesto ya existente. V4 lo consume; no
  recalcula ni introduce una regla tributaria.
- El costo histórico confiable es la suma exacta de `costoTotal` validada por el
  helper V1, no `cantidad × costoUnitario`.

### 4.2 Proyectos/Trabajos

- El ingreso vigente del balance es el valor comercial de Ventas canónicas
  `confirmada` vinculadas por `trabajoId`; una Cotización no es ingreso.
- Los costos incluyen materiales de Venta, consumos/devoluciones adicionales,
  HH y gastos directos/indirectos. El balance evita duplicar un gasto MATERIAL
  cuando existe libro de materiales.
- Estados económicos actuales: `COMPLETO`, `PARCIAL_SIN_VENTA` e
  `INCONSISTENTE_MONEDA`.
- El estado operacional del Proyecto se muestra, pero V4 no lo reinterpreta
  como cierre contable. Un Proyecto en curso puede tener balance económico
  actual y uno completado puede reabrirse.

### 4.3 Inventario y Compras

- BRUNO C mantiene Q/V, valor de inventario, promedio, último costo y ledger de
  adquisiciones/reversiones de forma autoritativa e idempotente.
- Esos valores describen saldo vigente y trazabilidad. No se usan para rellenar
  costos ausentes de una Venta o Proyecto histórico.
- Compras confirmadas permanecen como volumen operacional. V4 conserva la
  tarjeta y gráfico actuales, pero no las llama “gastos” ni las resta de Ventas.

## 5. Alcance funcional mínimo V4

### 5.1 Resumen comercial de Ventas

Por cada moneda y rango seleccionado, V4 expone:

1. **Ventas netas confirmadas conocidas**: suma de `neto` válido de Ventas
   confirmadas. Si una Venta confirmada no ofrece un neto válido, la cobertura
   del dato se declara parcial y el subtotal conocido no se presenta como total.
2. **Ingreso neto de productos cubiertos**: suma de
   `margen.ingresoNetoProductos` sólo para resultados V1 `COMPLETO`.
3. **Costo histórico de productos cubiertos**: suma de
   `margen.costoHistoricoProductos` sólo para resultados V1 `COMPLETO`.
4. **Margen bruto de productos cubiertos**: suma de
   `margen.margenBrutoProductos` sólo para resultados V1 `COMPLETO`.
5. **Margen bruto porcentual agregado**:

```text
margenBrutoProductosPct =
  ingresoNetoProductosCubiertos > 0
    ? round2(margenBrutoProductosCubiertos /
             ingresoNetoProductosCubiertos × 100)
    : null
```

El porcentaje se calcula desde las sumas; nunca se promedian porcentajes por
Venta. Un ingreso de productos igual a cero puede conservar margen monetario
negativo, pero su porcentaje es `null`.

### 5.2 Segmentación anti-doble-contabilización

Cada Venta confirmada se clasifica, sin consultar ni mutar el Proyecto, como:

- `SIN_PROYECTO`: `trabajoId` vacío;
- `CON_PROYECTO`: `trabajoId` no vacío.

V4 puede mostrar el total comercial de Ventas y ambos segmentos. La presencia
de `trabajoId` no cambia la fórmula V1. El segmento `CON_PROYECTO` se presenta
como análisis comercial de esa Venta, no como un importe adicional al resultado
del Proyecto.

Regla obligatoria: no existe una tarjeta, fila, gráfico, exportación ni fórmula
que sume margen comercial de Ventas con resultado de Proyectos. Tampoco se suma
“margen de Ventas sin Proyecto + resultado de Proyectos” como utilidad general,
porque sus bases económicas continúan siendo diferentes.

### 5.3 Cobertura comercial agregada

La cobertura se calcula sobre Ventas confirmadas que contienen productos:

- `COMPLETO`: todas producen resultado V1 `COMPLETO`.
- `PARCIAL`: al menos una es `COMPLETO` y al menos una queda `PARCIAL`,
  `NO_DISPONIBLE` o `INCONSISTENTE_MONEDA`; también se usa si la lectura alcanza
  el límite técnico antes de completar el rango.
- `NO_DISPONIBLE`: existen Ventas de productos, pero ninguna tiene margen
  completo.
- `NO_APLICA`: las Ventas confirmadas del grupo sólo contienen
  servicios/actividades.
- Sin Ventas confirmadas se usa el estado vacío de la UI, no un margen cero.

Se muestran conteos de Ventas confirmadas, completas, parciales, no disponibles,
con moneda inconsistente, sólo servicios, con Proyecto y sin Proyecto. Sólo
`COMPLETO` aporta a costo y margen agregados.

### 5.4 Rentabilidad de Proyectos

V4 conserva como única fuente cada balance devuelto por
`obtenerBalanceTrabajo` y expone por moneda:

- valor comercial asociado;
- materiales, HH, gastos directos e indirectos;
- costo registrado;
- resultado;
- rentabilidad porcentual ponderada;
- cantidades con resultado positivo, negativo o cero;
- cantidades con balance completo, parcial o no disponible.

Clasificación de presentación:

- `COMPLETO`: balance `COMPLETO`, campos agregables finitos y sin omisión
  histórica conocida (`fuentes.materialesVentaSinCosto === 0`).
- `PARCIAL`: `PARCIAL_SIN_VENTA` o balance con materiales de Venta cuyo costo
  histórico se declara ausente. Sus costos conocidos pueden verse en detalle,
  pero no aporta resultado al agregado completo.
- `NO_DISPONIBLE`: `INCONSISTENTE_MONEDA`, estructura inválida o importes
  agregables no finitos.

No se intenta detectar costos reales que nunca fueron registrados. La UI debe
decir “costos registrados” y “balance actual”, no “todos los costos” ni “cierre
contable”. El balance no se filtra por el período comercial.

### 5.5 Evolución temporal

- El gráfico existente de Ventas/Compras se conserva sin rediseño.
- Una tendencia temporal nueva de margen es técnicamente posible con Ventas V1
  `COMPLETO`: por día hasta 92 días y por mes sobre 92 días, siguiendo la
  infraestructura actual.
- Esa visualización no entra en el primer alcance V4. Primero deben quedar
  correctos KPI, cobertura y segmentación; no se agrega un gráfico sólo para
  repetir los mismos totales.
- No existe serie temporal válida de balance de Proyecto porque el balance es
  actual y no está snapshotado. V4 no inventa esa evolución.

### 5.6 Filtros V4

- Empresa activa: obligatoria e implícita; toda lectura queda bajo
  `negocios/{businessId}/...` y membresía activa.
- Rango de fecha: obligatorio para Ventas y Compras; por `fechaVenta` y
  `fechaCompra`, respectivamente.
- Moneda: una moneda o todas separadas, sin FX.
- Estado documental: los KPI tienen semántica fija de confirmadas. No se añade
  un selector de estado que permita mezclar borradores, cancelaciones o
  reversiones.
- Estado de cobertura: se muestra como conteo/diagnóstico; un filtro adicional
  de tabla queda fuera del mínimo.
- Proyecto: se muestran segmentos con/sin Proyecto; no se agrega selector de
  Proyecto en V4.

## 6. IN_SCOPE

- helper puro de agregación de margen comercial que reutiliza Margen V1;
- helper puro de clasificación de cobertura de balances de Proyecto, sin
  recalcularlos;
- Ventas netas confirmadas como contexto, margen bruto de productos cubiertos y
  porcentaje ponderado;
- segmentación de Ventas con/sin Proyecto;
- estados y conteos explícitos de cobertura;
- ganancia/pérdida/cero de Proyectos desde balances completos confiables;
- filtros actuales de período, moneda y empresa activa;
- consultas de Ventas/Compras acotadas por fecha, paginadas y con límite de
  seguridad;
- UI mínima dentro de `/reportes` y smokes de dominio/UI/servicio;
- índices estrictamente necesarios para las consultas temporales.

## 7. OUT_OF_SCOPE

- contabilidad formal, libro mayor, balance general o estado de resultados;
- llamar ingresos a cobros o compras a gastos pagados;
- utilidad neta empresarial o suma Venta + Proyecto;
- impuestos/IVA nuevos o uniformación tributaria general;
- pagos, flujo de caja o conciliación bancaria;
- forecasting, presupuestos o BI externo;
- conversión FX o nueva capacidad multi-moneda;
- costo o margen de servicios/actividades;
- revalorización, backfill o migración histórica;
- persistencia de márgenes, balances o agregados redundantes;
- nuevos movimientos, adquisiciones o mutaciones económicas;
- Projects V3, adicionales facturables o evidencia de gastos;
- Dashboard, exportación CSV/PDF y verticales estudiantiles;
- nuevo permiso RBAC o confidencialidad de campos dentro de una Venta.

## 8. Legacy y datos incompletos

### Ventas

- `confirmada`, `confirmado`, `activa` y `activo` entran como confirmadas sólo
  mediante adaptación de lectura. No se reescriben.
- `cancelada`, `cancelado`, `anulada` y `anulado` se excluyen del margen.
- Una Venta legacy con costo total válido y bandera de disponibilidad ausente
  conserva la compatibilidad de Margen V1.
- Una Venta sin costo histórico, con cobertura parcial, efectos anómalos o
  moneda incompatible no aporta costo ni margen numérico al agregado.
- `NO_APLICA` no se transforma en margen 100 %.
- Si el neto comercial no es válido, Ventas netas queda parcial; no se sustituye
  por `total`, precio vigente ni una estimación.

### Proyectos

- Reportes consume el contrato de balance vigente; no normaliza sus Ventas ni
  altera la Function.
- El balance autoritativo considera actualmente sólo estado canónico
  `confirmada`. La compatibilidad legacy más amplia de Margen V1 no cambia ese
  contrato en V4.
- `PARCIAL_SIN_VENTA` conserva costos conocidos, pero no inventa ingreso,
  resultado ni rentabilidad.
- `INCONSISTENTE_MONEDA` conserva el desglose devuelto y no aporta agregados.
- Una omisión histórica declarada por `materialesVentaSinCosto` degrada la
  cobertura de presentación a parcial.

### Compras

- Se conservan las reglas actuales: borradores, canceladas y revertidas no
  aportan al total confirmado.
- V4 no amplía alias legacy de Compras sin una prueba específica del adaptador
  real y su precedencia documental.

## 9. Seguridad y RBAC

- Entrar a `/reportes` requiere `reports.read` mediante la ruta actual.
- Cargar Ventas requiere `sales.read`; cargar Compras requiere
  `purchases.read`.
- Ver margen comercial agregado y rentabilidad de Proyectos requiere además
  `profitability.read`.
- En la matriz estándar, OWNER, ADMIN y FINANZAS poseen
  `profitability.read`. VENTAS y MEMBER no lo poseen.
- `obtenerBalanceTrabajo` revalida en backend los roles OWNER, ADMIN y FINANZAS.
- Un perfil sin rentabilidad no debe calcular ni renderizar KPI, segmentos,
  cobertura económica ni balances de Proyecto.
- No se crea permiso nuevo ni se confía en `negocioActivoId` como autorización.
- El guard del margen de Venta sigue siendo de presentación. Las Rules ya
  permiten leer el documento completo de Venta a perfiles con módulos
  Ventas/Reportes; V4 no amplía esa exposición. Una confidencialidad de campo
  real requeriría otro diseño y queda fuera.

## 10. Arquitectura propuesta

### 10.1 Dominio

Agregar en el dominio de Reportes un agregador puro que reciba Ventas ya
adaptadas y, para cada una, invoque `calculateSaleCommercialMarginV1`. Debe
devolver grupos por moneda, segmentos con/sin Proyecto, KPI y conteos de
cobertura. No accede a Firebase ni a Inventario.

Agregar un clasificador puro de balances de Proyecto que consuma la respuesta
de `obtenerBalanceTrabajo`. Sólo decide inclusión/cobertura para Reportes; no
repite la fórmula del balance.

### 10.2 Datos

La solución recomendada para el primer V4 es frontend + queries Firestore
existentes/acotadas + el Callable de balance ya existente:

- no se requiere una nueva Function para el margen, porque las Ventas completas
  ya son legibles por los mismos perfiles y el helper es puro;
- `reportService` debe recibir el rango y consultar Ventas/Compras por sus fechas
  en Firestore, en vez de llamar a listados de historial completo;
- la adaptación sigue a cargo de `adaptStoredSale` y `adaptStoredPurchase`;
- el Proyecto sigue consumiendo el Callable autoritativo existente;
- no se escriben documentos ni se materializan resúmenes.

Una Function agregadora nueva no elimina por sí sola el costo de leer cada Venta
y aumentaría superficie de backend. Sólo se reconsidera si mediciones reales
superan el sobre técnico definido aquí o si se decide una frontera de datos más
estricta.

## 11. Escalabilidad y Firestore

### 11.1 Sobre inicial propuesto

- rango máximo de consulta cliente: 366 días inclusivos;
- página Firestore: 250 documentos;
- máximo inicial por fuente y carga: 5.000 documentos, detectando uno adicional
  para saber que existe truncamiento.

Estos valores son límites operacionales del primer V4, no reglas económicas.
Deben centralizarse, probarse en emulador y ajustarse con mediciones. Si el rango
o cantidad excede el sobre, la UI pide acotar fechas y marca cobertura
`PARCIAL`; no publica el subtotal como total definitivo.

La paginación usa fecha descendente y ID de documento como desempate estable.
Cambiar rango o empresa cancela/ignora cargas anteriores para no mezclar datos.

### 11.2 Índices esperados

El archivo actual no posee índices temporales de Ventas/Compras. La ETAPA 2
debe validar en Emulator Suite y agregar sólo los que la consulta final exija,
previsiblemente:

- `ventas`: `negocioId ASC`, `fechaVenta DESC`, `__name__ DESC`;
- `compras`: `negocioId ASC`, `fechaCompra DESC`, `__name__ DESC`.

No se propone índice de margen, costo ni `trabajoId`, porque esos valores no se
persisten ni se consultan como agregados.

### 11.3 Deuda de Proyectos

El patrón actual carga todos los Proyectos y ejecuta un balance por cada uno.
V4 no debe multiplicarlo ni usarlo para validar el margen de cada Venta. Debe
mantener su carga separada, aplicar concurrencia acotada y comunicar error sin
ocultar el resumen comercial.

La sustitución del N+1 por agregados históricos escalables exige medir volumen
y posiblemente diseñar un resumen backend o snapshots de cierre. Eso sería un
bloque posterior porque introduce semántica/persistencia nueva. V4 registra esta
deuda y no diseña una descarga adicional de historial de Proyecto.

## 12. UI mínima

No se crea una nueva navegación ni se rediseña todo Reportes.

1. Mantener encabezado, selector de período, moneda y tarjetas actuales.
2. Agregar una sección “Margen comercial de Ventas” antes de rentabilidad de
   Proyectos, visible sólo con `sales.read + profitability.read`.
3. Mostrar KPI compactos: Ventas netas conocidas, ingreso neto de productos
   cubiertos, costo histórico cubierto, margen bruto y porcentaje ponderado.
4. Mostrar una línea de cobertura y conteos de completos/parciales/no
   disponibles/sólo servicios.
5. Mostrar dos filas o tarjetas de segmentación: con Proyecto y sin Proyecto.
6. Mantener “Rentabilidad de Proyectos” como bloque separado y añadir conteos
   de ganancia, pérdida, equilibrio y cobertura conocida.
7. No agregar un gráfico de margen en el primer alcance. El gráfico operacional
   actual permanece.
8. Estados de carga/error del margen y de Proyectos deben ser independientes.

## 13. Etapas de implementación

### ETAPA 1 — Contratos y helpers puros

- crear el agregador V4 de Ventas reutilizando Margen V1;
- crear el clasificador de cobertura de balances de Proyecto;
- definir grupos por moneda, segmentos, porcentaje ponderado y estados;
- agregar smokes puros para fórmulas, anti-doble-contabilización, legacy,
  servicios, denominador cero, monedas y balances incompletos;
- sin Firebase, UI, persistencia, Functions, Rules ni índices.

### ETAPA 2 — Fuente de datos acotada

- hacer que Reportes reciba y valide el rango;
- agregar consultas temporales paginadas y el sobre de seguridad;
- adaptar documentos con los modelos existentes;
- validar/agregar sólo los dos índices necesarios;
- separar la carga comercial de la carga de balances de Proyecto;
- probar negocio activo, paginación, desempate, cambio de rango, truncamiento y
  permisos.

### ETAPA 3 — UI mínima de Reports V4

- integrar KPI, cobertura y segmentos dentro de `StatisticsPage`;
- conservar layout, filtros y gráfico actuales;
- distinguir bases de Venta y Proyecto con texto explícito;
- añadir estados responsive, vacío, parcial, restringido y error.

### ETAPA 4 — Compatibilidad y seguridad

- ejecutar casos legacy de Ventas y comprobar que no haya backfill;
- comprobar cancelaciones/reversiones, servicios-only y monedas;
- verificar que perfiles sin `profitability.read` no carguen ni rendericen
  rentabilidad;
- verificar que nunca exista suma combinada Venta + Proyecto;
- validar la degradación conservadora de balances con faltantes conocidos.

### ETAPA 5 — QA y documentación

- ejecutar smokes de Reports, Margen, Ventas, Works, Inventario y RBAC;
- ejecutar integrados de Ventas/Compras si ETAPA 2 cambia sus servicios;
- ejecutar lint de Functions, build y `git diff --check`;
- actualizar la SPEC con el estado real sin declarar mejoras no implementadas.

## 14. Casos mínimos de prueba

1. Dos Ventas completas en una moneda: sumas y porcentaje ponderado.
2. Porcentajes individuales diferentes: demostrar que no se promedian.
3. Venta completa con Proyecto y otra sin Proyecto: segmentos correctos y total
   comercial independiente.
4. Venta mixta: sólo porción de productos entra al margen.
5. Venta sólo servicios: `NO_APLICA`, sin costo ni margen cero.
6. Venta legacy completa y legacy sin costo: inclusión conservadora.
7. Venta parcial, moneda incompatible, borrador y cancelada.
8. Ingreso neto de productos cero: margen monetario posible, porcentaje nulo.
9. Dos monedas: grupos separados y total transversal inexistente.
10. Límite de documentos excedido: cobertura parcial y KPI no definitivo.
11. Balance de Proyecto completo con ganancia, pérdida y equilibrio.
12. Proyecto sin Venta, con moneda incompatible o costo histórico ausente.
13. Proyecto en curso con balance actual: estado operacional visible, sin
    presentarlo como cierre contable.
14. Rango de Ventas cambia sin filtrar artificialmente el balance actual de
    Proyectos.
15. OWNER/ADMIN/FINANZAS ven rentabilidad; perfiles sin permiso no la cargan.
16. Fuente/UI sin lecturas de costos actuales ni fórmula duplicada de margen o
    balance.

## 15. Criterios de aceptación

- Las métricas de Venta invocan Margen V1 y usan sólo costos históricos
  completos.
- Sólo Ventas confirmadas del rango y moneda correctos aportan.
- El margen agregado es ponderado por ingreso neto de productos y nunca produce
  `NaN`/infinito.
- Cobertura parcial/no disponible y servicios-only son visibles y conservadores.
- Ventas con/sin Proyecto están segmentadas y ninguna fórmula suma margen de
  Venta con resultado de Proyecto.
- El bloque de Proyectos consume únicamente balances autoritativos actuales.
- Proyectos con faltantes históricos conocidos no inflan el agregado completo.
- Compras siguen siendo volumen confirmado, no gastos ni costo de ventas.
- Las consultas nuevas están acotadas por empresa y fecha, paginadas y limitadas;
  no descargan indefinidamente todo el historial.
- No existen nuevas escrituras, persistencias económicas, migraciones, FX,
  impuestos, Functions o permisos.
- La UI amplía Reportes sin crear otra ruta, pestaña o rediseño general.
- Los smokes relacionados, lint, build y `git diff --check` quedan verdes al
  cerrar la implementación.

## 16. Riesgo

**MEDIO.** V4 es de lectura y no modifica stock ni historia, pero presenta cifras
económicas agregadas. Los riesgos principales son confundir bases netas/brutas,
ocultar cobertura incompleta, sumar Venta y Proyecto, usar un costo vigente o
degradar rendimiento por lecturas no acotadas. El uso obligatorio de helpers
existentes, estados conservadores, consultas temporales y ausencia de
persistencia reducen esos riesgos.
