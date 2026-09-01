# Importación de inventario y documentos comerciales

## Estado y alcance

Este documento separa los flujos implementados y sus efectos. La
lectura de un archivo nunca constituye por sí sola una adquisición ni autoriza
un movimiento de stock. La [`SPEC 016`](specs/016-vision-post-demo-bruno.md)
clasifica la Compra directa documental V3 implementada en BRUNO POST-DEMO B.

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

El código conserva un adaptador documental para PDF, JPG, JPEG, PNG y WebP de
hasta 5 MB. Valida el archivo en frontend y backend, envía temporalmente Base64
a la callable autenticada `normalizeInventoryDocument` y usa Gemini multimodal
para proponer datos. No existe OCR local ni fallback heurístico para PDF o
imágenes; si Gemini no está disponible, el análisis falla de forma controlada.

El documento fuente se procesa en memoria y no se persiste en Firestore ni
Firebase Storage. En Nueva compra, los candidatos se vinculan a Proveedores e
Inventario existentes y sólo llegan al borrador después de revisión humana. El
adaptador no crea maestros ni confirma documentos.

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
este concepto. El acceso documental desde Inventario conduce a Nueva compra; no
convierte una factura en carga maestra. El extractor se conserva y reutiliza,
mientras la carga tabular Excel/CSV permanece sin cambios.

## C. Implementado: factura de compra directa

El flujo implementado es:

```text
Factura/documento → Nueva compra → revisión humana → confirmar → entrada a stock
```

`/compras/nueva` ofrece `Importar factura` y reutiliza
`normalizeInventoryDocument` con contexto de Compra. Propone emisor/proveedor,
folio, fechas, líneas, cantidades, costos, descuentos, Neto, IVA/tasa y Total.
El match de proveedor prioriza identificación fiscal y usa nombre sólo como
fallback revisable; nunca crea un Proveedor. Las líneas intentan barcode, código
interno y nombre/descripción, y quedan como vinculadas, por revisar o sin
coincidencia. Toda línea debe resolverse contra un ítem existente antes de
aplicar.

Aplicar la propuesta sólo completa el borrador y persiste metadatos sanitizados;
no mueve stock ni conserva Base64. Al confirmar, Functions revalida proveedor e
ítems, y una Compra V3 `stockGestionadoPor: compra_directa` incrementa sólo
productos con movimiento autoritativo e idempotente. No actualiza `costoBase`,
promedio, último costo ni historial visual.

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
ejemplo, corrigiendo el antecedente comercial o mediante una Compra directa
separada— sin debilitar la trazabilidad de la OC.

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

`node scripts/purchase-document-import-smoke.mjs` cubre match fiscal y por
nombre, vínculos por barcode/código interno/nombre, revisión manual, bloqueo de
líneas sin resolver y datos tributarios. `purchases-integrated-local.mjs` prueba
que importar/guardar no mueve stock y que confirmar V3 directa lo aplica una
sola vez.
