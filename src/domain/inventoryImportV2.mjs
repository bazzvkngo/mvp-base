export const MAX_INVENTORY_IMPORT_BATCH_SIZE = 200;

const INVENTORY_IMPORT_TYPES = Object.freeze([
  "producto",
  "servicio",
  "actividad",
]);

export function normalizeInventoryImportLabel(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeInventoryImportType(value) {
  const normalized = normalizeInventoryImportLabel(value);
  return INVENTORY_IMPORT_TYPES.includes(normalized) ? normalized : "";
}

function isActiveCatalogEntry(entry) {
  return (entry?.estado || "activo") === "activo";
}

function proposedValue(source, names) {
  for (const name of names) {
    const value = String(source?.[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function resolveArea(source, areas) {
  const proposedName = proposedValue(source, [
    "areaPropuesta",
    "areaNombre",
    "area",
  ]);
  const proposedId = String(source?.areaId || "").trim();
  const catalog = Array.isArray(areas) ? areas : [];

  if (proposedId) {
    const match = catalog.find((area) => area.id === proposedId);
    if (!match) return { areaId: "", proposedName, status: "unrecognized" };
    if (!isActiveCatalogEntry(match)) {
      return { areaId: "", proposedName: proposedName || match.nombre, status: "inactive" };
    }
    if (
      proposedName &&
      normalizeInventoryImportLabel(proposedName) !==
        normalizeInventoryImportLabel(match.nombre)
    ) {
      return { areaId: "", proposedName, status: "unrecognized" };
    }
    return {
      areaId: match.id,
      proposedName: match.nombre,
      status: "resolved",
    };
  }

  if (!proposedName) return { areaId: "", proposedName: "", status: "missing" };
  const normalizedName = normalizeInventoryImportLabel(proposedName);
  const matches = catalog.filter(
    (area) => normalizeInventoryImportLabel(area.nombre) === normalizedName
  );
  const activeMatches = matches.filter(isActiveCatalogEntry);
  if (activeMatches.length === 1) {
    return {
      areaId: activeMatches[0].id,
      proposedName: activeMatches[0].nombre,
      status: "resolved",
    };
  }
  if (activeMatches.length > 1) {
    return { areaId: "", proposedName, status: "ambiguous" };
  }
  if (matches.length > 0) return { areaId: "", proposedName, status: "inactive" };
  return { areaId: "", proposedName, status: "unrecognized" };
}

function resolveCategory(source, categories, areaId) {
  const proposedName = proposedValue(source, [
    "categoriaPropuesta",
    "categoriaNombre",
    "categoria",
  ]);
  const proposedId = String(source?.categoriaId || "").trim();
  const catalog = Array.isArray(categories) ? categories : [];

  if (!areaId) {
    return {
      categoriaId: "",
      proposedName,
      status: proposedName || proposedId ? "area-required" : "missing",
    };
  }

  if (proposedId) {
    const match = catalog.find((category) => category.id === proposedId);
    if (!match) {
      return { categoriaId: "", proposedName, status: "unrecognized" };
    }
    if (!isActiveCatalogEntry(match)) {
      return {
        categoriaId: "",
        proposedName: proposedName || match.nombre,
        status: "inactive",
      };
    }
    if (match.areaId !== areaId) {
      return {
        categoriaId: "",
        proposedName: proposedName || match.nombre,
        status: "incompatible",
      };
    }
    if (
      proposedName &&
      normalizeInventoryImportLabel(proposedName) !==
        normalizeInventoryImportLabel(match.nombre)
    ) {
      return { categoriaId: "", proposedName, status: "unrecognized" };
    }
    return {
      categoriaId: match.id,
      proposedName: match.nombre,
      status: "resolved",
    };
  }

  if (!proposedName) {
    return { categoriaId: "", proposedName: "", status: "missing" };
  }
  const normalizedName = normalizeInventoryImportLabel(proposedName);
  const sameAreaMatches = catalog.filter(
    (category) =>
      category.areaId === areaId &&
      normalizeInventoryImportLabel(category.nombre) === normalizedName
  );
  const activeMatches = sameAreaMatches.filter(isActiveCatalogEntry);
  if (activeMatches.length === 1) {
    return {
      categoriaId: activeMatches[0].id,
      proposedName: activeMatches[0].nombre,
      status: "resolved",
    };
  }
  if (activeMatches.length > 1) {
    return { categoriaId: "", proposedName, status: "ambiguous" };
  }
  if (sameAreaMatches.length > 0) {
    return { categoriaId: "", proposedName, status: "inactive" };
  }
  const existsInAnotherArea = catalog.some(
    (category) =>
      category.areaId !== areaId &&
      isActiveCatalogEntry(category) &&
      normalizeInventoryImportLabel(category.nombre) === normalizedName
  );
  return {
    categoriaId: "",
    proposedName,
    status: existsInAnotherArea ? "incompatible" : "unrecognized",
  };
}

export function resolveInventoryImportCatalog(source, areas, categories) {
  const area = resolveArea(source, areas);
  const category = resolveCategory(source, categories, area.areaId);
  return {
    areaId: area.areaId,
    areaPropuesta: area.proposedName,
    areaResolutionStatus: area.status,
    categoriaId: category.categoriaId,
    categoriaPropuesta: category.proposedName,
    categoryResolutionStatus: category.status,
  };
}

export function getInventoryImportCategoriesForArea(categories, areaId) {
  if (!areaId || !Array.isArray(categories)) return [];
  return categories.filter(
    (category) => category.areaId === areaId && isActiveCatalogEntry(category)
  );
}

export function keepInventoryImportCategoryForArea(
  categories,
  areaId,
  categoriaId
) {
  return getInventoryImportCategoriesForArea(categories, areaId).some(
    (category) => category.id === categoriaId
  )
    ? categoriaId
    : "";
}

function isPresent(value) {
  return value !== "" && value !== null && value !== undefined;
}

function isNonNegativeNumber(value) {
  if (!isPresent(value)) return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}

function getAreaResolutionMessage(status) {
  if (status === "inactive") return "El Área propuesta está inactiva.";
  if (status === "ambiguous") return "El Área propuesta es ambigua.";
  if (status === "unrecognized") return "El Área propuesta no fue reconocida.";
  return "Selecciona un Área.";
}

function getCategoryResolutionMessage(status) {
  if (status === "inactive") return "La Categoría propuesta está inactiva.";
  if (status === "ambiguous") return "La Categoría propuesta es ambigua.";
  if (status === "incompatible") {
    return "La Categoría propuesta no pertenece al Área seleccionada.";
  }
  if (status === "unrecognized") {
    return "La Categoría propuesta no fue reconocida.";
  }
  return "Selecciona una Categoría.";
}

export function validateInventoryImportPreviewRow(item, areas, categories) {
  const errors = [];
  const type = normalizeInventoryImportType(item?.tipoItem);
  if (!type) errors.push("Selecciona un Tipo válido.");

  const area = (Array.isArray(areas) ? areas : []).find(
    (entry) => entry.id === item?.areaId
  );
  if (!area || !isActiveCatalogEntry(area)) {
    errors.push(getAreaResolutionMessage(item?.areaResolutionStatus));
  }

  const category = (Array.isArray(categories) ? categories : []).find(
    (entry) => entry.id === item?.categoriaId
  );
  if (
    !category ||
    !isActiveCatalogEntry(category) ||
    !area ||
    category.areaId !== area.id
  ) {
    errors.push(getCategoryResolutionMessage(item?.categoryResolutionStatus));
  }

  if (!String(item?.nombre || "").trim()) errors.push("Completa el Nombre.");
  if (!String(item?.unidad || "").trim()) errors.push("Completa la Unidad.");
  if (!isNonNegativeNumber(item?.costoBase)) {
    errors.push("El Costo base debe ser un número mayor o igual a cero.");
  }
  if (!isNonNegativeNumber(item?.margenDeseado)) {
    errors.push("El Margen debe ser un número mayor o igual a cero.");
  }

  if (type === "producto") {
    if (!String(item?.marca || "").trim()) {
      errors.push("La Marca es obligatoria para Producto.");
    }
    if (!String(item?.modelo || "").trim()) {
      errors.push("El Modelo es obligatorio para Producto.");
    }
    if (!isNonNegativeNumber(item?.stock)) {
      errors.push("El Stock actual debe ser un número mayor o igual a cero.");
    }
    if (!isNonNegativeNumber(item?.stockMinimo)) {
      errors.push("El Stock mínimo debe ser un número mayor o igual a cero.");
    }
  }

  return errors;
}

export function stripProductFieldsForInventoryImport(item) {
  if (normalizeInventoryImportType(item?.tipoItem) === "producto") return item;
  const next = { ...item };
  delete next.marca;
  delete next.modelo;
  delete next.stock;
  delete next.stockMinimo;
  delete next.codigoBarras;
  return next;
}
