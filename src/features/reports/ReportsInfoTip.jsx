import React, {useEffect, useId, useRef, useState} from "react";
import {Info} from "lucide-react";

// Ancho del panel (debe coincidir con .reports-info__panel) para no salirse de la ventana.
const PANEL_WIDTH = 320;
const EDGE = 8;

// Ícono "i" con la aclaración de una cifra (Reportes R6). Reemplaza a las notas que antes
// estaban siempre a la vista: el texto NO se pierde ni se altera, solo se muestra al abrirlo.
// - Es un botón real: se llega con Tab, abre con Enter o espacio, cierra con Escape (y vuelve
//   el foco al botón), con un clic fuera o al desplazarse o cambiar el tamaño de la ventana.
// - El texto vive siempre en el DOM (oculto con `hidden` mientras está cerrado) y el botón lo
//   referencia con aria-describedby: un lector de pantalla lo anuncia como descripción del
//   botón aunque no esté abierto.
// - `label` es el nombre accesible del botón ("Qué incluye Vendí").
// - El panel es fixed: no lo recortan las tarjetas con overflow oculto. No hay librería nueva
//   ni tooltip por hover: en pantallas táctiles solo existe el clic.
function ReportsInfoTip({children, className = "", label}) {
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
      event.preventDefault();
      close();
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
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

  return <span className={`reports-info ${className}`.trim()}>
    <button
      aria-controls={panelId}
      aria-describedby={panelId}
      aria-expanded={open}
      aria-label={label}
      className="reports-info__button"
      onClick={toggle}
      ref={buttonRef}
      type="button"
    >
      <Info size={16} aria-hidden="true" />
    </button>
    <span className="reports-info__panel" hidden={!open} id={panelId} role="note" style={open ? position : undefined}>{children}</span>
  </span>;
}

export default ReportsInfoTip;
