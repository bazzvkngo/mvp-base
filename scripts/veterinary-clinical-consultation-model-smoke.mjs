import assert
  from "node:assert/strict";

import {
  buildVeterinaryClinicalConsultationMutationPayload,
  getVeterinaryClinicalConsultationFieldErrors,
} from "../src/features/veterinary/domain/clinicalConsultationModel.mjs";


function testValidPayload() {
  const payload =
    buildVeterinaryClinicalConsultationMutationPayload({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      motivoConsulta:
        "  Tutor refiere vómitos desde hace dos días.  ",

      anamnesis:
        "  Paciente con disminución del apetito.  ",

      examenClinico:
        "  Paciente alerta y estable.  ",
    });


  assert.deepEqual(
    payload,
    {
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      motivoConsulta:
        "Tutor refiere vómitos desde hace dos días.",

      anamnesis:
        "Paciente con disminución del apetito.",

      examenClinico:
        "Paciente alerta y estable.",
    }
  );
}


function testRequiredFields() {
  const errors =
    getVeterinaryClinicalConsultationFieldErrors(
      {}
    );


  assert.ok(
    errors.citaId
  );

  assert.ok(
    errors.pacienteId
  );

  assert.ok(
    errors.motivoConsulta
  );
}


function testOptionalClinicalFields() {
  const payload =
    buildVeterinaryClinicalConsultationMutationPayload({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      motivoConsulta:
        "Control general.",

      anamnesis:
        "",

      examenClinico:
        "",
    });


  assert.equal(
    payload.anamnesis,
    ""
  );

  assert.equal(
    payload.examenClinico,
    ""
  );
}


function testAuthorityFieldsAreRemoved() {
  const payload =
    buildVeterinaryClinicalConsultationMutationPayload({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      motivoConsulta:
        "Control general.",

      businessId:
        "negocio-falso",

      negocioId:
        "negocio-falso",

      creadoPorUid:
        "uid-falso",

      creadoEn:
        "fecha-falsa",

      actualizadoEn:
        "fecha-falsa",
    });


  assert.equal(
    Object.hasOwn(
      payload,
      "businessId"
    ),
    false
  );


  assert.equal(
    Object.hasOwn(
      payload,
      "negocioId"
    ),
    false
  );


  assert.equal(
    Object.hasOwn(
      payload,
      "creadoPorUid"
    ),
    false
  );


  assert.equal(
    Object.hasOwn(
      payload,
      "creadoEn"
    ),
    false
  );


  assert.equal(
    Object.hasOwn(
      payload,
      "actualizadoEn"
    ),
    false
  );
}


function testDoesNotCreateAttentionFields() {
  const payload =
    buildVeterinaryClinicalConsultationMutationPayload({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      motivoConsulta:
        "Control general.",

      diagnostico:
        "No debe entrar.",

      tratamiento:
        "No debe entrar.",
    });


  assert.equal(
    Object.hasOwn(
      payload,
      "diagnostico"
    ),
    false
  );


  assert.equal(
    Object.hasOwn(
      payload,
      "tratamiento"
    ),
    false
  );
}


testValidPayload();

testRequiredFields();

testOptionalClinicalFields();

testAuthorityFieldsAreRemoved();

testDoesNotCreateAttentionFields();


console.log(
  "OK veterinary-clinical-consultation-model-smoke"
);