import React from "react";
import { useOutletContext } from "react-router-dom";
import CompanyConfig from "../features/company/CompanyConfig";

function CompanyPage({
  businessId,
  businessName,
  businessVerified,
  currentUserUid,
  onBusinessDeleted,
  onBusinessUpdated,
  role,
}) {
  const { businessCompletionStatus } = useOutletContext() || {};

  return (
    <CompanyConfig
      businessCompletionStatus={businessCompletionStatus}
      businessId={businessId}
      businessName={businessName}
      businessVerified={businessVerified}
      currentUserUid={currentUserUid}
      onBusinessDeleted={onBusinessDeleted}
      onBusinessUpdated={onBusinessUpdated}
      role={role}
    />
  );
}

export default CompanyPage;
