// Fotos de recepción (prototipo «Panel del Taller»): seis zonas exteriores, donde se registran los
// daños previos, y la foto del tablero. Los identificadores coinciden con
// functions/workOrderReceptionPhotoZones.js. `slot` es el recorte de la zona en la silueta del auto (lienzo de 300 × 400) y `anchor`, donde van su número y sus daños.
export const RECEPTION_VEHICLE_ZONES = Object.freeze([
  {id: "delantera", label: "Delantera", guide: "Frente completo: parachoques, focos y parabrisas.",
    slot: {x: 0, y: 0, width: 300, height: 125, anchor: {x: 150, y: 72}}},
  {id: "lateral-izquierdo-delantero", label: "Lateral izq. delantero",
    guide: "Costado del conductor, desde el guardabarros delantero hasta la puerta delantera.",
    slot: {x: 0, y: 125, width: 118, height: 75, anchor: {x: 91, y: 166}}},
  {id: "lateral-izquierdo-trasero", label: "Lateral izq. trasero",
    guide: "Costado del conductor, desde la puerta trasera hasta el parachoques trasero.",
    slot: {x: 0, y: 200, width: 118, height: 75, anchor: {x: 91, y: 242}}},
  {id: "lateral-derecho-delantero", label: "Lateral der. delantero",
    guide: "Costado del copiloto, desde el guardabarros delantero hasta la puerta delantera.",
    slot: {x: 182, y: 125, width: 118, height: 75, anchor: {x: 209, y: 166}}},
  {id: "lateral-derecho-trasero", label: "Lateral der. trasero",
    guide: "Costado del copiloto, desde la puerta trasera hasta el parachoques trasero.",
    slot: {x: 182, y: 200, width: 118, height: 75, anchor: {x: 209, y: 242}}},
  {id: "trasera", label: "Trasera", guide: "Parte trasera completa: maletero, focos y patente.",
    slot: {x: 0, y: 275, width: 300, height: 125, anchor: {x: 150, y: 330}}},
]);

export const RECEPTION_DASHBOARD_ZONE = Object.freeze({
  id: "tablero", label: "Tablero",
  guide: "Con el motor encendido: que se lean el kilometraje, el nivel de combustible y los sensores.",
});

export const RECEPTION_PHOTO_ZONES = Object.freeze([...RECEPTION_VEHICLE_ZONES, RECEPTION_DASHBOARD_ZONE]);

// Las fotos solo se registran antes de aprobar el ingreso (el servidor también lo valida).
export const RECEPTION_PHOTO_LOCKED_STATES = Object.freeze(["pendiente_entrega", "cerrada", "cancelada"]);

export function getReceptionPhotoZone(zoneId) {
  return RECEPTION_PHOTO_ZONES.find((zone) => zone.id === zoneId) || null;
}

export function getReceptionPhotoZoneLabel(zoneId) {
  return getReceptionPhotoZone(zoneId)?.label || "Zona";
}

export function canRegisterReceptionPhotos(order = {}) {
  return !RECEPTION_PHOTO_LOCKED_STATES.includes(order.estado) && order.estadoAprobacion !== "aprobada";
}

// Estado de las fotos a partir de la OT (fotosRecepcion): zonas exteriores, tablero y faltantes.
export function receptionPhotoProgress(order = {}) {
  const stored = order.fotosRecepcion && typeof order.fotosRecepcion === "object" ? order.fotosRecepcion : {};
  const zones = RECEPTION_VEHICLE_ZONES.map((zone) => {
    const photo = stored[zone.id];
    const marks = photo?.conDanos && Array.isArray(photo.marcas) ? photo.marcas : [];
    return {...zone, completed: Boolean(photo?.hash), withDamages: marks.length > 0, damageCount: marks.length, photo: photo || null};
  });
  const dashboardPhoto = stored[RECEPTION_DASHBOARD_ZONE.id] || null;
  const dashboard = {...RECEPTION_DASHBOARD_ZONE, completed: Boolean(dashboardPhoto?.hash), photo: dashboardPhoto};
  const missing = [...zones, dashboard].filter((zone) => !zone.completed).map((zone) => zone.label);
  return {
    zones,
    dashboard,
    completedVehicle: zones.filter((zone) => zone.completed).length,
    totalVehicle: zones.length,
    damagedZones: zones.filter((zone) => zone.withDamages).length,
    missing,
    complete: missing.length === 0,
  };
}
