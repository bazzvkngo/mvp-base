# SPEC 036: Montos con decimales por moneda (Bolivia)

Estado: **implementada (entregas A, B, C y D) en la rama `mejora-refresco-avisos` (2026-11-20). Las entregas A, B y C están en commits de la rama; la D está sin commit ni despliegue. BOB calcula con 2 decimales desde la entrega D; el rollback es volver `amountDecimals` de BOB a 0 en `functions/businessCatalog.json`.** Decisión de Mauricio del 20-nov-2026, tomada al ver que Bolivia trabaja con decimales en el día a día (sustituye el redondeo que él mismo había decidido en la SPEC 035). Bruno no aprobó el redondeo y aún no ha sido consultado sobre los decimales. En BOB los montos admiten 2 decimales y Bolivia funciona igual de bien que Chile; CLP sigue entero y no cambia de comportamiento. `AGENTS.md` sigue siendo la autoridad en seguridad y arquitectura multiempresa.

## 1. Qué sustituye

- SPEC 035, sección 1 (montos enteros redondeados, `Math.round`), sección 3 punto 7 (el aviso de redondeo al entero) y sección 5 (aviso pendiente): la entrega D los reemplaza. Desde la entrega D, BOB calcula con 2 decimales y el aviso de redondeo se retiró (queda la nota fiscal del país en el onboarding).
- Todo lo demás de la SPEC 035 (rubros, países, región, textos por país) sigue vigente.

## 2. Decisiones

1. **IVA igual que Chile:** se calcula una sola vez sobre el neto del documento, después de redondear las líneas y restar el descuento general (`round(neto × tasa)`; en compras, sobre `neto − exento`). No hay IVA por línea: cambiaría los totales de Chile.
2. **Decimales de entrada:** BOB admite 2 decimales en importes, precios unitarios y costos. Chile no gana límites nuevos. No hay 4 decimales.
3. **Movimientos financieros (`firestore.rules`):** `amount is number`, `> 0` y `<= 9007199254740991` (el entero seguro de JavaScript), sin leer el negocio por movimiento. Los decimales los valida el modelo del cliente (`financialMovement.mjs`) con los de la moneda del negocio.
4. **Fuera de alcance** (limitaciones conocidas de Bolivia, sección 6): la importación de documentos con IA y los precios o recomendaciones con IA. No se tocan.
5. **Se guarda en unidad mayor, sin centavos y sin migrar datos.** Cada monto es un número (`10,5`), no un entero en centavos.
6. **Inventario y movimientos no son documentos:** no guardan `montoDecimales`. Sus decimales son los de la moneda del negocio, que el servidor lee del catálogo (nunca del cliente). Con 0 decimales no se agrega ninguna validación (Chile conserva lo que aceptaba).

## 3. Diseño

### `decimals` y `amountDecimals`

- `decimals` (por moneda, en `functions/businessCatalog.json`) es **formato**: cuántos decimales se muestran. CLP 0, BOB 2.
- `amountDecimals` (por moneda, mismo catálogo) es **cálculo y validación**: con cuántos decimales se redondean y validan los importes de un documento nuevo. Nunca supera a `decimals`. Es **2 en BOB** (desde la entrega D) y **0 en el resto**: es el interruptor de esta SPEC. BOB se activó al final, cuando todos los modelos ya usaban el helper; así no hay un estado intermedio en que la cotización admite decimales y la venta que la convierte los rechaza. Volver BOB a 0 es el rollback: los documentos ya creados con decimales conservan su `montoDecimales` y los nuevos vuelven a calcularse enteros.
- Lectura: `getCurrencyAmountDecimals(code)` (frontend, `businessCatalog.js`) y `currencyAmountDecimals(code)` (`functions/localization.js`). Una moneda desconocida cuenta 0.
- `schemaVersion` del catálogo es 6 (cambió de 5 a 6 en la entrega A al agregar el campo). Activar BOB solo cambia un valor, no el esquema: no vuelve a subir.

### Snapshot `montoDecimales` en cada documento

- `documentLocalizationSnapshot` (Functions) congela `montoDecimales` = `amountDecimals` de la moneda al crear el documento, junto a moneda, locale e IVA.
- `adaptDocumentLocalization` (frontend y Functions) lo lee: **ausente = 0**. Un valor inválido, o mayor que los `decimals` de la moneda del documento, vale 0 (CLP y PYG, siempre 0).
- Un documento anterior sigue calculándose entero y no se recalcula: un documento piloto de BOB guardado como 3 × 3,50 = 11 sigue valiendo 11. Los documentos creados con decimales conservan su snapshot aunque se revierta el interruptor.
- Desde la entrega B los modelos lo escriben **solo si es mayor que 0** (un documento de Chile no gana el campo) y lo derivan en el servidor: del catálogo al crear, y del documento guardado al editar o convertir. Nunca del payload del cliente. Los documentos que lo llevan: cotizaciones, ventas, órdenes de compra, recepciones, compras y órdenes de trabajo.
- La OT (entrega C) lo congela al crearse. Al enviarla a aprobación usa el del documento guardado; solo si su moneda cambió (o no tenía) sale del catálogo.

### Helper de redondeo

- `src/domain/money.mjs` y `functions/money.js` (mismo cuerpo; las Functions no pueden importar `src/`): `mulRound(a, b, decimals = 0, divisor = 1)` calcula `round((a × b) / divisor)`, `roundMoney(value, decimals)` y `sumMoney(values, decimals)`.
- **Con 0 decimales ejecutan literalmente la fórmula actual** (`Math.round((a * b) / divisor)` y la suma con `reduce`), sin ruta exacta. El resultado es bit a bit el de antes, incluidos los empates que hoy dependen del punto flotante. Así Chile queda idéntico por construcción.
- **Con decimales > 0 el cálculo es decimal exacto** (BigInt sobre la representación decimal corta de cada número, que es la que tipeó el usuario): 1,005 redondea a 1,01, 0,7 × 0,05 da 0,04 y 1.000 líneas de 0,07 suman 70. El empate se resuelve hacia +∞, como `Math.round`.
- Unos `decimals` inválidos (negativos, fraccionarios, mayores que 6) lanzan `RangeError`: es un error de programación, no un redondeo silencioso.

### Formato

`formatBusinessMoney`, `useBusinessMoney` (que lo usa) y `formatMoneyText` (correos) muestran siempre los `decimals` de la moneda (mínimo = máximo). CLP y PYG no cambian. BOB se ve "Bs 11,00" y "Bs 10,50" en pantalla, correo y PDF. `formatMoney` (PDF, vistas de impresión) ya funcionaba así. El diálogo de movimientos nombra la moneda del negocio (`getCurrencyPluralName`; Chile conserva "pesos chilenos").

### Sumas de finanzas y reportes

- `summarizeFinancialMovements`, `getFinancialSummary` y las demás agregaciones de `financialMovement.mjs` reciben los decimales del negocio y suman con `sumMoney`; con 0 decimales siguen siendo el `+=` de siempre. El CSV escribe los montos con coma decimal.
- En los reportes (`reportModel.mjs`) los totales por moneda, la línea de tiempo y los rankings cierran cada suma redondeándola a los `amountDecimals` de su moneda (sin ruido de punto flotante). CLP no se toca. Los `roundMoney` de 2 decimales fijos de los reportes de rentabilidad coinciden con los 2 decimales de BOB y no cambian.

## 4. Entregas

- **A (hecha):** helper, `amountDecimals` y snapshot, formato. Con `amountDecimals` en 0 todo se comporta como antes, salvo el formato de BOB (",00").
- **B (hecha):** cotizaciones, ventas, compras, órdenes de compra y recepciones: modelos del frontend, Functions y los inputs de importes (`moneyStep`).
- **C (hecha):** inventario (precio de venta, IVA de compra), órdenes de trabajo del taller, margen comercial y movimientos financieros (modelo, diálogo, CSV y regla de Firestore). Sin tocar IA.
- **D (hecha):** BOB con `amountDecimals` 2, retiro del aviso de redondeo (`amountRounding.mjs`, `AmountRoundingNotice`, onboarding y los 3 paneles de resumen), sumas de finanzas y reportes con datos en BOB, verificación server-side de inventario con el contexto real, actualización de esta SPEC y de la 035, y un integrado nuevo de Bolivia.

## 5. Pruebas

- A: `money` (paridad del texto entre frontend y Functions; diferencial contra las fórmulas actuales con más de un millón de entradas aleatorias, empates incluidos; oráculo de centavos enteros con 2 decimales; casos de punto flotante), `localization`, `business-catalog` (`amountDecimals` por moneda) y `currency-text`.
- B: `quote-sale-decimals` y `purchase-decimals` (diferencial contra las fórmulas legacy a 0 decimales y casos con 2, paridad frontend/servidor de cada modelo).
- C: `inventory-workshop-decimals` (inventario, OT con handler real sobre una Firestore en memoria, margen, movimientos, regla de Firestore por texto).
- D: `bolivia-decimals` (catálogo y rollback, aviso retirado, sumas de finanzas, reportes con 300 ventas y 200 compras en BOB, y los handlers reales de inventario con `requireOperationalBusinessAccess`: en un negocio BOB el servidor rechaza un costo de 3,505 y acepta 3,50 al crear, editar e importar) y el integrado `bolivia-decimals-integrated` (requiere emuladores; corre el mismo flujo en un negocio BOB y en uno CLP: cotización → venta con 3 × Bs 3,50 = 10,50, IVA 13 % de 1,37 y total 11,87; orden de compra → recepción → compra con costos en centavos; OT con repuesto a Bs 3,50 enviada a aprobación; movimiento financiero con decimales y reglas; y que ningún documento de Chile gane `montoDecimales`).
- Corrección (23-nov-2026): "Nueva cotización" fallaba al abrir en cualquier país (`totalsResult.userErrorMessage is not a function`, de un reemplazo masivo en el commit `2032922`, ajeno a los decimales). Se corrigió con `quoteTotalsErrorMessage` y la cubre `quote-new-page-initial-render` (render inicial con 2 y con 0 decimales, sin emuladores).
- Pendiente: correr los integrados con emuladores (`output\run-integrados.ps1`), incluido `rules-smoke`.

## 6. Limitaciones conocidas de Bolivia

Siguen enteros y asumen formato chileno, aunque la empresa tenga `amountDecimals` 2:

- **Importación de documentos con IA:** `normalizeInventoryDocument` y `confirmInventoryImportV2` (`functions/inventoryDocumentImport.js`) y `parseChileanMoney`/`parseIntegerFromText` en `functions/index.js` redondean los montos al entero y leen "1.234" como mil doscientos treinta y cuatro. Los diálogos de importación de compras y recepciones usan ese resultado.
- **Importación de inventario por planilla:** el cliente no recibe los decimales (el servidor sí rechaza más de 2) y su lector de números interpreta "123.456" como miles, el formato chileno.
- **Precios y recomendaciones con IA:** `suggestQuoteItems` y los cálculos de precio recomendado, mínimo y máximo de `functions/index.js` (`Math.round`), y las recomendaciones de `src/domain/pricing.js`.
- **Precios de referencia de mercado:** asumen CLP.
- **Costo promedio con empates:** el valor del inventario (`functions/inventoryAcquisition.js`) se redondea con `(x + EPSILON) * 100`. En los empates al tercer decimal (cantidad fraccionaria, o descuento × cantidad) puede diferir **1 centavo** del redondeo decimal exacto: 10 × 0,2975 = 2,975 sale 2,97 y no 2,98 (≈1 % de las líneas con descuento). El documento de compra sí es exacto, así que el saldo de inventario puede diferir 1 centavo de la línea. Corregirlo exige pasar `montoDecimales` por los puntos de llamada de compras, recepciones, ventas y proyectos; con 0 decimales se conserva la fórmula legacy.
- **Eje de los gráficos de Finanzas:** su formato compacto usa `es-CL`. No es un monto con moneda.
- **Normativa tributaria boliviana (IT) y facturación:** siguen fuera de alcance (SPEC 035). Los precios en Bolivia suelen fijarse con IVA incluido y el débito fiscal se calcula sobre el importe del documento; el modelo neto + IVA de ValoraCloud no calzará al centavo con una factura emitida fuera del sistema.

## 7. Despliegue

Hasta ahora no se desplegó ninguna entrega, así que se despliegan juntas (A a D). El orden es: reglas de Firestore → Functions en tandas pequeñas (la cuota 429 las limita) → Hosting. Dentro de las Functions conviene ir **de aguas abajo hacia arriba** (OT, compras, recepciones, ventas, órdenes de compra, cotizaciones e inventario al final): un documento sin `montoDecimales` vale 0, así que las Functions nuevas leen sin problema lo que crean las viejas, pero no al revés. El catálogo (`businessCatalog.json`) viaja con las Functions y con Hosting: Hosting va al final para que el cliente no envíe decimales a Functions que todavía los rechazan. Rollback: `amountDecimals` de BOB a 0 en el catálogo y volver a desplegar Functions y Hosting.
