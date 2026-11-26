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
  assert.match(taskPanelSource, /onChange=\{\(event\) => changeState\(event\.target\.value\)\}/, "el <select> del panel reenvía el valor sin transformarlo");
  assert.match(taskPanelSource, /onRequestTaskState\(task, estado, \{onError, requestId\}\)/, "...a onRequestTaskState(task, valor, {onError, requestId})");
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
    /const requestTaskState = \(task, estado, options\) => \{\s*if \(estado === "en_espera"\) \{[^}]*\}\s*return actions\.changeTaskState\(task, estado, "", options\);/,
    "requestTaskState pide motivo para en_espera y para el resto llama a actions.changeTaskState sin transformar el estado"
  );
  assert.match(
    worksPageSource,
    /changeTaskState: \(task, estado, motivoEspera = "", \{requestId, onError\} = \{\}\) => runBoardAction\(`task-state-\$\{task\.id\}`, \(\) => cambiarEstadoTareaTrabajo\(businessId, boardWorkId, task\.id, estado, \{motivoEspera, requestId: requestId \|\| createWorkTaskRequestId\(`task-\$\{estado\}`\)\}\), \{onError\}\)/,
    "la página resuelve changeTaskState con cambiarEstadoTareaTrabajo y el mismo requestId de siempre"
  );
  assert.doesNotMatch(projectBoardSource, /from ["'].*(workService|firebase)|httpsCallable|getDocs/, "WorkProjectBoard sigue siendo presentacional: no importa servicios ni Firebase");
  console.log("OK: WorkProjectBoard conecta el tablero a requestTaskState y la página lo resuelve con la misma Function y requestId");

  // --- Casos 9/10: permisos — sólo lectura no puede mutar, autorizado sí ---
  const readOnlyTask = task({id: "ro1", estado: "pendiente", responsableUid: "otro-uid"});
  const readOnlyMarkup = renderPanel(readOnlyTask, {canManage: false, canOperate: () => false});
  assert.match(readOnlyMarkup, /Solo lectura/);
  assert.doesNotMatch(readOnlyMarkup, /<select/);
  console.log("OK caso 9: un usuario sin permiso sobre la tarea ve el panel pero no el control de mutación");

  const authorizedMarkup = renderPanel(task({id: "au1", estado: "pendiente"}), {canOperate: () => true});
  assert.match(authorizedMarkup, /<select/);
  assert.doesNotMatch(authorizedMarkup, /Solo lectura/);
  console.log("OK caso 10: un usuario autorizado sí ve el control de cambio de estado");

  // --- Casos 11/12: tareas v1 (legacy) vs v2 (append-only) ---
  // SPEC 028 §4.2: eliminar una tarea ya no depende de su versión. El panel la ofrece a gestión con el proyecto
  // abierto, deshabilitada y con el motivo a la vista si está completada o tiene costos (también anulados) o documentación.
  // El botón de la zona de Eliminar del panel: Button ghost-danger con el texto visible "Eliminar tarea".
  const deleteButton = (markup) => markup.match(/<button(?:(?!<button)[\s\S])*?Eliminar tarea<\/span><\/button>/)?.[0] || "";
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
    ["horas", task({id: "b2"}), {...COSTS, labor: [{tareaId: "b2", estado: "vigente"}]}, "No se puede eliminar la tarea porque tiene registros de horas. Los registros anulados también cuentan."],
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
  console.log("OK: el panel deshabilita Eliminar y muestra el motivo con gastos, horas, adicionales, materiales o documentación (también anulados)");

  for (const [label, completedTask] of [["v2", task({id: "v2c", modeloTareaVersion: 2, estado: "completada", completada: true})], ["v1", task({id: "v1c", modeloTareaVersion: 1, estado: "completada", completada: true})]]) {
    const markup = renderPanel(completedTask, {canManage: true});
    assert.equal(reasonOf(markup, completedTask.id), "Reabre la tarea para poder eliminarla.", `tarea ${label} completada: motivo visible`);
    assert.match(deleteButton(markup, completedTask.titulo), /disabled=""/);
  }
  console.log("OK: una tarea completada (v1 o v2) muestra Eliminar deshabilitado con 'Reabre la tarea para poder eliminarla.'");

  assert.doesNotMatch(renderPanel(v2Task, {canManage: false, canOperate: () => true}), /Eliminar/, "sin permiso de gestión no hay Eliminar");
  assert.doesNotMatch(renderPanel(v2Task, {canManage: true, terminal: true}), /Eliminar/, "con el proyecto terminado no hay Eliminar");
  console.log("OK: Eliminar solo con permiso de gestión y proyecto abierto");

  // --- Panel de la tarea reordenado (chip junto al título, Responsable/Estado, secciones parejas, Eliminar aparte) ---
  {
    const cssSource = await readFile(new URL("../src/features/works/works.css", import.meta.url), "utf8");
    const people = [{uid: "u1", nombre: "Camila Torres", correo: "camila@example.cl"}];
    const costs = {expenses: [{tareaId: "p1", estado: "vigente", categoria: "OPERATIVO", monto: 5000}], labor: [{tareaId: "p1", estado: "vigente", total: 10000}], materials: [{tareaId: "p1", tipo: "SALIDA_PROYECTO", costoTotal: 2500}]};
    const full = task({id: "p1", titulo: "Tender cableado", estado: "en_progreso", responsableUid: "u1", responsableSnapshot: {nombre: "Camila Torres", correo: "camila@example.cl"}, descripcion: "Pasar cable por el cielo falso", documentacion: [{id: "d1", texto: "Foto del tramo", autorUid: "u1", autorSnapshot: {nombre: "Camila Torres"}, creadoEn: "2026-08-02T10:00:00.000Z", tipo: "avance"}], documentacionTotal: 1});
    const markup = renderPanel(full, {canManage: true, costs, members: people});
    const at = (text) => { const index = markup.indexOf(text); assert.ok(index >= 0, "falta " + text); return index; };

    // 1. Orden: chip junto al título, Responsable y Estado, Descripción, Subtareas, Documentación, Costos y, al final, Eliminar.
    assert.match(markup, /<h2[^>]*><span class="works-task-panel__title"><span>Tender cableado<\/span><span class="ui-status-badge ui-status-badge--neutral">En curso<\/span><\/span><\/h2>/, "el chip de estado va junto al título");
    const order = [at("works-task-panel__title"), at(">Responsable</span>"), at(">Estado</span>"), at("<h3>Descripción</h3>"), at('aria-label="Subtareas"'), at('aria-label="Documentación"'), at('aria-label="Costos"'), at("Eliminar tarea</span>")];
    assert.deepEqual([...order].sort((a, b) => a - b), order, "orden: título, Responsable, Estado, Descripción, Subtareas, Documentación, Costos, Eliminar");
    assert.match(markup, /<div class="works-task-panel__row"><label class="erp-field works-task-panel__field"><span class="erp-field__label">Responsable<\/span><select[\s\S]*?<\/label><label class="erp-field works-task-panel__field"><span class="erp-field__label">Estado<\/span><select/, "Responsable y Estado, mismo componente de campo, en la misma fila");
    assert.match(cssSource, /\.works-task-panel__row \{ display: grid; gap: var\(--space-3\); grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/, "dos columnas iguales");
    assert.match(cssSource, /\.works-task-panel__value \{[^}]*min-height: var\(--space-10\);/, "en solo lectura el valor mide lo mismo que el control");
    const readOnly = renderPanel(full, {canManage: false, canOperate: () => false, members: people});
    assert.equal((readOnly.match(/class="erp-field works-task-panel__field"/g) || []).length, 2, "solo lectura: los mismos dos campos");
    assert.match(readOnly, /<span class="works-task-panel__value">Camila Torres<\/span>/); assert.match(readOnly, /<span class="works-task-panel__value">En curso<\/span>/);
    // Sin descripción: una sola línea tenue, sin sección vacía.
    const noDescription = renderPanel(task({id: "p2", descripcion: ""}), {canManage: true});
    assert.match(noDescription, /<p class="works-empty-line">Sin descripción\.<\/p>/); assert.doesNotMatch(noDescription, /<h3>Descripción<\/h3>/);
    assert.match(markup, /<h3>Descripción<\/h3><p class="works-project-board__description">Pasar cable por el cielo falso<\/p>/);

    // 2. Solo el nombre del responsable, sin correo.
    assert.doesNotMatch(markup, /camila@example\.cl/, "el correo no aparece (ni en el campo ni como línea secundaria)");
    assert.doesNotMatch(readOnly, /camila@example\.cl/);
    assert.doesNotMatch(await readFile(new URL("../src/features/works/WorkTaskPanel.jsx", import.meta.url), "utf8"), /responsableEmail|responsableSecondary|\.correo/, "el panel ya no lee el correo del responsable");
    assert.doesNotMatch(cssSource, /works-task-panel__secondary/);

    // 3. Todas las secciones con el mismo estilo: la misma pieza (título + separador + espaciado) y las mismas reglas.
    for (const title of ["Descripción", "Subtareas", "Documentación", "Costos"]) assert.match(markup, new RegExp('<section class="works-task-panel__section" aria-label="' + title + '"><h3>' + title), "sección " + title);
    assert.match(cssSource, /\.works-task-panel__section \{ border-top: 1px solid var\(--color-border-subtle\); display: grid; gap: var\(--space-3\); padding-top: var\(--space-4\); \}/);
    assert.doesNotMatch(markup, /<details|<summary/, "Documentación ya no es un desplegable con otro estilo");

    // 4. Etiquetas visibles y espacio entre el vacío de Documentación y su campo.
    assert.match(markup, /<label class="erp-field"><span class="erp-field__label">Nueva subtarea<\/span><input/);
    assert.match(markup, /<label class="erp-field"><span class="erp-field__label">Comentario o evidencia<\/span><textarea/);
    assert.doesNotMatch(markup, /placeholder="Nueva subtarea"|placeholder="Comentario o evidencia"/, "la etiqueta visible reemplaza al placeholder");
    const emptyDocumentation = renderPanel(task({id: "p3"}), {canManage: true});
    assert.match(emptyDocumentation, /aria-label="Documentación"><h3>Documentación<span class="works-task-panel__count">0<\/span><\/h3><form class="works-task-document-form">[\s\S]*?<\/form><p class="works-empty-line">Aún no hay documentación\.<\/p>/, "el campo va arriba y el mensaje vacío debajo: hermanos dentro de la sección, separados por el gap de la sección");

    // 5. Costos: desglose con los datos que el Tablero ya tiene (la misma función de la ficha), sin consultas nuevas.
    assert.match(markup, /<strong>\$17\.500<\/strong><small class="works-task-panel__breakdown">Horas \$10\.000 · Gastos \$5\.000 · Materiales \$2\.500<\/small>/, "Horas, Gastos y Materiales de la tarea, y su suma");
    assert.match(renderPanel(task({id: "p4"}), {canManage: true}), /Horas \$0 · Gastos \$0 · Materiales \$0/);
    assert.doesNotMatch(await readFile(new URL("../src/features/works/WorkTaskPanel.jsx", import.meta.url), "utf8"), /from ["'].*(workService|firebase)|getDocs|httpsCallable/, "el panel no hace consultas nuevas");

    // 6. Eliminar tarea: Button ghost-danger, deshabilitado y con el motivo a la vista; la confirmación y los permisos siguen.
    const deletable = renderPanel(task({id: "p9"}), {canManage: true});
    assert.match(deletable, /<div class="works-task-panel__danger"><button class="ui-button ui-button--ghost-danger" type="button">[\s\S]*?<span class="ui-button__label">Eliminar tarea<\/span><\/button><\/div>/, "habilitado y sin motivo cuando se puede eliminar");
    assert.doesNotMatch(deletable, /task-delete-reason/);
    const blocked = renderPanel(task({id: "p5", documentacionTotal: 1}), {canManage: true});
    assert.match(blocked, /<div class="works-task-panel__danger"><p class="works-task-panel__hint" id="task-delete-reason-p5">No se puede eliminar la tarea porque tiene registros de documentación\./);
    assert.match(blocked, /<button[^>]*class="ui-button ui-button--ghost-danger"[^>]*aria-describedby="task-delete-reason-p5"[^>]*disabled=""|<button[^>]*aria-describedby="task-delete-reason-p5"[^>]*class="ui-button ui-button--ghost-danger"[^>]*disabled=""|<button[^>]*disabled=""[^>]*class="ui-button ui-button--ghost-danger"/, "deshabilitado con el motivo asociado");
    assert.match(cssSource, /\.works-task-panel__danger \{ border-top: 1px solid var\(--color-border-subtle\);/, "zona separada");
    assert.doesNotMatch(cssSource, /\.works-task-panel__danger button/, "sin estilo propio sobre el botón: usa Button");
    const panelSource = await readFile(new URL("../src/features/works/WorkTaskPanel.jsx", import.meta.url), "utf8");
    assert.match(panelSource, /onClick=\{\(\) => onRequestDelete\(task\)\}>Eliminar tarea<\/Button>/, "sigue pidiendo la confirmación (WorkProjectBoard abre WorkTaskDeleteDialog)");
    assert.match(panelSource, /const showDelete = canManage && !terminal;/, "mismos permisos");
    assert.match(await readFile(new URL("../src/features/works/WorkProjectBoard.jsx", import.meta.url), "utf8"), /<WorkTaskDeleteDialog error=\{deleteForm\.error\}/);

    // 7. Ancho: ResponsiveDialog de tamaño medio, sin layout lateral propio (en celular lo muestra casi a pantalla completa).
    assert.match(markup, /class="responsive-dialog responsive-dialog--medium works-task-panel"/);
    assert.doesNotMatch(cssSource, /works-task-panel-layer|\.works-task-panel\.responsive-dialog/, "ya no hay CSS de panel lateral");
    assert.match(panelSource, /size="medium"/); assert.doesNotMatch(panelSource, /layerClassName/);
  }
  console.log("OK panel de la tarea: chip junto al título, Responsable/Estado iguales, Descripción, secciones parejas, etiquetas visibles, desglose de costos y Eliminar aparte");

  // --- Documentación de la tarea: campo arriba, 3 vigentes + "Ver todos (N)", fecha y hora, Anular con motivo ---
  {
    const cssSource = await readFile(new URL("../src/features/works/works.css", import.meta.url), "utf8");
    const author = {autorUid: "u1", autorSnapshot: {nombre: "Camila Torres"}};
    // Más reciente primero, como las entrega workService. d2 y d5 están anuladas.
    const entries = [
      {id: "d6", texto: "Sexto comentario", creadoEn: "2026-08-06T15:45:00.000Z", tipo: "avance", ...author},
      {id: "d5", texto: "Quinto comentario anulado", creadoEn: "2026-08-05T10:00:00.000Z", tipo: "avance", ...author, estado: "anulado", anuladoPorUid: "u2", anuladoPorSnapshot: {nombre: "Bruno Díaz"}, anuladoEn: "2026-08-05T12:30:00.000Z", motivoAnulacion: "Foto equivocada"},
      {id: "d4", texto: "Cuarto comentario", creadoEn: "2026-08-04T10:00:00.000Z", tipo: "avance", ...author},
      {id: "d3", texto: "Tercer comentario", creadoEn: "2026-08-03T10:00:00.000Z", tipo: "avance", ...author},
      {id: "d2", texto: "Segundo comentario anulado", creadoEn: "2026-08-02T10:00:00.000Z", tipo: "avance", ...author, estado: "anulado", anuladoPorUid: "u2", anuladoPorSnapshot: {nombre: "Bruno Díaz"}, anuladoEn: "2026-08-02T11:00:00.000Z", motivoAnulacion: "Duplicado"},
      {id: "d1", texto: "Primer comentario", creadoEn: "2026-08-01T10:00:00.000Z", tipo: "cierre", ...author},
    ];
    const documented = task({id: "doc", titulo: "Con comentarios", estado: "en_progreso", documentacion: entries, documentacionTotal: 6});
    const withAnnul = {canManage: true, onRequestAnnulDocumentation: () => {}};
    const markup = renderPanel(documented, withAnnul);
    // React inserta <!-- --> entre textos adyacentes del servidor: se quitan para leer el texto tal como lo ve la persona.
    const section = markup.slice(markup.indexOf('aria-label="Documentación"'), markup.indexOf('aria-label="Costos"')).replaceAll("<!-- -->", "");

    // 1. El campo va arriba de la lista.
    assert.ok(section.indexOf("works-task-document-form") < section.indexOf("works-task-panel__entries"), "Comentario o evidencia va arriba de la lista");
    // 2. Contraída: hasta el tercer comentario vigente más reciente (d6, d4, d3), con la anulada d5 entre ellos; d2 y d1 quedan tras "Ver todos".
    for (const visible of ["Sexto comentario", "Quinto comentario anulado", "Cuarto comentario", "Tercer comentario"]) assert.ok(section.includes(visible), "se ve " + visible);
    for (const hidden of ["Segundo comentario anulado", "Primer comentario"]) assert.ok(!section.includes(hidden), "queda tras Ver todos: " + hidden);
    // 3. El contador y el enlace cuentan solo los vigentes (4), no los 6 registros.
    assert.match(section, /<h3>Documentación<span class="works-task-panel__count">4<\/span><\/h3>/);
    assert.match(section, /aria-expanded="false"[^>]*>[\s\S]*?Ver todos \(4\)/);
    // 4. Cada comentario muestra fecha y hora (no solo la fecha).
    assert.match(section, /Camila Torres · \d{2}[-/]\d{2}[-/]\d{4},? \d{1,2}:\d{2}/, "fecha y hora");
    // 5. Anulado: tachado (clase), quién, cuándo y motivo; sin botón Anular. Los vigentes sí lo tienen.
    assert.match(section, /<div class="is-annulled"><p>Quinto comentario anulado<\/p>/);
    assert.match(section, /<small class="works-task-panel__annulled">Anulado por Bruno Díaz el \d{2}[-/]\d{2}[-/]\d{4},? \d{1,2}:\d{2}(?:\s[ap]\.\sm\.|\.) Motivo: Foto equivocada<\/small>/);
    assert.doesNotMatch(section, /\.\./, "la fecha y hora no dejan un doble punto antes de Motivo");
    assert.equal((section.match(/>Anular<\/span>/g) || []).length, 3, "Anular solo en los tres vigentes visibles");
    // Botón Anular chico y sin borde grande: mismo Button ghost-danger (sin otra familia) con una clase que lo compacta; permisos y diálogo intactos.
    assert.equal((section.match(/class="ui-button ui-button--ghost-danger works-task-panel__annul"/g) || []).length, 3, "los tres Anular usan el Button ghost-danger compacto");
    {
      const css = await readFile(new URL("../src/features/works/works.css", import.meta.url), "utf8");
      const rule = css.match(/\.works-task-panel__entries \.works-task-panel__annul \{([^}]*)\}/)?.[1] || "";
      assert.match(rule, /border-color: transparent/, "sin borde visible en reposo"); assert.match(rule, /min-height: 0/, "sin la altura mínima de 40px"); assert.match(rule, /font-size: var\(--font-size-xs\)/);
      assert.match(rule, /padding: var\(--space-1\) var\(--space-2\)/); assert.doesNotMatch(rule, /#[0-9a-f]{3,8}|rgb\(|px/i, "solo tokens, sin valores literales");
      assert.match(css, /\.works-task-panel__entries \.works-task-panel__annul:hover:not\(:disabled\) \{[^}]*background: var\(--color-danger-50\)[^}]*border-color: transparent/, "el hover no dibuja el borde grande");
    }
    const annulledBlock = section.slice(section.indexOf('<div class="is-annulled">'), section.indexOf("</div>", section.indexOf('<div class="is-annulled">')));
    assert.doesNotMatch(annulledBlock, /Anular<\/span>/, "un comentario anulado no se puede anular otra vez");
    // 6. Con todos los vigentes a la vista no hay enlace: 3 vigentes + 1 anulada se ven completos.
    const few = renderPanel(task({id: "few", documentacion: entries.slice(0, 4)}), withAnnul);
    assert.doesNotMatch(few, /Ver todos/);
    assert.match(few, /<span class="works-task-panel__count">3<\/span>/);
    // 7. Permisos y estado del proyecto: sin gestión o con el proyecto terminado no hay Anular (la lista sí se ve).
    for (const [label, props] of [["sin gestión", {canManage: false, onRequestAnnulDocumentation: () => {}}], ["proyecto terminado", {canManage: true, terminal: true, onRequestAnnulDocumentation: () => {}}], ["sin la acción", {canManage: true}]]) {
      const plain = renderPanel(documented, props);
      assert.doesNotMatch(plain.slice(plain.indexOf('aria-label="Documentación"'), plain.indexOf('aria-label="Costos"')), />Anular<\/span>/, label + ": sin Anular");
      assert.match(plain, /Cuarto comentario/, label + ": los comentarios siguen visibles");
    }
    // 8. El panel no llama a ningún servicio: solo pide anular con (tarea, comentario) y el padre abre el diálogo.
    const panelSource = await readFile(new URL("../src/features/works/WorkTaskPanel.jsx", import.meta.url), "utf8");
    assert.match(panelSource, /onClick=\{\(\) => onRequestAnnulDocumentation\(task, entry\)\}/);
    assert.match(panelSource, /const canAnnulDocumentation = canManage && !terminal && Boolean\(onRequestAnnulDocumentation\);/);
    assert.match(panelSource, /setShowAllDocumentation\(\(current\) => !current\)/);
    // 9. Estilos con tokens: tachado y atenuado; "Anulado por" legible; el botón no se estira.
    assert.match(cssSource, /\.works-task-panel__entries \.is-annulled > p \{ color: var\(--color-text-muted\); text-decoration: line-through; \}/);
    assert.match(cssSource, /\.works-task-panel__entries > div > \.ui-button, \.works-task-panel__more \{ justify-self: start; \}/);
    // 10. El diálogo de anular: motivo obligatorio, error con Notice dentro, requestId estable y Button loading.
    const annulSource = await readFile(new URL("../src/features/works/WorkTaskDocumentationAnnulDialog.jsx", import.meta.url), "utf8");
    assert.match(annulSource, /useWorkFormSubmit\(\{prefix: "task-document-annul"\}\)/);
    assert.match(annulSource, /form\.submit\(\{entryId: entry\.id, motivo\}, \(requestId, onError\) => onAnnul\(motivo, \{onError, requestId\}\)\)\.then\(\(success\) => \{ if \(success\) onClose\(\); \}\)/, "se cierra solo si se anuló; un reintento reutiliza el requestId");
    assert.match(annulSource, /if \(!motivo\) \{ setFieldError\("Escribe el motivo de la anulación\."\); reasonRef\.current\?\.focus\(\); return; \}/);
    assert.match(annulSource, /<WorkFormError error=\{form\.error\} noticeRef=\{form\.noticeRef\} title="No se pudo anular el comentario" \/>/);
    assert.match(annulSource, /<Button type="submit" form=\{FORM_ID\} variant="danger" loading=\{loading\} disabled=\{busy && !loading\}>Anular comentario<\/Button>/);
    assert.match(annulSource, /setReason\(event\.target\.value\); setFieldError\(""\); form\.clearError\(\);/, "el error se limpia al editar y el motivo escrito se conserva");
    assert.doesNotMatch(annulSource, /from ["'].*(workService|firebase)|httpsCallable|getDocs/);
    const {default: WorkTaskDocumentationAnnulDialog} = await vite.ssrLoadModule("/src/features/works/WorkTaskDocumentationAnnulDialog.jsx");
    const annulMarkup = renderToStaticMarkup(React.createElement(WorkTaskDocumentationAnnulDialog, {entry: entries[0], onAnnul: async () => true, onClose: () => {}, processing: "", processingKey: "task-document-annul-d6"}));
    assert.match(annulMarkup, /Anular comentario/); assert.match(annulMarkup, /Sexto comentario/); assert.match(annulMarkup, /Motivo de la anulación \*/);
    assert.equal(renderToStaticMarkup(React.createElement(WorkTaskDocumentationAnnulDialog, {entry: null, onAnnul: async () => true, onClose: () => {}})), "", "sin comentario no se dibuja");
    const annulBusy = renderToStaticMarkup(React.createElement(WorkTaskDocumentationAnnulDialog, {entry: entries[0], onAnnul: async () => true, onClose: () => {}, processing: "task-document-annul-d6", processingKey: "task-document-annul-d6"}));
    assert.match(annulBusy, /ui-button--danger ui-button--loading[^>]*aria-busy="true"[\s\S]*?ui-spinner[\s\S]*?Anular comentario/, "Button loading mientras se anula");
    // 11. "En espera" sin hex: tokens que cambian con el tema, sin bloque propio para oscuro.
    assert.match(cssSource, /\.works-wait-reason \{ background: var\(--color-warning-50\);[^}]*color: var\(--color-warning-800\) !important;/);
    assert.doesNotMatch(cssSource.split("\n").filter((line) => line.startsWith(".works-wait-reason")).join("\n"), /#[0-9a-fA-F]{3,8}\b/, ".works-wait-reason no lleva ningún hex");
  }
  console.log("OK documentación de la tarea: campo arriba, 3 vigentes + Ver todos (N), fecha y hora, Anular con motivo, anulado tachado y contador de vigentes");

  // --- Nueva tarea: error dentro del diálogo, requestId estable y Button loading ---
  {
    const createSource = await readFile(new URL("../src/features/works/WorkTaskCreateDialog.jsx", import.meta.url), "utf8");
    assert.match(createSource, /useWorkFormSubmit\(\{prefix: "task-create"\}\)/);
    assert.match(createSource, /form\.submit\(draft, \(requestId, onError\) => onSubmit\(draft, \{onError, requestId\}\)\)\.then\(\(success\) => \{ if \(success\) onClose\(\); \}\)/, "se cierra solo si se creó; el reintento con los mismos datos reutiliza el requestId");
    assert.match(createSource, /<WorkFormError error=\{form\.error\} noticeRef=\{form\.noticeRef\} title="No se pudo crear la tarea" \/>/);
    assert.match(createSource, /const edit = \(change\) => \{ setDraft\(\(current\) => \(\{\.\.\.current, \.\.\.change\}\)\); form\.clearError\(\); \};/, "el error se limpia al editar y el borrador se conserva");
    assert.match(createSource, /loading=\{processing === "task-new"\}/);
    assert.doesNotMatch(createSource, /from ["'].*(workService|firebase)|httpsCallable/);
    console.log("OK Nueva tarea: error con Notice dentro del diálogo, requestId estable en reintentos y Button loading");
  }

  // --- Errores de las acciones de la tarea dentro del panel, requestId estable y Button loading ---
  {
    const panelSource = await readFile(new URL("../src/features/works/WorkTaskPanel.jsx", import.meta.url), "utf8");
    const boardSource2 = await readFile(new URL("../src/features/works/WorkProjectBoard.jsx", import.meta.url), "utf8");
    const pageSource = await readFile(new URL("../src/pages/WorksPage.jsx", import.meta.url), "utf8");
    // Cada acción del panel pasa por un useWorkFormSubmit y recibe {onError, requestId}.
    for (const [label, pattern] of [
      ["asignar", /rowForm\.submit\(\{assign: responsableUid\}, \(requestId, onError\) => actions\.assignTask\(task, responsableUid, \{onError, requestId\}\)\)/],
      ["estado", /rowForm\.submit\(\{estado\}, \(requestId, onError\) => onRequestTaskState\(task, estado, \{onError, requestId\}\)\)/],
      ["agregar subtarea", /subtaskForm\.submit\(\{add: titulo\}, \(requestId, onError\) => actions\.addSubtask\(task, titulo, \{onError, requestId\}\)\)/],
      ["renombrar subtarea", /subtaskForm\.submit\(\{rename: subtask\.id, titulo\}, \(requestId, onError\) => actions\.renameSubtask\(task, subtask, titulo, \{onError, requestId\}\)\)/],
      ["marcar subtarea", /subtaskForm\.submit\(\{toggle: subtask\.id, completada: !subtask\.completada\}, \(requestId, onError\) => actions\.toggleSubtask\(task, subtask, \{onError, requestId\}\)\)/],
      ["eliminar subtarea", /subtaskForm\.submit\(\{remove: subtask\.id\}, \(requestId, onError\) => actions\.removeSubtask\(task, subtask, \{onError, requestId\}\)\)/],
      ["documentación", /documentationForm\.submit\(\{texto\}, \(requestId, onError\) => actions\.addDocumentation\(task, texto, \{onError, requestId\}\)\)/],
    ]) assert.match(panelSource, pattern, label + ": error dentro del panel y requestId estable");
    // El error se dibuja dentro del panel (Notice de error) y el campo conserva lo escrito: el texto solo se borra con un éxito.
    for (const [title, form] of [["No se pudo actualizar la tarea", "rowForm"], ["No se pudo actualizar la subtarea", "subtaskForm"], ["No se pudo agregar la documentación", "documentationForm"]]) {
      assert.match(panelSource, new RegExp('<WorkFormError error=\\{' + form + '\\.error\\} noticeRef=\\{' + form + '\\.noticeRef\\} title="' + title + '" />'));
    }
    assert.match(panelSource, /\.then\(\(success\) => \{ if \(success\) setSubtaskTitle\(""\); \}\)/); assert.match(panelSource, /\.then\(\(success\) => \{ if \(success\) setDocumentation\(""\); \}\)/);
    assert.match(panelSource, /setDocumentation\(event\.target\.value\); setDocumentationError\(""\); documentationForm\.clearError\(\);/, "se limpia al editar");
    assert.match(panelSource, /setSubtaskTitle\(event\.target\.value\); setSubtaskError\(""\); subtaskForm\.clearError\(\);/);
    // Subtarea vacía o solo espacios: mensaje bajo el campo (como en la nota), foco al campo y nada se envía.
    assert.match(panelSource, /if \(!titulo\) \{ setSubtaskError\("Escribe el nombre de la subtarea antes de agregarla\."\); subtaskRef\.current\?\.focus\(\); return; \}/);
    assert.match(panelSource, /\{subtaskError && <small className="works-field-error" id=\{`subtask-new-error-\$\{task\.id\}`\}>\{subtaskError\}<\/small>\}/);
    assert.match(panelSource, /aria-describedby=\{subtaskError \? `subtask-new-error-\$\{task\.id\}` : undefined\} aria-invalid=\{subtaskError \? "true" : undefined\}/);
    assert.doesNotMatch(renderPanel(task({id: "p10"}), {canManage: true}), /works-field-error/, "el mensaje solo aparece tras intentar agregar una subtarea vacía");
    // Renombrar una subtarea dejándola vacía o con solo espacios: no se envía, mensaje bajo el campo y foco (igual que agregar).
    {
      const emptyRename = 'if (!titulo) { setRenameErrors((current) => ({...current, [subtask.id]: "Escribe el nombre de la subtarea antes de guardarla."})); renameRefs.current[subtask.id]?.focus(); return; }';
      const renameStart = panelSource.indexOf("const renameSubtask = (subtask) => {");
      assert.ok(renameStart > 0, "renameSubtask existe");
      const renameBody = panelSource.slice(renameStart, panelSource.indexOf("const toggleSubtask", renameStart));
      assert.ok(renameBody.includes("const titulo = String(subtaskTitles[subtask.id] ?? subtask.titulo).trim();"), "el título se recorta antes de validar: solo espacios cuenta como vacío");
      assert.ok(renameBody.includes(emptyRename), "vacío: mensaje bajo el campo y foco");
      assert.ok(renameBody.indexOf(emptyRename) < renameBody.indexOf("subtaskForm.submit"), "la validación va antes de enviar: con título vacío no se llama al backend");
      assert.match(renameBody, /if \(titulo === subtask\.titulo\) return;/, "sin cambios tampoco se envía");
      assert.match(panelSource, /aria-describedby=\{renameErrors\[subtask\.id\] \? `subtask-rename-error-\$\{subtask\.id\}` : undefined\} aria-invalid=\{renameErrors\[subtask\.id\] \? "true" : undefined\}/);
      assert.match(panelSource, /\{renameErrors\[subtask\.id\] && <small className="works-field-error" id=\{`subtask-rename-error-\$\{subtask\.id\}`\}>\{renameErrors\[subtask\.id\]\}<\/small>\}/, "el mensaje se dibuja bajo el campo de esa subtarea");
      assert.match(panelSource, /setRenameErrors\(\(current\) => \(current\[subtask\.id\] \? \{\.\.\.current, \[subtask\.id\]: ""\} : current\)\)/, "el mensaje se limpia al editar el campo");
      assert.match(await readFile(new URL("../src/features/works/works.css", import.meta.url), "utf8"), /\.works-subtask-list > div > \.works-field-error \{ grid-column: 2 \/ -1; \}/, "el mensaje queda bajo el campo, en la columna del título");
      const renameMarkup = renderPanel(task({id: "p11", subtareas: [{id: "s11", titulo: "Canalizar", completada: false}]}), {canManage: true});
      assert.doesNotMatch(renameMarkup, /subtask-rename-error|Escribe el nombre de la subtarea antes de guardarla/, "sin mensaje hasta intentar guardar vacío");
    }
    assert.match(await readFile(new URL("../src/features/works/works.css", import.meta.url), "utf8"), /\.works-subtask-create > \.works-field-error/, "el mensaje ocupa todo el ancho del formulario");
    // La página: requestId recibido (con el de siempre como respaldo) y error por onError, no en el aviso de la página.
    for (const [action, call, name] of [["assignTask", "asignarTareaTrabajo", "task-assign"], ["addSubtask", "agregarSubtareaTrabajo", "subtask-create"], ["toggleSubtask", "actualizarSubtareaTrabajo", "subtask-toggle"], ["renameSubtask", "actualizarSubtareaTrabajo", "subtask-title"], ["removeSubtask", "eliminarSubtareaTrabajo", "subtask-delete"], ["addDocumentation", "documentarTareaTrabajo", "task-document"]]) {
      assert.match(pageSource, new RegExp(action + ': \\(task, [^)]*\\{requestId, onError\\} = \\{\\}\\) => runBoardAction\\([^\\n]*' + call + '\\([^\\n]*requestId \\|\\| createWorkTaskRequestId\\("' + name + '"\\)\\), \\{onError\\}\\)'), action);
    }
    assert.match(pageSource, /changeTaskState: \(task, estado, motivoEspera = "", \{requestId, onError\} = \{\}\) => runBoardAction\(`task-state-\$\{task\.id\}`, \(\) => cambiarEstadoTareaTrabajo\(businessId, boardWorkId, task\.id, estado, \{motivoEspera, requestId: requestId \|\| createWorkTaskRequestId\(`task-\$\{estado\}`\)\}\), \{onError\}\)/);
    // Poner en espera: diálogo propio, con su error dentro y su requestId estable.
    assert.match(boardSource2, /const waitForm = useWorkFormSubmit\(\{prefix: "task-wait"\}\)/);
    assert.match(boardSource2, /waitForm\.submit\(\{taskId: waitingTask\.id, motivo\}, \(requestId, onError\) => actions\.changeTaskState\(waitingTask, "en_espera", motivo, \{onError, requestId\}\)\)/);
    assert.match(boardSource2, /<WorkFormError error=\{waitForm\.error\} noticeRef=\{waitForm\.noticeRef\} title="No se pudo poner la tarea en espera" \/>/);
    assert.match(boardSource2, /return actions\.changeTaskState\(task, estado, "", options\);/, "el cambio de estado desde el panel devuelve la promesa y reenvía {requestId, onError}");
    assert.match(boardSource2, /setWaitReason\(event\.target\.value\); waitForm\.clearError\(\);/);
    // Button loading: el botón de la acción en curso muestra spinner y conserva el foco; los demás se deshabilitan.
    const subtaskBusy = renderPanel(task({id: "p6", subtareas: [{id: "s1", titulo: "Canalizar", completada: false}]}), {canManage: true, processing: "subtask-new-p6"});
    assert.match(subtaskBusy, /<button[^>]*class="ui-button ui-button--secondary ui-button--loading"[^>]*aria-busy="true"[^>]*>[\s\S]*?ui-spinner[\s\S]*?Agregar/, "Agregar subtarea en carga");
    assert.match(subtaskBusy, /<button[^>]*disabled=""[^>]*>[\s\S]*?Gastos, horas|<button[^>]*class="ui-button ui-button--secondary"[^>]*disabled=""/, "los otros botones quedan deshabilitados");
    const documentBusy = renderPanel(task({id: "p7"}), {canManage: true, processing: "task-document-p7"});
    assert.match(documentBusy, /ui-button--loading[^>]*aria-busy="true"[^>]*>[\s\S]*?ui-spinner[\s\S]*?Agregar/, "Agregar documentación en carga");
    const renameBusy = renderPanel(task({id: "p8", subtareas: [{id: "s9", titulo: "Canalizar", completada: false}]}), {canManage: true, processing: "subtask-title-s9"});
    assert.match(renameBusy, /aria-busy="true"/);
    assert.match(boardSource2, /loading=\{Boolean\(waitingTask\) && processing === `task-state-\$\{waitingTask\.id\}`\}/);
    // Requisitos del backend que sustentan el requestId estable: los ocho callables de tarea guardan y comparan el requestId.
    const backend = await readFile(new URL("../functions/workPersistence.js", import.meta.url), "utf8");
    for (const operation of ["crear", "agregar_subtarea", "actualizar_subtarea", "eliminar_subtarea", "asignar", "documentar", "eliminar"]) assert.match(backend, new RegExp('previousTaskRequest\\([^\\n]*operation: "' + operation + '"'), "operación " + operation);
    assert.match(backend, /previousTaskRequest\([^\n]*\{fingerprint: requestFingerprint, operation, uid: context\.uid\}/, "cambiarEstadoTareaTrabajo también guarda su requestId");
  }
  console.log("OK acciones de la tarea: error dentro del panel (y del diálogo de espera), requestId estable y botones con loading");

  // --- Menú ⋯ de la tarjeta (SPEC 028 §4.2; reemplaza a la papelera roja) ---
  {
    const cardTasks = [
      task({id: "free", titulo: "Libre"}),
      task({id: "costly", titulo: "Con costo"}),
      task({id: "done", titulo: "Hecha", estado: "completada", completada: true}),
      task({id: "docs", titulo: "Con documentos", documentacionTotal: 2}),
    ];
    const withDelete = render(cardTasks, {costs: {...COSTS, labor: [{tareaId: "costly", estado: "anulado"}]}, onDeleteTask: () => {}});
    const cards = withDelete.split('<div class="works-task-card works-task-card--deletable">').slice(1);
    assert.equal(cards.length, 4, "cada tarjeta lleva su menú");
    for (const card of cards) {
      assert.match(card, /<div class="works-task-card__menu"><button type="button" class="works-task-card__menu-trigger"[^>]*aria-haspopup="menu"[^>]*aria-label="Más acciones de la tarea"/);
      assert.ok(card.indexOf("</button>") < card.indexOf("works-task-card__menu"), "el menú es hermano del botón de la tarjeta, no está dentro de él");
    }
    assert.doesNotMatch(withDelete, /works-task-card__delete|lucide-trash/, "ya no hay papelera roja en la tarjeta");
    // Las opciones del menú viven en un portal que solo existe abierto: la regla de deshabilitado se fija en el código.
    assert.match(boardSource, /actions=\{\[\{label: "Eliminar tarea", disabled: !deletion\.canDelete, onSelect: \(\) => onDeleteTask\(task\)\}\]\}/, "Eliminar tarea se deshabilita con getWorkTaskDeletionState");
    assert.match(boardSource, /getWorkTaskDeletionState\(task, costs\)/);
    const withoutDelete = render(cardTasks);
    assert.doesNotMatch(withoutDelete, /works-task-card__menu|works-task-card--deletable|Eliminar/, "sin onDeleteTask (sin gestión o proyecto terminado) no hay menú");
    assert.equal((withoutDelete.match(/class="works-task-card"/g) || []).length, 4);
    console.log("OK menú ⋯ de la tarjeta: uno por tarea, hermano del botón, deshabilitado según getWorkTaskDeletionState y ausente sin permiso");
  }

  // --- Caso 13 (reescrito, SPEC 028 etapa B): ni las columnas ni el contenedor interceptan errores ---
  // WorkTaskBoard (columnas y tarjetas base) sigue sin estado ni manejo de errores. El estado de borradores
  // (subtarea, documentación, tarea nueva, diálogos) vive en WorkProjectBoard, que tampoco captura errores:
  // cada acción devuelve la promesa de runBoardAction (WorksPage), el mismo camino de error que usaba la lista.
  // Excepciones: createTask, annulDocumentation y removeTask reciben {requestId, onError} para que su diálogo
  // (Nueva tarea, Anular comentario y Eliminar) muestre el mensaje del backend y reutilice el requestId.
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
