import React from "react";
import { CubeIcon } from "../../components/BrandLogo";
import {
  adaptStoredQuote,
  getQuoteDisplayNumber,
} from "../../domain/quoteModel.mjs";
import { getDefaultFiscalIdentifierLabel } from "../../domain/businessCatalog";
import { getCountryFormCopy } from "../../domain/countryFormCopy.mjs";
import { resolveDocumentCompany } from "../../domain/companySnapshot.mjs";
import { buildNetTotalsRows, getLegalNameBelowTitle } from "../../domain/documentPrintLayout.mjs";
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
          <OptionalLine value={getLegalNameBelowTitle(company, brand)} />
          <OptionalLine label={getCountryFormCopy(quote.paisCodigo).businessActivityLabel} value={company.giro} />
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
          {buildNetTotalsRows({ subtotal: quote.subtotal, descuentoTotal: quote.descuentoTotal, neto: quote.neto, discountLabel: "Descuento" }).map((row) => (
            <TotalRow key={row.key} label={row.label} value={row.negative ? `-${money(row.amount)}` : money(row.amount)} />
          ))}
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
//
// Impresión: lo impreso debe verse igual que esta vista previa.
// - Una sola regla de página para la cotización: `@page quote` (A4, 14 mm), con nombre, y el documento la usa con
//   `page: quote`. Así no compite con las reglas @page globales (globals.css y purchase-orders.css, que siguen
//   gobernando Ventas, Compras y Órdenes de compra) ni depende del orden en que cargan los estilos.
// - Mismo diseño que en pantalla: el documento se maqueta con el ancho del contenido de la vista previa (836 px: 920 px
//   de la vista menos su relleno de 42 px por lado) y se reduce con `zoom` al ancho útil de la hoja (182 mm = 688 px:
//   836 x 0,82 = 685 px). Con el ancho de la hoja a tamaño real, las columnas se apretaban y todo se reacomodaba.
// - El diseño ancho no depende del ancho del viewport. Al imprimir, el navegador evalúa los @media (max-width) con el ancho
//   útil de la hoja (A4 menos 14 mm por lado = 182 mm = 688 px), no con el de la ventana, y `zoom` no lo cambia: el bloque
//   responsivo de pantalla (max-width: 720px) se activaba y apilaba el encabezado, el cliente y los totales, y el pie caía
//   solo a una segunda hoja. Por eso ese bloque es `@media screen and (...)`: en impresión nunca aplica y el documento
//   conserva siempre el diseño de escritorio de la vista previa. Una regla responsiva nueva de este documento debe ir
//   también bajo `screen` (la prueba quote-model-smoke lo exige) y no se usan @container.
// - El enlace "Saltar al contenido principal" (.skip-link) se oculta al imprimir con una regla global en globals.css
//   (@media print), igual que la barra lateral y la superior: no es parte de ningún documento.
// - Fuente, color y fondo propios del documento: no dependen de lo que globals.css fija en html y body al imprimir. Con
//   el tema oscuro de la app, la hoja se imprime como papel claro (color-scheme: light en la raíz solo mientras haya un
//   documento de cotización): sin eso el navegador pintaba de oscuro los márgenes y el contenedor del historial.
// - print-color-adjust: exact en todo el documento (bandas, encabezado de tabla y realce del TOTAL se imprimen aunque el
//   navegador tenga desactivados los gráficos de fondo).
// - Cortes de página: una fila de la tabla, los términos, los totales, el pie y los bloques con banda no se parten; el
//   encabezado de la tabla se repite en cada página.
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
@media screen and (max-width:720px){.quote-document-preview{padding:24px 20px}.quote-document-preview__header{grid-template-columns:1fr}.quote-document-preview__identity{text-align:left}.quote-document-preview__identity dl>div{justify-content:flex-start}.quote-document-preview__client-grid,.quote-document-preview__summary{grid-template-columns:1fr}.quote-document-preview__totals{justify-self:stretch;max-width:none}.quote-document-preview__signature-grid{grid-template-columns:1fr 1fr}.quote-document-preview__logo{max-width:200px}}
@page quote{size:A4;margin:14mm}
@media print{
html:root:has(.quote-document-preview){background:var(--color-document-paper);color-scheme:light;page:quote}
.quote-document-preview{background:var(--color-document-paper);border:0;box-sizing:border-box;color:var(--quote-ink);font:13px/1.5 Arial,Helvetica,sans-serif;margin:0;max-width:none;padding:0;width:836px;zoom:.82}
.quote-document-preview,.quote-document-preview *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.quote-document-preview__table-wrap{overflow:visible}
.quote-document-preview thead{display:table-header-group}
.quote-document-preview tr,.quote-document-preview__summary,.quote-document-preview__totals,.quote-document-preview__terms,.quote-document-preview footer{break-inside:avoid}
.quote-document-preview__band,.quote-document-preview__scope h3{break-after:avoid}
}
`;

export default QuotePrintView;
