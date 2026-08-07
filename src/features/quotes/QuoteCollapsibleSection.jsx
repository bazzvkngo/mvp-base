import React from "react";

function QuoteCollapsibleSection({ children, open, onToggle, summary, title }) {
  const contentId = React.useId();

  return (
    <section className="quote-collapsible no-print">
      <button
        type="button"
        className="quote-collapsible__trigger"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={onToggle}
      >
        <span>
          <strong>{title}</strong>
          {summary && <small>{summary}</small>}
        </span>
        <span className="quote-collapsible__indicator" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      </button>
      <div id={contentId} className="quote-collapsible__content" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

export default QuoteCollapsibleSection;
