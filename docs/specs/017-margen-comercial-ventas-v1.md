# SPEC 017 — Margen comercial de Ventas V1

## 1. Propósito y estado

Definir un primer cálculo histórico, pequeño y verificable del margen comercial
de productos vendidos, consumiendo los snapshots económicos cerrados en BRUNO C.
Esta SPEC describe el contrato **implementado y validado** de
`MARGEN_COMERCIAL_VENTAS_V1`.

- Fecha conceptual: 2 de septiembre de 2026.
- Estado: implementada; QA final completado el 2 de septiembre de 2026.
- Alcance: Core de ValoraCloud; excluye verticales estudiantiles.
- Precedencia: `AGENTS.md` y SPEC 016 conservan autoridad. Esta SPEC concreta
  únicamente el punto pendiente de margen comercial de Ventas V1.
- Principio: consumir historia autoritativa; no revalorizar una Venta desde el
  maestro vivo ni rediseñar la economía Q/V.

## 2. Comportamiento actual auditado

### Creación y estados

- Una Venta directa nace `borrador`; Functions asigna número, snapshots de
  empresa, cliente e ítems, moneda y totales. Sólo el borrador directo se edita.
- Confirmar una Venta directa exige stock completo y costo confiable para cada
  producto. La operación confirma la Venta, descuenta Q/V y guarda sus efectos
  en una transacción idempotente.
- Aceptar una Cotización crea directamente una Venta `confirmada`. Si falta
  stock, conserva la aceptación y puede quedar `parcial_pendiente` o
  `pendiente_abastecimiento` con cantidades explícitas.
- Servicios y actividades forman parte de la Venta, pero no mueven inventario.
- Una Venta `cancelada` se conserva. En el flujo vigente, una Venta confirmada
  desde Cotización puede revertir exactamente sus efectos; un borrador puede
  cancelarse sin efectos físicos. No hay eliminación física.

Los estados canónicos son `borrador`, `confirmada` y `cancelada`. Para lectura
legacy, los alias ya reconocidos por Reportes (`confirmado`, `activa`, `activo`)
se tratarán como confirmados y de sólo lectura; no se reescribirán documentos.

### Líneas, descuentos y totales

Cada línea congela `lineaId`, `itemId`, código, nombre, descripción, tipo,
unidad, cantidad, precio unitario, descuento porcentual y totales de línea,
además de `inventarioSnapshot` cuando corresponde.

El contrato actual es:

```text
subtotalLinea = round(cantidad × precioUnitario)
descuentoLinea = round(subtotalLinea × descuentoPct / 100)
totalLinea = subtotalLinea - descuentoLinea

subtotal = suma(subtotalLinea)
descuentoItems = suma(descuentoLinea)
neto = subtotal - descuentoItems - descuentoGeneral
total = neto + impuesto existente de la Venta
```

V1 no cambia esas reglas ni introduce tratamiento tributario.

### Efecto económico BRUNO C

Por cada cantidad física efectivamente salida, `efectosInventario` congela:

- `itemId`, `lineaId` y `movimientoId`;
- `cantidad` y, en Ventas desde Cotización, `cantidadSolicitada`;
- snapshot mínimo del producto;
- `costoUnitario`, `costoTotal`, `costoFuente`, `moneda` y
  `costoHistoricoDisponible`.

`costoTotal` es la fuente monetaria autoritativa para margen. No se recalcula
como `cantidad × costoUnitario`: cuando una salida cierra el stock, BRUNO C
retira el valor Q/V restante y ese cierre puede contener redondeo legítimo.

Al cancelar, `efectosInventarioReversa` repone el mismo costo. La reversa no
convierte una cancelación en ingreso ni genera margen negativo.

## 3. Información disponible y faltante

### Ya congelado y suficiente para una Venta nueva completa

- precios, cantidades y descuentos por línea;
- descuento general y `neto` de la Venta;
- moneda y localización histórica;
- tipo de cada ítem y snapshots comerciales;
- costo total histórico de cada salida de producto;
- cantidades solicitadas/aplicadas y estado de abastecimiento;
- estado, vínculo opcional con Cotización/Proyecto y reversa.

### No disponible o no confiable en todos los registros

- costo de prestación de servicios o actividades;
- costo de productos legacy sin efecto económico congelado;
- costo de cantidades vendidas pero todavía no salidas por abastecimiento
  parcial;
- una métrica persistida de margen y la asignación del descuento general entre
  productos y no productos.

V1 deriva la asignación y el margen en lectura. No persiste un nuevo snapshot,
no migra Ventas y no completa datos faltantes desde Inventario.

## 4. Nombre y significado de la métrica

La UI usará **Margen bruto de productos**. No se denomina utilidad, ganancia
empresarial, margen neto ni resultado de Proyecto.

La métrica responde:

> ¿Cuánto queda del ingreso comercial neto asignado a productos después de
> restar el costo histórico de los productos físicamente vendidos?

No incorpora costo de servicios, horas hombre, gastos, compras del período,
impuestos nuevos ni costos del Proyecto.

## 5. Fórmula V1

Para una Venta confirmada con detalle completo:

```text
subtotalProductos = suma(subtotalLinea de tipo producto)
descuentoItemsProductos = suma(descuentoLinea de tipo producto)
baseProductos = subtotalProductos - descuentoItemsProductos

baseVenta = subtotal - descuentoItems

descuentoGeneralProductos =
  baseVenta > 0
    ? round(descuentoGeneral × baseProductos / baseVenta)
    : 0

ingresoNetoProductos = baseProductos - descuentoGeneralProductos

costoMercaderiaVendida = suma(efecto.costoTotal válido y no duplicado)

margenBrutoProductos = ingresoNetoProductos - costoMercaderiaVendida

margenBrutoPct =
  ingresoNetoProductos > 0
    ? round2(margenBrutoProductos / ingresoNetoProductos × 100)
    : null
```

Reglas:

1. Los descuentos de línea ya pertenecen a su línea.
2. El descuento general se reparte proporcionalmente entre la base de productos
   y la base de servicios/actividades. El redondeo usa la unidad monetaria que
   ya emplea la Venta; el remanente pertenece a la porción no producto.
3. `ingresoNetoProductos` no incluye el impuesto existente de la Venta.
4. `costoMercaderiaVendida` suma `costoTotal`; nunca consulta `costoBase`,
   `costoPromedio`, `ultimoCosto`, adquisiciones ni el inventario actual.
5. El margen en dinero admite valores negativos.
6. Si el ingreso neto de productos es cero, el margen en dinero puede existir,
   pero el porcentaje es `null`; nunca produce `NaN` o infinito.
7. Dinero de margen/costo se normaliza a dos decimales. El porcentaje se
   redondea a dos decimales. No se convierte moneda.

El panel puede mostrar como contexto `neto` y `total` ya existentes, pero esos
campos no forman parte de una nueva fórmula tributaria.

## 6. Cobertura y estados del cálculo

El helper puro devolverá un estado explícito y `incluible: true` sólo para
`COMPLETO`:

- `PENDIENTE`: Venta en borrador; no hay margen histórico.
- `ANULADA`: Venta cancelada; no aporta margen y los importes de margen son
  `null`.
- `NO_APLICA`: Venta confirmada compuesta únicamente por servicios/actividades;
  V1 no asume costo cero.
- `COMPLETO`: cada línea de producto está cubierta por efectos históricos
  válidos por toda su cantidad.
- `PARCIAL`: existe costo confiable para una parte, pero no para toda la cantidad
  de productos. Puede informarse costo/cantidad cubierta como diagnóstico, pero
  no se publica un margen monetario ni porcentual.
- `NO_DISPONIBLE`: Venta confirmada de productos sin detalle o sin ningún costo
  histórico confiable.
- `INCONSISTENTE_MONEDA`: un efecto declara una moneda distinta de la Venta; no
  se convierte ni se calcula margen.

### Validación de cobertura

- Los efectos se relacionan por `lineaId` e `itemId` y se deduplican por
  `movimientoId`; si falta, se usa una clave estable de Venta/línea/posición.
- La suma de cantidades cubiertas por línea debe igualar la cantidad vendida,
  con la precisión canónica máxima de seis decimales de BRUNO C.
- Un costo es válido si `costoHistoricoDisponible` no es `false` y
  `costoUnitario`/`costoTotal` son números finitos no negativos. Esta regla
  conserva compatibilidad con snapshots antiguos que tenían importes pero no la
  bandera explícita, igual que el balance vigente de Proyectos.
- Una moneda ausente en un efecto legacy hereda la moneda de su Venta. Una
  moneda explícita diferente produce `INCONSISTENTE_MONEDA`.
- Un efecto duplicado, huérfano, con cantidad excesiva o costo inválido impide
  declarar cobertura completa.
- `stockAplicado` por sí solo no demuestra cobertura: una Venta desde Cotización
  puede tener efectos parciales. Se revisan líneas, efectos y cantidades.

## 7. Servicios, actividades y Ventas mixtas

- Servicios y actividades participan en `subtotal`, descuentos, `neto` y
  `total` existentes de la Venta.
- No participan en `costoMercaderiaVendida` ni en el ingreso neto de productos.
- Una Venta sólo de servicios/actividades queda `NO_APLICA`.
- Una Venta mixta puede quedar `COMPLETO` para productos; su panel debe aclarar
  que no evalúa rentabilidad de servicios, HH ni gastos.
- No se utiliza `costoBase` de un servicio como costo histórico de prestación.

## 8. Cancelaciones y vínculo con Proyectos

- Borradores y cancelaciones nunca son incluibles. No se resta una cancelación
  como margen negativo y no se suma su reversa como ingreso.
- El detalle de una Venta cancelada muestra únicamente que no aporta margen.
- Una Venta confirmada vinculada a Proyecto puede mostrar su margen individual:
  ello no duplica nada mientras no exista agregación.
- V1 no suma margen de Ventas con `resultado` de Proyectos. Reports V4 deberá
  mantener ambas métricas separadas y definir su futura agregación explícita.

## 9. Presentación V1 y permisos

### Imprescindible

Sólo el detalle `/ventas/{ventaId}` mostrará un panel de lectura con:

- estado de cobertura;
- ingreso neto asignado a productos;
- costo histórico de productos vendidos;
- margen bruto de productos;
- margen bruto porcentual;
- aviso para Venta mixta, parcial, legacy, anulada o con moneda inconsistente.

El panel se renderiza únicamente si el perfil posee el permiso existente
`profitability.read` (OWNER, ADMIN, FINANZAS o perfil personalizado que lo
incluya). No se crea un permiso nuevo.

Este guard es de presentación, no una nueva frontera de datos: las Rules actuales
ya entregan la Venta completa, incluidos sus efectos, a los perfiles con acceso
a Ventas/Reportes. V1 no amplía esa exposición. Separar físicamente costos para
lograr confidencialidad de campo sería otro bloque y no debe ocultarse dentro de
esta implementación.

### Diferido

- listado/historial de Ventas;
- Dashboard;
- agregación o tarjetas de Reportes;
- exportación/CSV/PDF.

## 10. IN_SCOPE

- helper de dominio puro y reutilizable;
- margen bruto de productos por Venta confirmada;
- descuentos de línea y asignación proporcional del descuento general;
- estados de cobertura, legacy, cancelación y moneda;
- presentación mínima en detalle con `profitability.read`;
- pruebas determinísticas y actualización documental del contrato.

## 11. OUT_OF_SCOPE

- persistir margen, migrar o reescribir Ventas;
- cambiar Functions de Ventas, el saldo Q/V o sus snapshots;
- costo/rentabilidad de servicios y actividades;
- contabilidad formal, utilidad neta empresarial o flujo de caja;
- gastos operacionales, HH, pagos, cuentas por cobrar o movimientos financieros;
- impuestos nuevos, reinterpretación de IVA o integración SII;
- nuevas monedas, FX o suma entre monedas;
- Reports V4, salvo dejar el helper reutilizable;
- cambios al balance de Proyectos o agregación anti-doble contabilización;
- módulos verticales de estudiantes;
- IA.

## 12. Impacto técnico implementado

### Frontend

- `src/domain/saleCommercialMargin.mjs`: cálculo y estados puros, sin Firebase.
- `src/domain/saleModel.mjs`: adaptación de sólo lectura de los aliases legacy
  `confirmado`, `activa` y `activo` a `confirmada`; sin reescribir documentos ni
  cambiar totales persistidos.
- `src/features/sales/SaleCommercialMarginPanel.jsx`: presentación conservadora
  de estados e importes.
- `src/pages/NewSalePage.jsx`: render sólo en `/ventas/{ventaId}`.
- `src/features/sales/sales.css`: estilos acotados al panel y su responsive.
- `src/domain/rbac.mjs`: se consume `profitability.read` sin modificar su matriz.

### Backend y datos

- Functions afectadas: **ninguna**.
- Colecciones nuevas: **ninguna**.
- Documentos/campos Firestore nuevos: **ninguno**.
- Índices: **ninguno**.
- `firestore.rules` / `storage.rules`: **sin cambios**.
- `firebase.json`: **sin cambios**.

Se leen únicamente campos ya presentes en
`negocios/{businessId}/ventas/{ventaId}`. `functions/salePersistence.js`,
`functions/inventoryAcquisition.js` y `functions/workBalance.js` se consideran
fuentes auditadas y no fueron modificadas por V1. La lectura del documento
completo de Venta y la exposición de `efectosInventario` a perfiles con acceso a
Ventas ya existían antes de este bloque; el panel no agrega datos a la respuesta.

### Documentación y pruebas

- `scripts/sale-commercial-margin-smoke.mjs`: contrato económico, cobertura,
  legacy, estados y anomalías.
- `scripts/sale-commercial-margin-ui-smoke.mjs`: render SSR, RBAC, estados,
  importes grandes y contrato responsive.
- `test:sales-margin`: ejecuta ambos smokes sin debilitar el smoke puro.
- Regresión validada con `sale-model-smoke.mjs`, `sales-integrated-local.mjs`,
  `report-model-smoke.mjs`, smokes Q/V relacionados, lint y build.
- Reports V4 permanece diferido y no se presenta como implementado.

## 13. Etapas de implementación

### ETAPA 1 — Contrato y cálculo puro — COMPLETADA

Se creó el helper sin UI ni Firebase. Cubre fórmula base, descuentos, redondeo,
costos por `costoTotal`, productos/servicios y porcentaje cero/negativo.

### ETAPA 2 — Cobertura, legacy y estados — COMPLETADA

Se agregaron deduplicación, cobertura por cantidad/línea, aliases legacy,
moneda, parcialidad, borrador y cancelación. No existen backfills.

### ETAPA 3 — UI mínima y permiso — COMPLETADA

El panel quedó integrado sólo en el detalle, usando `profitability.read`, con
textos que distinguen margen de productos de rentabilidad de servicios/Proyecto.

### ETAPA 4 — Regresión y documentación — COMPLETADA

Se ejecutaron smokes de margen/Ventas/Reportes, integrado de Ventas en
emuladores, build, lint de Functions y `git diff --check`. Esta SPEC refleja el
estado final sin declarar Reports V4 como implementado.

No existe una etapa de persistencia: V1 es deliberadamente derivada.

## 14. Casos mínimos de prueba

1. Venta confirmada sólo de productos, costo completo y descuento cero.
2. Descuentos por línea y general en Venta sólo de productos.
3. Venta mixta: reparto proporcional del descuento general y exclusión de
   servicios/actividades.
4. Venta sólo de servicios/actividades: `NO_APLICA`.
5. Producto gratuito con costo: margen negativo y porcentaje `null`.
6. Efecto de cierre Q/V donde `costoTotal` difiere de cantidad por costo unitario.
7. Cotización con abastecimiento parcial: `PARCIAL`, sin margen publicado.
8. Legacy con importes congelados y bandera ausente: compatible.
9. Legacy sin efectos/costo histórico: `NO_DISPONIBLE`, sin consultar Inventario.
10. Efecto duplicado, huérfano o con cantidad excesiva: no queda `COMPLETO`.
11. Moneda explícita diferente: `INCONSISTENTE_MONEDA`.
12. Borrador y cancelada: no incluibles.
13. Venta vinculada a Proyecto: muestra margen individual sin agregar resultados.
14. Perfil sin `profitability.read`: panel ausente.

## 15. Criterios de aceptación

- Una Venta confirmada y totalmente cubierta produce valores determinísticos
  desde sus snapshots, sin lecturas al maestro actual.
- El costo usa la suma de `efectosInventario[].costoTotal` y conserva cierres Q/V.
- Los descuentos se reflejan exactamente según la fórmula V1.
- Servicios/actividades nunca se interpretan como costo cero.
- Parciales, legacy incompleto, cancelaciones y monedas incompatibles no exponen
  un margen numérico engañoso.
- No se persisten campos ni se crean Functions, Rules, índices o migraciones.
- La UI aparece sólo en el detalle y con `profitability.read`.
- No se muestra utilidad general ni se combina margen con resultado de Proyecto.
- Smokes, integrado de Ventas, build, lint y `git diff --check` quedan verdes.

## 16. Riesgo

**MEDIO.** No modifica stock ni persistencia y reutiliza snapshots autoritativos,
pero comunica una cifra económica. Los riesgos principales son asignar mal el
descuento general, declarar cobertura completa con datos parciales o confundir
margen de productos con utilidad/rentabilidad total. Los estados conservadores,
la ausencia de backfill y la UI acotada reducen esos riesgos.
