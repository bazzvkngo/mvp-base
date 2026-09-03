# SPEC 020 — Adicionales facturables y evidencia de gastos en Proyectos

## 1. Propósito y estado

Cerrar el último pendiente funcional del roadmap post-demo (SPEC 016 §F,
ítem 5 del orden sugerido §8) con dos capacidades relacionadas pero
independientes de Proyecto: (A) registrar y eventualmente cobrar un
adicional solicitado por el cliente durante la ejecución, y (B) adjuntar
evidencia documental a un gasto ya existente. Ninguna comparte persistencia
ni flujo con la otra.

- Fecha conceptual: 3 de septiembre de 2026.
- Estado: especificada; implementación pendiente.
- Alcance: Core de ValoraCloud (Proyectos/Trabajos, Ventas). Las verticales
  estudiantiles quedan excluidas.
- Precedencia: `AGENTS.md` conserva autoridad máxima. SPEC 012 sigue siendo
  la única definición del modelo de Trabajos/costos; SPEC 017 (Margen
  Comercial V1), SPEC 018 (Reports V4) y el balance de `workBalance.js`
  permanecen intactos y no se redefinen en ningún punto. SPEC 019 (tablero
  de tareas) no se toca.

## 2. Principios obligatorios

1. Los documentos comerciales históricos (Cotizaciones cerradas, Ventas
   confirmadas) permanecen inmutables. Ningún adicional edita, reabre ni
   reescribe un documento ya emitido/confirmado.
2. Un adicional nunca crea una Venta automáticamente. La creación de la
   Venta sigue siendo un acto humano explícito, con el contrato ya existente
   de `crearVenta`/`confirmarVenta`.
3. `calculateWorkBalance` (`functions/workBalance.js`) no se modifica: su
   fórmula, sus fuentes de ingreso (Venta confirmada) y de costo (materiales,
   HH, gastos) siguen siendo exactamente las mismas.
4. `calculateSaleCommercialMarginV1` no se modifica ni se duplica.
5. Un adicional facturable (concepto comercial cobrable) y un gasto (costo
   del Proyecto) son conceptos distintos que no se generan automáticamente
   el uno al otro.
6. La evidencia es un adjunto de un gasto ya existente, no un modelo
   contable nuevo. Adjuntar o quitar evidencia nunca cambia `monto`,
   `categoria`, `clasificacionCosto` ni `estado` del gasto, y por lo tanto
   nunca recalcula el balance.
7. No se crea ningún permiso RBAC nuevo. Se reutilizan `WORK_OPERATION_ROLES`,
   `WRITE_ROLES` (OWNER/ADMIN) y el contrato de Ventas ya existente
   (`sales.write`).
8. Sin OCR, sin IA, sin extracción contable, sin SII, sin facturación
   electrónica, sin conciliación de pagos.

## 3. Flujo actual (auditado, sin cambios)

### 3.1 Gastos de Proyecto

`negocios/{businessId}/trabajos/{trabajoId}/gastos/{gastoId}`, escritura
exclusiva de Functions (`firestore.rules:918-923`, `allow create, update,
delete: if false`). Contrato real (`adaptWorkExpense`,
`src/domain/workModel.mjs:282-305`): `gastoId`, `modeloGastoVersion`,
`concepto`, `monto`, `categoria` (MATERIAL/MANO_DE_OBRA/OPERATIVO/
SERVICIO_EXTERNO/ADMINISTRATIVO/OTRO), `clasificacionCosto` (DIRECTO/
INDIRECTO), `moneda`, `responsableDelGastoUid`+snapshot,
`registradoPorUid`+snapshot, `fecha`, `observacion`, `tareaId` opcional,
`estado` (vigente/anulado), `creadoEn`, `anuladoEn`+`anuladoPorUid`+snapshot,
`motivoAnulacion`.

`registrarGastoTrabajoHandler` (`functions/workPersistence.js:1117-1184`):
transaccional, idempotente vía `requestId`+fingerprint, exige
`WORK_OPERATION_ROLES` (OWNER/ADMIN/TECNICO/MEMBER) con autoatribución
obligatoria para TECNICO/MEMBER (`memberLinkedUid`), bloqueado si el
Proyecto es terminal (`assertWorkCostsMutable`), actualiza contadores
agregados en el documento del trabajo (`gastosMontoTotal`, etc.) y agrega un
evento `gasto_registrado` al historial.

`anularGastoTrabajoHandler` (líneas 1256-1301): sólo `WRITE_ROLES`
(OWNER/ADMIN), exige motivo, transición única `vigente → anulado`,
append-only (nunca edita `monto`/`concepto`). El registro nunca se elimina.

`calculateWorkBalance` (`functions/workBalance.js`) lee la colección
`gastos` completa en cada cálculo (no los contadores agregados del
documento del trabajo, que sólo sirven para vistas rápidas de lista) y
excluye gastos categoría `MATERIAL` del costo cuando ya existe libro de
inventario, para no imputar dos veces.

### 3.2 Ventas y su relación con Proyecto

Una Venta puede llevar `trabajoId` (vínculo ya existente, expediente
comercial de SPEC 012). El ingreso del balance de Proyecto proviene
exclusivamente de `sale.total` de Ventas `confirmada` vinculadas por
`trabajoId`. Crear una Venta directa exige `clienteId` y al menos una línea
válida; **cada línea exige un `itemId` real de Inventario** salvo el caso
específico de una línea de servicio/actividad heredada de una Cotización
aceptada (`src/domain/saleModel.mjs:143`,
`optional: Boolean(raw.cotizacionId) && item.tipoItem !== "producto"`). Es
decir: **una Venta creada directamente (no desde Cotización) no admite
líneas de texto libre sin respaldo de catálogo**, ni para productos ni para
servicios/actividades.

Existe ya un precedente de efecto cruzado Venta → Proyecto dentro de la
misma transacción de confirmación: `writeSaleConfirmationEvent`
(exportado por `workPersistence.js`, invocado desde `salePersistence.js` al
confirmar una Venta vinculada) agrega el evento `venta_confirmada` al
historial del Proyecto. Este es el mecanismo que se reutiliza en §5.

### 3.3 Storage y su patrón de evidencia ya existente

`storage.rules` ya implementa exactamente el patrón que esta SPEC necesita,
para evidencia de verificación empresarial
(`negocios/{businessId}/verificacion/{ownerUid}/{requestId}/{fileName}`):

- El cliente sube el archivo **directamente a Storage** con el SDK,
  gobernado por Storage Rules (no hay URL firmada de subida ni Function
  intermediaria para el upload en sí).
- Storage Rules consulta Firestore en línea (`firestore.get`/
  `firestore.exists`) para validar pertenencia/rol antes de permitir el
  `create`.
- `allow create: if resource == null && ...` — sólo primera escritura,
  nunca reemplazo in-place; tamaño y `contentType` acotados
  (`application/pdf|image/(jpeg|png)`, 5 MB).
- `allow delete` sólo antes de que la Function persista el registro que
  referencia esa evidencia (rollback de un intento fallido); una vez
  asociada, la evidencia queda inmutable — coincide con el invariante de
  AGENTS.md de no permitir eliminación física de registros referenciados.
- Lectura vía URL firmada temporal generada por una Function
  (`obtenerDocumentoVerificacionPlataforma`, vigencia 10 minutos), no acceso
  directo del SDK cliente al bucket.

Este patrón se reutiliza casi sin cambios para la evidencia de gastos
(§7-9).

## 4. Adicionales facturables

### 4.1 Definición (SPEC 016 §F, sin ampliar)

Un adicional facturable es un **concepto comercial pendiente de cobro**
originado durante la ejecución de un Proyecto, distinto de HH/gastos/
materiales internos, que:
- consumirá stock cuando corresponda a un producto (igual que cualquier
  línea de Venta con producto real, vía el mecanismo Q/V ya existente —
  NO se inventa un segundo camino de descuento de stock);
- incrementará el cobro asociado al Proyecto **sólo cuando efectivamente se
  incorpore a una Venta confirmada**, nunca antes;
- no se cobra automáticamente para HH, comida, combustible ni gastos
  internos (eso permanece como gasto, sin cambios).

### 4.2 Brecha confirmada

No existe ningún código que implemente esto. Se buscó explícitamente
"adicional"/"facturable"/"billable" en todo `functions/` y `src/`: el único
concepto "adicional" real es `materialesAdicionales`, un bucket de **costo**
dentro de `calculateWorkBalance` (consumos físicos vía
`registrarSalidaMaterialTrabajo`), que nunca toca Ventas ni Cotizaciones.
No hay ningún camino que toque simultáneamente inventario/costo y
cobro/ingreso.

### 4.3 Escenario de referencia

```text
Proyecto en ejecución
  → cliente solicita trabajo/material adicional
  → se registra un Adicional (estado PENDIENTE_COBRO)
  → queda visible en la ficha del Proyecto, sin efecto comercial todavío
  → eventualmente, al crear una Venta nueva vinculada al Proyecto,
    el usuario selecciona adicionales pendientes como líneas
  → al confirmar esa Venta, cada adicional incorporado pasa a
    INCORPORADO_A_VENTA con referencia a la línea real
```

Explícitamente NO:
- no modifica ninguna Cotización histórica;
- no modifica ninguna Venta ya confirmada;
- no crea una Venta por sí solo;
- no altera ningún snapshot histórico.

## 5. Contrato del Adicional

### 5.1 Colección

```text
negocios/{businessId}/trabajos/{trabajoId}/adicionales/{adicionalId}
```

Misma forma de aislamiento y el mismo patrón de Rules que `gastos`
(§3.1): escritura exclusiva de Functions, lectura acotada por membresía y
por el mismo predicado de visibilidad de costos ya usado por gastos
(`canReadWorkCosts`), sin ampliar su alcance.

### 5.2 Campos (sólo los justificados; ningún impuesto nuevo)

- `adicionalId`, `negocioId`, `trabajoId` — identidad y aislamiento, igual
  patrón que `gastos`.
- `modeloAdicionalVersion` — versionado, mismo patrón que
  `modeloGastoVersion`/`modeloTareaVersion`.
- `itemId`, `tipoItem` (producto/servicio/actividad), `cantidad`,
  `precioUnitario` — **exactamente el mismo contrato de línea que ya usa
  Ventas/Cotizaciones** (`src/domain/saleModel.mjs`), porque el adicional es,
  conceptualmente, una línea de Venta en espera. `itemId` es obligatorio,
  igual que en la creación directa de una Venta (§3.2): un adicional no
  puede ser texto libre sin respaldo de catálogo, la misma restricción que
  ya aplica a cualquier línea de Venta.
- `moneda` — heredada del Proyecto (mismo criterio que `gastos`/HH/
  materiales: primera operación financiera fija la moneda del trabajo).
- `descripcion` opcional (contexto adicional para el cliente/el equipo,
  igual patrón que `observacion` en gastos).
- `tareaId` opcional, validado dentro del mismo Proyecto (igual patrón que
  gastos/HH/materiales).
- `estado`: ver §5.3.
- `registradoPorUid`+snapshot, `creadoEn` — igual patrón que gastos.
- `ventaId`+`lineaId` — referencia comercial posterior, sólo presente
  cuando `estado === INCORPORADO_A_VENTA` (§6).
- `anuladoPorUid`+snapshot, `anuladoEn`, `motivoAnulacion` — igual patrón
  que gastos, sólo presentes si `estado === ANULADO`.

No se inventa ningún campo de impuesto: el adicional no calcula IVA ni
ningún tributo — ese cálculo sigue perteneciendo exclusivamente a la Venta
que eventualmente lo incorpore, con la fórmula ya existente y sin cambios.

### 5.3 Estados

```text
PENDIENTE_COBRO → INCORPORADO_A_VENTA
PENDIENTE_COBRO → ANULADO
```

Nombres elegidos por consistencia con el vocabulario ya usado en el Core
(`vigente`/`anulado` de gastos y HH ya existen; se usa `PENDIENTE_COBRO` en
vez de un genérico "PENDIENTE" para dejar explícito, en el propio nombre
del estado, que es un concepto comercial en espera de cobro, no una tarea
ni un gasto). `ANULADO` es una transición terminal (mismo patrón que
gastos: nunca se reactiva un adicional anulado, se crea uno nuevo si
corresponde). `INCORPORADO_A_VENTA` es igualmente terminal: un adicional ya
incorporado no puede anularse ni volver a incorporarse — su historia queda
fija en la Venta que lo materializó, igual que un efecto de inventario ya
congelado.

No existe un cuarto estado "RECHAZADO_POR_CLIENTE" ni similar: si el
cliente no acepta el adicional, el equipo simplemente lo anula con motivo
(reutiliza `ANULADO`, sin ampliar el vocabulario de estados).

## 6. Relación con Ventas (gate crítico)

### 6.1 Decisión de diseño

Ningún Function nuevo crea Ventas. El flujo reutiliza el contrato existente
de creación/confirmación de Venta sin ninguna modificación a su fórmula
económica:

1. **Selección (frontend, sin backend nuevo):** al crear una Venta nueva
   vinculada al Proyecto (`trabajoId` ya seleccionable hoy), un selector
   nuevo y pequeño (`AdditionalSelector`, mismo patrón que
   `WorkQuoteSelector.jsx` de PROJECTS_V3 ETAPA 1: `ResponsiveDialog` +
   filtro en memoria sobre adicionales `PENDIENTE_COBRO` ya cargados del
   Proyecto) permite incorporar uno o más adicionales como líneas del
   borrador. Cada adicional preselecciona `itemId`/`tipoItem`/`cantidad`/
   `precioUnitario` tal cual — el usuario puede ajustar cantidad/precio
   antes de confirmar, igual que con cualquier línea manual hoy.
2. **Marca de origen (cambio mínimo y acotado en Ventas):** cada línea de
   Venta gana un campo **opcional** nuevo, `origenAdicionalId` (string
   vacío por defecto, retrocompatible: una línea sin este campo se comporta
   exactamente igual que hoy). No participa en ningún cálculo de
   `calculateSaleTotals` ni de Margen V1 — es puramente una referencia de
   trazabilidad.
3. **Cierre atómico al confirmar (cambio mínimo y acotado en
   `confirmarVenta`):** dentro de la MISMA transacción que ya ejecuta
   `confirmarVenta` (ya idempotente, ya revalida stock/costo), para cada
   línea con `origenAdicionalId` no vacío se actualiza el adicional
   referenciado de `PENDIENTE_COBRO` a `INCORPORADO_A_VENTA` con
   `ventaId`+`lineaId`. Se valida que el adicional exista, pertenezca al
   mismo `trabajoId` que la Venta y siga `PENDIENTE_COBRO`; si no, la
   confirmación de la Venta falla completa (misma atomicidad que ya aplica
   a la validación de stock/costo) — nunca queda una Venta confirmada con un
   adicional huérfano o un adicional cerrado sin Venta real.
4. **Reutiliza el mecanismo cruzado ya existente:** este bloque se agrega
   junto a `writeSaleConfirmationEvent` (§3.2), el mismo punto donde
   `salePersistence.js` ya escribe efectos en el Proyecto vinculado al
   confirmar — no se crea un mecanismo de comunicación cruzada nuevo, se
   extiende el que ya existe.

### 6.2 Por qué esto no rompe nada existente

- No se edita ninguna Venta confirmada: la Venta que incorpora adicionales
  es SIEMPRE una Venta nueva, creada y confirmada por el flujo ya existente.
- No se edita ninguna Cotización: los adicionales no tienen ningún vínculo
  con Cotizaciones.
- No se duplica ingreso: el ingreso del Proyecto sigue siendo,
  exclusivamente, `sale.total` de Ventas confirmadas vinculadas — un
  adicional `PENDIENTE_COBRO` nunca aporta valor comercial al balance
  (§11). Sólo cuando se convierte en una línea real de una Venta confirmada
  aporta valor, exactamente una vez, por el mismo camino que cualquier otra
  línea.
- No se duplica costo: si el adicional es un producto, el descuento de
  stock ocurre exactamente donde ya ocurre hoy (al confirmar la Venta, vía
  el motor Q/V existente) — nunca en el momento de crear el adicional.
- No rompe Margen Comercial V1: la fórmula sigue leyendo `tipoItem`/
  `efectosInventario[].costoTotal` de la Venta confirmada, sin ningún campo
  nuevo que la altere; `origenAdicionalId` es invisible para
  `calculateSaleCommercialMarginV1`.
- No rompe el balance de Proyecto: `calculateWorkBalance` sigue sin
  conocer la existencia de adicionales; sólo ve la Venta confirmada
  resultante, igual que hoy.

## 7. Costo vs. precio (aclaración explícita)

- Un **adicional facturable** es un concepto comercial (precio al cliente).
  No genera ningún gasto ni movimiento de costo por sí solo.
- Un **gasto** es un costo del Proyecto. No es facturable por sí solo.
- Si un adicional es un producto físico, su único efecto de costo es el ya
  existente: el descuento de stock a costo congelado cuando la Venta que lo
  contiene se confirma (mismo mecanismo Q/V de siempre, cero código nuevo
  de costeo).
- Si el equipo incurre en un costo interno relacionado con atender el
  adicional (por ejemplo, HH extra), eso se registra como gasto/HH normal,
  de forma independiente — esta SPEC no crea ningún vínculo automático
  entre un adicional y un gasto. Vincularlos sería inventar margen: se
  evita explícitamente.

## 8. Evidencia de gastos

### 8.1 Brecha confirmada

README ya declara "sin archivos adjuntos en el estado actual" (SPEC 012
§Límites). Confirmado ausente en código: `adaptWorkExpense` no tiene ningún
campo de adjunto; no existe ninguna ruta de Storage bajo `trabajos/.../
gastos/...`.

### 8.2 Diseño: adjunto del gasto existente, no un modelo nuevo

La evidencia se modela como un **arreglo de metadatos de archivo dentro del
mismo documento de gasto ya existente** (`evidencia: [...]`), no como una
subcolección ni un documento aparte — el gasto sigue siendo la única
entidad autoritativa; la evidencia es información adjunta a él.

Cada entrada: `storagePath`, `nombreArchivo`, `tipoMime`, `tamanoBytes`,
`subidoPorUid`+snapshot, `subidoEn`. Máximo razonable por gasto (a definir
en implementación, ej. 5 archivos) para acotar el tamaño del documento —
sin necesidad excesiva de configurabilidad.

Tipos permitidos: PDF, JPG, PNG (mismos tipos ya validados por la evidencia
de verificación empresarial — boleta/factura/recibo escaneado o
fotografiado). Tamaño máximo por archivo: 5 MB (mismo límite ya usado por
verificación empresarial, ningún nuevo umbral que inventar).

Explícitamente fuera: OCR, extracción de datos, IA, SII, factura
electrónica — la evidencia es sólo un respaldo visual/documental que un
humano puede abrir y mirar.

## 9. Storage

### 9.1 Ruta propuesta

```text
negocios/{businessId}/trabajos/{trabajoId}/gastos/{gastoId}/{fileName}
```

Sigue exactamente el patrón ya usado por verificación empresarial (§3.3):
cada segmento de ruta corresponde a un ID ya validable contra Firestore
(negocio → trabajo → gasto), sin introducir ningún patrón de ruta nuevo.

### 9.2 Reglas propuestas (documentadas aquí; no se modifican todavía)

Mínimo necesario, extendiendo `storage.rules` con un bloque nuevo, sin
tocar los bloques ya existentes:

```text
match /negocios/{businessId}/trabajos/{workId}/gastos/{expenseId}/{fileName} {
  allow read: if canAccessBusiness(businessId)
    && firestore.exists(.../trabajos/$(workId)/gastos/$(expenseId))
    && firestore.get(.../trabajos/$(workId)/gastos/$(expenseId)).data.negocioId == businessId
    && firestore.get(.../trabajos/$(workId)/gastos/$(expenseId)).data.trabajoId == workId;

  allow create: if resource == null
    && request.resource != null
    && canOperateWorkCosts(businessId)   // rol OWNER/ADMIN/TECNICO/MEMBER, mismo set que WORK_OPERATION_ROLES
    && request.resource.size > 0
    && request.resource.size <= 5 * 1024 * 1024
    && request.resource.contentType.matches('application/pdf|image/(jpeg|png)')
    && firestore.exists(.../trabajos/$(workId)/gastos/$(expenseId))
    && firestore.get(.../trabajos/$(workId)/gastos/$(expenseId)).data.negocioId == businessId
    && firestore.get(.../trabajos/$(workId)/gastos/$(expenseId)).data.trabajoId == workId
    && firestore.get(.../trabajos/$(workId)/gastos/$(expenseId)).data.estado == "vigente";

  allow delete: if false; // evidencia asociada a un gasto nunca se borra físicamente
}
```

`canOperateWorkCosts(businessId)` es una función nueva y pequeña dentro de
`storage.rules`, análoga a `canManageBusiness` ya existente, que verifica
`businessMembership(businessId).data.rol in ["OWNER","ADMIN","TECNICO","MEMBER"]`
— el mismo conjunto de roles que `WORK_OPERATION_ROLES` en Functions, sin
inventar un rol nuevo.

El registro del archivo en el documento del gasto (el arreglo `evidencia`)
lo hace una Function nueva y pequeña (§15), no Storage Rules — Storage
Rules sólo protege el archivo en sí, igual que en verificación empresarial.

### 9.3 Por qué es compatible con los patrones existentes

- Mismo mecanismo de subida directa del cliente ya usado dos veces
  (logo, verificación).
- Mismo mecanismo de validación cruzada Storage↔Firestore ya usado.
- Mismo límite de tamaño/tipo ya usado por verificación empresarial (no se
  inventa un umbral nuevo).
- Mismo patrón de inmutabilidad (`create` sólo si `resource == null`,
  ningún `update`, `delete` cerrado) — más estricto incluso que
  verificación empresarial, porque aquí no existe una ventana de rollback
  (el registro en Firestore de un gasto es previo a la evidencia, no
  posterior como en verificación).

## 10. Seguridad

- `businessId` se valida en cada capa: Storage Rules (vía
  `firestore.get`/`firestore.exists`), y la Function de registro de
  evidencia revalida `negocioId`/`trabajoId` del gasto contra el contexto
  autenticado (mismo patrón que `assertWork` ya usa en todo
  `workPersistence.js`).
- El gasto debe pertenecer al trabajo, y el trabajo al negocio — ya
  garantizado por el patrón `assertWork`/`assertWorkCostsMutable` existente,
  reutilizado sin cambios.
- El usuario debe tener un rol real de operación (§12); no se confía en
  ningún dato enviado por el cliente sin revalidar contra la membresía
  activa.
- La ruta de archivo no permite acceso cross-tenant: cada segmento de la
  ruta debe coincidir exactamente con los IDs verificados vía Firestore
  dentro de la propia regla — un intento de leer/escribir una ruta con un
  `businessId`/`workId`/`expenseId` que no correspondan entre sí falla
  porque el documento de gasto consultado por Storage Rules no existirá
  con esa combinación, o sus campos `negocioId`/`trabajoId` no coincidirán.
- Rules actuales de Firestore ya soportan el flujo sin cambios: `gastos`
  ya es de sólo lectura para el SDK cliente y de escritura exclusiva de
  Functions; el nuevo campo `evidencia` se escribe por la misma vía
  (Function autoritativa), sin abrir ninguna escritura directa nueva.
- El único cambio real de Rules es el bloque nuevo de Storage (§9.2); no se
  debilita ningún bloque existente.

## 11. Ciclo de vida del archivo

- **Subida:** el cliente sube directamente a Storage (Rules protegen la
  escritura), luego llama a la Function de registro (§15) para anexar los
  metadatos al gasto. Si la llamada a la Function falla después de una
  subida exitosa, el archivo queda huérfano en Storage sin estar
  referenciado por ningún gasto — aceptable (mismo riesgo residual que ya
  existe en verificación empresarial, mitigado allí por una ventana de
  rollback; aquí no hace falta rollback porque el archivo huérfano nunca es
  visible ni accesible sin la referencia en Firestore, dado que la regla de
  lectura exige que el gasto exista y coincida).
- **Múltiples archivos:** un gasto puede tener más de un adjunto (tope
  razonable a definir en implementación); no existe "reemplazo" de un
  archivo ya subido — cada subida es un nuevo elemento del arreglo
  `evidencia`, preservando trazabilidad (coincide con `allow create: if
  resource == null`, que impide sobrescribir).
- **Visualización/descarga:** lectura directa vía el SDK cliente (a
  diferencia de verificación empresarial, que usa URL firmada porque su
  colección es más sensible/regulatoria) es aceptable aquí porque el propio
  documento de gasto ya es legible por los mismos roles que verían el
  archivo — no se introduce una exposición mayor a la que ya existe para el
  gasto mismo. Si en implementación se prefiere una URL firmada por
  paralelismo con verificación empresarial, es una decisión de UI que no
  cambia este contrato.
- **Anulación del gasto:** la evidencia NO se borra. Un gasto anulado
  conserva su evidencia como parte de su trazabilidad histórica, igual que
  conserva `concepto`/`monto`/`motivoAnulacion`. La UI debe seguir
  mostrando la evidencia de un gasto anulado (de sólo lectura), nunca
  ocultarla.
- **Borrado lógico/físico:** no existe ningún borrado, ni lógico ni físico,
  de evidencia ya asociada — coincide con `allow delete: if false` (§9.2) y
  con el invariante de AGENTS.md de no eliminar físicamente registros
  referenciados.

## 12. Balance de Proyecto (confirmación explícita)

- Adjuntar evidencia a un gasto **no** cambia `monto`, `categoria`,
  `clasificacionCosto` ni `estado` del gasto — la Function de registro de
  evidencia (§15) sólo escribe el arreglo `evidencia`, ningún otro campo.
- Adjuntar un archivo **no** dispara ningún recálculo de balance:
  `calculateWorkBalance` no lee el campo `evidencia` en absoluto.
- Un adicional en estado `PENDIENTE_COBRO` **nunca** aporta valor comercial
  al balance de Proyecto ni a Reports V4 — el balance sigue derivándose
  exclusivamente de Ventas `confirmada`, sin excepción.
- Un adicional sólo afecta el ingreso del Proyecto en el mismo instante en
  que la Venta que lo incorpora se confirma — nunca antes, nunca por
  duplicado (la transición atómica `PENDIENTE_COBRO → INCORPORADO_A_VENTA`
  de §6.1 impide que el mismo adicional se incorpore dos veces).
- No se duplica ingreso entre el "adicional" y la "Venta": el adicional no
  tiene nunca un campo de ingreso propio — su único valor comercial vive en
  la línea de la Venta que lo materializa.
- El balance de Proyecto (`calculateWorkBalance`) y Margen Comercial V1
  (`calculateSaleCommercialMarginV1`) no se redefinen: cero cambios a su
  código.

## 13. RBAC

Auditado, sin crear ningún permiso nuevo:

| Acción | Rol requerido | Mecanismo reutilizado |
|---|---|---|
| Ver Proyecto / ver adicionales / ver gastos y su evidencia | Cualquier miembro activo con `works.read` (con la restricción TECNICO/MEMBER ya existente vía `canReadWorkCosts`) | Igual que hoy para `gastos` |
| Crear adicional | `WORK_OPERATION_ROLES` (OWNER/ADMIN/TECNICO/MEMBER) | Igual patrón que `registrarGastoTrabajo` |
| Anular adicional | `WRITE_ROLES` (OWNER/ADMIN) | Igual patrón que `anularGastoTrabajo` |
| Incorporar adicional a Venta | Quien ya puede crear/confirmar Ventas (`sales.write`: OWNER/ADMIN/VENTAS) | Contrato de Ventas ya existente, sin cambios de permiso |
| Crear gasto | `WORK_OPERATION_ROLES` con autoatribución | Sin cambios (ya existente) |
| Adjuntar evidencia a un gasto | OWNER/ADMIN sobre cualquier gasto; TECNICO/MEMBER sólo sobre un gasto que ellos registraron o del que son responsables (misma autoatribución que ya aplica a `registrarGastoTrabajo`) | Extiende `memberLinkedUid`/`assertWorkOperator` ya existentes, sin ampliar el conjunto de roles |
| Ver evidencia | Igual que ver el gasto (`canReadWorkCosts`) | Sin cambios |
| `profitability.read` | No aplica a adicionales/evidencia: ninguno de los dos forma parte del balance agregado que ese permiso protege | — |

No se requiere ningún permiso de Storage explícito adicional: el acceso a
archivos se gobierna por rol de membresía vía Storage Rules (§9.2), igual
que los dos patrones de Storage ya existentes en el proyecto.

## 14. UI mínima

### Adicionales (dentro de la ficha del Proyecto ya existente)

- Un bloque pequeño y compacto (mismo patrón visual que `FinancialSection`/
  `MaterialsSection` de `WorksPage.jsx`): listado de adicionales con
  ítem/cantidad/precio/estado, formulario de alta reutilizando un selector
  de producto/servicio ya existente en el catálogo (mismo control ya usado
  para materiales adicionales), acción "Anular" con motivo (mismo patrón
  que gastos/HH).
- Cuando corresponda, una acción "Incorporar a Venta" visible sólo a
  quienes ya pueden crear Ventas, que abre el flujo ya existente de nueva
  Venta con el `AdditionalSelector` de §6.1 pre-cargado.

### Evidencia (dentro del bloque de gastos ya existente)

- Un pequeño control "Adjuntar evidencia" junto a cada gasto vigente
  (oculto si el Proyecto es terminal, igual que el resto de las acciones de
  costo), mostrando nombre/tipo de cada archivo ya adjunto y un enlace para
  abrir/descargar. Sin editor ni previsualización avanzada.

No se rediseña `WorksPage.jsx`. No se agrega ninguna ruta nueva: todo vive
dentro del modal de ficha ya existente, siguiendo el mismo patrón aditivo
usado por PROJECTS_V3 (nuevos componentes pequeños en
`src/features/works/`, integrados puntualmente).

## 15. Arquitectura

### Frontend
- `src/features/works/WorkAdditionalsSection.jsx` (nuevo, patrón
  `FinancialSection`).
- `src/features/works/AdditionalSelector.jsx` (nuevo, patrón
  `WorkQuoteSelector.jsx`).
- Pequeña adición dentro de `MaterialsSection`/`FinancialSection` o un
  nuevo `WorkExpenseEvidence.jsx` para el control de adjuntar/ver evidencia.
- Ajuste puntual en el flujo de creación de Venta para poder abrir
  `AdditionalSelector` cuando la Venta está vinculada a un Proyecto (no es
  refactor: un punto de integración nuevo, análogo a cómo hoy ya se
  selecciona una Cotización).

### Helpers puros (dominio)
- `src/domain/workModel.mjs`: `adaptWorkAdditional`, helpers de estado
  (mismo patrón que `adaptWorkExpense`), y una función de elegibilidad
  análoga a `getEligibleWorkQuoteOptions` para adicionales `PENDIENTE_COBRO`.
- Posible pequeño helper en `saleModel.mjs` para reconocer/pasar
  `origenAdicionalId` en una línea (sin tocar el cálculo de totales).

### Firestore
- Nueva colección `negocios/{businessId}/trabajos/{trabajoId}/adicionales/{adicionalId}`.
- Nuevo campo opcional en documentos de gasto: `evidencia` (arreglo).
- Nuevo campo opcional en líneas de Venta: `origenAdicionalId`.
- Ninguna colección ni campo económico nuevo fuera de estos tres puntos.

### Functions (backend autoritativo, tal como exige AGENTS.md para
operaciones sensibles)
- `crearAdicionalTrabajo` (nueva): mismo patrón transaccional/idempotente
  que `registrarGastoTrabajo`.
- `anularAdicionalTrabajo` (nueva): mismo patrón que `anularGastoTrabajo`.
- `adjuntarEvidenciaGastoTrabajo` (nueva): valida gasto/trabajo/negocio,
  agrega una entrada al arreglo `evidencia`, no toca ningún otro campo.
- `confirmarVenta` (modificación mínima, acotada): agrega el bloque de
  cierre atómico de adicionales de §6.1, junto al ya existente
  `writeSaleConfirmationEvent`. Ninguna otra Function de Ventas se toca.
- `crearVenta`/`actualizarVentaBorrador`: aceptan el campo opcional
  `origenAdicionalId` por línea, sin validarlo más allá de su formato (la
  validación de que el adicional exista y esté `PENDIENTE_COBRO` ocurre en
  `confirmarVenta`, no antes, para no bloquear la edición libre de un
  borrador).

### Storage
- Un bloque nuevo en `storage.rules` (§9.2). Ningún bloque existente se
  modifica.

### Rules / índices
- Un bloque nuevo en `firestore.rules` para `adicionales`, calcado del
  patrón ya usado por `gastos` (lectura acotada, escritura `if false`).
- Ningún índice compuesto nuevo previsible: las consultas de adicionales
  son por `trabajoId` dentro de una subcolección ya acotada, igual que
  gastos/HH/materiales hoy (sin índice compuesto propio).

## 16. Etapas de implementación

Ajustadas al código real; se simplifican las 6 etapas propuestas como
referencia a 5, porque el diseño ya resolvió que "incorporar a Venta" no
necesita una etapa propia separada de Ventas (es un bloque pequeño dentro
de `confirmarVenta`, no un flujo nuevo):

**ETAPA 1 — Contratos y helpers puros de Adicionales**
Modelo de datos, estados, helpers (`adaptWorkAdditional`, elegibilidad),
smokes de dominio. Sin Firebase, sin UI.

**ETAPA 2 — Backend de Adicionales**
`crearAdicionalTrabajo`, `anularAdicionalTrabajo`, Rules de la colección
nueva. Smokes en Emulator Suite.

**ETAPA 3 — Evidencia de gastos**
`adjuntarEvidenciaGastoTrabajo`, bloque nuevo de Storage Rules, smokes en
Emulator Suite (incluye validar el bloque de Storage Rules explícitamente,
como ya se hizo para Reports V4 con el índice de Ventas).

**ETAPA 4 — UI de Proyecto**
`WorkAdditionalsSection`, `AdditionalSelector`, control de evidencia en
`FinancialSection`. Aditivo, sin tocar el resto de `WorksPage.jsx`.

**ETAPA 5 — Integración comercial + cierre técnico**
Bloque de cierre atómico en `confirmarVenta`, campo `origenAdicionalId` en
líneas, `AdditionalSelector` conectado al flujo de nueva Venta, regresión
completa (Works, Ventas, Margen V1, Reports V4, RBAC), checkpoint.

No se propone una etapa de QA visual dedicada: como en los bloques
anteriores, esa revisión queda diferida a `PENDING_GLOBAL_QA`.

## 17. Riesgo

- **ADICIONALES_FACTURABLES: MEDIO.** Toca la frontera entre Proyecto y
  Ventas (el punto que la propia SPEC 016 marcaba "pendiente de diseño").
  El riesgo se mitiga con el diseño de esta SPEC: cero Ventas nuevas
  automáticas, cero edición de documentos históricos, cierre atómico dentro
  de una transacción ya idempotente. El riesgo residual principal es de
  UX/flujo (que el usuario entienda que un adicional no es una Venta hasta
  que se confirma una).
- **EVIDENCIA_GASTOS: BAJO.** Reutiliza un patrón de Storage ya probado en
  producción (verificación empresarial) casi sin variación; no toca ningún
  cálculo económico; el único riesgo real es el mismo riesgo residual ya
  aceptado en el patrón original (archivo huérfano si la Function de
  registro falla tras una subida exitosa).
- **Riesgo global: MEDIO**, dominado por la pieza de Adicionales/Ventas, no
  por la evidencia.

## 18. IN_SCOPE

- Modelo y ciclo de vida de Adicionales facturables (PENDIENTE_COBRO /
  INCORPORADO_A_VENTA / ANULADO).
- Selector de adicionales pendientes al crear una Venta vinculada a un
  Proyecto.
- Cierre atómico de adicionales dentro de `confirmarVenta`, sin crear
  Ventas automáticas.
- Evidencia documental adjunta a un gasto ya existente (PDF/JPG/PNG,
  ≤5 MB, hasta un tope razonable de archivos por gasto).
- Storage Rules nuevas, acotadas a las dos rutas descritas.
- Firestore Rules nuevas, acotadas a la colección `adicionales`.
- UI mínima aditiva dentro de la ficha de Proyecto ya existente.
- Smokes de dominio + Emulator Suite para ambas capacidades.

## 19. OUT_OF_SCOPE

- Facturación electrónica, SII, cualquier documento tributario oficial.
- Contabilidad formal, libro mayor, estado de resultados.
- OCR, extracción de datos, IA sobre la evidencia.
- Conciliación de pagos, caja, flujo de efectivo.
- Nuevos impuestos o reinterpretación de IVA.
- Nuevas monedas o conversión FX.
- Edición retroactiva de Ventas confirmadas o Cotizaciones cerradas (bajo
  ninguna circunstancia, incluido "corregir" un adicional ya incorporado).
- Cambios a la economía Q/V (BRUNO C) o a la fórmula de
  `calculateWorkBalance`/Margen Comercial V1.
- Reports V5 o cualquier cambio a Reports V4.
- Módulos verticales estudiantiles.
- i18n, unificación visual global, deploy.

## 20. Criterios de aceptación

- Un adicional `PENDIENTE_COBRO` nunca aparece como ingreso en
  `calculateWorkBalance` ni en Reports V4.
- Incorporar un adicional a una Venta exige crear y confirmar una Venta
  real por el flujo ya existente; no existe ningún camino que cree una
  Venta automáticamente.
- Ninguna Cotización cerrada ni Venta confirmada se edita en ningún punto
  de este bloque.
- La transición `PENDIENTE_COBRO → INCORPORADO_A_VENTA` es atómica con la
  confirmación de la Venta que lo incorpora: no puede quedar una Venta
  confirmada con un adicional sin cerrar, ni un adicional cerrado sin una
  Venta confirmada real.
- Adjuntar evidencia a un gasto nunca cambia `monto`/`categoria`/
  `clasificacionCosto`/`estado` ni dispara recálculo de balance.
- La evidencia de un gasto anulado se conserva, nunca se borra.
- Ningún acceso cross-tenant es posible: Storage Rules y Functions
  revalidan `negocioId`/`trabajoId` en cada capa.
- No se crea ningún permiso RBAC nuevo; los roles que operan hoy gastos/
  Ventas siguen siendo exactamente los mismos que operan adicionales/
  evidencia.
- `calculateWorkBalance` y `calculateSaleCommercialMarginV1` quedan
  bit-a-bit idénticos a como estaban antes de este bloque.
- Smokes de dominio + Emulator Suite, lint de Functions, build y
  `git diff --check` quedan verdes al cerrar cada etapa.
