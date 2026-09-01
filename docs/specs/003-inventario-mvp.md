# Inventario MVP

## Estado post-demo

**Implementado:** catálogo y stock maestro, alta manual, carga inicial desde
Excel/CSV, código de barras independiente, entrada manual, lector USB e
implementación de cámara mediante `getUserMedia`, detector nativo y fallback a
ZXing. El scanner conserva únicamente EAN-13, EAN-8, UPC-A, UPC-E y Code 128.

**QA pendiente / limitación conocida:** la cámara obtiene permiso, enciende el
dispositivo y muestra preview, pero la prueba física desktop posterior al cambio
no decodificó códigos reales de dos productos. La lectura física por cámara no
está aceptada todavía; se repetirá la prueba en un teléfono móvil al desplegar en
HTTPS. No es un bloqueo inmediato y manual/USB permanecen disponibles.

**Implementado:** en el alta manual, ValoraCloud genera siempre el código
interno; el formulario sólo informa que se asignará automáticamente. En edición
se muestra el código existente como sólo lectura y el payload manual descarta
intentos de proponer otro. El Callable `createInventoryItemWithCode` también
ignora cualquier código aportado por el cliente y consume siempre el correlativo
autoritativo. Los códigos legacy permanecen visibles.

**Compatibilidad pendiente de decisión:** Excel/CSV mantiene por ahora la
columna histórica `codigo`/`codigoSolicitado` para cargas maestras. Retirar o
reinterpretar ese contrato requiere una decisión y pruebas específicas; no se
incluye en la automatización del formulario manual. Una factura iniciada desde
un acceso relacionado con Inventario deberá conducir a Nueva compra y nunca
incorporar stock silenciosamente como carga maestra.

**Implementado BRUNO POST-DEMO C:** el detalle distingue costo base/manual,
costo promedio vigente, último costo de adquisición e historial auditable de
adquisiciones vigentes y revertidas. El saldo perpetuo de valor se inicializa de
forma lazy para productos legacy; no existe migración masiva ni una adquisición
ficticia por el baseline.

## Objetivo

Ofrecer una vista empresarial de consulta y administración para productos, servicios y actividades, con creación manual enfocada, importación local desde planillas y persistencia autoritativa multiempresa.

## Flujo principal

La ruta `/inventario` abre el listado. El encabezado permite crear un ítem, importar Excel y administrar áreas y categorías. El formulario completo no se monta en la vista principal.

La vista incluye indicadores derivados de los documentos del negocio activo, búsqueda por código o nombre, filtros por tipo, área, categoría y estado, tabla en escritorio y tarjetas en móvil. El estado vacío ofrece creación e importación sin mostrar un formulario permanente.

## Modelo vigente

Los documentos operacionales viven en:

```text
negocios/{businessId}/inventario/{itemId}
```

Campos canónicos nuevos:

- `modeloInventarioVersion`;
- `codigoInterno`;
- `negocioId`;
- `tipoItem`;
- `nombre`;
- `descripcion`;
- `unidad`;
- `costoBase`;
- `margenDeseado`;
- `precioInterno`;
- `precioManual`;
- `formacionPrecioVersion`, `tasaImpuestoCompra`, `montoImpuestoCompra`,
  `costoPagado` y `precioVentaSugerido`, sólo para productos que usan
  explícitamente la formación de precio con impuesto de compra;
- `estado`;
- `areaId` y `categoriaId`, solo cuando se seleccionan;
- `categoria`, como etiqueta compatible con consumidores actuales;
- `stock`, `stockMinimo` y `unidadStock`, solo para productos;
- `barcode`, opcional y separado del código interno y del código de proveedor,
  solo para productos físicos; `codigoBarras` se lee únicamente como alias legacy;
- `proveedorNombre`, `proveedorRut`, `fechaCompraReferencia` y
  `numeroFacturaReferencia`, opcionales y sólo para productos creados o editados
  manualmente como referencia inicial de origen de compra;
- `modeloCostoInventarioVersion`, `valorInventario`,
  `valorInventarioMoneda` y `baselineCostoInventario`, cuando una operación de
  stock inicializa o mantiene el saldo económico autoritativo;
- `costoPromedio`, `costoPromedioMoneda`, `ultimoCosto`, `ultimoProveedor` y
  referencia a la última adquisición vigente demostrable;
- campos de auditoría autoritativos.

El historial canónico vive en
`negocios/{businessId}/adquisicionesInventario/{adquisicionId}`. Las nuevas
adquisiciones de Recepción o Compra directa conservan origen real,
producto/proveedor, cantidad, costo neto, descuento, impuesto, costo pagado,
moneda, stock/valor/promedio anterior y posterior, documentos que realmente
existan, estado y autoría. Un documento legacy sin `estado` se interpreta como
vigente; una reversión lo conserva marcado `revertida`. Sólo Functions escribe
este ledger.

## Economía de inventario

- `costoBase` es el costo comercial/manual editable del maestro; no cambia por
  adquisiciones y continúa alimentando la formación de precio legacy.
- `valorInventario` es el saldo económico autoritativo del stock en una moneda.
  Si `Q = stock`, `costoPromedio = V / Q` cuando `Q > 0`; con `Q = 0`, V debe ser
  cero y el promedio queda nulo. Una salida normal que consume exactamente todo
  Q retira el V restante; una salida parcial conserva el promedio vigente. Las
  nuevas mutaciones físicas exigen cantidades representables con un máximo de
  seis decimales y fallan antes de persistir si exceden esa precisión; sólo el
  ruido numérico interno se normaliza. Un sobreconsumo material continúa
  bloqueado. La reversión de Compra no usa la regla de cierre: resta siempre la
  cantidad y el costo original de la adquisición y bloquea un saldo imposible.
- `ultimoCosto` es el costo pagado unitario de la última adquisición vigente que
  puede demostrarse; nunca se reemplaza por `costoBase` ni por el promedio.
- `adquisicionesInventario` es el ledger histórico. Recepciones y Compras
  directas crean entradas deterministas; `AJUSTE_STOCK` no es una adquisición.
- Ventas y materiales de Trabajos congelan un costo histórico inmutable. Sus
  cancelaciones/devoluciones reponen exactamente ese snapshot, sin recalcularlo.

Un producto legacy se inicializa al primer cambio autoritativo de stock: usa
primero un `costoPromedio` válido y, si falta, el fallback histórico ya definido
por `legacyPaidCost`. La metadata mínima del baseline queda persistida, sin
crear proveedor, OC, Recepción o adquisición falsos. No hay conversión FX; una
moneda incompatible bloquea la operación. Cuando Q/V son cero, una adquisición
nueva puede fijar la moneda autoritativa de su propio saldo; un ajuste positivo
no reutiliza una referencia histórica de otra moneda como si hubiera sido
convertida.

Las reservas y solicitudes internas no son accesibles mediante el SDK cliente:

```text
negocios/{businessId}/inventarioContadores/{tipoItem}
negocios/{businessId}/inventoryCreateRequests/{requestId}
negocios/{businessId}/inventoryImportRequests/{requestId}
negocios/{businessId}/inventoryCodeKeys/{codeKeyId}
negocios/{businessId}/inventoryBarcodeKeys/{barcodeHash}
negocios/{businessId}/inventoryStatusRequests/{requestId}
```

## Tipos de ítem

- Producto: ítem físico. Incluye stock disponible, stock mínimo, unidad de stock e indicador de stock bajo.
- Servicio: prestación valorizada. No persiste campos de stock.
- Actividad: trabajo o tarea valorizada. No persiste campos de stock.

Los campos comunes son nombre, unidad, costo base unitario, recargo porcentual persistido por compatibilidad como `margenDeseado`, precio interno calculado, ajuste manual opcional, descripción y estado activo. Área y categoría son opcionales. Una categoría seleccionada siempre debe pertenecer a un área activa.

La referencia inicial de compra no crea Proveedores, Compras, Recepciones,
movimientos económicos ni movimientos adicionales de stock. Los productos
legacy sin esos campos se adaptan con valores vacíos y no requieren migración.

## Códigos de barras

El barcode se normaliza con `trim`, conserva ceros iniciales y debe ser único entre productos activos del mismo negocio. La reserva por hash se crea, cambia o libera autoritativamente al crear, editar, archivar o reactivar. La búsqueda del listado incluye barcode. El componente común admite ingreso manual, lector USB terminado en Enter y contiene la implementación de cámara bajo demanda con `getUserMedia`, `BarcodeDetector` o ZXing; siempre detiene pistas, decoder, timers y captura al detectar, cancelar o desmontar, y conserva ingreso manual como fallback. La decodificación física por cámara continúa pendiente de QA satisfactoria, incluida una prueba móvil sobre HTTPS.

## Cálculo de precio

Servicios, actividades y productos históricos conservan la fórmula anterior:

```text
precio calculado = costo base + (costo base × recargo / 100)
```

Los productos con `formacionPrecioVersion = 2` separan el costo unitario neto, el impuesto pagado en la compra y el desembolso usado como base comercial:

```text
monto impuesto compra = costo base × tasa impuesto compra / 100
costo pagado = costo base × (1 + tasa impuesto compra / 100)
precio venta sugerido = costo pagado × (1 + recargo / 100)
```

La tasa se elige visiblemente entre 0%, 19% o un valor personalizado entre 0% y 100%; no expresa tratamiento contable o tributario. Un ajuste manual positivo reemplaza el precio sugerido únicamente como precio final del ítem. El backend vuelve a validar números finitos, rangos no negativos y recargo máximo de 1000%.

## Unidades

El catálogo incluye unidades generales, peso, volumen, longitud, superficie y volumen. El selector usa la etiqueta “Buscar unidad”, es operable con teclado, cierra con Escape y no realiza conversiones.

## Importación local

La acción se denomina “Importar desde Excel” y admite XLSX, XLS y CSV de hasta 5 MB y 500 filas de datos. El navegador:

1. lee la primera hoja con encabezados y datos;
2. normaliza tildes y alias de encabezados;
3. transforma cada fila sin inferencias de IA;
4. muestra una vista previa editable;
5. marca errores por campo y advertencias por fila;
6. permite excluir filas;
7. envía únicamente filas incluidas y válidas después de la confirmación.

Las fórmulas no se ejecutan: la biblioteca consume el valor almacenado de la celda. El archivo no se sube a Storage, Gemini ni Functions. Las filas confirmadas se envían en lotes autoritativos de hasta 200 para respetar límites transaccionales; un archivo puede contener hasta 500 filas.

La plantilla descargable contiene:

```text
tipo,nombre,codigo,area,categoria,unidad,costo_base,margen,precio_manual,stock,stock_minimo,descripcion
```

`nombre` y `tipo` son obligatorios. Si falta el tipo, la fila queda pendiente de revisión. La plantilla conserva el esquema anterior sin inferir IVA de compra. Un código vacío se genera con el correlativo seguro. El contrato histórico admite un código aportado, lo normaliza, reserva los prefijos automáticos `PR`, `SV` y `AC`, y verifica duplicados en backend. Esta posibilidad se conserva temporalmente como compatibilidad exclusiva de carga maestra y no forma parte del alta manual; su eventual retiro requiere una decisión, adaptación y pruebas específicas.

## Backend y seguridad multiempresa

`createInventoryItemWithCode` y `confirmInventoryImportV2`:

- exigen autenticación;
- leen `businessId` desde la solicitud y validan una membresía activa;
- restringen escritura a `OWNER` y `ADMIN`;
- verifican que el negocio esté activo;
- vuelven a validar todos los campos;
- ignoran estado, identidad del usuario, negocio y timestamps enviados como autoridad;
- generan códigos y timestamps en servidor; la creación manual usa siempre el
  correlativo, mientras la importación mantiene temporalmente el código legacy
  revisado cuando fue aportado en una carga maestra;
- usan transacciones e idempotencia por `requestId`;
- validan áreas y categorías dentro del mismo negocio cuando se informan.

Las Rules permiten lectura a miembros activos, bloquean colecciones internas y restringen escrituras operacionales de inventario a `OWNER` y `ADMIN`. No se permite eliminación física.

### Hardening de stock

La edición normal se ejecuta mediante `updateInventoryItem`. `stock`, el saldo
versionado de valor, su baseline y los campos de adquisición derivados
(`costoPromedio`, `ultimoCosto`, proveedor y referencias de última adquisición)
son inmutables desde el SDK cliente. Cuando
el formulario cambia el stock actual, la Function registra en la misma
transacción un movimiento `AJUSTE_STOCK`, con stock anterior/posterior, delta,
valor anterior/posterior, costo aplicado, usuario, fecha y snapshot mínimo. El
ajuste positivo o negativo conserva el promedio vigente y se bloquea si el
costo o saldo no puede representarse con seguridad. Nombre, descripción, precios, stock mínimo y
clasificación continúan editables bajo validación autoritativa. Los ajustes usan
`requestId` y `inventoryUpdateRequests` para evitar movimientos duplicados.

## Compatibilidad legacy

La lectura adapta valores faltantes sin migrar documentos al abrir la ruta. Se admiten `sku`, `precio`, fechas legacy y ausencia de clasificación. Un producto sin `formacionPrecioVersion = 2` no recibe una tasa inferida y conserva la fórmula anterior hasta que el usuario configure explícitamente su IVA de compra. Los documentos existentes siguen visibles mediante el filtro de estado correspondiente. Cotizaciones y Valorización continúan consumiendo `nombre`, `tipoItem`, `unidad`, `costoBase`, `margenDeseado`, `precioInterno` y las banderas de precio manual existentes; `precioInterno` sigue siendo siempre el precio final.

## Criterios de aceptación

- Inventario abre como consulta y no como formulario largo.
- Los indicadores usan exclusivamente datos reales del negocio activo.
- Producto, servicio y actividad muestran campos pertinentes.
- Área y categoría no bloquean una creación básica.
- El código se asigna de forma segura al guardar.
- La lista funciona en escritorio y como tarjetas a 390 px.
- Crear, editar, archivar y reactivar son accesibles según rol.
- La carga inicial canónica desde Excel/CSV no usa IA, OCR, PDF, imágenes ni
  Storage.
- Ninguna fila se guarda antes de confirmar.
- Backend y Rules impiden acceso cruzado entre empresas.
- Los consumidores actuales continúan leyendo registros legacy y nuevos.

## Fuera de alcance

Variantes, tallas, colores, medidas configurables, imágenes, catálogo público,
ventas como módulo, conversiones de unidades, FX y migraciones masivas. Reports
V4 y Projects V3 permanecen pendientes. Los flujos
documentales/IA existentes se conservan como compatibilidad, pero una factura de
adquisición pertenece al flujo de Compra descrito como target en las SPEC 006 y
016, no al alta maestra silenciosa de Inventario.
