import React from "react";

function SkipLink({ targetId = "main-content" }) {
  return (
    <a className="skip-link" href={`#${targetId}`}>
      Saltar al contenido principal
    </a>
  );
}

export default SkipLink;
