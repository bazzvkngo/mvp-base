export const WORK_MODEL_VERSION = 2;
export const WORK_FILE_MODEL_VERSION = 1;
export const WORK_TASK_MODEL_VERSION = 2;
export const WORK_INACTIVITY_DAYS = 3;
export const WORK_EXPENSE_MODEL_VERSION = 1;
export const WORK_LABOR_MODEL_VERSION = 1;
export const WORK_MATERIAL_MODEL_VERSION = 1;

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

export const WORK_TASK_STATUSES = Object.freeze([
  {value: "pendiente", label: "Pendiente"},
  {value: "en_progreso", label: "En progreso"},
  {value: "en_espera", label: "En espera"},
  {value: "completada", label: "Completada"},
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

export function getWorkMemberIdentity(member = {}) {
  const name = String(member.nombre || "").trim();
  if (name && name !== "Sin nombre registrado") return name;
  const email = String(member.correo || "").trim();
  if (email && email !== "Sin correo disponible") return email;
  return "Usuario sin identificar";
}

export function getWorkMemberOptionLabel(member = {}, currentUserUid = "") {
  const identity = getWorkMemberIdentity(member);
  return member.uid && member.uid === currentUserUid ? `Yo (${identity})` : identity;
}

export function hasAdditionalWorkMembers(members = [], currentUserUid = "") {
  return members.some((member) => member?.uid && member.uid !== currentUserUid);
}

export function buildQuickWorkCreationPayload(raw = {}) {
  return {
    ...raw,
    estado: "pendiente",
    fechaInicio: String(raw.fechaInicio || "").trim(),
  };
}

export function getEligibleWorkQuoteOptions(quotes = [], sales = [], {workId = ""} = {}) {
  const currentWorkId = String(workId || "").trim();
  const salesById = new Map((Array.isArray(sales) ? sales : []).map((sale) => [String(sale?.id || sale?.ventaId || "").trim(), sale]));
  return (Array.isArray(quotes) ? quotes : []).flatMap((quote) => {
    const quoteId = String(quote?.id || quote?.cotizacionId || "").trim();
    const saleId = String(quote?.ventaId || "").trim();
    const sale = salesById.get(saleId);
    const quoteWorkId = String(quote?.trabajoId || "").trim();
    const saleWorkId = String(sale?.trabajoId || "").trim();
    const quoteClientId = String(quote?.clienteId || "").trim();
    const saleClientId = String(sale?.clienteId || "").trim();
    const linkedElsewhere = [quoteWorkId, saleWorkId].some((linkedId) => linkedId && linkedId !== currentWorkId);
    if (!quoteId || quote?.estado !== "aceptada" || !sale || sale?.estado !== "confirmada" || sale?.cotizacionId !== quoteId || linkedElsewhere || !quoteClientId || quoteClientId !== saleClientId) return [];
    return [{quote, sale}];
  });
}

export function canViewWorkProfitability(role) {
  return ["OWNER", "ADMIN", "FINANZAS"].includes(String(role || "").toUpperCase());
}

export function adaptWorkBalance(raw = {}) {
  const numericOrNull = (value) => value == null ? null : Number(value);
  return {
    ...raw,
    modeloBalanceVersion: Number(raw.modeloBalanceVersion || 1),
    trabajoId: String(raw.trabajoId || "").trim(),
    moneda: String(raw.moneda || "").trim().toUpperCase(),
    estado: ["COMPLETO", "PARCIAL_SIN_VENTA", "INCONSISTENTE_MONEDA"].includes(raw.estado) ? raw.estado : "PARCIAL_SIN_VENTA",
    consistenteMoneda: raw.consistenteMoneda !== false,
    monedasIncompatibles: Array.isArray(raw.monedasIncompatibles) ? raw.monedasIncompatibles : [],
    valorComercial: numericOrNull(raw.valorComercial),
    materialesVenta: numericOrNull(raw.materialesVenta),
    materialesAdicionales: numericOrNull(raw.materialesAdicionales),
    materiales: numericOrNull(raw.materiales),
    horasHombre: numericOrNull(raw.horasHombre),
    gastosDirectos: numericOrNull(raw.gastosDirectos),
    gastosIndirectos: numericOrNull(raw.gastosIndirectos),
    costoTotal: numericOrNull(raw.costoTotal),
    resultado: numericOrNull(raw.resultado),
    rentabilidadPct: numericOrNull(raw.rentabilidadPct),
    gastosMaterialExcluido: numericOrNull(raw.gastosMaterialExcluido),
    desglosePorMoneda: Array.isArray(raw.desglosePorMoneda) ? raw.desglosePorMoneda : [],
    fuentes: raw.fuentes || {},
  };
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
    cotizacionId: String(raw.cotizacionId || "").trim(),
    cotizacionNumero: String(raw.cotizacionNumero || "").trim(),
    ventaId: String(raw.ventaId || "").trim(),
    ventaNumero: String(raw.ventaNumero || "").trim(),
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
    ultimaActividadEn: dateValue(raw.ultimaActividadEn || raw.actualizadoEn),
    ultimoAvanceEn: dateValue(raw.ultimoAvanceEn),
    motivoEspera: String(raw.motivoEspera || "").trim(),
    esperaDesde: dateValue(raw.esperaDesde),
    esperaPorUid: String(raw.esperaPorUid || "").trim(),
    tareasTotal: Number(raw.tareasTotal || 0),
    tareasCompletadas: Number(raw.tareasCompletadas || 0),
    progresoAcumulado: Number(raw.progresoAcumulado ?? Number(raw.tareasCompletadas || 0) * 100),
    progresoPct: Number(raw.progresoPct ?? (Number(raw.tareasTotal || 0) ? (Number(raw.tareasCompletadas || 0) / Number(raw.tareasTotal || 0)) * 100 : 0)),
    modeloExpedienteVersion: Number(raw.modeloExpedienteVersion || 0),
    cotizacionesVinculadas: Number(raw.cotizacionesVinculadas || 0),
    ventasVinculadas: Number(raw.ventasVinculadas || 0),
    moneda: String(raw.moneda || "").trim().toUpperCase(),
    gastosVigentesTotal: Number(raw.gastosVigentesTotal || 0),
    gastosMontoTotal: Number(raw.gastosMontoTotal || 0),
    gastosMontoDirecto: Number(raw.gastosMontoDirecto || 0),
    gastosMontoIndirecto: Number(raw.gastosMontoIndirecto || 0),
    gastosMaterialMontoTotal: Number(raw.gastosMaterialMontoTotal || 0),
    horasHombreVigentesTotal: Number(raw.horasHombreVigentesTotal || 0),
    horasHombreCantidadTotal: Number(raw.horasHombreCantidadTotal || 0),
    horasHombreCostoTotal: Number(raw.horasHombreCostoTotal || 0),
    materialesSalidasTotal: Number(raw.materialesSalidasTotal || 0),
    materialesDevolucionesTotal: Number(raw.materialesDevolucionesTotal || 0),
    materialesCostoTotal: Number(raw.materialesCostoTotal || 0),
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
  const allowedStatus = new Set(WORK_TASK_STATUSES.map(({value}) => value));
  const estado = completada ? "completada" : allowedStatus.has(raw.estado) ? raw.estado : "pendiente";
  const subtareas = (Array.isArray(raw.subtareas) ? raw.subtareas : []).map((entry) => ({
    id: String(entry?.id || "").trim(),
    titulo: String(entry?.titulo || "").trim(),
    completada: entry?.completada === true,
    completadaEn: dateValue(entry?.completadaEn),
    completadaPorUid: String(entry?.completadaPorUid || "").trim(),
  })).filter((entry) => entry.id && entry.titulo);
  return {
    ...raw,
    id: raw.id || raw.tareaId || "",
    tareaId: raw.tareaId || raw.id || "",
    titulo: String(raw.titulo || "").trim(),
    descripcion: String(raw.descripcion || "").trim(),
    modeloTareaVersion: Number(raw.modeloTareaVersion || 1),
    responsableUid: String(raw.responsableUid || "").trim(),
    responsableSnapshot: raw.responsableSnapshot || null,
    estado,
    completada,
    subtareas,
    motivoEspera: String(raw.motivoEspera || "").trim(),
    esperaDesde: dateValue(raw.esperaDesde),
    esperaPorUid: String(raw.esperaPorUid || "").trim(),
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
    tareaId: String(raw.tareaId || "").trim(),
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
    tareaId: String(raw.tareaId || "").trim(),
    estado: raw.estado === "anulado" ? "anulado" : "vigente",
    creadoEn: dateValue(raw.creadoEn),
    anuladoEn: dateValue(raw.anuladoEn),
    motivoAnulacion: String(raw.motivoAnulacion || "").trim(),
  };
}

export function adaptWorkMaterialMovement(raw = {}) {
  const tipo = raw.tipo === "DEVOLUCION_PROYECTO" ? "DEVOLUCION_PROYECTO" : "SALIDA_PROYECTO";
  return {
    ...raw,
    id: raw.id || raw.movimientoId || "",
    movimientoId: raw.movimientoId || raw.id || "",
    modeloMovimientoProyectoVersion: Number(raw.modeloMovimientoProyectoVersion || 1),
    tipo,
    trabajoId: String(raw.trabajoId || "").trim(),
    tareaId: String(raw.tareaId || "").trim(),
    itemId: String(raw.itemId || "").trim(),
    cantidad: Number(raw.cantidad || 0),
    costoUnitario: Number(raw.costoUnitario || 0),
    costoTotal: Number(raw.costoTotal || 0),
    moneda: String(raw.moneda || "").trim().toUpperCase(),
    movimientoOrigenId: String(raw.movimientoOrigenId || "").trim(),
    productoSnapshot: raw.productoSnapshot || null,
    usuarioUid: String(raw.usuarioUid || "").trim(),
    usuarioSnapshot: raw.usuarioSnapshot || null,
    fecha: String(raw.fecha || "").trim(),
    creadoEn: dateValue(raw.creadoEn),
  };
}

export function adaptWorkNote(raw = {}) {
  return {...raw, id: raw.id || raw.notaId || "", notaId: raw.notaId || raw.id || "", texto: String(raw.texto || "").trim(), creadoEn: dateValue(raw.creadoEn)};
}

export function adaptWorkEvent(raw = {}) {
  return {...raw, id: raw.id || raw.eventoId || "", eventoId: raw.eventoId || raw.id || "", fecha: dateValue(raw.fecha)};
}

export function buildWorkMutationPayload(raw = {}) {
  const responsableUid = String(raw.responsableUid || "").trim();
  const participanteUids = [...new Set((Array.isArray(raw.participanteUids) ? raw.participanteUids : [])
    .map((value) => String(value || "").trim())
    .filter((value) => value && value !== responsableUid))];
  return {
    titulo: String(raw.titulo || "").trim(),
    descripcion: String(raw.descripcion || "").trim(),
    clienteId: String(raw.clienteId || "").trim(),
    cotizacionId: String(raw.cotizacionId || "").trim(),
    responsableUid,
    participanteUids,
    estado: String(raw.estado || "pendiente"),
    prioridad: String(raw.prioridad || "normal"),
    fechaInicio: raw.fechaInicio ? String(raw.fechaInicio) : null,
    fechaPrevista: raw.fechaPrevista ? String(raw.fechaPrevista) : null,
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
  if (raw.fechaInicio && raw.fechaPrevista && raw.fechaPrevista < raw.fechaInicio) errors.fechaPrevista = "La fecha de término no puede ser anterior a la fecha de inicio.";
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
  const percent = Math.min(100, Math.max(0, Number(work?.progresoPct ?? (total ? (completed / total) * 100 : 0))));
  return {total, completed, percent: Math.round(percent * 100) / 100};
}

export function getTaskProgress(task = {}) {
  const subtasks = Array.isArray(task.subtareas) ? task.subtareas : [];
  if (!subtasks.length) return {total: 0, completed: 0, percent: task.completada ? 100 : 0};
  const completed = subtasks.filter((entry) => entry.completada).length;
  return {total: subtasks.length, completed, percent: Math.round((completed / subtasks.length) * 10000) / 100};
}

function rounded(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function getWorkAccumulatedCost(work = {}) {
  const materialExpense = Number(work.materialesSalidasTotal || 0) > 0 ? Number(work.gastosMaterialMontoTotal || 0) : 0;
  return Math.max(0, rounded(Number(work.materialesCostoTotal || 0) + Number(work.horasHombreCostoTotal || 0) + Number(work.gastosMontoTotal || 0) - materialExpense));
}

export function getWorkSaleMaterials(sales = []) {
  const seen = new Set();
  return (Array.isArray(sales) ? sales : []).filter((sale) => sale?.estado === "confirmada").flatMap((sale) => {
    const lines = new Map((Array.isArray(sale?.items) ? sale.items : []).map((line) => [String(line?.lineaId || ""), line]));
    return (Array.isArray(sale?.efectosInventario) ? sale.efectosInventario : []).flatMap((effect, index) => {
      const line = lines.get(String(effect?.lineaId || ""));
      if (line && line.tipoItem !== "producto") return [];
      const quantity = Number(effect?.cantidad);
      if (!Number.isFinite(quantity) || quantity <= 0) return [];
      const key = `${sale.id || sale.ventaId || "venta"}::${effect?.movimientoId || effect?.lineaId || index}`;
      if (seen.has(key)) return [];
      seen.add(key);
      const unitCost = Number(effect?.costoUnitario);
      const totalCost = Number(effect?.costoTotal);
      const costAvailable = effect?.costoHistoricoDisponible !== false && Number.isFinite(unitCost) && unitCost >= 0 && Number.isFinite(totalCost) && totalCost >= 0;
      return [{
        id: key,
        ventaId: String(sale.id || sale.ventaId || ""),
        ventaNumero: String(sale.numero || "Venta"),
        itemId: String(effect?.itemId || line?.itemId || ""),
        nombre: String(effect?.nombre || line?.nombre || "Producto"),
        codigo: String(effect?.codigo || line?.codigo || ""),
        unidad: String(effect?.unidad || line?.unidad || "unidad"),
        cantidad: quantity,
        costoUnitario: costAvailable ? rounded(unitCost) : null,
        costoTotal: costAvailable ? rounded(totalCost) : null,
        costoHistoricoDisponible: costAvailable,
        moneda: String(effect?.moneda || sale.moneda || "").trim().toUpperCase(),
        fecha: String(effect?.fecha || sale.fechaVenta || "").slice(0, 10),
        movimientoId: String(effect?.movimientoId || ""),
      }];
    });
  });
}

export function getInventoryCurrentCost(item = {}) {
  const candidates = [item.costoPromedio, item.costoBase, item.costo, item.precioCompra];
  const selected = candidates.find((value) => value !== "" && value != null && Number.isFinite(Number(value)) && Number(value) >= 0);
  return selected == null ? null : rounded(Number(selected));
}

export function getWorkCostSummary({expenses = [], labor = [], materials = [], saleMaterials = [], taskId} = {}) {
  const filterTask = (entry) => taskId === undefined || String(entry.tareaId || "") === String(taskId || "");
  const activeExpenses = expenses.filter((entry) => entry.estado !== "anulado" && filterTask(entry));
  const activeLabor = labor.filter((entry) => entry.estado !== "anulado" && filterTask(entry));
  const hasInventoryMaterials = saleMaterials.length > 0 || materials.some((entry) => entry.tipo === "SALIDA_PROYECTO");
  const materialMovements = materials.filter(filterTask);
  const saleMaterialTotal = taskId === undefined ? saleMaterials.filter((entry) => entry.costoHistoricoDisponible !== false && entry.costoTotal != null).reduce((sum, entry) => sum + Number(entry.costoTotal || 0), 0) : 0;
  const materialTotal = hasInventoryMaterials
    ? saleMaterialTotal + materialMovements.reduce((sum, entry) => sum + (entry.tipo === "DEVOLUCION_PROYECTO" ? -1 : 1) * Number(entry.costoTotal || 0), 0)
    : activeExpenses.filter((entry) => entry.categoria === "MATERIAL").reduce((sum, entry) => sum + Number(entry.monto || 0), 0);
  const laborTotal = activeLabor.reduce((sum, entry) => sum + Number(entry.total || 0), 0);
  const expenseTotal = activeExpenses.filter((entry) => !hasInventoryMaterials || entry.categoria !== "MATERIAL").reduce((sum, entry) => sum + Number(entry.monto || 0), 0);
  return {materials: Math.max(0, rounded(materialTotal)), labor: rounded(laborTotal), expenses: rounded(expenseTotal), total: Math.max(0, rounded(materialTotal + laborTotal + expenseTotal))};
}

export function buildWorkDailyCostSummary({expenses = [], labor = [], materials = [], saleMaterials = [], events = []} = {}) {
  const dates = new Map();
  const row = (date) => {
    if (!date) return null;
    if (!dates.has(date)) dates.set(date, {date, materials: 0, labor: 0, expenses: 0, total: 0, advanceRecorded: false});
    return dates.get(date);
  };
  const hasInventoryMaterials = saleMaterials.length > 0 || materials.some((entry) => entry.tipo === "SALIDA_PROYECTO");
  saleMaterials.filter((entry) => entry.costoHistoricoDisponible !== false && entry.costoTotal != null).forEach((entry) => { const current = row(entry.fecha); if (current) current.materials += Number(entry.costoTotal || 0); });
  materials.forEach((entry) => { const current = row(entry.fecha); if (current) current.materials += (entry.tipo === "DEVOLUCION_PROYECTO" ? -1 : 1) * Number(entry.costoTotal || 0); });
  labor.filter((entry) => entry.estado !== "anulado").forEach((entry) => { const current = row(entry.fecha); if (current) current.labor += Number(entry.total || 0); });
  expenses.filter((entry) => entry.estado !== "anulado").forEach((entry) => {
    const current = row(entry.fecha); if (!current) return;
    if (!hasInventoryMaterials && entry.categoria === "MATERIAL") current.materials += Number(entry.monto || 0);
    else if (entry.categoria !== "MATERIAL" || !hasInventoryMaterials) current.expenses += Number(entry.monto || 0);
  });
  const progressEvents = new Set(["tarea_completada", "tarea_reabierta", "estado_tarea_cambiado", "subtarea_completada", "subtarea_reabierta", "tarea_documentacion_agregada"]);
  events.filter((entry) => progressEvents.has(entry.tipo)).forEach((entry) => { const current = row(String(entry.fecha || "").slice(0, 10)); if (current) current.advanceRecorded = true; });
  return [...dates.values()].map((entry) => ({...entry, materials: rounded(entry.materials), labor: rounded(entry.labor), expenses: rounded(entry.expenses), total: Math.max(0, rounded(entry.materials + entry.labor + entry.expenses))})).sort((left, right) => right.date.localeCompare(left.date));
}

export function getWorkOperationalIndicators(work = {}, {now = new Date()} = {}) {
  const last = new Date(work.ultimaActividadEn || work.actualizadoEn || work.creadoEn || 0);
  const current = now instanceof Date ? now : new Date(now);
  const inactivityDays = Number.isNaN(last.getTime()) || Number.isNaN(current.getTime()) ? 0 : Math.floor((current.getTime() - last.getTime()) / 86400000);
  return {inactivityDays, noRecentActivity: work.estado === "en_progreso" && inactivityDays >= WORK_INACTIVITY_DAYS};
}

export function humanizeWorkEvent(event = {}, {includeAmounts = true} = {}) {
  const actor = event.actorSnapshot?.nombre || "Una persona del equipo";
  const detail = event.detalle || {};
  const eventMoney = (value) => {
    const currency = /^[A-Z]{3}$/.test(String(detail.moneda || "")) ? detail.moneda : "";
    if (!currency) return Number(value || 0).toLocaleString("es-CL", {maximumFractionDigits: 2});
    return new Intl.NumberFormat("es-CL", {style: "currency", currency, maximumFractionDigits: currency === "CLP" ? 0 : 2}).format(Number(value || 0));
  };
  const amountText = (value) => includeAmounts ? ` por ${eventMoney(value)}` : "";
  const messages = {
    trabajo_creado: `${actor} creó el trabajo.`,
    estado_cambiado: `${actor} cambió el estado de ${getWorkStatusLabel(detail.estadoAnterior)} a ${getWorkStatusLabel(detail.estadoNuevo)}${detail.estadoNuevo === "en_espera" && detail.motivoEspera ? `: ${detail.motivoEspera}` : "."}`,
    responsable_cambiado: `${actor} cambió el responsable a ${detail.responsableNombre || "Sin responsable"}.`,
    participante_agregado: `${actor} agregó a ${detail.participanteNombre || "un participante"}.`,
    participante_retirado: `${actor} retiró a ${detail.participanteNombre || "un participante"}.`,
    tarea_creada: `${actor} agregó la tarea “${detail.tareaTitulo || "Sin título"}”.`,
    tarea_completada: `${actor} completó la tarea “${detail.tareaTitulo || "Sin título"}”.`,
    tarea_reabierta: `${actor} reabrió la tarea “${detail.tareaTitulo || "Sin título"}”.`,
    estado_tarea_cambiado: `${actor} cambió la tarea “${detail.tareaTitulo || "Sin título"}” a ${WORK_TASK_STATUSES.find((entry) => entry.value === detail.estadoNuevo)?.label || detail.estadoNuevo}.`,
    tarea_en_espera: `${actor} puso en espera la tarea “${detail.tareaTitulo || "Sin título"}”: ${detail.motivoEspera || "sin detalle"}.`,
    subtarea_agregada: `${actor} agregó la subtarea “${detail.subtareaTitulo || "Sin título"}”.`,
    subtarea_completada: `${actor} completó la subtarea “${detail.subtareaTitulo || "Sin título"}”.`,
    subtarea_reabierta: `${actor} reabrió la subtarea “${detail.subtareaTitulo || "Sin título"}”.`,
    subtarea_editada: `${actor} editó la subtarea “${detail.subtareaTitulo || "Sin título"}”.`,
    subtarea_eliminada: `${actor} eliminó la subtarea “${detail.subtareaTitulo || "Sin título"}”.`,
    tarea_asignada: `${actor} asignó la tarea “${detail.tareaTitulo || "Sin título"}” a ${detail.responsableNombre || "Sin responsable"}.`,
    tarea_reasignada: `${actor} reasignó la tarea “${detail.tareaTitulo || "Sin título"}” de ${detail.responsableAnteriorNombre || "Sin responsable"} a ${detail.responsableNombre || "Sin responsable"}.`,
    tarea_documentacion_agregada: `${actor} agregó documentación a la tarea “${detail.tareaTitulo || "Sin título"}”.`,
    tarea_eliminada: `${actor} eliminó la tarea “${detail.tareaTitulo || "Sin título"}”.`,
    gasto_registrado: `${actor} registró el gasto “${detail.concepto || "Sin concepto"}”${amountText(detail.monto)}.`,
    gasto_anulado: `${actor} anuló el gasto “${detail.concepto || "Sin concepto"}”${amountText(detail.monto)}.`,
    horas_hombre_registradas: `${actor} registró ${Number(detail.horas || 0)} HH para ${detail.tecnicoNombre || "un técnico"}${amountText(detail.total)}.`,
    horas_hombre_anuladas: `${actor} anuló ${Number(detail.horas || 0)} HH de “${detail.concepto || "Sin concepto"}”${amountText(detail.total)}.`,
    material_salida_registrada: `${actor} registró la salida de ${Number(detail.cantidad || 0)} ${detail.productoNombre || "material"}${amountText(detail.costoTotal)}.`,
    material_devolucion_registrada: `${actor} registró la devolución de ${Number(detail.cantidad || 0)} ${detail.productoNombre || "material"}${amountText(detail.costoTotal)}, asociada a su salida original.`,
    nota_agregada: `${actor} agregó una nota.`,
    trabajo_completado: `${actor} completó el trabajo.`,
    trabajo_cancelado: `${actor} canceló el trabajo.`,
    trabajo_reabierto: `${actor} reabrió el trabajo como ${getWorkStatusLabel(detail.estadoNuevo)}.`,
    cotizacion_vinculada: `${actor} vinculó la cotización ${detail.numero || "sin número"}.`,
    cotizacion_respuesta: `La cotización ${detail.cotizacionNumero || "sin número"} fue ${detail.respuesta || "respondida"}.`,
    venta_vinculada: `${actor} vinculó la venta ${detail.numero || "sin número"}${detail.cotizacionNumero ? ` desde ${detail.cotizacionNumero}` : ""}${amountText(detail.total)}.`,
    venta_confirmada: `${actor} confirmó la venta ${detail.numero || "sin número"}${detail.cotizacionNumero ? ` originada en ${detail.cotizacionNumero}` : ""}${amountText(detail.total)}.`,
  };
  return messages[event.tipo] || `${actor} actualizó el trabajo.`;
}
