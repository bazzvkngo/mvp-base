import React, {useEffect, useRef, useState} from "react";
import {ScanLine} from "lucide-react";
import Button from "../../../components/ui/Button";
import ResponsiveDialog from "../../../components/ui/ResponsiveDialog";
import VeterinaryField from "../VeterinaryField";
import {parseVeterinaryMicrochipScan} from "./microchipScan.mjs";

// Da tiempo a que el lector envíe todos los caracteres cuando no tiene sufijo Enter.
const SCAN_IDLE_MS = 600;

export default function MicrochipScanner({disabled, onRead, value}) {
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState("");
  const [error, setError] = useState("");
  const [lastRead, setLastRead] = useState("");
  const inputRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function openScanner(event) {
    event.currentTarget.focus();
    setReading("");
    setError("");
    setOpen(true);
  }

  function closeScanner() {
    window.clearTimeout(timer.current);
    setOpen(false);
  }

  function useReading(raw) {
    window.clearTimeout(timer.current);
    const code = parseVeterinaryMicrochipScan(raw);
    if (!code) {
      setError("El lector debe enviar un código de 15 dígitos. Revisa su configuración o copia el número a mano.");
      return;
    }
    onRead(code);
    setLastRead(code);
    closeScanner();
  }

  function changeReading(event) {
    const raw = event.target.value;
    setReading(raw);
    setError("");
    window.clearTimeout(timer.current);
    if (raw) timer.current = window.setTimeout(() => useReading(raw), SCAN_IDLE_MS);
  }

  function finishOnEnter(event) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    useReading(event.currentTarget.value);
  }

  return (
    <>
      <Button type="button" variant="secondary" icon={ScanLine} disabled={disabled} onClick={openScanner}>
        Leer con escáner
      </Button>
      {lastRead && value === lastRead && !open && (
        <p role="status">Microchip leído. Revisa el número antes de guardar.</p>
      )}
      <ResponsiveDialog
        open={open}
        onClose={closeScanner}
        initialFocusRef={inputRef}
        size="small"
        title="Leer microchip"
        description="Conecta el lector al equipo por USB o Bluetooth en modo teclado (HID) y escanea el microchip."
        footer={(
          <>
            <Button type="button" variant="secondary" onClick={closeScanner}>Cancelar</Button>
            <Button type="button" disabled={!reading} onClick={() => useReading(reading)}>Usar código</Button>
          </>
        )}
      >
        <VeterinaryField label="Código del lector" error={error}>
          <input ref={inputRef} className="erp-control" type="text" inputMode="none"
            autoComplete="off" spellCheck={false} placeholder="Esperando 15 dígitos" value={reading}
            onChange={changeReading} onKeyDown={finishOnEnter} />
        </VeterinaryField>
      </ResponsiveDialog>
    </>
  );
}
