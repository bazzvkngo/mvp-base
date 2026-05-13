import React, { useState } from "react";
import InventoryImporter from "../features/inventory/InventoryImporter";
import InventoryManager from "../features/inventory/InventoryManager";

function InventoryPage({ userId }) {
  const [refreshSignal, setRefreshSignal] = useState(0);

  return (
    <>
      <InventoryImporter
        userId={userId}
        onImported={() => setRefreshSignal((value) => value + 1)}
      />
      <InventoryManager userId={userId} refreshSignal={refreshSignal} />
    </>
  );
}

export default InventoryPage;
