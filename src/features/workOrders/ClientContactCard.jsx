import React, {useEffect, useState} from "react";
import {MessageCircle, Phone} from "lucide-react";
import {obtenerContactoClienteOT} from "../../services/workOrderService";

// Contacto rápido con el cliente de la OT: llamar al teléfono registrado o abrir WhatsApp con un mensaje listo.
// El teléfono lo entrega el servidor solo al Owner, al Administrador y al responsable de la OT.
export function whatsappMessage(order, vehicleLabel, name) {
  const first = String(name || "").trim().split(" ")[0];
  const greeting = first ? `Hola ${first}` : "Hola";
  return order.estado === "pendiente_entrega"
    ? `${greeting}, su vehículo ${vehicleLabel} está listo para retiro.`
    : `${greeting}, le escribimos por su vehículo ${vehicleLabel}.`;
}

export default function ClientContactCard({businessId, order, otId, vehicleLabel}) {
  const [contact, setContact] = useState(null);
  const [state, setState] = useState("loading");

  useEffect(() => {
    let active = true;
    setState("loading");
    obtenerContactoClienteOT(businessId, otId)
      .then((data) => { if (active) { setContact(data); setState("ready"); } })
      .catch((failure) => {
        if (!active) return;
        // Sin permiso la tarjeta no se muestra; cualquier otro caso (p. ej. cliente sin ficha) conserva el mismo diseño.
        setState(String(failure?.code || "").includes("permission-denied") ? "hidden" : "ready");
      });
    return () => { active = false; };
  }, [businessId, otId]);

  if (state === "loading" || state === "hidden") return null;
  const phone = contact?.telefono && contact?.telefonoInternacional ? contact : null;
  const message = encodeURIComponent(whatsappMessage(order, vehicleLabel, contact?.nombre));
  return <section className="erp-panel work-order-contact" aria-label="Contactar al cliente">
    <div className="work-order-contact__info">
      <strong>{contact?.nombre || "Cliente"}</strong>
      <span className="erp-secondary-text">{phone ? phone.telefono : "Sin teléfono registrado"}</span>
    </div>
    <div className="work-order-chip-row">
      {phone
        ? <>
          <a className="work-order-contact__link" href={`tel:+${phone.telefonoInternacional}`}>
            <Phone size={16} aria-hidden="true" />Llamar</a>
          <a className="work-order-contact__link" href={`https://wa.me/${phone.telefonoInternacional}?text=${message}`}
            target="_blank" rel="noopener noreferrer"><MessageCircle size={16} aria-hidden="true" />WhatsApp</a>
        </>
        : <>
          <span className="work-order-contact__link" aria-disabled="true"><Phone size={16} aria-hidden="true" />Llamar</span>
          <span className="work-order-contact__link" aria-disabled="true"><MessageCircle size={16} aria-hidden="true" />WhatsApp</span>
        </>}
    </div>
  </section>;
}
