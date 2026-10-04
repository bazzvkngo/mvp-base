# SPEC 022 — Rentabilidad en Reportes: ganancia neta operacional

## 1. Propósito y estado

Rediseñar `/reportes` alrededor de un indicador único y honesto de rentabilidad,
la **ganancia neta operacional**, y corregir la base del balance de Proyecto a
neto (sin IVA) para que ambos universos de ganancia sean comparables y
sumables sin doble contabilización.

- Fecha conceptual: 4 de octubre de 2026.
- Estado: especificada; implementación pendiente. Esta SPEC no declara
  implementada ninguna métrica nueva.
- Alcance: Core de ValoraCloud (Reportes y balance de Proyecto). Las verticales
  estudiantiles quedan excluidas.
- Origen: decisiones definitivas del dueño del negocio piloto (Bagner), §2.
- Precedencia: `AGENTS.md` conserva autoridad máxima. Esta SPEC sustituye
  únicamente los puntos de SPEC 016, 018 y 021 que la tabla del §3 marca como
  reemplazados; todo lo demás de esas SPEC sigue vigente. La SPEC 017 sigue
  siendo la única definición del margen comercial individual de una Venta.

## 2. Decisiones del dueño del negocio (definitivas)

Estas decisiones no se reabren en la implementación:

1. **Balance de Proyecto a neto.** El ingreso del balance de Proyecto deja de
   usar `total` (con IVA) y pasa a usar `neto` (sin IVA). Es un **cambio
   numérico real y visible**: los ingresos, resultado y margen que hoy se ven en
   `/trabajos` y en Reportes cambiarán para todos los Proyectos con Ventas
   afectas a IVA, incluidas las históricas (ver §7).
2. **Costos al mes de registro.** HH y gastos se asignan al mes en que se
   registraron, no al mes de la Venta.
3. **Gastos generales fuera de alcance.** Los gastos generales del negocio
   (no asociados a un Proyecto) no se descuentan. Por eso el indicador se llama
   siempre **"ganancia neta operacional"**, nunca "ganancia neta" a secas.
4. **Servicios sin Proyecto: "sin costo registrado".** Los servicios vendidos
   sin Proyecto se marcan "sin costo registrado". No se exige asociarlos a un
   Proyecto y no se agrega ningún campo nuevo.

## 3. Reemplaza / Se mantiene

Leyenda:

- **REEMPLAZADO**: esta SPEC sustituye el punto completo.
- **REEMPLAZADO PARCIALMENTE**: se indica exactamente qué parte cambia y qué
  parte sigue vigente.
- **SE MANTIENE**: sigue vigente sin cambios.

### 3.1 SPEC 018 — Reportes de rentabilidad V4

| Punto | Texto vigente (resumen) | Decisión | Detalle |
| --- | --- | --- | --- |
| §2.6 | Margen comercial y resultado de Proyecto son familias distintas; pueden verse juntas, pero nunca se suman ni forman una "utilidad total". | REEMPLAZADO PARCIALMENTE | **Cambia:** se permite **una sola** suma, la ganancia neta operacional del §4, y solo sobre universos disjuntos (Ventas sin Proyecto por margen V1 y Proyectos por balance mensual). **Sigue vigente:** son métricas distintas, con fuentes distintas, y no se suman en ninguna otra tarjeta, fila, gráfico ni fórmula. Ninguna de ellas, ni la suma, se llama "utilidad total" ni "ganancia neta" a secas. |
| §5.2 | Segmentación `SIN_PROYECTO` / `CON_PROYECTO` por `trabajoId`. Regla obligatoria: ninguna fórmula suma margen de Ventas con resultado de Proyectos, tampoco "margen sin Proyecto + resultado de Proyectos". | REEMPLAZADO PARCIALMENTE | **Sigue vigente:** la clasificación por `trabajoId` vacío o no vacío, sin consultar ni mutar el Proyecto. Ahora es la base de la fórmula del §4. **Cambia:** se deroga la prohibición de sumar "margen de Ventas sin Proyecto + resultado de Proyectos". Esa suma es exactamente la ganancia neta operacional. Sigue prohibido sumar el margen V1 de Ventas **con** Proyecto al resultado de Proyectos, porque eso es doble contabilización. |
| §5.5 | El gráfico Ventas/Compras se conserva sin rediseño. La tendencia de margen no entra en V4. No existe una serie temporal válida de balance de Proyecto. | REEMPLAZADO | (a) El gráfico Ventas vs Compras se **traslada** a la pestaña Compras con una nota obligatoria de "no es ganancia" (§6.3). (b) Se agrega la evolución mensual de la ganancia neta operacional (§6.5). (c) La serie mensual de Proyecto **sí** existe a partir de esta SPEC: no se construye con snapshots, sino asignando cada registro fechado a su mes (§5). No se inventan datos: cada importe proviene de un documento con fecha propia. |
| §7 — contabilidad formal, libro mayor, estado de resultados | Fuera de alcance. | SE MANTIENE | La ganancia neta operacional no es un estado de resultados. |
| §7 — llamar ingresos a cobros o compras a gastos pagados | Fuera de alcance. | SE MANTIENE | Todo se calcula sobre documentos confirmados, no sobre pagos. |
| §7 — utilidad neta empresarial o suma Venta + Proyecto | Fuera de alcance. | REEMPLAZADO PARCIALMENTE | **Cambia:** la suma Venta sin Proyecto + Proyecto queda permitida solo como ganancia neta operacional (§4). **Sigue vigente:** la "utilidad neta empresarial" sigue fuera de alcance, porque no se descuentan los gastos generales (decisión 3). |
| §7 — impuestos/IVA nuevos | Fuera de alcance. | SE MANTIENE | Esta SPEC solo **consume** el `neto` ya persistido por Functions y no crea reglas tributarias. |
| §7 — pagos, flujo de caja, conciliación | Fuera de alcance. | SE MANTIENE | — |
| §7 — forecasting, presupuestos, BI externo | Fuera de alcance. | SE MANTIENE | — |
| §7 — conversión FX | Fuera de alcance. | SE MANTIENE | Todo se agrupa por moneda. |
| §7 — costo o margen de servicios/actividades | Fuera de alcance. | SE MANTIENE | Los servicios sin Proyecto se marcan "sin costo registrado" (decisión 4, §4.4). No reciben costo cero ni margen. |
| §7 — revalorización, backfill o migración histórica | Fuera de alcance. | SE MANTIENE | El balance se sigue calculando al leer, sin backfill. Por eso el cambio a neto se ve también en Proyectos históricos (§7.3), sin reescribir ningún documento. |
| §7 — persistencia de márgenes, balances o agregados | Fuera de alcance. | SE MANTIENE | El desglose mensual se calcula al leer y no se persiste. |
| §7 — nuevos movimientos, adquisiciones o mutaciones económicas | Fuera de alcance. | SE MANTIENE | — |
| §7 — Projects V3, adicionales, evidencia de gastos | Fuera de alcance. | SE MANTIENE | Siguen regidos por SPEC 019/020. |
| §7 — Dashboard, exportación CSV/PDF | Fuera de alcance. | SE MANTIENE | El Dashboard no consume el balance de Proyecto (§7.2). |
| §7 — nuevo permiso RBAC | Fuera de alcance. | SE MANTIENE | Se reutiliza `profitability.read`. |

**Otros puntos de SPEC 018 que esta SPEC afecta** (no estaban en el encargo,
pero se declaran para que ninguno quede contradicho en silencio):

| Punto | Decisión | Detalle |
| --- | --- | --- |
| §2.3 (rentabilidad desde `obtenerBalanceTrabajo`, no se recalcula en cliente) | SE MANTIENE | El desglose mensual también lo calcula la Function (§5.3), no el cliente. |
| §2.5 (servicios sin costo cero ni margen ficticio) | SE MANTIENE | Es el fundamento de §4.4. |
| §2.10 (la incertidumbre se muestra; un subtotal incompleto no se presenta como total) | SE MANTIENE | Aplica a la ganancia neta operacional (§4.5). |
| §3.5, viñeta "El balance usa `total`; Margen V1 usa ingreso neto; no comparten base" | REEMPLAZADO | Con §7 ambos usan base neta. |
| §4.2 (ingreso del balance = valor comercial de Ventas confirmadas) | REEMPLAZADO PARCIALMENTE | Sigue siendo ingreso solo la Venta canónica `confirmada` vinculada por `trabajoId`, pero ahora se toma su `neto`, no su `total`. |
| §5.4, frase "El balance no se filtra por el período comercial" | REEMPLAZADO | Para la ganancia neta operacional, el Proyecto aporta solo lo asignado a los meses del período (§5). El balance acumulado sigue disponible en `/trabajos`. |
| §5.4, clasificación `PARCIAL` para `PARCIAL_SIN_VENTA` (no aporta al agregado) | REEMPLAZADO | Por la decisión 2, los costos de un Proyecto sin Venta sí restan en su mes (§5.4). |
| §12.7 (no agregar gráfico de margen) | REEMPLAZADO | Ver §6.5. |
| §15, "La UI amplía Reportes sin crear otra ruta, pestaña o rediseño general" | REEMPLAZADO | Esta SPEC es un rediseño de pestañas (§6). No se crea una ruta nueva. |

### 3.2 SPEC 021 — Reportes V5

| Punto | Texto vigente (resumen) | Decisión | Detalle |
| --- | --- | --- | --- |
| §2.4 | `COMMERCIAL_SALES` y `PROJECT_PROFITABILITY` permanecen separados en Ganancias. No existe, ni debe agregarse, un "total de ganancias" que los sume. | REEMPLAZADO PARCIALMENTE | **Cambia:** Ganancias y la vista inicial muestran la ganancia neta operacional, que suma Ventas **sin** Proyecto y Proyectos (§4). **Sigue vigente:** no se suma `COMMERCIAL_SALES` completo (que incluye Ventas con Proyecto) con `PROJECT_PROFITABILITY`. La etiqueta "Total de ganancias" sigue prohibida. |
| §4 | Contrato de seis subvistas: Resumen, Ventas, Compras, Inventario, Proyectos, Ganancias. | REEMPLAZADO | Lo sustituye el contrato de cuatro subvistas del §6. |
| §10 — las 6 subvistas existen vía `?vista=` | Criterio cumplido. | REEMPLAZADO | Pasan a ser 4 (§6.1). Las URL legacy se redirigen (§6.1). |
| §10 — cambiar de subvista no recarga ni pierde `period`/`from`/`to`/`currency` | Criterio cumplido. | SE MANTIENE | — |
| §10 — ningún agregador mezcla monedas | Criterio cumplido. | SE MANTIENE | — |
| §10 — Ganancias no presenta ni permite derivar un total combinado | Criterio cumplido. | REEMPLAZADO | Lo sustituye el criterio del §9: un único total combinado y nombrado, sobre universos disjuntos. |
| §10 — el catálogo de inventario no se consulta fuera de la subvista Inventario | Criterio cumplido. | REEMPLAZADO | Al desaparecer esa subvista, `/reportes` deja de consultar el catálogo de inventario por completo. |
| §10 — build y suites en verde | Criterio cumplido. | SE MANTIENE | Como criterio de cierre de esta SPEC (§9). |
| §10 — QA visual en navegador real | Pendiente. | SE MANTIENE | Sigue pendiente y aplica también a esta SPEC. |

**Otros puntos de SPEC 021 afectados:**

| Punto | Decisión | Detalle |
| --- | --- | --- |
| §2.1 (sin colecciones, índices, Functions ni reglas nuevas) | REEMPLAZADO PARCIALMENTE | No se crean colecciones, índices, reglas ni Functions nuevas. Sí cambia el **contrato de salida** de la Function existente `obtenerBalanceTrabajo` (§7). |
| §2.3 y §7 ("`calculateWorkBalance` no se toca") | REEMPLAZADO | `calculateWorkBalance` cambia según §7. `calculateSaleCommercialMarginV1` sigue sin cambios de fórmula (§6.5.3). |
| §2.7 (carga perezosa del inventario) | REEMPLAZADO | Ya no aplica, porque Reportes no carga inventario. |

### 3.3 SPEC 016 — Visión post-demo

| Punto | Texto vigente (resumen) | Decisión | Detalle |
| --- | --- | --- | --- |
| §G — IMPLEMENTADO: Ventas, Compras y resultado de Proyectos separados por moneda y permisos | — | SE MANTIENE | — |
| §G — CONFIRMADO PENDIENTE: distinguir ingresos, gastos, margen comercial y resultado de Proyectos, incluyendo métricas para Ventas sin Proyecto | — | SE MANTIENE (como objetivo) | Esta SPEC especifica una parte: la ganancia neta operacional y el tratamiento de Ventas sin Proyecto. No marca el objetivo como implementado. Los "gastos" generales del negocio siguen pendientes (decisión 3). |
| §G — PENDIENTE DE DISEÑO: semántica de ingresos y gastos frente a pagos y movimientos financieros | — | SE MANTIENE | Esta SPEC trabaja solo sobre documentos confirmados, no sobre pagos. |
| §G — Reportes es resumen operacional, no contabilidad formal ni SII | — | SE MANTIENE | Por eso se usa el calificativo "operacional". |
| §7 — invariante "Reportes no usa `ventas - compras` como ganancia" (y §E, "Nunca se define ganancia como `ventas - compras`") | — | SE MANTIENE SIN CAMBIOS | La fórmula del §4 no contiene ningún término de Compras. El gráfico Ventas vs Compras lleva la nota "no es ganancia" (§6.3). |
| §E — PENDIENTE DE DISEÑO: regla de agregación que evite contar dos veces una Venta que también forma parte de un Proyecto | — | RESUELTO POR ESTA SPEC (diseño) | La regla es el §4.2: cada Venta confirmada aporta por **una sola** vía según su `trabajoId`. La implementación sigue pendiente. |

### 3.4 SPEC 020 — Adicionales facturables y evidencia de gastos

Las dos citas de `sale.total` en SPEC 020 se refieren **al mismo balance de
Proyecto** que calcula `calculateWorkBalance` (`functions/workBalance.js`) y
expone `obtenerBalanceTrabajo`, que es el que modifica el §7. No es un balance
propio del Adicional: el Adicional no tiene ningún campo de ingreso (SPEC 020
§5.2 y §12). §3.2 describe el flujo vigente al momento de auditar. §6.2 usa esa
misma regla como argumento de que un Adicional no duplica ingreso.

| Punto | Texto vigente (cita textual) | Decisión | Detalle |
| --- | --- | --- | --- |
| §3.2, líneas 82-85 | "Una Venta puede llevar `trabajoId` (vínculo ya existente, expediente comercial de SPEC 012). El ingreso del balance de Proyecto proviene exclusivamente de `sale.total` de Ventas `confirmada` vinculadas por `trabajoId`." | REEMPLAZADO PARCIALMENTE | **Cambia:** el importe que aporta cada Venta pasa de `sale.total` a `sale.neto` (decisión 1, §7.1). Una Venta sin `neto` válido no aporta ingreso y no usa `total` como respaldo (§7.1.2). **Sigue vigente:** el ingreso proviene **exclusivamente** de Ventas canónicas `confirmada` vinculadas por `trabajoId`. Ninguna otra fuente aporta ingreso: Cotización, Adicional, borrador o Venta cancelada. El resto de §3.2 (`itemId` obligatorio por línea, excepción de líneas heredadas de Cotización, `writeSaleConfirmationEvent`) no se toca. |
| §6.2, viñeta "No se duplica ingreso" (líneas 280-285) | "No se duplica ingreso: el ingreso del Proyecto sigue siendo, exclusivamente, `sale.total` de Ventas confirmadas vinculadas — un adicional `PENDIENTE_COBRO` nunca aporta valor comercial al balance (§11). Sólo cuando se convierte en una línea real de una Venta confirmada aporta valor, exactamente una vez, por el mismo camino que cualquier otra línea." | REEMPLAZADO PARCIALMENTE | **Cambia:** la base es `sale.neto`, no `sale.total`. Un Adicional incorporado aporta, dentro del `neto` de la Venta, el valor de su línea después de descuentos y sin IVA. **Sigue vigente sin cambios:** un Adicional `PENDIENTE_COBRO` nunca aporta ingreso; aporta exactamente una vez y solo como línea de una Venta confirmada; no existe camino paralelo de ingreso. Con la asignación mensual (§5.1), ese ingreso cae en el mes de `fechaVenta` de la Venta que lo incorpora, no en el mes de creación del Adicional. |

**Otros puntos de SPEC 020 que esta SPEC afecta** (no estaban en el encargo,
pero se declaran para que ninguno quede contradicho en silencio):

| Punto | Decisión | Detalle |
| --- | --- | --- |
| §1, Precedencia: "SPEC 017 (Margen Comercial V1), SPEC 018 (Reports V4) y el balance de `workBalance.js` permanecen intactos y no se redefinen en ningún punto." | REEMPLAZADO PARCIALMENTE | Era una restricción del alcance del bloque SPEC 020 y sigue cumplida para ese bloque. A partir de esta SPEC, el balance se redefine según §5 y §7. La precedencia de SPEC 012 como modelo de Trabajos y costos se mantiene. |
| §2.3: "`calculateWorkBalance` (`functions/workBalance.js`) no se modifica: su fórmula, sus fuentes de ingreso (Venta confirmada) y de costo (materiales, HH, gastos) siguen siendo exactamente las mismas" | REEMPLAZADO PARCIALMENTE | **Cambia:** la fórmula (ingreso neto y desglose mensual). **Sigue vigente:** las fuentes, que siguen siendo Venta confirmada para el ingreso y materiales, HH y gastos para el costo. No se agrega ninguna fuente ni se quita ninguna. |
| §6.2, última viñeta: "`calculateWorkBalance` sigue sin conocer la existencia de adicionales; sólo ve la Venta confirmada resultante" | SE MANTIENE | El §7 no hace que el balance lea `adicionales`. |
| §12, viñeta "el balance sigue derivándose exclusivamente de Ventas `confirmada`, sin excepción" | SE MANTIENE | Solo cambia el importe tomado de cada Venta (`neto`), no el criterio de qué Ventas aportan. |
| §12, última viñeta: "El balance de Proyecto (`calculateWorkBalance`) y Margen Comercial V1 (`calculateSaleCommercialMarginV1`) no se redefinen: cero cambios a su código." y §20: "`calculateWorkBalance` y `calculateSaleCommercialMarginV1` quedan bit-a-bit idénticos a como estaban antes de este bloque." | REEMPLAZADO PARCIALMENTE | Era un criterio de aceptación de las etapas de SPEC 020 y no se reabre. `calculateWorkBalance` deja de ser idéntico desde esta SPEC (§7.1). `calculateSaleCommercialMarginV1` mantiene su fórmula. Solo gana una salida por línea que reconcilia con su agregado (§6.5.3). |
| §19, OUT_OF_SCOPE: "Cambios a la economía Q/V (BRUNO C) o a la fórmula de `calculateWorkBalance`/Margen Comercial V1" | REEMPLAZADO PARCIALMENTE | La fórmula de `calculateWorkBalance` entra en alcance en esta SPEC. La economía Q/V y la fórmula de Margen V1 siguen fuera. |
| §19, OUT_OF_SCOPE: "Nuevos impuestos o reinterpretación de IVA" | SE MANTIENE | Esta SPEC no crea impuestos. Usar el `neto` ya persistido por `crearVenta` no reinterpreta el IVA, que sigue calculándolo solo la Venta. |
| §20: "Un adicional `PENDIENTE_COBRO` nunca aparece como ingreso en `calculateWorkBalance` ni en Reports V4" | SE MANTIENE | Se extiende sin cambios a la ganancia neta operacional (§4.3). |
| Caso 30/31 implementado (`scripts/sale-additional-integrated-local.mjs:275-277`), que verifica que el balance sube por el `total` de la Venta | REEMPLAZADO (en implementación) | Debe exigir el `neto` (ver §7.4). No se edita en esta etapa. |

## 4. Ganancia neta operacional

### 4.1 Definición

Por cada moneda `m` y período `P` (meses calendario completos o parciales del
rango seleccionado):

```text
gananciaNetaOperacional(m, P) =
    Σ margenBrutoProductos(v)           para v ∈ VentasSinProyecto(m, P), V1 COMPLETO
  + Σ resultadoMensual(t, mes)          para t ∈ ProyectosIncluibles(m), mes ∈ P
```

donde:

```text
resultadoMensual(t, mes) =
    ingresoNeto(t, mes)
  − materialesVenta(t, mes)
  − materialesAdicionales(t, mes)
  − horasHombre(t, mes)
  − gastosDirectos(t, mes)
  − gastosIndirectos(t, mes)
```

- `margenBrutoProductos(v)` es el resultado de
  `calculateSaleCommercialMarginV1(v).margenBrutoProductos`, sin copiar su
  fórmula. Es ingreso neto de productos menos costo histórico congelado.
- `ingresoNeto(t, mes)` es la suma del `neto` de las Ventas canónicas
  `confirmada` del Proyecto `t` cuya `fechaVenta` cae en `mes` (§7).
- Cada componente de costo se asigna a su mes según el §5.
- El porcentaje, cuando se muestra, es:

```text
gananciaNetaOperacionalPct =
  ingresoNetoConsiderado > 0
    ? round2(gananciaNetaOperacional / ingresoNetoConsiderado × 100)
    : null

ingresoNetoConsiderado =
    Σ ingresoNetoProductos(v)  (Ventas sin Proyecto V1 COMPLETO del período)
  + Σ ingresoNeto(t, mes)      (Proyectos incluibles, meses del período)
```

  El porcentaje se calcula desde las sumas, nunca promediando porcentajes.

### 4.2 Universo: una vía por Venta

Cada Venta confirmada del período aporta por **exactamente una** vía, según la
segmentación de SPEC 018 §5.2:

| Segmento | Vía de aporte | Qué aporta |
| --- | --- | --- |
| `SIN_PROYECTO` (`trabajoId` vacío) | Margen comercial V1 | Solo el margen bruto de sus **productos**, si V1 es `COMPLETO`. |
| `CON_PROYECTO` (`trabajoId` no vacío) | Balance mensual del Proyecto | Su `neto` completo (productos y servicios) como ingreso del Proyecto en el mes de `fechaVenta`. |

- Una Venta `CON_PROYECTO` **no** pasa por el término de margen V1 de la
  fórmula, aunque su margen V1 pueda mostrarse en otros análisis.
- Un Proyecto aporta aunque no tenga Ventas en el período: sus costos del
  período restan (decisión 2, §5.4).

### 4.3 Exclusiones

| Excluido | Motivo |
| --- | --- |
| IVA / impuesto de Ventas | Se usa `neto` en ambas vías (decisión 1). |
| Gastos generales del negocio (no asociados a Proyecto) | Fuera de alcance (decisión 3). Una nota fija en UI lo declara. |
| Compras | No son costo de venta (SPEC 016 §7). El costo de productos ya viene del costo histórico congelado. |
| Servicios/actividades de Ventas sin Proyecto | No tienen costo registrado (decisión 4, §4.4). |
| Ventas sin Proyecto con V1 `PARCIAL`, `NO_DISPONIBLE` o `INCONSISTENTE_MONEDA` | No tienen margen confiable (SPEC 018 §5.3). Se informan como alerta (§6.2). |
| Borradores, cancelaciones y reversiones | No son ingreso (SPEC 018 §2.8). |
| Cotizaciones y adicionales `PENDIENTE_COBRO` | No son ingreso hasta que se incorporan a una Venta confirmada (SPEC 020). |
| Proyectos no incluibles (§4.5) | Se informan como alerta. |

### 4.4 Línea "Ventas sin costo registrado"

- **Qué contiene:** por moneda y período, el ingreso neto de servicios y
  actividades de Ventas `SIN_PROYECTO` confirmadas:

```text
ventasSinCostoRegistrado = Σ (ingresoNetoVenta(v) − ingresoNetoProductos(v))
  para v ∈ VentasSinProyecto con V1 COMPLETO o NO_APLICA
```

  Ambos importes salen del resultado V1 de la Venta. Una Venta `NO_APLICA`
  (solo servicios) aporta su `ingresoNetoVenta` completo.
- **Cómo se trata:** no se suma ni se resta en la ganancia neta operacional.
  No se le asigna costo cero ni margen 100 %.
- **Cómo se muestra:** como una línea **separada**, debajo de la ganancia y
  fuera de su recuadro, con el texto:

  > Ventas sin costo registrado: {monto} — servicios vendidos sin proyecto.
  > No se incluyen en la ganancia porque no tienen costos asociados.

- No se exige asociar esas Ventas a un Proyecto y no se agrega ningún campo
  nuevo (decisión 4).

### 4.5 Proyectos incluibles y cobertura

Un Proyecto es **incluible** en la moneda `m` si su balance:

- tiene `estado` `COMPLETO` o `PARCIAL_SIN_VENTA` y moneda base `m`;
- tiene `fuentes.materialesVentaSinCosto === 0`;
- tiene `fuentes.ventasSinNetoValido === 0` (nuevo campo, §7.1);
- trae todos sus importes finitos.

Un Proyecto `INCONSISTENTE_MONEDA`, o uno con material de Venta sin costo
histórico o con Venta sin `neto` válido, **no aporta** a la suma: se excluye
completo, para no restar costos sin su ingreso ni sumar ingreso sin su costo.

Cobertura de la ganancia por moneda:

- `COMPLETA`: todas las Ventas sin Proyecto con productos son V1 `COMPLETO`,
  todos los Proyectos con actividad en el período son incluibles y no hubo
  truncamiento de lectura.
- `PARCIAL`: falla al menos una de esas condiciones. La cifra se muestra con la
  etiqueta "Ganancia neta operacional conocida (parcial)" y nunca se presenta
  como total definitivo (SPEC 018 §2.10).
- Sin Ventas ni costos de Proyecto en el período: estado vacío, no cero.

## 5. Asignación de costos e ingresos por mes

### 5.1 Regla (decisión 2)

Cada importe se asigna al mes calendario (`AAAA-MM`) de su propia fecha. El mes
de la Venta del Proyecto **no** arrastra los costos.

| Componente | Fecha que define el mes | Fuente |
| --- | --- | --- |
| Ingreso neto de Proyecto | `fechaVenta` de la Venta confirmada | `ventas` con `trabajoId` |
| Materiales de la Venta | `fechaVenta` de la Venta, porque el costo se congela al confirmarla | `efectosInventario[].costoTotal` |
| Materiales adicionales (salida/devolución) | `fecha` del movimiento `SALIDA_PROYECTO` / `DEVOLUCION_PROYECTO` | `movimientosInventario` |
| Horas hombre | `fecha` del registro de HH | `trabajos/{id}/horasHombre` |
| Gastos directos e indirectos | `fecha` del gasto | `trabajos/{id}/gastos` |
| Margen V1 de Venta sin Proyecto | `fechaVenta` | `ventas` |

- `fecha` es obligatoria y la valida el backend al registrar HH, gastos y
  movimientos (`functions/workPersistence.js`: `normalizeExpenseInput`,
  `normalizeLaborInput`, salida y devolución de materiales). Ver la pregunta
  abierta Q1 sobre `fecha` frente a `creadoEn`.
- El mes se obtiene de los primeros 7 caracteres de la fecha `AAAA-MM-DD`, sin
  conversión de zona horaria.
- Un registro anulado (`estado === "anulado"`) no aporta en ningún mes.
- Un registro sin fecha válida no se asigna a ningún mes. Se cuenta en
  `fuentes.registrosSinFecha` y el Proyecto queda no incluible (§4.5).

### 5.2 Período de Reportes y meses

- El rango seleccionado conserva el máximo de 366 días de SPEC 018 §11.
- Para la ganancia, un mes cuenta si alguna de sus fechas cae dentro del rango.
  Los registros se filtran por su fecha exacta dentro del rango, no por el mes
  completo.

### 5.3 Dónde se calcula

El desglose mensual lo calcula `calculateWorkBalance` en Functions, a partir
de los mismos documentos que ya carga `loadWorkBalanceDocuments`. Se devuelve
como campo aditivo del contrato:

```text
desglosePorMes: [
  { mes: "AAAA-MM", moneda, ingresoNeto, materialesVenta,
    materialesAdicionales, horasHombre, gastosDirectos,
    gastosIndirectos, costoTotal, resultado }
]
```

- El cliente no recalcula el desglose desde documentos (se mantiene SPEC 018
  §2.3).
- Los totales acumulados que ya existen (`valorComercial`, `costoTotal`,
  `resultado`, etc.) se conservan para `/trabajos`. Para cada moneda deben ser
  iguales a la suma de `desglosePorMes` excluyendo los registros sin fecha.
  Esa igualdad la verifica un smoke.
- No se persiste nada y no se agregan índices.

### 5.4 Consecuencias explícitas de la decisión 2

- Un Proyecto con costos en marzo y Venta en mayo muestra **resultado
  negativo en marzo** y positivo en mayo. Es el comportamiento esperado, no un
  error. La UI lo explica en el detalle por Proyecto.
- Un Proyecto en curso sin Venta (`PARCIAL_SIN_VENTA`) **resta** sus costos del
  período en la ganancia neta operacional. Aparece además como alerta (§6.2).
- La suma de los resultados mensuales de un Proyecto en todos sus meses es
  igual a su `resultado` acumulado de `/trabajos`.

## 6. Estructura final de Reportes

### 6.1 Navegación

| `?vista=` | Etiqueta | Visible para |
| --- | --- | --- |
| `rentabilidad` (inicial) | Rentabilidad y estado | `profitability.read` |
| `ventas` | Ventas | `sales.read` |
| `compras` | Compras | `purchases.read` |
| `ganancias` | Ganancias | `profitability.read` |

- **Inventario y Proyectos dejan de ser pestañas.**
- `normalizeReportView` redirige las URL legacy: `resumen`, `inventario` y
  `proyectos` llevan a `rentabilidad`. Si el perfil no tiene
  `profitability.read`, llevan a la primera pestaña permitida (`ventas` o
  `compras`). Así ningún perfil aterriza en una vista vacía.
- Se conservan el período y la moneda compartidos por query param (SPEC 021
  §10).
- `/reportes` deja de llamar a `getInventoryItems`.
- Para el destino del contenido de Inventario y Proyectos, ver Q5.

### 6.2 Vista inicial: "Rentabilidad y estado"

Por cada moneda, en este orden:

1. **Ganancia neta operacional** del período, con su porcentaje (§4.1) y su
   cobertura (§4.5). Debajo, la nota fija:
   > Ganancia neta operacional: ventas sin IVA menos costos registrados de
   > productos y proyectos. No incluye gastos generales del negocio.
2. **Desglose completo**, en filas que suman exactamente la ganancia:
   - Ventas sin proyecto: ingreso neto de productos, costo histórico de
     productos y margen bruto de productos.
   - Proyectos: ingreso neto, materiales de venta, materiales adicionales,
     horas hombre, gastos directos, gastos indirectos y resultado.
   - **Ganancia neta operacional** = margen bruto de productos sin Proyecto +
     resultado de Proyectos.
3. **Ventas sin costo registrado**, fuera del desglose (§4.4).
4. **Estado del sistema**: lista de alertas. Cada alerta muestra un conteo,
   un monto cuando aplica y un enlace al registro o módulo. Solo se listan las
   que tienen conteo mayor que cero:

| # | Alerta | Fuente | Efecto en la ganancia |
| --- | --- | --- | --- |
| A1 | Ventas sin proyecto con productos sin costo histórico | V1 `PARCIAL` / `NO_DISPONIBLE` | Excluidas; cobertura parcial |
| A2 | Ventas con moneda inconsistente en sus costos | V1 `INCONSISTENTE_MONEDA` | Excluidas; cobertura parcial |
| A3 | Ventas confirmadas sin neto válido (legacy) | V1 `NO_DISPONIBLE` por importes / `fuentes.ventasSinNetoValido` | Excluidas; cobertura parcial |
| A4 | Proyectos con costos en el período y sin venta confirmada | balance `PARCIAL_SIN_VENTA` con costos en el período | **Incluidos**: sus costos restan (§5.4) |
| A5 | Proyectos con materiales vendidos sin costo histórico | `fuentes.materialesVentaSinCosto > 0` | Proyecto excluido; cobertura parcial |
| A6 | Proyectos con monedas incompatibles | `INCONSISTENTE_MONEDA` | Proyecto excluido; cobertura parcial |
| A7 | Proyectos con registros sin fecha válida | `fuentes.registrosSinFecha > 0` | Proyecto excluido; cobertura parcial |
| A8 | Lectura truncada por límite de rango o de documentos | `lecturaTruncada` (SPEC 018 §11) | Cobertura parcial |
| A9 | No fue posible cargar balances de Proyecto | error del Callable | Sin término de Proyectos; cobertura parcial |

Esta lista sale de las señales que el código ya expone. La investigación
previa que propuso las alertas no está versionada en el repositorio: ver Q4.

### 6.3 Pestaña Compras

- Igual que hoy: tarjetas, evolución, principales proveedores, productos
  adquiridos y listado.
- **Se agrega** el gráfico Ventas vs Compras (el `OperationalComparisonChart`
  que hoy vive en Resumen), sin cambios de cálculo: sigue usando `total` de
  documentos confirmados.
- Nota obligatoria, pegada al gráfico:
  > Comparar ventas y compras no es ganancia. Las compras incluyen stock que
  > aún no se vende, y ambos montos incluyen IVA. La ganancia está en
  > Rentabilidad y estado.
- La pestaña no muestra margen, resultado ni ganancia.

### 6.4 Pestaña Ventas

- Igual que hoy, **sin** la tarjeta `SalesCommercialMarginV4Card`, que se mueve
  a Ganancias.
- Mantiene tarjetas, evolución, principales clientes, productos y servicios
  más vendidos y el listado.

### 6.5 Pestaña Ganancias

1. **Desglose**: el mismo bloque del §6.2 (puntos 1 a 3), reutilizando el mismo
   componente.
2. `SalesCommercialMarginV4Card`, trasladada desde Ventas como análisis
   comercial de **todas** las Ventas (con y sin Proyecto). Lleva el rótulo
   explícito "Análisis de margen comercial, no se suma a la ganancia neta
   operacional", porque incluye Ventas con Proyecto.
3. Tres gráficos:

"Ganancias por Proyectos" y ProjectProfitabilityV4Summary se retiran de esta
pestaña, no forman parte del rediseño. Decisión del dueño del negocio: junto a
la ganancia neta operacional repetirían el problema de "dos resultados
distintos en pantalla" que esta SPEC resuelve.

#### 6.5.1 Evolución mensual

- Barras por mes del período con la ganancia neta operacional, divididas en
  sus dos componentes: margen de Ventas sin Proyecto y resultado de Proyectos.
- Un mes con cobertura parcial se marca visualmente.
- Siempre con granularidad mensual (un rango de 366 días da como máximo 13
  barras).

#### 6.5.2 Margen por cliente

- Ganancia neta operacional atribuida por cliente:
  - margen V1 de Ventas sin Proyecto, por `clienteId` de la Venta;
  - resultado mensual de Proyectos, por `clienteId` del Proyecto.
- Un Proyecto sin cliente va a la barra "Sin cliente asignado".
- Propiedad verificable: la suma de todas las barras es igual a la ganancia
  neta operacional del período. Ver Q6.

#### 6.5.3 Margen bruto por producto

- Margen bruto por `itemId` de producto, solo sobre Ventas sin Proyecto con V1
  `COMPLETO`. Así es consistente con el término de productos de la ganancia.
  Ver Q7.
- Requisito técnico: V1 hoy solo devuelve agregados por Venta, no por línea.
  La implementación debe agregar, en `saleCommercialMargin.mjs`, una salida por
  línea que reparta el descuento general con la misma regla de V1. La suma de
  las líneas debe reconciliar exactamente con `margenBrutoProductos` de la
  Venta, y un smoke lo verifica. La fórmula del margen de la Venta (SPEC 017)
  no cambia.

### 6.6 RBAC

- Sin cambios de permisos. La ganancia, el desglose, las alertas de
  Proyectos y los gráficos de Ganancias requieren `profitability.read`, como
  hoy (SPEC 018 §9).
- Un perfil sin `profitability.read` no carga balances ni calcula la ganancia.

## 7. Corrección del balance de Proyecto a neto

### 7.1 Alcance exacto

**Ubicación real:** el encargo cita `workBalance.js:97`, pero en el código
vigente (`HEAD` = `352df8a`) la línea que suma el ingreso con IVA es la
**92**:

```js
// functions/workBalance.js:91-93
  confirmedSales.forEach((sale) => {
    balanceBucket(buckets, currency(sale.moneda, baseCurrency)).valorComercial += amount(sale.total);
  });
```

La línea 97 es `bucket.materiales += amount(entry.costoTotal);` y no cambia.

Cambios en `functions/workBalance.js`:

1. Línea 92: `amount(sale.total)` pasa a ser el `neto` de la Venta.
2. Una Venta confirmada sin `neto` finito ≥ 0 (legacy) **no** usa `total` como
   respaldo (SPEC 018 §8). No aporta ingreso y se cuenta en el nuevo
   `fuentes.ventasSinNetoValido`. Ver Q3.
3. Se agregan `desglosePorMes` (§5.3) y `fuentes.registrosSinFecha`.
4. `WORK_BALANCE_MODEL_VERSION` sube de `2` a `3`.
5. El nombre del campo `valorComercial` se conserva para no romper
   consumidores. Su semántica pasa a ser "ingreso neto". No se persisten dos
   nombres para el mismo concepto.

Sin cambios: costos (materiales, HH, gastos), detección de monedas, estados
`COMPLETO` / `PARCIAL_SIN_VENTA` / `INCONSISTENTE_MONEDA`, regla de exclusión
de gastos `MATERIAL`, RBAC del Callable y lecturas Firestore.

### 7.2 Pantallas afectadas (verificado con grep)

`calculateWorkBalance` solo se invoca desde `obtenerBalanceTrabajoHandler`
(`functions/workBalance.js:219`), expuesto como el Callable
`obtenerBalanceTrabajo` (`functions/index.js:2407`). En el cliente lo consume
`src/services/workService.js:64`, y a ese servicio lo llaman:

| Pantalla | Consumidor | Qué cambia en pantalla |
| --- | --- | --- |
| `/trabajos`, detalle de Proyecto, sección "Balance y margen" | `src/pages/WorksPage.jsx:106` → `WorkBalanceSection` (`:633-655`) | **Ingresos**, **Resultado** y **Margen %** bajan en Proyectos con Ventas afectas a IVA. También el desglose por moneda cuando hay inconsistencia (`:655`). Los costos no cambian. |
| `/reportes`, Resumen, tarjeta "Ganancia de proyectos" | `reportService.js:65-71` (`listProjectBalances`) → `getProjectProfitabilitySummary` (`reportModel.mjs:261`) → `ReportsResumenView.jsx:32` | El resultado agregado baja. La vista desaparece con §6, pero mientras exista también cambia. |
| `/reportes`, Proyectos (tabla, tarjetas, resumen de rentabilidad) | mismo flujo → `ReportsProyectosView.jsx:64`, `:73`, `:89` | Ingresos, resultado y margen por Proyecto. |
| `/reportes`, Resumen y Ganancias, "Ganancias por Proyectos" | `reportProfitabilityV4Service.js:79` → `reportProfitabilityV4.mjs` (`:426`, `:491`, `:508`) → `ProjectProfitabilityV4Summary` | Valor comercial, resultado y rentabilidad agregados. |

**No afectados (verificado):**

- **Dashboard** (`DashboardPage.jsx:236`): llama a `loadReportData` sin
  `includeTraceability`, y con eso `projectBalances` es `[]`
  (`reportService.js:144-149`). Ningún archivo del repositorio pasa
  `includeTraceability: true`.
- **Margen V1 de Ventas**: ya usaba base neta.
- **Ventas, Compras e Inventario**: no consumen el balance.

### 7.3 Impacto numérico declarado

Es un cambio **numérico real, no silencioso**. Ejemplo con IVA 19 %:

| | Antes (`total`) | Después (`neto`) |
| --- | --- | --- |
| Venta del Proyecto | total 119.000 (neto 100.000) | 100.000 |
| Costos registrados | 60.000 | 60.000 |
| Resultado | 59.000 | 40.000 |
| Margen | 49,58 % | 40,00 % |

- Afecta a **todos** los Proyectos con Ventas afectas a IVA, incluidos los
  históricos, porque el balance se calcula al leer y no hay snapshot. No se
  reescribe ningún documento.
- Un Proyecto con resultado positivo pequeño puede pasar a negativo.
- La implementación debe comunicarlo al dueño del negocio antes del despliegue
  y dejarlo en las notas de la versión.

### 7.4 Pruebas que deben actualizarse en la implementación

No se tocan ahora:

- `scripts/work-balance-smoke.mjs`: los fixtures de Venta solo traen `total`
  (`:15`, `:69`). Cambian las aserciones `:38`, `:46`, `:47`, `:83`, `:99` y
  `:101`. Se agregan casos de `neto`, de Venta sin `neto` y de `desglosePorMes`.
- `scripts/sale-additional-integrated-local.mjs:275-277`: hoy exige que el
  balance suba exactamente el `total` de la Venta. Debe exigir el `neto`.
- Smokes de Reportes V4 (`report-profitability-v4-*`) y `report-model-smoke`:
  revisar los fixtures de balance y el contrato nuevo.

## 8. Smokes que hoy bloquean el wording y propuesta de reemplazo

Las citas son textuales y los archivos **no se editan** en esta etapa.

### 8.1 `scripts/report-profitability-v4-stage3-ui-smoke.mjs`

Líneas que hoy prohíben "ganancia neta" / "utilidad neta":

```js
// línea 104
  assert.doesNotMatch(oneCurrency, /utilidad neta|ganancia neta|ebitda|resultado contable/i);
```

```js
// línea 245
    assert.doesNotMatch(source, /rentabilidad total|resultado total|utilidad total|utilidad neta|utilidad empresarial|ebitda|resultado contable|ganancia neta/i);
```

Propuesta:

- **Línea 104** (tarjeta comercial V4): debe seguir sin decir "ganancia neta",
  porque esa tarjeta **no** es la ganancia neta operacional. Se mantiene la
  prohibición y solo se permite la forma calificada:

```js
assert.doesNotMatch(oneCurrency, /utilidad neta|ganancia neta(?! operacional)|ebitda|resultado contable/i);
assert.doesNotMatch(oneCurrency, /ganancia neta operacional/i); // la tarjeta V4 no es la ganancia
```

- **Línea 245** (código fuente de las tarjetas V4 y del hook): misma regla. La
  suma no debe vivir en esos archivos, sino en el helper de dominio de la
  ganancia. La línea 246 (sin fórmula `margen + resultado`) **se mantiene sin
  cambios** para estos archivos.

```js
assert.doesNotMatch(source, /rentabilidad total|resultado total|utilidad total|utilidad neta|utilidad empresarial|ebitda|resultado contable|ganancia neta(?! operacional)/i);
```

- **Nuevo smoke** del componente de ganancia que debe **exigir**:

```js
assert.match(gananciaSource, /Ganancia neta operacional/);
assert.match(gananciaSource, /No incluye gastos generales del negocio/);
assert.match(gananciaSource, /sin IVA/i);
assert.match(gananciaSource, /Ventas sin costo registrado/);
assert.doesNotMatch(gananciaSource, /ganancia neta(?! operacional)|utilidad neta|utilidad total|[Tt]otal de ganancias/i);
```

### 8.2 `scripts/report-model-smoke.mjs`

Este archivo **no contiene** los textos "ganancia neta" ni "utilidad neta"
(verificado con grep). Las líneas que bloquean el rediseño son estas:

```js
// línea 405
assert.doesNotMatch(comprasViewSource, /[Gg]anancia/);
```

```js
// línea 438
assert.doesNotMatch(gananciasViewSource, /[Tt]otal de ganancias/);
```

```js
// línea 439
assert.doesNotMatch(gananciasViewSource, /commercial\.bloque.*\+.*projects\.bloque|projects\.bloque.*\+.*commercial\.bloque/);
```

Propuesta:

- **Línea 405**: hoy impediría la nota obligatoria "no es ganancia" (§6.3).
  Pasa a ser:

```js
assert.match(comprasViewSource, /Comparar ventas y compras no es ganancia/);
assert.doesNotMatch(comprasViewSource.replace(/no es ganancia/g, ""), /[Gg]anancia/);
```

- **Línea 438**: se mantiene y se amplía:

```js
assert.doesNotMatch(gananciasViewSource, /[Tt]otal de ganancias|ganancia neta(?! operacional)|utilidad neta/i);
assert.match(gananciasViewSource, /Ganancia neta operacional/);
```

- **Línea 439**: **se mantiene sin cambios**. La suma no se escribe en la
  vista; viene ya calculada desde el helper de dominio.

Otras aserciones del mismo archivo que el rediseño de pestañas obliga a
cambiar. No prohíben el wording, pero contradicen el §6:

```js
// línea 376
  ["resumen", "ventas", "compras", "inventario", "proyectos", "ganancias"]
```

Propuesta: `["rentabilidad", "ventas", "compras", "ganancias"]`.

```js
// línea 382
assert.match(reportPageSource, /Consulta ventas, compras, inventario, proyectos y ganancias en un solo lugar\./);
```

Propuesta: actualizar al subtítulo nuevo de `/reportes`.

```js
// línea 392
assert.equal((resumenViewSource.match(/<OperationalComparisonChart/g) || []).length, 1);
```

Propuesta: la misma aserción, aplicada a `comprasViewSource`.

```js
// línea 402
assert.match(ventasViewSource, /<SalesCommercialMarginV4Card/);
```

Propuesta: `assert.doesNotMatch(ventasViewSource, /<SalesCommercialMarginV4Card/);`.

- **Líneas 390-391, 394-398** (Resumen) y **413-429** (Inventario y Proyectos):
  se reemplazan por aserciones de la vista "Rentabilidad y estado" y por una
  aserción de que `normalizeReportView` redirige `resumen`, `inventario` y
  `proyectos` (§6.1).

## 9. Criterios de aceptación

- La ganancia neta operacional sigue exactamente el §4.1. Cada Venta aporta por
  una sola vía (§4.2) y ningún término incluye Compras.
- El indicador nunca se rotula "ganancia neta" sin "operacional", ni "utilidad
  neta", "utilidad total" o "total de ganancias".
- La línea "Ventas sin costo registrado" se muestra aparte y no se suma ni se
  resta.
- El desglose suma exactamente la cifra mostrada.
- El balance de Proyecto usa `neto`. El cambio numérico queda documentado (§7.3)
  y los smokes de balance lo verifican.
- `desglosePorMes` reconcilia con los acumulados (§5.3) y asigna cada registro
  al mes de su fecha (§5.1).
- La cobertura parcial se rotula y nunca se presenta como total definitivo.
- Reportes tiene 4 pestañas. Las URL legacy redirigen sin dejar vistas vacías.
- `/reportes` no carga el catálogo de inventario.
- No se mezclan monedas, no hay FX y no hay permisos nuevos.
- Los smokes de Reportes, Margen, Works, ventas adicionales y RBAC, el lint de
  Functions, el build, `npm run test:design` y `git diff --check` quedan en
  verde.
- QA visual en navegador: `/trabajos` (balance) y las 4 pestañas de
  `/reportes`.

## 10. Etapas sugeridas

1. **Balance a neto y desglose mensual** (Functions): §7.1 y §5.3, con smokes
   de balance. Comunicar el cambio numérico.
2. **Helper de dominio** de ganancia neta operacional, cobertura y alertas,
   más la salida por línea de V1 (§6.5.3). Puro, sin Firebase y con smokes.
3. **UI de las cuatro pestañas** (§6), con la migración de smokes del §8.
4. **QA y documentación**: verificación del §9 y actualización del estado de
   esta SPEC.

## 11. Preguntas abiertas

Siguen sin resolver aun con las cuatro decisiones del §2:

- **Q1. ¿Qué fecha define "el mes en que se registraron"?** HH y gastos tienen
  `fecha` (elegida por el usuario, obligatoria y validada en backend) y
  `creadoEn` (timestamp del sistema). Esta SPEC propone `fecha`, porque admite
  registrar a fin de mes un gasto ocurrido antes. Pero `fecha` puede ser
  retroactiva y mover resultados de meses ya revisados. Confirmar.
- **Q2. ¿Los montos de gastos y HH incluyen IVA?** **RESUELTA.** El dueño del
  negocio confirma que registra los gastos en neto.
  - Verificado en el código: el gasto persiste un único campo `monto`, que es
    exactamente el número que escribe el usuario
    (`functions/workPersistence.js`: `normalizeExpenseInput` y
    `registrarGastoTrabajoHandler`; `src/domain/workModel.mjs`:
    `adaptWorkExpense`). No existen campos `neto`, `iva` ni `total` en
    `trabajos/{id}/gastos`, y el formulario (`src/pages/WorksPage.jsx`, input
    "Monto") no muestra desglose neto/IVA.
  - El sistema **no calcula IVA de gastos** en ningún punto, ni persistido ni
    visual. La base neta del costo depende de la convención de registrar
    `monto` en neto, no de un cálculo del sistema.
  - HH: `total = horas × costoHora`, sin IVA. No requiere ajuste.
  - **Ajuste menor en la implementación:** rotular el input de gasto como
    "Monto neto (sin IVA)" para que la convención quede explícita en la UI. No
    se agregan campos, no cambia el modelo persistido y no hay migración.
- **Q3. Ventas legacy sin `neto` válido.** **RESUELTA.** El dueño del negocio
  confirma que la base de datos se reseteará por completo antes de que Bagner
  use el sistema para decisiones reales.
  - El reseteo puede ocurrir antes o después de implementar esta SPEC; el
    orden es indiferente. Lo que importa es que, al hacer el reseteo, todavía
    no existe ningún dato real de Bagner.
  - Por eso no existe el escenario de "Proyectos históricos de Bagner que
    cambian de número sin aviso" que motivaba la advertencia del §7.3. Tampoco
    habrá Ventas reales legacy sin `neto`: toda Venta creada después del
    reseteo pasa por `crearVenta`, que persiste `neto`.
  - La regla del §7.1.2 (no usar `total` como respaldo y contar
    `fuentes.ventasSinNetoValido`) se conserva como defensa, y la alerta A3 se
    conserva por la misma razón. En la práctica no deberían activarse con
    datos de Bagner.
- **Q4. Lista de alertas.** La investigación previa que propuso las alertas
  no está en el repositorio. El §6.2 la deriva de señales existentes.
  Confirmar o completar la lista. Candidata adicional: adicionales
  `PENDIENTE_COBRO` con material ya consumido.
- **Q5. Contenido de las pestañas que desaparecen.** "Valor más alto de
  inventario" y "Distribución por categoría"
  (`getInventoryTopValueProducts`, `getInventoryCategoryDistribution`) solo
  se muestran hoy en Reportes > Inventario, y la tabla por Proyecto en
  Reportes > Proyectos. ¿Se eliminan (AGENTS.md exige autorización explícita
  para eliminar funcionalidad) o se trasladan, por ejemplo la tabla por
  Proyecto al desglose de Ganancias y las métricas de inventario a
  `/inventario`?
- **Q6. Cliente de un Proyecto en "margen por cliente".** Se propone el
  `clienteId` del Proyecto. Las Ventas del Proyecto podrían tener otro cliente.
  Confirmar.
- **Q7. Universo de "margen bruto por producto".** Se propone solo Ventas sin
  Proyecto, por coherencia con la suma. La alternativa es todas las Ventas con
  productos, como análisis aparte que no reconcilia con la ganancia.
- **Q8. Bases distintas en pantalla.** Las pestañas Ventas y Compras muestran
  `total` (con IVA) y la ganancia usa `neto`. ¿Se rotulan explícitamente
  "con IVA" o se cambian a neto (sería otro cambio numérico, fuera de esta
  SPEC)?

## 12. Riesgo

**MEDIO** (antes ALTO; reevaluado tras resolver Q2 y Q3).

- **Qué baja el riesgo:** el riesgo ALTO venía de que cifras ya vistas por el
  negocio cambiaran sin aviso en Proyectos históricos. El reseteo completo de
  la base antes del uso real (Q3) elimina ese escenario: Bagner nunca verá un
  balance calculado con `total` que luego cambie a `neto`. Q2 confirma que los
  costos se registran en la misma base neta que el ingreso.
- **Qué sigue siendo un cambio real:**
  - La fórmula del balance cambia: ingreso neto y asignación mensual.
  - El contrato de `obtenerBalanceTrabajo` se amplía con `desglosePorMes`,
    `fuentes.ventasSinNetoValido`, `fuentes.registrosSinFecha` y la versión 3
    del modelo.
  - Por primera vez se suman dos universos económicos.
  - La base neta de los gastos depende de una convención de registro, no de
    un cálculo del sistema (Q2).
- **QA cuidadoso que exige:**
  - smokes de balance con casos de `neto`, cortes de mes y reconciliación entre
    mensual y acumulado;
  - verificación de que ninguna Venta aporta por dos vías;
  - revisión manual de `/trabajos` y de las 4 pestañas de `/reportes` con
    datos de prueba que cubran Proyectos con costos y Venta en meses
    distintos.
- Mitigaciones que se mantienen: ausencia de persistencia y backfill,
  cobertura conservadora y smokes que prohíben el wording sin calificar.
