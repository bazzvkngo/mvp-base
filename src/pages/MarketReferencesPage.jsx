import React from "react";
import MarketReferencesManager from "../features/references/MarketReferencesManager";

function MarketReferencesPage({ userId, role }) {
  return <MarketReferencesManager userId={userId} role={role} />;
}

export default MarketReferencesPage;
