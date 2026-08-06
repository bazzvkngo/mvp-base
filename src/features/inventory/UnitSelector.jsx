import React, { useMemo, useRef, useState } from "react";
import { INVENTORY_UNITS, normalizeInventoryText } from "../../domain/inventoryMvp.mjs";

const RECOMMENDED_BY_TYPE = {
  servicio: ["servicio", "hora", "jornada", "proyecto", "mes", "unidad"],
  actividad: ["hora", "jornada", "actividad", "tarea", "unidad"],
  producto: ["unidad", "kg", "g", "L", "mL", "m", "cm", "m2", "m3"],
};

function UnitSelector({ error, id = "inventory-unit", onChange, type, value }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const options = useMemo(() => {
    const normalized = normalizeInventoryText(query);
    const recommended = RECOMMENDED_BY_TYPE[type] || [];
    const ordered = [...INVENTORY_UNITS].sort((left, right) => {
      const leftIndex = recommended.indexOf(left.value);
      const rightIndex = recommended.indexOf(right.value);
      if (leftIndex === -1 && rightIndex === -1) return 0;
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    });
    if (!normalized) return ordered;
    return ordered.filter((unit) =>
      normalizeInventoryText(`${unit.label} ${unit.group} ${unit.value}`).includes(normalized)
    );
  }, [query, type]);
  const selected = INVENTORY_UNITS.find((unit) => unit.value === value);

  const selectUnit = (unit) => {
    onChange(unit.value);
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.min(current + 1, Math.max(options.length - 1, 0)));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    }
    if (event.key === "Enter" && open && options[activeIndex]) {
      event.preventDefault();
      selectUnit(options[activeIndex]);
    }
  };

  return (
    <div className="inventory-unit-selector">
      <label htmlFor={id}>Unidad</label>
      <input
        ref={inputRef}
        id={id}
        className="erp-control"
        role="combobox"
        aria-autocomplete="list"
        aria-controls={`${id}-listbox`}
        aria-expanded={open}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        autoComplete="off"
        placeholder="Buscar unidad"
        value={open ? query : selected?.label || value || ""}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <div id={`${id}-listbox`} className="inventory-unit-options" role="listbox">
          {options.length ? options.map((unit, index) => (
            <button
              key={unit.value}
              type="button"
              role="option"
              aria-selected={unit.value === value}
              className={index === activeIndex ? "is-active" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectUnit(unit)}
            >
              <span>{unit.label}</span>
              <small>{unit.group}</small>
            </button>
          )) : <p>No hay unidades coincidentes.</p>}
        </div>
      )}
      {error && <span id={`${id}-error`} className="inventory-field-error">{error}</span>}
    </div>
  );
}

export default UnitSelector;
