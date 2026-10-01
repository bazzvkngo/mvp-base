import React from "react";

export const EMPTY_STATE_ILLUSTRATION_VARIANTS = [
  "empty-list",
  "no-results",
  "all-done",
  "error",
  "empty-search",
];

const c = (part) => `ui-empty-illustration__${part}`;

// Los colores viven en components.css (clases ui-empty-illustration__*), no
// en atributos fill/stroke: var() en atributos de presentación SVG no es
// confiable entre navegadores, y así el dibujo hereda el tema oscuro solo.
const SHAPES = {
  "empty-list": (
    <>
      <circle className={c("backdrop")} cx="80" cy="60" r="52" />
      <rect className={c("card")} x="46" y="22" width="68" height="78" rx="10" />
      <rect className={c("line")} x="58" y="38" width="44" height="6" rx="3" />
      <rect className={c("line")} x="58" y="52" width="36" height="6" rx="3" />
      <rect className={c("line")} x="58" y="66" width="26" height="6" rx="3" />
      <circle className={c("accent")} cx="112" cy="88" r="15" />
      <path className={c("glyph")} d="M112 81v14M105 88h14" />
    </>
  ),
  "no-results": (
    <>
      <circle className={c("backdrop")} cx="80" cy="60" r="52" />
      <rect className={c("card")} x="34" y="22" width="64" height="76" rx="10" />
      <rect className={c("line")} x="46" y="38" width="40" height="6" rx="3" />
      <rect className={c("line")} x="46" y="52" width="30" height="6" rx="3" />
      <rect className={c("line")} x="46" y="66" width="22" height="6" rx="3" />
      <path className={c("accent-line")} d="M118 84l13 13" />
      <circle className={c("lens")} cx="104" cy="70" r="19" />
      <path className={c("accent-line-thin")} d="M97 70h14" />
    </>
  ),
  "all-done": (
    <>
      <circle className={c("backdrop")} cx="80" cy="60" r="52" />
      <rect className={c("card")} x="46" y="22" width="68" height="78" rx="10" />
      <rect className={c("line")} x="58" y="36" width="44" height="6" rx="3" />
      <rect className={c("line")} x="58" y="48" width="30" height="6" rx="3" />
      <circle className={c("accent")} cx="80" cy="76" r="15" />
      <path className={c("glyph")} d="M73 76.5l5 5 9.5-10" />
      <circle className={c("accent")} cx="34" cy="34" r="3" />
      <circle className={c("accent")} cx="128" cy="40" r="4" />
      <circle className={c("line")} cx="126" cy="96" r="3" />
    </>
  ),
  error: (
    <>
      <circle className={c("backdrop")} cx="80" cy="60" r="52" />
      <rect className={c("card")} x="46" y="22" width="68" height="78" rx="10" />
      <rect className={c("line")} x="58" y="36" width="44" height="6" rx="3" />
      <rect className={c("line")} x="58" y="48" width="30" height="6" rx="3" />
      <path className={c("accent-shape")} d="M80 62l15 26H65z" />
      <path className={c("glyph")} d="M80 71v8" />
      <circle className={c("glyph-dot")} cx="80" cy="84" r="1.8" />
    </>
  ),
  "empty-search": (
    <>
      <circle className={c("backdrop")} cx="80" cy="60" r="52" />
      <rect className={c("card")} x="22" y="44" width="116" height="32" rx="16" />
      <circle className={c("lens-small")} cx="41" cy="59" r="7" />
      <path className={c("accent-line-thin")} d="M46 64l5 5" />
      <rect className={c("line")} x="60" y="57" width="38" height="6" rx="3" />
      <path className={c("accent-line-thin")} d="M108 52v16" />
      <circle className={c("accent")} cx="120" cy="28" r="4" />
      <circle className={c("line")} cx="40" cy="94" r="3" />
    </>
  ),
};

// Decorativa: aria-hidden siempre. El nombre accesible lo da el contenedor
// (título + descripción del estado vacío), igual que LoadingState/Skeleton.
function EmptyStateIllustration({ variant = "empty-list", className = "" }) {
  const resolved = EMPTY_STATE_ILLUSTRATION_VARIANTS.includes(variant)
    ? variant
    : "empty-list";
  const classes = [
    "ui-empty-illustration",
    `ui-empty-illustration--${resolved}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      className={classes}
      viewBox="0 0 160 120"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[resolved]}
    </svg>
  );
}

export default EmptyStateIllustration;
