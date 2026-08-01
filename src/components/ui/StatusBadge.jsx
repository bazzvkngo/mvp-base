import React from "react";

function StatusBadge({ children, className = "", variant = "neutral", ...props }) {
  const classes = ["ui-status-badge", `ui-status-badge--${variant}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
}

export default StatusBadge;
