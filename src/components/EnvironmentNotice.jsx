import React from "react";
import { useLocation } from "react-router-dom";
import { firebaseEnvironment } from "../config/firebaseEnvironment.mjs";

function EnvironmentNotice() {
  const location = useLocation();

  if (
    !firebaseEnvironment.showDevelopmentNotice ||
    ["/login", "/onboarding"].includes(location.pathname)
  ) {
    return null;
  }

  return (
    <div
      className={`environment-notice environment-notice--${firebaseEnvironment.mode}`}
      role="status"
      aria-label={`Entorno Firebase: ${firebaseEnvironment.notice}`}
    >
      {firebaseEnvironment.notice}
    </div>
  );
}

export default EnvironmentNotice;
