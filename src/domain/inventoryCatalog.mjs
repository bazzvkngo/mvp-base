export const OTHER_CATEGORY_OPTION = "__otra_categoria__";

export function normalizeCatalogDisplayName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function normalizeCatalogLabel(value) {
  return normalizeCatalogDisplayName(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function buildNewCategoryPayload(areaId, name) {
  const normalizedAreaId = String(areaId || "").trim();
  const normalizedName = normalizeCatalogDisplayName(name);
  if (!normalizedAreaId) throw new Error("Selecciona un área.");
  if (!normalizedName) throw new Error("Escribe el nombre de la categoría.");
  if (normalizedName.length < 2) {
    throw new Error("La categoría debe contener al menos dos caracteres.");
  }
  if (
    normalizedName === OTHER_CATEGORY_OPTION ||
    normalizeCatalogLabel(normalizedName).replace(/[.…]+$/g, "") ===
      "otra categoria"
  ) {
    throw new Error("Escribe el nombre real de la categoría.");
  }
  return { areaId: normalizedAreaId, nombre: normalizedName };
}

export function getCategoriesForArea(
  categories,
  areaId,
  { activeOnly = true } = {}
) {
  if (!areaId || !Array.isArray(categories)) return [];
  return categories.filter(
    (category) =>
      category.areaId === areaId &&
      (!activeOnly || (category.estado || "activo") === "activo")
  );
}

export function isDuplicateAreaName(areas, name, ignoredId = "") {
  const normalized = normalizeCatalogLabel(name);
  return Boolean(
    normalized &&
      areas.some(
        (area) =>
          area.id !== ignoredId &&
          normalizeCatalogLabel(area.nombre) === normalized
      )
  );
}

export function isDuplicateCategoryName(
  categories,
  areaId,
  name,
  ignoredId = ""
) {
  const normalized = normalizeCatalogLabel(name);
  return Boolean(
    areaId &&
      normalized &&
      categories.some(
        (category) =>
          category.id !== ignoredId &&
          category.areaId === areaId &&
          normalizeCatalogLabel(category.nombre) === normalized
      )
  );
}

export function keepCompatibleCategoryId(categories, areaId, categoryId) {
  if (!areaId || !categoryId) return "";
  return categories.some(
    (category) => category.id === categoryId && category.areaId === areaId
  )
    ? categoryId
    : "";
}

export function getInventoryAreaLabel(item, areas) {
  if (!item?.areaId) return "Área pendiente";
  return areas.find((area) => area.id === item.areaId)?.nombre || "Área pendiente";
}

export function getInventoryCategoryLabel(item, categories) {
  if (item?.categoriaId) {
    const catalogName = categories.find(
      (category) => category.id === item.categoriaId
    )?.nombre;
    if (catalogName) return catalogName;
  }
  return String(item?.categoria || "").trim() || "Categoría pendiente";
}
