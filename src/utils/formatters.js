export function formatCLP(value) {
  return Number(value || 0).toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
  });
}

export function formatPercent(value, decimals = 1) {
  const n = Number(value || 0);
  const formatted = n.toLocaleString("es-CL", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  });
  return `${formatted} %`;
}

export function formatDate(value) {
  if (!value) return "-";

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}-${month}-${year}`;
  }

  const date =
    typeof value?.toDate === "function"
      ? value.toDate()
      : value instanceof Date
      ? value
      : new Date(value);

  if (Number.isNaN(date.getTime())) return "-";

  const parts = new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const dateParts = parts.reduce((result, part) => {
    if (part.type !== "literal") {
      result[part.type] = part.value;
    }
    return result;
  }, {});

  return `${dateParts.day}-${dateParts.month}-${dateParts.year}`;
}
