import React from "react";

function AppIcon({ icon: Icon, label, size = 18, strokeWidth = 1.8, ...props }) {
  if (!Icon) return null;

  return (
    <Icon
      className="app-icon"
      size={size}
      strokeWidth={strokeWidth}
      focusable="false"
      aria-hidden={label ? undefined : "true"}
      aria-label={label || undefined}
      role={label ? "img" : undefined}
      {...props}
    />
  );
}

export default AppIcon;
