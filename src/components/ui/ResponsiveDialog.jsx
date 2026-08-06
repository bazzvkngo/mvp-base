import React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import AppIcon from "./AppIcon";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

const openDialogStack = [];

function ResponsiveDialog({
  children,
  className = "",
  description,
  eyebrow,
  footer,
  initialFocusRef,
  layerClassName = "",
  onClose,
  open,
  portal = true,
  restoreFocus = true,
  size = "medium",
  title,
}) {
  const titleId = React.useId();
  const descriptionId = React.useId();
  const dialogRef = React.useRef(null);
  const closeButtonRef = React.useRef(null);
  const onCloseRef = React.useRef(onClose);
  const restoreFocusRef = React.useRef(restoreFocus);
  const dialogStackIdRef = React.useRef(Symbol("responsive-dialog"));

  onCloseRef.current = onClose;
  restoreFocusRef.current = restoreFocus;

  React.useEffect(() => {
    onCloseRef.current = onClose;
    restoreFocusRef.current = restoreFocus;
  }, [onClose, restoreFocus]);

  React.useEffect(() => {
    if (!open) return undefined;

    const dialogStackId = dialogStackIdRef.current;
    openDialogStack.push(dialogStackId);
    const returnFocusTarget = document.activeElement;
    const originalBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusFrame = window.requestAnimationFrame(() => {
      (initialFocusRef?.current || closeButtonRef.current)?.focus();
    });

    const handleKeyDown = (event) => {
      if (openDialogStack.at(-1) !== dialogStackId) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR)
      );

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = originalBodyOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      const stackIndex = openDialogStack.lastIndexOf(dialogStackId);
      if (stackIndex >= 0) openDialogStack.splice(stackIndex, 1);

      if (restoreFocusRef.current && returnFocusTarget instanceof HTMLElement) {
        window.requestAnimationFrame(() => returnFocusTarget.focus());
      }
    };
  }, [initialFocusRef, open]);

  if (!open) return null;

  const dialog = (
    <div
      className={["responsive-dialog-layer", layerClassName]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className="responsive-dialog-overlay"
        aria-hidden="true"
        onClick={() => onCloseRef.current?.()}
      />
      <section
        ref={dialogRef}
        className={[
          "responsive-dialog",
          `responsive-dialog--${size}`,
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex="-1"
      >
        <header className="responsive-dialog__header no-print">
          <div className="responsive-dialog__heading">
            {eyebrow && (
              <span className="responsive-dialog__eyebrow">{eyebrow}</span>
            )}
            <h2 id={titleId} className="responsive-dialog__title">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="responsive-dialog__description">
                {description}
              </p>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="responsive-dialog__close"
            aria-label="Cerrar diálogo"
            onClick={() => onCloseRef.current?.()}
          >
            <AppIcon icon={X} size={20} />
          </button>
        </header>

        <div className="responsive-dialog__body">{children}</div>

        {footer && (
          <footer className="responsive-dialog__footer no-print">{footer}</footer>
        )}
      </section>
    </div>
  );

  return portal && typeof document !== "undefined"
    ? createPortal(dialog, document.body)
    : dialog;
}

export default ResponsiveDialog;
