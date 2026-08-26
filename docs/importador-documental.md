# Importador documental multiformato

## Alcance

Desde BRUNO-06 la misma lectura y normalización también puede abrirse desde un
borrador de Recepción. En ese contexto los candidatos no crean inventario: un
adaptador los reconcilia con la OC, permite revisión humana y sólo rellena
cantidades, costos y metadatos del borrador. La confirmación autoritativa de la
Recepción sigue siendo el único paso que actualiza stock y registra la Compra.

El importador inteligente multiformato permite cargar documentos comerciales en
CSV, XLS, XLSX, PDF, JPG, JPEG, PNG y WebP. No promete aceptar cualquier
extensión informática: el alcance se limita a los formatos empresariales más
habituales para facturas, cotizaciones de proveedores, listas de precios e
inventarios.

CSV, XLS y XLSX conservan el flujo tabular existente con SheetJS, análisis local
conservador, normalización opcional mediante Gemini y vista previa editable.

PDF e imágenes usan un adaptador documental separado. El archivo se valida en
frontend y backend, se envía temporalmente en Base64 a una Cloud Function
callable autenticada, se analiza con Gemini desde backend y se descarta al
terminar la ejecución. No se guarda el documento fuente en Firestore ni Firebase
Storage.

## Arquitectura

```text
Selector de archivo
  Adaptador tabular
    CSV/XLS/XLSX -> SheetJS -> normalizeInventoryItems -> vista previa
  Adaptador documental
    PDF/JPG/PNG/WebP -> validación -> Base64 temporal
      -> normalizeInventoryDocument -> Gemini multimodal
      -> sanitización backend -> vista previa
Confirmación humana
  -> importInventoryItems -> Firestore
```

La separación evita regresiones en planillas: `normalizeInventoryItems` se
mantiene para CSV, XLS y XLSX, mientras `normalizeInventoryDocument` concentra
PDF e imágenes.

## Seguridad y privacidad

- Requiere usuario autenticado.
- Valida extensión, MIME declarado, firma binaria real y tamaño.
- Rechaza Base64 inválido, MIME falso, HTML renombrado, PDF protegido, PDF sin
  páginas detectables, PDF truncado e imágenes vacías o incompletas.
- Mantiene límite conservador de 5 MB para archivo original. Base64 aumenta el
  payload alrededor de 33%, por lo que 5 MB producen aproximadamente 6,7 MB más
  metadatos JSON.
- Procesa en memoria durante la ejecución de la Function.
- No registra Base64 ni contenido del documento.
- Los logs solo deben incluir tipo, tamaño aproximado, cantidad de candidatos,
  duración, resultado general y código de error controlado.
- No se persisten evidencia de origen, página, advertencias ni cantidad de
  origen como campos definitivos del inventario.

## Modelo y transporte

El flujo documental usa `gemini-2.5-flash` de forma aislada porque el análisis
de PDF e imágenes requiere comprensión multimodal y estructura visual. El
asistente de cotizaciones y el importador tabular siguen usando su configuración
previa.

El transporte usa callable HTTPS con Base64 para archivos pequeños. No se usa
Firebase Storage porque el documento fuente no debe quedar almacenado.

## Normalización

La IA debe devolver candidatos alineados con el inventario real:

- `nombre`
- `tipoItem`
- `categoria`
- `descripcion`
- `unidad`
- `costoBase`
- `margenDeseado`
- `sku`
- `estado`

Los campos auxiliares como confianza, cantidad de origen, advertencias,
evidencia y pagina existen solo para la vista previa. La cantidad de una factura
no se convierte en stock al guardar documentos, porque el inventario actual no
administra stock documental como entrada automática.

## Reglas semánticas

- No importar RUT, folio, razón social, direcciones, teléfonos, correos, fechas,
  forma de pago, datos bancarios, subtotal, IVA, impuestos, descuentos
  generales, despacho, recargos, total final, observaciones comerciales ni
  números de página.
- Distinguir precio unitario, cantidad y total de línea.
- Calcular costo unitario desde total de línea / cantidad solo cuando ambos
  valores existen y el cálculo es determinista.
- No inventar SKU, costo, margen ni categoría.
- No auto-seleccionar candidatos documentales con baja confianza o datos
  incompletos.
- No guardar nada sin confirmación humana.

## Pruebas reproducibles

El comando principal del flujo documental es:

```bash
npm run test:inventory-docs
```

La prueba genera buffers sintéticos en memoria y cubre:

- PDF válido.
- PNG válido.
- HTML renombrado como PDF.
- MIME falso.
- Base64 inválido.
- PDF protegido.
- PDF sin páginas.
- Archivo superior a 5 MB.
- Sanitización que descarta IVA, subtotal y total.
- Rechazo de usuario no autenticado.

Para validar Gemini real se requiere una clave `GEMINI_API_KEY` configurada en
Functions y documentos sintéticos legibles. Si no hay clave local, deben
validarse igualmente serialización, sanitización, errores y regresión de
planillas.

## Resumen técnico para tesis y defensa

La mejora incorpora ingesta documental multiformato para documentos comerciales.
El sistema conserva el importador tabular existente y agrega un adaptador
documental que procesa PDF e imágenes de forma temporal en backend. Gemini
analiza el documento completo, incluyendo disposición visual, tablas, columnas,
filas, cantidades y precios, para identificar líneas comerciales candidatas.

Los resultados se normalizan hacia el esquema canónico del inventario y pasan
por controles de calidad: validación de tipo de archivo, sanitización de campos,
exclusión de metadatos administrativos, detección de ambigüedades, confianza y
advertencias. Ningún documento fuente se almacena y ningún candidato se guarda
sin revisión y confirmación humana.

Esta arquitectura mantiene continuidad con CSV, XLS y XLSX, reduce riesgo de
regresión, protege datos comerciales sensibles y permite explicar el flujo como
un proceso de asistencia documental con control humano, no como automatización
ciega de inventario.
