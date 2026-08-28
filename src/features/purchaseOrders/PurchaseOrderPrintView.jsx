import React from "react";
import { CubeIcon } from "../../components/BrandLogo";
import { resolveDocumentCompany } from "../../domain/companySnapshot.mjs";
import { formatDate, formatMoney } from "../../utils/formatters";

const statusLabel = (value) => ({
  borrador: "Pendiente",
  emitida: "Emitida",
  cancelada: "Cancelada",
})[value] || "Pendiente";

const paymentLabel = (value) => ({
  contado: "Contado",
  transferencia: "Transferencia",
  credito: "Crédito",
  otro: "Otro",
})[value] || value;

function hasText(value) {
  return Boolean(String(value ?? "").trim());
}

function joinNonEmpty(values, separator = " · ") {
  return values.filter(hasText).join(separator);
}

function taxLabel(order) {
  const rate = new Intl.NumberFormat(order.locale || "es-CL", {
    maximumFractionDigits: 2,
  }).format(Number(order.tasaIva || 0) * 100);
  return `${order.impuestoNombre || "Impuesto"} ${rate}%`;
}

function OptionalLine({ label, value }) {
  if (!hasText(value)) return null;
  return (
    <p>
      {label && <strong>{label}: </strong>}
      {value}
    </p>
  );
}

export default function PurchaseOrderPrintView({ company: liveCompany = {}, order }) {
  const company = resolveDocumentCompany(order, liveCompany);
  const provider = order.proveedorSnapshot || {};
  const items = Array.isArray(order.items) ? order.items : [];
  const money = (value) => formatMoney(value, order.moneda, order.locale);
  const brand = company.nombreComercial || company.razonSocial || "Empresa compradora";
  const showCode = items.some((item) => hasText(item.codigo));
  const showUnit = items.some((item) => hasText(item.unidad));
  const showDiscount = items.some((item) => Number(item.descuentoPct) > 0);
  const delivery = [
    ["Dirección de entrega", order.direccionEntrega],
    ["Fecha o plazo esperado", order.fechaEntregaEstimada ? formatDate(order.fechaEntregaEstimada, order.locale) : ""],
  ].filter(([, value]) => hasText(value));
  const paymentTerms = order.condicionesPago || provider.condicionesPago;
  const creditDays = Number(provider.diasCredito);
  const conditions = [
    ["Condiciones de pago", paymentLabel(paymentTerms)],
    [
      "Plazo de pago",
      creditDays > 0 && !String(paymentTerms || "").includes(String(creditDays))
        ? `${creditDays} días`
        : "",
    ],
    ["Observaciones", order.observaciones],
  ].filter(([, value]) => hasText(value));

  return (
    <article className="po-document-preview">
      <header className="po-document-preview__header">
        <div className="po-document-preview__company">
          <div className="po-document-preview__logo">
            {company.logoUrl ? (
              <img src={company.logoUrl} alt={`Logo ${brand}`} />
            ) : (
              <CubeIcon size={38} strokeWidth={1.6} />
            )}
          </div>
          <div>
            <h2>{brand}</h2>
            {company.razonSocial !== brand && <OptionalLine value={company.razonSocial} />}
            <OptionalLine
              label={company.identificadorFiscalTipo || "Identificación fiscal"}
              value={company.identificadorFiscalValor || company.rut}
            />
            <OptionalLine label="Giro" value={company.giro} />
            <OptionalLine
              value={joinNonEmpty([
                company.direccion,
                company.comunaNombre || company.ciudad,
                company.regionEstado || company.regionNombre || company.region,
              ])}
            />
            <OptionalLine value={joinNonEmpty([company.email, company.telefono])} />
          </div>
        </div>
        <div className="po-document-preview__identity">
          <span>Orden de compra</span>
          <strong>{order.numero || "Nueva orden de compra"}</strong>
          <dl>
            <div><dt>Fecha de emisión</dt><dd>{order.fechaEmision ? formatDate(order.fechaEmision, order.locale) : "-"}</dd></div>
            <div><dt>Estado</dt><dd>{statusLabel(order.estado)}</dd></div>
            <div><dt>Moneda</dt><dd>{order.moneda || "CLP"}</dd></div>
          </dl>
        </div>
      </header>

      <section className="po-document-preview__section po-document-preview__provider">
        <h3>Proveedor</h3>
        <div className="po-document-preview__details-grid">
          <div>
            <OptionalLine value={provider.razonSocial || "Proveedor no seleccionado"} />
            <OptionalLine
              label={provider.identificadorFiscalTipo || "Identificación fiscal"}
              value={provider.identificadorFiscalValor || provider.rut}
            />
            <OptionalLine label="Contacto" value={provider.personaContacto} />
          </div>
          <div>
            <OptionalLine value={joinNonEmpty([provider.email, provider.telefono])} />
            <OptionalLine
              value={joinNonEmpty([
                provider.direccion,
                provider.comunaNombre,
                provider.regionNombre,
              ], ", ")}
            />
          </div>
        </div>
      </section>

      {(delivery.length > 0 || conditions.length > 0) && (
        <div className="po-document-preview__commercial-grid">
          {delivery.length > 0 && (
            <section className="po-document-preview__section">
              <h3>Entrega</h3>
              <dl>
                {delivery.map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
              </dl>
            </section>
          )}
          {conditions.length > 0 && (
            <section className="po-document-preview__section">
              <h3>Condiciones</h3>
              <dl>
                {conditions.map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
              </dl>
            </section>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <div className="po-document-preview__empty">
          Agrega productos o servicios para completar la orden de compra.
        </div>
      ) : (
        <div className="po-document-preview__table-wrap">
          <table>
            <thead>
              <tr>
                {showCode && <th>Código</th>}
                <th>Producto o servicio</th>
                {showUnit && <th>Unidad</th>}
                <th className="numeric">Cantidad</th>
                <th className="numeric">Costo unitario</th>
                {showDiscount && <th className="numeric">Descuento</th>}
                <th className="numeric">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={item.lineaId || `${item.itemId}-${index}`}>
                  {showCode && <td>{item.codigo || "-"}</td>}
                  <td>
                    <strong>{item.nombre}</strong>
                    {item.descripcion && <span>{item.descripcion}</span>}
                  </td>
                  {showUnit && <td>{item.unidad || "-"}</td>}
                  <td className="numeric">{item.cantidad}</td>
                  <td className="numeric">{money(item.costoUnitario)}</td>
                  {showDiscount && (
                    <td className="numeric">{item.descuentoPct ? `${item.descuentoPct}%` : "-"}</td>
                  )}
                  <td className="numeric"><strong>{money(item.totalLinea)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="po-document-preview__totals">
        <TotalRow label="Subtotal" value={money(order.subtotal)} />
        {Number(order.descuentoTotal) > 0 && (
          <TotalRow label="Descuentos" value={`-${money(order.descuentoTotal)}`} />
        )}
        <TotalRow label="Neto" value={money(order.neto)} />
        <TotalRow label={taxLabel(order)} value={money(order.iva)} />
        <TotalRow label="Total" value={money(order.total)} strong />
      </section>

      <footer>
        <span>{joinNonEmpty([company.responsable, company.telefono, company.email]) || brand}</span>
        <span>{brand} · ValoraCloud</span>
      </footer>
    </article>
  );
}

function TotalRow({ label, value, strong = false }) {
  return (
    <div className={strong ? "po-document-preview__total" : ""}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
