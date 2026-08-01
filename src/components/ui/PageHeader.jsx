import React from "react";

function PageHeader({ eyebrow, title, titleId, className = "" }) {
  return (
    <div className={["ui-page-header", className].filter(Boolean).join(" ")}>
      {eyebrow && <span className="ui-page-header__eyebrow">{eyebrow}</span>}
      <h1 id={titleId} className="ui-page-header__title">
        {title}
      </h1>
    </div>
  );
}

export default PageHeader;
