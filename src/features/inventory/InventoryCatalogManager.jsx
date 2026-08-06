import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  isDuplicateAreaName,
  isDuplicateCategoryName,
} from "../../domain/inventoryCatalog.mjs";
import {
  initializeInventoryCatalog,
  saveInventoryArea,
  saveInventoryCategory,
} from "../../services/inventoryService";

function InventoryCatalogManager({
  areas,
  businessId,
  categories,
  loadErrors,
  loading,
  onRetry,
}) {
  const areaNameRef = useRef(null);
  const categoryNameRef = useRef(null);
  const [areaForm, setAreaForm] = useState({ id: "", nombre: "" });
  const [categoryForm, setCategoryForm] = useState({
    id: "",
    areaId: "",
    nombre: "",
  });
  const [savingArea, setSavingArea] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const activeAreas = useMemo(
    () => areas.filter((area) => (area.estado || "activo") === "activo"),
    [areas]
  );
  const areaNames = useMemo(
    () => new Map(areas.map((area) => [area.id, area.nombre])),
    [areas]
  );

  useEffect(() => {
    if (!categoryForm.areaId && activeAreas.length > 0) {
      setCategoryForm((current) => ({
        ...current,
        areaId: activeAreas[0].id,
      }));
    }
  }, [activeAreas, categoryForm.areaId]);

  const resetAreaForm = () => setAreaForm({ id: "", nombre: "" });
  const resetCategoryForm = () =>
    setCategoryForm({
      id: "",
      areaId: activeAreas[0]?.id || "",
      nombre: "",
    });

  const submitArea = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (isDuplicateAreaName(areas, areaForm.nombre, areaForm.id)) {
      setError("Ya existe un área con ese nombre.");
      return;
    }
    try {
      setSavingArea(true);
      await saveInventoryArea(businessId, {
        areaId: areaForm.id || undefined,
        nombre: areaForm.nombre,
        estado:
          areas.find((area) => area.id === areaForm.id)?.estado || "activo",
      });
      setNotice(areaForm.id ? "Área actualizada." : "Área creada.");
      resetAreaForm();
    } catch (saveError) {
      setError(saveError.message || "No se pudo guardar el área.");
    } finally {
      setSavingArea(false);
    }
  };

  const submitCategory = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (
      isDuplicateCategoryName(
        categories,
        categoryForm.areaId,
        categoryForm.nombre,
        categoryForm.id
      )
    ) {
      setError("Ya existe una categoría con ese nombre dentro del área.");
      return;
    }
    try {
      setSavingCategory(true);
      await saveInventoryCategory(businessId, {
        categoriaId: categoryForm.id || undefined,
        areaId: categoryForm.areaId,
        nombre: categoryForm.nombre,
        estado:
          categories.find((category) => category.id === categoryForm.id)?.estado ||
          "activo",
      });
      setNotice(categoryForm.id ? "Categoría actualizada." : "Categoría creada.");
      resetCategoryForm();
    } catch (saveError) {
      setError(saveError.message || "No se pudo guardar la categoría.");
    } finally {
      setSavingCategory(false);
    }
  };

  const toggleArea = async (area) => {
    setError("");
    setNotice("");
    try {
      await saveInventoryArea(businessId, {
        areaId: area.id,
        nombre: area.nombre,
        estado: area.estado === "inactivo" ? "activo" : "inactivo",
      });
      setNotice(
        area.estado === "inactivo" ? "Área reactivada." : "Área desactivada."
      );
    } catch (toggleError) {
      setError(toggleError.message || "No se pudo cambiar el estado del área.");
    }
  };

  const toggleCategory = async (category) => {
    setError("");
    setNotice("");
    try {
      await saveInventoryCategory(businessId, {
        categoriaId: category.id,
        areaId: category.areaId,
        nombre: category.nombre,
        estado: category.estado === "inactivo" ? "activo" : "inactivo",
      });
      setNotice(
        category.estado === "inactivo"
          ? "Categoría reactivada."
          : "Categoría desactivada."
      );
    } catch (toggleError) {
      setError(
        toggleError.message || "No se pudo cambiar el estado de la categoría."
      );
    }
  };

  const initializeCatalog = async () => {
    setError("");
    setNotice("");
    try {
      setInitializing(true);
      await initializeInventoryCatalog(businessId);
      setNotice("Áreas y categorías iniciales verificadas correctamente.");
    } catch (initializeError) {
      console.error("Error al inicializar catálogo de inventario:", {
        code: initializeError?.code || "unknown",
        message: initializeError?.message || "unknown",
      });
      setError("No se pudieron crear las áreas iniciales. Comprueba los emuladores locales.");
    } finally {
      setInitializing(false);
    }
  };

  return (
    <div style={styles.panel}>
      <p style={styles.help}>
        Las categorías pertenecen a un área. Los registros se desactivan en lugar
        de eliminarse para conservar sus relaciones históricas.
      </p>

      {loading && (
        <p style={styles.loading} role="status">
          Cargando áreas y categorías...
        </p>
      )}

      {(loadErrors?.areas || loadErrors?.categories) && (
        <div style={styles.loadError} role="alert">
          <strong>No fue posible cargar el catálogo.</strong>
          {loadErrors.areas && <span>Áreas: {loadErrors.areas}</span>}
          {loadErrors.categories && (
            <span>Categorías: {loadErrors.categories}</span>
          )}
          <button
            type="button"
            onClick={onRetry}
            disabled={loading}
            style={styles.secondary}
          >
            Reintentar carga
          </button>
        </div>
      )}

      {!loading && !loadErrors?.areas && !loadErrors?.categories && areas.length === 0 && (
        <div style={styles.initialization} role="status">
          <p style={styles.initializationText}>
            Aún no existe un catálogo. Crea las cuatro áreas iniciales y las
            categorías históricas asociadas a Informática.
          </p>
          <button
            type="button"
            onClick={initializeCatalog}
            disabled={initializing}
            style={styles.primary}
          >
            {initializing ? "Creando catálogo..." : "Crear catálogo inicial"}
          </button>
        </div>
      )}

      {!loading &&
        !loadErrors?.areas &&
        !loadErrors?.categories &&
        areas.length > 0 && (
          <div style={styles.catalogUtilityActions}>
            <button
              type="button"
              onClick={initializeCatalog}
              disabled={initializing}
              style={styles.secondary}
            >
              {initializing ? "Verificando..." : "Verificar catálogo inicial"}
            </button>
          </div>
        )}

      {error && (
        <p role="alert" style={styles.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" style={styles.notice}>
          {notice}
        </p>
      )}

      {!loading && !loadErrors?.areas && !loadErrors?.categories && (
      <div style={styles.columns}>
        <section aria-labelledby="inventory-areas-title" style={styles.section}>
          <h3 id="inventory-areas-title" style={styles.title}>
            Áreas
          </h3>
          <form onSubmit={submitArea} style={styles.form}>
            <label style={styles.field}>
              <span>Nombre del área</span>
              <input
                ref={areaNameRef}
                value={areaForm.nombre}
                onChange={(event) =>
                  setAreaForm((current) => ({
                    ...current,
                    nombre: event.target.value,
                  }))
                }
                required
                maxLength={80}
                style={styles.control}
              />
            </label>
            <div style={styles.actions}>
              <button type="submit" disabled={savingArea} style={styles.primary}>
                {savingArea
                  ? "Guardando..."
                  : areaForm.id
                    ? "Actualizar área"
                    : "Crear área"}
              </button>
              {areaForm.id && (
                <button type="button" onClick={resetAreaForm} style={styles.secondary}>
                  Cancelar
                </button>
              )}
            </div>
          </form>
          <ul style={styles.list}>
            {areas.map((area) => (
              <li className="inventory-catalog-item" key={area.id} style={styles.listItem}>
                <span>
                  <strong>{area.nombre}</strong>
                  <small style={styles.status}>{area.estado || "activo"}</small>
                </span>
                <span className="inventory-catalog-item-actions" style={styles.actions}>
                  <button
                    type="button"
                    onClick={() => {
                      setAreaForm({ id: area.id, nombre: area.nombre });
                      window.setTimeout(() => areaNameRef.current?.focus(), 0);
                    }}
                    style={styles.textButton}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleArea(area)}
                    style={styles.textButton}
                  >
                    {area.estado === "inactivo" ? "Activar" : "Desactivar"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="inventory-categories-title" style={styles.section}>
          <h3 id="inventory-categories-title" style={styles.title}>
            Categorías
          </h3>
          <form onSubmit={submitCategory} style={styles.form}>
            <label style={styles.field}>
              <span>Área</span>
              <select
                value={categoryForm.areaId}
                onChange={(event) =>
                  setCategoryForm((current) => ({
                    ...current,
                    areaId: event.target.value,
                  }))
                }
                required
                disabled={activeAreas.length === 0 || Boolean(categoryForm.id)}
                style={styles.control}
              >
                <option value="" disabled>
                  Selecciona un área
                </option>
                {activeAreas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.nombre}
                  </option>
                ))}
              </select>
              {categoryForm.id && (
                <small style={styles.status}>
                  El área se conserva para no romper ítems relacionados.
                </small>
              )}
            </label>
            <label style={styles.field}>
              <span>Nombre de la categoría</span>
              <input
                ref={categoryNameRef}
                value={categoryForm.nombre}
                onChange={(event) =>
                  setCategoryForm((current) => ({
                    ...current,
                    nombre: event.target.value,
                  }))
                }
                required
                maxLength={80}
                disabled={!categoryForm.areaId}
                style={styles.control}
              />
            </label>
            <div style={styles.actions}>
              <button
                type="submit"
                disabled={savingCategory || !categoryForm.areaId}
                style={styles.primary}
              >
                {savingCategory
                  ? "Guardando..."
                  : categoryForm.id
                    ? "Actualizar categoría"
                    : "Crear categoría"}
              </button>
              {categoryForm.id && (
                <button
                  type="button"
                  onClick={resetCategoryForm}
                  style={styles.secondary}
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>
          <ul style={styles.list}>
            {categories.map((category) => (
              <li
                className="inventory-catalog-item"
                key={category.id}
                style={styles.listItem}
              >
                <span>
                  <strong>{category.nombre}</strong>
                  <small style={styles.status}>
                    {areaNames.get(category.areaId) || "Área no disponible"} ·{" "}
                    {category.estado || "activo"}
                  </small>
                </span>
                <span className="inventory-catalog-item-actions" style={styles.actions}>
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryForm({
                        id: category.id,
                        areaId: category.areaId,
                        nombre: category.nombre,
                      });
                      window.setTimeout(() => categoryNameRef.current?.focus(), 0);
                    }}
                    style={styles.textButton}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleCategory(category)}
                    style={styles.textButton}
                  >
                    {category.estado === "inactivo" ? "Activar" : "Desactivar"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      )}
    </div>
  );
}

const styles = {
  panel: { minWidth: 0 },
  help: { color: "#64748b", fontSize: "13px", lineHeight: 1.45 },
  error: { color: "#b91c1c", fontSize: "13px" },
  notice: { color: "#047857", fontSize: "13px", margin: "10px 0" },
  catalogUtilityActions: {
    display: "flex",
    justifyContent: "flex-end",
    margin: "8px 0 12px",
  },
  loading: { color: "#475569", fontSize: "13px", margin: "10px 0" },
  loadError: {
    alignItems: "flex-start",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "4px",
    color: "#991b1b",
    display: "grid",
    fontSize: "13px",
    gap: "6px",
    margin: "10px 0 14px",
    padding: "10px 12px",
  },
  initialization: {
    alignItems: "flex-start",
    background: "#f0fdfa",
    border: "1px solid #99f6e4",
    borderRadius: "4px",
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    justifyContent: "space-between",
    margin: "10px 0 14px",
    padding: "10px 12px",
  },
  initializationText: {
    color: "#134e4a",
    flex: "1 1 280px",
    fontSize: "13px",
    lineHeight: 1.45,
    margin: 0,
  },
  columns: {
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
  },
  section: {
    borderTop: "1px solid #e2e8f0",
    minWidth: 0,
    paddingTop: "12px",
  },
  title: { fontSize: "15px", margin: "0 0 10px" },
  form: { display: "grid", gap: "10px" },
  field: { display: "grid", fontSize: "13px", fontWeight: 700, gap: "5px" },
  control: {
    background: "#fff",
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    boxSizing: "border-box",
    color: "#0f172a",
    minHeight: "40px",
    minWidth: 0,
    padding: "8px 10px",
    width: "100%",
  },
  actions: { display: "flex", flexWrap: "wrap", gap: "8px" },
  primary: {
    background: "#0f766e",
    border: 0,
    borderRadius: "4px",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 800,
    minHeight: "40px",
    padding: "8px 11px",
  },
  secondary: {
    background: "#fff",
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    color: "#334155",
    cursor: "pointer",
    fontWeight: 700,
    minHeight: "40px",
    padding: "8px 11px",
  },
  list: { display: "grid", gap: "6px", listStyle: "none", margin: "12px 0 0", padding: 0 },
  listItem: {
    alignItems: "center",
    borderTop: "1px solid #e2e8f0",
    display: "flex",
    gap: "10px",
    justifyContent: "space-between",
    minWidth: 0,
    paddingTop: "8px",
  },
  status: { color: "#64748b", display: "block", fontSize: "12px", marginTop: "2px" },
  textButton: {
    background: "transparent",
    border: 0,
    color: "#0f766e",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 800,
    minHeight: "36px",
    padding: "6px 2px",
  },
};

export default InventoryCatalogManager;
