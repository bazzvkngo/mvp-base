# SPEC 023 — Costo neto e IVA de compra

## 1. Propósito y estado

Corregir la base de costo de ValoraCloud para que la ganancia se calcule con
**costo neto**: el IVA de una compra con factura es crédito fiscal y no es
costo. Solo dos excepciones convierten lo pagado completo en costo: la compra
con boleta y el producto exento de IVA.

- Fecha conceptual: 8 de octubre de 2026.
- Estado: aprobada; implementación pendiente. Las decisiones D1 a D6 son
  definitivas. La decisión P1 y la regla del §9.3 son **provisionales**:
  decididas por el desarrollador en ausencia del dueño, a confirmar con él al
  volver.
- Alcance: Core de ValoraCloud (Inventario, Compras, Recepciones, gastos de
  Proyecto). Las verticales estudiantiles quedan excluidas.
- Origen: decisiones del dueño del negocio piloto (Bagner), §2.
- Precedencia: `AGENTS.md` conserva autoridad máxima. Esta SPEC sustituye
  únicamente los puntos de SPEC 003, 006, 011, 012, 017, 018 y 022 que la
  tabla del §4 marca como reemplazados; todo lo demás sigue vigente.

## 2. Decisiones

### 2.1 Decisiones del dueño del negocio (definitivas)

Estas decisiones no se reabren en la implementación:

- **D1. Ganancia con costo neto.** El IVA de compra se recupera como crédito
  fiscal y no es costo.
- **D2. Excepciones donde lo pagado completo es costo.**
  - a) Compra con `tipoDocumento: "boleta"`: el monto ingresado ya incluye IVA
    y el sistema no suma IVA. Hoy suma 19 % encima; es un error que esta SPEC
    corrige.
  - b) Producto marcado "Exento de IVA" con un check en la ficha. La marca se
    apoya en `impuestoId`, que hoy nadie lee (§6.1).
  - No existe marca por línea ni por proveedor: se compra casi siempre con
    factura y la boleta es puntual.
- **D3. Ficha del producto.** Muestra el costo neto y, como dato informativo,
  el costo con IVA.
- **D4. Costo neto en todos los canales.** `ultimoCosto` y el saldo inicial de
  productos creados o importados con stock se guardan en neto (salvo exentos,
  cuyo costo no lleva IVA), igual en todos los canales de creación.
- **D5. Solo hacia adelante.** Sin migración ni recálculo de lo guardado. Se
  mantiene el principio de no revalorizar Ventas (SPEC 017).
- **D6. Costo del inventario.** El indicador "Costo del inventario" de
  `/inventario` pasa a usar el costo promedio neto, con respaldo definido para
  productos sin movimientos (§7).

### 2.2 Decisiones provisionales

Las tomó el desarrollador en ausencia del dueño. Se implementan, pero quedan
**a confirmar con el dueño al volver**:

- **P1. Precio de venta sugerido y `precioInterno` sobre costo neto.** El
  precio sugerido se calcula sobre el costo neto, no sobre el costo con IVA
  (§6.4).
- **P2. Gastos `MATERIAL` con documento siempre suman al costo del
  Proyecto**, aunque exista libro de materiales (§9.3).

### 2.3 Pendiente

- **Reseteo de la base de datos de prueba** antes de cargar datos reales de
  Bagner. Es requisito para que D5 no deje datos mezclados (§8). Sigue
  pendiente y se planificará en una tarea aparte.

## 3. Diagnóstico del comportamiento actual

1. **Compras y Recepciones suman el IVA al costo de inventario.**
   `calculateAcquisitionAmounts` (`functions/inventoryAcquisition.js:66-92`)
   recibe `tasaImpuestoCompra = tasaIva × 100` desde la confirmación de
   Compra (`functions/purchasePersistence.js:666-671`) y de Recepción
   (`functions/receptionPersistence.js:596-604`). Al saldo Q/V entra
   `costoPagadoTotal` (neto + IVA). `costoPromedio` y `ultimoCosto` quedan con
   IVA.
2. **La boleta recibe 19 % encima.** `totals()`
   (`functions/purchasePersistence.js:188-195`) y su espejo
   `calculatePurchaseTotals` (`src/domain/purchaseModel.mjs:140-149`) calculan
   `iva = round(neto × tasa)` sin mirar `tipoDocumento`. La confirmación usa la
   misma tasa. Una boleta de 8.330 queda como compra de 9.913 y entra al
   inventario por 9.912,7.
3. **La exención no existe en el cálculo.** `getInventoryTaxFields`
   (`functions/inventoryModel.js:297-304`) escribe `impuestoId` e
   `impuestoTasa` al crear un producto, tomados de la configuración del
   negocio. No es editable y ningún cálculo de compra, recepción ni ficha lo
   lee.
4. **La formación de precio infla el precio con el IVA de compra.** Con
   `formacionPrecioVersion = 2`, `precioVentaSugerido = costoBase × (1 + tasa)
   × (1 + recargo)` (`functions/inventoryModel.js:197-215`,
   `src/domain/inventoryMvp.mjs:128-153`). `precioInterno` es un precio neto: la
   Venta suma IVA después. El IVA queda contado dos veces en el precio final.
5. **El saldo inicial depende del canal de creación.** El baseline se escribe
   de forma lazy en la primera operación de stock
   (`resolveInventoryEconomicState` → `legacyCostDescriptor`, en
   `functions/inventoryAcquisition.js:148-160`): usa `costoPagado` si existe y
   si no `costoBase × (1 + tasaImpuestoCompra)`. El alta manual propone tasa 0
   pero el usuario puede poner 19. La planilla solo fija tasa si trae la
   columna. El importador documental solo si el documento la muestra
   explícitamente. El mismo producto queda valorizado con o sin IVA según cómo
   se creó.
6. **"Costo del inventario" usa otro criterio que Reportes.**
   `summarizeInventory` (`src/domain/inventoryMvp.mjs:246-249`) suma
   `costoBase × stock`. Reportes (`getInventoryMetrics`,
   `src/domain/reportModel.mjs:513-531`) usa `costoPromedio ?? costoBase`.
   Las dos cifras no coinciden.

**Consecuencia sobre la ganancia.** El costo de una Venta se congela desde
`costoPromedio` (`functions/salePersistence.js:343-351`) y el de una salida de
material de Proyecto también (`functions/workPersistence.js:1677-1683`). Si el
promedio lleva IVA, el margen de Venta (SPEC 017) y el balance de Proyecto
(SPEC 022), que ya usan ingreso **neto**, comparan ingreso sin IVA con costo
con IVA y subestiman la ganancia.

## 4. Reemplaza / Se mantiene

Leyenda:

- **REEMPLAZADO**: esta SPEC sustituye el punto completo.
- **REEMPLAZADO PARCIALMENTE**: se indica qué parte cambia y qué parte sigue.
- **SE MANTIENE**: sigue vigente sin cambios.

### 4.1 SPEC 003 — Inventario MVP

| Punto | Texto vigente (resumen) | Decisión | Detalle |
| --- | --- | --- | --- |
| Modelo vigente: ledger de adquisiciones guarda "costo neto, descuento, impuesto, costo pagado" | Campos de adquisición | REEMPLAZADO PARCIALMENTE | **Sigue:** todos esos campos. **Se agrega:** `tratamientoIvaCompra`, `costoInventarioUnitario` y `costoInventarioTotal` (§10). |
| Economía: `costoBase` es "costo comercial/manual" | Significado de `costoBase` | REEMPLAZADO PARCIALMENTE | **Cambia:** `costoBase` es el **costo neto (sin IVA)** del maestro; en un producto exento es el costo pagado. **Sigue:** no cambia por adquisiciones. |
| Economía: `ultimoCosto` es "el costo pagado unitario de la última adquisición vigente" | Base de `ultimoCosto` | REEMPLAZADO PARCIALMENTE | **Cambia:** es el `costoInventarioUnitario` de esa adquisición (neto, o lo pagado en boleta/exento). **Sigue:** nunca se reemplaza por `costoBase` ni por el promedio; al revertir vuelve a la anterior demostrable. |
| Economía: `valorInventario`, `costoPromedio = V / Q`, reglas de cierre y precisión | Saldo Q/V | SE MANTIENE | Solo cambia el monto que entra en cada adquisición (§5.3). |
| Economía: Ventas y materiales congelan costo y sus cancelaciones/devoluciones reponen ese snapshot | Snapshot histórico | SE MANTIENE | Incluso para registros anteriores al cambio (§8). |
| Economía: baseline legacy "usa primero `costoPromedio` y, si falta, `legacyPaidCost`" | Fuente del baseline | REEMPLAZADO PARCIALMENTE | **Cambia:** sin promedio válido, el baseline usa `costoBase` (o `costo`/`precioCompra` legacy) **sin sumar tasa**; `costoPagado` deja de ser fuente (§6.3). **Sigue:** inicialización lazy, sin adquisición falsa ni migración. |
| Cálculo de precio: formación `formacionPrecioVersion = 2` (`costo pagado × (1 + recargo)`, tasa elegible 0 %, 19 % o personalizada) | Formación con IVA de compra | REEMPLAZADO (P1, provisional) | Nueva `formacionPrecioVersion = 3`: precio sugerido sobre costo neto; tasa por producto reemplazada por el check "Exento de IVA" y la tasa del negocio; costo con IVA solo informativo (§6). Los documentos v2 se leen como están. |
| Cálculo de precio: `precio calculado = costo base × (1 + recargo)` (legacy) | Fórmula sin IVA | SE MANTIENE | Coincide con la v3. |
| Importación local: "la plantilla conserva el esquema anterior sin inferir IVA de compra" | Planilla | REEMPLAZADO PARCIALMENTE | **Cambia:** `costoBase` se interpreta siempre como neto; la columna `tasaImpuestoCompra` deja de decidir la formación; se admite una columna opcional de exención (§6.5). **Sigue:** no se infiere IVA. |
| Compatibilidad legacy: "un producto sin `formacionPrecioVersion = 2` no recibe una tasa inferida" | Lectura legacy | SE MANTIENE | Ningún documento se reescribe al abrir la ruta. |

### 4.2 SPEC 006 — Compras MVP

| Punto | Texto vigente (resumen) | Decisión | Detalle |
| --- | --- | --- | --- |
| Cálculos: `iva = round(neto × 0.19)`, `total = neto + iva` | Totales | REEMPLAZADO PARCIALMENTE | **Cambia:** boleta → `iva = 0`, `total = neto`; líneas exentas fuera de la base de IVA y en `montoExento` (§5.2). **Sigue:** fórmulas por línea, redondeo, enteros seguros y recálculo autoritativo en Functions. |
| Confirmación: "suma el costo pagado al saldo perpetuo de valor" | Monto que entra a Q/V | REEMPLAZADO | Entra `costoInventarioTotal` (§5.3). |
| Confirmación: "actualiza último costo" | `ultimoCosto` | REEMPLAZADO PARCIALMENTE | Usa `costoInventarioUnitario`. |
| Confirmación: "no actualiza `costoBase`, `costoPagado` comercial, margen ni precio de venta" | Maestro intacto | SE MANTIENE | — |
| Reversión: "resta la cantidad y el costo pagado total original de la adquisición" | Monto que sale de Q/V | REEMPLAZADO PARCIALMENTE | **Cambia:** resta `costoInventarioTotal`; si la adquisición es anterior al cambio, resta su `costoPagadoTotal`, que es lo que entonces entró (§8.1). **Sigue:** bloqueos por stock, moneda, saldo negativo o residual; sin reversiones parciales. |
| Ruta legacy V1 sin `adquisicionId` (`reversalCost` recalcula desde la línea) | Reversión legacy | SE MANTIENE | Solo existen documentos anteriores; se recalculan con la fórmula con la que entraron. |
| `tipoDocumento` (`factura`, `boleta`, `otro`, `sin_documento`) | Dato del documento | REEMPLAZADO PARCIALMENTE | **Cambia:** `boleta` pasa a tener efecto económico. **Sigue:** `factura`, `otro` y `sin_documento` siguen la regla general de crédito fiscal (§5.1). |

### 4.3 SPEC 011 — Recepciones MVP

| Punto | Texto vigente (resumen) | Decisión | Detalle |
| --- | --- | --- | --- |
| Invariantes: "el promedio usa costo pagado unitario (neto tras descuento más impuesto de compra)" | Base del promedio | REEMPLAZADO | El promedio usa `costoInventarioUnitario` (§5.3, §5.4). |
| Invariantes: misma transacción actualiza stock, `valorInventario`, `costoPromedio`, `ultimoCosto`, `ultimoProveedor` | Atomicidad | SE MANTIENE | — |
| Compras y compatibilidad: la reversión "resta hoy de Q/V el costo pagado original" | Reversión | REEMPLAZADO PARCIALMENTE | Igual que SPEC 006 (§8.1). |
| Compras y compatibilidad: baseline legacy con "fallback `costoPagado` o `costoBase` con la tasa configurada" | Baseline | REEMPLAZADO | Igual que SPEC 003 (§6.3). |
| `costoBase` "no se modifica" en Recepción | Maestro intacto | SE MANTIENE | — |

### 4.4 SPEC 012 — Proyectos y trabajos MVP

| Punto | Texto vigente (resumen) | Decisión | Detalle |
| --- | --- | --- | --- |
| Costos reales / fase 3: gasto con `concepto`, `monto`, categoría, inmutable salvo anulación | Modelo del gasto | REEMPLAZADO PARCIALMENTE | **Se agrega** `tipoDocumento` (`factura` o `boleta`) que define qué significa `monto` (§9.2). **Sigue:** todo lo demás, incluida la inmutabilidad. |
| Materiales / fase 4: la salida congela `costoPromedio`, con `costoBase` y fallbacks de respaldo; la devolución usa el costo congelado | Costo de material | SE MANTIENE | El promedio ya será neto por construcción; la regla no cambia. |
| Balance / fase 5: con libro de materiales, los gastos `MATERIAL` "quedan informados pero excluidos del costo" | Exclusión de `MATERIAL` | REEMPLAZADO PARCIALMENTE (P2, provisional) | **Cambia:** un gasto `MATERIAL` con `tipoDocumento` siempre suma (§9.3). **Sigue:** los gastos `MATERIAL` legacy, sin `tipoDocumento`, quedan excluidos cuando existe libro de materiales. |
| Balance / fase 5: fórmula `costoTotal = materiales + HH + gastos` | Fórmula | SE MANTIENE | — |

### 4.5 SPEC 017 — Margen comercial de Ventas V1

| Punto | Texto vigente (resumen) | Decisión | Detalle |
| --- | --- | --- | --- |
| §1 Principio: "no revalorizar una Venta desde el maestro vivo" | No revalorizar | SE MANTIENE | D5. Las Ventas anteriores conservan su `costoTotal` (con IVA) y su margen. |
| §2 Efecto económico: `costoTotal` congelado es la fuente del margen; la cancelación repone el mismo costo | Snapshot y reversa | SE MANTIENE | Aplica también a Ventas anteriores al cambio (§8.2). |
| §5 Fórmula V1 (`margenBrutoProductos = ingresoNetoProductos − costoMercaderiaVendida`) | Fórmula | SE MANTIENE | El cálculo no cambia. En Ventas nuevas, `costoMercaderiaVendida` será neto porque el promedio lo es. |
| §11 OUT_OF_SCOPE: "cambiar Functions de Ventas, el saldo Q/V o sus snapshots" | Restricción | REEMPLAZADO PARCIALMENTE | **Cambia:** el monto que entra a Q/V por compras (§5.3). **Sigue:** Functions de Ventas y sus snapshots no se tocan. |
| §11 OUT_OF_SCOPE: "impuestos nuevos, reinterpretación de IVA o integración SII" | Restricción | REEMPLAZADO PARCIALMENTE | **Cambia:** el IVA de **compra** se reinterpreta como crédito fiscal (D1). **Sigue:** IVA de Venta, impuestos nuevos e integración SII fuera de alcance. |

### 4.6 SPEC 018 — Reportes de rentabilidad V4

| Punto | Texto vigente (resumen) | Decisión | Detalle |
| --- | --- | --- | --- |
| §2.4: el costo histórico proviene de `efectosInventario[].costoTotal`, nunca de `costoBase`, `costoPromedio`, `ultimoCosto` ni del inventario vigente | Fuente del costo | SE MANTIENE | Reportes no recalcula nada. |
| §2.9: "V4 no inventa impuestos, costos, pagos" | Principio | SE MANTIENE | Esta SPEC cambia la base del costo en origen, no en Reportes. |
| §4 tabla de fuentes: "Inventario Q/V … autoritativo para saldo vigente" | Saldo vigente | SE MANTIENE | Desde ahora en neto. |
| §4 tabla de fuentes: "Compra confirmada: `neto`, impuesto existente, `total`" | Documento de compra | REEMPLAZADO PARCIALMENTE | **Cambia:** en boleta `iva = 0` y `neto = total`; se agrega `montoExento`. **Sigue:** la Compra no equivale a gasto ni a costo de Venta. |
| §7 OUT_OF_SCOPE: "impuestos/IVA nuevos o uniformación tributaria general" | Restricción | SE MANTIENE | Esta SPEC no crea impuestos ni uniforma la tributación: solo define qué parte de una compra es costo. |

### 4.7 SPEC 022 — Rentabilidad en Reportes

| Punto | Texto vigente (resumen) | Decisión | Detalle |
| --- | --- | --- | --- |
| §11 Q2 (resuelta): "registra los gastos en neto"; `monto` único; "el sistema no calcula IVA de gastos" | Base de gastos | REEMPLAZADO PARCIALMENTE | **Cambia:** `monto` es el **costo** del gasto: neto con factura, total pagado con boleta (§9.2). **Sigue:** campo único `monto`, sin cálculo de IVA de gastos. |
| §11 Q2: "rotular el input de gasto como 'Monto neto (sin IVA)'" | Rótulo | REEMPLAZADO | El rótulo depende del tipo de documento (§9.2). |
| §11 Q3: reseteo completo de la base antes del uso real | Reseteo | SE MANTIENE | Es el mismo reseteo del §2.3. Sigue pendiente; se planificará en una tarea aparte. |
| §2.3 (de SPEC 020, reemplazado por 022): "no se agrega ninguna fuente ni se quita ninguna" | Fuentes de costo | REEMPLAZADO PARCIALMENTE (P2, provisional) | **Cambia:** cuáles gastos `MATERIAL` se incluyen (§9.3). **Sigue:** no se agrega ni se quita ninguna fuente. |
| §6.3 nota "ambos montos incluyen IVA" en Ventas vs Compras | Nota de Reportes | SE MANTIENE | El gráfico sigue usando `total`. |
| §4 fórmula de ganancia neta operacional | Fórmula | SE MANTIENE | Sus costos pasan a ser netos en origen. |

## 5. Reglas de cálculo de compras

### 5.1 Tratamiento de IVA por línea

Cada línea de producto de una Compra o Recepción recibe un tratamiento, que
resuelve el backend:

```text
tratamientoIvaCompra =
  "boleta"          si documento.tipoDocumento === "boleta"
  "exento"          si línea.impuestoId ∈ {"IVA_EXENTO", "SIN_IMPUESTO"}
  "credito_fiscal"  en cualquier otro caso
```

- La boleta prevalece sobre la exención; el efecto es el mismo.
- `factura`, `otro` y `sin_documento` siguen la regla general. `sin_documento`
  es el valor por defecto de una Compra creada desde una OC antes de recibir la
  factura (`functions/purchasePersistence.js:400`); tratarla como boleta
  valorizaría con IVA compras formales.
- La tasa es la del documento (`compra.tasaIva` o `recepcion.tasaIva`, snapshot
  de la localización del negocio).

**Convención de ingreso.** En `credito_fiscal` y `exento`, `costoUnitario` es
el precio sin IVA. En `boleta`, `costoUnitario` es el **precio pagado, IVA
incluido**. Por eso, en los tres casos, lo que entra al inventario es el valor
de la línea después del descuento. Lo que cambia es si el documento suma IVA
encima.

### 5.2 Totales del documento

```text
subtotalLinea = round(cantidad × costoUnitario)                (sin cambios)
descuentoLinea = round(subtotalLinea × descuentoPct / 100)     (sin cambios)
totalLinea = subtotalLinea − descuentoLinea                    (sin cambios)

subtotal       = Σ subtotalLinea
descuentoTotal = Σ descuentoLinea
neto           = subtotal − descuentoTotal
montoExento    = Σ totalLinea de líneas con tratamiento "exento"
iva            = 0                                    si tipoDocumento = "boleta"
               = round((neto − montoExento) × tasa)   en otro caso
total          = neto + iva
```

En boleta, `neto` y `total` son iguales al monto pagado e `iva = 0`. Ese cero
significa "sin IVA recuperable", no que la boleta no tenga IVA. Servicios y
actividades siguen la misma regla del documento.

Functions recalcula los totales al crear y al actualizar el borrador. El
frontend (`calculatePurchaseTotals`) replica la fórmula solo para la vista
previa.

### 5.3 Entrada al inventario

Por línea de producto, en la confirmación de Compra directa y de Recepción:

```text
costoUnitarioNeto       = round4(costoUnitario × (1 − descuentoPct / 100))
impuestoCompraUnitario  = round4(costoUnitarioNeto × tasa)  si "credito_fiscal"
                        = 0                                 si "boleta" o "exento"
costoPagadoUnitario     = costoUnitarioNeto + impuestoCompraUnitario  (informativo)
costoInventarioUnitario = costoUnitarioNeto
costoInventarioTotal    = round2(costoInventarioUnitario × cantidad)
```

- Al saldo Q/V entra `costoInventarioTotal`.
- `ultimoCosto = costoInventarioUnitario`.
- El movimiento `entrada_compra` / `entrada_recepcion` guarda
  `costoUnitarioAplicado = costoInventarioUnitario` y
  `costoTotal = costoInventarioTotal`.
- `impuestoCompraTotal` queda en la adquisición como dato informativo del
  crédito fiscal. No se acumula ni se informa en ningún resumen (el resumen
  mensual de IVA está fuera de alcance).

**Origen de `impuestoId` de la línea.** Al crear o actualizar un borrador de
Compra, Functions copia el `impuestoId` vigente del producto a la línea. La
confirmación usa esa copia, que es la misma que usaron los totales. Una línea
sin `impuestoId` (documentos anteriores) se trata como no exenta.

### 5.4 Recepciones

- La Recepción toma el tipo de documento de `documentoOrigen.tipoDocumento`.
  Sin documento importado se aplica la regla general.
- El `impuestoId` de cada línea se lee del producto en la confirmación, dentro
  de la misma transacción que ya lee el inventario.
- La Compra que nace confirmada desde la Recepción hereda el mismo
  `tipoDocumento`, así que sus totales y el valor que entró a Q/V coinciden.
- Recepciones con boleta son improbables (el flujo OC → Recepción es formal).
  La regla existe para que el resultado sea coherente si ocurren.

### 5.5 Ejemplos numéricos (tasa 19 %)

**Ejemplo A — Factura.** 10 rollos de cable a 10.000 c/u, sin descuento.

| Concepto | Hoy | Con esta SPEC |
| --- | --- | --- |
| Documento: neto / IVA / total | 100.000 / 19.000 / 119.000 | 100.000 / 19.000 / 119.000 |
| Entra a `valorInventario` | 119.000 | **100.000** |
| `costoPromedio` (sin stock previo) | 11.900 | **10.000** |
| `ultimoCosto` | 11.900 | **10.000** |
| Adquisición: `impuestoCompraTotal` | 19.000 | 19.000 (informativo) |

**Ejemplo B — Boleta.** 2 tubos PVC a 4.165 c/u, precio pagado con IVA.

| Concepto | Hoy | Con esta SPEC |
| --- | --- | --- |
| Documento: neto / IVA / total | 8.330 / 1.583 / 9.913 (error) | 8.330 / **0** / **8.330** |
| Entra a `valorInventario` | 9.912,7 | **8.330** |
| `ultimoCosto` | 4.956,35 | **4.165** |

**Ejemplo C — Producto exento en factura.** 5 unidades de un producto exento
a 4.000 c/u.

| Concepto | Hoy | Con esta SPEC |
| --- | --- | --- |
| Documento: neto / IVA / total | 20.000 / 3.800 / 23.800 | 20.000 / **0** / **20.000** (`montoExento` 20.000) |
| Entra a `valorInventario` | 23.800 | **20.000** |
| `ultimoCosto` | 4.760 | **4.000** |

**Ejemplo D — Factura mixta** (A + C en el mismo documento).

```text
neto        = 100.000 + 20.000 = 120.000
montoExento = 20.000
iva         = round((120.000 − 20.000) × 0,19) = 19.000
total       = 139.000                       (hoy: 120.000 + 22.800 = 142.800)
inventario  : cable +100.000; producto exento +20.000
```

**Ejemplo E — Efecto en el margen.** Con el cable del Ejemplo A se venden
4 rollos a 15.000 neto c/u (ingreso neto 60.000).

| Concepto | Hoy | Con esta SPEC |
| --- | --- | --- |
| `costoTotal` congelado | 47.600 | 40.000 |
| Margen bruto | 12.400 (20,7 %) | 20.000 (33,3 %) |

## 6. Ficha del producto y canales de creación

### 6.1 Marca "Exento de IVA"

- La ficha de un producto agrega el check **"Exento de IVA"**.
- Se persiste en el campo existente `impuestoId`: marcado → `IVA_EXENTO`;
  desmarcado → `IVA_GENERAL`. `impuestoTasa` se mantiene coherente (0 o la
  tasa del negocio). No se crea un segundo campo para el mismo concepto.
- Un producto legacy con `SIN_IMPUESTO` se muestra marcado y se trata como
  exento. Desmarcarlo escribe `IVA_GENERAL`.
- Al crear, el valor inicial sigue saliendo de la configuración de impuestos
  del negocio (`getInventoryTaxFields`); el check lo puede cambiar. Para Bagner
  el valor inicial es `IVA_GENERAL`.
- `updateInventoryItem` pasa a aceptar el cambio de `impuestoId` con
  validación autoritativa. Solo aplica a `tipoItem: "producto"`.
- Cambiar la marca no reescribe Compras en borrador ya creadas: cada línea
  conserva la copia del §5.3 hasta que el borrador se vuelva a guardar.

### 6.2 Costo neto y costo con IVA (D3)

Con `formacionPrecioVersion = 3`:

```text
costoBase           = costo neto (sin IVA); en exento, costo pagado
tasaImpuestoCompra  = 0 si exento; tasa del negocio × 100 en otro caso   (derivada)
montoImpuestoCompra = round(costoBase × tasaImpuestoCompra / 100)        (informativo)
costoPagado         = costoBase + montoImpuestoCompra                    (informativo: "Costo con IVA")
```

- El formulario rotula el campo como **"Costo neto (sin IVA)"**, o **"Costo
  (exento de IVA)"** si el check está marcado.
- La ficha muestra "Costo neto" y, debajo, "Costo con IVA (referencia)". En un
  exento muestra "Exento: no lleva IVA".
- El input de tasa por producto (0 %, 19 % o personalizada) desaparece: lo
  reemplazan el check y la tasa del negocio.
- `costoPromedio` y `ultimoCosto` se rotulan como netos.
- Los productos con `formacionPrecioVersion = 2` se leen tal como están
  guardados (D5). Al editarlos y guardar, pasan a v3 (§6.4).

### 6.3 Saldo inicial (D4)

El baseline sigue escribiéndose en la primera operación de stock. Cambia su
fuente:

```text
costoUnitarioInicial = costoPromedio válido
                     si no: costoBase ?? costo ?? precioCompra     (sin sumar tasa)
```

`costoPagado` deja de ser fuente. La regla vale para todos los canales (alta
manual, planilla e importador documental) y para todo baseline que se
inicialice después del cambio. No es un recálculo: el baseline todavía no
existe al momento de escribirse. Un baseline ya persistido no se toca.

La creación no escribe `ultimoCosto`. Sigue siendo exclusivo de las
adquisiciones (SPEC 003).

**Ejemplo.** Producto creado con stock 5 y costo neto 10.000, no exento.

| Canal | Valor inicial hoy | Con esta SPEC |
| --- | --- | --- |
| Alta manual con tasa 19 % | 59.500 | **50.000** |
| Alta manual con tasa 0 % | 50.000 | 50.000 |
| Planilla sin columna de tasa | 50.000 | 50.000 |
| Planilla o documento con tasa 19 % | 59.500 | **50.000** |

Un producto comprado con boleta no se debe crear "con stock" para reflejar esa
compra. Su stock entra por Compras, que aplica el §5.

### 6.4 Precio sugerido y `precioInterno` (P1, provisional)

```text
precioVentaSugerido = round(costoBase × (1 + recargo / 100))
precioInterno       = precio manual si existe; si no, precioVentaSugerido
```

`precioInterno` es un precio neto: Cotizaciones y Ventas suman su IVA después.
Calcularlo sobre el costo con IVA cobra dos veces el IVA de compra.

**Ejemplo.** Costo neto 10.000, recargo 30 %.

| Concepto | Hoy (v2 con 19 %) | Con P1 |
| --- | --- | --- |
| Precio sugerido (neto) | 15.470 | **13.000** |
| Precio al cliente con IVA de venta | 18.409 | 15.470 |
| Ganancia bruta por unidad sobre costo neto | 5.470 | 3.000 |

**Impacto a revisar con el dueño.** Con el mismo recargo, el precio sugerido
baja alrededor de 16 %. Si los recargos actuales se eligieron pensando en el
costo con IVA, hay que revisarlos. Un precio manual no cambia.

**Edición de un producto v2.** Con P1, al abrir un producto v2 sin
precio manual, el formulario muestra el nuevo precio sugerido junto al actual
antes de guardar. Guardar solo cambia el precio si el usuario guarda la ficha;
el precio nunca cambia en silencio.

**Si el dueño rechaza P1:** la v3 conserva `precioVentaSugerido =
round(costoPagado × (1 + recargo / 100))`, con `costoPagado` informativo del
§6.2. El resto de esta SPEC no cambia.

### 6.5 Canales de creación

| Canal | Regla |
| --- | --- |
| Alta manual (`InventoryManager`) | Siempre v3: costo neto, check de exención, precio según §6.4. |
| Planilla (`inventoryImportService`) | `costoBase` es neto. Columna opcional `exentoIva` (sí/no) → `impuestoId`. La columna `tasaImpuestoCompra` se ignora con advertencia de fila. |
| Importador documental (`normalizeInventoryDocument`) | Sin cambios en la extracción. `costoBase` se toma neto. Si el documento es boleta, la revisión muestra el aviso: "Los costos de una boleta incluyen IVA. Para registrar esa compra usa Compras." |
| Normalización (`normalizeInventoryItems`) | Igual que la planilla. |

## 7. Costo del inventario en `/inventario` (D6)

```text
costoInventario = Σ productos activos con stock > 0 de:
  valorInventario                 si modeloCostoInventarioVersion = 1
  max(stock, 0) × costoBase        si el producto nunca tuvo movimientos
```

- `valorInventario` es `costoPromedio × stock` sin errores de redondeo. Es el
  saldo autoritativo (SPEC 003).
- Respaldo para productos sin movimientos: `costoBase`, que con D4 es neto. Es
  el mismo valor con el que se inicializará su baseline (§6.3).
- Se agrupa en la moneda del negocio, igual que hoy.
- `getInventoryMetrics` de Reportes ya usa `costoPromedio ?? costoBase`; los
  dos indicadores pasan a coincidir. Esta SPEC no cambia Reportes.
- Un producto con baseline anterior al cambio (con IVA) aporta su saldo tal
  como está guardado (D5).

**Ejemplo.**

| Producto | Estado | Hoy (`costoBase × stock`) | Con esta SPEC |
| --- | --- | --- | --- |
| A | stock 10, `valorInventario` 100.000, `costoBase` 12.000 | 120.000 | 100.000 |
| B | stock 3, sin movimientos, `costoBase` 5.000 | 15.000 | 15.000 |
| C | stock 0 | 0 | 0 |
| **Total** | | **135.000** | **115.000** |

## 8. Registros anteriores al cambio (D5)

Ningún documento se reescribe. Las operaciones nuevas sobre registros
anteriores **deshacen exactamente lo que entonces entró o salió**. Así el
saldo Q/V sigue cuadrando, aunque mezcle valores con y sin IVA.

Una adquisición es anterior al cambio si no tiene `tratamientoIvaCompra`.

### 8.1 Revertir una Compra anterior

```text
montoAReversar = adquisición.costoInventarioTotal ?? adquisición.costoPagadoTotal
```

Al restaurar `ultimoCosto` desde la adquisición previa:
`previa.costoInventarioUnitario ?? previa.costoPagadoUnitario`.

**Ejemplo.** Compra antigua de 10 u a 11.900 bruto. Después del cambio entra
una compra nueva de 10 u a 10.000.

```text
Q = 20, V = 119.000 + 100.000 = 219.000, promedio 10.950
Revertir la compra antigua: −10 u, −119.000 → Q = 10, V = 100.000, promedio 10.000  ✓
```

**Bloqueo que ya existe hoy.** Si entre medio se vendieron 10 u (costo
congelado 109.500), quedan Q = 10 y V = 109.500. Revertir la compra antigua
dejaría Q = 0 y V = −9.500, y la operación se bloquea por saldo inválido. Ese
bloqueo ya ocurre hoy cuando dos compras tienen costos distintos. Mezclar
valores con y sin IVA lo hace más probable. Con el reseteo del §2.3 este caso
no llega a datos reales.

### 8.2 Cancelar una Venta anterior

La cancelación repone `efectosInventario[].costoTotal` tal cual (SPEC 017,
sin cambios).

**Ejemplo.** Venta anterior de 2 u, costo congelado 23.800 (promedio bruto
11.900). Hoy el producto tiene Q = 8 y V = 80.000 (neto).

```text
Cancelar: +2 u, +23.800 → Q = 10, V = 103.800, promedio 10.380
```

El promedio sube 3,8 % y vuelve a neto a medida que se consume y repone. No se
repone al costo vigente: eso cambiaría el valor de la reversa y rompería el
principio de SPEC 017.

### 8.3 Devolver material de Proyecto anterior

`DEVOLUCION_PROYECTO` usa el costo congelado de la salida (SPEC 012, sin
cambios). El efecto es el mismo que en §8.2.

### 8.4 Productos y documentos anteriores

- Un producto v2 conserva su `costoPagado`, `precioVentaSugerido` y
  `precioInterno` hasta que alguien edite y guarde su ficha.
- Una Compra en borrador creada antes del cambio recalcula sus totales con la
  regla nueva al guardarse de nuevo. Si se confirma sin volver a guardarla,
  usa los totales guardados para el documento y la regla nueva para el
  inventario. Esto es aceptable porque el documento todavía no tenía efectos.
- Una Compra confirmada anterior se ve como está: su `iva` y `total` no
  cambian.

## 9. Gastos de Proyecto con boleta

### 9.1 Cómo se registra hoy un material de obra que no pasa por bodega

Investigación en código:

- **No existe Compra imputada a un Proyecto.** Compras y Recepciones no tienen
  `trabajoId` (`functions/purchasePersistence.js`,
  `functions/receptionPersistence.js`).
- **Camino 1: gasto directo del Proyecto** con categoría `MATERIAL`
  (`registrarGastoTrabajo`, `functions/workPersistence.js:1225-1290`). Guarda
  un solo `monto`, sin IVA ni tipo de documento. `MATERIAL` es la categoría
  preseleccionada del formulario (`src/pages/WorksPage.jsx:417`). Es el camino
  natural para "un tubo PVC y abrazaderas comprados camino a la obra".
- **Camino 2: Compra + salida de material.** Se registra la Compra (entra a
  stock) y luego `registrarSalidaMaterialTrabajo` (`SALIDA_PROYECTO`) la saca al
  costo promedio. Funciona, pero obliga a pasar por bodega algo que nunca
  estuvo en ella.
- **Riesgo encontrado:** si el Proyecto ya tiene libro de materiales (alguna
  `SALIDA_PROYECTO` o una Venta vinculada con productos), los gastos
  `MATERIAL` **se excluyen del costo** (`functions/workBalance.js:108-110`,
  `src/domain/workModel.mjs:657-664`). Esa regla evita doble imputación de
  registros legacy (SPEC 012). Pero hoy también deja fuera, sin aviso al
  registrar, el material de boleta del Camino 1 (§9.3).

**Recomendación de uso:** material que no pasa por bodega → gasto del Proyecto
(Camino 1). Compras queda para lo que entra a stock.

### 9.2 Regla: el tipo de documento define el monto

El gasto agrega un selector obligatorio **"Documento"** con dos opciones:

| Opción | Persistido | Rótulo del monto | Significado de `monto` |
| --- | --- | --- | --- |
| Factura (opción por defecto) | `tipoDocumento: "factura"` | "Monto neto (sin IVA)" | Neto. El IVA es crédito fiscal. |
| Boleta o sin documento | `tipoDocumento: "boleta"` | "Total pagado (IVA incluido)" | Total pagado. Todo es costo. |

- El sistema **no calcula IVA**: `monto` es siempre el costo para el Proyecto,
  tal como lo escribe el usuario. El selector solo cambia el rótulo, una ayuda
  bajo el campo y el dato persistido.
- Ayuda bajo el campo: con factura, "Ingresa el neto de la factura, sin IVA";
  con boleta, "Ingresa lo que pagaste. En boleta el IVA no se recupera".
- `tipoDocumento` usa el mismo nombre canónico que Compras.
- Un gasto anterior sin `tipoDocumento` se lee como factura, con `monto` neto
  (la convención de SPEC 022 Q2).
- El listado muestra "Boleta" junto a los gastos registrados con boleta.
- `normalizeExpenseInput` valida el valor. Un valor ausente o desconocido se
  rechaza en gastos nuevos.
- La evidencia adjunta (SPEC 020) no cambia.

**Ejemplos.**

| Gasto | Documento | Lo pagado | `monto` a ingresar | Costo para el Proyecto |
| --- | --- | --- | --- | --- |
| Almuerzo de la cuadrilla | Boleta | 23.800 | 23.800 | 23.800 |
| Tubo PVC y abrazaderas camino a la obra | Boleta | 8.330 | 8.330 | 8.330 |
| Arriendo de andamio | Factura | 59.500 (50.000 + 9.500 IVA) | 50.000 | 50.000 |
| Peaje sin documento | Boleta o sin documento | 3.200 | 3.200 | 3.200 |

Errores que el rótulo previene: netear la boleta del tubo (ingresar 7.000)
subestima el costo en 1.330. Ingresar el total de la factura del andamio
(59.500) lo sobreestima en 9.500.

### 9.3 Gastos `MATERIAL` con libro de materiales (P2, provisional)

Decisión provisional del desarrollador, tomada en ausencia del dueño; a
confirmar con él al volver, igual que P1.

**Problema.** Proyecto con una salida de bodega de cable por 30.000 y un gasto
`MATERIAL` con boleta por 8.330 (tubo PVC).

```text
Hoy:  materiales = 30.000; gasto MATERIAL 8.330 informado pero excluido
      costoTotal = 30.000 (subestimado en 8.330)
```

**Regla.** Un gasto `MATERIAL` registrado con esta SPEC (tiene
`tipoDocumento`) es material comprado directo para la obra y **siempre suma**
al costo. Los gastos `MATERIAL` sin `tipoDocumento` (legacy) mantienen la
exclusión de SPEC 012.

```text
Con la regla: costoTotal = 30.000 + 8.330 = 38.330
```

Mitigación del riesgo de doble imputación: con categoría `MATERIAL`, el
formulario muestra la ayuda "Solo material comprado directo para esta obra que
no pasó por bodega. Si sale de bodega, regístralo en Materiales utilizados."

**Alternativa descartada:** registrar ese material con categoría `OPERATIVO`.
Es un parche: pierde la categoría y depende de que el usuario conozca la
regla.

Esta regla cambia un punto de SPEC 012 y del balance de SPEC 022. Se
implementa en la etapa 6 del §13. Si el dueño no la confirma, se revierte a la
exclusión de SPEC 012 sin afectar los datos: el campo `tipoDocumento` sigue
siendo válido.

## 10. Modelo persistido

Solo se agregan campos. Ningún documento existente se reescribe.

| Documento | Campo | Valores | Nota |
| --- | --- | --- | --- |
| `negocios/{businessId}/inventario/{id}` | `impuestoId` | `IVA_GENERAL`, `IVA_EXENTO` (`SIN_IMPUESTO` legacy) | Existente; pasa a ser editable. |
| idem | `formacionPrecioVersion` | `3` | Nueva versión; v2 se sigue leyendo. |
| `compras/{id}` | `montoExento` | número ≥ 0 | Nuevo. |
| idem | `modeloIvaCompraVersion` | `1` | Marca documentos calculados con esta SPEC. |
| `compras/{id}.items[]` | `impuestoId` | copia del producto | Nuevo en la línea (§5.3). |
| `adquisicionesInventario/{id}` | `tratamientoIvaCompra` | `credito_fiscal`, `boleta`, `exento` | Nuevo. Su ausencia identifica registros anteriores. |
| idem | `costoInventarioUnitario`, `costoInventarioTotal` | número ≥ 0 | Nuevo: lo que entró a Q/V. |
| `movimientosInventario/{id}` (entradas) | `costoUnitarioAplicado`, `costoTotal` | número ≥ 0 | Existentes; pasan a llevar el costo de inventario. |
| `trabajos/{id}/gastos/{gastoId}` | `tipoDocumento` | `factura`, `boleta` | Nuevo; define el significado de `monto`. |

Rules: sin cambios. Todos los campos los escribe solo Functions, igual que
hoy.

## 11. Fuera de alcance y trabajo futuro

- Resumen mensual de IVA, libro de compras y crédito fiscal acumulado.
- IVA de gastos de Proyecto, salvo distinguir factura y boleta (§9).
- Exención por línea de documento (solo existe por producto).
- Notas de crédito.
- IVA de Ventas y Cotizaciones, incluida la venta de productos exentos.
- Totales de Órdenes de Compra: siguen con 19 % sobre todas las líneas.
- Cambios en la extracción con IA de documentos (solo avisos en la revisión).
  Cualquier ampliación de IA requiere autorización por tarea (`AGENTS.md`).
- Migración, recálculo o backfill de productos, Compras, Ventas o Proyectos.
- **Trabajo futuro para comercializar:** configuración por negocio de si
  recupera IVA. Un negocio que no recupera IVA trataría todas sus compras como
  boleta (§5.1 con un tratamiento por defecto del negocio). El punto de
  extensión es la función que resuelve `tratamientoIvaCompra`. Hoy, un negocio
  cuyo impuesto por defecto es `IVA_EXENTO` crea productos exentos y obtiene un
  efecto parecido, pero no es una configuración diseñada para eso.

## 12. Pruebas

### 12.1 Smokes que cambian

| Smoke | Aserción actual | Cambio |
| --- | --- | --- |
| `scripts/purchase-model-smoke.mjs:45` | Totales con IVA 19 % | Se mantiene (factura). Se agregan casos boleta y exento. |
| `scripts/inventory-acquisition-smoke.mjs:38-49` | Montos con tasa 19 % | `costoPagado*` se mantiene; se agregan `costoInventario*` = neto y el delta Q/V neto. |
| `scripts/inventory-acquisition-smoke.mjs:51` | `legacyPaidCost({costoBase: 1000, tasaImpuestoCompra: 19}) === 1190` | El baseline resuelve 1000 (§6.3). |
| `scripts/inventory-model-smoke.mjs:199-246` | Formación v2: `costoPagado` 119000, `precioVentaSugerido` 148750, tasa personalizada 10 % | v3: `costoPagado` 119000 informativo; sugerido **125000** (P1, recargo 25 %); el caso 10 % se reemplaza por exento. |
| `scripts/inventory-mvp-smoke.mjs:79-132` | Igual: 148750, 125000, 132000 | v3: 125000 con y sin IVA; el caso 10 % se reemplaza por exento. |
| `scripts/inventory-mvp-smoke.mjs:224` | `summarizeInventory(list).inventoryCost === 100` | Se recalcula según §7 con el fixture. |
| `scripts/receptions-integrated-local.mjs:112-193` | `valorInventario` 5712, `costoPromedio`/`ultimoCosto` 1428, 12852, 7140, 1190, 8568 | Neto: **4800**, **1200**, **10800**, **6000**, **1000**, **7200**. `costoPagadoTotal` 5712 se mantiene; `costoInventarioTotal` 4800. |
| `scripts/purchases-integrated-local.mjs:184-196` | `valorInventario` 26565, `costoPromedio` 2656.5, `ultimoCosto` 10174.5, `costoPagadoTotal` 20349 | **23316**, **2331.6**, **8550**; `costoPagadoTotal` 20349 se mantiene; `costoInventarioTotal` **17100**. Tras revertir: 6216 (sin cambio). |
| `scripts/inventory-document-import-smoke.mjs:250, 417, 435, 506` | Extracción de `tasaImpuestoCompra` | Se mantiene (la extracción no cambia). Cambia la transformación a borrador (§6.5). |
| `scripts/purchase-orders-*` | Totales de OC con IVA | Sin cambio (fuera de alcance). |

### 12.2 Casos nuevos

Modelo puro:

1. Compra factura: el documento suma IVA; a Q/V entra el neto (Ejemplo A).
2. Compra boleta: `iva = 0`, `total = neto`; a Q/V entra lo pagado (Ejemplo B).
3. Línea exenta en factura: `montoExento`, IVA solo sobre afectas (Ejemplo D).
4. Boleta con línea exenta: mismo resultado que boleta.
5. `otro` y `sin_documento` siguen la regla general.
6. Descuento por línea: el neto con descuento es el costo; en boleta, también.
7. Espejo frontend/backend: `calculatePurchaseTotals` y `totals()` dan lo mismo
   en los casos 1 a 6.
8. Baseline: producto con `costoPagado` y sin promedio inicializa con
   `costoBase`.
9. Ficha v3: `costoPagado` informativo, sugerido sobre neto (P1) y exento con
   tasa 0.
10. `summarizeInventory`: `valorInventario` si existe, respaldo `costoBase`,
    stock 0 aporta 0 (ejemplo del §7).
11. Gasto: `tipoDocumento` requerido en gastos nuevos; legacy sin campo se lee
    como factura.

Integrados (emulador):

12. Confirmar Compra directa factura, boleta y mixta: Q/V, `ultimoCosto`,
    adquisición y movimiento con `costoInventario*`.
13. Recepción con `documentoOrigen.tipoDocumento: "boleta"`: Q/V con lo pagado
    y Compra derivada con `iva = 0`.
14. Revertir Compra nueva: resta `costoInventarioTotal`; `ultimoCosto` vuelve
    a la previa.
15. Revertir Compra anterior (adquisición sin `tratamientoIvaCompra`): resta
    `costoPagadoTotal` (§8.1).
16. Cancelar Venta anterior: repone el `costoTotal` congelado (§8.2).
17. Cambiar `impuestoId` desde la ficha: solo OWNER/ADMIN, solo productos,
    aislado por negocio.
18. Borrador de Compra copia el `impuestoId` del producto a la línea; un cambio
    posterior en la ficha no altera la línea hasta volver a guardar.
19. Registrar gasto con boleta y con factura: `monto` intacto, `tipoDocumento`
    persistido, balance igual a la suma de montos.
20. Regla P2 (§9.3): gasto `MATERIAL` con `tipoDocumento` suma al
    balance aunque exista `SALIDA_PROYECTO`; uno legacy sigue excluido.

UI (smokes estáticos de texto/estructura, como en SPEC 022):

21. Ficha: "Costo neto (sin IVA)", check "Exento de IVA", "Costo con IVA
    (referencia)".
22. Nueva compra con boleta: columna "Precio pagado (IVA incluido)", sin línea
    de IVA en totales.
23. Gasto de Proyecto: selector "Documento" y rótulo dinámico del monto.

## 13. Etapas de implementación

Cada etapa es pequeña, deja el sistema consistente y se detiene sin commit.

0. **Decisiones.** SPEC aprobada. P1 y P2 se implementan como provisionales;
   si el dueño no las confirma, la etapa 2 tiene la variante del §6.4 y la
   etapa 6 se revierte a la regla de SPEC 012. El reseteo de datos de prueba
   se planifica en una tarea aparte.
1. **Cálculo puro de compras.** Resolución de `tratamientoIvaCompra`, totales
   del §5.2 en `functions/purchasePersistence.js` y
   `src/domain/purchaseModel.mjs`, montos del §5.3 en
   `functions/inventoryAcquisition.js`. Smokes 1-7 y ajustes de
   `purchase-model` e `inventory-acquisition`.
2. **Ficha y canales de creación.** `impuestoId` editable, formación v3,
   baseline neto (§6.3), formulario, planilla e importador. Smokes 8-9, 17, 21
   y ajustes de `inventory-model` e `inventory-mvp`.
3. **Efectos de Compra y Recepción.** Confirmación, copia de `impuestoId` en
   líneas, Recepción, reversión y `ultimoCosto`. Smokes 12-15, 18 y ajustes de
   `purchases-integrated` y `receptions-integrated`.
4. **UI de Compras e inventario.** Rótulos de boleta y exento en Nueva compra
   y detalle, aviso de boleta en el importador de Compras, ficha (§6.2) y
   "Costo del inventario" (§7). Smokes 10, 22. **Cambio visual.**
5. **Gastos de Proyecto.** `tipoDocumento` en el gasto, selector y rótulos.
   Smokes 11, 19, 23. **Cambio visual.**
6. **Regla `MATERIAL` (P2, provisional).** `workBalance.js` y
   `workModel.mjs`, con ayuda del formulario. Smoke 20.
7. **QA y documentación.** Recorrido con datos de prueba después del reseteo;
   actualizar el estado de esta SPEC.

Verificación mínima en cada etapa: `npm run build`, `npm run test:design`,
`npm --prefix functions run lint`, `git diff --check` y los smokes
relacionados (`test:purchases-model`, `test:purchases-integrated`,
`test:receptions-model`, `test:receptions-integrated`, `test:inventory-model`,
`test:inventory-mvp`, `test:inventory-docs`, `test:inventory-sheets`,
`test:inventory-import-v2`, `test:sales-integrated`, `test:sales-margin`,
`test:works-model`, `test:reports`, `test:operational-net-profit`, según la
etapa).

## 14. Riesgos

- **Datos mezclados sin reseteo.** Sin reseteo, productos con saldo con IVA y
  movimientos nuevos sin IVA conviven en un mismo promedio. El §8 lo mantiene
  consistente, pero los márgenes de esos productos quedan entre ambas bases
  hasta que el stock antiguo se consuma.
- **Caída del precio sugerido (P1).** Con el mismo recargo, el precio baja
  alrededor de 16 % (§6.4).
- **Error de ingreso en boleta.** Si el usuario escribe precios netos en una
  boleta, el costo queda subestimado. Lo mitigan los rótulos y avisos del §6.5
  y la etapa 4.
- **Gasto `MATERIAL` excluido en silencio** hasta que se implemente la etapa 6.
- **Doble imputación de material (P2).** Si alguien saca material de bodega y
  además lo registra como gasto `MATERIAL`, se cuenta dos veces. Lo mitiga la
  ayuda del formulario (§9.3).
- **Decisiones provisionales.** Si el dueño rechaza P1 o P2, hay que
  revertir la etapa 2 (variante del §6.4) o la etapa 6.
