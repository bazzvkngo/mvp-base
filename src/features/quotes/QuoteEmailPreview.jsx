import React from "react";
import DocumentEmailPreview from "../../components/ui/DocumentEmailPreview";

// Vista previa del correo de cotización: usa la vista compartida y agrega el
// botón "Revisar y responder cotización", porque a la cotización se responde
// desde un enlace. El correo real lo arma siempre el servidor.
function QuoteEmailPreview({ preview }) {
  const { summary } = preview;
  const summaryRows = [
    { label: "Cotización", value: summary.numero || "—" },
    ...(summary.fecha ? [{ label: "Fecha", value: summary.fecha }] : []),
    { label: "Total", value: summary.total },
    { label: "Validez", value: `${summary.validezDias} días` },
  ];

  return (
    <DocumentEmailPreview
      address={preview.address}
      brand={preview.brand}
      contact={preview.contact}
      cta="Revisar y responder cotización"
      documentTitle="Cotización"
      from={preview.from}
      message={preview.message}
      note="El detalle de los productos, servicios, condiciones comerciales y observaciones se encuentra en el documento PDF adjunto."
      replyTo={preview.replyTo}
      subject={preview.subject}
      summaryRows={summaryRows}
      to={preview.to}
    />
  );
}

export default QuoteEmailPreview;
