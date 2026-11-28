import React, {useEffect, useId, useRef, useState} from "react";
import {ChevronDown} from "lucide-react";
import AppIcon from "../../../components/ui/AppIcon";
import {filterPatientOptions} from "./patientFormOptions.mjs";
import "./veterinary-patient-options.css";

export default function PatientSearchField({name, label, value, options, placeholder, onSelect, disabled, required, error}) {
  const id = useId();
  const labelId = `${id}-label`;
  const listId = `${id}-options`;
  const errorId = `${id}-error`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const activeOption = useRef(null);
  const selected = value ?? "";
  // Las fichas anteriores pueden contener opciones que hoy están fuera del catálogo.
  const available = selected && !options.includes(selected) ? [...options, selected] : options;
  const matches = filterPatientOptions(available, query ?? "");
  const visibleOptions = !required && !query?.trim() ? ["", ...matches] : matches;
  const activeId = open && activeIndex >= 0 && activeIndex < visibleOptions.length ? `${listId}-${activeIndex}` : undefined;

  useEffect(() => {
    activeOption.current?.scrollIntoView({block: "nearest"});
  }, [activeId, query]);

  function close() {
    setOpen(false);
    setQuery(null);
    setActiveIndex(-1);
  }

  function choose(option) {
    onSelect(name, option);
    close();
  }

  function openList(event) {
    if (open) return;
    setOpen(true);
    event.currentTarget.select();
  }

  function handleKeyDown(event) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (!visibleOptions.length) return;
      const lastIndex = visibleOptions.length - 1;
      const nextIndex = event.key === "ArrowDown"
        ? Math.min(activeIndex + 1, lastIndex)
        : activeIndex < 0 ? lastIndex : Math.max(activeIndex - 1, 0);
      setActiveIndex(nextIndex);
    } else if (open && event.key === "Enter") {
      event.preventDefault();
      if (activeId) choose(visibleOptions[activeIndex]);
    } else if (open && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  return (
    <div className="erp-field">
      <label className="erp-field__label" id={labelId} htmlFor={id}>{label}{required ? " *" : ""}</label>
      <div className="veterinary-patient-options">
        <input className="erp-control veterinary-patient-options__input" id={id} name={name} role="combobox"
          value={query ?? selected} placeholder={placeholder} disabled={disabled} autoComplete="off" spellCheck={false}
          aria-autocomplete="list" aria-expanded={open} aria-controls={open ? listId : undefined}
          aria-activedescendant={activeId} aria-required={required || undefined} aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          onFocus={openList} onClick={openList} onBlur={close} onKeyDown={handleKeyDown}
          onChange={(event) => {
            const text = event.target.value;
            setQuery(text);
            setOpen(true);
            setActiveIndex(text.trim() ? 0 : -1);
          }} />
        <span className="veterinary-patient-options__indicator"><AppIcon icon={ChevronDown} /></span>
        {open && (
          <div className="veterinary-patient-options__popup">
            <ul id={listId} className="veterinary-patient-options__list" role="listbox" aria-labelledby={labelId}>
              {visibleOptions.map((option, index) => {
                const active = index === activeIndex;
                return (
                  <li className="veterinary-patient-options__option" id={`${listId}-${index}`} key={option}
                    ref={active ? activeOption : null} data-active={active || undefined}
                    role="option" aria-selected={option === selected}
                    onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>
                    {option || "Sin especificar"}
                  </li>
                );
              })}
            </ul>
            {!visibleOptions.length && <p className="veterinary-patient-options__empty" role="status">No hay coincidencias.</p>}
          </div>
        )}
      </div>
      {error && <span id={errorId} className="veterinary-field-error" role="alert">{error}</span>}
    </div>
  );
}
