import React from "react";
import { CloudCog } from "lucide-react";

const BRAND_NAME = "ValoraCloud";
const BRAND_SUBTITLE = "Valorización y cotizaciones TI";
function CubeIcon({ size = 42, strokeWidth = 1.5, className = "", style }) {
  return (
    <CloudCog
      size={size}
      strokeWidth={strokeWidth}
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{
        color: "var(--color-brand-600)",
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

function BrandLogo({
  variant = "sidebar",
  showText = true,
  className = "",
  iconSize,
  subtitle = BRAND_SUBTITLE,
}) {
  const isAuth = variant === "auth";
  const rootClassName = ["brand-logo", `brand-logo--${variant}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={rootClassName}
      role={showText ? undefined : "img"}
      aria-label={showText ? undefined : BRAND_NAME}
    >
      <span className="brand-logo__icon" aria-hidden="true">
        <CubeIcon size={iconSize || (isAuth ? 42 : 40)} />
      </span>

      {showText && (
        <div className="brand-logo__text">
          <strong className="brand-logo__name">{BRAND_NAME}</strong>
          <span className="brand-logo__subtitle">{subtitle}</span>
        </div>
      )}
    </div>
  );
}

export { BRAND_NAME, BRAND_SUBTITLE, CubeIcon };
export default BrandLogo;
