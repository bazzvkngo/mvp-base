import React, { useState } from "react";
import InventoryAiImporter from "../features/inventory/InventoryAiImporter";
import InventoryManager from "../features/inventory/InventoryManager";

function InventoryPage({ userId }) {
  const [refreshSignal, setRefreshSignal] = useState(0);

  return (
    <>
      <InventoryAiImporter
        userId={userId}
        onImported={() => setRefreshSignal((value) => value + 1)}
      />
      <InventoryManager userId={userId} refreshSignal={refreshSignal} />
    </>
  );
}

export default InventoryPage;
