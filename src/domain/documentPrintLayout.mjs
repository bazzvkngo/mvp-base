// Presentación común de las hojas imprimibles (Venta, Compra, Orden de compra y Cotización).
// Solo decide qué texto y qué filas se muestran: no calcula ni guarda montos.

const hasText = (value) => Boolean(String(value ?? "").trim());

// Compara nombres sin diferenciar mayúsculas ni espacios sobrantes.
const normalizeName = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("es");

export const DOCUMENT_PRODUCT_NAME = "ValoraCloud";
export const DOCUMENT_NET_SUBTOTAL_LABEL = "Subtotal (neto)";

// La razón social va bajo el título solo si aporta algo distinto del título.
export function getLegalNameBelowTitle(company, title) {
  const legalName = company?.razonSocial;
  if (!hasText(legalName)) return "";
  return normalizeName(legalName) === normalizeName(title) ? "" : String(legalName).trim();
}

// Pie de la hoja: el nombre de la empresa aparece una sola vez. Con datos de contacto, el contacto va a la izquierda y
// el nombre junto a ValoraCloud a la derecha; sin contacto, el nombre va a la izquierda y a la derecha solo ValoraCloud.
export function buildDocumentFooterParts(company, brand) {
  const contact = [company?.responsable, company?.telefono, company?.email].filter(hasText).join(" · ");
  if (!contact) return {left: brand, right: DOCUMENT_PRODUCT_NAME};
  const sameAsProduct = normalizeName(brand) === normalizeName(DOCUMENT_PRODUCT_NAME);
  return {left: contact, right: sameAsProduct ? DOCUMENT_PRODUCT_NAME : `${brand} · ${DOCUMENT_PRODUCT_NAME}`};
}

const sameAmount = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 0.000001;

// Filas previas al impuesto. Subtotal es la suma bruta de las líneas y Neto es Subtotal menos descuentos, así que sin
// descuentos son iguales y se muestra una sola fila. Cada fila trae `amount` y `negative`; quien dibuja da el formato.
export function buildNetTotalsRows({subtotal, descuentoTotal, neto, discountLabel = "Descuentos"}) {
  const discount = Number(descuentoTotal || 0);
  if (discount > 0) {
    return [
      {key: "subtotal", label: "Subtotal", amount: subtotal, negative: false},
      {key: "descuentos", label: discountLabel, amount: discount, negative: true},
      {key: "neto", label: "Neto", amount: neto, negative: false},
    ];
  }
  if (sameAmount(subtotal, neto)) {
    return [{key: "subtotal-neto", label: DOCUMENT_NET_SUBTOTAL_LABEL, amount: neto, negative: false}];
  }
  return [
    {key: "subtotal", label: "Subtotal", amount: subtotal, negative: false},
    {key: "neto", label: "Neto", amount: neto, negative: false},
  ];
}
