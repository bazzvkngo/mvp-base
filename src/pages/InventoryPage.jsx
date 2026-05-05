import React from "react";
import InventoryImporter from "../features/inventory/InventoryImporter";
import InventoryManager from "../features/inventory/InventoryManager";

function InventoryPage({ userId }) {
  return (
    <>
      <InventoryImporter userId={userId} />
      <InventoryManager userId={userId} />
    </>
  );
}

export default InventoryPage;
