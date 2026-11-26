import React from "react";

// Aproximación de lo que verá el destinatario de un documento enviado por correo:
// remitente, Reply-To, asunto, mensaje y la caja de datos que agrega el servidor.
// El correo real lo arma siempre el servidor. No asume que exista un enlace: el
// botón de acción (`cta`) solo se muestra si el documento lo pasa.
function DocumentEmailPreview({
  address,
  brand,
  contact,
  cta,
  documentTitle,
  from,
  message,
  note,
  replyTo,
  subject,
  summaryRows = [],
  to,
}) {
  return (
    <section className="quote-email-preview" aria-label="Vista previa del correo">
      <dl className="quote-email-preview__headers">
        <div>
          <dt>De</dt>
          <dd>{from}</dd>
        </div>
        <div>
          <dt>Para</dt>
          <dd>{to || "—"}</dd>
        </div>
        {replyTo && (
          <div>
            <dt>Responder a</dt>
            <dd>{replyTo}</dd>
          </div>
        )}
        <div>
          <dt>Asunto</dt>
          <dd>{subject || "—"}</dd>
        </div>
      </dl>

      <div className="quote-email-preview__body">
        {brand && <p className="quote-email-preview__brand">{brand}</p>}
        <p className="quote-email-preview__title">{documentTitle}</p>
        {message ? (
          <p className="quote-email-preview__message">{message}</p>
        ) : (
          <p className="quote-email-preview__message quote-email-preview__message--empty">
            Sin mensaje
          </p>
        )}

        <dl className="quote-email-preview__summary">
          {summaryRows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>

        {note && <p className="quote-email-preview__note">{note}</p>}

        {cta && (
          <p className="quote-email-preview__cta" aria-hidden="true">
            <span>{cta}</span>
          </p>
        )}

        {(contact || address) && (
          <div className="quote-email-preview__contact">
            {brand && <strong>Contacto {brand}</strong>}
            {contact && <span>{contact}</span>}
            {address && <span>{address}</span>}
          </div>
        )}

        <p className="quote-email-preview__footer">
          Este correo fue generado desde ValoraCloud.
        </p>
      </div>
    </section>
  );
}

export default DocumentEmailPreview;
