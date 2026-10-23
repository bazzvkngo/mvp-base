import React from "react";
import { CubeIcon } from "../../components/BrandLogo";
import {
  adaptStoredQuote,
  getQuoteDisplayNumber,
} from "../../domain/quoteModel.mjs";
import { getDefaultFiscalIdentifierLabel } from "../../domain/businessCatalog";
import { resolveDocumentCompany } from "../../domain/companySnapshot.mjs";
import {
  QUOTE_FOOTER_QUESTION,
  QUOTE_FOOTER_THANKS,
  buildQuoteAcceptanceLine,
  buildQuoteClientRows,
  buildQuoteFooterContact,
  buildQuoteTerms,
} from "../../domain/quoteDocumentLayout.mjs";
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
  const clientRows = buildQuoteClientRows(client, project);
  const terms = buildQuoteTerms(quote.condiciones);
  const footerContact = buildQuoteFooterContact(company);

  return (
    <article className="quote-document-preview">
      <style>{previewCss}</style>
      <header className="quote-document-preview__header">
        <div className="quote-document-preview__company">
          {company.logoUrl ? (
            <img
              className="quote-document-preview__logo"
              src={company.logoUrl}
              alt={`Logo ${brand}`}
            />
          ) : (
            <div className="quote-document-preview__brand">
              <CubeIcon size={44} strokeWidth={1.6} />
              <h2>{brand}</h2>
            </div>
          )}
          {company.razonSocial !== brand && <OptionalLine value={company.razonSocial} />}
          <OptionalLine label="Giro" value={company.giro} />
        </div>
        <div className="quote-document-preview__identity">
          <div className="quote-document-preview__title">
            <span>Cotización</span>
            <strong>Nº {getQuoteDisplayNumber(quote)}</strong>
          </div>
          <div className="quote-document-preview__company-id">
            <OptionalLine
              label={company.identificadorFiscalTipo || "Identificación fiscal"}
              value={company.identificadorFiscalValor || company.rut}
            />
            <OptionalLine label="Dirección" value={company.direccion} />
            <OptionalLine label="Ciudad" value={joinNonEmpty([company.ciudad, company.region], ", ")} />
          </div>
          <dl>
            <div><dt>Fecha de emisión</dt><dd>{formatDate(quote.fechaEmision || quote.fecha)}</dd></div>
            <div>
              <dt>{pendingEmission ? "Vigencia" : "Válida hasta"}</dt>
              <dd>{pendingEmission ? `${quote.validezDias || "-"} días desde la emisión` : formatDate(quote.fechaVencimiento)}</dd>
            </div>
          </dl>
        </div>
      </header>

      <section className="quote-document-preview__client">
        <h3 className="quote-document-preview__band">Cliente</h3>
        <dl className="quote-document-preview__client-grid">
          {clientRows.map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      </section>

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

      {quote.seccionesAlcance.map((section) => (
        <section className="quote-document-preview__section quote-document-preview__scope" key={section.id}>
          <h3>{section.titulo}</h3>
          <ul>
            {section.lineas.map((line, index) => <li key={`${section.id}-${index}`}>{line}</li>)}
          </ul>
        </section>
      ))}

      <div className={`quote-document-preview__summary${terms.length === 0 ? " quote-document-preview__summary--totals-only" : ""}`}>
        {terms.length > 0 && (
          <section className="quote-document-preview__terms">
            <h3 className="quote-document-preview__band">Términos y condiciones</h3>
            <ol>
              {terms.map((term, index) => <li key={`${index}-${term}`}>{term}</li>)}
            </ol>
          </section>
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
      </div>

      {quote.legacyIvaNoDefinido && (
        <p className="quote-document-preview__legacy-note">
          Documento histórico: la condición tributaria no quedó registrada en su versión original.
        </p>
      )}

      {quote.aceptacion.habilitada && (
        <section className="quote-document-preview__acceptance">
          <p>{buildQuoteAcceptanceLine(quote.aceptacion)}</p>
          <div className="quote-document-preview__signature-grid">
            {["Nombre", getDefaultFiscalIdentifierLabel(quote.paisCodigo), "Fecha", "Firma"].map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </section>
      )}

      <footer>
        {footerContact && <p>{QUOTE_FOOTER_QUESTION}</p>}
        {footerContact && <strong>{footerContact}</strong>}
        <strong>{QUOTE_FOOTER_THANKS}</strong>
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

// Colores solo de --color-document-*: el documento es papel blanco también en
// modo oscuro. print-color-adjust conserva las bandas al imprimir.
const previewCss = `
.quote-document-preview{--quote-navy:var(--color-document-navy);--quote-red:var(--color-document-red);--quote-ink:var(--color-document-ink);--quote-muted:var(--color-document-muted);--quote-border:var(--color-document-border);--quote-on-navy:var(--color-document-on-navy);background:var(--color-document-paper);border:1px solid var(--quote-border);color:var(--quote-ink);font:13px/1.5 Arial,Helvetica,sans-serif;margin:0 auto;max-width:920px;padding:38px 42px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.quote-document-preview p{margin:2px 0}
.quote-document-preview__header{align-items:flex-start;display:grid;gap:32px;grid-template-columns:minmax(0,1fr) minmax(250px,.5fr);margin-bottom:18px}
.quote-document-preview__company{min-width:0}
.quote-document-preview__company p{color:var(--quote-muted);font-size:11.5px}
.quote-document-preview__logo{display:block;margin-bottom:8px;max-height:92px;max-width:260px;object-fit:contain}
.quote-document-preview__brand{align-items:center;color:var(--quote-navy);display:flex;gap:12px;margin-bottom:8px}
.quote-document-preview__brand h2{color:var(--quote-navy);font-size:26px;line-height:1.2;margin:0}
.quote-document-preview__identity{text-align:right}
.quote-document-preview__title{color:var(--quote-ink);text-transform:uppercase}
.quote-document-preview__title span{display:block;font-size:12px;font-weight:700;letter-spacing:.14em}
.quote-document-preview__title strong{display:block;font-size:20px;letter-spacing:.02em;white-space:nowrap}
.quote-document-preview__identity dl{margin:12px 0 0}
.quote-document-preview__identity dl>div{display:flex;gap:16px;justify-content:flex-end;margin:2px 0}
.quote-document-preview__identity dt{color:var(--quote-muted)}
.quote-document-preview__identity dd{font-weight:600;margin:0;min-width:92px}
.quote-document-preview__company-id{margin-top:6px}
.quote-document-preview__company-id p{font-size:12px}
.quote-document-preview__band{background:var(--quote-navy);color:var(--quote-on-navy);font-size:11px;letter-spacing:.12em;margin:0;padding:4px 10px;text-align:center;text-transform:uppercase}
.quote-document-preview__client{break-inside:avoid}
.quote-document-preview__client-grid{display:grid;gap:3px 32px;grid-template-columns:1fr 1fr;margin:8px 0 0;padding:0 4px}
.quote-document-preview__client-grid>div{display:grid;gap:10px;grid-template-columns:96px minmax(0,1fr)}
.quote-document-preview__client-grid dt{font-weight:700}
.quote-document-preview__client-grid dd{margin:0;overflow-wrap:anywhere}
.quote-document-preview__section{break-inside:avoid;border-top:1px solid var(--quote-border);margin-top:20px;padding-top:12px}
.quote-document-preview h3{font-size:11px;margin:0}
.quote-document-preview__scope h3{color:var(--quote-navy);letter-spacing:.12em;margin:0 0 10px;text-transform:uppercase}
.quote-document-preview__scope ul{margin:0;padding-left:18px}
.quote-document-preview__scope li{margin-bottom:5px}
.quote-document-preview__scope li::marker{color:var(--quote-red)}
.quote-document-preview__table-wrap{margin-top:16px;overflow-x:auto}
.quote-document-preview table{border-collapse:collapse;font-size:11.5px;width:100%}
.quote-document-preview th{background:var(--quote-navy);color:var(--quote-on-navy);font-size:10px;letter-spacing:.03em;padding:6px 7px;text-align:left;text-transform:uppercase}
.quote-document-preview td{border-bottom:1px solid var(--quote-border);padding:9px 7px;vertical-align:top}
.quote-document-preview td span{color:var(--quote-muted);display:block;font-size:10.5px;line-height:1.4;margin-top:3px;white-space:pre-wrap}
.quote-document-preview .numeric{text-align:right;white-space:nowrap}
.quote-document-preview__summary{align-items:start;display:grid;gap:24px;grid-template-columns:minmax(0,1fr) minmax(240px,.42fr);margin-top:22px}
.quote-document-preview__summary--totals-only{grid-template-columns:minmax(0,1fr)}
.quote-document-preview__terms{border:1px solid var(--quote-navy);break-inside:avoid}
.quote-document-preview__terms ol{margin:0;padding:8px 10px 8px 30px}
.quote-document-preview__terms li{margin:3px 0;overflow-wrap:anywhere;white-space:pre-wrap}
.quote-document-preview__totals{border:1px solid var(--quote-navy);break-inside:avoid;justify-self:end;max-width:330px;width:100%}
.quote-document-preview__totals>div{display:flex;gap:24px;justify-content:space-between;padding:5px 10px}
.quote-document-preview__totals>div span{color:var(--quote-muted)}
.quote-document-preview__total--strong{background:var(--color-document-tint);border-top:1px solid var(--quote-navy);color:var(--quote-navy);font-size:16px}
.quote-document-preview__total--strong span{color:var(--quote-navy)!important;font-weight:700;text-transform:uppercase}
.quote-document-preview__legacy-note{border-left:3px solid var(--color-document-warning-line);color:var(--color-document-warning-text);margin-top:14px!important;padding:5px 10px}
.quote-document-preview__acceptance{break-inside:avoid;margin-top:22px;text-align:center}
.quote-document-preview__acceptance>p{font-style:italic}
.quote-document-preview__signature-grid{display:grid;gap:20px 24px;grid-template-columns:repeat(4,1fr);margin-top:34px;text-align:left}
.quote-document-preview__signature-grid span{border-top:1px solid var(--quote-muted);color:var(--quote-muted);font-size:10px;padding-top:4px}
.quote-document-preview footer{border-top:1px solid var(--quote-border);color:var(--quote-muted);display:grid;font-size:11px;gap:2px;justify-items:center;margin-top:34px;padding-top:12px;text-align:center}
.quote-document-preview footer strong{color:var(--quote-ink)}
.quote-document-preview__empty{border:1px dashed var(--quote-muted);margin-top:24px;padding:18px;text-align:center}
@media(max-width:720px){.quote-document-preview{padding:24px 20px}.quote-document-preview__header{grid-template-columns:1fr}.quote-document-preview__identity{text-align:left}.quote-document-preview__identity dl>div{justify-content:flex-start}.quote-document-preview__client-grid,.quote-document-preview__summary{grid-template-columns:1fr}.quote-document-preview__totals{justify-self:stretch;max-width:none}.quote-document-preview__signature-grid{grid-template-columns:1fr 1fr}.quote-document-preview__logo{max-width:200px}}
@media print{@page{size:A4;margin:14mm}.quote-document-preview{border:0;max-width:none;padding:0}.quote-document-preview__table-wrap{overflow:visible}.quote-document-preview thead{display:table-header-group}.quote-document-preview tr,.quote-document-preview__summary{break-inside:avoid}}
`;

export default QuotePrintView;
