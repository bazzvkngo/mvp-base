import assert
  from "node:assert/strict";

import {
  VETERINARY_TRIAGE_LIMITS,
  VETERINARY_TRIAGE_PRIORITIES,
  buildVeterinaryReceptionMutationPayload,
  buildVeterinaryTriageMutationPayload,
  canStartVeterinaryReception,
  getVeterinaryReceptionFieldErrors,
  getVeterinaryTriageFieldErrors,
} from "../src/features/veterinary/domain/receptionTriageModel.mjs";


function testReceptionValidPayload() {
  const payload =
    buildVeterinaryReceptionMutationPayload({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      tutorClienteId:
        "cliente-001",

      horaLlegada:
        "10:15",

      observacionesRecepcion:
        "  Paciente llega acompañado por su tutor.  ",
    });


  assert.deepEqual(
    payload,
    {
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      tutorClienteId:
        "cliente-001",

      horaLlegada:
        "10:15",

      observacionesRecepcion:
        "Paciente llega acompañado por su tutor.",
    }
  );
}


function testReceptionRequiredFields() {
  const errors =
    getVeterinaryReceptionFieldErrors(
      {}
    );


  assert.ok(
    errors.citaId
  );

  assert.ok(
    errors.pacienteId
  );

  assert.ok(
    errors.tutorClienteId
  );

  assert.ok(
    errors.horaLlegada
  );
}


function testReceptionInvalidTime() {
  const errors =
    getVeterinaryReceptionFieldErrors({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      tutorClienteId:
        "cliente-001",

      horaLlegada:
        "27:90",
    });


  assert.ok(
    errors.horaLlegada
  );
}


function testReceptionAuthorityFieldsAreRemoved() {
  const payload =
    buildVeterinaryReceptionMutationPayload({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      tutorClienteId:
        "cliente-001",

      horaLlegada:
        "10:15",

      observacionesRecepcion:
        "",

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


function testReceptionAppointmentStatuses() {
  assert.equal(
    canStartVeterinaryReception({
      estado:
        "agendada",
    }),
    true
  );


  assert.equal(
    canStartVeterinaryReception({
      estado:
        "confirmada",
    }),
    true
  );


  assert.equal(
    canStartVeterinaryReception({
      estado:
        "cancelada",
    }),
    false
  );


  assert.equal(
    canStartVeterinaryReception({
      estado:
        "completada",
    }),
    false
  );
}


function testTriagePriorities() {
  assert.deepEqual(
    [
      ...VETERINARY_TRIAGE_PRIORITIES,
    ],
    [
      "normal",
      "prioritaria",
      "urgente",
    ]
  );
}


function testTriageValidPayload() {
  const payload =
    buildVeterinaryTriageMutationPayload({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      prioridad:
        "normal",

      pesoKg:
        "12.5",

      temperaturaC:
        "38.4",

      frecuenciaCardiaca:
        "90",

      frecuenciaRespiratoria:
        "24",

      observacionesTriage:
        "  Paciente alerta y estable.  ",
    });


  assert.deepEqual(
    payload,
    {
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      prioridad:
        "normal",

      pesoKg:
        12.5,

      temperaturaC:
        38.4,

      frecuenciaCardiaca:
        90,

      frecuenciaRespiratoria:
        24,

      observacionesTriage:
        "Paciente alerta y estable.",
    }
  );
}


function testTriageRequiredFields() {
  const errors =
    getVeterinaryTriageFieldErrors(
      {}
    );


  assert.ok(
    errors.citaId
  );

  assert.ok(
    errors.pacienteId
  );

  assert.ok(
    errors.prioridad
  );
}


function testTriageInvalidPriority() {
  const errors =
    getVeterinaryTriageFieldErrors({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      prioridad:
        "critica-inventada",
    });


  assert.ok(
    errors.prioridad
  );
}


function testTriageInvalidMeasurements() {
  const errors =
    getVeterinaryTriageFieldErrors({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      prioridad:
        "normal",

      pesoKg:
        "-10",

      temperaturaC:
        "0",

      frecuenciaCardiaca:
        "90.5",

      frecuenciaRespiratoria:
        "-3",
    });


  assert.ok(
    errors.pesoKg
  );

  assert.ok(
    errors.temperaturaC
  );

  assert.ok(
    errors.frecuenciaCardiaca
  );

  assert.ok(
    errors.frecuenciaRespiratoria
  );
}


function testTriageMeasurementLimits() {
  const base = {citaId: "cita-001", pacienteId: "paciente-001", prioridad: "normal"};
  const errorsFor = (field, value) =>
    getVeterinaryTriageFieldErrors({...base, [field]: value})[field];

  assert.deepEqual(
    Object.keys(VETERINARY_TRIAGE_LIMITS),
    ["pesoKg", "temperaturaC", "frecuenciaCardiaca", "frecuenciaRespiratoria"]
  );

  for (const [field, {min, max}] of Object.entries(VETERINARY_TRIAGE_LIMITS)) {
    assert.equal(errorsFor(field, String(min)), undefined, `${field}: el mínimo es válido`);
    assert.equal(errorsFor(field, String(max)), undefined, `${field}: el máximo es válido`);
    assert.ok(errorsFor(field, String(min - 1)), `${field}: bajo el mínimo`);
    assert.ok(errorsFor(field, String(max + 1)), `${field}: sobre el máximo`);
  }

  assert.ok(errorsFor("pesoKg", "0.005"), "0,005 kg es error de tipeo");
  assert.ok(errorsFor("pesoKg", "1200"), "1200 kg es error de tipeo");
  assert.ok(errorsFor("temperaturaC", "385"), "385 °C es error de tipeo");
  assert.ok(errorsFor("frecuenciaCardiaca", "9000"));
  assert.ok(errorsFor("frecuenciaRespiratoria", "1"));
  assert.match(errorsFor("pesoKg", "1500"), /entre 0,01 y 1000 kg/);
  assert.match(errorsFor("temperaturaC", "50"), /entre 20 y 45 °C/);
}


function testTriageOptionalMeasurements() {
  const payload =
    buildVeterinaryTriageMutationPayload({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      prioridad:
        "prioritaria",

      pesoKg:
        "",

      temperaturaC:
        "",

      frecuenciaCardiaca:
        "",

      frecuenciaRespiratoria:
        "",

      observacionesTriage:
        "",
    });


  assert.equal(
    payload.pesoKg,
    null
  );

  assert.equal(
    payload.temperaturaC,
    null
  );

  assert.equal(
    payload.frecuenciaCardiaca,
    null
  );

  assert.equal(
    payload.frecuenciaRespiratoria,
    null
  );
}


function testTriageAuthorityFieldsAreRemoved() {
  const payload =
    buildVeterinaryTriageMutationPayload({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      prioridad:
        "urgente",

      businessId:
        "negocio-falso",

      negocioId:
        "negocio-falso",

      creadoPorUid:
        "uid-falso",

      creadoEn:
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
}


testReceptionValidPayload();

testReceptionRequiredFields();

testReceptionInvalidTime();

testReceptionAuthorityFieldsAreRemoved();

testReceptionAppointmentStatuses();

testTriagePriorities();

testTriageValidPayload();

testTriageRequiredFields();

testTriageInvalidPriority();

testTriageInvalidMeasurements();

testTriageMeasurementLimits();

testTriageOptionalMeasurements();

testTriageAuthorityFieldsAreRemoved();


console.log(
  "OK veterinary-reception-triage-model-smoke"
);