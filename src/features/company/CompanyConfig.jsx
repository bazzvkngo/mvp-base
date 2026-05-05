import React, { useEffect, useState } from "react";
import {
  getCompanyConfig,
  saveCompanyConfig,
} from "../../services/companyService";

function CompanyConfig({ userId }) {
  const [form, setForm] = useState({
    rubroPrincipal: "",
    rubroOtro: "",
    tipoOperacion: "mixto",
    valorHoraBase: "",
    margenEcon: 15,
    margenStd: 25,
    margenPremium: 35,
  });
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensajeOk, setMensajeOk] = useState("");
  const [mostrarMargenesAvanzados, setMostrarMargenesAvanzados] =
    useState(false);

  useEffect(() => {
    if (!userId) return;

    setCargando(true);
    setError("");
    setMensajeOk("");

    getCompanyConfig(userId)
      .then((cfg) => {
        setForm((prev) => ({
          ...prev,
          rubroPrincipal: cfg.rubroPrincipal || "",
          rubroOtro: cfg.rubroOtro || "",
          tipoOperacion: cfg.tipoOperacion || "mixto",
          valorHoraBase:
            cfg.valorHoraBase !== undefined && cfg.valorHoraBase !== null
              ? String(cfg.valorHoraBase)
              : "",
          margenEcon:
            cfg.margenEcon !== undefined && cfg.margenEcon !== null
              ? Math.round(cfg.margenEcon * 100)
              : 15,
          margenStd:
            cfg.margenStd !== undefined && cfg.margenStd !== null
              ? Math.round(cfg.margenStd * 100)
              : 25,
          margenPremium:
            cfg.margenPremium !== undefined && cfg.margenPremium !== null
              ? Math.round(cfg.margenPremium * 100)
              : 35,
        }));
      })
      .catch((err) => {
        console.error("Error cargando configuración del negocio:", err);
        setError("No se pudo cargar la configuración del negocio.");
      })
      .finally(() => setCargando(false));
  }, [userId]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSeleccionTipoOperacion = (tipo) => {
    setForm((prev) => ({
      ...prev,
      tipoOperacion: tipo,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!userId) return;

    setGuardando(true);
    setError("");
    setMensajeOk("");

    try {
      const rubroFinal =
        form.rubroPrincipal === "Otro / mixto" && form.rubroOtro
          ? form.rubroOtro
          : form.rubroPrincipal;

      await saveCompanyConfig(userId, {
        rubroPrincipal: rubroFinal,
        rubroOtro: form.rubroPrincipal === "Otro / mixto" ? form.rubroOtro : "",
        tipoOperacion: form.tipoOperacion,
        valorHoraBase: Number(form.valorHoraBase) || 0,
        margenEcon: (Number(form.margenEcon) || 0) / 100,
        margenStd: (Number(form.margenStd) || 0) / 100,
        margenPremium: (Number(form.margenPremium) || 0) / 100,
      });

      setMensajeOk("Configuración guardada correctamente.");
    } catch (err) {
      console.error("Error guardando configuración del negocio:", err);
      setError("Ocurrió un error al guardar la configuración.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <section style={styles.card}>
      <h2 style={styles.title}>Configuración del negocio</h2>
      <p style={styles.subtitle}>
        Define los parámetros base que usará ValoraCloud al sugerir precios en
        tus cotizaciones.
      </p>

      {cargando && (
        <p style={styles.infoText}>Cargando configuración del negocio...</p>
      )}
      {error && <p style={styles.errorText}>{error}</p>}
      {mensajeOk && <p style={styles.successText}>{mensajeOk}</p>}

      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.block}>
          <h3 style={styles.blockTitle}>Perfil del negocio</h3>

          <div style={styles.field}>
            <label style={styles.label}>Rubro principal de tu empresa</label>
            <select
              name="rubroPrincipal"
              value={form.rubroPrincipal}
              onChange={handleChange}
              style={styles.select}
            >
              <option value="">Selecciona una opción</option>
              <option value="Servicios TI, soporte e instalaciones">
                Servicios TI, soporte e instalaciones
              </option>
              <option value="Electricidad, CCTV e instalaciones en terreno">
                Electricidad, CCTV e instalaciones en terreno
              </option>
              <option value="Ferretería / venta de materiales">
                Ferretería / venta de materiales
              </option>
              <option value="Otro / mixto">Otro / mixto</option>
            </select>
            <p style={styles.helpText}>
              Este dato entrega contexto para márgenes y reportes. No limita
              los proyectos que puedes cotizar.
            </p>
          </div>

          {form.rubroPrincipal === "Otro / mixto" && (
            <div style={styles.field}>
              <label style={styles.label}>Describe tu rubro</label>
              <input
                type="text"
                name="rubroOtro"
                value={form.rubroOtro}
                onChange={handleChange}
                placeholder="Ej: construcción, audiovisuales, mantención industrial"
                style={styles.input}
              />
            </div>
          )}

          <div style={styles.field}>
            <label style={styles.label}>¿Qué vendes principalmente?</label>
            <div style={styles.tipoOperacionRow}>
              {[
                { value: "productos", label: "Solo productos" },
                { value: "servicios", label: "Solo servicios" },
                { value: "mixto", label: "Productos y servicios" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSeleccionTipoOperacion(opt.value)}
                  style={{
                    ...styles.tipoChip,
                    ...(form.tipoOperacion === opt.value
                      ? styles.tipoChipActive
                      : {}),
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={styles.block}>
          <h3 style={styles.blockTitle}>Tarifa de mano de obra</h3>
          <div style={styles.row}>
            <div style={styles.column}>
              <label style={styles.label}>
                Valor hora de trabajo en terreno (CLP)
              </label>
              <input
                type="number"
                name="valorHoraBase"
                min={0}
                value={form.valorHoraBase}
                onChange={handleChange}
                placeholder="Ej: 10000"
                style={styles.input}
              />
            </div>
            <div style={styles.column}>
              <p style={styles.helpText}>
                Este valor se usa para estimar mano de obra en instalación,
                soporte en terreno u otras actividades.
              </p>
            </div>
          </div>
        </div>

        <div style={styles.block}>
          <div style={styles.margenesHeader}>
            <h3 style={styles.blockTitle}>Estrategia de márgenes</h3>
            <button
              type="button"
              onClick={() => setMostrarMargenesAvanzados((prev) => !prev)}
              style={styles.linkButton}
            >
              {mostrarMargenesAvanzados
                ? "Ocultar configuración avanzada"
                : "Mostrar configuración avanzada"}
            </button>
          </div>

          <p style={styles.helpText}>
            Estos porcentajes se aplican sobre costo base, mano de obra y
            transporte para sugerir precios mínimos, recomendados y máximos.
          </p>

          {mostrarMargenesAvanzados && (
            <div style={styles.row}>
              <div style={styles.column}>
                <label style={styles.label}>Margen económico (%)</label>
                <input
                  type="number"
                  name="margenEcon"
                  min={0}
                  value={form.margenEcon}
                  onChange={handleChange}
                  style={styles.input}
                />
              </div>
              <div style={styles.column}>
                <label style={styles.label}>Margen estándar (%)</label>
                <input
                  type="number"
                  name="margenStd"
                  min={0}
                  value={form.margenStd}
                  onChange={handleChange}
                  style={styles.input}
                />
              </div>
              <div style={styles.column}>
                <label style={styles.label}>Margen premium (%)</label>
                <input
                  type="number"
                  name="margenPremium"
                  min={0}
                  value={form.margenPremium}
                  onChange={handleChange}
                  style={styles.input}
                />
              </div>
            </div>
          )}
        </div>

        <button type="submit" style={styles.primaryButton} disabled={guardando}>
          {guardando ? "Guardando..." : "Guardar configuración"}
        </button>
      </form>
    </section>
  );
}

const styles = {
  card: {
    marginTop: "2rem",
    backgroundColor: "#F9FAFB",
    borderRadius: "8px",
    padding: "1.8rem 2.2rem",
    border: "1px solid #E5E7EB",
    color: "#111827",
    maxWidth: "900px",
  },
  title: {
    fontSize: "1.4rem",
    marginBottom: "0.25rem",
    fontWeight: 700,
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
    borderRadius: "8px",
    padding: "1.25rem 1.5rem",
    border: "1px solid #E5E7EB",
  },
  blockTitle: {
    fontSize: "1rem",
    fontWeight: 700,
    marginBottom: "0.75rem",
    color: "#111827",
  },
  field: {
    marginBottom: "0.9rem",
  },
  label: {
    display: "block",
    fontSize: "0.85rem",
    marginBottom: "0.3rem",
    color: "#374151",
    fontWeight: 600,
  },
  input: {
    width: "100%",
    padding: "0.6rem 0.75rem",
    borderRadius: "6px",
    border: "1px solid #D1D5DB",
    backgroundColor: "#FFFFFF",
    color: "#111827",
    fontSize: "0.95rem",
  },
  select: {
    width: "100%",
    padding: "0.6rem 0.75rem",
    borderRadius: "6px",
    border: "1px solid #D1D5DB",
    backgroundColor: "#FFFFFF",
    color: "#111827",
    fontSize: "0.95rem",
  },
  helpText: {
    marginTop: "0.3rem",
    fontSize: "0.82rem",
    color: "#6B7280",
    lineHeight: 1.5,
  },
  row: {
    display: "flex",
    gap: "1rem",
    flexWrap: "wrap",
    alignItems: "flex-start",
  },
  column: {
    flex: 1,
    minWidth: "200px",
  },
  tipoOperacionRow: {
    display: "flex",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  tipoChip: {
    padding: "0.45rem 0.9rem",
    borderRadius: "999px",
    border: "1px solid #D1D5DB",
    backgroundColor: "#FFFFFF",
    color: "#374151",
    fontSize: "0.85rem",
    cursor: "pointer",
  },
  tipoChipActive: {
    borderColor: "#10B981",
    backgroundColor: "#ECFDF5",
    color: "#047857",
  },
  margenesHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "0.4rem",
    gap: "1rem",
  },
  linkButton: {
    border: "none",
    background: "none",
    color: "#059669",
    fontSize: "0.85rem",
    cursor: "pointer",
    padding: 0,
  },
  primaryButton: {
    alignSelf: "flex-start",
    marginTop: "0.5rem",
    padding: "0.7rem 1.6rem",
    borderRadius: "6px",
    border: "none",
    cursor: "pointer",
    backgroundColor: "#10B981",
    color: "#FFFFFF",
    fontWeight: 700,
    fontSize: "0.95rem",
  },
  errorText: {
    color: "#B91C1C",
    fontSize: "0.85rem",
    marginBottom: "0.5rem",
  },
  successText: {
    color: "#047857",
    fontSize: "0.85rem",
    marginBottom: "0.5rem",
  },
  infoText: {
    color: "#6B7280",
    fontSize: "0.85rem",
    marginBottom: "0.5rem",
  },
};

export default CompanyConfig;
