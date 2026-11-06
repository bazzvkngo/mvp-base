// Antigüedad legible de las referencias de mercado guardadas ("hace 3 horas").
// Puro y sin red: la Function devuelve `actualizadoEn` en ISO y la caché dura
// menos de 24 horas, pero el texto cubre también minutos y días por si cambia.
export function describeMarketCacheAge(updatedAt, now = Date.now()) {
  const time = new Date(updatedAt).getTime();
  if (!Number.isFinite(time)) return "";
  const minutes = Math.floor(Math.max(0, now - time) / 60000);
  if (minutes < 1) return "hace unos segundos";
  if (minutes < 60) return minutes === 1 ? "hace 1 minuto" : `hace ${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "hace 1 hora" : `hace ${hours} horas`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}
