import React from "react";
import AppIcon from "./AppIcon";

const Button = React.forwardRef(function Button(
  {
    children,
    className = "",
    icon,
    iconSize = 18,
    variant = "primary",
    ...props
  },
  ref
) {
  const classes = ["ui-button", `ui-button--${variant}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <button ref={ref} className={classes} {...props}>
      {icon && <AppIcon icon={icon} size={iconSize} />}
      {children && <span className="ui-button__label">{children}</span>}
    </button>
  );
});

export default Button;
