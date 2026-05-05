// src/components/Cotizador.jsx
import React, { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import { collection, onSnapshot } from "firebase/firestore";
import { generarPropuestaCotizacion } from "../services/cotizacionService";
import { obtenerConfigNegocio } from "../services/configNegocioService";

function Cotizador({ userId }) {
  const [inventario, setInventario] = useState([]);
  const [configNegocio, setConfigNegocio] = useState(null);
  const [loadingData, setLoadingData] = useState(true);

  const [form, setForm] = useState({
    nombreCliente: "",
    empresa: "",
    direccionCliente: "",
    ciudadCliente: "",
    tipoProyecto: "",
    nivelCalidad: "estandar",
    distanciaKm: "",
    presupuestoReferencia: "",
    descripcionProyecto: "",
  });

  const [propuesta, setPropuesta] = useState(null);
  const [loadingPropuesta, setLoadingPropuesta] = useState(false);
  const [error, setError] = useState("");

  // Carga inventario + configuración del negocio
  useEffect(() => {
    if (!userId) return;

    setLoadingData(true);
    setError("");

    const colRef = collection(db, "usuarios", userId, "inventario");
    const unsub = onSnapshot(
      colRef,
      (snapshot) => {
        const items = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        setInventario(items);
        setLoadingData(false);
      },
      (err) => {
        console.error("Error leyendo inventario para cotizador:", err);
        setError("No se pudo cargar el inventario.");
        setLoadingData(false);
      }
    );

    obtenerConfigNegocio(userId)
      .then((cfg) => setConfigNegocio(cfg))
      .catch((e) => {
        console.error("Error cargando config negocio en cotizador:", e);
      });

    return () => unsub();
  }, [userId]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleGenerarPropuesta = (e) => {
    e.preventDefault();
    setError("");
    setPropuesta(null);

    if (!inventario || inventario.length === 0) {
      setError(
        "Tu inventario está vacío. Importa productos o agrega algunos antes de cotizar."
      );
      return;
    }

    if (!form.tipoProyecto || !form.descripcionProyecto) {
      setError(
        "Completa al menos el tipo de proyecto y la descripción para poder generar una propuesta."
      );
      return;
    }

    setLoadingPropuesta(true);

    try {
      const propuestaGenerada = generarPropuestaCotizacion({
        inventario,
        tipoProyecto: form.tipoProyecto,
        nivelCalidad: form.nivelCalidad,
        distanciaKm: Number(form.distanciaKm) || 0,
        presupuestoReferencia: form.presupuestoReferencia
          ? Number(form.presupuestoReferencia)
          : null,
        descripcionProyecto: form.descripcionProyecto,
        configNegocio: configNegocio || undefined,
      });

      setPropuesta(propuestaGenerada);
    } catch (e) {
      console.error("Error generando propuesta:", e);
      setError("Ocurrió un problema al generar la propuesta.");
    } finally {
      setLoadingPropuesta(false);
    }
  };

  return (
    <section style={styles.card}>
      {/* Encabezado */}
      <h2 style={styles.title}>Asistente de cotizaciones inteligentes</h2>
      <p style={styles.subtitle}>
        Completa los datos del cliente y describe el proyecto. El sistema
        preparará una propuesta basada en tu inventario y en la configuración
        de tu negocio.
      </p>

      {/* Formulario */}
      <form onSubmit={handleGenerarPropuesta} style={styles.form}>
        {/* Datos del cliente */}
        <div style={styles.block}>
          <h3 style={styles.blockTitle}>Datos del cliente</h3>

          <div style={styles.grid2}>
            <div style={styles.field}>
              <label style={styles.label}>Nombre del cliente</label>
              <input
                type="text"
                name="nombreCliente"
                value={form.nombreCliente}
                onChange={handleChange}
                placeholder="Ej: Jorge Álvarez"
                style={styles.input}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Empresa (opcional)</label>
              <input
                type="text"
                name="empresa"
                value={form.empresa}
                onChange={handleChange}
                placeholder="Ej: S/N, Pyme X, etc."
                style={styles.input}
              />
            </div>
          </div>

          <div style={styles.grid2}>
            <div style={styles.field}>
              <label style={styles.label}>Dirección del cliente</label>
              <input
                type="text"
                name="direccionCliente"
                value={form.direccionCliente}
                onChange={handleChange}
                placeholder="Ej: Pasaje Uno, Sitio 5"
                style={styles.input}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Ciudad</label>
              <input
                type="text"
                name="ciudadCliente"
                value={form.ciudadCliente}
                onChange={handleChange}
                placeholder="Ej: Iquique / Alto Hospicio"
                style={styles.input}
              />
            </div>
          </div>
        </div>

        {/* Datos del proyecto */}
        <div style={styles.block}>
          <h3 style={styles.blockTitle}>Datos del proyecto</h3>

          <div style={styles.field}>
            <label style={styles.label}>Tipo de proyecto</label>
            <input
              type="text"
              name="tipoProyecto"
              value={form.tipoProyecto}
              onChange={handleChange}
              placeholder="Ej: Instalación de cámaras de seguridad para vivienda"
              style={styles.input}
            />
          </div>

          <div style={styles.grid3}>
            <div style={styles.field}>
              <label style={styles.label}>Nivel de calidad</label>
              <select
                name="nivelCalidad"
                value={form.nivelCalidad}
                onChange={handleChange}
                style={styles.select}
              >
                <option value="economico">Económico</option>
                <option value="estandar">Estándar</option>
                <option value="premium">Premium</option>
              </select>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Distancia estimada (km)</label>
              <input
                type="number"
                name="distanciaKm"
                value={form.distanciaKm}
                onChange={handleChange}
                placeholder="Ej: 20"
                style={styles.input}
                min={0}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>
                Presupuesto de referencia (opcional)
              </label>
              <input
                type="number"
                name="presupuestoReferencia"
                value={form.presupuestoReferencia}
                onChange={handleChange}
                placeholder="Ej: 300000"
                style={styles.input}
                min={0}
              />
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Descripción del proyecto</label>
            <textarea
              name="descripcionProyecto"
              value={form.descripcionProyecto}
              onChange={handleChange}
              rows={4}
              style={styles.textarea}
              placeholder="Ej: Casa de 2 pisos en Alto Hospicio, 6 cámaras 1080p con acceso remoto desde el celular, DVR, instalación completa y puesta en marcha..."
            />
          </div>

          {error && <p style={styles.errorText}>{error}</p>}
          {loadingData && (
            <p style={styles.infoText}>
              Cargando inventario para cotizar. Esto puede tardar unos segundos…
            </p>
          )}

          <button
            type="submit"
            style={styles.primaryButton}
            disabled={loadingPropuesta || loadingData}
          >
            {loadingPropuesta ? "Generando propuesta..." : "Generar propuesta con IA"}
          </button>
        </div>
      </form>

      {/* Resultado */}
      {propuesta && (
        <div style={styles.block}>
          <h3 style={styles.blockTitle}>Propuesta generada</h3>

          {/* Resumen del cliente / proyecto */}
          <div style={styles.projectSummary}>
            <div>
              <span style={styles.summaryLabel}>Cliente</span>
              <p style={styles.summaryValue}>
                {form.nombreCliente || "Sin nombre registrado"}
                {form.empresa ? ` · ${form.empresa}` : ""}
              </p>
            </div>
            <div>
              <span style={styles.summaryLabel}>Ubicación</span>
              <p style={styles.summaryValue}>
                {form.direccionCliente || "—"}
                {form.ciudadCliente ? ` · ${form.ciudadCliente}` : ""}
              </p>
            </div>
            <div>
              <span style={styles.summaryLabel}>Proyecto</span>
              <p style={styles.summaryValue}>
                {form.tipoProyecto || "Sin tipo de proyecto definido"}
              </p>
            </div>
          </div>

          {/* KPIs */}
          <div style={styles.kpiRow}>
            <div style={styles.kpiCard}>
              <span style={styles.kpiLabel}>Costo base estimado</span>
              <span style={styles.kpiValue}>
                ${propuesta.costoBase.toLocaleString("es-CL")}
              </span>
            </div>
            <div style={styles.kpiCard}>
              <span style={styles.kpiLabel}>Precio mínimo sugerido</span>
              <span style={styles.kpiValue}>
                ${propuesta.precioMin.toLocaleString("es-CL")}
              </span>
            </div>
            <div style={styles.kpiCard}>
              <span style={styles.kpiLabel}>Precio recomendado</span>
              <span
                style={{ ...styles.kpiValue, color: "#15803d" }}
              >
                ${propuesta.precioRecomendado.toLocaleString("es-CL")}
              </span>
            </div>
            <div style={styles.kpiCard}>
              <span style={styles.kpiLabel}>Precio máximo sugerido</span>
              <span style={styles.kpiValue}>
                ${propuesta.precioMax.toLocaleString("es-CL")}
              </span>
            </div>
            <div style={styles.kpiCard}>
              <span style={styles.kpiLabel}>Margen aprox.</span>
              <span style={styles.kpiValue}>
                {propuesta.margenAprox.toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Materiales */}
          <h4 style={styles.sectionTitle}>Materiales sugeridos</h4>
          {propuesta.materialesSeleccionados.length === 0 ? (
            <p style={styles.infoText}>
              No se encontraron materiales relevantes en el inventario para esta
              descripción.
            </p>
          ) : (
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Producto</th>
                    <th style={styles.th}>Categoría</th>
                    <th style={styles.th}>Unidad</th>
                    <th style={styles.th}>Cantidad</th>
                    <th style={styles.th}>Precio unit.</th>
                    <th style={styles.th}>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {propuesta.materialesSeleccionados.map((item) => (
                    <tr key={item.id}>
                      <td style={styles.td}>{item.nombre}</td>
                      <td style={styles.td}>{item.categoria || "-"}</td>
                      <td style={styles.td}>{item.unidad || "-"}</td>
                      <td style={styles.td}>{item.cantidad}</td>
                      <td style={styles.td}>
                        ${item.precioUnitario.toLocaleString("es-CL")}
                      </td>
                      <td style={styles.td}>
                        ${item.subtotal.toLocaleString("es-CL")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Mano de obra y transporte */}
          <h4 style={styles.sectionTitle}>Mano de obra y transporte</h4>
          <div style={styles.kpiRow}>
            <div style={styles.kpiCardSmall}>
              <span style={styles.kpiLabel}>Horas técnico</span>
              <span style={styles.kpiValue}>
                {propuesta.manoObra.horasTecnico} h
              </span>
            </div>
            <div style={styles.kpiCardSmall}>
              <span style={styles.kpiLabel}>Valor hora</span>
              <span style={styles.kpiValue}>
                $
                {propuesta.manoObra.valorHora.toLocaleString("es-CL")}
              </span>
            </div>
            <div style={styles.kpiCardSmall}>
              <span style={styles.kpiLabel}>Costo mano de obra</span>
              <span style={styles.kpiValue}>
                $
                {propuesta.manoObra.costoManoObra.toLocaleString("es-CL")}
              </span>
            </div>
            <div style={styles.kpiCardSmall}>
              <span style={styles.kpiLabel}>Transporte</span>
              <span style={styles.kpiValue}>
                $
                {propuesta.transporte.costoTransporte.toLocaleString(
                  "es-CL"
                )}
              </span>
            </div>
          </div>

          <p style={styles.footerText}>
            Estrategia utilizada:{" "}
            <strong>{propuesta.estrategia || "heurística_local"}</strong>
          </p>
        </div>
      )}
    </section>
  );
}

const styles = {
  card: {
    marginTop: "2rem",
    backgroundColor: "#F9FAFB",
    borderRadius: "12px",
    padding: "1.8rem 2.2rem",
    border: "1px solid #E5E7EB",
    color: "#111827",
  },
  title: {
    fontSize: "1.4rem",
    marginBottom: "0.25rem",
    fontWeight: 600,
  },
  subtitle: {
    fontSize: "0.9rem",
    color: "#6B7280",
    marginBottom: "1.2rem",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "1.5rem",
  },
  block: {
    backgroundColor: "#FFFFFF",
    borderRadius: "10px",
    padding: "1.25rem 1.5rem",
    border: "1px solid #E5E7EB",
  },
  blockTitle: {
    fontSize: "1rem",
    fontWeight: 600,
    marginBottom: "0.9rem",
    color: "#111827",
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "1rem",
    marginBottom: "0.75rem",
  },
  grid3: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "1rem",
    marginBottom: "0.75rem",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    marginBottom: "0.6rem",
  },
  label: {
    display: "block",
    fontSize: "0.85rem",
    marginBottom: "0.3rem",
    color: "#374151",
    fontWeight: 500,
  },
  input: {
    width: "100%",
    padding: "0.6rem 0.75rem",
    borderRadius: "8px",
    border: "1px solid #D1D5DB",
    backgroundColor: "#FFFFFF",
    color: "#111827",
    fontSize: "0.95rem",
  },
  select: {
    width: "100%",
    padding: "0.6rem 0.75rem",
    borderRadius: "8px",
    border: "1px solid #D1D5DB",
    backgroundColor: "#FFFFFF",
    color: "#111827",
    fontSize: "0.95rem",
  },
  textarea: {
    width: "100%",
    padding: "0.75rem",
    borderRadius: "8px",
    border: "1px solid #D1D5DB",
    backgroundColor: "#FFFFFF",
    color: "#111827",
    fontSize: "0.95rem",
    resize: "vertical",
  },
  primaryButton: {
    marginTop: "0.5rem",
    padding: "0.75rem 1.6rem",
    borderRadius: "999px",
    border: "none",
    cursor: "pointer",
    backgroundColor: "#10B981",
    color: "#FFFFFF",
    fontWeight: 600,
    fontSize: "0.95rem",
  },
  errorText: {
    color: "#B91C1C",
    fontSize: "0.9rem",
    marginTop: "0.25rem",
  },
  infoText: {
    color: "#6B7280",
    fontSize: "0.85rem",
    marginTop: "0.25rem",
  },
  projectSummary: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "1rem",
    marginBottom: "1.2rem",
  },
  summaryLabel: {
    fontSize: "0.75rem",
    textTransform: "uppercase",
    color: "#6B7280",
    fontWeight: 500,
  },
  summaryValue: {
    fontSize: "0.9rem",
    color: "#111827",
    marginTop: "0.15rem",
  },
  kpiRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "1rem",
    marginBottom: "1.5rem",
  },
  kpiCard: {
    flex: 1,
    minWidth: "160px",
    backgroundColor: "#F9FAFB",
    borderRadius: "10px",
    padding: "0.9rem 1rem",
    border: "1px solid #E5E7EB",
  },
  kpiCardSmall: {
    flex: 1,
    minWidth: "140px",
    backgroundColor: "#F9FAFB",
    borderRadius: "10px",
    padding: "0.8rem 0.9rem",
    border: "1px solid #E5E7EB",
  },
  kpiLabel: {
    fontSize: "0.8rem",
    color: "#6B7280",
  },
  kpiValue: {
    display: "block",
    marginTop: "0.35rem",
    fontSize: "1rem",
    fontWeight: 600,
  },
  sectionTitle: {
    fontSize: "1rem",
    marginBottom: "0.6rem",
    marginTop: "0.8rem",
    fontWeight: 600,
    color: "#111827",
  },
  tableWrapper: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.9rem",
  },
  th: {
    textAlign: "left",
    padding: "0.5rem 0.75rem",
    borderBottom: "1px solid #E5E7EB",
    backgroundColor: "#F9FAFB",
    fontSize: "0.8rem",
    textTransform: "uppercase",
    color: "#6B7280",
  },
  td: {
    padding: "0.5rem 0.75rem",
    borderBottom: "1px solid #E5E7EB",
  },
  footerText: {
    marginTop: "0.75rem",
    fontSize: "0.8rem",
    color: "#6B7280",
  },
};

export default Cotizador;
