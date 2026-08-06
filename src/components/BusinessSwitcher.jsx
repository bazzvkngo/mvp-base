import React from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import AppIcon from "./ui/AppIcon";

export const BUSINESS_ROLE_LABELS = Object.freeze({
  OWNER: "Propietario",
  ADMIN: "Administrador",
  MEMBER: "Miembro",
});

function getInitials(name) {
  const words = String(name || "Negocio")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.[0] || "N")
    .toUpperCase();
}

function BusinessAvatar({ name }) {
  return (
    <span className="business-avatar" aria-hidden="true">
      {getInitials(name)}
    </span>
  );
}

function BusinessSwitcher({
  activeBusiness,
  businesses = [],
  onAddBusiness,
  onBusinessChanged,
}) {
  const [open, setOpen] = React.useState(false);
  const [switchingId, setSwitchingId] = React.useState("");
  const [error, setError] = React.useState("");
  const rootRef = React.useRef(null);
  const triggerRef = React.useRef(null);
  const itemRefs = React.useRef([]);
  const activeRole = BUSINESS_ROLE_LABELS[activeBusiness?.role] || "Miembro";
  const accessibleName = `${activeBusiness?.nombreComercial || "Negocio activo"}, ${activeRole}`;

  React.useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const openMenu = () => {
    setError("");
    setOpen(true);
    window.requestAnimationFrame(() => {
      const activeIndex = Math.max(
        businesses.findIndex((business) => business.id === activeBusiness?.id),
        0
      );
      itemRefs.current[activeIndex]?.focus();
    });
  };

  const handleTriggerClick = () => {
    if (open) setOpen(false);
    else openMenu();
  };

  const handleMenuKeyDown = (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const availableItems = itemRefs.current.filter(Boolean);
    if (!availableItems.length) return;
    const currentIndex = availableItems.indexOf(document.activeElement);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? availableItems.length - 1
          : event.key === "ArrowDown"
            ? (currentIndex + 1 + availableItems.length) % availableItems.length
            : (currentIndex - 1 + availableItems.length) % availableItems.length;
    availableItems[nextIndex]?.focus();
  };

  const handleSelect = async (business) => {
    if (!business?.id || business.id === activeBusiness?.id || switchingId) {
      setOpen(false);
      return;
    }
    setError("");
    setSwitchingId(business.id);
    try {
      await onBusinessChanged(business);
      setOpen(false);
    } catch (switchError) {
      if (import.meta.env.DEV) {
        console.error(
          "Error cambiando el negocio activo:",
          switchError?.code,
          switchError?.message
        );
      }
      setError(
        String(switchError?.code || "").includes("failed-precondition")
          ? "Ese negocio ya no está disponible. Actualiza la lista e inténtalo nuevamente."
          : "No pudimos cambiar de negocio. Inténtalo nuevamente."
      );
    } finally {
      setSwitchingId("");
    }
  };

  return (
    <section className="business-switcher" ref={rootRef} aria-label="Negocio activo">
      <div className="business-switcher__selector">
        <button
          ref={triggerRef}
          type="button"
          className="business-switcher__trigger"
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={`Seleccionar negocio. Actual: ${accessibleName}`}
          title={accessibleName}
          onClick={handleTriggerClick}
          onKeyDown={(event) => {
            if (!open && ["ArrowDown", "ArrowUp"].includes(event.key)) {
              event.preventDefault();
              openMenu();
            }
          }}
        >
          <BusinessAvatar name={activeBusiness?.nombreComercial} />
          <span className="business-switcher__identity">
            <strong className="business-switcher__name">
              {activeBusiness?.nombreComercial || "Negocio no disponible"}
            </strong>
            <span className="business-switcher__role">{activeRole}</span>
          </span>
          <AppIcon
            icon={ChevronDown}
            size={17}
            className={open ? "business-switcher__chevron is-open" : "business-switcher__chevron"}
          />
        </button>

        {open && (
          <div className="business-menu" role="menu" onKeyDown={handleMenuKeyDown}>
            <div className="business-menu__header">Mis negocios</div>
            <div className="business-menu__list">
              {businesses.length === 0 ? (
                <p className="business-menu__empty" role="status">
                  No encontramos negocios activos para tu cuenta.
                </p>
              ) : (
                businesses.map((business, index) => {
                  const selected = business.id === activeBusiness?.id;
                  const switching = business.id === switchingId;
                  const role = BUSINESS_ROLE_LABELS[business.role] || "Miembro";
                  return (
                    <button
                      key={business.id}
                      ref={(node) => {
                        itemRefs.current[index] = node;
                      }}
                      type="button"
                      className={selected ? "business-menu__item is-active" : "business-menu__item"}
                      role="menuitemradio"
                      aria-checked={selected}
                      disabled={Boolean(switchingId)}
                      title={`${business.nombreComercial}, ${role}`}
                      onClick={() => handleSelect(business)}
                    >
                      <BusinessAvatar name={business.nombreComercial} />
                      <span className="business-menu__identity">
                        <strong>{business.nombreComercial}</strong>
                        <span>{switching ? "Cambiando..." : role}</span>
                      </span>
                      {selected && <AppIcon icon={Check} size={17} />}
                    </button>
                  );
                })
              )}
            </div>
            {error && (
              <p className="business-menu__error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        className="business-switcher__add"
        aria-label="Agregar otro negocio"
        title="Agregar otro negocio"
        onClick={() => {
          setOpen(false);
          onAddBusiness();
        }}
      >
        <span className="business-switcher__add-icon" aria-hidden="true">
          <AppIcon icon={Plus} size={16} />
        </span>
        <span>Agregar otro negocio</span>
      </button>
    </section>
  );
}

export default BusinessSwitcher;
