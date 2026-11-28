export const VETERINARY_BOX_NAME_LIMIT = 80;

export function normalizeVeterinaryBoxName(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function veterinaryBoxKey(value) {
  return normalizeVeterinaryBoxName(typeof value === "string" ? value.normalize("NFKC").toLocaleLowerCase("es") : "");
}

const roomOrder = new Intl.Collator("es", {numeric: true, sensitivity: "base"});

export function buildVeterinaryBoxBoard(boxes, orders) {
  const entries = new Map(boxes.map(({id, nombre}) => [veterinaryBoxKey(nombre), {id, nombre, order: null, state: "libre"}]));
  for (const order of orders) {
    if (!order.box || !["en_espera", "en_atencion"].includes(order.estado)) continue;
    const key = veterinaryBoxKey(order.box);
    const box = entries.get(key) ?? {id: `legacy:${key}`, nombre: order.box};
    if (box.state === "en_uso") continue;
    entries.set(key, {...box, order, state: order.estado === "en_atencion" ? "en_uso" : "reservado"});
  }
  return [...entries.values()].sort((left, right) => roomOrder.compare(left.nombre, right.nombre));
}
