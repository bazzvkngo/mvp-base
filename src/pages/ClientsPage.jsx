import React from "react";
import ClientsManager from "../features/clients/ClientsManager";

function ClientsPage({businessId, role}) {
  return <ClientsManager businessId={businessId} role={role} />;
}

export default ClientsPage;
