import React from "react";
import ProvidersManager from "../features/providers/ProvidersManager";

function ProvidersPage({businessId, role}) {
  return <ProvidersManager businessId={businessId} role={role} />;
}

export default ProvidersPage;
