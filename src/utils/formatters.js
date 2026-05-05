export function formatCLP(value) {
  return Number(value || 0).toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
  });
}

export function formatPercent(value, decimals = 1) {
  const n = Number(value || 0);
  return `${n.toFixed(decimals)}%`;
}
