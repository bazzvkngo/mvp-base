"use strict";

// Zonas de fotos de recepción (prototipo «Panel del Taller»): seis zonas exteriores, en las que se
// registran los daños previos, y el tablero. Módulo sin dependencias: lo usan las fotos, la recepción
// y la aprobación. Los identificadores coinciden con src/domain/workOrderReceptionPhotoModel.mjs.
const RECEPTION_PHOTO_ZONE_DEFINITIONS = Object.freeze([
  {id: "delantera", label: "Delantera", damages: true},
  {id: "lateral-izquierdo-delantero", label: "Lateral izq. delantero", damages: true},
  {id: "lateral-izquierdo-trasero", label: "Lateral izq. trasero", damages: true},
  {id: "lateral-derecho-delantero", label: "Lateral der. delantero", damages: true},
  {id: "lateral-derecho-trasero", label: "Lateral der. trasero", damages: true},
  {id: "trasera", label: "Trasera", damages: true},
  {id: "tablero", label: "Tablero", damages: false},
]);
const RECEPTION_PHOTO_ZONES = Object.freeze(RECEPTION_PHOTO_ZONE_DEFINITIONS.map((zone) => zone.id));

function receptionPhotoZone(zoneId) {
  return RECEPTION_PHOTO_ZONE_DEFINITIONS.find((zone) => zone.id === zoneId) || null;
}

function storedPhotos(order = {}) {
  return order.fotosRecepcion && typeof order.fotosRecepcion === "object" ? order.fotosRecepcion : {};
}

// Zonas sin foto guardada (se exigen todas para registrar la recepción).
function missingReceptionPhotoZones(order = {}) {
  const stored = storedPhotos(order);
  return RECEPTION_PHOTO_ZONE_DEFINITIONS.filter((zone) => !stored[zone.id]?.hash).map((zone) => zone.label);
}

// Daños previos registrados en las zonas exteriores, para la aprobación.
function receptionPhotoDamages(order = {}) {
  const stored = storedPhotos(order);
  return RECEPTION_PHOTO_ZONE_DEFINITIONS.flatMap((zone) => {
    const photo = stored[zone.id];
    if (!zone.damages || !photo?.conDanos || !Array.isArray(photo.marcas)) return [];
    return [{zona: zone.label, notas: photo.marcas.map((mark) => String(mark?.nota || "")).filter(Boolean)}];
  });
}

module.exports = {
  RECEPTION_PHOTO_ZONES,
  RECEPTION_PHOTO_ZONE_DEFINITIONS,
  missingReceptionPhotoZones,
  receptionPhotoDamages,
  receptionPhotoZone,
};
