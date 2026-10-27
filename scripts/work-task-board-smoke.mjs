import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";
import {
  WORK_BOARD_COLUMNS,
  WORK_TASK_STATUSES,
  canOperateWorkTask,
  getVisibleWorkTasks,
  getWorkTaskStatusOptions,
} from "../src/domain/workModel.mjs";

// SPEC 028 etapa B2: el tablero pasó a tres columnas (Por hacer, En curso, Hecho; "En espera" dentro de
// En curso) con tarjeta compacta que abre WorkTaskPanel. Lo que antes fijaba este archivo sobre la
// tarjeta (select de estado, "Tarea legacy", Eliminar, "Sólo lectura") ahora vive en WorkTaskPanel.
// PROJECTS_V3 ETAPA 2 (SPEC 019 §5): tablero de tareas dentro de la ficha del
// Proyecto abierto. Sin Firebase real: WorkTaskBoard.jsx no importa ningún
// service ni firebaseConfig.js (a diferencia de WorksPage.jsx, que sí lo hace
// transitivamente y por eso no puede cargarse aquí — mismo hallazgo ya
// documentado en Reports V4 y en la ETAPA 1 de este bloque). Las
// transiciones de estado se verifican en dos niveles: (a) la lógica pura de
// qué transiciones se ofrecen (getWorkTaskStatusOptions, ya compartida con
// la vista de lista) y (b) un escaneo de fuente que confirma que el <select>
// del tablero llama a onRequestTaskState(task, valor) sin ninguna
// transformación ni mutación propia — el tablero no reimplementa ni
// intercepta cambiarEstadoTareaTrabajo, sólo reenvía la misma función que ya
// usa la lista.

const COSTS = {expenses: [], labor: [], materials: []};

function task(overrides = {}) {
  return {
    id: `task-${Math.random().toString(36).slice(2, 8)}`,
    titulo: "Instalar switch principal",
    descripcion: "",
    modeloTareaVersion: 2,
    responsableUid: "",
    responsableSnapshot: null,
    estado: "pendiente",
    completada: false,
    subtareas: [],
    motivoEspera: "",
    creadoEn: "2026-08-01T10:00:00.000Z",
    completadaEn: null,
    documentacionTotal: 0,
    documentacion: [],
    ...overrides,
  };
}

const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});

try {
  const {default: WorkTaskBoard} = await vite.ssrLoadModule("/src/features/works/WorkTaskBoard.jsx");
  const {default: WorkTaskPanel} = await vite.ssrLoadModule("/src/features/works/WorkTaskPanel.jsx");

  const render = (tasks, props = {}) => renderToStaticMarkup(React.createElement(WorkTaskBoard, {
    costs: COSTS,
    currency: "CLP",
    emptyCopy: "Aún no hay tareas.",
    onOpenTask: () => {},
    tasks,
    ...props,
  }));
  // El panel se abre con una tarea: ResponsiveDialog va a un portal, así que se renderiza sin portal (SSR).
  const renderPanel = (panelTask, props = {}) => renderToStaticMarkup(React.createElement(WorkTaskPanel, {
    actions: {}, canManage: true, canOperate: () => true, costs: COSTS, currency: "CLP", members: [], onClose: () => {}, onOpenCosts: () => {},
    onRequestTaskState: () => {}, processing: "", task: panelTask, terminal: false, ...props,
  }));

  // --- Casos 1/2: cuatro columnas, distribución correcta por estado ---
  const mixed = [
    task({id: "t1", estado: "pendiente", titulo: "Levantar cotización"}),
    task({id: "t2", estado: "pendiente", titulo: "Coordinar visita"}),
    task({id: "t3", estado: "en_progreso", titulo: "Tender cableado"}),
    task({id: "t4", estado: "en_espera", motivoEspera: "Esperando aprobación del cliente", titulo: "Instalar rack"}),
    task({id: "t5", estado: "completada", completada: true, titulo: "Diagnóstico inicial"}),
  ];
  const mixedMarkup = render(mixed);
  assert.equal((mixedMarkup.match(/works-task-board__column"/g) || []).length, 3, "el tablero siempre tiene 3 columnas, use o no cada estado");
  for (const column of WORK_BOARD_COLUMNS) assert.match(mixedMarkup, new RegExp(`<h4>${column.label}</h4>`));
  assert.deepEqual(WORK_BOARD_COLUMNS.map((column) => column.label), ["Por hacer", "En curso", "Hecho"]);
  assert.doesNotMatch(mixedMarkup, /<h4>En espera<\/h4>|<h4>Pendiente<\/h4>|<h4>Completada<\/h4>/, "En espera ya no es una columna");
  assert.match(mixedMarkup, /Levantar cotización/);
  assert.match(mixedMarkup, /Coordinar visita/);
  assert.match(mixedMarkup, /Tender cableado/);
  assert.match(mixedMarkup, /Instalar rack/);
  assert.match(mixedMarkup, /Diagnóstico inicial/);
  // "En espera" se agrupa en "En curso", al final, con su etiqueta y su motivo.
  {
    const columns = mixedMarkup.split('<section class="works-task-board__column"').slice(1);
    assert.equal(columns.length, 3);
    const [porHacer, enCurso, hecho] = columns;
    assert.match(porHacer, /Levantar cotización/); assert.match(porHacer, /Coordinar visita/); assert.doesNotMatch(porHacer, /Instalar rack|Tender cableado/);
    assert.match(enCurso, /Tender cableado/); assert.match(enCurso, /Instalar rack/);
    assert.ok(enCurso.indexOf("Tender cableado") < enCurso.indexOf("Instalar rack"), "la tarea en espera va después de las que están en progreso");
    assert.match(enCurso, /En espera<\/span>/); assert.match(enCurso, /Esperando aprobación del cliente/);
    assert.doesNotMatch(porHacer + hecho, /En espera/);
    assert.match(hecho, /Diagnóstico inicial/);
    assert.match(porHacer, /<span>2<\/span>/); assert.match(enCurso, /<span>2<\/span>/); assert.match(hecho, /<span>1<\/span>/, "el contador de cada columna cuenta sus tareas");
  }
  console.log("OK casos 1/2: tres columnas con la distribución correcta por estado; En espera agrupada en En curso");

  // --- Caso 3: Proyecto sin tareas ---
  const emptyMarkup = render([]);
  assert.match(emptyMarkup, /Aún no hay tareas\./);
  assert.doesNotMatch(emptyMarkup, /works-task-board__column"/);
  console.log("OK caso 3: Proyecto sin tareas muestra un único mensaje, no columnas vacías");

  // --- Estado vacío por columna cuando el Proyecto sí tiene tareas pero no en esa columna ---
  const onlyPending = [task({id: "p1", estado: "pendiente"})];
  const onlyPendingMarkup = render(onlyPending);
  assert.equal((onlyPendingMarkup.match(/<p class="works-task-board__column-empty">Sin tareas<\/p>/g) || []).length, 2, "las 2 columnas sin tareas muestran un vacío de una línea");
  assert.doesNotMatch(onlyPendingMarkup, /Sin tareas en este estado/, "ya no hay un bloque grande por columna vacía");
  console.log("OK: sólo tareas pendientes deja las otras 2 columnas con un vacío de una línea, sin ocultar el tablero");

  // --- Caso: todas completadas ---
  const allDone = [task({id: "d1", estado: "completada", completada: true}), task({id: "d2", estado: "completada", completada: true})];
  const allDoneMarkup = render(allDone);
  assert.equal((allDoneMarkup.match(/works-task-board__card"/g) || []).length, 2);
  console.log("OK: todas las tareas completadas se agrupan en la columna Hecho");

  // --- Caso 4: sólo tareas del Proyecto actual (contrato estructural) ---
  const boardSource = await readFile(new URL("../src/features/works/WorkTaskBoard.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(boardSource, /businessId|trabajoId|workId/, "el componente no debe recibir ni usar ningún identificador de Proyecto: sólo debe operar sobre `tasks`, ya acotadas por el padre");
  assert.doesNotMatch(boardSource, /firebase|firestore|getDocs|httpsCallable|onSnapshot|listarTrabajos|cargarFichaTrabajo/i, "sin ninguna consulta remota propia");
  console.log("OK caso 4: el tablero no tiene forma de referenciar otro Proyecto; sólo renderiza `tasks` recibidas por props");

  // --- Casos 5/6/7: transiciones ofrecidas para cada estado (misma lógica que la lista) ---
  assert.deepEqual(
    getWorkTaskStatusOptions({estado: "pendiente"}, {canManage: true}).map((entry) => entry.value),
    ["pendiente", "en_progreso", "en_espera", "completada"]
  );
  assert.ok(getWorkTaskStatusOptions({estado: "pendiente"}, {canManage: true}).some((entry) => entry.value === "en_progreso"));
  console.log("OK caso 5: pendiente -> en_progreso está entre las transiciones ofrecidas");

  assert.ok(getWorkTaskStatusOptions({estado: "en_progreso"}, {canManage: true}).some((entry) => entry.value === "en_espera"));
  console.log("OK caso 6: en_progreso -> en_espera está entre las transiciones ofrecidas");

  assert.ok(getWorkTaskStatusOptions({estado: "en_progreso"}, {canManage: true}).some((entry) => entry.value === "completada"));
  console.log("OK caso 7: cualquier estado activo -> completada está entre las transiciones ofrecidas");

  // --- Caso 8: la mutación reutilizada es la misma, sin transformación ni reinterpretación ---
  // El tablero ya no trae el <select> de estado: la tarjeta solo abre el panel (onOpenTask) y el select vive en
  // WorkTaskPanel, que sigue reenviando (task, valor) sin transformarlo a la misma función de la página.
  assert.match(boardSource, /onClick=\{\(\) => onOpenTask\(task\)\}/, "la tarjeta solo abre el panel de la tarea");
  assert.doesNotMatch(boardSource, /<select|onRequestTaskState/, "la tarjeta compacta no lleva controles de estado");
  const taskPanelSource = await readFile(new URL("../src/features/works/WorkTaskPanel.jsx", import.meta.url), "utf8");
  assert.match(taskPanelSource, /onChange=\{\(event\) => onRequestTaskState\(task, event\.target\.value\)\}/, "el <select> del panel reenvía (task, valor) sin transformarlo");
  assert.doesNotMatch(boardSource + taskPanelSource, /cambiarEstadoTareaTrabajo\(|eliminarTareaTrabajo\(|from ["'].*workService/, "ni el tablero ni el panel importan o llaman las mutaciones: reciben callbacks ya resueltos por el padre");
  console.log("OK caso 8: el cambio de estado se reenvía intacto desde el panel de la tarea a la misma función que usaba la lista");

  // SPEC 028 etapa B: el tablero de tareas lo monta WorkProjectBoard (tablero por proyecto) y ya no
  // TaskSection. El select de estado sigue reenviando a una única función, requestTaskState, y la página
  // la resuelve con la misma Function y el mismo requestId de antes.
  const worksPageSource = await readFile(new URL("../src/pages/WorksPage.jsx", import.meta.url), "utf8");
  const projectBoardSource = await readFile(new URL("../src/features/works/WorkProjectBoard.jsx", import.meta.url), "utf8");
  assert.match(
    projectBoardSource,
    /<WorkTaskBoard[\s\S]{0,400}onOpenTask=\{\(task\) => setSelectedTaskId\(task\.id\)\}/,
    "WorkProjectBoard cablea el tablero para abrir el panel de la tarea"
  );
  assert.match(
    projectBoardSource,
    /<WorkTaskPanel[\s\S]{0,700}onRequestTaskState=\{requestTaskState\}/,
    "WorkProjectBoard debe cablear el panel de la tarea a requestTaskState"
  );
  assert.match(
    projectBoardSource,
    /const requestTaskState = \(task, estado\) => \{\s*if \(estado === "en_espera"\) \{[^}]*\}\s*actions\.changeTaskState\(task, estado\);/,
    "requestTaskState pide motivo para en_espera y para el resto llama a actions.changeTaskState sin transformar el estado"
  );
  assert.match(
    worksPageSource,
    /changeTaskState: \(task, estado, motivoEspera = ""\) => runBoardAction\(`task-state-\$\{task\.id\}`, \(\) => cambiarEstadoTareaTrabajo\(businessId, boardWorkId, task\.id, estado, \{motivoEspera, requestId: createWorkTaskRequestId\(`task-\$\{estado\}`\)\}\)\)/,
    "la página resuelve changeTaskState con cambiarEstadoTareaTrabajo y el mismo requestId de siempre"
  );
  assert.doesNotMatch(projectBoardSource, /from ["'].*(workService|firebase)|httpsCallable|getDocs/, "WorkProjectBoard sigue siendo presentacional: no importa servicios ni Firebase");
  console.log("OK: WorkProjectBoard conecta el tablero a requestTaskState y la página lo resuelve con la misma Function y requestId");

  // --- Casos 9/10: permisos — sólo lectura no puede mutar, autorizado sí ---
  const readOnlyTask = task({id: "ro1", estado: "pendiente", responsableUid: "otro-uid"});
  const readOnlyMarkup = renderPanel(readOnlyTask, {canManage: false, canOperate: () => false});
  assert.match(readOnlyMarkup, /Sólo lectura/);
  assert.doesNotMatch(readOnlyMarkup, /<select/);
  console.log("OK caso 9: un usuario sin permiso sobre la tarea ve el panel pero no el control de mutación");

  const authorizedMarkup = renderPanel(task({id: "au1", estado: "pendiente"}), {canOperate: () => true});
  assert.match(authorizedMarkup, /<select/);
  assert.doesNotMatch(authorizedMarkup, /Sólo lectura/);
  console.log("OK caso 10: un usuario autorizado sí ve el control de cambio de estado");

  // --- Casos 11/12: tareas v1 (legacy) vs v2 (append-only) ---
  // SPEC 028 §4.2: eliminar una tarea ya no depende de su versión. El panel la ofrece a gestión con el proyecto
  // abierto, deshabilitada y con el motivo a la vista si está completada o tiene costos (también anulados) o documentación.
  const deleteButton = (markup, title) => markup.match(new RegExp(`<button[^>]*aria-label="Eliminar ${title}"[^>]*>`))?.[0] || "";
  const legacyTask = task({id: "v1", modeloTareaVersion: 1, estado: "pendiente"});
  assert.doesNotMatch(render([legacyTask]), /Tarea legacy|Eliminar/, "sin onDeleteTask la tarjeta compacta no muestra la etiqueta legacy ni acciones");
  const legacyMarkup = renderPanel(legacyTask, {canManage: true});
  assert.match(legacyMarkup, /Tarea legacy/);
  assert.ok(deleteButton(legacyMarkup, legacyTask.titulo), "una tarea v1 limpia ofrece Eliminar en el panel");
  assert.doesNotMatch(deleteButton(legacyMarkup, legacyTask.titulo), /disabled/);
  console.log("OK caso 11: una tarea v1 muestra su etiqueta legacy y puede eliminarse desde el panel");

  const v2Task = task({id: "v2", modeloTareaVersion: 2, estado: "pendiente"});
  const v2Markup = renderPanel(v2Task, {canManage: true});
  assert.doesNotMatch(v2Markup, /Tarea legacy/);
  assert.ok(deleteButton(v2Markup, v2Task.titulo), "una tarea v2 limpia también ofrece Eliminar (SPEC 028 §4.2)");
  assert.doesNotMatch(deleteButton(v2Markup, v2Task.titulo), /disabled/);
  assert.doesNotMatch(v2Markup, /No se puede eliminar|Reabre la tarea para poder eliminarla/, "sin bloqueos no hay motivo que mostrar");
  console.log("OK caso 12: una tarea v2 sin costos ni documentación se puede eliminar desde el panel");

  const reasonOf = (markup, taskId) => markup.match(new RegExp(`<p class="works-task-panel__hint" id="task-delete-reason-${taskId}">([^<]*)</p>`))?.[1] || "";
  for (const [label, panelTask, costs, reason] of [
    ["gasto anulado", task({id: "b1"}), {...COSTS, expenses: [{tareaId: "b1", estado: "anulado"}]}, "No se puede eliminar la tarea porque tiene registros de gastos. Los registros anulados también cuentan."],
    ["horas hombre", task({id: "b2"}), {...COSTS, labor: [{tareaId: "b2", estado: "vigente"}]}, "No se puede eliminar la tarea porque tiene registros de horas hombre. Los registros anulados también cuentan."],
    ["adicional", task({id: "b3"}), {...COSTS, additionals: [{tareaId: "b3", estado: "ANULADO"}]}, "No se puede eliminar la tarea porque tiene registros de adicionales. Los registros anulados también cuentan."],
    ["material", task({id: "b4"}), {...COSTS, materials: [{tareaId: "b4", tipo: "DEVOLUCION_PROYECTO"}]}, "No se puede eliminar la tarea porque tiene registros de materiales. Los registros anulados también cuentan."],
    ["documentación", task({id: "b5", documentacionTotal: 1}), COSTS, "No se puede eliminar la tarea porque tiene registros de documentación. Los registros anulados también cuentan."],
    ["varias causas", task({id: "b6", documentacion: [{id: "d"}]}), {...COSTS, expenses: [{tareaId: "b6"}], materials: [{tareaId: "b6"}]}, "No se puede eliminar la tarea porque tiene registros de gastos, materiales y documentación. Los registros anulados también cuentan."],
  ]) {
    const markup = renderPanel(panelTask, {canManage: true, costs});
    assert.equal(reasonOf(markup, panelTask.id), reason, `motivo visible: ${label}`);
    const button = deleteButton(markup, panelTask.titulo);
    assert.match(button, /disabled=""/, `Eliminar deshabilitado: ${label}`);
    assert.match(button, new RegExp(`aria-describedby="task-delete-reason-${panelTask.id}"`), `el motivo describe al botón: ${label}`);
  }
  const otherTaskCost = renderPanel(task({id: "free"}), {canManage: true, costs: {...COSTS, expenses: [{tareaId: "otra"}]}});
  assert.doesNotMatch(deleteButton(otherTaskCost, "Instalar switch principal"), /disabled/, "el costo de otra tarea no bloquea");
  console.log("OK: el panel deshabilita Eliminar y muestra el motivo con gastos, HH, adicionales, materiales o documentación (también anulados)");

  for (const [label, completedTask] of [["v2", task({id: "v2c", modeloTareaVersion: 2, estado: "completada", completada: true})], ["v1", task({id: "v1c", modeloTareaVersion: 1, estado: "completada", completada: true})]]) {
    const markup = renderPanel(completedTask, {canManage: true});
    assert.equal(reasonOf(markup, completedTask.id), "Reabre la tarea para poder eliminarla.", `tarea ${label} completada: motivo visible`);
    assert.match(deleteButton(markup, completedTask.titulo), /disabled=""/);
  }
  console.log("OK: una tarea completada (v1 o v2) muestra Eliminar deshabilitado con 'Reabre la tarea para poder eliminarla.'");

  assert.doesNotMatch(renderPanel(v2Task, {canManage: false, canOperate: () => true}), /Eliminar/, "sin permiso de gestión no hay Eliminar");
  assert.doesNotMatch(renderPanel(v2Task, {canManage: true, terminal: true}), /Eliminar/, "con el proyecto terminado no hay Eliminar");
  console.log("OK: Eliminar solo con permiso de gestión y proyecto abierto");

  // --- Basurero de la tarjeta (SPEC 028 §4.2) ---
  {
    const cardTasks = [
      task({id: "free", titulo: "Libre"}),
      task({id: "costly", titulo: "Con costo"}),
      task({id: "done", titulo: "Hecha", estado: "completada", completada: true}),
      task({id: "docs", titulo: "Con documentos", documentacionTotal: 2}),
    ];
    const withDelete = render(cardTasks, {costs: {...COSTS, labor: [{tareaId: "costly", estado: "anulado"}]}, onDeleteTask: () => {}});
    const cards = withDelete.split('<div class="works-task-card works-task-card--deletable">').slice(1);
    assert.equal(cards.length, 4, "cada tarjeta lleva su basurero");
    const trash = (card) => card.match(/<button type="button" class="works-task-card__delete"[^>]*>/)?.[0] || "";
    for (const card of cards) {
      assert.match(card, /aria-label="Eliminar tarea"/);
      assert.ok(card.indexOf("</button>") < card.indexOf("works-task-card__delete"), "el basurero es hermano del botón de la tarjeta, no está dentro de él");
    }
    // Las tarjetas salen agrupadas por columna (la completada va en Hecho): se buscan por título.
    const cardOf = (title) => cards.find((card) => card.includes(`<span class="works-task-card__title">${title}</span>`));
    assert.doesNotMatch(trash(cardOf("Libre")), /aria-disabled/); assert.match(trash(cardOf("Libre")), /title="Eliminar tarea"/, "tooltip de la acción");
    assert.match(trash(cardOf("Con costo")), /aria-disabled="true"/); assert.match(trash(cardOf("Con costo")), /title="No se puede eliminar la tarea porque tiene registros de horas hombre\./);
    assert.match(trash(cardOf("Hecha")), /aria-disabled="true"/); assert.match(trash(cardOf("Hecha")), /title="Reabre la tarea para poder eliminarla\."/);
    assert.match(trash(cardOf("Con documentos")), /aria-disabled="true"/); assert.match(trash(cardOf("Con documentos")), /title="No se puede eliminar la tarea porque tiene registros de documentación\./);
    const withoutDelete = render(cardTasks);
    assert.doesNotMatch(withoutDelete, /works-task-card__delete|works-task-card--deletable|Eliminar/, "sin onDeleteTask (sin gestión o proyecto terminado) no hay basurero");
    assert.equal((withoutDelete.match(/class="works-task-card"/g) || []).length, 4);
    assert.match(boardSource, /event\.stopPropagation\(\); if \(deletion\.canDelete\) onDeleteTask\(task\);/, "el clic del basurero no abre el panel y solo actúa si se puede eliminar");
    assert.match(boardSource, /aria-label="Eliminar tarea"/); assert.match(boardSource, /Trash2/);
    console.log("OK basurero de la tarjeta: uno por tarea, hermano del botón, deshabilitado con motivo (costos, documentación, completada) y ausente sin permiso");
  }

  // --- Caso 13 (reescrito, SPEC 028 etapa B): ni las columnas ni el contenedor interceptan errores ---
  // WorkTaskBoard (columnas y tarjetas base) sigue sin estado ni manejo de errores. El estado de borradores
  // (subtarea, documentación, tarea nueva, diálogos) vive en WorkProjectBoard, que tampoco captura errores:
  // cada acción devuelve la promesa de runBoardAction (WorksPage), el mismo camino de error que usaba la lista.
  // Única excepción: removeTask recibe un onError para que el diálogo de eliminar muestre el mensaje del backend.
  assert.doesNotMatch(boardSource, /catch|try\s*\{|setError|useState/i, "WorkTaskBoard sigue sin estado propio ni manejo de errores");
  const projectBoardForErrors = await readFile(new URL("../src/features/works/WorkProjectBoard.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(projectBoardForErrors, /catch|try\s*\{|setError/i, "WorkProjectBoard no captura errores de mutación: se propagan a runBoardAction/setError en WorksPage");
  assert.match(projectBoardForErrors, /useState/, "el estado de los diálogos vive en WorkProjectBoard, no en WorkTaskBoard");
  console.log("OK caso 13: ni WorkTaskBoard ni WorkProjectBoard interceptan errores; el fallo sigue el camino de runBoardAction");

  // --- Caso 14: sin drag-and-drop ---
  assert.doesNotMatch(boardSource, /draggable|onDrag|onDrop|dnd-kit|react-beautiful-dnd|react-dnd/i);
  console.log("OK caso 14: no existe ningún rastro de drag-and-drop en el tablero");

  // --- Caso 15: no se agregan estados nuevos ---
  assert.doesNotMatch(boardSource, /["'](bloqueada|archivada|revisión|en_revision|descartada)["']/i, "el tablero no debe inventar estados de tarea que no existan en WORK_TASK_STATUSES");
  assert.match(boardSource, /groupWorkTasksByBoardColumn/);
  assert.deepEqual(WORK_BOARD_COLUMNS.flatMap((column) => column.states).sort(), WORK_TASK_STATUSES.map((entry) => entry.value).sort(), "las columnas solo agrupan los estados de WORK_TASK_STATUSES");
  console.log("OK caso 15: las columnas agrupan únicamente los estados de WORK_TASK_STATUSES; no se definió ningún estado nuevo");

  // --- Caso: sin NaN/undefined/null visibles con datos mínimos ---
  const bareTask = task({id: "bare", estado: "pendiente", responsableUid: "", subtareas: [], creadoEn: ""});
  const bareMarkup = render([bareTask]);
  assert.doesNotMatch(bareMarkup, /\bNaN\b|\bundefined\b|\bnull\b/);
  assert.match(bareMarkup, /Sin responsable/);
  console.log("OK: tarea sin responsable/fecha/subtareas no muestra NaN/undefined/null, usa los mismos textos de respaldo que la lista");

  // --- Título largo no rompe el layout (overflow-wrap ya declarado en CSS; aquí sólo probamos que no trunca el texto de forma silenciosa/errónea) ---
  const longTitleTask = task({id: "long", titulo: "Reemplazar el gabinete de comunicaciones completo del tercer piso incluyendo UPS y regletas de energía redundante"});
  const longTitleMarkup = render([longTitleTask]);
  assert.match(longTitleMarkup, new RegExp(longTitleTask.titulo));
  console.log("OK: un título largo se conserva íntegro en la tarjeta (el ajuste visual queda a cargo del CSS, sin truncar el dato)");

  console.log("WORK_TASK_BOARD_SMOKE_OK");
} finally {
  await vite.close();
}

// --- Caso 16 (SPEC 028 etapa B): el tablero de /trabajos ya NO muestra tarjetas de Proyectos ---
// Antes se fijaba que WorkBoard (una tarjeta por Proyecto) siguiera definido y montado. Ahora la vista
// Tablero elige un Proyecto y muestra solo sus tareas (WorkProjectBoard); WorkBoard se retiró a propósito.
const pageSource = await readFile(new URL("../src/pages/WorksPage.jsx", import.meta.url), "utf8");
assert.doesNotMatch(pageSource, /function WorkBoard\(|<WorkBoard /, "el tablero de tarjetas por Proyecto se retiró");
assert.match(pageSource, /<WorkProjectBoard actions=\{boardActions\}/, "la vista Tablero monta el tablero por proyecto");
assert.match(pageSource, /searchParams\.get\("vista"\) === "tablero"/, "la vista se lee de la URL (?vista=tablero)");
assert.match(pageSource, /searchParams\.get\("proyecto"\)/, "el proyecto del tablero se lee de la URL (?proyecto=<id>)");
assert.match(pageSource, /getDefaultBoardWorkId\(works\)/, "sin ?proyecto se elige el abierto más reciente");
console.log("OK caso 16: el tablero de tarjetas por Proyecto se retiró y la vista Tablero monta el tablero por proyecto");

// --- Confirmación cruzada: los helpers RBAC de tareas siguen siendo los mismos usados por la lista ---
assert.equal(canOperateWorkTask({responsableUid: "u1"}, {canManage: false, role: "TECNICO", currentUserUid: "u1"}), true);
assert.equal(canOperateWorkTask({responsableUid: "u2"}, {canManage: false, role: "TECNICO", currentUserUid: "u1"}), false);
assert.equal(canOperateWorkTask({responsableUid: "u2"}, {canManage: false, role: "MEMBER", currentUserUid: "u1"}), false);
assert.equal(canOperateWorkTask({responsableUid: "u2"}, {canManage: true, role: "ADMIN", currentUserUid: "u1"}), true);
assert.deepEqual(
  getVisibleWorkTasks(
    [{id: "legacy", modeloTareaVersion: 1, responsableUid: "otro"}, {id: "v2-mine", modeloTareaVersion: 2, responsableUid: "yo"}, {id: "v2-otro", modeloTareaVersion: 2, responsableUid: "otro"}],
    {canManage: false, currentUserUid: "yo"}
  ).map((entry) => entry.id),
  ["legacy", "v2-mine"],
  "una tarea v1 es visible para todos; una v2 sólo para su responsable, igual que en la lista"
);
console.log("OK: los helpers compartidos (canOperateWorkTask/getVisibleWorkTasks) preservan exactamente la semántica v1/v2 ya existente");

console.log("PROJECTS_V3_STAGE2_SMOKE_OK");
