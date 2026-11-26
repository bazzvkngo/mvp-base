import {RECEPTION_PHOTO_ZONES} from "../src/domain/workOrderReceptionPhotoModel.mjs";

// Fixture de la entrega: la entrega exige las siete fotos sellada en el acta y los datos de quien retira.
// La subida real de fotos se prueba en work-order-delivery-smoke.mjs (con Storage).
export function deliveryInput(extra = {}) {
  return {entrega: {receptorNombre: "Cliente de Prueba", receptorDocumento: "11.111.111-1", observaciones: "", conforme: true, ...extra}};
}

export async function completeDeliveryPhotos(orderRef) {
  const order = (await orderRef.get()).data();
  await orderRef.collection("entrega").doc("acta").set({
    negocioId: order.negocioId, otId: orderRef.id,
    fotos: Object.fromEntries(RECEPTION_PHOTO_ZONES.map((zone) => [zone.id, {
      hash: `entrega-${zone.id}`.padEnd(64, "0"), bytes: 1024, subidaPorUid: "fixture",
      subidaPorNombre: "Fixture de prueba", subidaEn: new Date(),
    }])),
  });
}
