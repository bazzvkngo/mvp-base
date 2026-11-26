import {useEffect, useState} from "react";
import {subscribeToPendingVeterinaryOrders} from "../data/veterinaryDataService";

const EMPTY_ORDERS = [];

export default function usePendingVeterinaryOrders(businessId, professionalUid) {
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    setSnapshot(null);
    if (!businessId || !professionalUid) return undefined;

    return subscribeToPendingVeterinaryOrders(businessId, professionalUid, (orders) => {
      setSnapshot({businessId, professionalUid, orders});
    }, () => setSnapshot(null));
  }, [businessId, professionalUid]);

  return snapshot && snapshot.businessId === businessId && snapshot.professionalUid === professionalUid
    ? snapshot.orders
    : EMPTY_ORDERS;
}
