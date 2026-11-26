// Descripción de una línea de venta para mostrarla en el editor (solo presentación).
// La descripción viene del ítem del inventario y no se edita aquí; en los productos suele
// ser idéntica al nombre. Se muestra únicamente si es distinta del nombre, comparando sin
// tildes, sin mayúsculas y sin espacios sobrantes. Los datos de la línea no se tocan.
const collator = new Intl.Collator("es", {sensitivity: "base"});
const collapse = (value) => String(value ?? "").trim().replace(/\s+/g, " ");

export function lineDescriptionToShow(item) {
  const description = collapse(item?.descripcion);
  if (!description) return "";
  return collator.compare(description, collapse(item?.nombre)) === 0 ? "" : description;
}
