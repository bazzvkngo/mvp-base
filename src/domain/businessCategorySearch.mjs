export function normalizeCategorySearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim()
    .replace(/\s+/g, " ");
}

export function isSelectableBusinessCategory(category) {
  return Boolean(category?.active && category?.selectable !== false);
}

export function filterBusinessCategories(categories, query) {
  const normalizedQuery = normalizeCategorySearch(query);

  return categories.filter((category) => {
    if (!isSelectableBusinessCategory(category)) return false;
    if (!normalizedQuery) return true;

    const searchableText = normalizeCategorySearch(
      [category.name, ...(category.searchTerms || [])].join(" ")
    );
    return searchableText.includes(normalizedQuery);
  });
}

export function groupBusinessCategories(categories, sectors) {
  const sectorOrder = new Map(
    sectors.map((sector, index) => [
      sector.code,
      Number.isFinite(sector.order) ? sector.order : index,
    ])
  );
  const groups = new Map();

  for (const category of categories) {
    const sectorCode = category.sectorCode || "OTROS";
    if (!groups.has(sectorCode)) groups.set(sectorCode, []);
    groups.get(sectorCode).push(category);
  }

  return Array.from(groups, ([sectorCode, items]) => ({
    sector:
      sectors.find((sector) => sector.code === sectorCode) ||
      { code: sectorCode, name: "Otros", order: 999 },
    categories: items,
  })).sort(
    (left, right) =>
      (sectorOrder.get(left.sector.code) ?? left.sector.order ?? 999) -
      (sectorOrder.get(right.sector.code) ?? right.sector.order ?? 999)
  );
}
