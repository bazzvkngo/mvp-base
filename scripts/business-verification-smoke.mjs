import assert from "node:assert/strict";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const {
  VERIFICATION_STATES,
  currentVerification,
  fiscalDataChanged,
  verificationIdentityKey,
} = require("../functions/businessVerification.js");

assert.equal(currentVerification({}).estado, VERIFICATION_STATES.NOT_VERIFIED);
assert.equal(verificationIdentityKey("CL", "760000000"), "CL__760000000");
assert.equal(verificationIdentityKey("bo", "12-345"), "BO__12345");

const business = {
  paisCodigo: "CL",
  identificadorFiscalTipo: "RUT",
  identificadorFiscalValor: "76.000.000-0",
};
const profile = {razonSocial: "Empresa Verificada SpA"};
const unchanged = {
  ...business,
  razonSocial: profile.razonSocial,
  telefono: "+56 9 1111 1111",
};
assert.equal(fiscalDataChanged(business, profile, unchanged), false);
assert.equal(fiscalDataChanged(business, profile, {
  ...unchanged,
  identificadorFiscalValor: "77.777.777-7",
}), true);
assert.equal(fiscalDataChanged(business, profile, {
  ...unchanged,
  razonSocial: "Otra Razón Social SpA",
}), true);

console.log("Business verification smoke: OK");
