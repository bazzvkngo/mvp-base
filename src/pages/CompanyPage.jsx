import React from "react";
import CompanyConfig from "../features/company/CompanyConfig";

function CompanyPage({ onBusinessUpdated, role, userId }) {
  return (
    <CompanyConfig
      onBusinessUpdated={onBusinessUpdated}
      role={role}
      userId={userId}
    />
  );
}

export default CompanyPage;
