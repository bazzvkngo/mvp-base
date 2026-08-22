import React from "react";
import CompanyConfig from "../features/company/CompanyConfig";

function CompanyPage({
  businessId,
  businessName,
  currentUserUid,
  onBusinessDeleted,
  onBusinessUpdated,
  role,
}) {
  return (
    <CompanyConfig
      businessId={businessId}
      businessName={businessName}
      currentUserUid={currentUserUid}
      onBusinessDeleted={onBusinessDeleted}
      onBusinessUpdated={onBusinessUpdated}
      role={role}
    />
  );
}

export default CompanyPage;
