import React from "react";
import { formatCLP, formatDate } from "../../utils/formatters";

const statusLabels = {
  borrador: "Borrador",
  emitida: "Emitida",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
};

function hasText(value) {
  return Boolean(String(value || "").trim());
}

function getCompanyData(quote, companyProfile) {
  const snapshot = quote?.empresa || null;
  const hasSnapshotData =
    snapshot &&
    [
      "nombreComercial",
      "razonSocial",
      "rut",
      "giro",
      "email",
      "telefono",
      "direccion",
      "ciudad",
      "sitioWeb",
      "logoUrl",
      "condicionesPago",
      "notaPieCotizacion",
    ].some((field) => hasText(snapshot[field]));

  return hasSnapshotData ? snapshot : companyProfile || {};
}

function joinParts(parts) {
  return parts.filter(hasText).join(" / ");
}

function QuotePrintView({ quote, companyProfile }) {
  const items = Array.isArray(quote?.items) ? quote.items : [];
  const company = getCompanyData(quote, companyProfile);
  const brand = company.nombreComercial || "ValoraCloud";
  const address = joinParts([company.direccion, company.ciudad]);
  const contact = joinParts([company.email, company.telefono]);
  const condicionesPago =
    quote?.condicionesPago || company.condicionesPago || "-";

  return (
    <article className="quote-print" style={styles.printSheet}>
      <header className="quote-print__header" style={styles.printHeader}>
        <div className="quote-print__company" style={styles.companyBlock}>
          <div className="quote-print__logo-box" style={styles.logoBox}>
            {company.logoUrl ? (
              <img
                src={company.logoUrl}
                alt={`Logo ${brand}`}
                style={styles.logo}
              />
            ) : (
              <span style={styles.logoPlaceholder}>VC</span>
            )}
          </div>
          <div>
            <h2 className="quote-print__brand" style={styles.printBrand}>{brand}</h2>
            {company.razonSocial && (
              <p className="quote-print__muted" style={styles.printMuted}>
                {company.razonSocial}
              </p>
            )}
            {company.rut && (
              <p className="quote-print__muted" style={styles.printMuted}>
                RUT: {company.rut}
              </p>
            )}
            {company.giro && (
              <p className="quote-print__muted" style={styles.printMuted}>
                Giro: {company.giro}
              </p>
            )}
            {contact && (
              <p className="quote-print__muted" style={styles.printMuted}>{contact}</p>
            )}
            {address && (
              <p className="quote-print__muted" style={styles.printMuted}>{address}</p>
            )}
            {company.sitioWeb && (
              <p className="quote-print__muted" style={styles.printMuted}>
                {company.sitioWeb}
              </p>
            )}
          </div>
        </div>
        <div className="quote-print__meta" style={styles.printMeta}>
          <strong>Cotización {quote?.numero || "-"}</strong>
          <span>Fecha: {formatDate(quote?.fecha)}</span>
          <span>Estado: {statusLabels[quote?.estado] || quote?.estado || "-"}</span>
        </div>
      </header>

      <section className="quote-print__client" style={styles.clientBox}>
        <h3 className="quote-print__section-title" style={styles.printSectionTitle}>
          Cliente
        </h3>
        <p className="quote-print__line" style={styles.printLine}>
          <strong>{quote?.clienteNombre || "Sin cliente"}</strong>
        </p>
        <p className="quote-print__line" style={styles.printLine}>
          RUT/DNI: {quote?.clienteRut || "-"}
        </p>
        <p className="quote-print__line" style={styles.printLine}>
          Email: {quote?.clienteEmail || "-"}
        </p>
        <p className="quote-print__line" style={styles.printLine}>
          Teléfono: {quote?.clienteTelefono || "-"}
        </p>
        <p className="quote-print__line" style={styles.printLine}>
          Dirección: {quote?.clienteDireccion || "-"}
        </p>
      </section>

      {items.length === 0 ? (
        <div className="quote-print__empty-notice" style={styles.printEmptyNotice}>
          Agrega ítems a la cotización para visualizar el documento formal.
        </div>
      ) : (
        <>
          <table className="quote-print__table" style={styles.printTable}>
            <thead>
              <tr>
                <th className="quote-print__th" style={styles.printTh}>Ítem</th>
                <th className="quote-print__th" style={styles.printTh}>Cant.</th>
                <th className="quote-print__th" style={styles.printTh}>
                  Precio unit.
                </th>
                <th className="quote-print__th" style={styles.printTh}>Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={`${item.itemId || "item"}-${index}`}>
                  <td className="quote-print__td" style={styles.printTd}>
                    <strong>{item.nombre || "Ítem sin nombre"}</strong>
                    <span className="quote-print__item-meta" style={styles.printItemMeta}>
                      {item.descripcion || item.categoria || item.tipoItem || ""}
                    </span>
                  </td>
                  <td className="quote-print__td" style={styles.printTd}>
                    {item.cantidad || 0}
                  </td>
                  <td className="quote-print__td" style={styles.printTd}>
                    {formatCLP(item.precioUnitarioEditable)}
                  </td>
                  <td className="quote-print__td" style={styles.printTd}>
                    {formatCLP(item.totalLinea)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="quote-print__totals" style={styles.printTotals}>
            <TotalRow label="Subtotal" value={formatCLP(quote?.subtotal)} />
            <TotalRow label="Descuento" value={formatCLP(quote?.descuento)} />
            <TotalRow label="Total" value={formatCLP(quote?.total)} strong />
          </div>
        </>
      )}

      <section className="quote-print__conditions" style={styles.conditionsBox}>
        <h3 className="quote-print__section-title" style={styles.printSectionTitle}>
          Condiciones comerciales
        </h3>
        <p className="quote-print__line" style={styles.printLine}>
          Pago: {condicionesPago}
        </p>
        <p className="quote-print__line" style={styles.printLine}>
          Validez: {company.validezCotizacionDias || 15} días
        </p>
        {quote?.observaciones && (
          <p className="quote-print__line" style={styles.printLine}>
            Observaciones: {quote.observaciones}
          </p>
        )}
        {company.notaPieCotizacion && (
          <p className="quote-print__footer-note" style={styles.footerNote}>
            {company.notaPieCotizacion}
          </p>
        )}
      </section>
    </article>
  );
}

function TotalRow({ label, value, strong = false }) {
  return (
    <div className="quote-print__total-row" style={styles.totalRow}>
      <span
        className={
          strong ? "quote-print__total-label--strong" : "quote-print__total-label"
        }
        style={strong ? styles.totalLabelStrong : styles.totalLabel}
      >
        {label}
      </span>
      <strong
        className={
          strong ? "quote-print__total-value--strong" : "quote-print__total-value"
        }
        style={strong ? styles.totalValueStrong : styles.totalValue}
      >
        {value}
      </strong>
    </div>
  );
}

const styles = {
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
  companyBlock: {
    alignItems: "flex-start",
    display: "flex",
    gap: "14px",
  },
  logoBox: {
    alignItems: "center",
    background: "#f8fafc",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    display: "flex",
    height: "74px",
    justifyContent: "center",
    overflow: "hidden",
    width: "74px",
  },
  logo: {
    maxHeight: "100%",
    maxWidth: "100%",
    objectFit: "contain",
    padding: "7px",
  },
  logoPlaceholder: {
    color: "#64748b",
    fontWeight: 900,
  },
  printBrand: {
    margin: 0,
    fontSize: "26px",
  },
  printMuted: {
    color: "#64748b",
    margin: "3px 0 0",
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
  printEmptyNotice: {
    background: "#f8fafc",
    border: "1px dashed #cbd5e1",
    borderRadius: "8px",
    color: "#475569",
    fontWeight: 700,
    padding: "18px",
    textAlign: "center",
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
  conditionsBox: {
    borderTop: "1px solid #e5e7eb",
    marginTop: "20px",
    paddingTop: "14px",
  },
  footerNote: {
    color: "#475569",
    fontSize: "13px",
    lineHeight: 1.45,
    margin: "10px 0 0",
  },
};

export default QuotePrintView;
