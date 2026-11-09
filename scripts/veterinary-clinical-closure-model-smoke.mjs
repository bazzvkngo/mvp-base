import assert
  from "node:assert/strict";

import {
  buildVeterinaryClinicalClosureMutationPayload,
  buildVeterinarySaleHandoffFromAttention,
  buildVeterinarySaleHandoffPayload,
  getVeterinaryClinicalClosureFieldErrors,
  getVeterinarySaleHandoffFieldErrors,
} from "../src/features/veterinary/domain/clinicalClosureModel.mjs";


function testValidClosure() {
  const payload =
    buildVeterinaryClinicalClosureMutationPayload({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      resultadoClinico:
        "alta",

      resumenCierre:
        "  Paciente estable al finalizar la atención.  ",

      indicacionesCierre:
        "  Mantener dieta blanda durante 48 horas.  ",

      proximoControl:
        "2026-10-15",

      prepararVenta:
        true,
    });


  assert.deepEqual(
    payload,
    {
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      resultadoClinico:
        "alta",

      resumenCierre:
        "Paciente estable al finalizar la atención.",

      indicacionesCierre:
        "Mantener dieta blanda durante 48 horas.",

      proximoControl:
        "2026-10-15",

      prepararVenta:
        true,
    }
  );
}


function testClosureRequiredFields() {
  const errors =
    getVeterinaryClinicalClosureFieldErrors(
      {}
    );


  assert.ok(
    errors.citaId
  );

  assert.ok(
    errors.pacienteId
  );

  assert.ok(
    errors.resultadoClinico
  );
}


function testInvalidOutcome() {
  const errors =
    getVeterinaryClinicalClosureFieldErrors({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      resultadoClinico:
        "inventado",
    });


  assert.ok(
    errors.resultadoClinico
  );
}


function testInvalidControlDate() {
  const errors =
    getVeterinaryClinicalClosureFieldErrors({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      resultadoClinico:
        "control",

      proximoControl:
        "2026-99-99",
    });


  assert.ok(
    errors.proximoControl
  );
}


function testClosureAuthorityFieldsAreRemoved() {
  const payload =
    buildVeterinaryClinicalClosureMutationPayload({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      resultadoClinico:
        "alta",

      businessId:
        "negocio-falso",

      negocioId:
        "negocio-falso",

      estado:
        "cerrada",

      creadoPorUid:
        "uid-falso",

      creadoEn:
        "fecha-falsa",

      actualizadoEn:
        "fecha-falsa",
    });


  for (
    const field of [
      "businessId",
      "negocioId",
      "estado",
      "creadoPorUid",
      "creadoEn",
      "actualizadoEn",
    ]
  ) {
    assert.equal(
      Object.hasOwn(
        payload,
        field
      ),
      false
    );
  }
}


function testValidSaleHandoff() {
  const payload =
    buildVeterinarySaleHandoffPayload({
      clienteId:
        "cliente-001",

      lineas: [
        {
          itemId:
            "servicio-001",

          tipoItem:
            "servicio",

          cantidad:
            1,

          precio:
            999999,

          stock:
            999999,
        },

        {
          itemId:
            "producto-001",

          tipoItem:
            "producto",

          cantidad:
            2,
        },
      ],

      observaciones:
        "  Atención veterinaria.  ",

      ventaId:
        "venta-falsa",

      total:
        1,

      negocioId:
        "negocio-falso",
    });


  assert.equal(
    payload.clienteId,
    "cliente-001"
  );


  assert.equal(
    payload.lineas.length,
    2
  );


  assert.deepEqual(
    payload.lineas[0],
    {
      itemId:
        "servicio-001",

      tipoItem:
        "servicio",

      cantidad:
        1,
    }
  );


  assert.equal(
    Object.hasOwn(
      payload,
      "ventaId"
    ),
    false
  );


  assert.equal(
    Object.hasOwn(
      payload,
      "total"
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
      payload.lineas[0],
      "precio"
    ),
    false
  );


  assert.equal(
    Object.hasOwn(
      payload.lineas[0],
      "stock"
    ),
    false
  );
}


function testSaleRequiresClientAndLines() {
  const errors =
    getVeterinarySaleHandoffFieldErrors(
      {}
    );


  assert.ok(
    errors.clienteId
  );

  assert.ok(
    errors.lineas
  );
}


function testSaleHandoffFromAttention() {
  const payload =
    buildVeterinarySaleHandoffFromAttention({
      clienteId:
        "cliente-001",

      attention: {
        servicios: [
          {
            itemId:
              "servicio-001",

            cantidad:
              1,

            nombre:
              "Consulta veterinaria",
          },
        ],

        productos: [
          {
            itemId:
              "producto-001",

            cantidad:
              2,

            nombre:
              "Medicamento",
          },
        ],
      },

      observaciones:
        "Atención veterinaria cerrada.",
    });


  assert.deepEqual(
    payload.lineas,
    [
      {
        itemId:
          "servicio-001",

        tipoItem:
          "servicio",

        cantidad:
          1,
      },

      {
        itemId:
          "producto-001",

        tipoItem:
          "producto",

        cantidad:
          2,
      },
    ]
  );
}


function testNoItemsCannotPrepareSale() {
  assert.throws(
    () =>
      buildVeterinarySaleHandoffFromAttention({
        clienteId:
          "cliente-001",

        attention: {
          servicios: [],
          productos: [],
        },
      })
  );
}


testValidClosure();

testClosureRequiredFields();

testInvalidOutcome();

testInvalidControlDate();

testClosureAuthorityFieldsAreRemoved();

testValidSaleHandoff();

testSaleRequiresClientAndLines();

testSaleHandoffFromAttention();

testNoItemsCannotPrepareSale();


console.log(
  "OK veterinary-clinical-closure-model-smoke"
);