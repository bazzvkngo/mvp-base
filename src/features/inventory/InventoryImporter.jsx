import React, { useState } from "react";
import {
  importarInventarioEnFirestore,
  leerArchivoInventario,
} from "../../services/inventoryImportService";
import { formatCLP } from "../../utils/formatters";

function InventoryImporter({ userId }) {
  const [archivoNombre, setArchivoNombre] = useState("");
  const [previewItems, setPreviewItems] = useState([]);
  const [resumenLectura, setResumenLectura] = useState(null);
  const [mensajeImportacion, setMensajeImportacion] = useState("");
  const [cargandoLectura, setCargandoLectura] = useState(false);
  const [cargandoImportacion, setCargandoImportacion] = useState(false);
  const [error, setError] = useState("");

  const handleFileChange = async (event) => {
    const file = event.target.files[0];
    setArchivoNombre(file ? file.name : "");
    setPreviewItems([]);
    setResumenLectura(null);
    setMensajeImportacion("");
    setError("");

    if (!file) return;

    try {
      setCargandoLectura(true);
      const { items, totalFilas, filasValidas } = await leerArchivoInventario(file);
      setPreviewItems(items);
      setResumenLectura({ totalFilas, filasValidas });

      if (filasValidas === 0) {
        setError(
          "No se encontraron filas válidas. Revisa que la planilla tenga nombre y costo base."
        );
      }
    } catch (err) {
      console.error("Error leyendo archivo de inventario:", err);
      setError(
        "No se pudo leer el archivo. Verifica el formato Excel/CSV e inténtalo nuevamente."
      );
    } finally {
      setCargandoLectura(false);
    }
  };

  const handleImportar = async () => {
    if (!userId) {
      setError("Debes iniciar sesión para importar inventario.");
      return;
    }
    if (!previewItems.length) {
      setError("Primero selecciona un archivo con filas válidas.");
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
        `Importación completada. Ítems creados: ${creados} de ${previewItems.length}.`
      );
    } catch (err) {
      console.error("Error importando inventario:", err);
      setError(err.message || "Ocurrió un error al importar el inventario.");
    } finally {
      setCargandoImportacion(false);
    }
  };

  return (
    <section style={styles.card}>
      <h2 style={styles.title}>Importar inventario desde Excel/CSV</h2>
      <p style={styles.subtitle}>
        Puedes cargar una planilla simple. ValoraCloud intentará detectar
        columnas como nombre, tipo, categoría, unidad, costo base, margen,
        precio interno y SKU.
      </p>

      <label style={styles.field}>
        <span style={styles.label}>Archivo de inventario</span>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFileChange}
          style={styles.fileInput}
        />
      </label>

      {archivoNombre && (
        <p style={styles.infoText}>Archivo seleccionado: {archivoNombre}</p>
      )}
      {cargandoLectura && (
        <p style={styles.infoText}>Leyendo archivo y preparando vista previa...</p>
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

      <button
        type="button"
        style={styles.primaryButton}
        onClick={handleImportar}
        disabled={cargandoLectura || cargandoImportacion || !previewItems.length}
      >
        {cargandoImportacion ? "Importando inventario..." : "Importar al inventario"}
      </button>

      {previewItems.length > 0 && (
        <div style={styles.previewBlock}>
          <h3 style={styles.previewTitle}>
            Vista previa ({Math.min(previewItems.length, 10)} primeras filas)
          </h3>
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Tipo</th>
                  <th style={styles.th}>Nombre</th>
                  <th style={styles.th}>Categoría</th>
                  <th style={styles.th}>Unidad</th>
                  <th style={styles.th}>Costo base</th>
                  <th style={styles.th}>Margen</th>
                  <th style={styles.th}>Precio interno</th>
                  <th style={styles.th}>SKU</th>
                </tr>
              </thead>
              <tbody>
                {previewItems.slice(0, 10).map((item, index) => (
                  <tr key={`${item.nombre}-${index}`}>
                    <td style={styles.td}>{item.tipoItem}</td>
                    <td style={styles.td}>{item.nombre}</td>
                    <td style={styles.td}>{item.categoria || "-"}</td>
                    <td style={styles.td}>{item.unidad}</td>
                    <td style={styles.td}>{formatCLP(item.costoBase)}</td>
                    <td style={styles.td}>{item.margenDeseado}%</td>
                    <td style={styles.td}>{formatCLP(item.precioInterno)}</td>
                    <td style={styles.td}>{item.sku || "-"}</td>
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
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    color: "#111827",
    marginBottom: "18px",
    padding: "20px",
  },
  title: {
    fontSize: "20px",
    fontWeight: 700,
    margin: "0 0 6px",
  },
  subtitle: {
    color: "#64748b",
    fontSize: "14px",
    lineHeight: 1.5,
    margin: "0 0 16px",
  },
  field: {
    display: "grid",
    gap: "6px",
  },
  label: {
    color: "#334155",
    fontSize: "13px",
    fontWeight: 700,
  },
  fileInput: {
    display: "block",
    width: "100%",
  },
  primaryButton: {
    backgroundColor: "#0f766e",
    border: "none",
    borderRadius: "6px",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 800,
    marginTop: "12px",
    padding: "10px 14px",
  },
  errorText: {
    color: "#b91c1c",
    fontSize: "14px",
    margin: "10px 0 0",
  },
  successText: {
    color: "#047857",
    fontSize: "14px",
    margin: "10px 0 0",
  },
  infoText: {
    color: "#64748b",
    fontSize: "14px",
    margin: "10px 0 0",
  },
  previewBlock: {
    marginTop: "18px",
  },
  previewTitle: {
    fontSize: "16px",
    fontWeight: 700,
    margin: "0 0 10px",
  },
  tableWrapper: {
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    overflowX: "auto",
  },
  table: {
    borderCollapse: "collapse",
    fontSize: "14px",
    width: "100%",
  },
  th: {
    backgroundColor: "#f8fafc",
    borderBottom: "1px solid #e5e7eb",
    color: "#64748b",
    fontSize: "12px",
    padding: "10px",
    textAlign: "left",
    textTransform: "uppercase",
  },
  td: {
    borderBottom: "1px solid #eef2f7",
    padding: "10px",
  },
};

export default InventoryImporter;
