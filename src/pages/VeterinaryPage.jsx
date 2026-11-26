import React from "react";

import VeterinaryRoutes from "../features/veterinary/VeterinaryRoutes";


function VeterinaryPage({
  businessId,
  countryCode,
  role,
  professionalUid,
}) {
  return (
    <VeterinaryRoutes
      businessId={businessId}
      countryCode={countryCode}
      role={role}
      professionalUid={professionalUid}
    />
  );
}


export default VeterinaryPage;
