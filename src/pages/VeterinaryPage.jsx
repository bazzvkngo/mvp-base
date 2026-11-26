import React from "react";

import VeterinaryRoutes from "../features/veterinary/VeterinaryRoutes";


function VeterinaryPage({
  businessId,
  countryCode,
  role,
}) {
  return (
    <VeterinaryRoutes
      businessId={businessId}
      countryCode={countryCode}
      role={role}
    />
  );
}


export default VeterinaryPage;