"use strict";

// Copia de src/domain/legalDocuments.mjs (functions/ no puede importar de
// src/). Mantener sincronizada: `npm run test:legal-documents` verifica la
// paridad.
const LEGAL_DOCUMENTS_VERSION = "2026-10-19";

const LEGAL_DOCUMENT_KEYS = Object.freeze({
  PRIVACY: "privacidad",
  TERMS: "terminos",
});

const LEGAL_DOCUMENTS = Object.freeze({
  [LEGAL_DOCUMENT_KEYS.PRIVACY]: Object.freeze({
    key: LEGAL_DOCUMENT_KEYS.PRIVACY,
    path: "/privacidad",
    title: "Política de privacidad",
  }),
  [LEGAL_DOCUMENT_KEYS.TERMS]: Object.freeze({
    key: LEGAL_DOCUMENT_KEYS.TERMS,
    path: "/terminos",
    title: "Términos de uso",
  }),
});

function isCurrentLegalVersion(version) {
  return typeof version === "string" && version === LEGAL_DOCUMENTS_VERSION;
}

module.exports = {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENTS_VERSION,
  LEGAL_DOCUMENT_KEYS,
  isCurrentLegalVersion,
};
