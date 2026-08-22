export const WORK_MODEL_VERSION = 2;
export const WORK_FILE_MODEL_VERSION = 1;
export const WORK_TASK_MODEL_VERSION = 2;
export const WORK_EXPENSE_MODEL_VERSION = 1;
export const WORK_LABOR_MODEL_VERSION = 1;

export const WORK_EXPENSE_CATEGORIES = Object.freeze([
  {value: "MATERIAL", label: "Material", classification: "DIRECTO"},
  {value: "MANO_DE_OBRA", label: "Mano de obra", classification: "DIRECTO"},
  {value: "OPERATIVO", label: "Operativo", classification: "DIRECTO"},
  {value: "SERVICIO_EXTERNO", label: "Servicio externo", classification: "DIRECTO"},
  {value: "ADMINISTRATIVO", label: "Administrativo", classification: "INDIRECTO"},
  {value: "OTRO", label: "Otro", classification: "DIRECTO"},
]);

export const WORK_STATUSES = Object.freeze([
  {value: "pendiente", label: "Pendiente"},
  {value: "en_progreso", label: "En progreso"},
  {value: "en_espera", label: "En espera"},
  {value: "completado", label: "Completado"},
  {value: "cancelado", label: "Cancelado"},
]);

export const WORK_PRIORITIES = Object.freeze([
  {value: "baja", label: "Baja"},
  {value: "normal", label: "Normal"},
  {value: "alta", label: "Alta"},
  {value: "urgente", label: "Urgente"},
]);

const STATUS_VALUES = new Set(WORK_STATUSES.map(({value}) => value));
const PRIORITY_VALUES = new Set(WORK_PRIORITIES.map(({value}) => value));

export function normalizeWorkSearch(value) {
  return String(value || "").trim().toLocaleLowerCase("es-CL")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function formatWorkNumber(year, sequence) {
  return `TRB-${year}-${String(sequence).padStart(4, "0")}`;
}

export function getWorkStatusLabel(value) {
  return WORK_STATUSES.find((item) => item.value === value)?.label || "Pendiente";
}

export function getWorkPriorityLabel(value) {
  return WORK_PRIORITIES.find((item) => item.value === value)?.label || "Normal";
}

export function canManageWorks(role) {
  return ["OWNER", "ADMIN"].includes(String(role || "").toUpperCase());
}

function dateValue(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (typeof value === "string") return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function adaptStoredWork(raw = {}) {
  const estado = STATUS_VALUES.has(raw.estado) ? raw.estado : "pendiente";
  const prioridad = PRIORITY_VALUES.has(raw.prioridad) ? raw.prioridad : "normal";
  return {
    ...raw,
    id: raw.id || raw.trabajoId || "",
    trabajoId: raw.trabajoId || raw.id || "",
    numero: String(raw.numero || "").trim(),
    titulo: String(raw.titulo || "Trabajo sin título").trim(),
    descripcion: String(raw.descripcion || "").trim(),
    clienteId: String(raw.clienteId || "").trim(),
    clienteSnapshot: raw.clienteSnapshot || null,
    responsableUid: String(raw.responsableUid || "").trim(),
    responsableSnapshot: raw.responsableSnapshot || null,
    participanteUids: Array.isArray(raw.participanteUids) ? raw.participanteUids : [],
    participantesSnapshot: Array.isArray(raw.participantesSnapshot) ? raw.participantesSnapshot : [],
    estado,
    prioridad,
    fechaInicio: String(raw.fechaInicio || ""),
    fechaPrevista: String(raw.fechaPrevista || ""),
    fechaCompletado: dateValue(raw.fechaCompletado),
    creadoEn: dateValue(raw.creadoEn),
    actualizadoEn: dateValue(raw.actualizadoEn),
    tareasTotal: Number(raw.tareasTotal || 0),
    tareasCompletadas: Number(raw.tareasCompletadas || 0),
    modeloExpedienteVersion: Number(raw.modeloExpedienteVersion || 0),
    cotizacionesVinculadas: Number(raw.cotizacionesVinculadas || 0),
    ventasVinculadas: Number(raw.ventasVinculadas || 0),
    moneda: String(raw.moneda || "").trim().toUpperCase(),
    gastosVigentesTotal: Number(raw.gastosVigentesTotal || 0),
    gastosMontoTotal: Number(raw.gastosMontoTotal || 0),
    gastosMontoDirecto: Number(raw.gastosMontoDirecto || 0),
    gastosMontoIndirecto: Number(raw.gastosMontoIndirecto || 0),
    horasHombreVigentesTotal: Number(raw.horasHombreVigentesTotal || 0),
    horasHombreCantidadTotal: Number(raw.horasHombreCantidadTotal || 0),
    horasHombreCostoTotal: Number(raw.horasHombreCostoTotal || 0),
  };
}

export function adaptWorkLink(raw = {}) {
  const tipoDocumento = raw.tipoDocumento === "venta" ? "venta" : "cotizacion";
  return {
    ...raw,
    id: raw.id || raw.vinculoId || "",
    vinculoId: raw.vinculoId || raw.id || "",
    tipoDocumento,
    documentoId: String(raw.documentoId || raw.cotizacionId || raw.ventaId || "").trim(),
    numero: String(raw.numero || raw.cotizacionNumero || raw.ventaNumero || "").trim(),
    estadoAlVincular: String(raw.estadoAlVincular || "").trim(),
    total: Number(raw.total || 0),
    creadoEn: dateValue(raw.creadoEn),
  };
}

export function adaptWorkTask(raw = {}) {
  const completada = raw.estado === "completada" || raw.completada === true;
  return {
    ...raw,
    id: raw.id || raw.tareaId || "",
    tareaId: raw.tareaId || raw.id || "",
    titulo: String(raw.titulo || "").trim(),
    descripcion: String(raw.descripcion || "").trim(),
    modeloTareaVersion: Number(raw.modeloTareaVersion || 1),
    responsableUid: String(raw.responsableUid || "").trim(),
    responsableSnapshot: raw.responsableSnapshot || null,
    estado: completada ? "completada" : "pendiente",
    completada,
    creadoPorUid: String(raw.creadoPorUid || "").trim(),
    creadoEn: dateValue(raw.creadoEn),
    completadaPorUid: String(raw.completadaPorUid || "").trim(),
    completadaPorSnapshot: raw.completadaPorSnapshot || null,
    completadaEn: dateValue(raw.completadaEn),
    documentacionTotal: Number(raw.documentacionTotal || 0),
    documentacion: Array.isArray(raw.documentacion) ? raw.documentacion : [],
  };
}

export function adaptWorkTaskDocumentation(raw = {}) {
  return {
    ...raw,
    id: raw.id || raw.documentacionId || "",
    documentacionId: raw.documentacionId || raw.id || "",
    tipo: raw.tipo === "cierre" ? "cierre" : "avance",
    texto: String(raw.texto || "").trim(),
    autorUid: String(raw.autorUid || "").trim(),
    autorSnapshot: raw.autorSnapshot || null,
    creadoEn: dateValue(raw.creadoEn),
  };
}

export function adaptWorkExpense(raw = {}) {
  return {
    ...raw,
    id: raw.id || raw.gastoId || "",
    gastoId: raw.gastoId || raw.id || "",
    modeloGastoVersion: Number(raw.modeloGastoVersion || 1),
    concepto: String(raw.concepto || "").trim(),
    monto: Number(raw.monto || 0),
    categoria: String(raw.categoria || "OTRO").trim().toUpperCase(),
    clasificacionCosto: raw.clasificacionCosto === "INDIRECTO" ? "INDIRECTO" : "DIRECTO",
    moneda: String(raw.moneda || "").trim().toUpperCase(),
    responsableDelGastoUid: String(raw.responsableDelGastoUid || "").trim(),
    responsableDelGastoSnapshot: raw.responsableDelGastoSnapshot || null,
    registradoPorUid: String(raw.registradoPorUid || "").trim(),
    registradoPorSnapshot: raw.registradoPorSnapshot || null,
    fecha: String(raw.fecha || "").trim(),
    observacion: String(raw.observacion || "").trim(),
    estado: raw.estado === "anulado" ? "anulado" : "vigente",
    creadoEn: dateValue(raw.creadoEn),
    anuladoEn: dateValue(raw.anuladoEn),
    motivoAnulacion: String(raw.motivoAnulacion || "").trim(),
  };
}

export function adaptWorkLabor(raw = {}) {
  return {
    ...raw,
    id: raw.id || raw.horasHombreId || "",
    horasHombreId: raw.horasHombreId || raw.id || "",
    modeloHorasHombreVersion: Number(raw.modeloHorasHombreVersion || 1),
    tecnicoUid: String(raw.tecnicoUid || "").trim(),
    tecnicoSnapshot: raw.tecnicoSnapshot || null,
    horas: Number(raw.horas || 0),
    costoHora: Number(raw.costoHora || 0),
    total: Number(raw.total || 0),
    moneda: String(raw.moneda || "").trim().toUpperCase(),
    fecha: String(raw.fecha || "").trim(),
    concepto: String(raw.concepto || "").trim(),
    estado: raw.estado === "anulado" ? "anulado" : "vigente",
    creadoEn: dateValue(raw.creadoEn),
    anuladoEn: dateValue(raw.anuladoEn),
    motivoAnulacion: String(raw.motivoAnulacion || "").trim(),
  };
}

export function adaptWorkNote(raw = {}) {
  return {...raw, id: raw.id || raw.notaId || "", notaId: raw.notaId || raw.id || "", texto: String(raw.texto || "").trim(), creadoEn: dateValue(raw.creadoEn)};
}

export function adaptWorkEvent(raw = {}) {
  return {...raw, id: raw.id || raw.eventoId || "", eventoId: raw.eventoId || raw.id || "", fecha: dateValue(raw.fecha)};
}

export function buildWorkMutationPayload(raw = {}) {
  return {
    titulo: String(raw.titulo || "").trim(),
    descripcion: String(raw.descripcion || "").trim(),
    clienteId: String(raw.clienteId || "").trim(),
    responsableUid: String(raw.responsableUid || "").trim(),
    participanteUids: [...new Set((Array.isArray(raw.participanteUids) ? raw.participanteUids : []).map((value) => String(value || "").trim()).filter(Boolean))],
    estado: String(raw.estado || "pendiente"),
    prioridad: String(raw.prioridad || "normal"),
    fechaInicio: String(raw.fechaInicio || ""),
    fechaPrevista: String(raw.fechaPrevista || ""),
  };
}

export function getWorkDraftErrors(raw = {}) {
  const errors = {};
  if (!String(raw.titulo || "").trim()) errors.titulo = "Ingresa un título.";
  if (String(raw.titulo || "").trim().length > 180) errors.titulo = "El título no puede superar 180 caracteres.";
  if (String(raw.descripcion || "").length > 5000) errors.descripcion = "La descripción no puede superar 5000 caracteres.";
  if (!STATUS_VALUES.has(String(raw.estado || ""))) errors.estado = "Selecciona un estado válido.";
  if (!PRIORITY_VALUES.has(String(raw.prioridad || ""))) errors.prioridad = "Selecciona una prioridad válida.";
  if (raw.fechaInicio && !/^\d{4}-\d{2}-\d{2}$/.test(raw.fechaInicio)) errors.fechaInicio = "Selecciona una fecha válida.";
  if (raw.fechaPrevista && !/^\d{4}-\d{2}-\d{2}$/.test(raw.fechaPrevista)) errors.fechaPrevista = "Selecciona una fecha válida.";
  return errors;
}

export function matchesWorkFilters(work, filters = {}) {
  if (filters.estado && filters.estado !== "todos" && work.estado !== filters.estado) return false;
  if (filters.prioridad && filters.prioridad !== "todas" && work.prioridad !== filters.prioridad) return false;
  if (filters.responsableUid && filters.responsableUid !== "todos" && work.responsableUid !== filters.responsableUid) return false;
  const query = normalizeWorkSearch(filters.query);
  if (!query) return true;
  return normalizeWorkSearch([work.numero, work.titulo, work.clienteSnapshot?.nombreRazonSocial, work.clienteSnapshot?.rut].filter(Boolean).join(" ")).includes(query);
}

export function getWorkTaskProgress(work) {
  const total = Math.max(0, Number(work?.tareasTotal || 0));
  const completed = Math.min(total, Math.max(0, Number(work?.tareasCompletadas || 0)));
  return {total, completed};
}

export function humanizeWorkEvent(event = {}) {
  const actor = event.actorSnapshot?.nombre || "Una persona del equipo";
  const detail = event.detalle || {};
  const messages = {
    trabajo_creado: `${actor} creó el trabajo.`,
    estado_cambiado: `${actor} cambió el estado de ${getWorkStatusLabel(detail.estadoAnterior)} a ${getWorkStatusLabel(detail.estadoNuevo)}.`,
    responsable_cambiado: `${actor} cambió el responsable a ${detail.responsableNombre || "Sin responsable"}.`,
    participante_agregado: `${actor} agregó a ${detail.participanteNombre || "un participante"}.`,
    participante_retirado: `${actor} retiró a ${detail.participanteNombre || "un participante"}.`,
    tarea_creada: `${actor} agregó la tarea “${detail.tareaTitulo || "Sin título"}”.`,
    tarea_completada: `${actor} completó la tarea “${detail.tareaTitulo || "Sin título"}”.`,
    tarea_reabierta: `${actor} reabrió la tarea “${detail.tareaTitulo || "Sin título"}”.`,
    tarea_asignada: `${actor} asignó la tarea “${detail.tareaTitulo || "Sin título"}” a ${detail.responsableNombre || "Sin responsable"}.`,
    tarea_reasignada: `${actor} reasignó la tarea “${detail.tareaTitulo || "Sin título"}” de ${detail.responsableAnteriorNombre || "Sin responsable"} a ${detail.responsableNombre || "Sin responsable"}.`,
    tarea_documentacion_agregada: `${actor} agregó documentación a la tarea “${detail.tareaTitulo || "Sin título"}”.`,
    tarea_eliminada: `${actor} eliminó la tarea “${detail.tareaTitulo || "Sin título"}”.`,
    gasto_registrado: `${actor} registró el gasto “${detail.concepto || "Sin concepto"}”.`,
    gasto_anulado: `${actor} anuló el gasto “${detail.concepto || "Sin concepto"}”.`,
    horas_hombre_registradas: `${actor} registró ${Number(detail.horas || 0)} HH para ${detail.tecnicoNombre || "un técnico"}.`,
    horas_hombre_anuladas: `${actor} anuló ${Number(detail.horas || 0)} HH de “${detail.concepto || "Sin concepto"}”.`,
    nota_agregada: `${actor} agregó una nota.`,
    trabajo_completado: `${actor} completó el trabajo.`,
    trabajo_cancelado: `${actor} canceló el trabajo.`,
    trabajo_reabierto: `${actor} reabrió el trabajo como ${getWorkStatusLabel(detail.estadoNuevo)}.`,
    cotizacion_vinculada: `${actor} vinculó la cotización ${detail.numero || "sin número"}.`,
    cotizacion_respuesta: `La cotización ${detail.cotizacionNumero || "sin número"} fue ${detail.respuesta || "respondida"}.`,
    venta_vinculada: `${actor} vinculó la venta ${detail.numero || "sin número"}.`,
  };
  return messages[event.tipo] || `${actor} actualizó el trabajo.`;
}
