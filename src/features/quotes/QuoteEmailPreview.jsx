import React from "react";

// Aproximación de lo que verá el cliente: remitente, Reply-To, asunto, mensaje
// y la caja que agrega el servidor (N°, total, validez, PDF, botón y contacto).
// El correo real lo arma siempre el servidor.
function QuoteEmailPreview({ preview }) {
  const { summary } = preview;

  return (
    <section className="quote-email-preview" aria-label="Vista previa del correo">
      <dl className="quote-email-preview__headers">
        <div>
          <dt>De</dt>
          <dd>{preview.from}</dd>
        </div>
        <div>
          <dt>Para</dt>
          <dd>{preview.to || "—"}</dd>
        </div>
        {preview.replyTo && (
          <div>
            <dt>Responder a</dt>
            <dd>{preview.replyTo}</dd>
          </div>
        )}
        <div>
          <dt>Asunto</dt>
          <dd>{preview.subject || "—"}</dd>
        </div>
      </dl>

      <div className="quote-email-preview__body">
        {preview.brand && (
          <p className="quote-email-preview__brand">{preview.brand}</p>
        )}
        <p className="quote-email-preview__title">Cotización</p>
        {preview.message ? (
          <p className="quote-email-preview__message">{preview.message}</p>
        ) : (
          <p className="quote-email-preview__message quote-email-preview__message--empty">
            Sin mensaje
          </p>
        )}

        <dl className="quote-email-preview__summary">
          <div>
            <dt>Cotización</dt>
            <dd>{summary.numero || "—"}</dd>
          </div>
          {summary.fecha && (
            <div>
              <dt>Fecha</dt>
              <dd>{summary.fecha}</dd>
            </div>
          )}
          <div>
            <dt>Total</dt>
            <dd>{summary.total}</dd>
          </div>
          <div>
            <dt>Validez</dt>
            <dd>{summary.validezDias} días</dd>
          </div>
        </dl>

        <p className="quote-email-preview__note">
          El detalle de los productos, servicios, condiciones comerciales y
          observaciones se encuentra en el documento PDF adjunto.
        </p>

        <p className="quote-email-preview__cta" aria-hidden="true">
          <span>Revisar y responder cotización</span>
        </p>

        {(preview.contact || preview.address) && (
          <div className="quote-email-preview__contact">
            {preview.brand && <strong>Contacto {preview.brand}</strong>}
            {preview.contact && <span>{preview.contact}</span>}
            {preview.address && <span>{preview.address}</span>}
          </div>
        )}

        <p className="quote-email-preview__footer">
          Este correo fue generado desde ValoraCloud.
        </p>
      </div>
    </section>
  );
}

export default QuoteEmailPreview;
