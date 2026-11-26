// Versión común de los documentos legales (SPEC 024). Cambiarla exige
// re-aceptación. Duplicada en functions/legalDocuments.js: mantener ambas
// sincronizadas (la paridad la verifica `npm run test:legal-documents`).
export const LEGAL_DOCUMENTS_VERSION = "2026-10-19";

export const LEGAL_DOCUMENT_KEYS = Object.freeze({
  PRIVACY: "privacidad",
  TERMS: "terminos",
});

export const LEGAL_DOCUMENTS = Object.freeze({
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

export function isCurrentLegalVersion(version) {
  return typeof version === "string" && version === LEGAL_DOCUMENTS_VERSION;
}
