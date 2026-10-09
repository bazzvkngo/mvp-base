import React from "react";
import {MessageCircle} from "lucide-react";
import AppIcon from "../ui/AppIcon";
import {getContactEmailHref, getContactPhoneLinks} from "../../domain/contactFormatting.mjs";

// Correo y teléfono clicables (mailto:, tel: y WhatsApp cuando el número es
// un celular). Un valor que no permite enlace se muestra como texto.
function ContactLinks({countryCode = "CL", email, name, telefono}) {
  const emailHref = getContactEmailHref(email);
  const phoneLinks = getContactPhoneLinks(telefono, countryCode);
  if (!email && !telefono) return <span className="ui-contact-links__empty">Sin datos de contacto</span>;
  return (
    <span className="ui-contact-links">
      {email && (emailHref
        ? <a className="ui-contact-link" href={emailHref}>{email}</a>
        : <span>{email}</span>)}
      {telefono && (
        <span className="ui-contact-links__phone">
          {phoneLinks.tel
            ? <a className="ui-contact-link" href={phoneLinks.tel}>{telefono}</a>
            : <span>{telefono}</span>}
          {phoneLinks.whatsapp && (
            <a
              className="ui-contact-link ui-contact-link--whatsapp"
              href={phoneLinks.whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Abrir WhatsApp con ${name || telefono}`}
              title="Abrir WhatsApp"
            >
              <AppIcon icon={MessageCircle} size={16} />
            </a>
          )}
        </span>
      )}
    </span>
  );
}

export default ContactLinks;
