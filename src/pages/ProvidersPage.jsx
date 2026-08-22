import React from "react";
import ProvidersManager from "../features/providers/ProvidersManager";

function ProvidersPage({businessId, countryCode, role}) {
  return <ProvidersManager businessId={businessId} countryCode={countryCode} role={role} />;
}

export default ProvidersPage;
