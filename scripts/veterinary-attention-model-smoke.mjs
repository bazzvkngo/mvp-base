import assert
  from "node:assert/strict";

import {
  buildVeterinaryAttentionDraftPayload,
  buildVeterinaryAttentionMutationPayload,
  getVeterinaryAttentionFieldErrors,
} from "../src/features/veterinary/domain/attentionModel.mjs";


function testValidAttention() {
  const payload =
    buildVeterinaryAttentionMutationPayload({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      motivoConsulta:
        "  Tutor refiere vómitos.  ",

      diagnostico:
        "  Gastritis aguda.  ",

      tratamiento:
        "  Dieta blanda y tratamiento sintomático.  ",

      indicaciones:
        "  Control en 48 horas.  ",

      servicios: [
        {
          itemId:
            "servicio-001",

          nombre:
            "Consulta veterinaria",

          codigoInterno:
            "SER-001",

          unidad:
            "servicio",

          cantidad:
            1,
        },
      ],

      productos: [
        {
          itemId:
            "producto-001",

          nombre:
            "Medicamento veterinario",

          codigoInterno:
            "PRO-001",

          unidad:
            "unidad",

          cantidad:
            2,
        },
      ],
    });


  assert.equal(
    payload.diagnostico,
    "Gastritis aguda."
  );


  assert.equal(
    payload.tratamiento,
    "Dieta blanda y tratamiento sintomático."
  );


  assert.equal(
    payload.servicios.length,
    1
  );


  assert.equal(
    payload.productos.length,
    1
  );


  assert.equal(
    payload.servicios[0].tipoItem,
    "servicio"
  );


  assert.equal(
    payload.productos[0].tipoItem,
    "producto"
  );
}


function testRequiredFields() {
  const errors =
    getVeterinaryAttentionFieldErrors(
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

  assert.ok(
    errors.diagnostico
  );

  assert.ok(
    errors.tratamiento
  );
}


function testItemsAreOptional() {
  const payload =
    buildVeterinaryAttentionMutationPayload({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      motivoConsulta:
        "Control.",

      diagnostico:
        "Paciente estable.",

      tratamiento:
        "Sin tratamiento farmacológico.",
    });


  assert.deepEqual(
    payload.servicios,
    []
  );


  assert.deepEqual(
    payload.productos,
    []
  );
}


function testInvalidQuantity() {
  const errors =
    getVeterinaryAttentionFieldErrors({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      motivoConsulta:
        "Control.",

      diagnostico:
        "Paciente estable.",

      tratamiento:
        "Observación.",

      productos: [
        {
          itemId:
            "producto-001",

          nombre:
            "Producto veterinario",

          cantidad:
            0,
        },
      ],
    });


  assert.ok(
    errors.productos
  );
}


function testDuplicateItems() {
  const errors =
    getVeterinaryAttentionFieldErrors({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      motivoConsulta:
        "Control.",

      diagnostico:
        "Paciente estable.",

      tratamiento:
        "Observación.",

      servicios: [
        {
          itemId:
            "servicio-001",

          nombre:
            "Consulta",

          cantidad:
            1,
        },

        {
          itemId:
            "servicio-001",

          nombre:
            "Consulta",

          cantidad:
            1,
        },
      ],
    });


  assert.ok(
    errors.servicios
  );
}


function testInventoryAuthorityFieldsAreRemoved() {
  const payload =
    buildVeterinaryAttentionMutationPayload({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      motivoConsulta:
        "Control.",

      diagnostico:
        "Paciente estable.",

      tratamiento:
        "Observación.",

      productos: [
        {
          itemId:
            "producto-001",

          nombre:
            "Medicamento",

          cantidad:
            1,

          stock:
            99999,

          costoBase:
            1,

          precioInterno:
            1,

          negocioId:
            "negocio-falso",

          businessId:
            "negocio-falso",
        },
      ],
    });


  const product =
    payload.productos[0];


  assert.equal(
    Object.hasOwn(
      product,
      "stock"
    ),
    false
  );


  assert.equal(
    Object.hasOwn(
      product,
      "costoBase"
    ),
    false
  );


  assert.equal(
    Object.hasOwn(
      product,
      "precioInterno"
    ),
    false
  );


  assert.equal(
    Object.hasOwn(
      product,
      "negocioId"
    ),
    false
  );


  assert.equal(
    Object.hasOwn(
      product,
      "businessId"
    ),
    false
  );
}


function testAttentionAuthorityFieldsAreRemoved() {
  const payload =
    buildVeterinaryAttentionMutationPayload({
      citaId:
        "cita-001",

      pacienteId:
        "paciente-001",

      motivoConsulta:
        "Control.",

      diagnostico:
        "Paciente estable.",

      tratamiento:
        "Observación.",

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

      estado:
        "cerrada",
    });


  for (
    const field of [
      "businessId",
      "negocioId",
      "creadoPorUid",
      "creadoEn",
      "actualizadoEn",
      "estado",
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


function testDraft() {
  // El borrador no exige los obligatorios del cierre.
  assert.deepEqual(buildVeterinaryAttentionDraftPayload({}), {
    motivoConsulta: "", diagnostico: "", tratamiento: "", indicaciones: "", resultadoClinico: "",
  });
  const draft = buildVeterinaryAttentionDraftPayload({
    motivoConsulta: "Control", diagnostico: "Línea 1\r\nLínea 2 ", tratamiento: "", indicaciones: "Reposo",
    resultadoClinico: "Control",
    items: [{itemId: "producto-1", cantidad: "2.5", nombre: "Nombre manipulado", precio: 1}, {itemId: "servicio-1", cantidad: 1}],
  });
  assert.equal(draft.diagnostico, "Línea 1\nLínea 2 ");
  assert.equal(draft.resultadoClinico, "control");
  assert.deepEqual(draft.items, [{itemId: "producto-1", cantidad: 2.5}, {itemId: "servicio-1", cantidad: 1}]);
  // Sin "items" no hay lista (la Function conserva la anterior).
  assert.equal(Object.hasOwn(buildVeterinaryAttentionDraftPayload({diagnostico: "x"}), "items"), false);
  assert.deepEqual(buildVeterinaryAttentionDraftPayload({items: []}).items, []);
  const rejects = (data, field) => assert.throws(
    () => buildVeterinaryAttentionDraftPayload(data),
    (error) => Boolean(error.fieldErrors?.[field]),
  );
  rejects({resultadoClinico: "inventado"}, "resultadoClinico");
  rejects({diagnostico: "a".repeat(4001)}, "diagnostico");
  rejects({diagnostico: {texto: "x"}}, "diagnostico");
  rejects({items: [{itemId: "a", cantidad: 0}]}, "items");
  rejects({items: [{itemId: "a", cantidad: 1}, {itemId: "a", cantidad: 2}]}, "items");
  rejects({items: [{itemId: "../malo", cantidad: 1}]}, "items");
  rejects({items: "no es lista"}, "items");
  rejects({items: Array.from({length: 101}, (_, index) => ({itemId: "i" + index, cantidad: 1}))}, "items");
}


testValidAttention();

testDraft();

testRequiredFields();

testItemsAreOptional();

testInvalidQuantity();

testDuplicateItems();

testInventoryAuthorityFieldsAreRemoved();

testAttentionAuthorityFieldsAreRemoved();


console.log(
  "OK veterinary-attention-model-smoke"
);