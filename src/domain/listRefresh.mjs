// Mezcla el refresco silencioso de una lista paginada (Verificaciones de la plataforma): se vuelve a pedir
// solo la primera página y el resultado se combina con lo que la persona ya tiene en pantalla.
//
// - Sin "Cargar más" (loadedMore = false): la primera página nueva reemplaza a la lista y trae su cursor.
// - Con "Cargar más" (loadedMore = true): nunca se pierde nada de lo ya cargado ni se mueve el cursor. Los
//   registros nuevos se anteponen y los ya conocidos se actualizan con su versión nueva. Los que dejaron de
//   cumplir el filtro se quedan hasta la próxima carga manual (es el costo de no dejar huecos entre páginas).
export function mergeRefreshedFirstPage({ items = [], cursor = null, loadedMore = false } = {}, fresh = {}) {
  const freshItems = Array.isArray(fresh.items) ? fresh.items : [];
  if (!loadedMore) return { items: freshItems, cursor: fresh.cursor ?? null };
  const known = new Set(items.map((item) => item.id));
  const byId = new Map(freshItems.map((item) => [item.id, item]));
  return {
    items: [
      ...freshItems.filter((item) => !known.has(item.id)),
      ...items.map((item) => byId.get(item.id) || item),
    ],
    cursor,
  };
}

// Compara lo que se mostraría con lo que ya se muestra: si no cambió nada no se actualiza el estado
// (sin re-render, sin parpadeo).
export function isSameListState(left, right) {
  try {
    return (
      (left.cursor ?? null) === (right.cursor ?? null) &&
      JSON.stringify(left.items) === JSON.stringify(right.items)
    );
  } catch {
    return false;
  }
}
