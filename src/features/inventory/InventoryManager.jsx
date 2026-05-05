import React, { useState, useEffect } from "react";
import {
  createInventoryItem,
  deleteInventoryItem,
  subscribeToInventory,
  updateInventoryItem,
  verifySupplierPrice,
} from "../../services/inventoryService";

function obtenerTipoItem(producto) {
  if (producto.tipoItem === "servicio" || producto.tipoItem === "producto") {
    return producto.tipoItem;
  }
  const cat = (producto.categoria || "").toLowerCase();
  const nombre = (producto.nombre || "").toLowerCase();

  if (
    cat.includes("servicio") ||
    cat.includes("mano de obra") ||
    cat.includes("instalaciÃ³n") ||
    cat.includes("instalacion") ||
    nombre.includes("servicio")
  ) {
    return "servicio";
  }
  return "producto";
}

function InventoryManager({ userId }) {
  const [productos, setProductos] = useState([]);
  const [form, setForm] = useState({
    nombre: "",
    sku: "",
    categoria: "",
    tipoItem: "producto",
    unidad: "",
    url: "",
    stock: "",
    precio: "",
  });
  const [editandoId, setEditandoId] = useState(null);
  const [loadingIA, setLoadingIA] = useState(null);
  const [resultadoIA, setResultadoIA] = useState({});
  const [error, setError] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("todos");

  useEffect(() => {
    if (!userId) return;

    const unsubscribe = subscribeToInventory(
      userId,
      (snapshot) => {
        setProductos(snapshot);
      },
      (err) => {
        console.error("Error al leer inventario:", err);
        setError("Error al cargar el inventario.");
      }
    );

    return () => unsubscribe();
  }, [userId]);

  const limpiarFormulario = () => {
    setForm({
      nombre: "",
      sku: "",
      categoria: "",
      tipoItem: "producto",
      unidad: "",
      url: "",
      stock: "",
      precio: "",
    });
    setEditandoId(null);
    setError(null);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!form.nombre || !form.precio) {
      setError("Completa al menos el nombre y el precio.");
      return;
    }

    const tipoItem = form.tipoItem || "producto";

    const stockNumber =
      tipoItem === "servicio"
        ? null
        : form.stock !== ""
        ? Number(form.stock)
        : 0;

    const datos = {
      nombre: form.nombre.trim(),
      sku: form.sku.trim() || null,
      categoria: form.categoria.trim() || "",
      tipoItem,
      unidad:
        form.unidad.trim() || (tipoItem === "servicio" ? "servicio" : "unidad"),
      url: form.url.trim() || "",
      stock: stockNumber,
      precio: Number(form.precio),
      actualizadoEn: new Date(),
    };

    try {
      if (editandoId) {
        await updateInventoryItem(userId, editandoId, datos);
      } else {
        await createInventoryItem(userId, {
          ...datos,
          creadoEn: new Date(),
        });
      }

      limpiarFormulario();
    } catch (err) {
      console.error("Error al guardar producto:", err);
      setError("No se pudo guardar el producto.");
    }
  };

  const handleEditarClick = (producto) => {
    const tipo = obtenerTipoItem(producto);
    setEditandoId(producto.id);
    setForm({
      nombre: producto.nombre ?? "",
      sku: producto.sku ?? "",
      categoria: producto.categoria ?? "",
      tipoItem: tipo,
      unidad: producto.unidad ?? (tipo === "servicio" ? "servicio" : "unidad"),
      url: producto.url ?? "",
      stock:
        tipo === "servicio" || producto.stock == null ? "" : producto.stock,
      precio: producto.precio ?? "",
    });
  };

  const handleCancelarEdicion = () => {
    limpiarFormulario();
  };

  const handleEliminarProducto = async (id) => {
    if (!window.confirm("Â¿Eliminar este producto del inventario?")) return;

    try {
      await deleteInventoryItem(userId, id);
    } catch (err) {
      console.error("Error al eliminar producto:", err);
      alert("No se pudo eliminar el producto.");
    }
  };

  const handleVerificarPrecio = async (producto) => {
    if (!producto.url) {
      alert("Este producto no tiene URL configurada.");
      return;
    }

    setLoadingIA(producto.id);
    setResultadoIA((prev) => ({
      ...prev,
      [producto.id]: "Analizando precio en proveedor...",
    }));

    try {
      const data = await verifySupplierPrice(producto.id);
      const {
        precioProveedor,
        diferencia,
        diffPorcentaje,
        estadoAlerta,
        modo,
      } = data;

      const mensaje = `Proveedor: $${precioProveedor?.toLocaleString(
        "es-CL"
      )} (${modo || "?"}). Diferencia: $${diferencia?.toLocaleString(
        "es-CL"
      )} (${diffPorcentaje?.toFixed(1)}%). Estado: ${
        estadoAlerta || "normal"
      }`;

      setResultadoIA((prev) => ({
        ...prev,
        [producto.id]: mensaje,
      }));
    } catch (err) {
      console.error("Error en anÃ¡lisis de precios:", err);
      setResultadoIA((prev) => ({
        ...prev,
        [producto.id]: "No se pudo analizar el precio.",
      }));
    } finally {
      setLoadingIA(null);
    }
  };

  const renderStock = (producto) => {
    const tipo = obtenerTipoItem(producto);
    if (tipo === "servicio") return "â€”";
    if (producto.stock == null || Number.isNaN(Number(producto.stock)))
      return "â€”";
    return producto.stock;
  };

  const traducirTipo = (producto) => {
    const tipo = obtenerTipoItem(producto);
    return tipo === "servicio" ? "Servicio" : "Producto";
  };

  const productosFiltrados = productos.filter((producto) => {
    const tipo = obtenerTipoItem(producto);
    if (filtroTipo !== "todos" && tipo !== filtroTipo) return false;

    const q = busqueda.trim().toLowerCase();
    if (!q) return true;

    const textoBuscable = `${producto.nombre || ""} ${
      producto.categoria || ""
    } ${producto.sku || ""}`.toLowerCase();

    return textoBuscable.includes(q);
  });

  return (
    <div style={styles.container}>
      {/* Encabezado del mÃ³dulo */}
      <div style={styles.headerBlock}>
        <h3 style={styles.h3}>Inventario</h3>
        <p style={styles.subtitle}>
          Gestiona tus productos y servicios. Esta informaciÃ³n alimenta el
          mÃ³dulo de cotizaciones y el anÃ¡lisis de precios.
        </p>
      </div>

      {/* Formulario */}
      <form onSubmit={handleSubmit} style={styles.formCard}>
        <h4 style={styles.formTitle}>
          {editandoId ? "Editar Ã­tem de inventario" : "Agregar nuevo Ã­tem"}
        </h4>

        <div style={styles.formGrid}>
          <div style={styles.field}>
            <label style={styles.label}>Tipo de Ã­tem</label>
            <select
              name="tipoItem"
              value={form.tipoItem}
              onChange={handleChange}
              style={styles.input}
            >
              <option value="producto">Producto</option>
              <option value="servicio">Servicio</option>
            </select>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Nombre</label>
            <input
              name="nombre"
              type="text"
              placeholder="Ej: CÃ¡mara 1080p exterior"
              value={form.nombre}
              onChange={handleChange}
              style={styles.input}
              required
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>SKU / CÃ³digo</label>
            <input
              name="sku"
              type="text"
              placeholder="Opcional"
              value={form.sku}
              onChange={handleChange}
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>CategorÃ­a</label>
            <input
              name="categoria"
              type="text"
              placeholder="Ej: CCTV, Redes, Servicio tÃ©cnico..."
              value={form.categoria}
              onChange={handleChange}
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Unidad</label>
            <input
              name="unidad"
              type="text"
              placeholder={
                form.tipoItem === "servicio"
                  ? "Ej: hora, visita, proyecto"
                  : "Ej: unidad, rollo, caja"
              }
              value={form.unidad}
              onChange={handleChange}
              style={styles.input}
            />
          </div>

          {form.tipoItem === "producto" && (
            <div style={styles.field}>
              <label style={styles.label}>Stock disponible</label>
              <input
                name="stock"
                type="number"
                placeholder="Ej: 10"
                value={form.stock}
                onChange={handleChange}
                style={styles.input}
                min={0}
              />
            </div>
          )}

          <div style={styles.field}>
            <label style={styles.label}>Precio interno (CLP)</label>
            <input
              name="precio"
              type="number"
              placeholder="Ej: 45000"
              value={form.precio}
              onChange={handleChange}
              style={styles.input}
              required
              min={0}
            />
          </div>

          <div style={styles.fieldFull}>
            <label style={styles.label}>URL proveedor (opcional)</label>
            <input
              name="url"
              type="text"
              placeholder="Ej: https://proveedor.cl/producto/123"
              value={form.url}
              onChange={handleChange}
              style={styles.input}
            />
          </div>
        </div>

        {error && <p style={styles.errorText}>{error}</p>}

        <div style={styles.buttonGroup}>
          <button type="submit" style={styles.buttonPrimary}>
            {editandoId ? "Actualizar Ã­tem" : "Guardar Ã­tem"}
          </button>
          {editandoId && (
            <button
              type="button"
              onClick={handleCancelarEdicion}
              style={styles.buttonCancel}
            >
              Cancelar
            </button>
          )}
        </div>
      </form>

      {/* Lista */}
      <div style={styles.listContainerCard}>
        {/* Buscador + filtros pegados a la tabla */}
        <div style={styles.listHeader}>
          <h4 style={styles.listTitle}>Items en inventario</h4>
          <div style={styles.toolbarRight}>
            <input
              type="text"
              placeholder="Buscar por nombre, SKU o categorÃ­a..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              style={styles.searchInput}
            />
            <select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value)}
              style={styles.filterSelect}
            >
              <option value="todos">Todos</option>
              <option value="producto">Solo productos</option>
              <option value="servicio">Solo servicios</option>
            </select>
          </div>
        </div>

        {productosFiltrados.length === 0 ? (
          <p style={styles.emptyText}>
            No hay Ã­tems para mostrar con los filtros actuales.
          </p>
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Tipo</th>
                  <th style={styles.th}>SKU</th>
                  <th style={styles.th}>Nombre</th>
                  <th style={styles.th}>CategorÃ­a</th>
                  <th style={styles.th}>Unidad</th>
                  <th style={styles.th}>Stock</th>
                  <th style={styles.th}>Precio interno</th>
                  <th style={styles.th}>Precios de mercado</th>
                  <th style={styles.th}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {productosFiltrados.map((producto) => (
                  <tr key={producto.id}>
                    <td style={styles.td}>{traducirTipo(producto)}</td>
                    <td style={styles.td}>{producto.sku || "â€”"}</td>
                    <td style={styles.td}>{producto.nombre}</td>
                    <td style={styles.td}>{producto.categoria || "â€”"}</td>
                    <td style={styles.td}>{producto.unidad || "â€”"}</td>
                    <td style={styles.td}>{renderStock(producto)}</td>
                    <td style={styles.td}>
                      $
                      {Number(producto.precio || 0).toLocaleString("es-CL")}
                    </td>
                    <td style={styles.td}>
                      {loadingIA === producto.id ? (
                        <span style={styles.textLoading}>
                          Analizando precio...
                        </span>
                      ) : (
                        <>
                          <button
                            onClick={() => handleVerificarPrecio(producto)}
                            style={styles.buttonIA}
                            disabled={!producto.url}
                          >
                            Verificar en proveedor
                          </button>
                          {resultadoIA[producto.id] && (
                            <div style={styles.textResultIA}>
                              {resultadoIA[producto.id]}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td style={styles.td}>
                      <button
                        onClick={() => handleEditarClick(producto)}
                        style={styles.buttonEdit}
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleEliminarProducto(producto.id)}
                        style={styles.buttonDelete}
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    color: "#111827",
  },
  headerBlock: {
    marginBottom: "1.5rem",
  },
  h3: {
    color: "#111827",
    fontSize: "1.4rem",
    marginBottom: "0.25rem",
  },
  subtitle: {
    color: "#6b7280",
    fontSize: "0.9rem",
  },
  toolbarRight: {
    display: "flex",
    gap: "0.5rem",
    alignItems: "center",
    flexWrap: "wrap",
  },
  searchInput: {
    padding: "0.55rem 0.75rem",
    borderRadius: "999px",
    border: "1px solid #d1d5db",
    backgroundColor: "#ffffff",
    color: "#111827",
    minWidth: "260px",
  },
  filterSelect: {
    padding: "0.55rem 0.75rem",
    borderRadius: "999px",
    border: "1px solid #d1d5db",
    backgroundColor: "#ffffff",
    color: "#111827",
  },
  formCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    marginBottom: "1.5rem",
    padding: "1.5rem 2rem",
    borderRadius: "12px",
    boxShadow: "0 8px 18px rgba(15,23,42,0.04)",
  },
  formTitle: {
    fontSize: "1.05rem",
    color: "#111827",
    marginBottom: "1rem",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "1rem",
  },
  field: {
    display: "flex",
    flexDirection: "column",
  },
  fieldFull: {
    gridColumn: "1 / -1",
    display: "flex",
    flexDirection: "column",
  },
  label: {
    fontSize: "0.85rem",
    color: "#4b5563",
    marginBottom: "0.3rem",
  },
  input: {
    width: "100%",
    padding: "0.65rem 0.75rem",
    borderRadius: "8px",
    border: "1px solid #d1d5db",
    backgroundColor: "#ffffff",
    color: "#111827",
    fontSize: "0.95rem",
  },
  buttonGroup: {
    marginTop: "1rem",
    display: "flex",
    gap: "0.5rem",
  },
  buttonPrimary: {
    backgroundColor: "#0f766e",
    color: "white",
    padding: "0.7rem 1.4rem",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "0.96rem",
    fontWeight: 600,
  },
  buttonCancel: {
    backgroundColor: "#e5e7eb",
    color: "#374151",
    padding: "0.7rem 1.2rem",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "0.96rem",
  },
  errorText: {
    color: "#b91c1c",
    fontSize: "0.9rem",
    marginTop: "0.5rem",
  },
  listContainerCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    padding: "1.5rem 2rem",
    borderRadius: "12px",
    boxShadow: "0 8px 18px rgba(15,23,42,0.04)",
  },
  listHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "1rem",
    marginBottom: "1rem",
    flexWrap: "wrap",
  },
  listTitle: {
    fontSize: "1rem",
    fontWeight: 600,
    color: "#111827",
  },
  emptyText: {
    color: "#6b7280",
    fontStyle: "italic",
    textAlign: "center",
    padding: "2rem 0",
  },
  tableWrapper: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    color: "#111827",
  },
  th: {
    borderBottom: "1px solid #e5e7eb",
    padding: "0.7rem 0.9rem",
    textAlign: "left",
    backgroundColor: "#f9fafb",
    fontSize: "0.85rem",
    textTransform: "uppercase",
    color: "#6b7280",
  },
  td: {
    borderBottom: "1px solid #e5e7eb",
    padding: "0.65rem 0.9rem",
    verticalAlign: "top",
    fontSize: "0.9rem",
  },
  buttonEdit: {
    backgroundColor: "#f59e0b",
    color: "white",
    padding: "4px 10px",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    marginRight: "4px",
    marginBottom: "4px",
    fontSize: "0.85rem",
  },
  buttonDelete: {
    backgroundColor: "#dc2626",
    color: "white",
    padding: "4px 10px",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "0.85rem",
  },
  buttonIA: {
    backgroundColor: "#e0f2fe",
    color: "#1d4ed8",
    padding: "4px 10px",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: "0.82rem",
  },
  textLoading: {
    fontStyle: "italic",
    color: "#6b7280",
    fontSize: "0.85rem",
  },
  textResultIA: {
    fontSize: "0.8rem",
    marginTop: "4px",
    fontWeight: 500,
    color: "#92400e",
  },
};

export default InventoryManager;
