# Inventario MVP

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
- `costoPromedio`, `costoPromedioMoneda`, `ultimoCosto`, `ultimoProveedor` y
  referencia a la última adquisición, sólo cuando una Recepción confirmó una entrada;
- campos de auditoría autoritativos.

El historial canónico vive en `negocios/{businessId}/adquisicionesInventario/{recepcionId__lineaId}` y conserva producto/proveedor, cantidad, costo e impuesto, moneda, OC, Recepción, Compra si existe, fecha, movimiento y usuario. Sólo Functions puede escribirlo.

Las reservas y solicitudes internas no son accesibles mediante el SDK cliente:

```text
negocios/{businessId}/inventarioContadores/{tipoItem}
negocios/{businessId}/inventoryCreateRequests/{requestId}
negocios/{businessId}/inventoryImportRequests/{requestId}
negocios/{businessId}/inventoryCodeKeys/{codeKeyId}
```

## Tipos de ítem

- Producto: ítem físico. Incluye stock disponible, stock mínimo, unidad de stock e indicador de stock bajo.
- Servicio: prestación valorizada. No persiste campos de stock.
- Actividad: trabajo o tarea valorizada. No persiste campos de stock.

Los campos comunes son nombre, unidad, costo base unitario, recargo porcentual persistido por compatibilidad como `margenDeseado`, precio interno calculado, ajuste manual opcional, descripción y estado activo. Área y categoría son opcionales. Una categoría seleccionada siempre debe pertenecer a un área activa.

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

`nombre` y `tipo` son obligatorios. Si falta el tipo, la fila queda pendiente de revisión. La plantilla conserva el esquema anterior sin inferir IVA de compra. Un código vacío se genera con el correlativo seguro. Un código aportado se normaliza, no puede usar los prefijos automáticos `PR`, `SV` o `AC`, y se verifica en backend para impedir duplicados.

## Backend y seguridad multiempresa

`createInventoryItemWithCode` y `confirmInventoryImportV2`:

- exigen autenticación;
- leen `businessId` desde la solicitud y validan una membresía activa;
- restringen escritura a `OWNER` y `ADMIN`;
- verifican que el negocio esté activo;
- vuelven a validar todos los campos;
- ignoran estado, identidad del usuario, negocio y timestamps enviados como autoridad;
- generan códigos y timestamps en servidor;
- usan transacciones e idempotencia por `requestId`;
- validan áreas y categorías dentro del mismo negocio cuando se informan.

Las Rules permiten lectura a miembros activos, bloquean colecciones internas y restringen escrituras operacionales de inventario a `OWNER` y `ADMIN`. No se permite eliminación física.

### Hardening de stock

La edición normal se ejecuta mediante `updateInventoryItem`. `stock` y los
campos de adquisición derivados (`costoPromedio`, `ultimoCosto`, proveedor y
referencias de última adquisición) son inmutables desde el SDK cliente. Cuando
el formulario cambia el stock actual, la Function registra en la misma
transacción un movimiento `AJUSTE_STOCK`, con stock anterior/posterior, delta,
usuario, fecha y snapshot mínimo. Nombre, descripción, precios, stock mínimo y
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
- La importación no usa IA, OCR, PDF, imágenes ni Storage.
- Ninguna fila se guarda antes de confirmar.
- Backend y Rules impiden acceso cruzado entre empresas.
- Los consumidores actuales continúan leyendo registros legacy y nuevos.

## Fuera de alcance

Variantes, tallas, colores, medidas configurables, imágenes, catálogo público, códigos de barras o cámara, ventas, conversiones de unidades, FX, IA, Gemini, PDF, OCR y migraciones masivas.
