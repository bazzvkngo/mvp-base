# SPEC 019 — Projects V3: tablero por Proyecto

## 1. Propósito y estado

Cerrar el único alcance aprobado como `PROJECTS_V3` en esta iteración:
`OPCIÓN_B_TABLERO_POR_PROYECTO`, según `tmp/audit-projects-v3.txt`. Esta SPEC
no rediseña el balance económico ni el modelo de Proyectos/Trabajos: sólo
agrega una vista de tablero de tareas dentro de la ficha ya existente de un
Proyecto, y corrige dos brechas de UI ya identificadas y evidenciadas por
código.

- Fecha conceptual: 2 de septiembre de 2026.
- Estado: especificada; implementación pendiente.
- Alcance: Core de ValoraCloud (módulo Proyectos/Trabajos). Las verticales
  estudiantiles quedan excluidas.
- Precedencia: `AGENTS.md` y SPEC 016 conservan autoridad. SPEC 012 sigue
  siendo la única definición del modelo de datos de Trabajos/tareas y del
  balance económico; esta SPEC no la sustituye en ningún punto, sólo
  construye una vista adicional sobre datos y Callables que ya existen.
- Esta SPEC no declara implementada ninguna funcionalidad nueva.

## 2. Principios obligatorios

1. No se rediseña `obtenerBalanceTrabajo` ni `calculateWorkBalance`
   (`functions/workBalance.js` permanece intacto).
2. No se crean Cloud Functions, reglas de Firestore, índices ni permisos
   RBAC nuevos.
3. El tablero de tareas opera exclusivamente sobre Callables ya existentes
   (`cambiarEstadoTareaTrabajo` y equivalentes ya usados por `TaskSection`).
4. El acceso de FINANZAS al balance no se amplía: ya existe en backend y en
   RBAC (`BALANCE_READ_ROLES`/`canViewWorkProfitability`); V3 sólo alinea el
   `render` de la UI con esa autorización ya vigente.
5. El tablero de Proyectos actual (`WorkBoard`, tarjetas por Proyecto) no se
   elimina ni se reemplaza: el tablero de tareas es una vista adicional
   dentro de la ficha de un Proyecto ya abierto.
6. El comportamiento existente de tareas legacy (v1, eliminables) y tareas
   v2 (append-only, sin eliminación) se conserva sin cambios en el tablero.
7. No se introduce ninguna librería nueva de UI/drag-and-drop/búsqueda: el
   selector de cotización reutiliza el patrón ya existente
   (`ResponsiveDialog` + filtro en memoria, como `SaleClientSelector.jsx` /
   `ProviderSelector.jsx`).

## 3. Auditoría de campos reales para el selector de cotización

`getEligibleWorkQuoteOptions(quotes, sales, {workId})`
(`src/domain/workModel.mjs:109-124`) ya calcula la lista de pares
`{quote, sale}` elegibles (cotización `aceptada`, venta `confirmada`, mismo
cliente, no vinculada a otro Proyecto). El selector buscable filtra esa MISMA
lista ya calculada; no cambia la regla de elegibilidad.

Campos reales disponibles en el objeto `quote` adaptado
(`adaptStoredQuote`, `src/domain/quoteModel.mjs:621+`) útiles para búsqueda:

- `numero` — número visible de la cotización (p. ej. `COT-2026-0001`).
- `clienteNombre` — razón social del cliente.
- `clienteRut` — RUT/identificador fiscal del cliente.
- `proyectoNombre` — campo de "nombre de proyecto" propio de la Cotización
  (`client.proyecto`), cuando el usuario lo completó.

No existe un campo `descripcion`/`titulo` a nivel de Cotización (sólo existe
`descripcion` por línea de ítem, dentro de `items[]`, que no es apto para un
selector de una sola cotización). **No se inventa ningún campo**: la búsqueda
se limita a `numero`, `clienteNombre`, `clienteRut` y `proyectoNombre`,
concatenados y normalizados con el mismo criterio ya usado por
`normalizeWorkSearch` (minúsculas, sin tildes) para mantener consistencia con
el resto del módulo.

## 4. ETAPA 1 — Selector de cotización buscable + fix FINANZAS

### 4.1 `WorkQuoteSelector.jsx`

Nuevo componente en `src/features/works/WorkQuoteSelector.jsx`, siguiendo el
mismo patrón que `src/features/sales/SaleClientSelector.jsx`:

- Recibe como props: `options` (el arreglo `{quote, sale}` ya calculado por
  `getEligibleWorkQuoteOptions`), `value` (id de cotización seleccionada o
  vacío), `onChange`, `disabled` (true cuando `commercialLinkLocked`, igual
  que hoy).
- Renderiza el valor actual (número de cotización + cliente) o "Sin
  cotización asociada", y un botón "Seleccionar cotización" /
  "Cambiar cotización" que abre un `ResponsiveDialog` (mismo componente ya
  usado en el resto de la app).
- Dentro del diálogo: un `<input>` de búsqueda de texto libre (placeholder
  "Buscar por número, cliente o proyecto") y la lista filtrada en memoria
  (sin llamada a Firestore adicional: usa exactamente los `options` ya
  cargados por `WorksPage` desde `getQuotes(businessId)`), con un botón por
  cotización mostrando número, cliente y (si existe) `proyectoNombre`.
- Estado vacío: "No hay cotizaciones elegibles que coincidan con la
  búsqueda." cuando la lista filtrada queda vacía, y "No hay cotizaciones
  elegibles para vincular." cuando `options` ya llega vacío (sin necesidad
  de escribir nada).
- Selección: al elegir una opción, llama `onChange(quoteId)` y cierra el
  diálogo, igual que hoy hace el `<select>` que reemplaza. Mantiene la
  selección previa (`value`) visible si el usuario abre y cierra el diálogo
  sin elegir nada nuevo.
- No cruza negocios: `options` ya viene acotado a `businessId` porque
  `getQuotes`/`listarVentas` ya son consultas por negocio (sin cambios en
  esa capa); el selector no agrega ninguna consulta propia, por lo que no
  puede introducir una fuga cross-tenant.
- Reemplaza únicamente el `<select>` de "Cotización asociada" en el
  formulario de creación/edición de `WorksPage.jsx` (línea ~221 antes de
  esta SPEC); el resto del formulario no cambia.

### 4.2 Fix del gate de `WorkBalanceSection`

En `WorksPage.jsx`, el bloque que hoy renderiza `<WorkBalanceSection>` sólo
si `canManage` (`canManageWorks(role)`, es decir OWNER/ADMIN) pasa a
condicionarse por `canViewWorkProfitability(role)` (ya exportado por
`workModel.mjs:126-128`, ya usado hoy para decidir si se llama
`obtenerBalanceTrabajo`). Esto **alinea** el `render` con la autorización de
datos que ya existe (OWNER/ADMIN/FINANZAS) — no crea ninguna autorización
nueva, sólo dejaba de mostrarse una sección para un rol que el backend ya
permitía.

No se toca el `<select>` de asignación de responsable/tareas ni ninguna otra
sección gateada por `canManage`: ese gate sigue siendo correcto porque
corresponde a mutación (OWNER/ADMIN), no a lectura del balance.

## 5. ETAPA 2 — Tablero de tareas por Proyecto

### 5.1 `WorkTaskBoard.jsx`

Nuevo componente en `src/features/works/WorkTaskBoard.jsx`, montado dentro
de la ficha de detalle de un Proyecto ya abierto (mismo `ResponsiveDialog`
de detalle que hoy contiene `TaskSection`), como una alternativa de
visualización de las MISMAS tareas que hoy renderiza `TaskSection` en forma
de lista — no un dato nuevo, una vista nueva. Se agrega un selector de vista
"Lista / Tablero" **local a la sección de tareas de ese Proyecto** (no debe
confundirse con el selector "Lista/Tablero" que ya existe en el nivel
superior de `/trabajos` para Proyectos-como-tarjetas: son controles
independientes, en dos niveles distintos).

Opera **exclusivamente** sobre `detail.tareas` del Proyecto actualmente
abierto (el mismo arreglo que ya consume `TaskSection`, obtenido de
`cargarFichaTrabajo`). No hace ninguna consulta adicional a Firestore ni a
ningún otro Proyecto: el tablero no puede, por construcción, mostrar ni
mutar tareas de un Proyecto distinto al que está abierto.

### 5.2 Columnas

Las 4 columnas son exactamente los `WORK_TASK_STATUSES` canónicos ya
existentes (`src/domain/workModel.mjs:33-38`), sin agregar ni quitar
ninguno:

1. Pendiente (`pendiente`)
2. En progreso (`en_progreso`)
3. En espera (`en_espera`)
4. Completada (`completada`)

### 5.3 Tarjetas — información mínima

Cada tarjeta de tarea muestra:
- Título de la tarea.
- Responsable asignado (mismo `getWorkMemberOptionLabel`/snapshot ya usado
  en `TaskSection`), o "Sin responsable".
- Progreso de subtareas (`getTaskProgress(task)`, ya existente): "N/M
  subtareas" o nada si la tarea no tiene subtareas.
- Costo asignado a esa tarea (`getWorkCostSummary({...costos, taskId})`, ya
  usado hoy por `TaskSection`) — mismo formato ya usado (monto en la moneda
  del Proyecto).
- Si está en `en_espera`: motivo (`motivoEspera`) visible en la tarjeta,
  igual que hoy lo muestra `TaskSection`.
- Badge de versión legacy cuando `modeloTareaVersion < WORK_TASK_MODEL_VERSION`
  (para que quede claro que esa tarjeta admite eliminación, ver 5.5).

No se agrega ningún campo a la tarjeta que no exista ya en `adaptWorkTask`
(sin inventar metadata nueva).

### 5.4 Estados y acciones disponibles

- Click/acción "Mover a columna X" (no drag-and-drop, explícitamente
  excluido): cada tarjeta expone el mismo control de cambio de estado que
  hoy usa `TaskSection` (un `<select>` de `WORK_TASK_STATUSES`, o, si se
  prefiere una interacción más propia de tablero, un menú/botones "Mover a
  →" que internamente llaman al mismo Callable). La decisión de UI exacta
  (select vs. botones) se resuelve en implementación sin cambiar el
  contrato: en cualquier caso, la única mutación posible es la ya existente.
- Mover a `en_espera` exige motivo obligatorio, igual que hoy
  (`waitReason`/diálogo de confirmación ya existente — se reutiliza, no se
  duplica).
- Mover a `completada` respeta la misma regla ya existente: si hay
  subtareas pendientes, se pide confirmación explícita (mismo flujo de
  "Completar con pendientes" ya usado en `TaskSection`); no se auto-completan
  subtareas.
- Reabrir una tarea completada exige OWNER/ADMIN, igual que hoy (regla ya
  aplicada en backend por `cambiarEstadoTareaTrabajoV2Handler`).
- `canOperate(task)` se reutiliza sin cambios: `canManage` (OWNER/ADMIN)
  opera cualquier tarjeta; TECNICO/MEMBER sólo las tarjetas de tareas donde
  son `responsableUid`.
- El tablero no agrega ninguna acción de "crear tarea" distinta a la que ya
  existe en `TaskSection` (formulario de alta) — puede reutilizarse el mismo
  formulario o mantenerlo sólo en la vista de lista; no es un requisito de
  esta etapa.

### 5.5 Tratamiento de tareas v1 (legacy) y v2 (append-only)

- Ambas conviven en las mismas columnas, sin distinción de comportamiento de
  movimiento entre estados (el cambio de estado ya es el mismo Callable para
  ambas versiones — `cambiarEstadoTareaTrabajoV2Handler` acepta el booleano
  legacy `completada` como alias, sin cambios).
- La única diferencia visible es la disponibilidad de "Eliminar": sólo las
  tarjetas con `modeloTareaVersion < WORK_TASK_MODEL_VERSION` (v1) muestran
  una acción de eliminación (idéntica a la que ya existe en `TaskSection`,
  gateada a `canManage` y a que la tarea no esté completada). Las tarjetas
  v2 nunca muestran esa acción, igual que hoy.
- El tablero no migra tareas v1 a v2 ni cambia su versión.

### 5.6 Loading, vacío, error

- Loading: mientras `detail` (la ficha completa del Proyecto, incluidas sus
  tareas) está cargando, el tablero muestra el mismo estado de carga ya
  usado por el resto de la ficha (no se agrega un loading independiente:
  las tareas ya llegan junto con el resto de `cargarFichaTrabajo`).
- Vacío: si el Proyecto no tiene tareas, cada columna se muestra vacía con
  un texto discreto ("Sin tareas en este estado"); no se oculta el tablero
  completo salvo que el Proyecto no tenga ninguna tarea en absoluto, en cuyo
  caso se muestra un único mensaje "Este Proyecto todavía no tiene tareas."
  con el mismo llamado a la acción de crear tarea que ya existe.
- Error: si una mutación (cambio de estado) falla, se muestra el mismo
  mecanismo de error ya usado por `TaskSection` (mensaje inline junto a la
  tarjeta afectada); no se pierde el estado del resto del tablero ni se
  revierte optimistamente sin confirmación del servidor — el tablero refleja
  siempre el último estado confirmado por Firestore/Functions, igual que
  `TaskSection` hoy.

### 5.7 Permisos

Sin cambios de RBAC. El tablero hereda exactamente las mismas reglas que
`TaskSection` ya aplica hoy:
- Lectura de tareas: cualquier miembro con `works.read` (visibilidad
  restringida a tareas propias para roles no-`canManage`, igual que hoy
  — `visibleTasks`).
- Cambio de estado / operar una tarjeta: `canOperate(task)` ya existente.
- Eliminar (sólo v1): `canManage` ya existente.
- No se introduce ningún permiso nuevo ni se amplía ninguno existente.

## 6. Contratos reutilizados (sin cambios)

- `cambiarEstadoTareaTrabajo` (Callable, `functions/workPersistence.js`
  `cambiarEstadoTareaTrabajoV2Handler`).
- `eliminarTareaTrabajo` (sólo para tareas v1, ya usado por `TaskSection`).
- `getEligibleWorkQuoteOptions`, `adaptWorkTask`, `getTaskProgress`,
  `getWorkCostSummary`, `getWorkMemberOptionLabel`, `canViewWorkProfitability`,
  `canManageWorks`, `WORK_TASK_STATUSES`, `WORK_TASK_MODEL_VERSION`
  (todos en `src/domain/workModel.mjs`, sin modificar su firma ni su
  semántica).
- `getQuotes`, `listarVentas` (servicios ya usados por `WorksPage.jsx` para
  poblar `quotes`/`sales`).
- `obtenerBalanceTrabajo` (sin cambios; sólo cambia quién puede ver su
  resultado en la UI, no cómo se calcula ni se solicita).

Ningún contrato nuevo se define en esta SPEC.

## 7. IN_SCOPE

- `WorkQuoteSelector.jsx`: selector buscable de cotización, filtrando en
  memoria sobre `getEligibleWorkQuoteOptions` ya existente.
- Fix del gate de `WorkBalanceSection` para incluir FINANZAS.
- `WorkTaskBoard.jsx`: tablero de tareas del Proyecto abierto, columnas por
  `WORK_TASK_STATUSES`, operando `cambiarEstadoTareaTrabajo` (y
  `eliminarTareaTrabajo` sólo para v1) ya existentes.
- Selector de vista Lista/Tablero dentro de la sección de tareas de la
  ficha.
- Smokes de dominio/UI para ambas etapas.

## 8. OUT_OF_SCOPE

- Drag-and-drop.
- Adicionales facturables (consumo de stock + incremento de cobro).
- Evidencia/adjuntos de gastos.
- Ruta dedicada `/trabajos/:id` o cualquier cambio de routing.
- Refactor general de `WorksPage.jsx` (sólo se extraen los dos componentes
  nuevos ya nombrados; los ~13 subcomponentes existentes no se tocan ni se
  mueven).
- Cloud Functions nuevas.
- Reglas de Firestore nuevas o modificadas.
- Permisos RBAC nuevos.
- Índices de Firestore nuevos.
- Cualquier cambio económico o a `functions/workBalance.js`.
- Resolución del N+1 de `obtenerBalanceTrabajo` (deuda ya registrada,
  fuera de alcance).
- Reports V5.
- Módulos verticales estudiantiles.
- Rediseño visual global de ValoraCloud.
- QA visual/manual en navegador real (diferido explícitamente a
  `PENDING_GLOBAL_QA`, ver §10).

## 9. Etapas de implementación

### ETAPA 1 — Selector de cotización buscable + fix FINANZAS

- Crear `WorkQuoteSelector.jsx`.
- Integrarlo en el formulario de creación/edición de `WorksPage.jsx`.
- Corregir el gate de `WorkBalanceSection`.
- Smokes de dominio/UI (ver §11).
- Sin Firebase real; sin Emulator Suite necesario salvo que se decida un
  smoke de integración adicional (no obligatorio: no hay Function nueva que
  probar).

### ETAPA 2 — Tablero de tareas por Proyecto

- Crear `WorkTaskBoard.jsx`.
- Agregar el selector de vista Lista/Tablero dentro de la sección de tareas.
- Conectar las acciones del tablero a los Callables ya existentes.
- Verificar convivencia v1/v2 y todos los estados especiales (§5.6).
- Smokes de dominio/UI (ver §11).
- Confirmar explícitamente que el tablero de Proyectos (`WorkBoard`, nivel
  superior) sigue intacto y sin cambios de comportamiento.

## 10. QA GENERAL — PENDING_GLOBAL_QA

Registrado explícitamente como deuda diferida al QA general de la
plataforma, sin bloquear el cierre técnico de esta SPEC:

- Revisión visual desktop de `WorkQuoteSelector` y `WorkTaskBoard`.
- Responsive / vista móvil de ambos componentes.
- Densidad visual de la ficha de Proyecto tras agregar el selector de vista
  Lista/Tablero.
- Comportamiento del tablero con textos largos (títulos de tarea, motivos
  de espera, nombres de responsables).
- Scroll/overflow del tablero con muchas tareas por columna.
- Integración visual con el resto de ValoraCloud (consistencia de
  `ResponsiveDialog`, badges, colores de estado).

## 11. Casos mínimos de prueba

ETAPA 1:
1. Búsqueda por número de cotización.
2. Búsqueda por cliente (nombre o RUT).
3. Búsqueda sin coincidencias.
4. Selección de una cotización actualiza `value` y cierra el diálogo.
5. Lista de opciones vacía (`options` sin elementos) muestra el mensaje
   correspondiente sin permitir buscar sobre nada.
6. Selector deshabilitado cuando el vínculo comercial ya está fijado
   (`commercialLinkLocked`).
7. FINANZAS ve `WorkBalanceSection` con datos.
8. Un rol sin `profitability.read` (p. ej. VENTAS, MEMBER) no ve
   `WorkBalanceSection`.
9. OWNER/ADMIN siguen viendo `WorkBalanceSection` exactamente igual que
   antes del fix (no regresión).

ETAPA 2:
10. Tareas existentes se distribuyen en la columna correcta según su
    `estado`.
11. Proyecto sin tareas muestra el estado vacío, no columnas vacías sin
    contexto.
12. Cambiar el estado de una tarea desde el tablero produce el mismo efecto
    que cambiarlo desde `TaskSection` (mismo Callable, mismo resultado).
13. Una tarea v1 (`modeloTareaVersion < 2`) muestra la acción "Eliminar";
    una tarea v2 no la muestra.
14. Un rol TECNICO sólo puede operar tarjetas de tareas donde es
    `responsableUid`; tarjetas de otras tareas se muestran de sólo lectura
    o no se muestran, según la misma regla que ya aplica `visibleTasks`.
15. Un error del Callable al cambiar de estado se muestra en la tarjeta
    afectada sin alterar el estado de las demás tarjetas.
16. Operar el tablero de un Proyecto no muta ni lee tareas de ningún otro
    Proyecto.
17. El tablero de Proyectos existente (`WorkBoard`, nivel superior) sigue
    presente y sin cambios de comportamiento tras esta SPEC.

## 12. Criterios de aceptación

- El selector de cotización filtra exclusivamente sobre las opciones ya
  elegibles calculadas por `getEligibleWorkQuoteOptions`; no cambia qué
  cotizaciones son elegibles.
- FINANZAS ve el balance de Proyecto en la UI cuando el backend ya lo
  autoriza; ningún otro rol gana acceso nuevo.
- El tablero de tareas nunca muestra ni opera tareas de un Proyecto distinto
  al abierto.
- Las tareas v1 conservan su eliminación legacy; las tareas v2 permanecen
  append-only en el tablero, igual que en la lista.
- Ninguna mutación nueva se introduce: todo cambio de estado pasa por
  `cambiarEstadoTareaTrabajo` (o `eliminarTareaTrabajo` para v1) ya
  existentes.
- El tablero de Proyectos (`WorkBoard`) permanece sin cambios de
  comportamiento.
- No se crean Functions, Rules, índices ni permisos nuevos.
- No se modifica `functions/workBalance.js`.
- Smokes de ambas etapas, lint de Functions, build y `git diff --check`
  quedan verdes al cerrar cada etapa.

## 13. Riesgo

**MEDIO.** No hay riesgo económico (el balance no se toca) ni de seguridad
(no hay permisos ni Functions nuevas). El riesgo principal es de superficie
de UI: `WorksPage.jsx` ya es un archivo grande y denso, y el tablero debe
convivir correctamente con el modelo mixto de tareas v1/v2 sin asumir un
comportamiento único. Mitigación: implementación aditiva (no se retira nada
existente), reutilización estricta de Callables y helpers ya probados, y
smokes explícitos para la convivencia v1/v2 y para confirmar que el tablero
de Proyectos y otros Proyectos no se ven afectados.
