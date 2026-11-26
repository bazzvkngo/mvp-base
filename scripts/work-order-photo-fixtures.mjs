import {RECEPTION_PHOTO_ZONES, RECEPTION_VEHICLE_ZONES} from "../src/domain/workOrderReceptionPhotoModel.mjs";

const VEHICLE_ZONE_IDS = new Set(RECEPTION_VEHICLE_ZONES.map((zone) => zone.id));

// Fixture de Firestore: marca fotos de recepción como registradas en la OT, sin pasar por Storage.
// La recepción y la aprobación solo revisan estos datos; la subida real se prueba en
// work-order-photos-smoke.mjs. Las zonas exteriores quedan «sin daños».
export function receptionPhotosFixture(zoneIds = RECEPTION_PHOTO_ZONES.map((zone) => zone.id)) {
  return Object.fromEntries(zoneIds.map((zona) => [zona, {
    hash: `fixture-${zona}`.padEnd(64, "0"), bytes: 1024, subidaPorUid: "fixture",
    subidaPorNombre: "Fixture de prueba", subidaEn: new Date(),
    ...(VEHICLE_ZONE_IDS.has(zona) ? {conDanos: false, marcas: []} : {}),
  }]));
}

// Se llama antes de registrar la recepción: las siete fotos son obligatorias para registrarla.
export async function completeReceptionPhotos(orderRef) {
  await orderRef.update({fotosRecepcion: receptionPhotosFixture()});
}
