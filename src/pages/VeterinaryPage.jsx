import React from "react";

import VeterinaryRoutes from "../features/veterinary/VeterinaryRoutes";


function VeterinaryPage({
  businessId,
  role,
}) {
  return (
    <VeterinaryRoutes
      businessId={businessId}
      role={role}
    />
  );
}


export default VeterinaryPage;