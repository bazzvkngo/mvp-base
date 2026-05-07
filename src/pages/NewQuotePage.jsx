import React, { useEffect, useMemo, useState } from "react";
import {
  calculateQuoteTotals,
  createQuoteItemFromValuation,
  normalizeQuoteItems,
} from "../domain/quoteItemFactory";
import { PRICING_STATUS } from "../domain/pricing";
import { suggestQuoteItems } from "../services/aiQuoteService";
import { getCompanyConfig } from "../services/companyService";
import {
  createQuote,
  generateQuoteNumber,
  updateQuote,
} from "../services/quoteService";
import { subscribeToValuations } from "../services/valuationService";
import { formatCLP } from "../utils/formatters";

const today = () => new Date().toISOString().slice(0, 10);

const estadoLabels = {
  borrador: "Borrador",
  emitida: "Emitida",
};

const tipoLabels = {
  producto: "Producto",
  servicio: "Servicio",
  actividad: "Actividad",
};

const statusStyles = {
  [PRICING_STATUS.SIN_REFERENCIAS]: {
    background: "#f1f5f9",
    color: "#475569",
  },
  [PRICING_STATUS.BAJO_MERCADO]: {
    background: "#dbeafe",
    color: "#1d4ed8",
  },
  [PRICING_STATUS.DENTRO_DE_RANGO]: {
    background: "#dcfce7",
    color: "#166534",
  },
  [PRICING_STATUS.SOBRE_MERCADO]: {
    background: "#fee2e2",
    color: "#991b1b",
  },
};

function buildInitialQuote() {
  return {
    numero: generateQuoteNumber(),
    fecha: today(),
    clienteNombre: "",
    clienteRut: "",
    clienteEmail: "",
    clienteTelefono: "",
    clienteDireccion: "",
    condicionesPago: "Pago contra entrega",
    estado: "borrador",
    items: [],
    descuento: 0,
    observaciones: "",
  };
}

function NewQuotePage({ userId }) {
  const [quote, setQuote] = useState(() => buildInitialQuote());
  const [valuations, setValuations] = useState([]);
  const [companyConfig, setCompanyConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [savedQuoteId, setSavedQuoteId] = useState(null);
  const [assistantDescription, setAssistantDescription] = useState("");
  const [assistantSuggestions, setAssistantSuggestions] = useState([]);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState("");
  const [assistantSource, setAssistantSource] = useState("");
  const [assistantWarning, setAssistantWarning] = useState("");

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError("");

    const unsubscribe = subscribeToValuations(
      userId,
      (items) => {
        setValuations(items);
        setLoading(false);
      },
      (err) => {
        console.error("Error al cargar ítems valorizados:", err);
        setError("No se pudieron cargar los ítems valorizados.");
        setLoading(false);
      }
    );

    getCompanyConfig(userId)
      .then((config) => setCompanyConfig(config))
      .catch((err) => {
        console.error("Error al cargar configuracion de empresa:", err);
      });

    return () => unsubscribe();
  }, [userId]);

  const normalizedItems = useMemo(
    () => normalizeQuoteItems(quote.items),
    [quote.items]
  );

  const totals = useMemo(
    () => calculateQuoteTotals(normalizedItems, quote.descuento),
    [normalizedItems, quote.descuento]
  );

  const filteredValuations = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return valuations;

    return valuations.filter((valuation) => {
      const text = `${valuation.nombre || ""} ${valuation.categoria || ""}`.toLowerCase();
      return text.includes(query);
    });
  }, [search, valuations]);

  const updateField = (field, value) => {
    setQuote((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const addItem = (valuation, quantity = 1) => {
    setSuccess("");
    setError("");
    setQuote((prev) => {
      const existing = prev.items.find((item) => item.itemId === valuation.itemId);
      if (existing) {
        return {
          ...prev,
          items: normalizeQuoteItems(
            prev.items.map((item) =>
              item.itemId === valuation.itemId
                ? { ...item, cantidad: Number(item.cantidad || 0) + quantity }
                : item
            )
          ),
        };
      }

      return {
        ...prev,
        items: normalizeQuoteItems([
          ...prev.items,
          {
            ...createQuoteItemFromValuation(valuation),
            cantidad: quantity,
          },
        ]),
      };
    });
  };

  const getMatchedValuation = (suggestion) =>
    valuations.find((valuation) => valuation.itemId === suggestion.inventarioMatchId);

  const requestAssistantSuggestions = async () => {
    setAssistantError("");
    setAssistantSuggestions([]);
    setAssistantSource("");
    setAssistantWarning("");

    try {
      setAssistantLoading(true);
      const result = await suggestQuoteItems({
        description: assistantDescription,
        valuations,
      });
      const suggestions = result.suggestions || [];
      setAssistantSuggestions(suggestions);
      setAssistantSource(result.source || "");
      setAssistantWarning(result.warning || "");
      if (suggestions.length === 0) {
        setAssistantError("No se generaron sugerencias para esta descripción.");
      }
    } catch (err) {
      console.error("Error al sugerir ítems de cotización:", err);
      setAssistantError(
        err.message || "No se pudieron generar sugerencias en este momento."
      );
    } finally {
      setAssistantLoading(false);
    }
  };

  const addSuggestionToQuote = (suggestion) => {
    const matchedValuation = getMatchedValuation(suggestion);
    if (!matchedValuation) return;
    addItem(matchedValuation, Number(suggestion.cantidadSugerida) || 1);
  };

  const updateItem = (itemId, field, value) => {
    setQuote((prev) => ({
      ...prev,
      items: normalizeQuoteItems(
        prev.items.map((item) =>
          item.itemId === itemId ? { ...item, [field]: value } : item
        )
      ),
    }));
  };

  const removeItem = (itemId) => {
    setQuote((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.itemId !== itemId),
    }));
  };

  const clearQuote = () => {
    setQuote(buildInitialQuote());
    setSavedQuoteId(null);
    setError("");
    setSuccess("");
  };

  const validateQuote = () => {
    if (!quote.clienteNombre.trim()) {
      return "Ingresa el nombre del cliente antes de guardar.";
    }
    if (normalizedItems.length === 0) {
      return "Agrega al menos un ítem valorizado a la cotización.";
    }
    return "";
  };

  const saveQuote = async (estado) => {
    const validationError = validateQuote();
    if (validationError) {
      setError(validationError);
      setSuccess("");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        ...quote,
        estado,
        items: normalizedItems,
        subtotal: totals.subtotal,
        descuento: totals.descuento,
        total: totals.total,
      };
      const saved = savedQuoteId
        ? await updateQuote(userId, savedQuoteId, payload)
        : await createQuote(userId, payload);
      if (!savedQuoteId) {
        setSavedQuoteId(saved.id);
      }
      setQuote((prev) => ({
        ...prev,
        estado,
      }));
      setSuccess(`Cotización ${saved.numero} guardada como ${estadoLabels[estado].toLowerCase()}.`);
    } catch (err) {
      console.error("Error al guardar cotización:", err);
      setError(err.message || "No se pudo guardar la cotización.");
    } finally {
      setSaving(false);
    }
  };

  if (!userId) {
    return (
      <section className="page-section">
        <p style={styles.errorText}>Debes iniciar sesión para crear cotizaciones.</p>
      </section>
    );
  }

  return (
    <section className="quote-page" style={styles.wrapper}>
      <div className="no-print" style={styles.header}>
        <div>
          <span className="eyebrow">Cotizaciones</span>
          <h2 style={styles.title}>Nueva cotización formal</h2>
          <p style={styles.subtitle}>
            Arma una cotización editable desde ítems valorizados, ajusta precios
            y guarda el documento en Firestore.
          </p>
        </div>
      </div>

      <div className="no-print" style={styles.grid}>
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Datos de la cotización</h3>
          <div style={styles.formGrid}>
            <Field label="Fecha">
              <input
                type="date"
                value={quote.fecha}
                onChange={(event) => updateField("fecha", event.target.value)}
                style={styles.input}
              />
            </Field>
            <Field label="Numero">
              <input
                type="text"
                value={quote.numero}
                onChange={(event) => updateField("numero", event.target.value)}
                style={styles.input}
              />
            </Field>
            <Field label="Condiciones de pago">
              <input
                type="text"
                value={quote.condicionesPago}
                onChange={(event) =>
                  updateField("condicionesPago", event.target.value)
                }
                style={styles.input}
              />
            </Field>
            <Field label="Estado">
              <select
                value={quote.estado}
                onChange={(event) => updateField("estado", event.target.value)}
                style={styles.input}
              >
                <option value="borrador">Borrador</option>
                <option value="emitida">Emitida</option>
              </select>
            </Field>
          </div>
        </div>

        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Datos del cliente</h3>
          <div style={styles.formGrid}>
            <Field label="Nombre cliente">
              <input
                type="text"
                value={quote.clienteNombre}
                onChange={(event) =>
                  updateField("clienteNombre", event.target.value)
                }
                placeholder="Ej: Maria Gonzalez"
                style={styles.input}
              />
            </Field>
            <Field label="RUT/DNI opcional">
              <input
                type="text"
                value={quote.clienteRut}
                onChange={(event) => updateField("clienteRut", event.target.value)}
                style={styles.input}
              />
            </Field>
            <Field label="Email opcional">
              <input
                type="email"
                value={quote.clienteEmail}
                onChange={(event) =>
                  updateField("clienteEmail", event.target.value)
                }
                style={styles.input}
              />
            </Field>
            <Field label="Telefono opcional">
              <input
                type="text"
                value={quote.clienteTelefono}
                onChange={(event) =>
                  updateField("clienteTelefono", event.target.value)
                }
                style={styles.input}
              />
            </Field>
            <Field label="Direccion opcional" wide>
              <input
                type="text"
                value={quote.clienteDireccion}
                onChange={(event) =>
                  updateField("clienteDireccion", event.target.value)
                }
                style={styles.input}
              />
            </Field>
          </div>
        </div>
      </div>

      {error && <p className="no-print" style={styles.errorText}>{error}</p>}
      {success && <p className="no-print" style={styles.successText}>{success}</p>}

      <div className="no-print" style={styles.panel}>
        <div style={styles.sectionHeader}>
          <div>
            <h3 style={styles.panelTitle}>Asistente de estructura</h3>
            <p style={styles.helpText}>
              Describe brevemente el trabajo o servicio que necesitas cotizar.
              ValoraCloud sugerirá posibles ítems, pero tú decides qué agregar
              y el sistema mantendrá el cálculo de precios basado en inventario,
              referencias y valorización.
            </p>
          </div>
        </div>

        <textarea
          value={assistantDescription}
          onChange={(event) => setAssistantDescription(event.target.value)}
          rows={4}
          maxLength={1200}
          placeholder="Ej: Necesito cotizar instalación de 4 cámaras en terreno de 40 x 40 metros"
          style={styles.textarea}
        />
        <div style={styles.assistantActions}>
          <button
            type="button"
            onClick={requestAssistantSuggestions}
            disabled={assistantLoading}
            style={styles.primaryButton}
          >
            {assistantLoading ? "Sugiriendo..." : "Sugerir ítems"}
          </button>
          <span style={styles.assistantNote}>
            No calcula precios ni crea cotizaciones automáticamente.
          </span>
        </div>

        {assistantError && <p style={styles.errorText}>{assistantError}</p>}
        {assistantSource && (
          <p style={styles.infoText}>
            {assistantSource === "gemini"
              ? "Sugerencias generadas con IA generativa."
              : "Sugerencias generadas con asistente local."}
          </p>
        )}
        {assistantWarning && (
          <p style={styles.warningText}>{assistantWarning}</p>
        )}

        {assistantSuggestions.length > 0 && (
          <div style={styles.suggestionGrid}>
            {assistantSuggestions.map((suggestion, index) => {
              const matchedValuation = getMatchedValuation(suggestion);
              return (
                <article
                  key={`${suggestion.nombre}-${index}`}
                  style={styles.suggestionCard}
                >
                  <div>
                    <strong>{suggestion.nombre}</strong>
                    <span style={styles.itemMeta}>
                      {tipoLabels[suggestion.tipoItem] || suggestion.tipoItem} ·
                      cantidad sugerida: {suggestion.cantidadSugerida}
                    </span>
                  </div>
                  <p style={styles.suggestionReason}>{suggestion.motivo}</p>
                  <span
                    style={{
                      ...styles.matchBadge,
                      ...(matchedValuation
                        ? styles.matchBadgeFound
                        : styles.matchBadgeMissing),
                    }}
                  >
                    {matchedValuation
                      ? `Coincide con inventario: ${matchedValuation.nombre}`
                      : "No encontrado en inventario"}
                  </span>
                  {matchedValuation && (
                    <button
                      type="button"
                      onClick={() => addSuggestionToQuote(suggestion)}
                      style={styles.secondaryButton}
                    >
                      Agregar item valorizado
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="no-print" style={styles.panel}>
        <div style={styles.sectionHeader}>
          <div>
            <h3 style={styles.panelTitle}>Ítems valorizados</h3>
            <p style={styles.helpText}>
              Solo se muestran ítems activos del inventario. El precio inicial
              corresponde al precio sugerido.
            </p>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre o categoría"
            style={styles.searchInput}
          />
        </div>

        {loading ? (
          <p style={styles.emptyText}>Cargando ítems valorizados...</p>
        ) : valuations.length === 0 ? (
          <div style={styles.emptyState}>
            <h3 style={styles.emptyTitle}>No hay inventario activo valorizado</h3>
            <p style={styles.emptyText}>
              Agrega ítems activos al inventario para comenzar una cotización.
            </p>
          </div>
        ) : filteredValuations.length === 0 ? (
          <p style={styles.emptyText}>No hay resultados para esa busqueda.</p>
        ) : (
          <div style={styles.valuationGrid}>
            {filteredValuations.map((valuation) => (
              <div key={valuation.itemId} style={styles.valuationCard}>
                <div>
                  <strong>{valuation.nombre}</strong>
                  <span style={styles.itemMeta}>
                    {valuation.categoria || "Sin categoría"} ·{" "}
                    {tipoLabels[valuation.tipoItem] || valuation.tipoItem || "-"}
                  </span>
                </div>
                <div style={styles.valuationFooter}>
                  <div>
                    <span style={styles.miniLabel}>Precio sugerido</span>
                    <strong>{formatCLP(valuation.precioSugerido)}</strong>
                  </div>
                  <span
                    style={{
                      ...styles.statusBadge,
                      ...statusStyles[valuation.estadoValorizacion],
                    }}
                  >
                    {valuation.estadoValorizacion}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => addItem(valuation)}
                  style={styles.secondaryButton}
                >
                  Agregar a cotización
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="no-print" style={styles.panel}>
        <h3 style={styles.panelTitle}>Ítems agregados</h3>
        {normalizedItems.length === 0 ? (
          <p style={styles.emptyText}>Todavía no hay ítems en la cotización.</p>
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Nombre</th>
                  <th style={styles.th}>Tipo</th>
                  <th style={styles.th}>Cantidad</th>
                  <th style={styles.th}>Precio sugerido</th>
                  <th style={styles.th}>Precio unitario</th>
                  <th style={styles.th}>Total linea</th>
                  <th style={styles.th}>Quitar</th>
                </tr>
              </thead>
              <tbody>
                {normalizedItems.map((item) => (
                  <tr key={item.itemId}>
                    <td style={styles.td}>
                      <strong>{item.nombre}</strong>
                      <span style={styles.itemMeta}>{item.unidad || "-"}</span>
                    </td>
                    <td style={styles.td}>
                      {tipoLabels[item.tipoItem] || item.tipoItem || "-"}
                    </td>
                    <td style={styles.td}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.cantidad}
                        onChange={(event) =>
                          updateItem(item.itemId, "cantidad", event.target.value)
                        }
                        style={styles.numberInput}
                      />
                    </td>
                    <td style={styles.td}>{formatCLP(item.precioSugerido)}</td>
                    <td style={styles.td}>
                      <input
                        type="number"
                        min="0"
                        value={item.precioUnitarioEditable}
                        onChange={(event) =>
                          updateItem(
                            item.itemId,
                            "precioUnitarioEditable",
                            event.target.value
                          )
                        }
                        style={styles.moneyInput}
                      />
                    </td>
                    <td style={styles.td}>
                      <strong>{formatCLP(item.totalLinea)}</strong>
                    </td>
                    <td style={styles.td}>
                      <button
                        type="button"
                        onClick={() => removeItem(item.itemId)}
                        style={styles.removeButton}
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="quote-bottom-grid no-print" style={styles.bottomGrid}>
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Observaciones</h3>
          <textarea
            value={quote.observaciones}
            onChange={(event) => updateField("observaciones", event.target.value)}
            rows={5}
            placeholder="Notas publicas para el cliente"
            style={styles.textarea}
          />
        </div>

        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Totales</h3>
          <TotalRow label="Subtotal" value={formatCLP(totals.subtotal)} />
          <div style={styles.discountRow}>
            <label style={styles.totalLabel}>Descuento</label>
            <input
              type="number"
              min="0"
              value={quote.descuento}
              onChange={(event) => updateField("descuento", event.target.value)}
              style={styles.discountInput}
            />
          </div>
          <TotalRow label="Total" value={formatCLP(totals.total)} strong />

          <div style={styles.actions}>
            <button
              type="button"
              onClick={() => saveQuote("borrador")}
              disabled={saving}
              style={styles.primaryButton}
            >
              {saving ? "Guardando..." : "Guardar borrador"}
            </button>
            <button
              type="button"
              onClick={() => saveQuote("emitida")}
              disabled={saving}
              style={styles.emitButton}
            >
              Guardar como emitida
            </button>
            <button type="button" onClick={clearQuote} style={styles.clearButton}>
              Limpiar cotización
            </button>
          </div>
        </div>
      </div>

      <QuotePreview
        quote={{ ...quote, items: normalizedItems, ...totals }}
        companyConfig={companyConfig}
      />
    </section>
  );
}

function Field({ label, wide = false, children }) {
  return (
    <label style={{ ...styles.field, ...(wide ? styles.wideField : {}) }}>
      <span style={styles.label}>{label}</span>
      {children}
    </label>
  );
}

function TotalRow({ label, value, strong = false }) {
  return (
    <div style={styles.totalRow}>
      <span style={strong ? styles.totalLabelStrong : styles.totalLabel}>
        {label}
      </span>
      <strong style={strong ? styles.totalValueStrong : styles.totalValue}>
        {value}
      </strong>
    </div>
  );
}

function QuotePreview({ quote, companyConfig }) {
  const rubro =
    companyConfig?.rubroOtro ||
    companyConfig?.rubroPrincipal ||
    "Valorización y cotizaciones";

  return (
    <div style={styles.previewPanel}>
      <div className="no-print" style={styles.previewActions}>
        <h3 style={styles.panelTitle}>Vista formal imprimible</h3>
        <button type="button" onClick={() => window.print()} style={styles.printButton}>
          Imprimir cotización
        </button>
      </div>

      <article className="quote-print" style={styles.printSheet}>
        <header style={styles.printHeader}>
          <div>
            <h2 style={styles.printBrand}>ValoraCloud</h2>
            <p style={styles.printMuted}>{rubro}</p>
          </div>
          <div style={styles.printMeta}>
            <strong>Cotización {quote.numero}</strong>
            <span>Fecha: {quote.fecha || "-"}</span>
            <span>Estado: {estadoLabels[quote.estado] || quote.estado}</span>
          </div>
        </header>

        <section style={styles.clientBox}>
          <h3 style={styles.printSectionTitle}>Cliente</h3>
          <p style={styles.printLine}><strong>{quote.clienteNombre || "Sin cliente"}</strong></p>
          <p style={styles.printLine}>RUT/DNI: {quote.clienteRut || "-"}</p>
          <p style={styles.printLine}>Email: {quote.clienteEmail || "-"}</p>
          <p style={styles.printLine}>Telefono: {quote.clienteTelefono || "-"}</p>
          <p style={styles.printLine}>Direccion: {quote.clienteDireccion || "-"}</p>
          <p style={styles.printLine}>Condiciones: {quote.condicionesPago || "-"}</p>
        </section>

        <table style={styles.printTable}>
          <thead>
            <tr>
              <th style={styles.printTh}>Ítem</th>
              <th style={styles.printTh}>Cant.</th>
              <th style={styles.printTh}>Precio unit.</th>
              <th style={styles.printTh}>Total</th>
            </tr>
          </thead>
          <tbody>
            {quote.items.length === 0 ? (
              <tr>
                <td colSpan={4} style={styles.printTd}>Sin ítems agregados.</td>
              </tr>
            ) : (
              quote.items.map((item) => (
                <tr key={item.itemId}>
                  <td style={styles.printTd}>
                    <strong>{item.nombre}</strong>
                    <span style={styles.printItemMeta}>
                      {item.descripcion || item.categoria || ""}
                    </span>
                  </td>
                  <td style={styles.printTd}>{item.cantidad}</td>
                  <td style={styles.printTd}>{formatCLP(item.precioUnitarioEditable)}</td>
                  <td style={styles.printTd}>{formatCLP(item.totalLinea)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div style={styles.printTotals}>
          <TotalRow label="Subtotal" value={formatCLP(quote.subtotal)} />
          <TotalRow label="Descuento" value={formatCLP(quote.descuento)} />
          <TotalRow label="Total" value={formatCLP(quote.total)} strong />
        </div>

        {quote.observaciones && (
          <section style={styles.observationsBox}>
            <h3 style={styles.printSectionTitle}>Observaciones</h3>
            <p style={styles.printLine}>{quote.observaciones}</p>
          </section>
        )}
      </article>
    </div>
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
  title: {
    margin: "4px 0 6px",
    fontSize: "24px",
  },
  subtitle: {
    margin: 0,
    color: "#64748b",
    lineHeight: 1.5,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "16px",
  },
  bottomGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 360px",
    gap: "16px",
  },
  panel: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    padding: "18px",
  },
  panelTitle: {
    margin: "0 0 12px",
    fontSize: "17px",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "12px",
  },
  field: {
    display: "grid",
    gap: "6px",
  },
  wideField: {
    gridColumn: "1 / -1",
  },
  label: {
    color: "#475569",
    fontSize: "13px",
    fontWeight: 700,
  },
  input: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "10px 11px",
    width: "100%",
  },
  textarea: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    minHeight: "130px",
    padding: "11px",
    resize: "vertical",
    width: "100%",
  },
  sectionHeader: {
    alignItems: "flex-start",
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    justifyContent: "space-between",
    marginBottom: "14px",
  },
  helpText: {
    color: "#64748b",
    margin: "-6px 0 0",
    fontSize: "14px",
  },
  searchInput: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    minWidth: "260px",
    padding: "10px 11px",
  },
  valuationGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "12px",
  },
  valuationCard: {
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    display: "grid",
    gap: "12px",
    padding: "14px",
  },
  valuationFooter: {
    alignItems: "center",
    display: "flex",
    gap: "10px",
    justifyContent: "space-between",
  },
  miniLabel: {
    color: "#64748b",
    display: "block",
    fontSize: "12px",
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
    whiteSpace: "nowrap",
  },
  tableWrapper: {
    overflowX: "auto",
  },
  table: {
    borderCollapse: "collapse",
    width: "100%",
  },
  th: {
    background: "#f8fafc",
    borderBottom: "1px solid #e5e7eb",
    color: "#64748b",
    fontSize: "12px",
    padding: "10px",
    textAlign: "left",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  td: {
    borderBottom: "1px solid #eef2f7",
    fontSize: "14px",
    padding: "10px",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
  },
  numberInput: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "8px",
    width: "92px",
  },
  moneyInput: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "8px",
    width: "130px",
  },
  discountRow: {
    alignItems: "center",
    borderBottom: "1px solid #eef2f7",
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    padding: "11px 0",
  },
  discountInput: {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "8px",
    textAlign: "right",
    width: "150px",
  },
  totalRow: {
    alignItems: "center",
    borderBottom: "1px solid #eef2f7",
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    padding: "11px 0",
  },
  totalLabel: {
    color: "#475569",
    fontWeight: 700,
  },
  totalLabelStrong: {
    color: "#111827",
    fontSize: "18px",
    fontWeight: 800,
  },
  totalValue: {
    color: "#111827",
  },
  totalValueStrong: {
    color: "#0f766e",
    fontSize: "22px",
  },
  actions: {
    display: "grid",
    gap: "9px",
    marginTop: "16px",
  },
  assistantActions: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    marginTop: "12px",
  },
  assistantNote: {
    color: "#64748b",
    fontSize: "13px",
  },
  suggestionGrid: {
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    marginTop: "14px",
  },
  suggestionCard: {
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    display: "grid",
    gap: "10px",
    padding: "14px",
  },
  suggestionReason: {
    color: "#475569",
    fontSize: "13px",
    lineHeight: 1.45,
    margin: 0,
  },
  matchBadge: {
    borderRadius: "999px",
    display: "inline-block",
    fontSize: "12px",
    fontWeight: 800,
    padding: "5px 9px",
    width: "fit-content",
  },
  matchBadgeFound: {
    background: "#dcfce7",
    color: "#166534",
  },
  matchBadgeMissing: {
    background: "#f1f5f9",
    color: "#475569",
  },
  primaryButton: {
    background: "#0f766e",
    border: 0,
    borderRadius: "6px",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 800,
    padding: "11px 14px",
  },
  emitButton: {
    background: "#111827",
    border: 0,
    borderRadius: "6px",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 800,
    padding: "11px 14px",
  },
  secondaryButton: {
    background: "#ffffff",
    border: "1px solid #0f766e",
    borderRadius: "6px",
    color: "#0f766e",
    cursor: "pointer",
    fontWeight: 800,
    padding: "9px 11px",
  },
  clearButton: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    color: "#334155",
    cursor: "pointer",
    fontWeight: 800,
    padding: "11px 14px",
  },
  removeButton: {
    background: "#ffffff",
    border: "1px solid #fecaca",
    borderRadius: "6px",
    color: "#b91c1c",
    cursor: "pointer",
    fontWeight: 800,
    padding: "8px 10px",
  },
  printButton: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    cursor: "pointer",
    fontWeight: 800,
    padding: "10px 12px",
  },
  previewPanel: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    padding: "18px",
  },
  previewActions: {
    alignItems: "center",
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    marginBottom: "12px",
  },
  printSheet: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    color: "#111827",
    padding: "28px",
  },
  printHeader: {
    alignItems: "flex-start",
    borderBottom: "2px solid #111827",
    display: "flex",
    justifyContent: "space-between",
    gap: "20px",
    paddingBottom: "16px",
  },
  printBrand: {
    margin: 0,
    fontSize: "26px",
  },
  printMuted: {
    color: "#64748b",
    margin: "4px 0 0",
  },
  printMeta: {
    display: "grid",
    gap: "4px",
    textAlign: "right",
  },
  clientBox: {
    background: "#f8fafc",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    margin: "18px 0",
    padding: "14px",
  },
  printSectionTitle: {
    fontSize: "15px",
    margin: "0 0 8px",
  },
  printLine: {
    margin: "3px 0",
  },
  printTable: {
    borderCollapse: "collapse",
    width: "100%",
  },
  printTh: {
    background: "#111827",
    color: "#ffffff",
    fontSize: "12px",
    padding: "10px",
    textAlign: "left",
    textTransform: "uppercase",
  },
  printTd: {
    borderBottom: "1px solid #e5e7eb",
    padding: "10px",
    verticalAlign: "top",
  },
  printItemMeta: {
    color: "#64748b",
    display: "block",
    fontSize: "12px",
    marginTop: "3px",
  },
  printTotals: {
    marginLeft: "auto",
    marginTop: "18px",
    maxWidth: "320px",
  },
  observationsBox: {
    borderTop: "1px solid #e5e7eb",
    marginTop: "20px",
    paddingTop: "14px",
  },
  emptyState: {
    border: "1px dashed #cbd5e1",
    borderRadius: "8px",
    padding: "26px",
    textAlign: "center",
  },
  emptyTitle: {
    margin: "0 0 6px",
  },
  emptyText: {
    color: "#64748b",
    margin: 0,
  },
  infoText: {
    background: "#f8fafc",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    color: "#475569",
    margin: "12px 0 0",
    padding: "11px 13px",
  },
  errorText: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "8px",
    color: "#b91c1c",
    margin: 0,
    padding: "11px 13px",
  },
  successText: {
    background: "#ecfdf5",
    border: "1px solid #bbf7d0",
    borderRadius: "8px",
    color: "#166534",
    margin: 0,
    padding: "11px 13px",
  },
  warningText: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: "8px",
    color: "#92400e",
    margin: "12px 0 0",
    padding: "11px 13px",
  },
};

export default NewQuotePage;
