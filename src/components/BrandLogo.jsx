import React from "react";

const BRAND_NAME = "ValoraCloud";
const BRAND_SUBTITLE = "Valorización y cotizaciones TI";
const BRAND_COLOR = "#0f766e";

function CubeIcon({ size = 42, strokeWidth = 1.5, className = "", style }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={strokeWidth}
      stroke="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{
        width: size,
        height: size,
        color: BRAND_COLOR,
        flexShrink: 0,
        ...style,
      }}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"
      />
    </svg>
  );
}

function BrandLogo({
  variant = "sidebar",
  showText = true,
  className = "",
  iconSize,
}) {
  const isAuth = variant === "auth";
  const rootClassName = ["brand-logo", `brand-logo--${variant}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClassName} aria-label={BRAND_NAME}>
      <span className="brand-logo__icon" aria-hidden="true">
        <CubeIcon size={iconSize || (isAuth ? 42 : 40)} />
      </span>

      {showText && (
        <div className="brand-logo__text">
          <strong className="brand-logo__name">{BRAND_NAME}</strong>
          <span className="brand-logo__subtitle">{BRAND_SUBTITLE}</span>
        </div>
      )}
    </div>
  );
}

export { BRAND_NAME, BRAND_SUBTITLE, CubeIcon };
export default BrandLogo;
