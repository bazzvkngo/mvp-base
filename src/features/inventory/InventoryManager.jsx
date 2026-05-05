import React, { useEffect, useMemo, useState } from "react";
import {
  createInventoryItem,
  deactivateInventoryItem,
  reactivateInventoryItem,
  subscribeToInventory,
  updateInventoryItem,
} from "../../services/inventoryService";
import { formatCLP } from "../../utils/formatters";

const EMPTY_FORM = {
  nombre: "",
  tipoItem: "producto",
  categoria: "",
  descripcion: "",
  unidad: "",
  costoBase: "",
  margenDeseado: "",
  precioInterno: "",
  sku: "",
  estado: "activo",
};

const tipoLabels = {
  producto: "Producto",
  servicio: "Servicio",
  actividad: "Actividad",
};

function calcularPrecioInterno(costoBase, margenDeseado) {
  const costo = Number(costoBase);
  const margen = Number(margenDeseado);
  if (!Number.isFinite(costo) || !Number.isFinite(margen)) return "";
  return Math.round(costo + (costo * margen) / 100);
}

function InventoryManager({ userId }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [tipoFiltro, setTipoFiltro] = useState("todos");
  const [estadoFiltro, setEstadoFiltro] = useState("activos");
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const unsubscribe = subscribeToInventory(
      userId,
      (data) => {
        setItems(data);
        setLoading(false);
      },
      (err) => {
        console.error("Error al cargar inventario:", err);
        setError("No se pudo cargar el inventario.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  const filteredItems = useMemo(() => {
    const q = busqueda.trim().toLowerCase();

    return items.filter((item) => {
      const estado = item.estado || "activo";
      if (estadoFiltro === "activos" && estado !== "activo") return false;
      if (estadoFiltro === "inactivos" && estado !== "inactivo") return false;
      if (tipoFiltro !== "todos" && item.tipoItem !== tipoFiltro) return false;
      if (!q) return true;

      const text = `${item.nombre || ""} ${item.categoria || ""} ${
        item.descripcion || ""
      } ${item.sku || ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [busqueda, estadoFiltro, items, tipoFiltro]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setError("");
    setSuccess("");
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      if (
        (name === "costoBase" || name === "margenDeseado") &&
        prev.precioInterno === ""
      ) {
        next.precioInterno = "";
      }
      return next;
    });
  };

  const validateForm = () => {
    if (!form.nombre.trim()) return "Ingresa el nombre del ítem.";
    if (!form.tipoItem) return "Selecciona el tipo de ítem.";
    if (!form.unidad.trim()) return "Ingresa la unidad.";
    if (form.costoBase === "") return "Ingresa el costo base.";
    if (form.margenDeseado === "") return "Ingresa el margen deseado.";
    if (!Number.isFinite(Number(form.costoBase))) {
      return "El costo base debe ser numérico.";
    }
    if (!Number.isFinite(Number(form.margenDeseado))) {
      return "El margen deseado debe ser numérico.";
    }
    if (form.precioInterno !== "" && !Number.isFinite(Number(form.precioInterno))) {
      return "El precio interno debe ser numérico.";
    }
    return "";
  };

  const buildPayload = () => {
    const precioCalculado =
      form.precioInterno === ""
        ? calcularPrecioInterno(form.costoBase, form.margenDeseado)
        : form.precioInterno;

    return {
      ...form,
      nombre: form.nombre.trim(),
      categoria: form.categoria.trim(),
      descripcion: form.descripcion.trim(),
      unidad: form.unidad.trim(),
      sku: form.sku.trim(),
      costoBase: Number(form.costoBase),
      margenDeseado: Number(form.margenDeseado),
      precioInterno: Number(precioCalculado),
    };
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!userId) {
      setError("Debes iniciar sesión para administrar inventario.");
      return;
    }

    const validationMessage = validateForm();
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    try {
      setSaving(true);
      const payload = buildPayload();
      if (editingId) {
        await updateInventoryItem(userId, editingId, payload);
        setSuccess("Ítem actualizado correctamente.");
      } else {
        await createInventoryItem(userId, payload);
        setSuccess("Ítem creado correctamente.");
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
    } catch (err) {
      console.error("Error al guardar ítem:", err);
      setError(err.message || "No se pudo guardar el ítem.");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (item) => {
    setEditingId(item.id);
    setForm({
      nombre: item.nombre || "",
      tipoItem: item.tipoItem || "producto",
      categoria: item.categoria || "",
      descripcion: item.descripcion || "",
      unidad: item.unidad || "",
      costoBase: item.costoBase ?? item.precio ?? "",
      margenDeseado: item.margenDeseado ?? 0,
      precioInterno: item.precioInterno ?? item.precio ?? "",
      sku: item.sku || "",
      estado: item.estado || "activo",
    });
    setError("");
    setSuccess("");
  };

  const handleDeactivate = async (item) => {
    setError("");
    setSuccess("");
    try {
      await deactivateInventoryItem(userId, item.id);
      setSuccess("Ítem desactivado. Puedes verlo con el filtro de inactivos.");
      if (editingId === item.id) resetForm();
    } catch (err) {
      console.error("Error al desactivar ítem:", err);
      setError("No se pudo desactivar el ítem.");
    }
  };

  const handleReactivate = async (item) => {
    setError("");
    setSuccess("");
    try {
      await reactivateInventoryItem(userId, item.id);
      setSuccess("Ítem reactivado correctamente.");
    } catch (err) {
      console.error("Error al reactivar ítem:", err);
      setError("No se pudo reactivar el ítem.");
    }
  };

  const previewPrice =
    form.precioInterno === ""
      ? calcularPrecioInterno(form.costoBase, form.margenDeseado)
      : Number(form.precioInterno);

  return (
    <section style={styles.wrapper}>
      <div style={styles.header}>
        <div>
          <span style={styles.eyebrow}>Inventario</span>
          <h2 style={styles.title}>Productos, servicios y actividades</h2>
          <p style={styles.subtitle}>
            Registra los ítems que ValoraCloud usará para valorar proyectos y
            preparar cotizaciones.
          </p>
        </div>
      </div>

      {!userId && (
        <p style={styles.errorText}>Debes iniciar sesión para ver inventario.</p>
      )}

      <form onSubmit={handleSubmit} style={styles.formCard}>
        <div style={styles.formHeader}>
          <h3 style={styles.formTitle}>
            {editingId ? "Editar ítem" : "Nuevo ítem de inventario"}
          </h3>
          {editingId && (
            <button type="button" style={styles.secondaryButton} onClick={resetForm}>
              Cancelar edición
            </button>
          )}
        </div>

        <div style={styles.formGrid}>
          <label style={styles.field}>
            <span style={styles.label}>Tipo de ítem</span>
            <select
              name="tipoItem"
              value={form.tipoItem}
              onChange={handleChange}
              style={styles.input}
            >
              <option value="producto">Producto</option>
              <option value="servicio">Servicio</option>
              <option value="actividad">Actividad</option>
            </select>
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Nombre</span>
            <input
              name="nombre"
              value={form.nombre}
              onChange={handleChange}
              placeholder="Ej: Cámara IP exterior"
              style={styles.input}
            />
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Categoría</span>
            <input
              name="categoria"
              value={form.categoria}
              onChange={handleChange}
              placeholder="Ej: CCTV, soporte, instalación"
              style={styles.input}
            />
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Unidad</span>
            <input
              name="unidad"
              value={form.unidad}
              onChange={handleChange}
              placeholder="Ej: unidad, hora, visita"
              style={styles.input}
            />
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Costo base</span>
            <input
              name="costoBase"
              type="number"
              min="0"
              value={form.costoBase}
              onChange={handleChange}
              placeholder="Ej: 45000"
              style={styles.input}
            />
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Margen deseado (%)</span>
            <input
              name="margenDeseado"
              type="number"
              value={form.margenDeseado}
              onChange={handleChange}
              placeholder="Ej: 30"
              style={styles.input}
            />
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Precio interno</span>
            <input
              name="precioInterno"
              type="number"
              min="0"
              value={form.precioInterno}
              onChange={handleChange}
              placeholder={
                previewPrice !== "" && Number.isFinite(previewPrice)
                  ? String(previewPrice)
                  : "Se calcula si lo dejas vacío"
              }
              style={styles.input}
            />
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Código/SKU opcional</span>
            <input
              name="sku"
              value={form.sku}
              onChange={handleChange}
              placeholder="Opcional"
              style={styles.input}
            />
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Estado</span>
            <select
              name="estado"
              value={form.estado}
              onChange={handleChange}
              style={styles.input}
            >
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
            </select>
          </label>

          <label style={styles.fieldFull}>
            <span style={styles.label}>Descripción</span>
            <textarea
              name="descripcion"
              value={form.descripcion}
              onChange={handleChange}
              rows={3}
              placeholder="Detalle breve del producto, servicio o actividad."
              style={styles.textarea}
            />
          </label>
        </div>

        {previewPrice !== "" && Number.isFinite(previewPrice) && (
          <p style={styles.helpText}>
            Precio interno estimado: <strong>{formatCLP(previewPrice)}</strong>
          </p>
        )}

        {error && <p style={styles.errorText}>{error}</p>}
        {success && <p style={styles.successText}>{success}</p>}

        <button type="submit" style={styles.primaryButton} disabled={saving}>
          {saving ? "Guardando..." : editingId ? "Actualizar ítem" : "Crear ítem"}
        </button>
      </form>

      <div style={styles.listCard}>
        <div style={styles.filters}>
          <input
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
            placeholder="Buscar por nombre, categoría, descripción o SKU"
            style={styles.searchInput}
          />
          <select
            value={tipoFiltro}
            onChange={(event) => setTipoFiltro(event.target.value)}
            style={styles.filterSelect}
          >
            <option value="todos">Todos los tipos</option>
            <option value="producto">Producto</option>
            <option value="servicio">Servicio</option>
            <option value="actividad">Actividad</option>
          </select>
          <select
            value={estadoFiltro}
            onChange={(event) => setEstadoFiltro(event.target.value)}
            style={styles.filterSelect}
          >
            <option value="activos">Activos</option>
            <option value="inactivos">Inactivos</option>
            <option value="todos">Todos</option>
          </select>
        </div>

        {loading ? (
          <p style={styles.emptyText}>Cargando inventario...</p>
        ) : filteredItems.length === 0 ? (
          <div style={styles.emptyState}>
            <h3 style={styles.emptyTitle}>No hay ítems para mostrar</h3>
            <p style={styles.emptyText}>
              Crea tu primer producto, servicio o actividad para empezar a
              valorar proyectos.
            </p>
          </div>
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Ítem</th>
                  <th style={styles.th}>Tipo</th>
                  <th style={styles.th}>Categoría</th>
                  <th style={styles.th}>Unidad</th>
                  <th style={styles.th}>Costo base</th>
                  <th style={styles.th}>Margen</th>
                  <th style={styles.th}>Precio interno</th>
                  <th style={styles.th}>Estado</th>
                  <th style={styles.th}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td style={styles.td}>
                      <strong>{item.nombre}</strong>
                      <span style={styles.itemMeta}>
                        {item.sku ? `SKU: ${item.sku}` : "Sin SKU"}
                      </span>
                    </td>
                    <td style={styles.td}>{tipoLabels[item.tipoItem] || item.tipoItem}</td>
                    <td style={styles.td}>{item.categoria || "-"}</td>
                    <td style={styles.td}>{item.unidad}</td>
                    <td style={styles.td}>{formatCLP(item.costoBase)}</td>
                    <td style={styles.td}>{Number(item.margenDeseado || 0)}%</td>
                    <td style={styles.td}>{formatCLP(item.precioInterno)}</td>
                    <td style={styles.td}>
                      <span
                        style={{
                          ...styles.statusBadge,
                          ...(item.estado === "inactivo"
                            ? styles.statusInactive
                            : styles.statusActive),
                        }}
                      >
                        {item.estado === "inactivo" ? "Inactivo" : "Activo"}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <div style={styles.actions}>
                        <button
                          type="button"
                          style={styles.smallButton}
                          onClick={() => handleEdit(item)}
                        >
                          Editar
                        </button>
                        {(item.estado || "activo") === "activo" ? (
                          <button
                            type="button"
                            style={styles.warningButton}
                            onClick={() => handleDeactivate(item)}
                          >
                            Desactivar
                          </button>
                        ) : (
                          <button
                            type="button"
                            style={styles.successButton}
                            onClick={() => handleReactivate(item)}
                          >
                            Reactivar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

const styles = {
  wrapper: {
    display: "grid",
    gap: "18px",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
  },
  eyebrow: {
    color: "#0f766e",
    fontSize: "12px",
    fontWeight: 800,
    textTransform: "uppercase",
  },
  title: {
    margin: "4px 0 6px",
    fontSize: "24px",
  },
  subtitle: {
    margin: 0,
    color: "#64748b",
    lineHeight: 1.5,
  },
  formCard: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    padding: "20px",
  },
  formHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    marginBottom: "16px",
  },
  formTitle: {
    margin: 0,
    fontSize: "18px",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "14px",
  },
  field: {
    display: "grid",
    gap: "6px",
  },
  fieldFull: {
    display: "grid",
    gap: "6px",
    gridColumn: "1 / -1",
  },
  label: {
    color: "#334155",
    fontSize: "13px",
    fontWeight: 700,
  },
  input: {
    width: "100%",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "10px 11px",
    color: "#111827",
    background: "#ffffff",
  },
  textarea: {
    width: "100%",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "10px 11px",
    color: "#111827",
    background: "#ffffff",
    resize: "vertical",
  },
  helpText: {
    color: "#475569",
    fontSize: "14px",
    margin: "14px 0 0",
  },
  errorText: {
    color: "#b91c1c",
    fontSize: "14px",
    margin: "12px 0 0",
  },
  successText: {
    color: "#047857",
    fontSize: "14px",
    margin: "12px 0 0",
  },
  primaryButton: {
    marginTop: "16px",
    border: 0,
    borderRadius: "6px",
    background: "#0f766e",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 800,
    padding: "11px 16px",
  },
  secondaryButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    background: "#ffffff",
    color: "#334155",
    cursor: "pointer",
    fontWeight: 700,
    padding: "9px 12px",
  },
  listCard: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    padding: "18px",
  },
  filters: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    marginBottom: "14px",
  },
  searchInput: {
    flex: "1 1 280px",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "10px 11px",
  },
  filterSelect: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "10px 11px",
    background: "#ffffff",
  },
  tableWrapper: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  th: {
    background: "#f8fafc",
    borderBottom: "1px solid #e5e7eb",
    color: "#64748b",
    fontSize: "12px",
    padding: "10px",
    textAlign: "left",
    textTransform: "uppercase",
  },
  td: {
    borderBottom: "1px solid #eef2f7",
    fontSize: "14px",
    padding: "12px 10px",
    verticalAlign: "top",
  },
  itemMeta: {
    color: "#64748b",
    display: "block",
    fontSize: "12px",
    marginTop: "3px",
  },
  statusBadge: {
    borderRadius: "999px",
    display: "inline-block",
    fontSize: "12px",
    fontWeight: 800,
    padding: "4px 9px",
  },
  statusActive: {
    background: "#dcfce7",
    color: "#166534",
  },
  statusInactive: {
    background: "#fee2e2",
    color: "#991b1b",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
  },
  smallButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    background: "#ffffff",
    cursor: "pointer",
    fontWeight: 700,
    padding: "7px 9px",
  },
  warningButton: {
    border: 0,
    borderRadius: "6px",
    background: "#f59e0b",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 800,
    padding: "7px 9px",
  },
  successButton: {
    border: 0,
    borderRadius: "6px",
    background: "#059669",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 800,
    padding: "7px 9px",
  },
  emptyState: {
    border: "1px dashed #cbd5e1",
    borderRadius: "8px",
    padding: "28px",
    textAlign: "center",
  },
  emptyTitle: {
    margin: "0 0 6px",
  },
  emptyText: {
    color: "#64748b",
    margin: 0,
  },
};

export default InventoryManager;

