import React, {forwardRef, useCallback, useEffect, useLayoutEffect, useRef} from "react";
import {formatFiscalIdInput} from "../../domain/rut.mjs";
import {normalizeCountryCode} from "../../domain/fiscalIdentifier.mjs";

// En el servidor (pruebas de render) useLayoutEffect avisa; allí basta useEffect.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// Campo de identificación fiscal con formato en vivo. Solo cuando el país es Chile escribe "12.345.678-5"
// mientras se teclea; en los demás países (NIT, CI…) deja el texto tal cual. Cuida el cursor al escribir en
// medio, pegar y borrar, y acepta la K como dígito verificador. Es un <input> normal: className, ref, onBlur,
// placeholder, etc. pasan sin cambios. `onChange` recibe el valor ya formateado (no el evento).
// No valida ni bloquea nada: cada formulario decide cuándo y qué mensaje mostrar (ver getRutStatus).
const FiscalIdInput = forwardRef(function FiscalIdInput({countryCode, maxLength, onChange, value = "", ...inputProps}, forwardedRef) {
  const inputRef = useRef(null);
  const pendingCaret = useRef(null);
  const isChile = normalizeCountryCode(countryCode) === "CL";

  const setRefs = useCallback((node) => {
    inputRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  // Tras pintar el valor formateado, el cursor vuelve a donde estaba el usuario (medido en dígitos).
  useIsomorphicLayoutEffect(() => {
    const input = inputRef.current;
    const caret = pendingCaret.current;
    pendingCaret.current = null;
    if (caret == null || !input || document.activeElement !== input) return;
    input.setSelectionRange(caret, caret);
  });

  const handleChange = (event) => {
    if (!isChile) {
      onChange?.(event.target.value, event);
      return;
    }
    const input = event.target;
    const result = formatFiscalIdInput(countryCode, input.value, input.selectionStart ?? input.value.length, value);
    pendingCaret.current = result.caret;
    if (result.value === value) {
      // El valor no cambia (por ejemplo, un dígito de más): React no vuelve a pintar, así que se restaura a mano.
      input.value = result.value;
      input.setSelectionRange(result.caret, result.caret);
      pendingCaret.current = null;
    }
    onChange?.(result.value, event);
  };

  return (
    <input
      {...inputProps}
      ref={setRefs}
      value={value}
      onChange={handleChange}
      inputMode="text"
      autoCapitalize={isChile ? "characters" : undefined}
      spellCheck={false}
      maxLength={isChile ? undefined : maxLength}
    />
  );
});

export default FiscalIdInput;
