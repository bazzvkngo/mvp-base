import { VETERINARY_CLINICAL_OUTCOMES } from "./clinicalClosureModel.mjs";
import { isValidVeterinaryQuantity } from "./quantityValidation.mjs";

export const VETERINARY_ATTENTION_ITEM_TYPES =
  Object.freeze([
    "servicio",
    "producto",
  ]);


function normalizeText(
  value,
  maxLength = 500
) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}


function normalizeNumber(
  value
) {
  if (
    value === "" ||
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


function normalizeReferenceItem(
  rawItem = {},
  expectedType
) {
  return {
    itemId:
      normalizeText(
        rawItem.itemId,
        120
      ),

    tipoItem:
      expectedType,

    nombre:
      normalizeText(
        rawItem.nombre,
        180
      ),

    codigoInterno:
      normalizeText(
        rawItem.codigoInterno,
        120
      ),

    unidad:
      normalizeText(
        rawItem.unidad,
        80
      ),

    cantidad:
      normalizeNumber(
        rawItem.cantidad
      ),
  };
}


function getReferenceItemErrors(
  rawItems,
  expectedType,
  fieldName
) {
  const errors = [];

  if (!Array.isArray(rawItems)) {
    return [
      `${fieldName} debe ser una lista.`,
    ];
  }


  if (rawItems.length > 50) {
    errors.push(
      `No puedes registrar más de 50 ${fieldName}.`
    );

    return errors;
  }


  const seenIds =
    new Set();


  rawItems.forEach(
    (rawItem, index) => {

      const item =
        normalizeReferenceItem(
          rawItem,
          expectedType
        );


      if (!item.itemId) {
        errors.push(
          `${fieldName}[${index}]: falta itemId.`
        );
      }


      if (!item.nombre) {
        errors.push(
          `${fieldName}[${index}]: falta nombre.`
        );
      }


      if (!isValidVeterinaryQuantity(item.cantidad)) {
        errors.push(
          `${fieldName}[${index}]: la cantidad debe ser mayor que cero.`
        );
      }


      if (
        item.itemId &&
        seenIds.has(
          item.itemId
        )
      ) {
        errors.push(
          `${fieldName}[${index}]: el ítem está duplicado.`
        );
      }


      if (item.itemId) {
        seenIds.add(
          item.itemId
        );
      }
    }
  );


  return errors;
}


export function getVeterinaryAttentionFieldErrors(
  rawData = {}
) {
  const data =
    rawData &&
    typeof rawData === "object"
      ? rawData
      : {};


  const errors = {};


  const citaId =
    normalizeText(
      data.citaId,
      120
    );


  const pacienteId =
    normalizeText(
      data.pacienteId,
      120
    );


  const motivoConsulta =
    normalizeText(
      data.motivoConsulta,
      1000
    );


  const diagnostico =
    normalizeText(
      data.diagnostico,
      4000
    );


  const tratamiento =
    normalizeText(
      data.tratamiento,
      4000
    );


  const indicaciones =
    normalizeText(
      data.indicaciones,
      4000
    );


  if (!citaId) {
    errors.citaId =
      "La atención debe estar asociada a una cita.";
  }


  if (!pacienteId) {
    errors.pacienteId =
      "La atención debe estar asociada a un paciente.";
  }


  if (!motivoConsulta) {
    errors.motivoConsulta =
      "La atención debe incluir el motivo de consulta.";
  }


  if (!diagnostico) {
    errors.diagnostico =
      "Ingresa el diagnóstico.";
  }


  if (!tratamiento) {
    errors.tratamiento =
      "Ingresa el tratamiento.";
  }


  if (
    indicaciones.length >
    4000
  ) {
    errors.indicaciones =
      "Las indicaciones son demasiado largas.";
  }


  const serviceErrors =
    getReferenceItemErrors(
      data.servicios ?? [],
      "servicio",
      "servicios"
    );


  if (
    serviceErrors.length >
    0
  ) {
    errors.servicios =
      serviceErrors;
  }


  const productErrors =
    getReferenceItemErrors(
      data.productos ?? [],
      "producto",
      "productos"
    );


  if (
    productErrors.length >
    0
  ) {
    errors.productos =
      productErrors;
  }


  return errors;
}


export function buildVeterinaryAttentionMutationPayload(
  rawData = {}
) {
  const errors =
    getVeterinaryAttentionFieldErrors(
      rawData
    );


  if (
    Object.keys(errors).length >
    0
  ) {
    const error =
      new Error(
        "Los datos de atención contienen errores."
      );

    error.fieldErrors =
      errors;

    throw error;
  }


  return {
    citaId:
      normalizeText(
        rawData.citaId,
        120
      ),

    pacienteId:
      normalizeText(
        rawData.pacienteId,
        120
      ),

    motivoConsulta:
      normalizeText(
        rawData.motivoConsulta,
        1000
      ),

    diagnostico:
      normalizeText(
        rawData.diagnostico,
        4000
      ),

    tratamiento:
      normalizeText(
        rawData.tratamiento,
        4000
      ),

    indicaciones:
      normalizeText(
        rawData.indicaciones,
        4000
      ),

    servicios:
      (rawData.servicios ?? [])
        .map(
          (item) =>
            normalizeReferenceItem(
              item,
              "servicio"
            )
        ),

    productos:
      (rawData.productos ?? [])
        .map(
          (item) =>
            normalizeReferenceItem(
              item,
              "producto"
            )
        ),
  };
}


// Borrador de la atención abierta: guarda lo escrito hasta ahora sin exigir los obligatorios del cierre.
// Los ítems solo conservan itemId y cantidad; nombre, unidad y precio se vuelven a leer de Inventario
// (en el formulario al abrir y en el servidor al cerrar). Sin "items" se conserva la lista anterior.
const VETERINARY_ATTENTION_DRAFT_TEXT_LIMITS =
  Object.freeze({
    motivoConsulta: 1000,
    diagnostico: 4000,
    tratamiento: 4000,
    indicaciones: 4000,
  });

const VETERINARY_ATTENTION_DRAFT_MAX_ITEMS = 100;


export function buildVeterinaryAttentionDraftPayload(
  rawData = {}
) {
  const data =
    rawData &&
    typeof rawData === "object"
      ? rawData
      : {};

  const errors = {};
  const draft = {};


  for (
    const [field, maxLength] of
    Object.entries(
      VETERINARY_ATTENTION_DRAFT_TEXT_LIMITS
    )
  ) {
    const value = data[field];

    if (
      value !== undefined &&
      value !== null &&
      typeof value !== "string"
    ) {
      errors[field] =
        "El texto del borrador no es válido.";

      continue;
    }

    const text =
      String(value ?? "")
        .replace(/\r\n/g, "\n");

    if (text.length > maxLength) {
      errors[field] =
        `El texto supera los ${maxLength} caracteres.`;
    }

    draft[field] =
      text;
  }


  const resultadoClinico =
    normalizeText(
      data.resultadoClinico,
      40
    ).toLowerCase();

  if (
    resultadoClinico &&
    !VETERINARY_CLINICAL_OUTCOMES
      .includes(resultadoClinico)
  ) {
    errors.resultadoClinico =
      "Selecciona un resultado clínico válido.";
  }

  draft.resultadoClinico =
    resultadoClinico;


  if (data.items !== undefined) {
    if (
      !Array.isArray(data.items) ||
      data.items.length >
        VETERINARY_ATTENTION_DRAFT_MAX_ITEMS
    ) {
      errors.items =
        "Registra hasta 100 ítems en el borrador.";
    } else {
      const seenIds =
        new Set();

      const items = [];

      for (const rawItem of data.items) {
        const itemId =
          normalizeText(
            rawItem?.itemId,
            120
          );

        const cantidad =
          normalizeNumber(
            rawItem?.cantidad
          );

        if (
          !/^[a-zA-Z0-9_-]{1,120}$/.test(itemId) ||
          seenIds.has(itemId) ||
          !isValidVeterinaryQuantity(cantidad)
        ) {
          errors.items =
            "Revisa los ítems: deben ser válidos, sin duplicados y con cantidad mayor que cero.";

          break;
        }

        seenIds.add(itemId);

        items.push({itemId, cantidad});
      }

      if (!errors.items) {
        draft.items = items;
      }
    }
  }


  if (Object.keys(errors).length > 0) {
    const error =
      new Error(
        "Los datos del borrador contienen errores."
      );

    error.fieldErrors =
      errors;

    throw error;
  }


  return draft;
}
