function getInventoryTimestamp(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortInventoryItems(items) {
  return [...items].sort((left, right) => {
    const leftTimestamp = getInventoryTimestamp(
      left.actualizadoEn ||
        left.fechaActualizacion ||
        left.creadoEn ||
        left.fechaCreacion
    );
    const rightTimestamp = getInventoryTimestamp(
      right.actualizadoEn ||
        right.fechaActualizacion ||
        right.creadoEn ||
        right.fechaCreacion
    );
    return rightTimestamp - leftTimestamp;
  });
}
