import React from "react";
import ClientsManager from "../features/clients/ClientsManager";

function ClientsPage({businessId, canCreateQuotes, countryCode, role}) {
  return <ClientsManager businessId={businessId} canCreateQuotes={canCreateQuotes} countryCode={countryCode} role={role} />;
}

export default ClientsPage;
