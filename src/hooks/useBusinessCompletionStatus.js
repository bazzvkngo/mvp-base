import React from "react";
import { getBusinessCompletionStatus } from "../domain/businessCompletion.mjs";
import { subscribeToCompanyProfile } from "../services/companyService";

export default function useBusinessCompletionStatus({
  businessId,
  ownerEmailVerified,
  initialProfile = {},
}) {
  const [profile, setProfile] = React.useState(initialProfile);
  const [loading, setLoading] = React.useState(Boolean(businessId));
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    setProfile(initialProfile || {});
    setError("");
    if (!businessId) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    return subscribeToCompanyProfile(
      businessId,
      (nextProfile) => {
        setProfile(nextProfile);
        setLoading(false);
      },
      () => {
        setError("No fue posible actualizar el estado de la empresa.");
        setLoading(false);
      }
    );
  }, [businessId]);

  const status = React.useMemo(
    () => getBusinessCompletionStatus(profile, { ownerEmailVerified }),
    [ownerEmailVerified, profile]
  );

  return { error, loading, profile, status };
}
