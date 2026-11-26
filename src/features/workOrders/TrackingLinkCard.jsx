import React, {useEffect, useState} from "react";
import {Check, Copy, MessageCircle} from "lucide-react";
import Button from "../../components/ui/Button";
import {trackingWhatsappMessage} from "../../domain/workOrderTrackingModel.mjs";
import {isPublicLookupEnabled} from "../../services/workshopTrackingService";
import {getWorkOrderErrorMessage, obtenerContactoClienteOT, obtenerSeguimientoOT} from "../../services/workOrderService";

// Seguimiento del cliente (prototipo «Panel del Taller»): con el ingreso aprobado, la OT tiene un enlace único
// para que el cliente vea cómo va su vehículo, y el taller una página de consulta con patente + RUT.
// El enlace no contiene la patente ni el RUT y deja de funcionar al entregar o anular la OT.
async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (_error) {
    return false;
  }
}

export default function TrackingLinkCard({businessId, order, otId, vehicleLabel}) {
  const [state, setState] = useState({loading: true, data: null, error: ""});
  const [phone, setPhone] = useState(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let active = true;
    setState({loading: true, data: null, error: ""});
    obtenerSeguimientoOT(businessId, otId)
      .then((data) => { if (active) setState({loading: false, data, error: ""}); })
      .catch((failure) => { if (active) setState({loading: false, data: null, error: getWorkOrderErrorMessage(failure)}); });
    obtenerContactoClienteOT(businessId, otId)
      .then((contact) => { if (active) setPhone(contact?.telefonoInternacional ? contact : null); })
      .catch(() => { if (active) setPhone(null); });
    return () => { active = false; };
  }, [businessId, otId]);

  const copy = async (kind, value) => {
    if (await copyText(value)) { setCopied(kind); window.setTimeout(() => setCopied(""), 2500); }
  };

  if (state.loading) return null;
  if (!state.data) {
    return state.error ? <div className="vehicle-message vehicle-message--error" role="alert">{state.error}</div> : null;
  }
  const {url, urlConsulta} = state.data;
  const message = encodeURIComponent(trackingWhatsappMessage(vehicleLabel, url, phone?.nombre));
  return <section className="erp-panel work-order-tracking" aria-labelledby="work-order-tracking-title">
    <h2 id="work-order-tracking-title" className="erp-panel-title">Seguimiento del cliente</h2>
    <p className="erp-secondary-text">Comparte el enlace para que el cliente vea cómo va su vehículo. Es único, no contiene la patente ni el RUT
      y deja de funcionar cuando el vehículo se entrega.</p>
    <div className="work-order-chip-row">
      <Button type="button" variant="secondary" icon={copied === "link" ? Check : Copy} onClick={() => copy("link", url)}>
        {copied === "link" ? "Enlace copiado" : "Copiar enlace"}</Button>
      {phone
        ? <a className="work-order-contact__link" href={`https://wa.me/${phone.telefonoInternacional}?text=${message}`}
          target="_blank" rel="noopener noreferrer"><MessageCircle size={16} aria-hidden="true" />Enviar por WhatsApp</a>
        : <span className="work-order-contact__link" aria-disabled="true"><MessageCircle size={16} aria-hidden="true" />Enviar por WhatsApp</span>}
    </div>
    {isPublicLookupEnabled() && <p className="erp-secondary-text">El cliente también puede consultar con su patente y RUT en <strong>{urlConsulta.replace(/^https?:\/\//, "")}</strong>.</p>}
  </section>;
}
