import React, {useEffect, useId, useRef, useState} from "react";
import {Info} from "lucide-react";

// Ancho del panel (debe coincidir con .works-info__panel) para no salirse de la ventana.
const PANEL_WIDTH = 320;
const EDGE = 8;

// Ícono "i" con la aclaración de una cifra del balance. Mismo comportamiento que
// ReportsInfoTip (Reportes), con prefijo propio (works-info) para no importar un
// componente ni un estilo de otro feature.
// - Es un botón real: se llega con Tab, abre con Enter o espacio, cierra con Escape (y vuelve
//   el foco al botón), con un clic fuera o al desplazarse o cambiar el tamaño de la ventana.
// - El texto vive siempre en el DOM (oculto con `hidden` mientras está cerrado) y el botón lo
//   referencia con aria-describedby: un lector de pantalla lo anuncia aunque no esté abierto.
// - `label` es el nombre accesible del botón ("Qué incluye Ingresos").
// - El panel es fixed: no lo recortan las tarjetas ni el cuerpo con scroll del diálogo.
export default function WorkInfoTip({children, className = "", label}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({left: EDGE, top: EDGE});
  const buttonRef = useRef(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onPointerDown = (event) => {
      const root = buttonRef.current?.parentElement;
      if (root && !root.contains(event.target)) close();
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      // El diálogo de la ficha también cierra con Escape: aquí solo se cierra la aclaración.
      event.preventDefault();
      event.stopPropagation();
      close();
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const toggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - EDGE));
      setPosition({left, top: rect.bottom + 6});
    }
    setOpen((value) => !value);
  };

  return (
    <span className={`works-info ${className}`.trim()}>
      <button
        aria-controls={panelId}
        aria-describedby={panelId}
        aria-expanded={open}
        aria-label={label}
        className="works-info__button"
        onClick={toggle}
        ref={buttonRef}
        type="button"
      >
        <Info size={16} aria-hidden="true" />
      </button>
      <span className="works-info__panel" hidden={!open} id={panelId} role="note" style={open ? position : undefined}>{children}</span>
    </span>
  );
}
