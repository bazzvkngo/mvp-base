import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";

// Formularios de Proyectos y Trabajos (gasto, horas, material, adicional, nota y anulaciones):
// - el error del backend se ve dentro del diálogo (Notice de error), sin cerrarlo, con el foco en el aviso y
//   limpio al editar;
// - requestId estable: se crea en el primer envío, se reutiliza en los reintentos y se renueva solo tras un
//   éxito o si cambian los datos;
// - botones de envío con Button loading;
// - nota, anulación y documentación vacías explican el motivo bajo el campo;
// - adicional con los mismos máximos que el backend;
// - aviso del gasto Material cuando el trabajo ya tiene materiales de inventario.
// La página (WorksPage.jsx) no se puede cargar en el servidor de Vite (importa servicios con Firebase): sus
// conexiones se comprueban por texto fuente; lo demás se ejecuta de verdad.

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const page = await read("../src/pages/WorksPage.jsx");
const hookSource = await read("../src/features/works/useWorkFormSubmit.js");
const costParts = await read("../src/features/works/WorkCostParts.jsx");
const additionalsSource = await read("../src/features/works/WorkAdditionalsSection.jsx");
const annulSource = await read("../src/features/works/WorkAnnulForm.jsx");
const taskPanel = await read("../src/features/works/WorkTaskPanel.jsx");
const css = await read("../src/features/works/works.css");

const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
try {
  const {createWorkSubmitController, createStableRequestId} = await vite.ssrLoadModule("/src/features/works/useWorkFormSubmit.js");
  const {WorkFormError} = await vite.ssrLoadModule("/src/features/works/WorkCostParts.jsx");
  const {default: WorkAnnulForm} = await vite.ssrLoadModule("/src/features/works/WorkAnnulForm.jsx");
  const {default: WorkAdditionalsSection, WORK_ADDITIONAL_MAX_PRICE, WORK_ADDITIONAL_MAX_QUANTITY, canSubmitAdditionalDraft, getAdditionalDraftErrors} = await vite.ssrLoadModule("/src/features/works/WorkAdditionalsSection.jsx");
  const render = (element) => renderToStaticMarkup(element);

  // --- requestId estable (núcleo del hook, ejecutado de verdad) ---
  {
    const messages = [];
    let counter = 0;
    const controller = createWorkSubmitController({prefix: "expense-create", onMessage: (message) => messages.push(message), createRequestId: (prefix) => `${prefix}_id${++counter}`});
    const seen = [];
    const fail = (message) => (requestId, onError) => { seen.push(requestId); onError(Object.assign(new Error(message), {code: "failed-precondition"})); return Promise.resolve(false); };
    const succeed = (requestId) => { seen.push(requestId); return Promise.resolve(true); };
    const payload = {concepto: "Conectores", monto: "1000"};

    assert.equal(await controller.submit(payload, fail("El stock disponible no alcanza.")), false);
    assert.equal(await controller.submit(payload, fail("El stock disponible no alcanza.")), false);
    assert.deepEqual(seen, ["expense-create_id1", "expense-create_id1"], "el reintento con los mismos datos reutiliza el requestId");
    assert.deepEqual(messages, ["El stock disponible no alcanza.", "El stock disponible no alcanza."], "el mensaje en español del backend llega tal cual");

    assert.equal(await controller.submit({...payload, monto: "2000"}, succeed), true);
    assert.equal(seen.at(-1), "expense-create_id2", "si el usuario cambia los datos, requestId nuevo (el backend rechaza reutilizarlo con datos distintos)");
    assert.equal(await controller.submit({...payload, monto: "2000"}, succeed), true);
    assert.equal(seen.at(-1), "expense-create_id3", "tras un éxito, el siguiente envío es otro registro: requestId nuevo");

    // Corte de red: el SDK devuelve un error técnico; la persona ve un mensaje en español y el reintento conserva el requestId.
    const networkMessages = [];
    const networkController = createWorkSubmitController({prefix: "labor-create", onMessage: (message) => networkMessages.push(message), createRequestId: (prefix) => `${prefix}_net`});
    const ids = [];
    const cut = (requestId, onError) => { ids.push(requestId); onError(Object.assign(new Error("internal"), {code: "functions/unavailable"})); return false; };
    await networkController.submit({horas: "2"}, cut); await networkController.submit({horas: "2"}, cut);
    assert.deepEqual(ids, ["labor-create_net", "labor-create_net"]);
    assert.match(networkMessages[0], /conectar|conexión/i, "un error técnico se traduce, no se muestra crudo");
    assert.doesNotMatch(networkMessages[0], /internal|functions\//);

    // Doble envío mientras uno está en curso: el segundo no llega al backend.
    const slowController = createWorkSubmitController({prefix: "material-exit", createRequestId: (prefix) => `${prefix}_slow`});
    let calls = 0; let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const slow = () => { calls += 1; return gate.then(() => true); };
    const first = slowController.submit({cantidad: "1"}, slow);
    assert.equal(await slowController.submit({cantidad: "1"}, slow), false, "el segundo envío se ignora");
    release(); assert.equal(await first, true); assert.equal(calls, 1);

    // Sin prefijo (nota): no hay requestId, pero el error igual se informa.
    const noteMessages = [];
    const noteController = createWorkSubmitController({onMessage: (message) => noteMessages.push(message)});
    let noteId = "no llamado";
    await noteController.submit("texto", (requestId, onError) => { noteId = requestId; onError(new Error("El trabajo está cerrado.")); return false; });
    assert.equal(noteId, ""); assert.deepEqual(noteMessages, ["El trabajo está cerrado."]);

    assert.match(createStableRequestId("expense-create"), /^expense-create_[a-zA-Z0-9_-]{8,}$/, "formato que acepta requestIdentifier del backend");
    assert.ok(createStableRequestId("expense-create").length <= 120);
  }
  console.log("OK requestId estable: se reutiliza en los reintentos, se renueva tras un éxito o al cambiar los datos; sin doble envío");

  // --- Error dentro del diálogo ---
  {
    assert.equal(render(React.createElement(WorkFormError, {error: "", title: "No se pudo registrar el gasto"})), "", "sin error no dibuja nada");
    const markup = render(React.createElement(WorkFormError, {error: "Hay un solo ejemplar en stock.", title: "No se pudo registrar la salida"}));
    assert.match(markup, /class="works-form-notice"[^>]*tabindex="-1"/, "contenedor al que se lleva el foco");
    assert.match(markup, /class="ui-notice ui-notice--error" role="alert"/, "Notice de error con role alert");
    assert.match(markup, /No se pudo registrar la salida/); assert.match(markup, /Hay un solo ejemplar en stock\./);
    assert.match(hookSource, /useEffect\(\(\) => \{ if \(error\) noticeRef\.current\?\.focus\(\); \}, \[error\]\)/, "el foco pasa al aviso cuando aparece");
    assert.match(hookSource, /const clearError = \(\) => setError/, "el aviso se limpia al editar");
    assert.match(hookSource, /setError\(\{message\}\)/, "un objeto nuevo por fallo: el mismo mensaje repetido vuelve a llevar el foco");
    assert.match(css, /\.works-form-notice \{ grid-column: 1 \/ -1;/);
    for (const rule of [/\.works-form-notice:focus-visible \{[^}]*var\(--focus-outline\)/]) assert.match(css, rule);

    // Página: cada formulario deja el error en su diálogo (onError) y no en el aviso de la página.
    assert.match(page, /const runDetailAction = \(key, action, options\) => runWorkAction\(selectedWork\?\.id, key, action, options\)/);
    for (const [label, pattern] of [
      ["gasto", /expenseForm\.submit\(payload, \(requestId, onError\) => runAction\("expense-new", \(\) => registrarGastoTrabajo\(businessId, workId, payload, requestId\), \{onError\}\)\)/],
      ["horas", /laborForm\.submit\(payload, \(requestId, onError\) => runAction\("labor-new", \(\) => registrarHorasHombreTrabajo\(businessId, workId, payload, requestId\), \{onError\}\)\)/],
      ["salida de material", /exitForm\.submit\(draft, \(requestId, onError\) => runAction\("material-exit", \(\) => registrarSalidaMaterialTrabajo\(businessId, workId, draft, requestId\), \{onError\}\)\)/],
      ["devolución de material", /form\.submit\(\{movimientoOrigenId: exit\.id, \.\.\.draft\}, \(requestId, onError\) => runAction\(key, \(\) => registrarDevolucionMaterialTrabajo\(businessId, workId, exit\.id, draft\.cantidad, draft\.fecha, requestId\), \{onError\}\)\)/],
      ["adicional", /onCreate=\{\(payload, \{requestId, onError\}\) => runDetailAction\("additional-new", \(\) => crearAdicionalTrabajo\(businessId, selectedWork\.id, payload, requestId\), \{onError\}\)\}/],
      ["anular adicional", /onAnnul=\{\(additionalId, motivo, \{requestId, onError\}\) => runDetailAction\(`additional-annul-\$\{additionalId\}`, \(\) => anularAdicionalTrabajo\(businessId, selectedWork\.id, additionalId, motivo, requestId\), \{onError\}\)\}/],
      ["anular gasto u horas", /runAction\(`\$\{key\}-annul`, \(\) => kind === "expense" \? anularGastoTrabajo\(businessId, workId, entry\.id, motivo, requestId\) : anularHorasHombreTrabajo\(businessId, workId, entry\.id, motivo, requestId\), \{onError\}\)/],
      ["nota", /form\.submit\(value, \(_requestId, onError\) => runAction\("note-new", \(\) => agregarNotaTrabajo\(businessId, workId, value\), \{onError\}\)\)/],
    ]) assert.match(page, pattern, `${label}: el error queda dentro del formulario`);
    for (const [label, pattern] of [
      ["gasto", /<WorkFormError error=\{expenseForm\.error\} noticeRef=\{expenseForm\.noticeRef\} title="No se pudo registrar el gasto" \/>/],
      ["horas", /<WorkFormError error=\{laborForm\.error\} noticeRef=\{laborForm\.noticeRef\} title="No se pudieron registrar las horas" \/>/],
      ["salida", /<WorkFormError error=\{exitForm\.error\} noticeRef=\{exitForm\.noticeRef\} title="No se pudo registrar la salida" \/>/],
      ["devolución", /<WorkFormError error=\{form\.error\} noticeRef=\{form\.noticeRef\} title="No se pudo registrar la devolución" \/>/],
      ["nota", /<WorkFormError error=\{form\.error\} noticeRef=\{form\.noticeRef\} title="No se pudo agregar la nota" \/>/],
    ]) assert.match(page, pattern, `${label}: aviso dentro del formulario`);
    assert.match(additionalsSource, /<WorkFormError error=\{createForm\.error\} noticeRef=\{createForm\.noticeRef\} title="No se pudo registrar el adicional" \/>/);
    assert.match(annulSource, /<WorkFormError error=\{form\.error\} noticeRef=\{form\.noticeRef\} title="No se pudo anular el registro" \/>/);
    // Conservan lo escrito: el borrador solo se reinicia con un éxito.
    assert.match(page, /\.then\(\(success\) => \{\s*if \(success\) setExpenseDraft\(/); assert.match(page, /\.then\(\(success\) => \{\s*if \(success\) setLaborDraft\(/); assert.match(page, /\.then\(\(success\) => \{\s*if \(success\) setDraft\(\{itemId: ""/);
    // Los formularios limpian el aviso al editar.
    for (const name of ["expenseForm", "laborForm", "exitForm"]) assert.match(page, new RegExp(`onChange=\\{${name}\\.clearError\\}`));
    assert.match(additionalsSource, /onChange=\{createForm\.clearError\}/);
    // Ningún formulario genera ya un requestId nuevo en cada envío.
    for (const prefix of ["expense-create", "labor-create", "material-exit", "material-return", "additional-create", "additional-annul", "expense-annul", "labor-annul"]) {
      assert.doesNotMatch(page + additionalsSource, new RegExp(`createWorkCostRequestId\\("${prefix}"\\)`), `${prefix}: sin requestId nuevo por envío`);
    }
  }
  console.log("OK error dentro del diálogo: Notice de error, foco en el aviso, se limpia al editar y se conserva lo escrito");

  // --- Button loading ---
  {
    for (const [label, pattern] of [
      ["gasto", /loading=\{processing === "expense-new"\} disabled=\{Boolean\(processing\) && processing !== "expense-new"\}>Registrar gasto/],
      ["horas", /loading=\{processing === "labor-new"\} disabled=\{Boolean\(processing\) && processing !== "labor-new"\}>Registrar horas/],
      ["salida", /loading=\{processing === "material-exit"\} disabled=\{Boolean\(processing\) && processing !== "material-exit"\}>Registrar salida/],
      ["devolución", /loading=\{loading\} disabled=\{Boolean\(processing\) && !loading\}>Registrar devolución/],
      ["nota", /loading=\{loading\} disabled=\{Boolean\(processing\) && !loading\}>Agregar nota/],
    ]) assert.match(page, pattern, `${label}: Button con loading`);
    assert.match(additionalsSource, /loading=\{processing === "additional-new"\}/);
    assert.match(annulSource, /loading=\{loading\} disabled=\{busy && !loading\}/);
    // Render real: el botón en carga queda aria-busy con spinner; otro botón ocupado no se confunde.
    const annulProps = {label: "Motivo de anulación", onAnnul: () => {}, prefix: "expense-annul", processingKey: "expense-e1-annul", submitLabel: "Confirmar anulación"};
    const busy = render(React.createElement(WorkAnnulForm, {...annulProps, processing: "expense-e1-annul"}));
    assert.match(busy, /aria-busy="true"/); assert.match(busy, /ui-spinner/); assert.doesNotMatch(busy, /disabled=""/, "en carga conserva el foco: no queda disabled");
    const other = render(React.createElement(WorkAnnulForm, {...annulProps, processing: "labor-new"}));
    assert.doesNotMatch(other, /aria-busy/); assert.match(other, /<button[^>]*disabled=""/, "con otra acción en curso queda deshabilitado, sin spinner");
    const idle = render(React.createElement(WorkAnnulForm, {...annulProps, processing: ""}));
    assert.doesNotMatch(idle, /aria-busy|disabled=""/);
    // El adicional en carga.
    const additionalBusy = render(React.createElement(WorkAdditionalsSection, {catalogItems: [], currency: "CLP", canManage: true, processing: "additional-new", onAnnul: () => {}, onCreate: () => {}}));
    assert.match(additionalBusy, /aria-busy="true"[^>]*>[\s\S]*?Registrar adicional/);
  }
  console.log("OK botones de envío: Button con loading y spinner");

  // --- Vacíos: nota, anulación y documentación ---
  {
    assert.match(page, /setFieldError\("Escribe la nota antes de agregarla\."\)/);
    assert.match(annulSource, /setFieldError\("Escribe el motivo de la anulación\."\)/);
    assert.match(taskPanel, /setDocumentationError\("Escribe el comentario o la evidencia antes de agregarlo\."\)/);
    for (const source of [page, annulSource, taskPanel]) assert.match(source, /aria-invalid=\{[a-zA-Z]*[eE]rror \? "true" : undefined\}/, "el campo se marca inválido");
    assert.match(page, /aria-describedby=\{fieldError \? "work-note-error" : undefined\}/); assert.match(page, /id="work-note-error"/);
    assert.match(annulSource, /inputRef\.current\?\.focus\(\)/); assert.match(taskPanel, /documentationRef\.current\?\.focus\(\)/);
    assert.match(taskPanel, /onChange=\{\(event\) => \{ setDocumentation\(event\.target\.value\); setDocumentationError\(""\);/, "el mensaje se limpia al escribir");
    // El formulario de anulación se ve igual que antes cuando no hay error (etiqueta, campo requerido y botón).
    const idle = render(React.createElement(WorkAnnulForm, {label: "Motivo de anulación", onAnnul: () => {}, prefix: "expense-annul", processing: "", processingKey: "expense-e1-annul", submitLabel: "Confirmar anulación"}));
    assert.match(idle, /<label class="erp-field works-cost-field"><span class="erp-field__label">Motivo de anulación<\/span><input[^>]*maxLength="1000"[^>]*required=""/);
    assert.doesNotMatch(idle, /works-field-error/, "sin intento fallido no hay mensaje");
    const bare = render(React.createElement(WorkAnnulForm, {label: "Motivo de anulación", onAnnul: () => {}, prefix: "additional-annul", processing: "", processingKey: "additional-annul-a1", submitLabel: "Anular", submitVariant: "ghost-danger", visibleLabel: false}));
    assert.match(bare, /<input[^>]*aria-label="Motivo de anulación"/); assert.doesNotMatch(bare, /<label/);
    assert.match(css, /\.works-annul-form > \.works-field-error, \.works-task-document-form > \.works-field-error, \.works-note-form > \.works-field-error, \.works-subtask-create > \.works-field-error \{ grid-column: 1 \/ -1;/);
    // Subtarea vacía o solo espacios: el mismo patrón que la nota (mensaje bajo el campo, campo inválido y foco), sin `required` del navegador.
    assert.match(taskPanel, /setSubtaskError\("Escribe el nombre de la subtarea antes de agregarla\."\)/); assert.match(taskPanel, /subtaskRef\.current\?\.focus\(\)/);
    assert.match(taskPanel, /aria-describedby=\{subtaskError \? `subtask-new-error-\$\{task\.id\}` : undefined\} aria-invalid=\{subtaskError \? "true" : undefined\}/);
    assert.doesNotMatch(taskPanel.match(/<label className="erp-field">\s*<span className="erp-field__label">Nueva subtarea<\/span>[^\n]*/)?.[0] || "", /\brequired\b/, "sin required: un título de solo espacios también muestra el mensaje");
    // Anular un comentario de tarea: motivo obligatorio con su mensaje bajo el campo.
    const taskAnnulDialog = await read("../src/features/works/WorkTaskDocumentationAnnulDialog.jsx");
    assert.match(taskAnnulDialog, /setFieldError\("Escribe el motivo de la anulación\."\)/); assert.match(taskAnnulDialog, /reasonRef\.current\?\.focus\(\)/);
    assert.match(taskAnnulDialog, /aria-invalid=\{fieldError \? "true" : undefined\}/); assert.match(taskAnnulDialog, /id="work-task-annul-reason-error"/);
  }
  console.log("OK vacíos: nota, anulación, documentación y subtarea explican el motivo bajo el campo y llevan el foco al campo");

  // --- Crear tarea, eliminar tarea y anular comentario: requestId estable y error dentro del diálogo ---
  {
    const createDialog = await read("../src/features/works/WorkTaskCreateDialog.jsx");
    const board = await read("../src/features/works/WorkProjectBoard.jsx");
    const annulDialog = await read("../src/features/works/WorkTaskDocumentationAnnulDialog.jsx");
    // Núcleo sin React: mismo requestId en el reintento con los mismos datos, otro si cambian o tras un éxito.
    const ids = []; let attempt = 0;
    const controller = createWorkSubmitController({prefix: "task-create", createRequestId: (prefix) => { ids.push(`${prefix}_${ids.length + 1}`); return ids.at(-1); }});
    const draft = {titulo: "Tender cable", descripcion: "", responsableUid: ""};
    const send = (outcome) => (requestId) => { attempt += 1; seen.push(requestId); return Promise.resolve(outcome); };
    const seen = [];
    assert.equal(await controller.submit(draft, send(false)), false); assert.equal(await controller.submit(draft, send(false)), false);
    assert.deepEqual(seen, ["task-create_1", "task-create_1"], "crear tarea: el reintento tras un fallo reutiliza el requestId");
    assert.equal(await controller.submit({...draft, titulo: "Otro título"}, send(true)), true);
    assert.equal(seen[2], "task-create_2", "otros datos, otro requestId");
    assert.equal(await controller.submit({...draft, titulo: "Otro título"}, send(true)), true);
    assert.equal(seen[3], "task-create_3", "tras un éxito el siguiente envío es una tarea nueva");
    assert.equal(attempt, 4);
    // Los tres diálogos usan ese núcleo y dejan el error dentro, sin el aviso de la página.
    assert.match(createDialog, /useWorkFormSubmit\(\{prefix: "task-create"\}\)/);
    assert.match(createDialog, /form\.submit\(draft, \(requestId, onError\) => onSubmit\(draft, \{onError, requestId\}\)\)/);
    assert.match(createDialog, /<WorkFormError error=\{form\.error\} noticeRef=\{form\.noticeRef\} title="No se pudo crear la tarea" \/>/);
    assert.match(board, /useWorkFormSubmit\(\{prefix: "task-delete"\}\)/); assert.match(board, /deleteForm\.submit\(\{taskId: deletingTask\.id\}, \(requestId, onError\) => actions\.removeTask\(deletingTask, \{onError, requestId\}\)\)/);
    assert.match(annulDialog, /useWorkFormSubmit\(\{prefix: "task-document-annul"\}\)/); assert.match(annulDialog, /<WorkFormError error=\{form\.error\} noticeRef=\{form\.noticeRef\} title="No se pudo anular el comentario" \/>/);
    for (const [label, source] of [["crear", createDialog], ["anular comentario", annulDialog]]) assert.match(source, /<Button type="submit"[^>]*loading=\{/, `${label}: Button loading en el envío`);
    assert.match(page, /createTask: \(task, \{requestId, onError\} = \{\}\) => runBoardAction\("task-new", \(\) => agregarTareaTrabajo\(businessId, boardWorkId, task, requestId \|\| createWorkTaskRequestId\("task-create"\)\), \{onError\}\)/);
    assert.match(page, /removeTask: \(task, \{requestId, onError\} = \{\}\) => runWorkAction\(boardWorkId, `task-delete-\$\{task\.id\}`, \(\) => eliminarTareaTrabajo\(businessId, boardWorkId, task\.id, requestId \|\| createWorkTaskRequestId\("task-delete"\)\), \{onError\}\)/);
    // El backend respeta el requestId de eliminar tarea: un reintento devuelve el resultado guardado y otro usuario/datos con ese id se rechaza.
    const backend = await read("../functions/workPersistence.js");
    assert.match(backend, /async function eliminarTareaTrabajoV2Handler[\s\S]*?previousTaskRequest\(await transaction\.get\(requestRef\), \{fingerprint: requestFingerprint, operation: "eliminar", uid: context\.uid\}, HttpsError\);\s*if \(previous\) \{ result = previous; return; \}/);
    assert.match(backend, /async function anularDocumentacionTareaTrabajoHandler[\s\S]*?previousTaskRequest\(await transaction\.get\(requestRef\), \{fingerprint: requestFingerprint, operation: "anular_documentacion", uid: context\.uid\}, HttpsError\);\s*if \(previous\) \{ result = previous; return; \}/);
  }
  console.log("OK crear tarea, eliminar tarea y anular comentario: requestId estable en reintentos, error dentro del diálogo y Button loading");

  // --- Adicional: máximos del backend ---
  {
    assert.equal(WORK_ADDITIONAL_MAX_QUANTITY, 999999999.99); assert.equal(WORK_ADDITIONAL_MAX_PRICE, 999999999999.99);
    const backend = await read("../functions/workPersistence.js");
    assert.match(backend, /cantidad: positiveDecimal\(raw\.cantidad, "La cantidad", 999999999\.99, HttpsError\),\s*precioUnitario: nonNegativeDecimal\(raw\.precioUnitario, "El precio unitario", 999999999999\.99, HttpsError\)/, "los máximos en pantalla son los del backend");
    const ok = {itemId: "item-1", cantidad: "2", precioUnitario: "1500"};
    assert.equal(canSubmitAdditionalDraft(ok), true);
    assert.deepEqual(getAdditionalDraftErrors(ok), {});
    assert.deepEqual(getAdditionalDraftErrors({...ok, cantidad: "999999999.99", precioUnitario: "999999999999.99"}), {}, "el máximo exacto se acepta");
    assert.equal(getAdditionalDraftErrors({...ok, cantidad: "1000000000"}).cantidad, "La cantidad no puede superar 999.999.999,99.");
    assert.equal(getAdditionalDraftErrors({...ok, precioUnitario: "1000000000000"}).precioUnitario, "El precio unitario no puede superar 999.999.999.999,99.");
    assert.equal(canSubmitAdditionalDraft({...ok, cantidad: "1000000000"}), false); assert.equal(canSubmitAdditionalDraft({...ok, precioUnitario: "1000000000000"}), false);
    const markup = render(React.createElement(WorkAdditionalsSection, {catalogItems: [], currency: "CLP", canManage: true, onAnnul: () => {}, onCreate: () => {}}));
    assert.match(markup, /min="0.01" max="999999999.99"/); assert.match(markup, /min="0" max="999999999999.99"/);
    assert.match(additionalsSource, /\{draftErrors\.cantidad && <small className="works-field-error">\{draftErrors\.cantidad\}<\/small>\}/);
    assert.match(additionalsSource, /\{draftErrors\.precioUnitario && <small className="works-field-error">\{draftErrors\.precioUnitario\}<\/small>\}/);
  }
  console.log("OK adicional: cantidad y precio con el mismo máximo que el backend y mensaje claro");

  // --- Aviso del gasto Material ---
  {
    assert.match(page, /const materialExpenseExcluded = expenseDraft\.categoria === "MATERIAL" && hasWorkInventoryMaterials\(\{materials, saleMaterials\}\);/);
    assert.match(page, /\{materialExpenseExcluded && <Notice variant="info" className="works-cost-field--wide">Este trabajo ya tiene materiales de inventario, así que un gasto de tipo Material sin documento no suma al costo: se deja fuera para no contar dos veces el mismo material\. Si el material sale de bodega, regístralo en Materiales\. Si lo compraste con boleta o factura y no pasó por bodega, usa «Registrar compra al paso» en Materiales: ese gasto, con su documento, sí suma\.<\/Notice>\}/);
    assert.match(page, /expenses=\{boardDetail\.gastos\} labor=\{boardDetail\.horasHombre\} loading=\{boardLoading\} materials=\{boardDetail\.materiales\}/, "el diálogo de costos entrega los materiales de inventario");
    assert.match(page, /readOnly=\{boardReadOnly\} role=\{role\} runAction=\{runBoardAction\} saleMaterials=\{boardSaleMaterials\}/);
    // La regla que sustenta el aviso es la de siempre (workModel.mjs): la misma que aplica el Balance.
    const {hasWorkInventoryMaterials, getWorkCostSummary} = await vite.ssrLoadModule("/src/domain/workModel.mjs");
    const expense = {id: "g", estado: "vigente", categoria: "MATERIAL", monto: 8000, fecha: "2026-03-10"};
    assert.equal(hasWorkInventoryMaterials({materials: [], saleMaterials: []}), false);
    assert.equal(hasWorkInventoryMaterials({materials: [{tipo: "DEVOLUCION_PROYECTO"}], saleMaterials: []}), false, "una devolución sola no es inventario");
    assert.equal(hasWorkInventoryMaterials({materials: [{tipo: "SALIDA_PROYECTO"}], saleMaterials: []}), true);
    assert.equal(hasWorkInventoryMaterials({materials: [], saleMaterials: [{id: "s"}]}), true);
    assert.equal(getWorkCostSummary({expenses: [expense], materials: [{tipo: "SALIDA_PROYECTO", costoTotal: 1000}]}).expenses, 0, "con inventario el gasto Material sin documento no suma, como dice el aviso");
    assert.equal(getWorkCostSummary({expenses: [{...expense, tipoDocumento: "boleta"}], materials: [{tipo: "SALIDA_PROYECTO", costoTotal: 1000}]}).expenses, 8000, "con documento sí suma aunque haya inventario: el aviso lo dice y apunta a la compra al paso");
    assert.equal(getWorkCostSummary({expenses: [expense]}).expenses, 8000, "sin inventario sí suma, y no se muestra el aviso");
  }
  console.log("OK gasto Material: aviso informativo solo cuando el trabajo ya tiene materiales de inventario");

  // --- Compra al paso (pestaña Materiales): gasto MATERIAL con documento y adjunto obligatorio, en dos pasos ---
  {
    const quickSource = await read("../src/features/works/WorkQuickPurchase.jsx");
    const {default: WorkQuickPurchase, WORK_QUICK_PURCHASE_TOGGLE_LABEL, buildQuickPurchaseExpense, getQuickPurchaseDraftErrors, submitQuickPurchase} = await vite.ssrLoadModule("/src/features/works/WorkQuickPurchase.jsx");
    const baseProps = {currency: "CLP", locale: "es-CL", onRegister: async () => "", onUpload: async () => true, today: "2026-08-14"};
    // Cerrado: solo la opción, bajo "Nueva salida de material", con el texto pedido.
    assert.equal(WORK_QUICK_PURCHASE_TOGGLE_LABEL, "¿No está en inventario? Registrar compra al paso");
    const closed = render(React.createElement(WorkQuickPurchase, baseProps));
    assert.match(closed, /ui-button ui-button--ghost[^>]*aria-expanded="false"[\s\S]*¿No está en inventario\? Registrar compra al paso/);
    assert.doesNotMatch(closed, /<form/, "plegado: el formulario no se ve hasta abrirlo");
    // Abierto: campos pedidos, boleta o factura, cámara y archivo con los tipos de la evidencia de gastos.
    const opened = render(React.createElement(WorkQuickPurchase, {...baseProps, defaultOpen: true}));
    for (const label of ["Concepto", "Monto", "Fecha", "Tipo de documento", "Número de documento", "Documento adjunto"]) assert.match(opened, new RegExp(`<span class="erp-field__label">${label}`), `etiqueta «${label}»`);
    assert.match(opened, /Número de documento<span class="works-field-optional">Opcional<\/span>/, "el número es opcional");
    assert.match(opened, /<option value="boleta">Boleta<\/option>/); assert.match(opened, /<option value="factura">Factura<\/option>/);
    assert.match(opened.slice(opened.indexOf("<select"), opened.indexOf("</select>")), /<option value="" selected="">Selecciona<\/option><option value="boleta">Boleta<\/option><option value="factura">Factura<\/option>/, "sin documento preseleccionado (se elige a propósito), primero boleta y luego factura");
    assert.match(opened, /accept="image\/\*" aria-label="Tomar foto del documento" capture="environment"/, "Tomar foto abre la cámara");
    assert.match(opened, /accept="application\/pdf,image\/jpeg,image\/png" aria-label="Elegir archivo del documento"/, "Elegir archivo con los mismos tipos que la evidencia de gastos");
    assert.match(opened, />Tomar foto<\/span>/); assert.match(opened, />Elegir archivo<\/span>/);
    assert.match(opened, /Obligatorio\. PDF, JPG o PNG, hasta 5 MB\./, "mismos tipos y límite que WorkExpenseEvidence");
    assert.match(opened, /<button[^>]*type="submit"[^>]*>[\s\S]*?Registrar compra/); assert.match(opened, />Cancelar<\/span>/);
    assert.match(opened, /Se registra como gasto de tipo Material, con su documento\. No crea ningún producto ni mueve inventario\./);
    assert.doesNotMatch(opened, /works-field-error|works-form-notice/, "sin errores hasta intentar enviar");
    // Datos y payload: categoría MATERIAL con su documento; el responsable lo decide la página según el rol.
    assert.deepEqual(getQuickPurchaseDraftErrors({concepto: "Tubo", monto: "8330", fecha: "2026-08-14", tipoDocumento: "boleta"}), {});
    assert.deepEqual(Object.keys(getQuickPurchaseDraftErrors({concepto: "  ", monto: "", fecha: "", tipoDocumento: ""})).sort(), ["concepto", "fecha", "monto", "tipoDocumento"]);
    for (const monto of ["0", "-5", "abc"]) assert.ok(getQuickPurchaseDraftErrors({concepto: "x", monto, fecha: "2026-08-14", tipoDocumento: "factura"}).monto, `monto ${monto} inválido`);
    assert.ok(getQuickPurchaseDraftErrors({concepto: "x", monto: "1", fecha: "2026-08-14", tipoDocumento: "recibo"}).tipoDocumento);
    assert.deepEqual(buildQuickPurchaseExpense({concepto: " Tubo PVC ", monto: "8330", fecha: "2026-08-14", tipoDocumento: "boleta", numeroDocumento: " 123 ", tareaId: "t1"}, {responsableDelGastoUid: "uid-1"}),
      {concepto: "Tubo PVC", monto: "8330", categoria: "MATERIAL", responsableDelGastoUid: "uid-1", fecha: "2026-08-14", observacion: "", tareaId: "t1", tipoDocumento: "boleta", numeroDocumento: "123"});
    // Texto del monto: neutro, salvo en una empresa de Chile (la lógica de IVA de boleta y factura es chilena).
    const {WORK_QUICK_PURCHASE_NEUTRAL_AMOUNT_HINT, getQuickPurchaseAmountHint} = await vite.ssrLoadModule("/src/features/works/WorkQuickPurchase.jsx");
    assert.equal(WORK_QUICK_PURCHASE_NEUTRAL_AMOUNT_HINT, "Ingresa el monto del documento.");
    assert.equal(getQuickPurchaseAmountHint("factura", "CL"), "Ingresa el neto de la factura, sin IVA."); assert.equal(getQuickPurchaseAmountHint("boleta", "cl"), "Ingresa lo que pagaste. En boleta el IVA no se recupera.");
    for (const [type, country] of [["boleta", "AR"], ["factura", "PE"], ["boleta", undefined], ["boleta", ""], ["boleta", null], ["", "CL"], ["recibo", "CL"]]) assert.equal(getQuickPurchaseAmountHint(type, country), WORK_QUICK_PURCHASE_NEUTRAL_AMOUNT_HINT, `${type}/${country}: texto neutro`);
    assert.match(opened, /Ingresa el monto del documento\./, "sin país informado el texto del monto es neutro");
    assert.doesNotMatch(opened, /IVA|neto/, "ninguna lógica tributaria en el texto neutro");
    // El país de la empresa llega como en Veterinaria: App.jsx pasa activeBusiness.paisCodigo como countryCode.
    assert.match(await read("../src/app/App.jsx"), /<WorksPage[\s\S]*?countryCode=\{activeBusiness\?\.paisCodigo\}[\s\S]*?\/>/);
    assert.match(page, /export default function WorksPage\(\{businessId, countryCode, currencyCode, currentUserUid, role\}\)/);
    assert.match(page, /<MaterialsSection [^>]*countryCode=\{countryCode\}/); assert.match(page, /<WorkQuickPurchase countryCode=\{countryCode\} currency=\{currency\}/);
    // Adjunto OBLIGATORIO en la interfaz: sin archivo no se envía nada.
    assert.match(quickSource, /if \(!file\) setFileError\("Adjunta la boleta o la factura: es obligatoria\."\);\s+if \(Object\.keys\(found\)\.length \|\| !file\) return;/);
    // Un hook por paso, requestId estable y Button loading.
    assert.match(quickSource, /useWorkFormSubmit\(\{prefix: "quick-purchase"\}\)/); assert.match(quickSource, /useWorkFormSubmit\(\{prefix: "quick-purchase-evidence"\}\)/);
    assert.match(quickSource, /<Button type="submit" loading=\{creating \|\| uploading\}/); assert.match(quickSource, /<WorkFormError error=\{createForm\.error\} noticeRef=\{createForm\.noticeRef\} title="No se pudo registrar la compra" \/>/);
    assert.match(quickSource, /<WorkFormError error=\{uploadForm\.error\} noticeRef=\{uploadForm\.noticeRef\} title="No se pudo subir el documento" \/>/, "el fallo del adjunto se ve con Notice dentro del formulario");
    assert.match(quickSource, /title="El gasto ya quedó registrado"/); assert.match(quickSource, /\{locked \? "Reintentar adjunto" : "Registrar compra"\}/);
    assert.doesNotMatch(quickSource, /from ["'].*(workService|inventoryService|firebase)|httpsCallable|crearItem|createInventoryItem/, "no importa servicios ni crea productos");
    // Los dos pasos, de verdad: gasto creado y adjunto fallido → reintento solo del adjunto, sin duplicar el gasto.
    {
      let ids = 0; const make = (prefix) => createWorkSubmitController({prefix, onMessage: () => {}, createRequestId: (p) => `${p}_${++ids}`});
      const createController = make("quick-purchase"); const uploadController = make("quick-purchase-evidence");
      const calls = {register: [], upload: []}; let uploadsLeftToFail = 1;
      const onRegister = async (payload, {requestId}) => { calls.register.push({payload, requestId}); return "gasto-1"; };
      const onUpload = async (expenseId, file, {fileName, requestId, onError}) => { calls.upload.push({expenseId, fileName, requestId}); if (uploadsLeftToFail-- > 0) { onError(new Error("sin red")); return false; } return true; };
      const file = {name: "boleta.jpg", type: "image/jpeg", size: 2048};
      const payload = buildQuickPurchaseExpense({concepto: "Tubo", monto: "8330", fecha: "2026-08-14", tipoDocumento: "boleta"});
      const run = (created) => submitQuickPurchase({createdExpenseId: created, file, fileName: "boleta-abc.jpg", onRegister, onUpload, payload, createSubmit: (p, send) => createController.submit(p, send), uploadSubmit: (p, send) => uploadController.submit(p, send)});
      const first = await run("");
      assert.deepEqual(first, {status: "adjunto-fallido", expenseId: "gasto-1"}, "el gasto queda y se informa el fallo del adjunto");
      const second = await run(first.expenseId);
      assert.deepEqual(second, {status: "listo", expenseId: "gasto-1"});
      assert.equal(calls.register.length, 1, "el reintento NO vuelve a crear el gasto");
      assert.equal(calls.upload.length, 2); assert.equal(calls.upload[0].requestId, calls.upload[1].requestId, "mismo requestId en el reintento del adjunto");
      assert.deepEqual(calls.upload.map((call) => [call.expenseId, call.fileName]), [["gasto-1", "boleta-abc.jpg"], ["gasto-1", "boleta-abc.jpg"]], "mismo gasto y mismo nombre de archivo");
      // Si el registro del gasto falla, no se sube nada y el reintento reutiliza el requestId.
      let registerFailures = 1; const registerCalls = []; let uploads = 0;
      const flaky = (created) => submitQuickPurchase({createdExpenseId: created, file, fileName: "boleta-abc.jpg", payload, onUpload: async () => { uploads += 1; return true; },
        onRegister: async (_payload, {requestId, onError}) => { registerCalls.push(requestId); if (registerFailures-- > 0) { onError(new Error("sin red")); return ""; } return "gasto-2"; },
        createSubmit: (p, send) => createController.submit(p, send), uploadSubmit: (p, send) => uploadController.submit(p, send)});
      assert.deepEqual(await flaky(""), {status: "registro-fallido", expenseId: ""}); assert.equal(uploads, 0, "sin gasto no se sube el adjunto");
      assert.deepEqual(await flaky(""), {status: "listo", expenseId: "gasto-2"}); assert.equal(registerCalls[0], registerCalls[1], "mismo requestId al reintentar el registro");
    }
    // Integración en la pestaña Materiales (WorksPage.jsx): bajo la salida de material y con los mismos roles que registran gastos.
    const materials = page.slice(page.indexOf("function MaterialsSection"), page.indexOf("function MaterialReturnForm"));
    assert.ok(materials.indexOf("Registrar salida") < materials.indexOf("<WorkQuickPurchase"), "la opción va bajo «Nueva salida de material»");
    assert.match(materials, /const canConsume = \(canManage \|\| \["TECNICO", "MEMBER"\]\.includes\(role\)\) && !orphanScope;/);
    assert.match(materials, /\{canConsume && !readOnly && <WorkQuickPurchase /);
    assert.match(page, /const canRegister = \(canManage \|\| \["TECNICO", "MEMBER"\]\.includes\(role\)\) && !orphanScope;/, "mismos roles que registrar gastos");
    assert.match(materials, /runAction\("quick-purchase", async \(\) => \{ expenseId = \(await registrarGastoTrabajo\(businessId, workId, payload, requestId\)\)\.gastoId \|\| ""; \}, \{onError\}\)/);
    assert.match(materials, /runAction\("quick-purchase-evidence", \(\) => subirEvidenciaGastoTrabajo\(businessId, workId, expenseId, file, requestId, \{fileName\}\), \{onError\}\)/);
    assert.match(materials, /responsableDelGastoUid=\{canManage \? "" : currentUserUid\}/, "TECNICO/MEMBER se atribuyen su propio gasto, como en el formulario de gastos");
    assert.doesNotMatch(materials.slice(materials.indexOf("const registerQuickPurchase"), materials.indexOf("const scanMaterial")), /createInventoryItem|crearItem|registrarSalidaMaterialTrabajo/, "no crea producto ni mueve inventario");
    // El servicio acepta el nombre estable y tolera un archivo ya subido (Storage es create-only).
    const service = await read("../src/services/workService.js");
    assert.match(service, /subirEvidenciaGastoTrabajo\(rawBusinessId, rawWorkId, gastoId, file, requestId, \{fileName: stableFileName\} = \{\}\)/);
    assert.match(service, /uploadEvidenceObject\(\{\s+upload: \(\) => uploadBytes\(storageRef\(storage, path\), file, \{contentType: file\.type\}\),\s+objectExists: \(\) => getMetadata\(storageRef\(storage, path\)\),\s+stableFileName,/);
    // Los estilos son del feature y solo usan tokens.
    assert.match(css, /\.works-quick-purchase__attach \{ display: grid; gap: var\(--space-2\); \}/);
    assert.doesNotMatch(css.slice(css.indexOf("/* Compra al paso"), css.indexOf(".works-quick-purchase__file")), /#[0-9a-f]{3,8}\b|rgb\(|px/i);
    console.log("OK compra al paso: opción plegada bajo la salida de material, adjunto obligatorio (cámara y archivo), gasto MATERIAL con documento, reintento solo del adjunto sin duplicar el gasto y mismos roles que los gastos");
  }

  assert.match(costParts, /export function WorkFormError/);
  console.log("WORK_FORM_SUBMIT_SMOKE_OK");
} finally {
  await vite.close();
}
