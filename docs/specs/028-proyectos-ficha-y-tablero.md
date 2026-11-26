# SPEC 028: Proyectos y trabajos, ficha por pestañas y tablero por proyecto

Estado: **v1**. Decisiones de negocio cerradas por Mauricio el 2026-10-15. Pendiente: informar a Bruno del cambio sobre la SPEC 016 §F (ver sección 5).

Etapa C: la eliminación de tareas (§4.2) está implementada en código y probada (2026-10-27), con una limitación conocida en la carrera costo/borrado (ver §4.2); el deploy de Functions sigue pendiente. Siguen pendientes la validación de cierre (§4.1), el botón «Cerrar proyecto» y la confirmación de subtareas (§4.3).

## 1. Objetivo

Que Lista y Tablero tengan trabajos distintos. La Lista sirve para administrar proyectos; el Tablero, para trabajar uno: crear tareas y subtareas, registrar gastos, horas y materiales dentro de cada tarea, y cerrar el proyecto cuando todo está terminado. Hoy ambas vistas muestran tarjetas de proyectos, y toda la información de un proyecto vive en una ficha muy larga.

## 2. Hechos verificados (investigación 2026-10-15)

- Proyectos y Trabajos es una sola entidad: `negocios/{id}/trabajos/`.
- La ficha es un diálogo de `WorksPage.jsx` con todas las secciones apiladas. Los componentes de apoyo están en `src/features/works/`.
- Tareas: `trabajos/{id}/tareas/{tareaId}`. Estados `pendiente`, `en_progreso`, `en_espera` y `completada`. Subtareas como arreglo dentro de la tarea, máximo 100. Nadie escribe tareas desde el cliente.
- Gastos, horas hombre, salidas de material y adicionales ya llevan `tareaId` opcional, validado contra el proyecto. Sin `tareaId`, el costo pertenece al proyecto completo. El balance y Reportes calculan por `trabajoId` y no dependen de `tareaId`, así que reubicar los formularios no cambia ningún número.
- El backend ya acepta `participanteUids` (máximo 30) al crear y editar, y valida membresía activa.
- Bug de identidad: `getWorkMemberIdentity` solo trata como vacío el literal "Sin nombre registrado", pero `adaptBusinessMember` lo convierte en "Nombre no informado". Por eso los selectores muestran "Yo (Nombre no informado)" y nunca el correo.
- Cierre: `cambiarEstadoTrabajo` permite cualquier transición y no mira las tareas. `actualizarTrabajo` y `crearTrabajo` aceptan `estado: "completado"` directo. El único control está en la interfaz.
- Hasta la Etapa C, `eliminarTareaTrabajo` solo funcionaba con tareas heredadas (v1) y las tareas nuevas no se podían eliminar ni cancelar. Resuelto en §4.2.

## 3. Diseño

### 3.1 Lista
Proyectos creados, con la información de siempre. Al abrir uno, su ficha por pestañas:
- **Datos:** descripción, cliente, cotización asociada, responsable, equipo, prioridad y fechas. Sin repetir lo que ya muestra la franja superior.
- **Comercial:** resumen comercial (cotizaciones y ventas) y adicionales facturables.
- **Balance:** balance y margen, resumen de costos por día y materiales incluidos en la venta.
- **Notas e historial.**

La cabecera de la ficha queda fija: estado, Editar, Cambiar estado, un menú de más acciones (incluye "Cancelar trabajo") y la franja con cliente, responsable, prioridad, término, progreso y costo acumulado. Un botón "Trabajar en el tablero" lleva al tablero con ese proyecto elegido.

### 3.2 Tablero
- Selector de proyecto. Muestra solo las tareas de ese proyecto como tarjetas por estado, con sus subtareas.
- Cada tarjeta de tarea permite registrar gastos, horas hombre y materiales con la tarea ya asociada.
- Cada tarjeta lleva un basurero en su esquina superior derecha (solo OWNER/ADMIN y con el proyecto abierto) que abre una confirmación simple con el nombre de la tarea. Si la tarea está completada o tiene costos o documentación, queda deshabilitado y su tooltip explica el motivo; el panel de la tarea ofrece la misma acción con el motivo visible. Si el backend rechaza la eliminación, el mensaje se muestra dentro del diálogo, que queda abierto.
- Una tarjeta "General" agrupa los costos sin tarea, y una tarjeta "Sin tarea asignada" los costos cuyo `tareaId` ya no existe.
- Abajo, "Cerrar proyecto", habilitado solo cuando existe al menos una tarea y todas están completadas. Si no, explica qué falta.
- Un proyecto completado se ve en solo lectura.

### 3.3 Formulario de crear y editar
Visibles: Nombre, Cotización asociada (compacta), Cliente, Responsable, Equipo (selector múltiple), Prioridad y Término planificado. "Descripción" e "Inicio planificado" van en una sección "Más detalles", cerrada por defecto. Los miembros sin nombre se muestran con su correo.

## 4. Reglas de negocio (cerradas)

1. **Cierre:** un proyecto solo pasa a completado si tiene al menos una tarea y todas están completadas. La validación vive en el backend, en una función común usada por `cambiarEstadoTrabajo`, `actualizarTrabajo` y `crearTrabajo`, y cuenta las tareas reales dentro de la transacción (no usa los contadores `tareasTotal` y `tareasCompletadas`, que pueden ser 0 en proyectos antiguos).
2. **Eliminar tareas:** se puede eliminar una tarea (de cualquier versión) si no tiene costos ni documentación registrados. Si los tiene, no se elimina. Un proyecto sin tareas no se cierra, pero sí se puede cancelar. Precisiones cerradas por Mauricio el 2026-10-27:
   - Los costos anulados cuentan como costos y bloquean: gastos, horas hombre, adicionales y movimientos de material (salidas y devoluciones). También bloquea la documentación, sea la subcolección o su contador.
   - Una tarea completada no se elimina: «Reabre la tarea antes de eliminarla.»
   - Solo OWNER y ADMIN, con el proyecto abierto (no completado ni cancelado).
   - Las subtareas, incluidas las completadas, se eliminan con la tarea. El historial conserva el evento `tarea_eliminada` con su título.
   - Confirmación simple con el nombre de la tarea, sin escribir ninguna palabra.
   - Mensaje de bloqueo: «No se puede eliminar la tarea porque tiene registros de {causas}. Los registros anulados también cuentan.», con las causas en orden fijo (gastos, horas hombre, adicionales, materiales, documentación).
   - La evidencia de un gasto cuelga del gasto, no de la tarea, y un gasto con tarea ya bloquea el borrado: la evidencia nunca queda huérfana.
   - Concurrencia: los handlers de costos con tarea y el de eliminar leen y actualizan el mismo documento del trabajo dentro de transacciones, por lo que no deben poder confirmarse ambos a la vez: gana uno y el otro se rechaza (costo→borrado: `failed-precondition`; borrado→costo: `not-found`). Lo ejercita `scripts/work-task-delete-race-integrated-local.mjs` con emuladores. Resultado medido el 2026-10-27 (3 corridas, 57 rondas de carrera): ningún costo quedó apuntando a una tarea inexistente. En 4 de esas 57 rondas el emulador rechazó el **borrado** con un error interno (`Transaction is invalid or closed`, tras ~9 s) en lugar de un rechazo limpio; el costo sí quedó registrado y la tarea intacta, así que el usuario puede reintentar. Se probó leer las cinco consultas del borrado en serie en lugar de en paralelo y no mejoró: 2 corridas de 104 rondas dieron 28 anomalías (13,5 %), y una corrida de control con las lecturas en paralelo y las mismas 104 rondas dio 11 (10,6 %). Se revirtió y el handler conserva las lecturas en paralelo. (La tasa de 4 de 57, 7,0 %, de las primeras mediciones venía de corridas más cortas; con corridas más largas sube a 10-15 % con cualquiera de los dos órdenes.) La causa más probable es la contención de bloqueos del emulador (`Transaction lock timeout` en su registro) cuando dos transacciones leen y luego actualizan el mismo documento del trabajo: es una hipótesis, sin medir en producción (la prueba solo corre contra emuladores). Por eso el script informa estos casos como advertencia y no falla (`WORK_TASK_DELETE_RACE_STRICT=1` lo hace fallar).
3. **Subtareas pendientes:** completar una tarea con subtareas sin terminar pide confirmación, sin bloquear.
4. **Costos en tarea completada:** se permiten hasta que se cierra el proyecto.
5. **Materiales de ventas:** van en Balance, porque no pertenecen a ninguna tarea.
6. **Proyecto completado con tareas abiertas:** queda en solo lectura, como hoy. Al reabrirlo, el nuevo cierre le exige todo.

## 5. Precedencia

Esta SPEC reemplaza, solo en lo relativo a ubicación e interfaz:
- 016 §F (144-146): el tablero de `/trabajos` ya no son tarjetas de proyectos. **Informar a Bruno.**
- 012, sección "Interfaz": el resumen prioritario y el tablero de tarjetas por proyecto.
- 019: §5 (el tablero como vista dentro de la ficha), el principio 5 de §2 y §8.
- 020 §14: la ubicación de adicionales y evidencia. El comportamiento no cambia.
- 022 §7.2: la ubicación de `WorkBalanceSection`. Los números no cambian.

Además, **§4.2 reemplaza el comportamiento (no solo la interfaz) de la eliminación de tareas**, desde el 2026-10-27:
- 012, «Tareas operativas V2 / fase 2»: «Las tareas V2 no se eliminan físicamente; sólo el checklist legacy incompleto conserva la eliminación compatible», y, en «Operaciones», la frase que protegía a las tareas V2 de la eliminación.
- 019: el principio 6 de §2, el último punto de §5.3 (etiqueta legacy como señal de que «admite eliminación»), §5.5 ("Eliminar" solo en v1), el punto «Eliminar (sólo v1)» de §5.7, los contratos de §6 y §7 («sólo para tareas v1»), el caso 13 de §11 y el punto de §12 «las tareas v1 conservan su eliminación legacy; las tareas v2 permanecen append-only».
Cada punto reemplazado quedó marcado en su SPEC. No cambian: la documentación append-only, que una subtarea completada no se elimina por separado mientras exista su tarea, que no se migra la versión de las tareas v1, ni la regla de no eliminar registros referenciados (AGENTS.md): una tarea con costos o documentación se conserva justamente por eso.

Siguen vigentes los permisos, el balance, Reportes, Ventas, la regla de que el equipo nace de la asignación y el deep link `state.openWorkId`.

## 6. Etapas

- **A (interfaz):** identidad de miembros, equipo en crear y editar, formulario más corto y ficha por pestañas, con una pestaña provisional "Operación" que conserva Tareas, Costos y Materiales sin cambios.
- **B (interfaz):** tablero por proyecto, con las tareas como tarjetas y los costos registrados desde cada tarjeta. Reemplaza la pestaña "Operación" y reescribe los smokes de tableros.
- **C (backend e interfaz):** validación de cierre, eliminación de tareas, botón "Cerrar proyecto" y confirmación de subtareas. Requiere deploy de Functions. Estado: eliminación de tareas hecha (§4.2); falta lo demás.

## 7. Pruebas

- Smokes de estructura de `/trabajos`: `works-model`, `projects-v3-stage1`, `projects-v3-stage2`. Los de `spec020` solo si cambian sus componentes.
- Etapa A: el smoke de identidad pasa por `adaptBusinessMember` antes de `getWorkMemberIdentity`.
- Etapa C: pruebas del handler de cierre (con y sin tareas, tarea abierta, proyecto sin tareas, y las tres vías de entrada) y de eliminación de tareas (con y sin costos). Las integradas con emuladores se corren cuando estén disponibles.
- Eliminación de tareas: `works-model-smoke` (handler y dominio, con cada tipo de costo, anulados, documentación, completada, proyecto cerrado, roles e idempotencia), `work-task-board-smoke` y `work-project-board-smoke` (interfaz) y `npm run test:spec028-task-delete-integrated` (carrera costo/borrado con emuladores de Auth, Firestore y Functions).
- `test:design`, `test:contrast`, `build` y `git diff --check`.

## 8. Criterios de aceptación

- Un proyecto con tareas abiertas no se puede cerrar por ninguna vía (pantalla ni Functions).
- Una tarea no completada, sin costos ni documentación, se puede eliminar (cualquier versión); una con costos —también anulados— o con documentación, no, y una completada tampoco.
- Los miembros sin nombre se ven con su correo, nunca como "Nombre no informado".
- El balance y Reportes muestran los mismos números que antes del rediseño.
- Un fallo de carga muestra un error, nunca "Aún no hay ...".
- Móvil: sin scroll horizontal en tableros y fichas.
