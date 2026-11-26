// Historial de la consola de plataforma: los eventos "modulos_actualizados" que dejó la Function
// cambiarModulosEmpresaPlataforma siguen mostrándose (SPEC 039). La consola ya no edita módulos:
// el rubro de la empresa los define.
export const MODULES_EVENT_TYPE = "modulos_actualizados";

function moduleLabel(registry, moduleId) {
  return registry.find((item) => item.id === moduleId)?.label || moduleId;
}

function moduleList(registry, ids) {
  return ids.length ? ids.map((id) => moduleLabel(registry, id)).join(", ") : "ninguno";
}

// Texto del historial para un evento modulos_actualizados.
export function moduleEventSummary(event, registry = []) {
  const summary = `Módulos: ${moduleList(registry, event.modulosAnteriores || [])} → ${moduleList(registry, event.modulosResultantes || [])}`;
  return event.motivo ? `${summary} · ${event.motivo}` : summary;
}
