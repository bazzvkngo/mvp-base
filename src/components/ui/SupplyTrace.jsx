import {useNavigate} from "react-router-dom";
import {buildSupplyTrace, getSupplyDocumentLabel, getSupplyDocumentRoute} from "../../domain/supplyTrace.mjs";

export default function SupplyTrace({currentType, order, purchase, receptions}) {
  const navigate = useNavigate();
  const rows = buildSupplyTrace({currentType, order, purchase, receptions});
  if (!rows.length) return null;

  return <section className="supply-trace" aria-label="Trazabilidad de abastecimiento">
    <span className="supply-trace__title">Trazabilidad</span>
    <div className="supply-trace__rows">{rows.map((nodes, rowIndex) => <div className="supply-trace__row" key={`${nodes.map((node) => `${node.type}-${node.id || node.number}`).join("-")}-${rowIndex}`}>
      {nodes.map((node, index) => {
        const route = getSupplyDocumentRoute(node);
        const content = <><strong>{node.number}</strong><small>{getSupplyDocumentLabel(node.type)}</small></>;
        return <span className="supply-trace__step" key={`${node.type}-${node.id || index}`}>
          {index > 0 && <span className="supply-trace__arrow" aria-hidden="true">→</span>}
          {node.current || !route
            ? <span className={`supply-trace__document${node.current ? " is-current" : " is-pending"}`} aria-current={node.current ? "page" : undefined}>{content}</span>
            : <button type="button" className="supply-trace__document" onClick={() => navigate(route)}>{content}</button>}
        </span>;
      })}
    </div>)}</div>
  </section>;
}
