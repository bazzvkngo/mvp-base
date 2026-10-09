export const VETERINARY_CLINICAL_OUTCOMES =
  Object.freeze([
    "alta",
    "control",
    "derivacion",
  ]);


const VETERINARY_SALE_ITEM_TYPES =
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


function normalizeBoolean(
  value
) {
  return value === true;
}


function normalizeDate(
  value
) {
  return normalizeText(
    value,
    10
  );
}


function isValidIsoDate(
  value
) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value
    )
  ) {
    return false;
  }


  const [
    year,
    month,
    day,
  ] = value
    .split("-")
    .map(Number);


  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );


  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() ===
      month - 1 &&
    date.getUTCDate() === day
  );
}


function isAllowedOutcome(
  value
) {
  return (
    VETERINARY_CLINICAL_OUTCOMES
      .includes(value)
  );
}


function normalizeSaleLine(
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

    cantidad:
      normalizeNumber(
        rawItem.cantidad
      ),
  };
}


export function getVeterinaryClinicalClosureFieldErrors(
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


  const resultadoClinico =
    normalizeText(
      data.resultadoClinico,
      40
    ).toLowerCase();


  const resumenCierre =
    normalizeText(
      data.resumenCierre,
      4000
    );


  const indicacionesCierre =
    normalizeText(
      data.indicacionesCierre,
      4000
    );


  const proximoControl =
    normalizeDate(
      data.proximoControl
    );


  if (!citaId) {
    errors.citaId =
      "El cierre debe estar asociado a una cita.";
  }


  if (!pacienteId) {
    errors.pacienteId =
      "El cierre debe estar asociado a un paciente.";
  }


  if (!resultadoClinico) {
    errors.resultadoClinico =
      "Selecciona el resultado clínico.";
  } else if (
    !isAllowedOutcome(
      resultadoClinico
    )
  ) {
    errors.resultadoClinico =
      "Selecciona un resultado clínico válido.";
  }


  if (
    resumenCierre.length >
    4000
  ) {
    errors.resumenCierre =
      "El resumen de cierre es demasiado largo.";
  }


  if (
    indicacionesCierre.length >
    4000
  ) {
    errors.indicacionesCierre =
      "Las indicaciones finales son demasiado largas.";
  }


  if (
    proximoControl &&
    !isValidIsoDate(
      proximoControl
    )
  ) {
    errors.proximoControl =
      "Ingresa una fecha de próximo control válida.";
  }


  return errors;
}


export function buildVeterinaryClinicalClosureMutationPayload(
  rawData = {}
) {
  const errors =
    getVeterinaryClinicalClosureFieldErrors(
      rawData
    );


  if (
    Object.keys(errors).length >
    0
  ) {
    const error =
      new Error(
        "Los datos del cierre clínico contienen errores."
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

    resultadoClinico:
      normalizeText(
        rawData.resultadoClinico,
        40
      ).toLowerCase(),

    resumenCierre:
      normalizeText(
        rawData.resumenCierre,
        4000
      ),

    indicacionesCierre:
      normalizeText(
        rawData.indicacionesCierre,
        4000
      ),

    proximoControl:
      normalizeDate(
        rawData.proximoControl
      ),

    prepararVenta:
      normalizeBoolean(
        rawData.prepararVenta
      ),
  };
}


export function getVeterinarySaleHandoffFieldErrors(
  rawData = {}
) {
  const data =
    rawData &&
    typeof rawData === "object"
      ? rawData
      : {};


  const errors = {};


  const clienteId =
    normalizeText(
      data.clienteId,
      120
    );


  const lineas =
    Array.isArray(
      data.lineas
    )
      ? data.lineas
      : [];


  if (!clienteId) {
    errors.clienteId =
      "La venta preparada debe estar asociada al tutor/cliente.";
  }


  if (
    lineas.length === 0
  ) {
    errors.lineas =
      [
        "La venta preparada debe incluir al menos un servicio o producto.",
      ];
  }


  if (
    lineas.length > 200
  ) {
    errors.lineas =
      [
        "La venta preparada supera el máximo de 200 líneas.",
      ];
  }


  const lineErrors = [];


  const seen =
    new Set();


  lineas.forEach(
    (rawLine, index) => {

      const tipoItem =
        normalizeText(
          rawLine?.tipoItem,
          40
        ).toLowerCase();


      const item =
        normalizeSaleLine(
          rawLine,
          tipoItem
        );


      if (
        !VETERINARY_SALE_ITEM_TYPES
          .includes(
            tipoItem
          )
      ) {
        lineErrors.push(
          `lineas[${index}]: tipo de ítem no válido.`
        );
      }


      if (!item.itemId) {
        lineErrors.push(
          `lineas[${index}]: falta itemId.`
        );
      }


      if (
        item.cantidad === null ||
        item.cantidad <= 0
      ) {
        lineErrors.push(
          `lineas[${index}]: la cantidad debe ser mayor que cero.`
        );
      }


      const uniqueKey =
        `${tipoItem}:${item.itemId}`;


      if (
        item.itemId &&
        seen.has(
          uniqueKey
        )
      ) {
        lineErrors.push(
          `lineas[${index}]: el ítem está duplicado.`
        );
      }


      if (item.itemId) {
        seen.add(
          uniqueKey
        );
      }
    }
  );


  if (
    lineErrors.length >
    0
  ) {
    errors.lineas =
      lineErrors;
  }


  return errors;
}


export function buildVeterinarySaleHandoffPayload(
  rawData = {}
) {
  const errors =
    getVeterinarySaleHandoffFieldErrors(
      rawData
    );


  if (
    Object.keys(errors).length >
    0
  ) {
    const error =
      new Error(
        "Los datos para preparar la venta contienen errores."
      );

    error.fieldErrors =
      errors;

    throw error;
  }


  return {
    clienteId:
      normalizeText(
        rawData.clienteId,
        120
      ),

    lineas:
      rawData.lineas.map(
        (rawLine) => {

          const tipoItem =
            normalizeText(
              rawLine.tipoItem,
              40
            ).toLowerCase();


          return normalizeSaleLine(
            rawLine,
            tipoItem
          );
        }
      ),

    observaciones:
      normalizeText(
        rawData.observaciones,
        2000
      ),
  };
}


export function buildVeterinarySaleHandoffFromAttention({
  clienteId,
  attention,
  observaciones = "",
} = {}) {
  const services =
    Array.isArray(
      attention?.servicios
    )
      ? attention.servicios
      : [];


  const products =
    Array.isArray(
      attention?.productos
    )
      ? attention.productos
      : [];


  const lineas = [
    ...services.map(
      (item) => ({
        itemId:
          item.itemId,

        tipoItem:
          "servicio",

        cantidad:
          item.cantidad,
      })
    ),

    ...products.map(
      (item) => ({
        itemId:
          item.itemId,

        tipoItem:
          "producto",

        cantidad:
          item.cantidad,
      })
    ),
  ];


  return buildVeterinarySaleHandoffPayload({
    clienteId,
    lineas,
    observaciones,
  });
}