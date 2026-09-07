import React from "react";
import {ArrowRight} from "lucide-react";

export function formatPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toLocaleString("es-CL", {maximumFractionDigits: 2})}%`;
}

export function MetricCard({amount, detail, emptyText, icon: Icon, linkLabel, onOpen, restricted, title, variant = "default"}) {
  const content = <>
    <div className="reports-simple-card__top">
      <span className="reports-simple-card__icon"><Icon size={19} aria-hidden="true" /></span>
      <span className="reports-simple-card__title">{title}</span>
      {onOpen && <span className="reports-simple-card__link">{linkLabel}<ArrowRight size={14} /></span>}
    </div>
    <strong className="reports-simple-card__amount">{restricted ? "Acceso restringido" : amount}</strong>
    <small>{restricted ? "Tu perfil no incluye información de rentabilidad." : detail || emptyText}</small>
  </>;
  const className = `reports-simple-card reports-simple-card--${variant}${onOpen ? " reports-simple-card--link" : ""}`;
  if (onOpen) return <button className={className} type="button" onClick={onOpen}>{content}</button>;
  return <article className={className}>{content}</article>;
}
