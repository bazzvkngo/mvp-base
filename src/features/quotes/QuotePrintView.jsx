import React from "react";
import { CubeIcon } from "../../components/BrandLogo";
import {
  adaptStoredQuote,
  getQuoteDisplayNumber,
  getQuoteStatusLabel,
} from "../../domain/quoteModel.mjs";
import { resolveDocumentCompany } from "../../domain/companySnapshot.mjs";
import { formatDate, formatMoney } from "../../utils/formatters";

function hasText(value) {
  return Boolean(String(value ?? "").trim());
}

function joinNonEmpty(parts, separator = " · ") {
  return parts.filter(hasText).join(separator);
}

function taxLabel(quote) {
  if (!quote.afectaIva) return `${quote.impuestoNombre || "Impuesto"} (exenta)`;
  const rate = new Intl.NumberFormat(quote.locale || "es-CL", {
    maximumFractionDigits: 2,
  }).format(Number(quote.tasaIva || 0) * 100);
  return `${quote.impuestoNombre || "Impuesto"} ${rate}%`;
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
    empresaSnapshot: resolveDocumentCompany(rawQuote, companyProfile),
  });
  const money = (value) => formatMoney(value, quote.moneda, quote.locale);
  const company = quote.empresa;
  const client = quote.cliente;
  const pendingEmission = quote.estado === "borrador" && !quote.fechaEmision;
  const brand = company.nombreComercial || company.razonSocial || "ValoraCloud";
  const project = client.proyecto || quote.trabajoTitulo;
  const showCode = quote.items.some((item) => hasText(item.codigo));
  const showUnit = quote.items.some((item) => hasText(item.unidad));
  const showDiscount = quote.items.some((item) => Number(item.descuentoPorcentaje) > 0);
  const conditions = [
    ["Condiciones de pago", quote.condiciones.formaPago],
    ["Plazo de ejecución o entrega", quote.condiciones.plazoEntrega],
    ["Alcance geográfico", quote.condiciones.alcanceGeografico],
    ["Garantía", quote.condiciones.garantia],
    ["Observaciones comerciales", quote.condiciones.observaciones],
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
            <OptionalLine
              label={company.identificadorFiscalTipo || "Identificación fiscal"}
              value={company.identificadorFiscalValor || company.rut}
            />
            <OptionalLine label="Giro" value={company.giro} />
            <OptionalLine value={joinNonEmpty([company.direccion, company.ciudad, company.region])} />
            <OptionalLine value={joinNonEmpty([company.email, company.telefono])} />
          </div>
        </div>
        <div className="quote-document-preview__identity">
          <span>Cotización</span>
          <strong>Nº {getQuoteDisplayNumber(quote)}</strong>
          <dl>
            <div><dt>Fecha de emisión</dt><dd>{formatDate(quote.fechaEmision || quote.fecha)}</dd></div>
            <div>
              <dt>{pendingEmission ? "Vigencia" : "Válida hasta"}</dt>
              <dd>{pendingEmission ? `${quote.validezDias || "-"} días desde la emisión` : formatDate(quote.fechaVencimiento)}</dd>
            </div>
            <div><dt>Estado comercial</dt><dd>{getQuoteStatusLabel(quote.estado)}</dd></div>
          </dl>
          {pendingEmission && <small>Aún no ha sido enviada al cliente.</small>}
        </div>
      </header>

      <section className="quote-document-preview__section quote-document-preview__client">
        <h3>Cliente</h3>
        <div className="quote-document-preview__details-grid">
          <div>
            <OptionalLine value={client.empresa} />
            <OptionalLine
              label={client.identificadorFiscalTipo || "Identificación fiscal"}
              value={client.identificadorFiscalValor || client.rut}
            />
            <OptionalLine label="Contacto" value={client.contacto} />
          </div>
          <div>
            <OptionalLine value={joinNonEmpty([client.email, client.telefono])} />
            <OptionalLine value={joinNonEmpty([client.direccion, client.ciudad])} />
          </div>
        </div>
      </section>

      {hasText(project) && (
        <section className="quote-document-preview__section quote-document-preview__project">
          <h3>Proyecto</h3>
          <p>{project}</p>
        </section>
      )}

      {quote.items.length === 0 ? (
        <div className="quote-document-preview__empty">
          Agrega productos o servicios para completar la cotización.
        </div>
      ) : (
        <div className="quote-document-preview__table-wrap">
          <table>
            <thead>
              <tr>
                {showCode && <th>Código</th>}
                <th>Producto, servicio o actividad</th>
                {showUnit && <th>Unidad</th>}
                <th className="numeric">Cantidad</th>
                <th className="numeric">Precio unitario</th>
                {showDiscount && <th className="numeric">Descuento</th>}
                <th className="numeric">Total</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map((item, index) => (
                <tr key={item.lineaId || `${item.itemId}-${index}`}>
                  {showCode && <td>{item.codigo || "-"}</td>}
                  <td>
                    <strong>{item.nombre}</strong>
                    {item.descripcionComercial && <span>{item.descripcionComercial}</span>}
                  </td>
                  {showUnit && <td>{item.unidad || "-"}</td>}
                  <td className="numeric">{item.cantidad}</td>
                  <td className="numeric">{money(item.precioUnitarioEditable)}</td>
                  {showDiscount && (
                    <td className="numeric">
                      {item.descuentoPorcentaje ? `${item.descuentoPorcentaje}%` : "-"}
                    </td>
                  )}
                  <td className="numeric"><strong>{money(item.totalLinea)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="quote-document-preview__totals">
        <TotalRow label="Subtotal" value={money(quote.subtotal)} />
        {quote.descuentoTotal > 0 && (
          <TotalRow label="Descuento" value={`-${money(quote.descuentoTotal)}`} />
        )}
        <TotalRow label="Neto" value={money(quote.neto)} />
        <TotalRow label={taxLabel(quote)} value={money(quote.iva)} />
        <TotalRow label="Total" value={money(quote.total)} strong />
      </div>

      {quote.legacyIvaNoDefinido && (
        <p className="quote-document-preview__legacy-note">
          Documento histórico: la condición tributaria no quedó registrada en su versión original.
        </p>
      )}

      {quote.seccionesAlcance.map((section) => (
        <section className="quote-document-preview__section quote-document-preview__scope" key={section.id}>
          <h3>{section.titulo}</h3>
          <ul>
            {section.lineas.map((line, index) => <li key={`${section.id}-${index}`}>{line}</li>)}
          </ul>
        </section>
      ))}

      {conditions.length > 0 && (
        <section className="quote-document-preview__section quote-document-preview__conditions">
          <h3>Condiciones comerciales</h3>
          <dl>
            {conditions.map(([label, value]) => (
              <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
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
        <span>{joinNonEmpty([company.responsable, company.telefono, company.email]) || brand}</span>
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
.quote-document-preview{--quote-navy:#123765;--quote-red:#b5222d;--quote-ink:#182335;--quote-muted:#5f6b7c;--quote-border:#d8dee8;background:#fff;border:1px solid var(--quote-border);box-shadow:0 16px 40px rgba(18,55,101,.08);color:var(--quote-ink);font:13px/1.5 Arial,Helvetica,sans-serif;margin:0 auto;max-width:920px;padding:38px 42px}.quote-document-preview p{margin:2px 0}.quote-document-preview__header{align-items:flex-start;border-bottom:2px solid var(--quote-navy);display:grid;gap:32px;grid-template-columns:minmax(0,1fr) minmax(245px,.44fr);padding-bottom:24px;position:relative}.quote-document-preview__header:after{background:var(--quote-red);bottom:-2px;content:"";height:2px;left:0;position:absolute;width:72px}.quote-document-preview__company{display:flex;gap:16px;min-width:0}.quote-document-preview__company h2{color:var(--quote-navy);font-size:24px;line-height:1.2;margin:0 0 6px}.quote-document-preview__company p{color:var(--quote-muted)}.quote-document-preview__company p:first-of-type{color:var(--quote-ink)}.quote-document-preview__logo{align-items:flex-start;color:var(--quote-navy);display:flex;flex:0 0 92px;justify-content:flex-start;min-height:54px}.quote-document-preview__logo img{max-height:60px;max-width:92px;object-fit:contain}.quote-document-preview__identity{text-align:right}.quote-document-preview__identity>span{color:var(--quote-ink);display:block;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}.quote-document-preview__identity>strong{color:var(--quote-red);display:block;font-size:21px;margin:2px 0 12px}.quote-document-preview__identity dl{margin:0}.quote-document-preview__identity dl>div{display:flex;gap:16px;justify-content:flex-end;margin:3px 0}.quote-document-preview__identity dt{color:var(--quote-muted)}.quote-document-preview__identity dd{font-weight:600;margin:0;min-width:92px}.quote-document-preview__identity small{color:var(--quote-muted);display:block;margin-top:8px}.quote-document-preview__section{break-inside:avoid;border-top:1px solid var(--quote-border);margin-top:24px;padding-top:14px}.quote-document-preview h3{color:var(--quote-navy);font-size:11px;letter-spacing:.12em;margin:0 0 10px;text-transform:uppercase}.quote-document-preview__details-grid{display:grid;gap:32px;grid-template-columns:1fr 1fr}.quote-document-preview__details-grid>div:first-child p:first-child{font-size:15px;font-weight:700}.quote-document-preview__details-grid p{color:var(--quote-muted)}.quote-document-preview__details-grid strong{color:var(--quote-ink)}.quote-document-preview__project{margin-top:16px}.quote-document-preview__project p{font-size:14px;font-weight:600}.quote-document-preview__table-wrap{margin-top:26px;overflow-x:auto}.quote-document-preview table{border-collapse:collapse;font-size:11.5px;width:100%}.quote-document-preview th{border-bottom:1.5px solid var(--quote-navy);color:var(--quote-navy);font-size:10px;letter-spacing:.03em;padding:8px 7px;text-align:left;text-transform:uppercase}.quote-document-preview td{border-bottom:1px solid var(--quote-border);padding:11px 7px;vertical-align:top}.quote-document-preview td:first-child,.quote-document-preview th:first-child{padding-left:0}.quote-document-preview td:last-child,.quote-document-preview th:last-child{padding-right:0}.quote-document-preview td span{color:var(--quote-muted);display:block;font-size:10.5px;line-height:1.4;margin-top:3px;white-space:pre-wrap}.quote-document-preview .numeric{text-align:right;white-space:nowrap}.quote-document-preview__totals{margin:20px 0 22px auto;max-width:330px;padding-top:2px}.quote-document-preview__totals>div{display:flex;gap:24px;justify-content:space-between;padding:5px 0}.quote-document-preview__totals>div span{color:var(--quote-muted)}.quote-document-preview__total--strong{border-bottom:3px double var(--quote-navy);border-top:1px solid var(--quote-navy);color:var(--quote-navy);font-size:16px;margin-top:5px;padding:9px 0!important}.quote-document-preview__total--strong span{color:var(--quote-navy)!important;font-weight:700;text-transform:uppercase}.quote-document-preview__legacy-note{border-left:3px solid #d49d28;color:#704d0d;padding:5px 10px}.quote-document-preview__scope ul{margin:0;padding-left:18px}.quote-document-preview__scope li{margin-bottom:5px}.quote-document-preview__scope li::marker{color:var(--quote-red)}.quote-document-preview__conditions dl{display:grid;gap:8px 28px;grid-template-columns:1fr 1fr;margin:0}.quote-document-preview__conditions dl>div{break-inside:avoid}.quote-document-preview__conditions dt{color:var(--quote-muted);font-size:11px}.quote-document-preview__conditions dd{margin:1px 0 0;white-space:pre-wrap}.quote-document-preview__signature-grid{display:grid;gap:20px 24px;grid-template-columns:1fr 1fr;margin-top:30px}.quote-document-preview__signature-grid span{border-top:1px solid #8792a3;color:var(--quote-muted);font-size:10px;padding-top:4px}.quote-document-preview footer{border-top:1px solid var(--quote-border);color:var(--quote-muted);display:flex;font-size:10px;gap:20px;justify-content:space-between;margin-top:34px;padding-top:10px}.quote-document-preview__empty{border:1px dashed #9daabd;margin-top:24px;padding:18px;text-align:center}@media(max-width:720px){.quote-document-preview{box-shadow:none;padding:24px 20px}.quote-document-preview__header{grid-template-columns:1fr}.quote-document-preview__identity{text-align:left}.quote-document-preview__identity dl>div{justify-content:flex-start}.quote-document-preview__details-grid,.quote-document-preview__conditions dl{grid-template-columns:1fr}.quote-document-preview__logo{flex-basis:68px}.quote-document-preview__logo img{max-width:68px}}@media print{@page{size:A4;margin:14mm}.quote-document-preview{border:0;box-shadow:none;max-width:none;padding:0}.quote-document-preview__table-wrap{overflow:visible}.quote-document-preview thead{display:table-header-group}.quote-document-preview tr,.quote-document-preview__totals,.quote-document-preview__conditions dl>div{break-inside:avoid}.quote-document-preview footer{position:static}}
`;

export default QuotePrintView;
