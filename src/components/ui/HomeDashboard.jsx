import React from "react";
import {Info} from "lucide-react";
import {Link} from "react-router-dom";

// Piezas del resumen de inicio de un rubro (Panel del taller, Resumen clínico): tarjeta de saludo, indicadores,
// «Requiere atención» y «Actividad de hoy». Solo presentan lo que reciben: cada rubro decide qué datos mostrar.
// Estilos en components.css (ui-home). Los títulos de panel llevan un id propio para su aria-labelledby.

// Tarjeta de bienvenida: línea superior (negocio y fecha), saludo, resumen opcional y acciones principales.
export function HomeHero({kicker, title, summary = null, actions = null}) {
  return <section className="ui-home__hero">
    <p className="ui-home__kicker">{kicker}</p>
    <h2>{title}</h2>
    {summary}
    <div className="ui-home__actions">{actions}</div>
  </section>;
}

// Indicador: con `to` es un enlace a la vista que resume; sin `to` es informativo. `tone`: info, warning o success.
export function HomeTile({icon: Icon, label, to, tone, value}) {
  const content = <>
    <span className="ui-home__tile-icon" aria-hidden="true"><Icon size={22} /></span>
    <span><strong>{value}</strong><span>{label}</span></span>
  </>;
  return to
    ? <Link className="ui-home__tile" data-tone={tone} to={to}>{content}</Link>
    : <div className="ui-home__tile" data-tone={tone}>{content}</div>;
}

export function HomeTiles({label, children}) {
  return <nav className="ui-home__tiles" aria-label={label}>{children}</nav>;
}

// Dos paneles lado a lado (uno bajo el otro en pantallas angostas).
export function HomeSplit({children}) {
  return <div className="ui-home__two">{children}</div>;
}

// «Requiere atención»: cada ítem es {kind, tone, to, title, detail, age}. `icons` asocia `kind` con un ícono de lucide;
// lo que no tenga ícono propio usa Info. `age` es el texto ya armado («hace 2 h»).
export function HomeAttentionPanel({id, title, items, icons = {}, emptyText}) {
  return <section className="erp-panel ui-home__panel" aria-labelledby={id}>
    <h2 id={id} className="erp-panel-title">{title}</h2>
    {items.length === 0
      ? <p className="erp-secondary-text">{emptyText}</p>
      : <ul className="ui-home__alerts">
        {items.map((item) => {
          const Icon = icons[item.kind] || Info;
          return <li key={`${item.kind}-${item.to}-${item.detail}`} data-tone={item.tone}>
            <Link to={item.to}><Icon size={18} aria-hidden="true" />
              <span><strong>{item.title}</strong><span>{item.detail}</span></span>
              <time className="ui-home__age">{item.age}</time></Link>
          </li>;
        })}
      </ul>}
  </section>;
}

// «Actividad de hoy»: cada ítem es {key, time, content}; `content` es el texto (o enlaces) de la línea.
export function HomeTimelinePanel({id, title, items, emptyText}) {
  return <section className="erp-panel ui-home__panel" aria-labelledby={id}>
    <h2 id={id} className="erp-panel-title">{title}</h2>
    {items.length === 0
      ? <p className="erp-secondary-text">{emptyText}</p>
      : <ul className="ui-home__timeline">
        {items.map((item) => <li key={item.key}><time>{item.time}</time><span>{item.content}</span></li>)}
      </ul>}
  </section>;
}
