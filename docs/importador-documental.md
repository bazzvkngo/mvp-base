# Importación de inventario y documentos comerciales

## Estado y alcance

Este documento separa el comportamiento implementado del target post-demo. La
lectura de un archivo nunca constituye por sí sola una adquisición ni autoriza
un movimiento de stock. La [`SPEC 016`](specs/016-vision-post-demo-bruno.md)
confirma la evolución de la Compra directa, pero no permite describirla como una
función existente.

## A. Implementado actualmente

### Carga maestra local

La acción vigente de Inventario admite XLSX, XLS y CSV de hasta 5 MB. El
navegador lee la planilla con SheetJS, normaliza encabezados y filas de forma
determinista, muestra una vista previa editable y envía sólo filas incluidas y
válidas después de la confirmación humana. Este camino local no sube el archivo
a Storage, Gemini ni Functions para analizarlo.

La persistencia pasa por la operación autoritativa de importación, que valida
membresía, permisos, empresa, campos, unicidad e idempotencia. Incorpora las
filas confirmadas al catálogo/stock maestro según el contrato de Inventario,
pero no crea Proveedor, Orden de Compra, Recepción, Compra económica ni una
adquisición comercial implícita.

### Adaptador documental conservado

El código también conserva un adaptador documental en la interfaz de
Inventario para PDF, JPG, JPEG, PNG y WebP de hasta 5 MB. Este comportamiento
existente se mantiene por compatibilidad: valida el archivo en frontend y
backend, envía temporalmente Base64 a la callable autenticada
`normalizeInventoryDocument` y usa Gemini multimodal para proponer líneas del
catálogo. No existe OCR local ni fallback heurístico para PDF o imágenes; si
Gemini no está disponible, el análisis documental falla de forma controlada.

El documento fuente se procesa en memoria y no se persiste en Firestore ni
Firebase Storage. Los candidatos sólo llegan a Inventario después de una vista
previa editable, selección y confirmación humana. Este adaptador existente no
define la semántica futura de una factura de compra y no debe confundirse con
el target de adquisición directa.

### Importador de Recepciones

Un borrador de Recepción ligado a una OC puede abrir el importador existente.
Las planillas usan normalización determinista sin Gemini; PDF e imágenes usan el
mismo análisis multimodal, pero con contexto `reception`. En ese contexto se
reconocen, cuando están presentes:

- identificación del documento, tipo, folio y fecha;
- emisor/proveedor y receptor;
- neto, impuesto o IVA, tasa y total;
- líneas con descripción, códigos del proveedor, cantidad y valores unitarios.

Los datos reconocidos son una propuesta, no autoridad. La identidad fiscal del
emisor se compara con el proveedor autoritativo de la OC y nunca crea ni
reemplaza un Proveedor. La normalización omite copias repetidas, separa los
campos administrativos de las líneas y advierte cuando líneas y totales no
concilian.

Cada línea propuesta se reconcilia únicamente contra líneas existentes de la
OC mediante identificadores y coincidencias controladas. La cantidad aplicable
debe ser mayor que cero y no puede superar la cantidad pendiente de esa línea.
Una línea sin asociación válida queda fuera del borrador aplicado. El usuario
revisa y corrige la propuesta antes de aplicarla; aplicar o guardar el borrador
no mueve stock. Sólo `confirmarRecepcion` revalida autoritativamente y produce
los efectos físicos y económicos.

Cuando se guarda el origen documental de una Recepción, sólo se conservan
metadatos sanitizados: nombre, tipo y tamaño del archivo; datos reconocidos del
documento y partes; totales; coherencia; conteos y advertencias. El Base64 se
descarta.

## B. Carga maestra de Inventario

La carga maestra canónica sirve para crear el catálogo o realizar una carga
inicial masiva desde Excel/CSV:

```text
Excel/CSV → lectura local → revisión humana → confirmar Inventario
```

Representa datos maestros iniciales, no una compra nueva. Una factura, guía o
documento de proveedor no debe convertirse silenciosamente en stock mediante
este concepto. Que el adaptador documental legacy todavía exista en la UI de
Inventario no cambia esta separación semántica ni autoriza ampliarlo.

## C. Target confirmado pendiente: factura de compra directa

La evolución acordada, todavía no implementada, es:

```text
Factura/documento → Nueva compra → revisión humana → confirmar → entrada a stock
```

El importador de factura deberá vivir dentro de Nueva compra, incluso cuando el
acceso se inicie desde Inventario. El usuario revisará proveedor, documento,
líneas, cantidades, costos y totales antes de confirmar. La entrada física sólo
ocurrirá en la confirmación autoritativa del nuevo flujo.

Actualmente una Compra directa `modeloCompraVersion: 2` se confirma como hecho
económico y conserva `stockAplicado: false`; no produce la entrada física. Por
eso el flujo anterior es un target de producto y no una capacidad disponible.
Su implementación futura deberá definir backend, idempotencia, snapshots,
movimientos, costos, reversión, permisos y compatibilidad antes de modificar
stock.

## D. Recepción con Orden de Compra

El flujo con OC permanece separado y vigente:

```text
Orden de Compra → Recepción acotada a pendiente → Compra económica
```

La OC conserva lo solicitado y no mueve stock. Al confirmar la Recepción,
Functions vuelve a validar que cada línea pertenezca a la OC y que la suma
recibida no supere lo pendiente; luego actualiza stock, `costoPromedio` y
`ultimoCosto`, registra movimientos/adquisiciones y crea en la misma transacción
la Compra económica confirmada correspondiente.

Una factura que contiene productos, líneas o cantidades ajenas a la OC no
habilita recibirlos como parte de esa Recepción. Esas líneas quedan sin asociar
y fuera de la propuesta aplicada. Deben resolverse fuera de ese documento —por
ejemplo, corrigiendo el antecedente comercial o mediante el futuro flujo de
Compra directa— sin debilitar la trazabilidad de la OC.

## Seguridad y privacidad

- La callable documental exige autenticación, `businessId` y acceso vigente al
  negocio; las mutaciones posteriores vuelven a validar membresía y permisos.
- Se validan extensión, MIME declarado, firma binaria, Base64, tamaño y casos
  controlados de corrupción antes de invocar Gemini.
- El límite del archivo original es 5 MB; su representación Base64 aumenta el
  payload, pero nunca se registra ni se persiste.
- Los logs deben limitarse a tipo, tamaño aproximado, conteos, duración,
  resultado general y códigos de error controlados.
- Ninguna vista previa, advertencia o dato extraído sustituye snapshots,
  cálculos o validaciones autoritativas.

## Validación reproducible

El smoke documental vigente se ejecuta con:

```bash
npm run test:inventory-docs
```

Cubre tipos válidos, MIME o Base64 falsos, archivos corruptos o excesivos,
sanitización y autenticación. La reconciliación de Recepciones debe cubrir además
proveedor, documento y totales reconocidos, cantidades mayores a lo pendiente,
líneas ajenas, confirmación humana y ausencia de stock antes de
`confirmarRecepcion`.
