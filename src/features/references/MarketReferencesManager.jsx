import React, { useEffect, useMemo, useState } from "react";
import { subscribeToInventory } from "../../services/inventoryService";
import { useSearchParams } from "react-router-dom";
import {
  createReference,
  deactivateReference,
  reactivateReference,
  subscribeToReferences,
  updateReference,
} from "../../services/referenceService";
import { formatCLP, formatDate } from "../../utils/formatters";

const EMPTY_FORM = {
  itemId: "",
  nombreFuente: "",
  urlFuente: "",
  precioObservado: "",
  fechaConsulta: "",
  observacion: "",
  estado: "activa",
};

const CHILE_TIME_ZONE = "America/Santiago";
const chileDateFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: CHILE_TIME_ZONE,
  year: "numeric",
});

function todayInputValue(date = new Date()) {
  const parts = chileDateFormatter.formatToParts(date).reduce((result, part) => {
    if (part.type !== "literal") {
      result[part.type] = part.value;
    }
    return result;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function MarketReferencesManager({ userId }) {
  const [searchParams] = useSearchParams();
  const selectedItemFromUrl = searchParams.get("itemId") || "";
  const [inventoryItems, setInventoryItems] = useState([]);
  const [references, setReferences] = useState([]);
  const [form, setForm] = useState({
    ...EMPTY_FORM,
    fechaConsulta: todayInputValue(),
  });
  const [editingId, setEditingId] = useState(null);
  const [loadingInventory, setLoadingInventory] = useState(true);
  const [loadingReferences, setLoadingReferences] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [itemFiltro, setItemFiltro] = useState("todos");
  const [estadoFiltro, setEstadoFiltro] = useState("activas");

  useEffect(() => {
    if (!userId) {
      setLoadingInventory(false);
      setLoadingReferences(false);
      return undefined;
    }

    if (import.meta.env.DEV) {
      console.debug("[MarketReferencesManager] usuario autenticado", {
        uid: userId,
        collectionPath: `usuarios/${userId}/referencias`,
      });
    }

    const unsubscribeInventory = subscribeToInventory(
      userId,
      (items) => {
        setInventoryItems(items.filter((item) => (item.estado || "activo") === "activo"));
        setLoadingInventory(false);
      },
      (err) => {
        console.error("Error al cargar inventario para referencias:", err);
        setError("No se pudo cargar el inventario.");
        setLoadingInventory(false);
      }
    );

    const unsubscribeReferences = subscribeToReferences(
      userId,
      (items) => {
        setReferences(items);
        setLoadingReferences(false);
      },
      (err) => {
        console.error("Error al cargar referencias:", err);
        setError("No se pudieron cargar las referencias.");
        setLoadingReferences(false);
      }
    );

    return () => {
      unsubscribeInventory();
      unsubscribeReferences();
    };
  }, [userId]);

  useEffect(() => {
    if (!selectedItemFromUrl || inventoryItems.length === 0) return;
    const itemExists = inventoryItems.some((item) => item.id === selectedItemFromUrl);
    if (!itemExists) return;

    setForm((prev) =>
      prev.itemId === selectedItemFromUrl
        ? prev
        : { ...prev, itemId: selectedItemFromUrl }
    );
    setItemFiltro(selectedItemFromUrl);
  }, [inventoryItems, selectedItemFromUrl]);

  const selectedItem = useMemo(
    () => inventoryItems.find((item) => item.id === form.itemId) || null,
    [form.itemId, inventoryItems]
  );

  const filteredReferences = useMemo(() => {
    return references.filter((reference) => {
      const estado = reference.estado || "activa";
      if (estadoFiltro === "activas" && estado !== "activa") return false;
      if (estadoFiltro === "inactivas" && estado !== "inactiva") return false;
      if (itemFiltro !== "todos" && reference.itemId !== itemFiltro) return false;
      return true;
    });
  }, [estadoFiltro, itemFiltro, references]);

  const resetForm = () => {
    setForm({ ...EMPTY_FORM, fechaConsulta: todayInputValue() });
    setEditingId(null);
    setError("");
    setSuccess("");
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const validateForm = () => {
    if (!form.itemId) return "Selecciona un ítem del inventario.";
    if (!form.nombreFuente.trim()) return "Ingresa el nombre de la fuente.";
    if (form.precioObservado === "") return "Ingresa el precio observado.";
    if (!Number.isFinite(Number(form.precioObservado))) {
      return "El precio observado debe ser numérico.";
    }
    if (!form.fechaConsulta) return "Ingresa la fecha de consulta.";
    if (form.urlFuente.trim()) {
      try {
        const url = new URL(form.urlFuente.trim());
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          return "La URL debe comenzar con http:// o https://.";
        }
      } catch {
        return "Ingresa una URL válida o deja el campo vacío.";
      }
    }
    return "";
  };

  const buildPayload = () => ({
    ...form,
    itemNombre: selectedItem?.nombre || "",
    nombreFuente: form.nombreFuente.trim(),
    urlFuente: form.urlFuente.trim(),
    precioObservado: Number(form.precioObservado),
    observacion: form.observacion.trim(),
  });

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!userId) {
      setError("Debes iniciar sesión para administrar referencias.");
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
      let successMessage = "Referencia guardada correctamente.";
      if (editingId) {
        await updateReference(userId, editingId, payload);
        successMessage = "Referencia actualizada correctamente.";
      } else {
        await createReference(userId, payload);
      }
      resetForm();
      setSuccess(successMessage);
    } catch (err) {
      console.error("Error al guardar referencia:", err);
      setError(err.message || "No se pudo guardar la referencia.");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (reference) => {
    setEditingId(reference.id);
    setForm({
      itemId: reference.itemId || "",
      nombreFuente: reference.nombreFuente || "",
      urlFuente: reference.urlFuente || "",
      precioObservado: reference.precioObservado ?? "",
      fechaConsulta: reference.fechaConsulta || todayInputValue(),
      observacion: reference.observacion || "",
      estado: reference.estado || "activa",
    });
    setError("");
    setSuccess("");
  };

  const handleDeactivate = async (reference) => {
    setError("");
    setSuccess("");
    try {
      await deactivateReference(userId, reference.id);
      setSuccess("Referencia desactivada correctamente.");
      if (editingId === reference.id) resetForm();
    } catch (err) {
      console.error("Error al desactivar referencia:", err);
      setError("No se pudo desactivar la referencia.");
    }
  };

  const handleReactivate = async (reference) => {
    setError("");
    setSuccess("");
    try {
      await reactivateReference(userId, reference.id);
      setSuccess("Referencia reactivada correctamente.");
    } catch (err) {
      console.error("Error al reactivar referencia:", err);
      setError("No se pudo reactivar la referencia.");
    }
  };

  const loading = loadingInventory || loadingReferences;

  return (
    <section style={styles.wrapper}>
      <style>
        {`
          .market-reference-data-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .market-reference-field-full {
            grid-column: 1 / -1;
          }

          @media (max-width: 640px) {
            .market-reference-data-grid {
              grid-template-columns: minmax(0, 1fr);
            }

            .market-reference-field-full {
              grid-column: 1 / -1;
            }

            .market-reference-submit {
              width: 100%;
            }
          }
        `}
      </style>
      <div style={styles.header}>
        <div>
          <span style={styles.eyebrow}>Referencias</span>
          <h2 style={styles.title}>Referencias de mercado manuales</h2>
          <p style={styles.subtitle}>
            Registra precios observados en fuentes externas para comparar tus
            costos internos y alimentar la futura valoración.
          </p>
        </div>
      </div>

      {!userId && (
        <p style={styles.errorText}>Debes iniciar sesión para ver referencias.</p>
      )}

      {inventoryItems.length === 0 && !loadingInventory && (
        <div style={styles.notice}>
          Primero debes crear ítems activos en inventario para registrar
          referencias de mercado.
        </div>
      )}

      <form onSubmit={handleSubmit} style={styles.formCard}>
        <div style={styles.formHeader}>
          <h3 style={styles.formTitle}>
            {editingId ? "Editar referencia" : "Crear referencia"}
          </h3>
          {editingId && (
            <button type="button" style={styles.secondaryButton} onClick={resetForm}>
              Cancelar edición
            </button>
          )}
        </div>

        <div style={styles.formSections}>
          <section style={styles.formSection}>
            <h4 style={styles.sectionTitle}>Datos de la referencia</h4>
            <div className="market-reference-data-grid" style={styles.formGrid}>
              <label
                className="market-reference-field-full"
                style={styles.field}
              >
                <span style={styles.label}>Ítem del inventario</span>
                <select
                  name="itemId"
                  value={form.itemId}
                  onChange={handleChange}
                  style={styles.input}
                  disabled={inventoryItems.length === 0}
                >
                  <option value="">Selecciona un ítem</option>
                  {inventoryItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.nombre}
                    </option>
                  ))}
                </select>
              </label>

              <label style={styles.field}>
                <span style={styles.label}>Nombre de la fuente</span>
                <input
                  name="nombreFuente"
                  value={form.nombreFuente}
                  onChange={handleChange}
                  placeholder="Escribe el nombre de la fuente"
                  style={styles.input}
                />
              </label>

              <label style={styles.field}>
                <span style={styles.label}>Precio observado</span>
                <input
                  name="precioObservado"
                  type="number"
                  min="0"
                  value={form.precioObservado}
                  onChange={handleChange}
                  placeholder="Escribe el precio observado"
                  style={styles.input}
                />
              </label>

              <label style={styles.field}>
                <span style={styles.label}>Fecha de consulta</span>
                <input
                  name="fechaConsulta"
                  type="date"
                  value={form.fechaConsulta}
                  onChange={handleChange}
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
                  <option value="activa">Activa</option>
                  <option value="inactiva">Inactiva</option>
                </select>
              </label>

              <label
                className="market-reference-field-full"
                style={styles.field}
              >
                <span style={styles.labelRow}>
                  <span style={styles.label}>URL de la fuente</span>
                  <span style={styles.fieldMeta}>(opcional)</span>
                </span>
                <input
                  name="urlFuente"
                  value={form.urlFuente}
                  onChange={handleChange}
                  placeholder="Pega la URL de la fuente"
                  style={styles.input}
                />
                <p style={styles.helpText}>
                  Déjala vacía si la fuente no tiene enlace.
                </p>
              </label>
            </div>
          </section>

          <section style={styles.formSection}>
            <h4 style={styles.sectionTitle}>Observación</h4>
            <label style={styles.fieldFull}>
              <span style={styles.srOnly}>Observación</span>
              <textarea
                name="observacion"
                value={form.observacion}
                onChange={handleChange}
                rows={3}
                placeholder="Agrega un comentario sobre la referencia"
                style={styles.textarea}
              />
            </label>
          </section>
        </div>

        {error && <p style={styles.errorText}>{error}</p>}
        {success && <p style={styles.successText}>{success}</p>}

        <button
          className="market-reference-submit"
          type="submit"
          style={styles.primaryButton}
          disabled={saving || inventoryItems.length === 0}
        >
          {saving
            ? "Guardando..."
            : editingId
            ? "Actualizar referencia"
            : "Guardar referencia"}
        </button>
      </form>

      <div style={styles.listCard}>
        <div style={styles.filters}>
          <select
            value={itemFiltro}
            onChange={(event) => setItemFiltro(event.target.value)}
            style={styles.filterSelect}
          >
            <option value="todos">Todos los ítems</option>
            {inventoryItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nombre}
              </option>
            ))}
          </select>
          <select
            value={estadoFiltro}
            onChange={(event) => setEstadoFiltro(event.target.value)}
            style={styles.filterSelect}
          >
            <option value="activas">Activas</option>
            <option value="inactivas">Inactivas</option>
            <option value="todas">Todas</option>
          </select>
        </div>

        {loading ? (
          <p style={styles.emptyText}>Cargando referencias...</p>
        ) : filteredReferences.length === 0 ? (
          <div style={styles.emptyState}>
            <h3 style={styles.emptyTitle}>No hay referencias para mostrar</h3>
            <p style={styles.emptyText}>
              Registra referencias manuales para comparar precios de mercado.
            </p>
          </div>
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Ítem</th>
                  <th style={styles.th}>Fuente</th>
                  <th style={styles.th}>Precio observado</th>
                  <th style={styles.th}>Fecha</th>
                  <th style={styles.th}>Estado</th>
                  <th style={styles.th}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredReferences.map((reference) => (
                  <tr key={reference.id}>
                    <td style={styles.td}>
                      <strong>{reference.itemNombre || "-"}</strong>
                      {reference.observacion && (
                        <span style={styles.itemMeta}>{reference.observacion}</span>
                      )}
                    </td>
                    <td style={styles.td}>
                      <strong>{reference.nombreFuente}</strong>
                      {reference.urlFuente && (
                        <a
                          href={reference.urlFuente}
                          target="_blank"
                          rel="noreferrer"
                          style={styles.link}
                        >
                          Ver fuente
                        </a>
                      )}
                    </td>
                    <td style={styles.td}>{formatCLP(reference.precioObservado)}</td>
                    <td style={styles.td}>{formatDate(reference.fechaConsulta)}</td>
                    <td style={styles.td}>
                      <span
                        style={{
                          ...styles.statusBadge,
                          ...(reference.estado === "inactiva"
                            ? styles.statusInactive
                            : styles.statusActive),
                        }}
                      >
                        {reference.estado === "inactiva" ? "Inactiva" : "Activa"}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <div style={styles.actions}>
                        <button
                          type="button"
                          style={styles.smallButton}
                          onClick={() => handleEdit(reference)}
                        >
                          Editar
                        </button>
                        {(reference.estado || "activa") === "activa" ? (
                          <button
                            type="button"
                            style={styles.warningButton}
                            onClick={() => handleDeactivate(reference)}
                          >
                            Desactivar
                          </button>
                        ) : (
                          <button
                            type="button"
                            style={styles.successButton}
                            onClick={() => handleReactivate(reference)}
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
  notice: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: "8px",
    color: "#92400e",
    padding: "12px 14px",
  },
  formCard: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    boxSizing: "border-box",
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
  formSections: {
    display: "grid",
    gap: "22px",
  },
  formSection: {
    display: "grid",
    gap: "12px",
    minWidth: 0,
  },
  sectionTitle: {
    color: "#0f172a",
    fontSize: "14px",
    fontWeight: 800,
    margin: 0,
  },
  formGrid: {
    display: "grid",
    gap: "14px",
    minWidth: 0,
  },
  field: {
    display: "grid",
    gap: "6px",
    minWidth: 0,
  },
  fieldFull: {
    display: "grid",
    gap: "6px",
    gridColumn: "1 / -1",
    minWidth: 0,
  },
  label: {
    color: "#334155",
    fontSize: "13px",
    fontWeight: 700,
  },
  labelRow: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    minWidth: 0,
  },
  fieldMeta: {
    color: "#64748b",
    fontSize: "12px",
    fontWeight: 600,
  },
  input: {
    boxSizing: "border-box",
    maxWidth: "100%",
    width: "100%",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "10px 11px",
    color: "#111827",
    background: "#ffffff",
  },
  textarea: {
    boxSizing: "border-box",
    maxWidth: "100%",
    width: "100%",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "10px 11px",
    color: "#111827",
    background: "#ffffff",
    resize: "vertical",
  },
  srOnly: {
    border: 0,
    clip: "rect(0 0 0 0)",
    height: "1px",
    margin: "-1px",
    overflow: "hidden",
    padding: 0,
    position: "absolute",
    whiteSpace: "nowrap",
    width: "1px",
  },
  helpText: {
    color: "#475569",
    fontSize: "13px",
    margin: "4px 0 0",
    lineHeight: "1.4",
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
  link: {
    color: "#0f766e",
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

export default MarketReferencesManager;
