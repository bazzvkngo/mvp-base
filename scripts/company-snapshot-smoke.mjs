import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {resolveDocumentCompany} from "../src/domain/companySnapshot.mjs";

const require = createRequire(import.meta.url);
const {
  buildAuthoritativeCompanySnapshot,
  getHistoricalCompanySnapshot,
  resolveCompanySnapshot,
} = require("../functions/companySnapshot");

const business = {
  nombreComercial: "Empresa raíz",
  paisCodigo: "CL",
  monedaCodigo: "CLP",
  locale: "es-CL",
  identificadorFiscalTipo: "RUT",
  identificadorFiscalValor: "76.000.000-0",
};
const profileA = {
  negocioId: "business-1",
  nombreComercial: "Empresa A",
  razonSocial: "Empresa Histórica A SpA",
  identificadorFiscalTipo: "RUT",
  identificadorFiscalValor: "76.111.111-1",
  direccion: "Dirección A 123",
  comunaNombre: "Santiago",
  regionNombre: "Metropolitana",
  email: "empresa-a@example.test",
  telefono: "+56 2 2000 0000",
};
const profileB = {...profileA, nombreComercial: "Empresa B", razonSocial: "Empresa Nueva B SpA"};

const snapshotA = buildAuthoritativeCompanySnapshot({
  businessId: "business-1",
  business,
  profile: profileA,
});
assert.deepEqual(snapshotA, {
  negocioId: "business-1",
  nombreComercial: "Empresa A",
  razonSocial: "Empresa Histórica A SpA",
  identificadorFiscalTipo: "RUT",
  identificadorFiscalValor: "76.111.111-1",
  giro: "",
  email: "empresa-a@example.test",
  telefono: "+56 2 2000 0000",
  direccion: "Dirección A 123",
  comunaCodigo: "",
  comunaNombre: "Santiago",
  ciudad: "",
  regionCodigo: "",
  regionNombre: "Metropolitana",
  regionEstado: "",
  codigoPostal: "",
  sitioWeb: "",
  logoUrl: "",
  responsable: "",
  cargoResponsable: "",
});
assert.equal("moneda" in snapshotA, false, "localización no se duplica dentro de empresaSnapshot");
assert.equal("locale" in snapshotA, false, "locale permanece en el snapshot documental raíz");
assert.equal("rut" in snapshotA, false, "la identificación fiscal usa un único nombre canónico");

const snapshotB = buildAuthoritativeCompanySnapshot({businessId: "business-1", business, profile: profileB});
assert.equal(resolveCompanySnapshot({empresaSnapshot: snapshotA}, snapshotB).razonSocial, "Empresa Histórica A SpA");
assert.equal(resolveCompanySnapshot({empresa: {nombreComercial: "Empresa legacy"}}, snapshotB).nombreComercial, "Empresa legacy");
assert.equal(resolveCompanySnapshot({}, snapshotB).razonSocial, "Empresa Nueva B SpA");
assert.equal(getHistoricalCompanySnapshot({}), null);
assert.equal(resolveDocumentCompany({empresaSnapshot: snapshotA}, snapshotB).razonSocial, "Empresa Histórica A SpA");
assert.equal(resolveDocumentCompany({empresa: {nombreComercial: "Empresa legacy"}}, snapshotB).nombreComercial, "Empresa legacy");
assert.equal(resolveDocumentCompany({}, snapshotB).razonSocial, "Empresa Nueva B SpA");
assert.equal(resolveDocumentCompany({empresaSnapshot: {}}, snapshotB).razonSocial, "Empresa Nueva B SpA");

console.log("Company snapshot smoke: OK");
