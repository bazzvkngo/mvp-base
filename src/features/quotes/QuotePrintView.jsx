import React from "react";
import { CubeIcon } from "../../components/BrandLogo";
import {
  adaptStoredQuote,
  getQuoteDisplayNumber,
} from "../../domain/quoteModel.mjs";
import { formatCLP, formatDate } from "../../utils/formatters";

const STATUS_LABELS = {
  borrador: "Borrador",
  emitida: "Emitida",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  vencida: "Vencida",
  archivada: "Archivada",
};

function hasText(value) {
  return Boolean(String(value ?? "").trim());
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

function QuotePrintView({ quote: rawQuote, companyProfile }) {
  const quote = adaptStoredQuote({
    ...rawQuote,
    empresa: rawQuote?.empresa || companyProfile || {},
  });
  const company = quote.empresa;
  const client = quote.cliente;
  const brand = company.nombreComercial || company.razonSocial || "Bagner";
  const conditions = [
    ["Plazo de ejecución o entrega", quote.condiciones.plazoEntrega],
    ["Forma de pago", quote.condiciones.formaPago],
    ["Alcance geográfico", quote.condiciones.alcanceGeografico],
    ["Garantía", quote.condiciones.garantia],
    ["Observaciones", quote.condiciones.observaciones],
    ["Exclusiones", quote.condiciones.exclusiones],
    ["Términos adicionales", quote.condiciones.terminosAdicionales],
  ].filter(([, value]) => hasText(value));

  return (
    <article className="quote-document-preview">
      <style>{previewCss}</style>
      <header className="quote-document-preview__header">
        <div className="quote-document-preview__company">
          <div className="quote-document-preview__logo">
            {company.logoUrl ? (
              <img src={company.logoUrl} alt={`Logo ${brand}`} />
            ) : (
              <CubeIcon size={38} strokeWidth={1.6} />
            )}
          </div>
          <div>
            <h2>{brand}</h2>
            {company.razonSocial !== brand && <OptionalLine value={company.razonSocial} />}
            <OptionalLine label="RUT" value={company.rut} />
            <OptionalLine value={[company.direccion, company.ciudad, company.region].filter(hasText).join(" · ")} />
            <OptionalLine value={[company.email, company.telefono].filter(hasText).join(" · ")} />
          </div>
        </div>
        <div className="quote-document-preview__meta">
          <span>COTIZACIÓN</span>
          <strong>N° {getQuoteDisplayNumber(quote)}</strong>
          <small>Emisión {formatDate(quote.fecha)}</small>
          <small>Vence {formatDate(quote.fechaVencimiento)}</small>
          <b>{STATUS_LABELS[quote.estado] || quote.estado}</b>
        </div>
      </header>

      <section className="quote-document-preview__client-grid">
        <div>
          <h3>Cliente</h3>
          <OptionalLine value={client.empresa} />
          <OptionalLine label="RUT" value={client.rut} />
          <OptionalLine label="Contacto" value={client.contacto} />
          <OptionalLine value={[client.email, client.telefono].filter(hasText).join(" · ")} />
        </div>
        <div>
          <h3>Proyecto y vigencia</h3>
          <OptionalLine label="Proyecto" value={client.proyecto} />
          <OptionalLine value={[client.direccion, client.ciudad].filter(hasText).join(" · ")} />
          <OptionalLine label="Validez" value={`${quote.validezDias} días`} />
          <OptionalLine label="Moneda" value={quote.moneda} />
        </div>
      </section>

      {quote.items.length === 0 ? (
        <div className="quote-document-preview__empty">
          Agrega ítems para visualizar el documento formal.
        </div>
      ) : (
        <div className="quote-document-preview__table-wrap">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Producto, servicio o actividad</th>
                <th>Unidad</th>
                <th className="numeric">Cant.</th>
                <th className="numeric">P. unitario</th>
                <th className="numeric">Desc.</th>
                <th className="numeric">Total</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map((item, index) => (
                <tr key={item.lineaId || `${item.itemId}-${index}`}>
                  <td>{item.codigo || index + 1}</td>
                  <td>
                    <strong>{item.nombre}</strong>
                    {item.descripcionComercial && <span>{item.descripcionComercial}</span>}
                  </td>
                  <td>{item.unidad || "-"}</td>
                  <td className="numeric">{item.cantidad}</td>
                  <td className="numeric">{formatCLP(item.precioUnitarioEditable)}</td>
                  <td className="numeric">
                    {item.descuentoPorcentaje ? `${item.descuentoPorcentaje}%` : "-"}
                  </td>
                  <td className="numeric"><strong>{formatCLP(item.totalLinea)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="quote-document-preview__totals">
        <TotalRow label="Subtotal" value={formatCLP(quote.subtotal)} />
        {quote.descuentoTotal > 0 && (
          <TotalRow label="Descuento total" value={`-${formatCLP(quote.descuentoTotal)}`} />
        )}
        <TotalRow label="Subtotal neto" value={formatCLP(quote.neto)} />
        <TotalRow
          label={quote.afectaIva ? "IVA 19%" : "IVA (exenta)"}
          value={formatCLP(quote.iva)}
        />
        <TotalRow label="Total" value={formatCLP(quote.total)} strong />
      </div>

      {quote.legacyIvaNoDefinido && (
        <p className="quote-document-preview__legacy-note">
          Documento histórico: la condición tributaria no fue registrada en el modelo original.
        </p>
      )}

      {quote.seccionesAlcance.map((section) => (
        <section className="quote-document-preview__section" key={section.id}>
          <h3>{section.titulo}</h3>
          <ul>
            {section.lineas.map((line, index) => <li key={`${section.id}-${index}`}>{line}</li>)}
          </ul>
        </section>
      ))}

      {conditions.length > 0 && (
        <section className="quote-document-preview__section">
          <h3>Condiciones comerciales</h3>
          {conditions.map(([label, value]) => <OptionalLine key={label} label={label} value={value} />)}
        </section>
      )}

      {quote.aceptacion.habilitada && (
        <section className="quote-document-preview__section quote-document-preview__acceptance">
          <h3>Aceptación</h3>
          <p>{quote.aceptacion.texto}</p>
          <div className="quote-document-preview__signature-grid">
            {["Nombre", "RUT", "Cargo", "Firma", "Fecha"].map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </section>
      )}

      <footer>
        <span>{[company.responsable, company.telefono, company.email].filter(hasText).join(" · ") || brand}</span>
        <span>{brand} · ValoraCloud</span>
      </footer>
    </article>
  );
}

function TotalRow({ label, value, strong = false }) {
  return (
    <div className={strong ? "quote-document-preview__total--strong" : ""}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const previewCss = `
.quote-document-preview{background:#fff;border:1px solid #d3dce9;border-radius:8px;color:#141f32;font:14px/1.45 Arial,Helvetica,sans-serif;margin:0 auto;max-width:920px;padding:30px}.quote-document-preview p{margin:2px 0}.quote-document-preview__header{align-items:flex-start;border-bottom:3px solid #07285d;display:flex;justify-content:space-between;gap:24px;padding-bottom:16px;position:relative}.quote-document-preview__header:after{background:#d22430;bottom:-3px;content:"";height:3px;left:0;position:absolute;width:92px}.quote-document-preview__company{display:flex;gap:14px;min-width:0}.quote-document-preview__company h2{color:#07285d;font-size:24px;margin:0 0 4px}.quote-document-preview__logo{align-items:center;display:flex;justify-content:center;min-height:58px;width:100px}.quote-document-preview__logo img{max-height:58px;max-width:100%;object-fit:contain}.quote-document-preview__meta{display:grid;gap:3px;text-align:right}.quote-document-preview__meta>span{font-size:20px;font-weight:800}.quote-document-preview__meta>strong{color:#d22430;font-size:17px}.quote-document-preview__meta>b{color:#07285d;margin-top:3px}.quote-document-preview__client-grid{background:#f4f7fb;border:1px solid #d3dce9;border-radius:6px;display:grid;grid-template-columns:1fr 1fr;margin:20px 0;padding:15px}.quote-document-preview__client-grid>div+div{border-left:1px solid #d3dce9;padding-left:18px}.quote-document-preview h3{color:#07285d;font-size:13px;margin:0 0 7px;text-transform:uppercase}.quote-document-preview__table-wrap{overflow-x:auto}.quote-document-preview table{border-collapse:collapse;font-size:12px;width:100%}.quote-document-preview th{background:#07285d;color:#fff;padding:9px 7px;text-align:left}.quote-document-preview td{border:1px solid #d3dce9;padding:9px 7px;vertical-align:top}.quote-document-preview tbody tr:nth-child(even){background:#f7f9fc}.quote-document-preview td span{color:#4f5d75;display:block;margin-top:3px;white-space:pre-wrap}.quote-document-preview .numeric{text-align:right}.quote-document-preview__totals{background:#f4f7fb;border:1px solid #d3dce9;border-radius:6px;margin:18px 0 18px auto;max-width:340px;padding:8px 14px}.quote-document-preview__totals>div{border-bottom:1px solid #d3dce9;display:flex;justify-content:space-between;padding:7px 0}.quote-document-preview__totals>div:last-child{border:0}.quote-document-preview__total--strong{background:#07285d;color:#fff;margin:3px -14px -8px;padding:10px 14px!important}.quote-document-preview__section{break-inside:avoid;border-top:1px solid #d3dce9;margin-top:18px;padding-top:14px}.quote-document-preview__section li{margin-bottom:5px}.quote-document-preview__section li::marker{color:#d22430}.quote-document-preview__legacy-note{background:#fff8e6;border:1px solid #efbe50;border-radius:5px;color:#704d0d;padding:9px}.quote-document-preview__signature-grid{display:grid;gap:18px 22px;grid-template-columns:1fr 1fr;margin-top:28px}.quote-document-preview__signature-grid span{border-top:1px solid #8190a8;color:#4f5d75;font-size:11px;padding-top:4px}.quote-document-preview footer{border-top:1px solid #d3dce9;color:#4f5d75;display:flex;font-size:11px;justify-content:space-between;margin-top:30px;padding-top:10px}.quote-document-preview__empty{background:#f4f7fb;border:1px dashed #9daabd;border-radius:6px;padding:20px;text-align:center}@media(max-width:720px){.quote-document-preview{padding:18px}.quote-document-preview__header{display:grid}.quote-document-preview__meta{text-align:left}.quote-document-preview__client-grid{grid-template-columns:1fr}.quote-document-preview__client-grid>div+div{border-left:0;border-top:1px solid #d3dce9;margin-top:12px;padding-left:0;padding-top:12px}}@media print{.quote-document-preview{border:0;border-radius:0;box-shadow:none;max-width:none;padding:0}.quote-document-preview__table-wrap{overflow:visible}.quote-document-preview thead{display:table-header-group}.quote-document-preview footer{position:static}}
`;

export default QuotePrintView;
