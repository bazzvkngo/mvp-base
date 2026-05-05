// src/components/ImportadorInventario.jsx
import React, { useState } from "react";
import {
  leerArchivoInventario,
  importarInventarioEnFirestore,
} from "../services/inventoryImportService";

function ImportadorInventario({ userId }) {
  const [archivo, setArchivo] = useState(null);
  const [archivoNombre, setArchivoNombre] = useState("");
  const [previewItems, setPreviewItems] = useState([]);
  const [resumenLectura, setResumenLectura] = useState(null);
  const [mensajeImportacion, setMensajeImportacion] = useState("");
  const [cargandoLectura, setCargandoLectura] = useState(false);
  const [cargandoImportacion, setCargandoImportacion] = useState(false);
  const [error, setError] = useState("");

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    setArchivo(file || null);
    setArchivoNombre(file ? file.name : "");
    setPreviewItems([]);
    setResumenLectura(null);
    setMensajeImportacion("");
    setError("");

    if (!file) return;

    try {
      setCargandoLectura(true);
      const { items, totalFilas, filasValidas } =
        await leerArchivoInventario(file);

      setPreviewItems(items);
      setResumenLectura({ totalFilas, filasValidas });

      if (filasValidas === 0) {
        setError(
          "No se encontraron filas válidas. Revisa que la planilla tenga columnas como nombre, precio, etc."
        );
      }
    } catch (err) {
      console.error("Error leyendo archivo de inventario:", err);
      setError(
        "No se pudo leer el archivo. Verifica el formato (Excel/CSV) e inténtalo nuevamente."
      );
    } finally {
      setCargandoLectura(false);
    }
  };

  const handleImportar = async () => {
    if (!userId) return;
    if (!previewItems.length) {
      setError(
        "Primero selecciona un archivo y asegúrate de que tenga filas válidas."
      );
      return;
    }

    try {
      setCargandoImportacion(true);
      setError("");
      setMensajeImportacion("");

      const { creados } = await importarInventarioEnFirestore(
        userId,
        previewItems
      );

      setMensajeImportacion(
        `Importación completada. Productos creados: ${creados} de ${previewItems.length}.`
      );
    } catch (err) {
      console.error("Error importando inventario:", err);
      setError("Ocurrió un error al importar el inventario.");
    } finally {
      setCargandoImportacion(false);
    }
  };

  return (
    <section style={styles.card}>
      <h2 style={styles.title}>Importar inventario desde Excel/CSV</h2>
      <p style={styles.subtitle}>
        Sube una planilla con productos y servicios. El sistema detecta columnas
        como <strong>nombre</strong>, <strong>categoría</strong>,{" "}
        <strong>sku</strong>, <strong>stock</strong>, <strong>precio</strong>,{" "}
        <strong>url</strong> aunque tengan nombres distintos (producto,
        descripción, valor, etc.).
      </p>

      {/* Selector de archivo */}
      <div style={styles.row}>
        <div style={styles.field}>
          <label style={styles.label}>Archivo de inventario</label>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
            style={styles.fileInput}
          />
          {archivoNombre && (
            <p style={styles.fileName}>Seleccionado: {archivoNombre}</p>
          )}
        </div>
      </div>

      {/* Mensajes de estado */}
      {cargandoLectura && (
        <p style={styles.infoText}>Leyendo archivo y preparando vista previa…</p>
      )}

      {resumenLectura && !error && (
        <p style={styles.successText}>
          Archivo leído correctamente. Filas válidas:{" "}
          <strong>{resumenLectura.filasValidas}</strong>.
        </p>
      )}

      {mensajeImportacion && (
        <p style={styles.successText}>{mensajeImportacion}</p>
      )}

      {error && <p style={styles.errorText}>{error}</p>}

      {/* Botón de importar */}
      <button
        type="button"
        style={styles.primaryButton}
        onClick={handleImportar}
        disabled={
          cargandoLectura || cargandoImportacion || !previewItems.length
        }
      >
        {cargandoImportacion
          ? "Importando inventario..."
          : "Importar al inventario"}
      </button>

      {/* Vista previa tabla */}
      {previewItems.length > 0 && (
        <div style={styles.previewBlock}>
          <h3 style={styles.previewTitle}>
            Vista previa (primeras {Math.min(previewItems.length, 10)} filas)
          </h3>
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Tipo</th>
                  <th style={styles.th}>SKU</th>
                  <th style={styles.th}>Nombre</th>
                  <th style={styles.th}>Categoría</th>
                  <th style={styles.th}>Unidad</th>
                  <th style={styles.th}>Stock</th>
                  <th style={styles.th}>Precio</th>
                  <th style={styles.th}>URL</th>
                </tr>
              </thead>
              <tbody>
                {previewItems.slice(0, 10).map((item, idx) => (
                  <tr key={idx}>
                    <td style={styles.td}>
                      {item.tipoItem === "servicio" ? "Servicio" : "Producto"}
                    </td>
                    <td style={styles.td}>{item.sku || "—"}</td>
                    <td style={styles.td}>{item.nombre}</td>
                    <td style={styles.td}>{item.categoria || "—"}</td>
                    <td style={styles.td}>{item.unidad || "—"}</td>
                    <td style={styles.td}>
                      {item.tipoItem === "servicio" || item.stock == null
                        ? "—"
                        : item.stock}
                    </td>
                    <td style={styles.td}>
                      $
                      {Number(item.precio || 0).toLocaleString("es-CL")}
                    </td>
                    <td style={styles.td}>
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          style={styles.link}
                        >
                          Ver
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

const styles = {
  card: {
    marginTop: "2rem",
    marginBottom: "1.5rem",
    backgroundColor: "#FFFFFF",
    borderRadius: "12px",
    padding: "1.8rem 2.2rem",
    border: "1px solid #E5E7EB",
    boxShadow: "0 8px 18px rgba(15,23,42,0.04)",
    color: "#111827",
  },
  title: {
    fontSize: "1.3rem",
    marginBottom: "0.35rem",
    fontWeight: 600,
  },
  subtitle: {
    fontSize: "0.9rem",
    color: "#6B7280",
    marginBottom: "1.1rem",
  },
  row: {
    display: "flex",
    flexWrap: "wrap",
    gap: "1rem",
    marginBottom: "0.75rem",
  },
  field: {
    flex: 1,
    minWidth: "260px",
  },
  label: {
    display: "block",
    fontSize: "0.85rem",
    marginBottom: "0.3rem",
    color: "#374151",
    fontWeight: 500,
  },
  fileInput: {
    display: "block",
    width: "100%",
  },
  fileName: {
    marginTop: "0.3rem",
    fontSize: "0.8rem",
    color: "#6B7280",
  },
  primaryButton: {
    marginTop: "0.9rem",
    padding: "0.7rem 1.6rem",
    borderRadius: "999px",
    border: "none",
    cursor: "pointer",
    backgroundColor: "#0f766e",
    color: "#FFFFFF",
    fontWeight: 600,
    fontSize: "0.95rem",
    disabledOpacity: 0.6,
  },
  errorText: {
    color: "#B91C1C",
    fontSize: "0.85rem",
    marginTop: "0.4rem",
  },
  successText: {
    color: "#047857",
    fontSize: "0.85rem",
    marginTop: "0.4rem",
  },
  infoText: {
    color: "#6B7280",
    fontSize: "0.85rem",
    marginTop: "0.4rem",
  },
  previewBlock: {
    marginTop: "1.5rem",
  },
  previewTitle: {
    fontSize: "0.98rem",
    marginBottom: "0.6rem",
    color: "#111827",
    fontWeight: 600,
  },
  tableWrapper: {
    overflowX: "auto",
    borderRadius: "10px",
    border: "1px solid #E5E7EB",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.9rem",
  },
  th: {
    textAlign: "left",
    padding: "0.55rem 0.75rem",
    borderBottom: "1px solid #E5E7EB",
    backgroundColor: "#F9FAFB",
    color: "#6B7280",
    textTransform: "uppercase",
    fontSize: "0.8rem",
  },
  td: {
    padding: "0.55rem 0.75rem",
    borderBottom: "1px solid #F3F4F6",
  },
  link: {
    color: "#2563EB",
    textDecoration: "none",
    fontSize: "0.85rem",
  },
};

export default ImportadorInventario;
