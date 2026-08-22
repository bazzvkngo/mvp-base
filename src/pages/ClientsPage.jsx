import React from "react";
import ClientsManager from "../features/clients/ClientsManager";

function ClientsPage({businessId, countryCode, role}) {
  return <ClientsManager businessId={businessId} countryCode={countryCode} role={role} />;
}

export default ClientsPage;
