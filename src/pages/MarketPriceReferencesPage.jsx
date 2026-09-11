import React from "react";
import { useParams } from "react-router-dom";
import MarketPriceReferencesView from "../features/references/MarketPriceReferencesView";

function MarketPriceReferencesPage({ businessId }) {
  const { itemId } = useParams();
  return <MarketPriceReferencesView businessId={businessId} itemId={itemId} />;
}

export default MarketPriceReferencesPage;
