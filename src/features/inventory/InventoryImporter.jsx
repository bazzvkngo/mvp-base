import React, { useRef, useState } from "react";
import {
  importarInventarioEnFirestore,
  leerArchivoInventario,
} from "../../services/inventoryImportService";
import { formatCLP } from "../../utils/formatters";

function InventoryImporter({ userId, onImported }) {
  const fileInputRef = useRef(null);
  const [archivoNombre, setArchivoNombre] = useState("");
  const [previewItems, setPreviewItems] = useState([]);
  const [resumenLectura, setResumenLectura] = useState(null);
  const [mensajeImportacion, setMensajeImportacion] = useState("");
  const [cargandoLectura, setCargandoLectura] = useState(false);
  const [cargandoImportacion, setCargandoImportacion] = useState(false);
  const [error, setError] = useState("");
  const canImport = previewItems.length > 0 && !cargandoLectura && !cargandoImportacion;

  const clearSelection = () => {
    setArchivoNombre("");
    setPreviewItems([]);
    setResumenLectura(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

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
          "No se encontraron filas validas. Revisa que la planilla tenga nombre y costo base."
        );
      }
    } catch (err) {
      console.error("Error leyendo archivo de inventario:", err);
      setError(
        "No se pudo leer el archivo. Verifica el formato Excel/CSV e intentalo nuevamente."
      );
    } finally {
      setCargandoLectura(false);
    }
  };

  const handleImportar = async () => {
    if (!userId) {
      setError("No hay usuario autenticado para importar inventario.");
      return;
    }
    if (!previewItems.length) {
      setError("Primero selecciona un archivo con filas validas.");
      return;
    }

    try {
      setCargandoImportacion(true);
      setError("");
      setMensajeImportacion("");

      const result = await importarInventarioEnFirestore(userId, previewItems);

      if (result.total > 0 && result.verifiedCount < result.total) {
        throw new Error(
          `Firestore confirmo ${result.verifiedCount} de ${result.total} items importados. Revisa permisos, proyecto Firebase y sesion.`
        );
      }

      setMensajeImportacion(`Se importaron ${result.total} items correctamente.`);
      clearSelection();
      if (onImported) {
        onImported();
      }
    } catch (err) {
      console.error("[IMPORT] error guardando en Firestore:", err);
      if (err.code === "permission-denied") {
        setError(
          "Firestore rechazo la importacion por permisos. Verifica que la sesion corresponda al usuario dueno del inventario."
        );
      } else {
        setError(err.message || "Ocurrio un error al importar el inventario.");
      }
    } finally {
      setCargandoImportacion(false);
    }
  };

  return (
    <section style={styles.card}>
      <div style={styles.header}>
        <div>
          <span style={styles.eyebrow}>Importacion masiva</span>
          <h2 style={styles.title}>Importar inventario desde Excel/CSV</h2>
          <p style={styles.subtitle}>
            Carga una planilla y confirma el guardado cuando la vista previa sea correcta.
          </p>
        </div>
      </div>

      <div style={styles.stepsGrid}>
        <div style={styles.stepPanel}>
          <div style={styles.stepHeader}>
            <span style={styles.stepNumber}>1</span>
            <div>
              <h3 style={styles.stepTitle}>Seleccionar archivo</h3>
              <p style={styles.stepText}>Excel o CSV con nombre, costo base, margen y SKU.</p>
            </div>
          </div>
          <label style={styles.field}>
            <span style={styles.label}>Archivo de inventario</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              style={styles.fileInput}
            />
          </label>
          {cargandoLectura && (
            <p style={styles.infoText}>Leyendo archivo y preparando vista previa...</p>
          )}
        </div>

        <div style={previewItems.length ? styles.confirmPanelReady : styles.confirmPanel}>
          <div style={styles.stepHeader}>
            <span style={previewItems.length ? styles.stepNumberReady : styles.stepNumber}>2</span>
            <div>
              <h3 style={styles.stepTitle}>Confirmar importacion</h3>
              <p style={styles.stepText}>
                Paso 2 de 2: confirma la importacion para guardar los items en Firebase.
              </p>
            </div>
          </div>

          {archivoNombre ? (
            <div style={styles.fileSummary}>
              <div>
                <span style={styles.summaryLabel}>Archivo</span>
                <strong style={styles.summaryValue}>{archivoNombre}</strong>
              </div>
              <div>
                <span style={styles.summaryLabel}>Filas validas</span>
                <strong style={styles.summaryCount}>
                  {resumenLectura?.filasValidas ?? 0}
                </strong>
              </div>
            </div>
          ) : (
            <p style={styles.placeholderText}>
              Selecciona un archivo para habilitar la confirmacion.
            </p>
          )}

          <button
            type="button"
            style={{
              ...styles.primaryButton,
              ...(!canImport ? styles.primaryButtonDisabled : {}),
            }}
            onClick={handleImportar}
            disabled={!canImport}
          >
            {cargandoImportacion ? "Guardando items..." : "Guardar items en inventario"}
          </button>
        </div>
      </div>

      {mensajeImportacion && <p style={styles.successText}>{mensajeImportacion}</p>}
      {error && <p style={styles.errorText}>{error}</p>}

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
                  <th style={styles.th}>Categoria</th>
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
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    marginBottom: "16px",
  },
  eyebrow: {
    color: "#0f766e",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase",
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
    margin: 0,
  },
  stepsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "14px",
  },
  stepPanel: {
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    padding: "14px",
    background: "#ffffff",
  },
  confirmPanel: {
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    padding: "14px",
    background: "#f8fafc",
  },
  confirmPanelReady: {
    border: "1px solid #ccfbf1",
    borderRadius: "8px",
    padding: "14px",
    background: "#f7fffd",
  },
  stepHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
    marginBottom: "12px",
  },
  stepNumber: {
    alignItems: "center",
    background: "#e2e8f0",
    borderRadius: "999px",
    color: "#475569",
    display: "inline-flex",
    fontSize: "12px",
    fontWeight: 800,
    height: "24px",
    justifyContent: "center",
    width: "24px",
  },
  stepNumberReady: {
    alignItems: "center",
    background: "#ccfbf1",
    borderRadius: "999px",
    color: "#0f766e",
    display: "inline-flex",
    fontSize: "12px",
    fontWeight: 800,
    height: "24px",
    justifyContent: "center",
    width: "24px",
  },
  stepTitle: {
    fontSize: "14px",
    fontWeight: 800,
    margin: "0 0 3px",
  },
  stepText: {
    color: "#64748b",
    fontSize: "13px",
    lineHeight: 1.4,
    margin: 0,
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
  fileSummary: {
    background: "#ffffff",
    border: "1px solid #dbeafe",
    borderRadius: "8px",
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    marginBottom: "12px",
    padding: "10px",
  },
  summaryLabel: {
    color: "#64748b",
    display: "block",
    fontSize: "11px",
    fontWeight: 800,
    marginBottom: "3px",
    textTransform: "uppercase",
  },
  summaryValue: {
    color: "#0f172a",
    display: "block",
    fontSize: "13px",
    overflowWrap: "anywhere",
  },
  summaryCount: {
    color: "#0f766e",
    display: "block",
    fontSize: "16px",
    fontWeight: 800,
    lineHeight: 1,
    textAlign: "right",
  },
  placeholderText: {
    color: "#64748b",
    fontSize: "13px",
    margin: "0 0 12px",
  },
  primaryButton: {
    backgroundColor: "#0f766e",
    border: "1px solid #0f766e",
    borderRadius: "6px",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 700,
    marginTop: 0,
    padding: "8px 12px",
  },
  primaryButtonDisabled: {
    backgroundColor: "#f1f5f9",
    border: "1px solid #cbd5e1",
    color: "#64748b",
    cursor: "not-allowed",
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
