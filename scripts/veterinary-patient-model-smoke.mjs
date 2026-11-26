import assert from "node:assert/strict";

import {
  buildVeterinaryPatientMutationPayload,
  formatVeterinaryPatientAge,
  getVeterinaryPatientFieldErrors,
} from "../src/features/veterinary/domain/patientModel.mjs";

const TODAY = new Date(2026, 8, 9);

const validPatient = {
  tutorClienteId: "cliente-001",
  nombre: "Luna",
  especie: "Canino",
  raza: "Labrador",
  sexo: "Hembra",
  fechaNacimiento: "2022-05-10",
  edadEstimada: "",
  peso: 24.5,
  color: "Dorado",
  microchip: "CHIP-001",
  alergias: "",
  antecedentes: "Sin antecedentes relevantes",
  observaciones: "",

  // Estos campos no deben entrar al payload.
  businessId: "negocio-falso",
  negocioId: "negocio-falso",
  creadoPorUid: "usuario-falso",
  creadoEn: "fecha-falsa",
  estado: "fallecido",
};

const payload =
  buildVeterinaryPatientMutationPayload(
    validPatient,
    { today: TODAY }
  );

assert.equal(
  payload.tutorClienteId,
  "cliente-001"
);

assert.equal(
  payload.nombre,
  "Luna"
);

assert.equal(
  payload.especie,
  "Canino"
);

assert.equal(
  payload.peso,
  24.5
);

assert.equal(
  "businessId" in payload,
  false
);

assert.equal(
  "negocioId" in payload,
  false
);

assert.equal(
  "creadoPorUid" in payload,
  false
);

assert.equal(
  "creadoEn" in payload,
  false
);

assert.equal(
  "estado" in payload,
  false
);

const requiredErrors =
  getVeterinaryPatientFieldErrors(
    {},
    { today: TODAY }
  );

assert.ok(requiredErrors.tutorClienteId);
assert.ok(requiredErrors.nombre);
assert.ok(requiredErrors.especie);

const futureDateErrors =
  getVeterinaryPatientFieldErrors(
    {
      tutorClienteId: "cliente-001",
      nombre: "Luna",
      especie: "Canino",
      fechaNacimiento: "2027-01-01",
    },
    { today: TODAY }
  );

assert.equal(
  futureDateErrors.fechaNacimiento,
  "La fecha de nacimiento no puede ser futura."
);

const zeroWeightErrors =
  getVeterinaryPatientFieldErrors(
    {
      tutorClienteId: "cliente-001",
      nombre: "Luna",
      especie: "Canino",
      peso: 0,
    },
    { today: TODAY }
  );

assert.equal(
  zeroWeightErrors.peso,
  "El peso debe ser un número mayor que cero."
);

const negativeWeightErrors =
  getVeterinaryPatientFieldErrors(
    {
      tutorClienteId: "cliente-001",
      nombre: "Luna",
      especie: "Canino",
      peso: -5,
    },
    { today: TODAY }
  );

assert.equal(
  negativeWeightErrors.peso,
  "El peso debe ser un número mayor que cero."
);

assert.equal(formatVeterinaryPatientAge("2022-05-10", "2026-11-12"), "4 años y 6 meses");
assert.equal(formatVeterinaryPatientAge("2026-11-10", "2026-11-12"), "2 días");
assert.equal(formatVeterinaryPatientAge("2026-11-12", "2026-11-12"), "0 días");
assert.equal(formatVeterinaryPatientAge("2024-02-29", "2025-02-28"), "1 año");
assert.equal(formatVeterinaryPatientAge("2027-01-01", "2026-11-12"), "");
assert.equal(formatVeterinaryPatientAge("2026-02-30", "2026-11-12"), "");
assert.equal(formatVeterinaryPatientAge("2025-11-12", {toDate: () => new Date(2026, 10, 12)}), "1 año");
assert.equal(formatVeterinaryPatientAge("2022-05-10", null), "");
console.log("OK veterinary-patient-model-smoke");