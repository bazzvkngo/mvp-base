import React from "react";
import {
  BriefcaseBusiness,
  Check,
  ChevronDown,
  Search,
  Shapes,
  X,
} from "lucide-react";
import {
  BUSINESS_CATEGORY_CATALOG_VERSION,
  BUSINESS_CATEGORIES,
  BUSINESS_CATEGORY_SECTORS,
  getBusinessCategoryByCode,
  getBusinessCategoryDisplayName,
} from "../domain/businessCatalog";
import {
  filterBusinessCategories,
  groupBusinessCategories,
  isSelectableBusinessCategory,
  normalizeCategorySearch,
} from "../domain/businessCategorySearch.mjs";
import AppIcon from "./ui/AppIcon";
import Button from "./ui/Button";
import ResponsiveDialog from "./ui/ResponsiveDialog";

const SECTOR_ICONS = {
  SERVICIOS_PROYECTOS: BriefcaseBusiness,
  HISTORICO: Shapes,
};

function normalizeCustomCategory(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
}

const BusinessCategoryPicker = React.forwardRef(
  function BusinessCategoryPicker(
    {
      ariaLabel = "Rubro principal",
      customValue = "",
      disabled = false,
      error = "",
      errorId,
      fallbackName = "",
      id,
      name = "rubroCodigo",
      onChange,
      onTouched,
      value = "",
    },
    ref
  ) {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const [draftCode, setDraftCode] = React.useState("");
    const [draftCustomValue, setDraftCustomValue] = React.useState("");
    const [customError, setCustomError] = React.useState("");
    const searchRef = React.useRef(null);
    const optionRefs = React.useRef(new Map());
    const selectedCategory = getBusinessCategoryByCode(value);
    const selectedName = getBusinessCategoryDisplayName(
      value,
      customValue,
      fallbackName
    );
    const isHistoricalSelection = Boolean(
      selectedName &&
        (!selectedCategory ||
          !isSelectableBusinessCategory(
            selectedCategory,
            BUSINESS_CATEGORY_CATALOG_VERSION
          ))
    );

    const openPicker = () => {
      if (disabled) return;
      setDraftCode(value);
      setDraftCustomValue(customValue);
      setCustomError("");
      setQuery("");
      setOpen(true);
    };

    const closePicker = () => {
      setOpen(false);
      onTouched?.();
    };

    const visibleCategories = React.useMemo(
      () => filterBusinessCategories(
        BUSINESS_CATEGORIES,
        query,
        BUSINESS_CATEGORY_CATALOG_VERSION
      ),
      [query]
    );

    const historicalOption = React.useMemo(() => {
      if (!isHistoricalSelection || !value) return null;
      const searchable = normalizeCategorySearch(selectedName);
      const normalizedQuery = normalizeCategorySearch(query);
      if (normalizedQuery && !searchable.includes(normalizedQuery)) return null;
      return {
        ...(selectedCategory || {}),
        code: value,
        name: selectedName,
        sectorCode: "HISTORICO",
        historical: true,
      };
    }, [isHistoricalSelection, query, selectedCategory, selectedName, value]);

    const groups = React.useMemo(() => {
      const currentGroups = groupBusinessCategories(
        visibleCategories,
        BUSINESS_CATEGORY_SECTORS
      );
      return historicalOption
        ? [
            {
              sector: {
                code: "HISTORICO",
                name: "Rubro histórico",
                order: 0,
              },
              categories: [historicalOption],
            },
            ...currentGroups,
          ]
        : currentGroups;
    }, [historicalOption, visibleCategories]);

    const orderedOptions = React.useMemo(
      () => groups.flatMap((group) => group.categories),
      [groups]
    );

    const chooseOption = (category) => {
      setDraftCode(category.code);
      setCustomError("");
    };

    const handleOptionKeyDown = (event, category) => {
      const currentIndex = orderedOptions.findIndex(
        (option) => option.code === category.code
      );
      let nextIndex = null;
      if (["ArrowDown", "ArrowRight"].includes(event.key)) {
        nextIndex = (currentIndex + 1) % orderedOptions.length;
      } else if (["ArrowUp", "ArrowLeft"].includes(event.key)) {
        nextIndex =
          (currentIndex - 1 + orderedOptions.length) % orderedOptions.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = orderedOptions.length - 1;
      }
      if (nextIndex === null || !orderedOptions[nextIndex]) return;
      event.preventDefault();
      const nextOption = orderedOptions[nextIndex];
      chooseOption(nextOption);
      optionRefs.current.get(nextOption.code)?.focus();
    };

    const confirmSelection = () => {
      if (!draftCode) return;
      const normalizedCustomValue = normalizeCustomCategory(draftCustomValue);
      if (draftCode === "OTRO" && normalizedCustomValue.length < 2) {
        setCustomError("Describe el rubro de tu negocio.");
        window.requestAnimationFrame(() =>
          document.getElementById(`${id}-other`)?.focus()
        );
        return;
      }

      onChange?.({
        code: draftCode,
        customName: draftCode === "OTRO" ? normalizedCustomValue : "",
      });
      setOpen(false);
      onTouched?.({
        rubroCodigo: draftCode,
        rubroOtro: draftCode === "OTRO" ? normalizedCustomValue : "",
      });
    };

    return (
      <>
        <button
          ref={ref}
          id={id}
          name={name}
          type="button"
          className="business-category-picker"
          aria-label={ariaLabel}
          aria-describedby={errorId}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-invalid={Boolean(error)}
          disabled={disabled}
          onClick={openPicker}
        >
          <span
            className={
              selectedName
                ? "business-category-picker__value"
                : "business-category-picker__placeholder"
            }
          >
            {selectedName || "Selecciona un rubro"}
          </span>
          {isHistoricalSelection && (
            <span className="business-category-picker__legacy">Histórica</span>
          )}
          <AppIcon icon={ChevronDown} size={18} />
        </button>

        <ResponsiveDialog
          open={open}
          onClose={closePicker}
          initialFocusRef={searchRef}
          title="Selecciona un rubro"
          description="Selecciona la actividad que mejor representa los servicios de tu empresa."
          eyebrow="Rubro principal"
          size="medium"
          className="business-category-dialog"
          layerClassName="business-category-dialog-layer"
          footer={
            <>
              <Button type="button" variant="secondary" onClick={closePicker}>
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={confirmSelection}
                disabled={!draftCode}
              >
                Confirmar
              </Button>
            </>
          }
        >
          <div className="business-category-dialog__content">
            <div className="business-category-search">
              <AppIcon icon={Search} size={18} />
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder="Buscar rubro"
                aria-label="Buscar rubro"
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button
                  type="button"
                  aria-label="Limpiar búsqueda"
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                >
                  <AppIcon icon={X} size={17} />
                </button>
              )}
            </div>

            <div
              className="business-category-options"
              role="radiogroup"
              aria-label="Rubros disponibles"
            >
              {groups.map((group) => {
                const SectorIcon = SECTOR_ICONS[group.sector.code] || Shapes;
                return (
                  <section
                    className="business-category-group"
                    key={group.sector.code}
                    aria-labelledby={`${id}-sector-${group.sector.code}`}
                  >
                    <h3 id={`${id}-sector-${group.sector.code}`}>
                      <AppIcon icon={SectorIcon} size={18} />
                      {group.sector.name}
                    </h3>
                    <div className="business-category-group__grid">
                      {group.categories.map((category) => {
                        const selected = draftCode === category.code;
                        const optionIndex = orderedOptions.findIndex(
                          (option) => option.code === category.code
                        );
                        const selectedIsVisible = orderedOptions.some(
                          (option) => option.code === draftCode
                        );
                        return (
                          <button
                            ref={(node) => {
                              if (node) optionRefs.current.set(category.code, node);
                              else optionRefs.current.delete(category.code);
                            }}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            tabIndex={
                              selected || (!selectedIsVisible && optionIndex === 0)
                                ? 0
                                : -1
                            }
                            className="business-category-option"
                            key={category.code}
                            onClick={() => chooseOption(category)}
                            onKeyDown={(event) =>
                              handleOptionKeyDown(event, category)
                            }
                          >
                            <span>{category.name}</span>
                            <span
                              className="business-category-option__indicator"
                              aria-hidden="true"
                            >
                              {selected && <AppIcon icon={Check} size={16} />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}

              {groups.length === 0 && (
                <div className="business-category-empty" role="status">
                  <AppIcon icon={Search} size={22} />
                  <strong>No encontramos rubros</strong>
                  <span>Prueba con otro nombre o limpia la búsqueda.</span>
                </div>
              )}
            </div>

            {draftCode === "OTRO" && (
              <div className="business-category-other">
                <label htmlFor={`${id}-other`}>
                  ¿Cuál es el rubro de tu negocio?
                  <span aria-hidden="true"> *</span>
                </label>
                <input
                  id={`${id}-other`}
                  type="text"
                  value={draftCustomValue}
                  maxLength="120"
                  aria-invalid={Boolean(customError)}
                  aria-describedby={`${id}-other-error`}
                  onChange={(event) => {
                    setDraftCustomValue(event.target.value);
                    if (customError) setCustomError("");
                  }}
                />
                <span
                  id={`${id}-other-error`}
                  className="business-category-other__error"
                  role={customError ? "alert" : undefined}
                >
                  {customError}
                </span>
              </div>
            )}
          </div>
        </ResponsiveDialog>
      </>
    );
  }
);

export default BusinessCategoryPicker;
