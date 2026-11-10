import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";
import {WORK_COST_SCOPE_ORPHAN, filterWorkCostsByTaskScope, getDefaultBoardWorkId} from "../src/domain/workModel.mjs";

// SPEC 028 etapas B y B2: tablero por proyecto (tres columnas, tarjeta compacta, panel de la tarea, "Nueva
// tarea" en diálogo corto, costos con pestañas) y vista Cerrados. WorkProjectBoard no importa servicios
// ni Firebase, así que se renderiza aquí en el servidor de Vite. La página
// (WorksPage.jsx) no se puede cargar por este camino; sus conexiones se
// comprueban por texto fuente.

// --- Helpers de dominio ---
const tasks = [{id: "t1"}, {id: "t2"}];
const records = [
  {id: "a", tareaId: "t1"},
  {id: "b", tareaId: ""},
  {id: "c"},
  {id: "d", tareaId: "borrada"},
  {id: "e", tareaId: "t2"},
];
assert.deepEqual(filterWorkCostsByTaskScope(records, undefined, tasks).map((entry) => entry.id), ["a", "b", "c", "d", "e"], "sin alcance no se filtra nada");
assert.deepEqual(filterWorkCostsByTaskScope(records, "t1", tasks).map((entry) => entry.id), ["a"]);
assert.deepEqual(filterWorkCostsByTaskScope(records, "", tasks).map((entry) => entry.id), ["b", "c"], "General: costos sin tareaId");
assert.deepEqual(filterWorkCostsByTaskScope(records, WORK_COST_SCOPE_ORPHAN, tasks).map((entry) => entry.id), ["d"], "Sin tarea asignada: tareaId que ya no existe");
assert.deepEqual(filterWorkCostsByTaskScope(null, "t1", tasks), []);
const everyBucket = [...filterWorkCostsByTaskScope(records, "t1", tasks), ...filterWorkCostsByTaskScope(records, "t2", tasks), ...filterWorkCostsByTaskScope(records, "", tasks), ...filterWorkCostsByTaskScope(records, WORK_COST_SCOPE_ORPHAN, tasks)];
assert.equal(everyBucket.length, records.length, "cada costo cae en exactamente una tarjeta");
console.log("OK dominio: cada costo pertenece a una sola tarjeta (tarea, General o Sin tarea asignada)");

assert.equal(getDefaultBoardWorkId([{id: "w1", estado: "completado"}, {id: "w2", estado: "en_progreso"}, {id: "w3", estado: "pendiente"}]), "w2", "el abierto más reciente (la lista llega del más reciente al más antiguo)");
assert.equal(getDefaultBoardWorkId([{id: "w1", estado: "completado"}, {id: "w2", estado: "cancelado"}]), "w1", "si todos están cerrados, el primero");
assert.equal(getDefaultBoardWorkId([]), "");
console.log("OK dominio: proyecto por defecto del tablero");

// --- Render ---
function task(overrides = {}) {
  return {
    id: "t1", titulo: "Tender cableado", descripcion: "", modeloTareaVersion: 2, responsableUid: "", responsableSnapshot: null,
    estado: "pendiente", completada: false, subtareas: [], motivoEspera: "", creadoEn: "2026-08-01T10:00:00.000Z",
    documentacionTotal: 0, documentacion: [], ...overrides,
  };
}

const works = [
  {id: "w1", numero: "TRB-2026-0002", titulo: "Red oficina", estado: "en_progreso", tareasTotal: 2, tareasCompletadas: 1, progresoPct: 50, clienteSnapshot: {nombreRazonSocial: "Cliente SA"}},
  {id: "w0", numero: "TRB-2026-0001", titulo: "Cámaras", estado: "completado", tareasTotal: 1, tareasCompletadas: 1, progresoPct: 100},
];
const baseActions = Object.fromEntries(["createTask", "assignTask", "changeTaskState", "addSubtask", "toggleSubtask", "renameSubtask", "removeSubtask", "addDocumentation", "removeTask"].map((name) => [name, async () => true]));

const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
try {
  const {default: WorkProjectBoard} = await vite.ssrLoadModule("/src/features/works/WorkProjectBoard.jsx");
  const render = (props = {}) => renderToStaticMarkup(React.createElement(WorkProjectBoard, {
    actions: baseActions, canManage: true, canOperate: () => true, costs: {expenses: [], labor: [], materials: []}, currency: "CLP",
    currentUserUid: "u1", detail: {tareas: []}, error: "", loading: false, members: [{uid: "u1", nombre: "Nombre no informado", correo: "owner@example.cl"}],
    onOpenFicha: () => {}, onRetry: () => {}, onSelectWork: () => {}, processing: "", projectCost: 0, renderCosts: () => null, terminal: false,
    work: works[0], workId: "w1", works, ...props,
  }));

  // Selector de proyecto con el elegido seleccionado; el cerrado se rotula.
  const picker = render();
  assert.match(picker, /<select[^>]*>[\s\S]*TRB-2026-0002 · Red oficina[\s\S]*TRB-2026-0001 · Cámaras \(Completado\)/);
  assert.match(picker, /<option value="w1" selected="">|<option selected="" value="w1">/);
  assert.match(picker, /Ver ficha/);
  console.log("OK selector de proyecto, estado del elegido y acceso a la ficha");

  // Solo las tareas del proyecto elegido, en tres columnas, con tarjeta compacta.
  const withTasks = render({detail: {tareas: [
    task({id: "t1", titulo: "Tender cableado", estado: "en_progreso", responsableUid: "u1", responsableSnapshot: {nombre: "Nombre no informado", correo: "owner@example.cl"}, descripcion: "Pasar cable por el cielo falso", subtareas: [{id: "s1", titulo: "Canalizar", completada: true}, {id: "s2", titulo: "Pasar cable", completada: false}]}),
    task({id: "t2", titulo: "Coordinar visita", estado: "pendiente"}),
    task({id: "t3", titulo: "Entrega", estado: "completada", completada: true}),
    task({id: "t4", titulo: "Esperar permiso", estado: "en_espera", motivoEspera: "Falta autorización del cliente"}),
  ]}});
  const columns = withTasks.split('<section class="works-task-board__column"').slice(1);
  assert.equal(columns.length, 3, "tres columnas: Por hacer, En curso y Hecho");
  assert.match(withTasks, /<h4>Por hacer<\/h4>/); assert.match(withTasks, /<h4>En curso<\/h4>/); assert.match(withTasks, /<h4>Hecho<\/h4>/);
  assert.doesNotMatch(withTasks, /<h4>En espera<\/h4>|<h4>Pendiente<\/h4>|<h4>Completada<\/h4>|<h4>En progreso<\/h4>/);
  assert.equal((withTasks.match(/works-task-board__card"/g) || []).length, 4);
  assert.match(columns[0], /Coordinar visita/);
  assert.match(columns[1], /Tender cableado/); assert.match(columns[1], /Esperar permiso/);
  assert.ok(columns[1].indexOf("Tender cableado") < columns[1].indexOf("Esperar permiso"), "En espera va dentro de En curso, al final");
  assert.match(columns[1], /En espera<\/span>/); assert.match(columns[1], /Falta autorización del cliente/, "la etiqueta de espera trae su motivo");
  assert.doesNotMatch(columns[0] + columns[2], /En espera|Falta autorización/);
  assert.match(columns[2], /Entrega/);
  // La tarjeta es un resumen: título, responsable (iniciales y nombre corto), subtareas con barra fina, costo y espera.
  assert.match(withTasks, /works-task-card__avatar[^>]*>OW<\/span><span class="works-task-card__name">owner<\/span>/, "iniciales y nombre corto del responsable (identidad por correo)");
  assert.doesNotMatch(withTasks, /Nombre no informado/);
  assert.match(withTasks, /Subtareas 1\/2/); assert.match(withTasks, /<progress[^>]*works-task-progress--thin[^>]*value="50"|<progress[^>]*value="50"[^>]*works-task-progress--thin/, "barra fina de avance de subtareas");
  assert.match(withTasks, /Costo asignado/);
  // Todo lo demás sale de la tarjeta: va en el panel.
  assert.doesNotMatch(withTasks, /Canalizar|Pasar cable|Pasar cable por el cielo falso|Nueva subtarea|Documentación|<select[^>]*aria-label|Responsable de|Cambiar estado de|Creada/, "subtareas, descripción, documentación y selectores ya no están en la tarjeta");
  assert.doesNotMatch(withTasks, /<progress[^>]*aria-label="Avance de Coordinar visita"/, "sin subtareas no hay barra");
  assert.equal((withTasks.match(/Gastos, HH y materiales/g) || []).length, 1, "el botón de costos por tarea vive en el panel; en el tablero solo queda el de General");
  assert.doesNotMatch(withTasks, /works-board-card|Cerrar proyecto|Confirmar subtareas pendientes/, "ni tarjetas de proyectos ni funciones de la etapa C");
  assert.match(withTasks, /aria-haspopup="dialog"/, "la tarjeta es un botón que abre el panel");
  console.log("OK tres columnas, En espera dentro de En curso y tarjeta compacta");

  // Nueva tarea: botón que abre un formulario corto, solo con permiso de gestión y en proyecto abierto.
  assert.match(withTasks, /Nueva tarea/); assert.doesNotMatch(withTasks, /Crear tarea|Descripción operativa|Título de la tarea/, "el formulario ya no está siempre visible");
  const nonManager = render({canManage: false, canOperate: (item) => item.id === "t1", detail: {tareas: [task({id: "t1"}), task({id: "t2", titulo: "Ajena"})]}});
  assert.doesNotMatch(nonManager, /Nueva tarea/);
  assert.doesNotMatch(nonManager, /Ajena/, "una persona sin permiso de gestión solo ve sus tareas");
  console.log("OK permisos: Nueva tarea solo para gestión; tareas ajenas ocultas");

  // Tarjetas General y Sin tarea asignada.
  assert.match(withTasks, /works-project-board__cost-card/);
  assert.match(withTasks, /<strong>General<\/strong>/);
  assert.doesNotMatch(withTasks, /Sin tarea asignada/, "sin costos huérfanos no se muestra la tarjeta");
  const orphan = render({detail: {tareas: [task({id: "t1"})]}, costs: {expenses: [{id: "g1", tareaId: "borrada", estado: "vigente", monto: 5000, categoria: "OTRO"}], labor: [], materials: []}});
  assert.match(orphan, /<strong>Sin tarea asignada<\/strong>/); assert.match(orphan, /Ver costos/);
  assert.match(orphan, /\$\s?5\.000/);
  console.log("OK tarjetas General y Sin tarea asignada (solo con costos huérfanos)");

  // Solo lectura: proyecto terminado.
  const readOnly = render({terminal: true, work: works[1], workId: "w0", detail: {tareas: [task({id: "t1", estado: "completada", completada: true})]}});
  assert.match(readOnly, /solo lectura/);
  assert.doesNotMatch(readOnly, /Nueva tarea|Nueva subtarea|Responsable de/);
  console.log("OK proyecto terminado: tablero en solo lectura");

  // Panel de la tarea: lo que salió de la tarjeta.
  {
    const {default: WorkTaskPanel} = await vite.ssrLoadModule("/src/features/works/WorkTaskPanel.jsx");
    const fullTask = task({id: "t1", titulo: "Tender cableado", estado: "en_progreso", modeloTareaVersion: 1, responsableUid: "u1", responsableSnapshot: {correo: "owner@example.cl"}, descripcion: "Pasar cable por el cielo falso", subtareas: [{id: "s1", titulo: "Canalizar", completada: true}, {id: "s2", titulo: "Pasar cable", completada: false}], documentacion: [{id: "d1", texto: "Foto del tramo", autorUid: "u1", creadoEn: "2026-08-02T10:00:00.000Z"}]});
    const panelProps = {actions: {}, canManage: true, canOperate: () => true, costs: {expenses: [], labor: [], materials: []}, currency: "CLP", members: [{uid: "u1", nombre: "", correo: "owner@example.cl"}], onClose: () => {}, onOpenCosts: () => {}, onRequestTaskState: () => {}, processing: "", task: fullTask, terminal: false};
    const panel = renderToStaticMarkup(React.createElement(WorkTaskPanel, panelProps));
    assert.match(panel, /role="dialog"/); assert.match(panel, /works-task-panel-layer/); assert.match(panel, /Tender cableado/);
    assert.match(panel, /Pasar cable por el cielo falso/, "descripción");
    assert.match(panel, />Responsable<\/span><select/); assert.match(panel, /owner@example\.cl/, "selector de responsable con identidad");
    assert.match(panel, /Completar Canalizar/); assert.match(panel, /Nueva subtarea de Tender cableado/, "subtareas: marcar y agregar");
    assert.match(panel, /Documentación \(1\)/); assert.match(panel, /Foto del tramo/);
    assert.match(panel, /Gastos, HH y materiales/); assert.match(panel, /Costo asignado/, "costos");
    assert.match(panel, />Estado<\/span><select/); assert.match(panel, /<option value="en_espera">En espera<\/option>/, "selector de estado");
    assert.match(panel, /Tarea legacy/, "etiqueta de tarea legacy");
    // Solo lectura: proyecto terminado.
    const panelReadOnly = renderToStaticMarkup(React.createElement(WorkTaskPanel, {...panelProps, terminal: true}));
    assert.doesNotMatch(panelReadOnly, /Nueva subtarea|<select|Eliminar/);
    // Sin tarea elegida el panel no se dibuja.
    assert.equal(renderToStaticMarkup(React.createElement(WorkTaskPanel, {...panelProps, task: null})), "");
    console.log("OK panel de la tarea: descripción, responsable, subtareas, documentación, costos, estado y etiqueta legacy");

    const {default: WorkTaskCreateDialog} = await vite.ssrLoadModule("/src/features/works/WorkTaskCreateDialog.jsx");
    const createForm = renderToStaticMarkup(React.createElement(WorkTaskCreateDialog, {members: [{uid: "u1", nombre: "Ana Pérez", correo: "ana@example.cl"}], onClose: () => {}, onSubmit: async () => true, open: true, processing: ""}));
    assert.match(createForm, /Nueva tarea/); assert.match(createForm, /Título \*/); assert.match(createForm, /Responsable/); assert.match(createForm, /Descripción<span class="works-field-optional">Opcional<\/span>/); assert.match(createForm, /Ana Pérez/);
    assert.equal((createForm.match(/<textarea/g) || []).length, 1); assert.equal((createForm.match(/<input/g) || []).length, 1, "solo título, responsable y descripción");
    assert.equal(renderToStaticMarkup(React.createElement(WorkTaskCreateDialog, {members: [], onClose: () => {}, onSubmit: async () => true, open: false, processing: ""})), "");
    console.log("OK Nueva tarea: formulario corto (título, responsable y descripción opcional)");

    // Eliminar tarea (SPEC 028 §4.2): diálogo de confirmación simple, con el error del backend dentro.
    const {default: WorkTaskDeleteDialog} = await vite.ssrLoadModule("/src/features/works/WorkTaskDeleteDialog.jsx");
    const dialog = (props = {}) => renderToStaticMarkup(React.createElement(WorkTaskDeleteDialog, {error: "", onClose: () => {}, onConfirm: () => {}, processing: "", task: task({id: "t1", titulo: "Tender cableado"}), ...props}));
    assert.equal(dialog({task: null}), "", "sin tarea elegida el diálogo no se dibuja");
    const confirmation = dialog();
    assert.match(confirmation, /role="dialog"/); assert.match(confirmation, /Eliminar tarea/); assert.match(confirmation, /«Tender cableado»/, "lleva el nombre de la tarea");
    assert.match(confirmation, /Esta acción no se puede deshacer\./); assert.match(confirmation, />Volver</); assert.match(confirmation, /ui-button--danger/); assert.match(confirmation, />Eliminar</);
    assert.doesNotMatch(confirmation, /permanente/i, "confirmación simple, sin escribir ninguna palabra");
    assert.doesNotMatch(confirmation, /<input|<textarea/, "sin campo de confirmación");
    assert.doesNotMatch(confirmation, /role="alert"|subtareas/, "sin error y sin subtareas no hay avisos");
    assert.match(dialog({task: task({id: "t1", titulo: "Con subtareas", subtareas: [{id: "s1", titulo: "Una", completada: true}]})}), /Se eliminarán también sus subtareas\./);
    const backendError = "No se puede eliminar la tarea porque tiene registros de gastos. Los registros anulados también cuentan.";
    const failed = dialog({error: backendError});
    assert.match(failed, new RegExp(`<div class="works-message works-message--error" role="alert">${backendError.replace(/\./g, "\\.")}</div>`), "el error se muestra dentro del diálogo");
    assert.ok(failed.indexOf("«Tender cableado»") < failed.indexOf('role="alert"') && failed.indexOf('role="alert"') < failed.indexOf(">Volver<"), "el error queda dentro del cuerpo del diálogo, antes de los botones");
    const busy = dialog({processing: "task-delete-t1"});
    assert.match(busy, /aria-busy="true"/, "Eliminar muestra la carga mientras se procesa");
    assert.match(busy.split("<button").find((chunk) => chunk.includes("Volver")), /disabled/, "Volver se deshabilita mientras se procesa");
    console.log("OK diálogo de eliminar: nombre de la tarea, sin texto de confirmación, error del backend dentro y carga en el botón");

    // Basurero en las tarjetas: gestión y proyecto abierto; deshabilitado si la tarea tiene costos.
    const deletable = render({detail: {tareas: [task({id: "t1", titulo: "Libre"}), task({id: "t2", titulo: "Con gasto"})]}, costs: {expenses: [{id: "g1", tareaId: "t2", estado: "anulado", monto: 1, categoria: "OTRO"}], labor: [], materials: [], additionals: []}});
    assert.equal((deletable.match(/class="works-task-card__delete"/g) || []).length, 2, "una por tarjeta");
    assert.equal((deletable.match(/aria-disabled="true"/g) || []).length, 1, "solo la tarea con un gasto anulado queda deshabilitada");
    assert.match(deletable, /registros de gastos\. Los registros anulados también cuentan\./);
    assert.doesNotMatch(render({canManage: false, canOperate: () => true, detail: {tareas: [task({id: "t1", responsableUid: "u1"})]}}), /works-task-card__delete|Eliminar/, "sin gestión no hay basurero");
    assert.doesNotMatch(render({terminal: true, detail: {tareas: [task({id: "t1"})]}}), /works-task-card__delete|Eliminar/, "con el proyecto terminado no hay basurero");
    console.log("OK basurero del tablero: solo con gestión y proyecto abierto, deshabilitado con costos");
  }

  // Vista Cerrados: lista, permisos de lo monetario, y error separado del vacío.
  {
    const {default: WorkClosedProjects} = await vite.ssrLoadModule("/src/features/works/WorkClosedProjects.jsx");
    const closedWorks = [
      {id: "c1", numero: "TRB-2026-0004", titulo: "Cableado bodega", estado: "completado", clienteSnapshot: {nombreRazonSocial: "Cliente SA"}, fechaInicio: "2026-09-01", fechaPrevista: "2026-09-10", fechaCompletado: "2026-09-13T15:00:00.000Z"},
      {id: "c2", numero: "TRB-2026-0003", titulo: "Cámaras sucursal", estado: "completado", clienteSnapshot: {nombreRazonSocial: "Otra Ltda"}, fechaInicio: "2026-08-01", fechaPrevista: "2026-08-20", fechaCompletado: "2026-08-18T15:00:00.000Z"},
      {id: "c3", numero: "TRB-2026-0002", titulo: "Red cancelada", estado: "cancelado", actualizadoEn: "2026-07-10T15:00:00.000Z", creadoEn: "2026-07-01T15:00:00.000Z"},
      {id: "o1", numero: "TRB-2026-0005", titulo: "Proyecto abierto", estado: "en_progreso"},
    ];
    const balances = {
      c1: {estado: "COMPLETO", moneda: "CLP", valorComercial: 500000, costoTotal: 300000, resultado: 200000, rentabilidadPct: 40},
      c2: {estado: "COMPLETO", moneda: "CLP", valorComercial: 100000, costoTotal: 150000, resultado: -50000, rentabilidadPct: -50},
      c3: {estado: "PARCIAL_SIN_VENTA", moneda: "CLP", valorComercial: null, costoTotal: 1000, resultado: null, rentabilidadPct: null},
    };
    const renderClosed = (props = {}) => renderToStaticMarkup(React.createElement(WorkClosedProjects, {balances, balancesError: "", balancesLoading: false, canViewProfitability: true, onOpenWork: () => {}, onRetryBalances: () => {}, works: closedWorks, ...props}));

    const withProfit = renderClosed();
    assert.ok(withProfit.indexOf("TRB-2026-0004") < withProfit.indexOf("TRB-2026-0003") && withProfit.indexOf("TRB-2026-0003") < withProfit.indexOf("TRB-2026-0002"), "el cierre más reciente primero");
    assert.doesNotMatch(withProfit, /Proyecto abierto/, "solo completados y cancelados");
    assert.match(withProfit, /Cliente SA/); assert.match(withProfit, /Plan 10 d · Real 13 d \(\+3 d\)/, "duración planificada contra real"); assert.match(withProfit, /Plan 20 d · Real 18 d \(−2 d\)/);
    assert.match(withProfit, /Cancelado/);
    assert.match(withProfit, /Ganó/); assert.match(withProfit, /Perdió/); assert.match(withProfit, /lucide-trending-up|lucide-trending-down/, "resultado con icono y texto");
    assert.match(withProfit, /\$\s?500\.000/); assert.match(withProfit, /\$\s?300\.000/); assert.match(withProfit, /40%/);
    assert.match(withProfit, /Sin ingreso confirmado/, "sin Venta confirmada no se inventa un ingreso ni un resultado");
    assert.match(withProfit, /<th>Balance<\/th>/);
    assert.match(withProfit, /aria-label="Abrir TRB-2026-0004 Cableado bodega"/, "cada fila abre la ficha");

    // Sin permiso de ganancias: nada monetario ni columna de balance.
    const withoutProfit = renderClosed({canViewProfitability: false, balancesError: "No se pudo cargar el balance de 1 proyecto."});
    assert.doesNotMatch(withoutProfit, /Ganó|Perdió|Ingresos|Costos|Resultado|Margen|<th>Balance<\/th>|\$\s?\d|Cargando balances|No se pudo cargar el balance/, "sin canViewWorkProfitability no hay nada monetario, ni aviso de balances");
    assert.match(withoutProfit, /Cableado bodega/); assert.match(withoutProfit, /Plan 10 d · Real 13 d/); assert.match(withoutProfit, /Cliente SA/);

    // Estados: carga de balances, error (separado del vacío) y vacío.
    const loadingBalances = renderClosed({balances: {}, balancesLoading: true});
    assert.equal((loadingBalances.match(/role="status"/g) || []).length, 1, "un solo role=status"); assert.match(loadingBalances, /Cableado bodega/, "la lista no espera a los balances");
    const failedBalances = renderClosed({balancesError: "No se pudo cargar el balance de 1 proyecto."});
    assert.match(failedBalances, /role="alert"/); assert.match(failedBalances, /Reintentar/); assert.match(failedBalances, /Cableado bodega/, "el error de balances no tapa la lista");
    assert.doesNotMatch(failedBalances, /Aún no hay proyectos cerrados/, "un error nunca se muestra como vacío");
    const emptyClosed = renderClosed({works: [closedWorks[3]]});
    assert.match(emptyClosed, /Aún no hay proyectos cerrados/); assert.doesNotMatch(emptyClosed, /role="alert"|Reintentar/, "el vacío real no muestra error ni Reintentar");
    assert.doesNotMatch(emptyClosed, /ui-skeleton/, "un vacío real nunca muestra skeleton");

    // Solo los 20 cierres más recientes cargan balance; los demás no piden ni muestran importes.
    const many = Array.from({length: 22}, (_, index) => ({id: `m${index}`, numero: `TRB-2026-${String(100 + index)}`, titulo: `Cerrado ${index}`, estado: "completado", fechaCompletado: `2026-09-${String(28 - Math.floor(index / 2)).padStart(2, "0")}T15:00:00.000Z`}));
    const manyMarkup = renderClosed({works: many, balances: {}});
    assert.match(manyMarkup, /solo los 20 cierres más recientes/);
    console.log("OK Cerrados: orden, duración, resultado con icono y texto, permiso de ganancias, error separado del vacío y límite de 20");
  }

  // Balance de la ficha (T1-T3): ícono "i" con la explicación de cada cifra, resultado con Ganó/Perdió, color y signo,
  // y el aviso de gastos de tipo Material que no suman. WorkBalanceSection vive en WorksPage.jsx (no se carga por este
  // camino): aquí se prueban sus piezas y abajo, por texto fuente, su conexión.
  {
    const {default: WorkInfoTip} = await vite.ssrLoadModule("/src/features/works/WorkInfoTip.jsx");
    const {WORK_BALANCE_HELP, WorkBalanceResult, getExcludedMaterialExpense} = await vite.ssrLoadModule("/src/features/works/WorkBalanceParts.jsx");
    const {adaptWorkBalance, getWorkClosedResultKind} = await import("../src/domain/workModel.mjs");
    const money = (value) => (value == null ? "No disponible" : new Intl.NumberFormat("es-CL", {style: "currency", currency: "CLP"}).format(value));

    // Ícono "i": botón real con nombre accesible, panel oculto en el DOM y enlazado con aria-describedby.
    const tip = renderToStaticMarkup(React.createElement(WorkInfoTip, {label: "Qué incluye Ingresos"}, "Texto de prueba"));
    assert.match(tip, /<button[^>]*class="works-info__button"/); assert.match(tip, /<button[^>]*type="button"/);
    assert.match(tip, /<button[^>]*aria-label="Qué incluye Ingresos"/); assert.match(tip, /<button[^>]*aria-expanded="false"/);
    const panelId = tip.match(/<span class="works-info__panel"[^>]*id="([^"]+)"/)?.[1];
    assert.ok(panelId, "el panel tiene id");
    assert.ok(tip.includes(`aria-describedby="${panelId}"`) && tip.includes(`aria-controls="${panelId}"`), "el botón apunta al panel");
    assert.match(tip, /<span class="works-info__panel"[^>]*hidden=""/, "cerrado: el texto está en el DOM pero oculto");
    assert.match(tip, /<span class="works-info__panel"[^>]*role="note"[^>]*>Texto de prueba<\/span>/);

    // Textos: cada cifra con su explicación, sin jerga.
    assert.deepEqual(Object.keys(WORK_BALANCE_HELP), ["ingresos", "costos", "resultado", "margen"]);
    assert.match(WORK_BALANCE_HELP.ingresos, /ventas confirmadas/); assert.match(WORK_BALANCE_HELP.ingresos, /sin IVA/);
    assert.match(WORK_BALANCE_HELP.costos, /materiales/); assert.match(WORK_BALANCE_HELP.costos, /horas hombre/); assert.match(WORK_BALANCE_HELP.costos, /gastos/);
    assert.match(WORK_BALANCE_HELP.costos, /No incluye los registros anulados/); assert.match(WORK_BALANCE_HELP.costos, /gastos de tipo Material/);
    assert.match(WORK_BALANCE_HELP.resultado, /Ingresos menos costos/); assert.match(WORK_BALANCE_HELP.margen, /Resultado dividido por los ingresos/);
    for (const text of Object.values(WORK_BALANCE_HELP)) assert.doesNotMatch(text, /autoritativ|valorizad|snapshot/i, "sin jerga");

    // Resultado: Ganó / Perdió con icono, color y signo; con 0, neutro y sin signo; sin venta, el texto de siempre.
    const result = (resultado, estado = "COMPLETO") => renderToStaticMarkup(React.createElement(WorkBalanceResult, {balance: {estado, moneda: "CLP", valorComercial: 500000, costoTotal: 300000, resultado, rentabilidadPct: 40}, money}));
    const won = result(200000);
    assert.match(won, /works-balance-result--gano/); assert.match(won, /Ganó/); assert.match(won, /lucide-trending-up/); assert.match(won, /works-balance-result__amount">\+\$\s?200\.000</, "ganancia con signo +");
    const lost = result(-50000);
    assert.match(lost, /works-balance-result--perdio/); assert.match(lost, /Perdió/); assert.match(lost, /lucide-trending-down/); assert.match(lost, /works-balance-result__amount">(?:[-−]\$|\$[-−])\s?50\.000</, "pérdida con signo menos");
    assert.doesNotMatch(lost, /\+\$/);
    const even = result(0);
    assert.match(even, /works-balance-result--equilibrio/); assert.match(even, /Sin ganancia ni pérdida/); assert.doesNotMatch(even, /Ganó|Perdió|\+\$|[-−]\$|\$[-−]/, "con resultado 0, texto neutro y sin signo");
    const partial = result(null, "PARCIAL_SIN_VENTA");
    assert.equal(partial, "No disponible", "sin venta confirmada no se inventa un resultado"); assert.doesNotMatch(partial, /works-balance-result/);
    assert.equal(getWorkClosedResultKind({estado: "COMPLETO", resultado: 200000}), "gano", "misma regla que Cerrados");

    // Gastos Material excluidos: solo se informa el monto que ya entrega el backend; si no llega, no hay aviso.
    assert.equal(adaptWorkBalance({estado: "COMPLETO", gastosMaterialExcluido: 150000}).gastosMaterialExcluido, 150000, "el campo llega a la pantalla");
    assert.equal(getExcludedMaterialExpense(adaptWorkBalance({estado: "COMPLETO", gastosMaterialExcluido: 150000})), 150000);
    assert.equal(getExcludedMaterialExpense(adaptWorkBalance({estado: "COMPLETO", gastosMaterialExcluido: 0})), null);
    assert.equal(getExcludedMaterialExpense(adaptWorkBalance({estado: "COMPLETO"})), null, "sin el campo no se calcula nada");
    assert.equal(getExcludedMaterialExpense(adaptWorkBalance({estado: "INCONSISTENTE_MONEDA", gastosMaterialExcluido: 150000})), null, "con monedas incompatibles no hay aviso");
    assert.equal(getExcludedMaterialExpense(null), null);
    console.log("OK balance de la ficha: ícono de ayuda, textos sin jerga, resultado Ganó/Perdió/neutro con color y signo, aviso de gastos Material");
  }

  // Estados de datos: cargando, error y vacío.
  const loading = render({loading: true});
  assert.match(loading, /Cargando tablero/); assert.doesNotMatch(loading, /works-task-board__column/);
  assert.equal((loading.match(/role="status"/g) || []).length, 1, "un solo role=status");
  const failed = render({error: "No se pudo cargar el tablero del proyecto."});
  assert.match(failed, /role="alert"/); assert.match(failed, /Reintentar/); assert.doesNotMatch(failed, /Aún no hay tareas|works-task-board__column|<strong>General<\/strong>/, "un fallo nunca se muestra como vacío");
  const empty = render();
  assert.match(empty, /Aún no hay tareas\./); assert.match(empty, /<strong>General<\/strong>/);
  console.log("OK estados: cargando, error (nunca vacío) y vacío");
} finally {
  await vite.close();
}

// --- Conexiones de la página (texto fuente) ---
const page = await readFile(new URL("../src/pages/WorksPage.jsx", import.meta.url), "utf8");
const board = await readFile(new URL("../src/features/works/WorkProjectBoard.jsx", import.meta.url), "utf8");
for (const [fn, name] of [["agregarTareaTrabajo", "task-create"], ["asignarTareaTrabajo", "task-assign"], ["agregarSubtareaTrabajo", "subtask-create"], ["actualizarSubtareaTrabajo", "subtask-toggle"], ["actualizarSubtareaTrabajo", "subtask-title"], ["eliminarSubtareaTrabajo", "subtask-delete"], ["documentarTareaTrabajo", "task-document"], ["eliminarTareaTrabajo", "task-delete"]]) {
  assert.match(page, new RegExp(`${fn}\\(businessId, boardWorkId,[^\\n]*createWorkTaskRequestId\\("${name}"\\)`), `${fn} con requestId ${name}`);
}
assert.match(page, /cambiarEstadoTareaTrabajo\(businessId, boardWorkId, task\.id, estado,/);
assert.match(page, /const runBoardAction = \(key, action\) => runWorkAction\(boardWorkId, key, action\);/);
// Costos: los mismos formularios, acotados a la tarea (tareaId ya asociado).
assert.match(page, /<MaterialsSection key=\{`materials-\$\{boardWorkId\}-\$\{scope\}`\}[^>]*taskId=\{scope\}/);
assert.match(page, /<FinancialSection key=\{`costs-\$\{section\}-\$\{boardWorkId\}-\$\{scope\}`\}[^>]*taskId=\{scope\}/);
// Costos con pestañas (Tabs ya existente): Gastos, Horas hombre y Materiales; mismos formularios, cada uno en su pestaña.
assert.match(board, /import \{TabPanel, Tabs\} from "\.\.\/\.\.\/components\/ui\/Tabs"/);
assert.match(board, /\{id: "gastos", label: "Gastos"\},\s*\{id: "horas", label: "Horas hombre"\},\s*\{id: "materiales", label: "Materiales"\}/);
assert.match(board, /<Tabs className="works-cost-tabs" idPrefix="work-costs"[^>]*tabs=\{COST_TABS\}/); assert.match(board, /renderCosts\(costTarget\.scope, tab\.id\)/);
assert.match(page, /const renderBoardCosts = \(scope, section\) => section === "materiales"/);
assert.match(page, /part=\{section === "horas" \? "labor" : "expenses"\}/);
assert.match(page, /\{\(!part \|\| part === "expenses"\) && <section>/); assert.match(page, /\{\(!part \|\| part === "labor"\) && <section>/);
assert.doesNotMatch(page, /Cada salida congela su costo\. Las devoluciones conservan|Estas salidas sí generan un movimiento nuevo|sin balance final|El total se calcula en backend/, "textos explicativos condensados a una línea");
// Panel y formulario corto cableados a las mismas acciones.
assert.match(board, /<WorkTaskCreateDialog [\s\S]{0,200}onSubmit=\{actions\.createTask\}/);
assert.match(board, /<WorkTaskPanel[\s\S]{0,400}task=\{selectedTask\}/);
for (const source of [board, await readFile(new URL("../src/features/works/WorkTaskPanel.jsx", import.meta.url), "utf8"), await readFile(new URL("../src/features/works/WorkTaskCreateDialog.jsx", import.meta.url), "utf8")]) assert.doesNotMatch(source, /from ["'].*(workService|firebase)|httpsCallable|getDocs/);
assert.match(page, /const fixedTaskId = scoped && !orphanScope \? taskId : "";/);
assert.match(page, /canRegister = \(canManage \|\| \["TECNICO", "MEMBER"\]\.includes\(role\)\) && !orphanScope/, "Sin tarea asignada es solo lectura");
assert.match(page, /\{!scoped && <TaskCostSelect/);
assert.match(page, /registrarGastoTrabajo\(businessId, workId, payload, createWorkCostRequestId\("expense-create"\)\)/);
assert.match(page, /registrarHorasHombreTrabajo\(businessId, workId, payload, createWorkCostRequestId\("labor-create"\)\)/);
assert.match(page, /registrarSalidaMaterialTrabajo\(businessId, workId, draft, createWorkCostRequestId\("material-exit"\)\)/);
// Ficha: botón al tablero y deep link de la ficha intacto.
assert.match(page, /onClick=\{\(\) => openWorkBoard\(selectedWork\)\}>Trabajar en el tablero</);
assert.match(page, /const openWorkBoard = \(work\) => \{ setSelectedWork\(null\); selectBoardWork\(work\.id\); \};/);
assert.match(page, /location\.state\?\.openWorkId/); assert.match(page, /navigate\(\{pathname: "\/trabajos", search: location\.search\}, \{replace: true, state: \{\}\}\)/);
// Etapa C: "Cerrar proyecto" sigue fuera de alcance; eliminar tareas (SPEC 028 §4.2) ya está.
for (const source of [page, board]) assert.doesNotMatch(source, /Cerrar proyecto|cerrarProyecto/);
const taskPanelSource = await readFile(new URL("../src/features/works/WorkTaskPanel.jsx", import.meta.url), "utf8");
const deleteDialogSource = await readFile(new URL("../src/features/works/WorkTaskDeleteDialog.jsx", import.meta.url), "utf8");
for (const [name, source] of [["tablero", board], ["panel", taskPanelSource], ["diálogo", deleteDialogSource]]) {
  assert.doesNotMatch(source, /eliminarTareaTrabajo|from ["'].*(workService|firebase)/, `${name}: presentacional, no llama la Function: recibe actions.removeTask de la página`);
}
assert.doesNotMatch(page + board + taskPanelSource, /removeLegacy/, "la acción ya no es solo para tareas legacy");
assert.match(board, /onDeleteTask=\{canManage && !terminal \? requestDelete : undefined\}/, "el basurero solo llega con gestión y proyecto abierto");
assert.match(board, /onRequestDelete=\{requestDelete\}/, "el panel pide confirmar con el mismo flujo");
assert.match(board, /<WorkTaskDeleteDialog error=\{deleteError\} onClose=\{closeDelete\} onConfirm=\{confirmDelete\} processing=\{processing\} task=\{canManage && !terminal \? deletingTask : null\} \/>/);
assert.match(board, /actions\.removeTask\(deletingTask, \(failure\) => setDeleteError\(failure\?\.message \|\| "No se pudo eliminar la tarea\."\)\)\.then\(\(success\) => \{ if \(success\) closeDelete\(\); \}\)/, "el diálogo solo se cierra si la acción se aplicó: si el backend la rechaza, queda abierto con el mensaje");
assert.match(taskPanelSource, /const showDelete = canManage && !terminal;/); assert.match(taskPanelSource, /onClick=\{\(\) => onRequestDelete\(task\)\}/);
assert.match(page, /const runWorkAction = async \(workId, key, action, \{onError\} = \{\}\) => \{/);
assert.match(page, /if \(onError\) onError\(actionError\); else setError\(actionError\.message \|\| "No se pudo actualizar el trabajo\."\);/, "sin onError el comportamiento de siempre: aviso de la página");
assert.match(page, /removeTask: \(task, onError\) => runWorkAction\(boardWorkId, `task-delete-\$\{task\.id\}`, \(\) => eliminarTareaTrabajo\(businessId, boardWorkId, task\.id, createWorkTaskRequestId\("task-delete"\)\), \{onError\}\)/);
assert.match(page, /costs=\{\{expenses: boardDetail\.gastos, labor: boardDetail\.horasHombre, materials: boardDetail\.materiales, additionals: boardDetail\.adicionales\}\}/, "los adicionales también cuentan para explicar el bloqueo");
// Balance de la ficha (T1-T3): conexión en la página y piezas sin imports de otro feature.
assert.match(page, /import \{WORK_BALANCE_HELP, WorkBalanceResult, getExcludedMaterialExpense\} from "\.\.\/features\/works\/WorkBalanceParts\.jsx";/);
assert.match(page, /import WorkInfoTip from "\.\.\/features\/works\/WorkInfoTip\.jsx";/);
assert.match(page, /<dt><span>Ingresos<\/span><WorkInfoTip label="Qué incluye Ingresos">\{WORK_BALANCE_HELP\.ingresos\}<\/WorkInfoTip><\/dt>/);
assert.match(page, /<dt><span>Costos<\/span><WorkInfoTip label="Qué incluye Costos">\{WORK_BALANCE_HELP\.costos\}<\/WorkInfoTip><\/dt>/);
assert.match(page, /<dt><span>Resultado<\/span><WorkInfoTip label="Cómo se calcula el Resultado">\{WORK_BALANCE_HELP\.resultado\}<\/WorkInfoTip><\/dt><dd><WorkBalanceResult balance=\{balance\} money=\{money\} \/><\/dd>/);
assert.match(page, /<dt><span>Margen<\/span><WorkInfoTip label="Cómo se calcula el Margen">\{WORK_BALANCE_HELP\.margen\}<\/WorkInfoTip><\/dt>/);
assert.match(page, /const excludedMaterialExpense = getExcludedMaterialExpense\(balance\);/);
assert.match(page, /\{excludedMaterialExpense != null && <p className="works-message works-message--warning">Hay \{money\(excludedMaterialExpense\)\} en gastos de tipo Material que no suman al balance porque el proyecto ya tiene materiales de inventario\.<\/p>\}/);
assert.doesNotMatch(page, /Calculando desde fuentes autoritativas|Consumo neto valorizado/, "sin jerga en la ficha");
const balancePartsSource = await readFile(new URL("../src/features/works/WorkBalanceParts.jsx", import.meta.url), "utf8");
const infoTipSource = await readFile(new URL("../src/features/works/WorkInfoTip.jsx", import.meta.url), "utf8");
for (const [name, source] of [["WorkBalanceParts", balancePartsSource], ["WorkInfoTip", infoTipSource]]) {
  assert.doesNotMatch(source, /from ["'][^"']*(features\/reports|\/reports\/|firebase|workService)/, `${name}: sin imports de Reportes ni de servicios`);
}
assert.match(infoTipSource, /className="works-info__button"/); assert.match(infoTipSource, /className="works-info__panel"/);
const worksStyles = await readFile(new URL("../src/features/works/works.css", import.meta.url), "utf8");
for (const selector of [".works-info__button", ".works-info__panel", ".works-balance-result--gano", ".works-balance-result--perdio"]) assert.ok(worksStyles.includes(selector), `works.css define ${selector}`);
const newCss = worksStyles.slice(worksStyles.indexOf('/* Balance: ícono "i"'));
assert.doesNotMatch(newCss, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, "los estilos nuevos usan solo tokens (sin colores literales)");
assert.match(newCss, /\.works-balance-result--gano \.works-balance-result__amount \{ color: var\(--color-success-700\); \}/);
assert.match(newCss, /\.works-balance-result--perdio \.works-balance-result__amount \{ color: var\(--color-danger-700\); \}/);
console.log("OK conexiones: mismas Functions y requestId, costos acotados a la tarea, ficha→tablero y deep link");

console.log("WORK_PROJECT_BOARD_SMOKE_OK");
