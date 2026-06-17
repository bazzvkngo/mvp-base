import React, { useEffect, useMemo, useState } from "react";
import {
  createInventoryItem,
  deactivateInventoryItem,
  getInventoryItems,
  reactivateInventoryItem,
  softDeleteInventoryItem,
  subscribeToInventory,
  updateInventoryItem,
} from "../../services/inventoryService";
import { formatCLP, formatPercent } from "../../utils/formatters";

const EMPTY_FORM = {
  nombre: "",
  tipoItem: "",
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

const estadoLabels = {
  activo: "Activo",
  inactivo: "Inactivo",
  eliminado: "Eliminado",
};

const OTHER_OPTION = "__otro__";
const MANUAL_PRICE_FLAGS = [
  "precioManual",
  "ajusteManual",
  "usarPrecioManual",
  "precioPersonalizado",
];

const CATEGORY_OPTIONS = [
  "Soporte técnico y hardware",
  "Sistemas operativos",
  "Redes y conectividad",
  "Desarrollo web y software",
  "Bases de datos",
  "Cloud y despliegue",
  "Seguridad informática",
  "Aseguramiento de calidad",
  "Gestión TI y consultoría",
];

const UNIT_OPTIONS = [
  { value: "servicio", label: "Servicio" },
  { value: "hora", label: "Hora" },
  { value: "equipo", label: "Equipo" },
  { value: "visita", label: "Visita" },
  { value: "punto", label: "Punto" },
  { value: "metro", label: "Metro" },
  { value: "unidad", label: "Unidad" },
  { value: "proyecto", label: "Proyecto" },
  { value: "mes", label: "Mes" },
  { value: "cuenta", label: "Cuenta" },
];

function calcularPrecioInterno(costoBase, margenDeseado) {
  const costo = Number(costoBase);
  const margen = Number(margenDeseado);
  if (!Number.isFinite(costo) || !Number.isFinite(margen)) return "";
  return Math.round(costo + (costo * margen) / 100);
}

function calculateGrossProfitability(costoBase, precioInternoEfectivo) {
  const costo = Number(costoBase);
  const precio = Number(precioInternoEfectivo);

  if (
    !Number.isFinite(costo) ||
    !Number.isFinite(precio) ||
    costo <= 0 ||
    precio <= 0
  ) {
    return null;
  }

  const gananciaBruta = precio - costo;
  const margenBrutoEstimado = (gananciaBruta / precio) * 100;

  if (!Number.isFinite(margenBrutoEstimado)) return null;

  return {
    gananciaBruta,
    margenBrutoEstimado,
  };
}

function getProfitabilityStyle(gananciaBruta) {
  if (gananciaBruta > 0) return styles.profitabilityPositive;
  if (gananciaBruta < 0) return styles.profitabilityNegative;
  return styles.profitabilityNeutral;
}

function formatSignedCLP(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return formatCLP(0);
  if (amount < 0) return `-${formatCLP(Math.abs(amount))}`;
  return formatCLP(amount);
}

function getSelectValue(value, options) {
  if (!value) return "";
  return options.includes(value) ? value : OTHER_OPTION;
}

function normalizeOptionText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function findStandardUnit(value) {
  const normalized = normalizeOptionText(value);
  if (!normalized) return null;
  return (
    UNIT_OPTIONS.find(
      (option) =>
        normalizeOptionText(option.value) === normalized ||
        normalizeOptionText(option.label) === normalized
    ) || null
  );
}

function getUnitSelectValue(value) {
  if (!value) return "";
  return findStandardUnit(value)?.value || OTHER_OPTION;
}

function hasManualPriceOverride(item) {
  return MANUAL_PRICE_FLAGS.some((flag) => item?.[flag] === true);
}

function formatFirestoreDate(value) {
  if (!value) return "-";
  if (typeof value.toDate === "function") {
    return value.toDate().toLocaleString("es-CL");
  }
  if (value instanceof Date) {
    return value.toLocaleString("es-CL");
  }
  return "-";
}

function InventoryManager({ userId, refreshSignal = 0 }) {
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
  const [categoriaPersonalizada, setCategoriaPersonalizada] = useState("");
  const [unidadPersonalizada, setUnidadPersonalizada] = useState("");
  const [categoriaOtroActiva, setCategoriaOtroActiva] = useState(false);
  const [unidadOtroActiva, setUnidadOtroActiva] = useState(false);
  const [detailItem, setDetailItem] = useState(null);

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

  useEffect(() => {
    if (!userId || refreshSignal === 0) return;

    let active = true;
    getInventoryItems(userId)
      .then((data) => {
        if (active) {
          setItems(data);
        }
      })
      .catch((err) => {
        console.error("Error al recargar inventario:", err);
        if (active) {
          setError("No se pudo recargar el inventario después de importar.");
        }
      });

    return () => {
      active = false;
    };
  }, [refreshSignal, userId]);

  const filteredItems = useMemo(() => {
    const q = busqueda.trim().toLowerCase();

    return items.filter((item) => {
      const estado = item.estado || "activo";
      if (estadoFiltro === "activos" && estado !== "activo") return false;
      if (estadoFiltro === "inactivos" && estado !== "inactivo") return false;
      if (estadoFiltro === "eliminados" && estado !== "eliminado") return false;
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
    setCategoriaPersonalizada("");
    setUnidadPersonalizada("");
    setCategoriaOtroActiva(false);
    setUnidadOtroActiva(false);
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

  const handleCategoriaChange = (event) => {
    const value = event.target.value;
    if (value === OTHER_OPTION) {
      setCategoriaOtroActiva(true);
      const customValue = categoriaPersonalizada || "";
      setForm((prev) => ({ ...prev, categoria: customValue }));
      return;
    }

    setCategoriaOtroActiva(false);
    setCategoriaPersonalizada("");
    setForm((prev) => ({ ...prev, categoria: value }));
  };

  const handleCategoriaPersonalizadaChange = (event) => {
    const value = event.target.value;
    setCategoriaOtroActiva(true);
    setCategoriaPersonalizada(value);
    setForm((prev) => ({ ...prev, categoria: value }));
  };

  const handleUnidadChange = (event) => {
    const value = event.target.value;
    if (value === OTHER_OPTION) {
      setUnidadOtroActiva(true);
      const customValue = unidadPersonalizada || "";
      setForm((prev) => ({ ...prev, unidad: customValue }));
      return;
    }

    setUnidadOtroActiva(false);
    setUnidadPersonalizada("");
    setForm((prev) => ({ ...prev, unidad: value }));
  };

  const handleUnidadPersonalizadaChange = (event) => {
    const value = event.target.value;
    setUnidadOtroActiva(true);
    setUnidadPersonalizada(value);
    setForm((prev) => ({ ...prev, unidad: value }));
  };

  const validateForm = () => {
    if (!form.nombre.trim()) return "Ingresa el nombre del ítem.";
    if (!form.tipoItem) return "Selecciona el tipo de ítem.";
    if (!form.categoria.trim()) return "Selecciona una categoría.";
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
    const manualPrice = Number(form.precioInterno);
    const hasManualPrice =
      String(form.precioInterno ?? "").trim() !== "" &&
      Number.isFinite(manualPrice) &&
      manualPrice > 0;
    const precioCalculado =
      hasManualPrice
        ? form.precioInterno
        : calcularPrecioInterno(form.costoBase, form.margenDeseado);

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
      precioManual: hasManualPrice,
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
      setCategoriaPersonalizada("");
      setUnidadPersonalizada("");
      setCategoriaOtroActiva(false);
      setUnidadOtroActiva(false);
    } catch (err) {
      console.error("Error al guardar ítem:", err);
      setError(err.message || "No se pudo guardar el ítem.");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (item) => {
    const categoria = item.categoria || "";
    const unidad = item.unidad || "";
    const manualPriceActive = hasManualPriceOverride(item);

    setEditingId(item.id);
    setForm({
      nombre: item.nombre || "",
      tipoItem: item.tipoItem || "",
      categoria,
      descripcion: item.descripcion || "",
      unidad,
      costoBase: item.costoBase ?? item.precio ?? "",
      margenDeseado: item.margenDeseado ?? 0,
      precioInterno: manualPriceActive ? item.precioInterno ?? item.precio ?? "" : "",
      sku: item.sku || "",
      estado: item.estado || "activo",
    });
    setCategoriaPersonalizada(
      categoria && !CATEGORY_OPTIONS.includes(categoria) ? categoria : ""
    );
    setUnidadPersonalizada(unidad && !findStandardUnit(unidad) ? unidad : "");
    setCategoriaOtroActiva(Boolean(categoria && !CATEGORY_OPTIONS.includes(categoria)));
    setUnidadOtroActiva(Boolean(unidad && !findStandardUnit(unidad)));
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

  const handleDelete = async (item) => {
    const confirmed = window.confirm(
      "¿Seguro que deseas eliminar este ítem? Ya no aparecerá en inventario activo, valorización ni nuevas cotizaciones."
    );

    if (!confirmed) return;

    setError("");
    setSuccess("");
    try {
      await softDeleteInventoryItem(userId, item.id);
      setSuccess("Ítem eliminado del inventario activo. Puedes verlo con el filtro de eliminados.");
      if (editingId === item.id) resetForm();
    } catch (err) {
      console.error("Error al eliminar ítem:", err);
      setError("No se pudo eliminar el ítem.");
    }
  };

  const manualPriceValue = Number(form.precioInterno);
  const hasValidManualPrice =
    String(form.precioInterno ?? "").trim() !== "" &&
    Number.isFinite(manualPriceValue) &&
    manualPriceValue > 0;
  const previewPrice = hasValidManualPrice
    ? manualPriceValue
    : calcularPrecioInterno(form.costoBase, form.margenDeseado);
  const grossProfitability = hasValidManualPrice
    ? calculateGrossProfitability(form.costoBase, manualPriceValue)
    : null;
  const grossProfitabilityStyle = grossProfitability
    ? getProfitabilityStyle(grossProfitability.gananciaBruta)
    : null;
  const categoriaSelectValue = categoriaOtroActiva
    ? OTHER_OPTION
    : getSelectValue(form.categoria, CATEGORY_OPTIONS);
  const unidadSelectValue = unidadOtroActiva
    ? OTHER_OPTION
    : getUnitSelectValue(form.unidad);

  return (
    <section style={styles.wrapper}>
      <style>
        {`
          .inventory-basic-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .inventory-valuation-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .inventory-form-field--full {
            grid-column: 1 / -1;
          }

          @media (max-width: 1100px) {
            .inventory-valuation-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .inventory-valuation-result {
              grid-column: 1 / -1;
            }
          }

          @media (max-width: 640px) {
            .inventory-basic-grid,
            .inventory-valuation-grid {
              grid-template-columns: minmax(0, 1fr);
            }

            .inventory-form-field--full,
            .inventory-valuation-result {
              grid-column: 1 / -1;
            }

            .inventory-form-submit {
              width: 100%;
            }
          }
        `}
      </style>
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
          <div>
            <h3 style={styles.formTitle}>
              {editingId ? "Editar ítem" : "Crear ítem"}
            </h3>
          </div>
          {editingId && (
            <button type="button" style={styles.secondaryButton} onClick={resetForm}>
              Cancelar edición
            </button>
          )}
        </div>

        <div style={styles.formSections}>
          <section style={styles.formSection}>
            <div style={styles.sectionHeader}>
              <h4 style={styles.sectionTitle}>Datos del ítem</h4>
            </div>

            <div className="inventory-basic-grid" style={styles.formGrid}>
              <label className="inventory-form-field--full" style={styles.field}>
                <span style={styles.label}>Nombre</span>
                <input
                  name="nombre"
                  value={form.nombre}
                  onChange={handleChange}
                  placeholder="Escribe el nombre del producto, servicio o actividad"
                  style={styles.input}
                />
              </label>

              <label style={styles.field}>
                <span style={styles.label}>Tipo de ítem</span>
                <select
                  name="tipoItem"
                  value={form.tipoItem}
                  onChange={handleChange}
                  style={styles.input}
                >
                  <option value="" disabled>
                    Selecciona un tipo
                  </option>
                  <option value="producto">Producto</option>
                  <option value="servicio">Servicio</option>
                  <option value="actividad">Actividad</option>
                </select>
              </label>

              <label style={styles.field}>
                <span style={styles.label}>Categoría</span>
                <select
                  name="categoria"
                  value={categoriaSelectValue}
                  onChange={handleCategoriaChange}
                  style={styles.input}
                >
                  <option value="" disabled>
                    Selecciona una categoría
                  </option>
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                  <option value={OTHER_OPTION}>Otro</option>
                </select>
              </label>

              {categoriaSelectValue === OTHER_OPTION && (
                <label className="inventory-form-field--full" style={styles.field}>
                  <span style={styles.label}>Categoría personalizada</span>
                  <input
                    value={categoriaPersonalizada}
                    onChange={handleCategoriaPersonalizadaChange}
                    placeholder="Escribe una categoría personalizada"
                    style={styles.input}
                  />
                </label>
              )}

              <label style={styles.field}>
                <span style={styles.label}>Unidad</span>
                <select
                  name="unidad"
                  value={unidadSelectValue}
                  onChange={handleUnidadChange}
                  style={styles.input}
                >
                  <option value="" disabled>
                    Selecciona una unidad
                  </option>
                  {UNIT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                  <option value={OTHER_OPTION}>Otro</option>
                </select>
              </label>

              <label style={styles.field}>
                <span style={styles.labelRow}>
                  <span style={styles.label}>Código/SKU</span>
                  <span style={styles.fieldMeta}>(opcional)</span>
                </span>
                <input
                  name="sku"
                  value={form.sku}
                  onChange={handleChange}
                  placeholder="Escribe un código interno o SKU"
                  style={styles.input}
                />
              </label>

              {unidadSelectValue === OTHER_OPTION && (
                <label className="inventory-form-field--full" style={styles.field}>
                  <span style={styles.label}>Unidad personalizada</span>
                  <input
                    value={unidadPersonalizada}
                    onChange={handleUnidadPersonalizadaChange}
                    placeholder="Escribe una unidad personalizada"
                    style={styles.input}
                  />
                </label>
              )}

              {editingId && (
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
                    {form.estado === "eliminado" && (
                      <option value="eliminado">Eliminado</option>
                    )}
                  </select>
                </label>
              )}
            </div>
          </section>

          <section style={styles.formSection}>
            <div style={styles.sectionHeader}>
              <h4 style={styles.sectionTitle}>Precio</h4>
            </div>

            <div
              className="inventory-valuation-grid"
              style={{ ...styles.formGrid, ...styles.priceGrid }}
            >
              <label style={{ ...styles.field, ...styles.priceField }}>
                <span style={styles.label}>Costo base unitario (CLP)</span>
                <input
                  name="costoBase"
                  type="number"
                  min="0"
                  value={form.costoBase}
                  onChange={handleChange}
                  placeholder="Escribe el costo base en CLP"
                  style={styles.input}
                />
              </label>

              <label style={{ ...styles.field, ...styles.priceField }}>
                <span style={styles.label}>Margen deseado (%)</span>
                <input
                  name="margenDeseado"
                  type="number"
                  value={form.margenDeseado}
                  onChange={handleChange}
                  placeholder="Escribe el porcentaje de margen"
                  style={styles.input}
                />
              </label>

              <div
                className="inventory-valuation-result"
                style={styles.calculatedPriceBox}
              >
                <span style={styles.label}>Precio interno estimado</span>
                <strong style={styles.calculatedPrice}>
                  {previewPrice !== "" && Number.isFinite(previewPrice)
                    ? formatCLP(previewPrice)
                    : formatCLP(0)}
                </strong>
                <label style={styles.overrideField}>
                  <span style={styles.overrideLabel}>Ajuste manual opcional</span>
                  <input
                    name="precioInterno"
                    type="number"
                    min="0"
                    value={form.precioInterno}
                    onChange={handleChange}
                    placeholder="Deja vacío para calcular"
                    style={styles.input}
                  />
                </label>
                {grossProfitability && (
                  <div
                    style={{
                      ...styles.profitabilityBlock,
                      ...grossProfitabilityStyle,
                    }}
                  >
                    <span style={styles.profitabilityMain}>
                      Margen bruto estimado:{" "}
                      {formatPercent(grossProfitability.margenBrutoEstimado, 1)}
                    </span>
                    <span style={styles.profitabilitySecondary}>
                      Ganancia bruta estimada:{" "}
                      {formatSignedCLP(grossProfitability.gananciaBruta)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section style={styles.formSection}>
            <div style={styles.sectionHeader}>
              <h4 style={styles.sectionTitle}>Descripción</h4>
            </div>

            <label style={styles.field}>
              <textarea
                name="descripcion"
                value={form.descripcion}
                onChange={handleChange}
                rows={3}
                placeholder="Describe las características, alcance o condiciones del ítem"
                style={styles.textarea}
              />
            </label>
          </section>
        </div>

        {error && <p style={styles.errorText}>{error}</p>}
        {success && <p style={styles.successText}>{success}</p>}

        <button
          type="submit"
          className="inventory-form-submit"
          style={styles.primaryButton}
          disabled={saving}
        >
          {saving
            ? "Guardando..."
            : editingId
              ? "Actualizar ítem"
              : "Guardar ítem"}
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
            <option value="eliminados">Eliminados</option>
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
                      {item.descripcion && (
                        <span style={styles.itemDescription}>
                          {item.descripcion}
                        </span>
                      )}
                    </td>
                    <td style={styles.tdMuted}>{tipoLabels[item.tipoItem] || item.tipoItem}</td>
                    <td style={styles.tdMuted}>{item.categoria || "-"}</td>
                    <td style={styles.tdMuted}>{item.unidad}</td>
                    <td style={styles.tdMuted}>{formatCLP(item.costoBase)}</td>
                    <td style={styles.tdMuted}>{Number(item.margenDeseado || 0)}%</td>
                    <td style={styles.tdPrice}>{formatCLP(item.precioInterno)}</td>
                    <td style={styles.td}>
                      <span
                        style={{
                          ...styles.statusBadge,
                          ...(item.estado === "eliminado"
                            ? styles.statusDeleted
                            : item.estado === "inactivo"
                              ? styles.statusInactive
                              : styles.statusActive),
                        }}
                      >
                        {estadoLabels[item.estado || "activo"] || "Activo"}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <div style={styles.actions}>
                        {(item.estado || "activo") !== "eliminado" && (
                          <>
                            <button
                              type="button"
                              style={styles.smallButton}
                              onClick={() => setDetailItem(item)}
                            >
                              Ver detalle
                            </button>
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
                            <button
                              type="button"
                              style={styles.deleteButton}
                              onClick={() => handleDelete(item)}
                            >
                              Eliminar
                            </button>
                          </>
                        )}
                        {(item.estado || "activo") === "eliminado" && (
                          <>
                            <button
                              type="button"
                              style={styles.smallButton}
                              onClick={() => setDetailItem(item)}
                            >
                              Ver detalle
                            </button>
                            <button
                              type="button"
                              style={styles.successButton}
                              onClick={() => handleReactivate(item)}
                            >
                              Restaurar
                            </button>
                          </>
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

      {detailItem && (
        <div style={styles.modalBackdrop} role="presentation">
          <div style={styles.modal} role="dialog" aria-modal="true">
            <div style={styles.modalHeader}>
              <div>
                <span style={styles.modalEyebrow}>Detalle de item</span>
                <h3 style={styles.modalTitle}>{detailItem.nombre}</h3>
                <p style={styles.modalSubtitle}>
                  {detailItem.sku ? `SKU: ${detailItem.sku}` : "Sin SKU"}
                </p>
              </div>
              <button
                type="button"
                style={styles.modalCloseButton}
                onClick={() => setDetailItem(null)}
              >
                Cerrar
              </button>
            </div>

            <div style={styles.detailGrid}>
              <div style={styles.detailField}>
                <span style={styles.detailLabel}>Tipo</span>
                <strong style={styles.detailValue}>
                  {tipoLabels[detailItem.tipoItem] || detailItem.tipoItem || "-"}
                </strong>
              </div>
              <div style={styles.detailField}>
                <span style={styles.detailLabel}>Categoria</span>
                <strong style={styles.detailValue}>{detailItem.categoria || "-"}</strong>
              </div>
              <div style={styles.detailField}>
                <span style={styles.detailLabel}>Unidad</span>
                <strong style={styles.detailValue}>{detailItem.unidad || "-"}</strong>
              </div>
              <div style={styles.detailField}>
                <span style={styles.detailLabel}>Costo base</span>
                <strong style={styles.detailValue}>
                  {formatCLP(detailItem.costoBase)}
                </strong>
              </div>
              <div style={styles.detailField}>
                <span style={styles.detailLabel}>Margen deseado</span>
                <strong style={styles.detailValue}>
                  {Number(detailItem.margenDeseado || 0)}%
                </strong>
              </div>
              <div style={styles.detailField}>
                <span style={styles.detailLabel}>Precio interno</span>
                <strong style={styles.detailPrice}>
                  {formatCLP(detailItem.precioInterno)}
                </strong>
              </div>
              <div style={styles.detailField}>
                <span style={styles.detailLabel}>Estado</span>
                <span
                  style={{
                    ...styles.statusBadge,
                    ...(detailItem.estado === "eliminado"
                      ? styles.statusDeleted
                      : detailItem.estado === "inactivo"
                        ? styles.statusInactive
                        : styles.statusActive),
                  }}
                >
                  {estadoLabels[detailItem.estado || "activo"] || "Activo"}
                </span>
              </div>
              <div style={styles.detailField}>
                <span style={styles.detailLabel}>SKU</span>
                <strong style={styles.detailValue}>{detailItem.sku || "-"}</strong>
              </div>
              <div style={styles.detailField}>
                <span style={styles.detailLabel}>Creado</span>
                <strong style={styles.detailValue}>
                  {formatFirestoreDate(detailItem.creadoEn)}
                </strong>
              </div>
              <div style={styles.detailField}>
                <span style={styles.detailLabel}>Actualizado</span>
                <strong style={styles.detailValue}>
                  {formatFirestoreDate(detailItem.actualizadoEn)}
                </strong>
              </div>
            </div>

            <div style={styles.descriptionBlock}>
              <span style={styles.detailLabel}>Descripcion</span>
              <p style={styles.descriptionText}>
                {detailItem.descripcion || "Sin descripcion registrada."}
              </p>
            </div>
          </div>
        </div>
      )}
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
  formSections: {
    display: "grid",
    gap: "22px",
  },
  formSection: {
    display: "grid",
    gap: "12px",
    minWidth: 0,
  },
  sectionHeader: {
    display: "grid",
    gap: "4px",
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
  },
  priceGrid: {
    alignItems: "start",
  },
  field: {
    display: "grid",
    gap: "6px",
    minWidth: 0,
  },
  priceField: {
    alignSelf: "start",
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
  calculatedPriceBox: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    boxSizing: "border-box",
    display: "grid",
    gap: "4px",
    maxWidth: "100%",
    minWidth: 0,
    padding: "9px 10px",
    width: "100%",
  },
  calculatedPrice: {
    color: "#0f172a",
    fontSize: "18px",
    lineHeight: 1.2,
  },
  overrideField: {
    display: "grid",
    gap: "4px",
    marginTop: "4px",
  },
  overrideLabel: {
    color: "#64748b",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase",
  },
  profitabilityBlock: {
    borderRadius: "6px",
    display: "grid",
    gap: "2px",
    marginTop: "2px",
    padding: "5px 6px",
  },
  profitabilityMain: {
    fontSize: "11px",
    fontWeight: 800,
    lineHeight: 1.3,
  },
  profitabilitySecondary: {
    fontSize: "10px",
    fontWeight: 700,
    lineHeight: 1.25,
    opacity: 0.86,
  },
  profitabilityPositive: {
    background: "#ecfdf5",
    border: "1px solid #bbf7d0",
    color: "#047857",
  },
  profitabilityNegative: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
  },
  profitabilityNeutral: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    color: "#475569",
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
    padding: "14px",
  },
  filters: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    marginBottom: "12px",
  },
  searchInput: {
    flex: "1 1 280px",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    fontSize: "13px",
    padding: "8px 10px",
  },
  filterSelect: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#334155",
    fontSize: "13px",
    padding: "8px 10px",
    background: "#ffffff",
  },
  tableWrapper: {
    overflowX: "auto",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "13px",
  },
  th: {
    background: "#f9fafb",
    borderBottom: "1px solid #e5e7eb",
    color: "#667085",
    fontSize: "11px",
    fontWeight: 800,
    padding: "7px 10px",
    textAlign: "left",
    textTransform: "uppercase",
  },
  td: {
    borderBottom: "1px solid #eef2f7",
    color: "#111827",
    fontSize: "13px",
    padding: "7px 10px",
    verticalAlign: "middle",
  },
  tdMuted: {
    borderBottom: "1px solid #eef2f7",
    color: "#64748b",
    fontSize: "13px",
    padding: "7px 10px",
    verticalAlign: "middle",
  },
  tdPrice: {
    borderBottom: "1px solid #eef2f7",
    color: "#0f172a",
    fontSize: "13px",
    fontWeight: 800,
    padding: "7px 10px",
    verticalAlign: "middle",
  },
  itemMeta: {
    color: "#94a3b8",
    display: "block",
    fontSize: "11px",
    fontWeight: 600,
    marginTop: "2px",
  },
  itemDescription: {
    color: "#64748b",
    display: "block",
    fontSize: "12px",
    marginTop: "3px",
    maxWidth: "320px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  statusBadge: {
    borderRadius: "999px",
    display: "inline-block",
    fontSize: "10px",
    fontWeight: 700,
    lineHeight: 1,
    padding: "4px 7px",
  },
  statusActive: {
    background: "#f0fdf4",
    border: "1px solid #dcfce7",
    color: "#166534",
  },
  statusInactive: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    color: "#92400e",
  },
  statusDeleted: {
    background: "#fef2f2",
    border: "1px solid #fee2e2",
    color: "#991b1b",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "5px",
  },
  smallButton: {
    border: "1px solid #d0d5dd",
    borderRadius: "6px",
    background: "#ffffff",
    color: "#344054",
    cursor: "pointer",
    fontSize: "11px",
    fontWeight: 600,
    padding: "4px 7px",
  },
  warningButton: {
    border: "1px solid #fde68a",
    borderRadius: "6px",
    background: "#fffdf5",
    color: "#92400e",
    cursor: "pointer",
    fontSize: "11px",
    fontWeight: 600,
    padding: "4px 7px",
  },
  successButton: {
    border: "1px solid #99f6e4",
    borderRadius: "6px",
    background: "#f7fffd",
    color: "#0f766e",
    cursor: "pointer",
    fontSize: "11px",
    fontWeight: 600,
    padding: "4px 7px",
  },
  deleteButton: {
    border: "1px solid #fee2e2",
    borderRadius: "6px",
    background: "#fffafa",
    color: "#991b1b",
    cursor: "pointer",
    fontSize: "11px",
    fontWeight: 600,
    padding: "4px 7px",
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
  modalBackdrop: {
    alignItems: "center",
    background: "rgba(15, 23, 42, 0.38)",
    bottom: 0,
    display: "flex",
    justifyContent: "center",
    left: 0,
    padding: "20px",
    position: "fixed",
    right: 0,
    top: 0,
    zIndex: 50,
  },
  modal: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    boxShadow: "0 20px 45px rgba(15, 23, 42, 0.18)",
    color: "#111827",
    maxHeight: "90vh",
    maxWidth: "760px",
    overflowY: "auto",
    padding: "20px",
    width: "100%",
  },
  modalHeader: {
    alignItems: "flex-start",
    borderBottom: "1px solid #eef2f7",
    display: "flex",
    gap: "14px",
    justifyContent: "space-between",
    marginBottom: "16px",
    paddingBottom: "14px",
  },
  modalEyebrow: {
    color: "#64748b",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase",
  },
  modalTitle: {
    fontSize: "20px",
    margin: "4px 0 3px",
  },
  modalSubtitle: {
    color: "#64748b",
    fontSize: "13px",
    margin: 0,
  },
  modalCloseButton: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#334155",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 700,
    padding: "7px 10px",
  },
  detailGrid: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  },
  detailField: {
    background: "#f8fafc",
    border: "1px solid #eef2f7",
    borderRadius: "8px",
    padding: "10px",
  },
  detailLabel: {
    color: "#64748b",
    display: "block",
    fontSize: "11px",
    fontWeight: 800,
    marginBottom: "4px",
    textTransform: "uppercase",
  },
  detailValue: {
    color: "#111827",
    display: "block",
    fontSize: "13px",
    fontWeight: 700,
  },
  detailPrice: {
    color: "#0f172a",
    display: "block",
    fontSize: "14px",
    fontWeight: 800,
  },
  descriptionBlock: {
    borderTop: "1px solid #eef2f7",
    marginTop: "16px",
    paddingTop: "14px",
  },
  descriptionText: {
    color: "#334155",
    fontSize: "14px",
    lineHeight: 1.55,
    margin: 0,
    whiteSpace: "pre-wrap",
  },
};

export default InventoryManager;

