import React from "react";
import { Link } from "react-router-dom";
import { LEGAL_DOCUMENTS } from "../domain/legalDocuments.mjs";
import { LEGAL_PROVIDER } from "../domain/legalDocumentsContent.mjs";
import BrandMark from "./brand/BrandMark";
import "./app-footer.css";

// Pie mínimo de ValoraCloud. Muestra solo la razón social de LEGAL_PROVIDER:
// RUT, domicilio y correo viven en los documentos legales, no aquí.
//
// Variantes:
//  - "ingreso": una línea de texto tenue, centrada y sin enlaces (Login).
//  - "cuenta": logo pequeño, el mismo texto y los enlaces legales (Mi cuenta).
//
// Se monta solo en esas dos pantallas; no forma parte del layout general.
const LEGAL_LINKS = [LEGAL_DOCUMENTS.privacidad, LEGAL_DOCUMENTS.terminos];

function AppFooter({ variant = "ingreso" }) {
  const isAccount = variant === "cuenta";
  const text = `ValoraCloud · © ${new Date().getFullYear()} ${LEGAL_PROVIDER.razonSocial}`;

  return (
    <footer
      className={`app-footer app-footer--${isAccount ? "cuenta" : "ingreso"}`}
      aria-label="Información de la empresa"
    >
      {isAccount && <BrandMark size={20} className="app-footer__mark" />}
      <p className="app-footer__text">{text}</p>
      {isAccount && (
        <nav className="app-footer__links" aria-label="Documentos legales">
          {LEGAL_LINKS.map((document) => (
            <Link
              key={document.key}
              className="app-footer__link"
              to={document.path}
              target="_blank"
              rel="noopener noreferrer"
            >
              {document.title}
            </Link>
          ))}
        </nav>
      )}
    </footer>
  );
}

export default AppFooter;
