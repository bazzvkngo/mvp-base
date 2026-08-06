import React from "react";
import InventoryManager from "../features/inventory/InventoryManager";

function InventoryPage({ businessId, role }) {
  return <InventoryManager businessId={businessId} role={role} />;
}

export default InventoryPage;
