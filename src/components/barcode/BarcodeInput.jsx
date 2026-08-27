import React, {useCallback, useEffect, useRef, useState} from "react";
import {Camera, ScanLine} from "lucide-react";
import ResponsiveDialog from "../ui/ResponsiveDialog";
import {normalizeBarcode, stopBarcodeCamera} from "../../domain/barcode.mjs";
import "./barcode.css";

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];

export default function BarcodeInput({
  actionLabel = "Escanear código",
  actionOnly = false,
  disabled = false,
  inputClassName = "erp-control",
  onChange,
  onSubmit,
  placeholder = "Escanea o escribe el código del producto",
  value = "",
}) {
  const [open, setOpen] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(0);
  const inputRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;

  const releaseCamera = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    stopBarcodeCamera(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const close = useCallback(() => {
    releaseCamera();
    setOpen(false);
    setError("");
  }, [releaseCamera]);

  const submit = useCallback(async (rawValue) => {
    const barcode = normalizeBarcode(rawValue);
    if (!barcode) {
      setError("Ingresa o escanea un código de barras.");
      return false;
    }
    try {
      setSubmitting(true);
      setError("");
      onChangeRef.current?.(barcode);
      await onSubmitRef.current?.(barcode);
      close();
      return true;
    } catch (submitError) {
      setError(submitError?.message || "No se pudo usar el código leído.");
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [close]);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    const startCamera = async () => {
      if (!("BarcodeDetector" in globalThis) || !navigator.mediaDevices?.getUserMedia) {
        setError("La cámara no está disponible en este navegador. Puedes ingresar el código manualmente.");
        return;
      }
      try {
        const supported = typeof globalThis.BarcodeDetector.getSupportedFormats === "function"
          ? await globalThis.BarcodeDetector.getSupportedFormats()
          : FORMATS;
        const formats = FORMATS.filter((format) => supported.includes(format));
        const detector = new globalThis.BarcodeDetector(formats.length ? {formats} : undefined);
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {facingMode: {ideal: "environment"}},
        });
        if (!active) {
          stopBarcodeCamera(stream);
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          releaseCamera();
          return;
        }
        video.srcObject = stream;
        await video.play();
        const detect = async () => {
          if (!active || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const detected = normalizeBarcode(codes?.[0]?.rawValue);
            if (detected) {
              releaseCamera();
              setManualValue(detected);
              await submit(detected);
              return;
            }
          } catch {
            // Un cuadro incompleto no debe cerrar la captura.
          }
          if (active) frameRef.current = requestAnimationFrame(detect);
        };
        frameRef.current = requestAnimationFrame(detect);
      } catch (cameraError) {
        releaseCamera();
        if (active) {
          setError(
            cameraError?.name === "NotAllowedError"
              ? "No se autorizó la cámara. Puedes ingresar el código manualmente."
              : "No se pudo iniciar la cámara. Puedes ingresar el código manualmente."
          );
        }
      }
    };
    startCamera();
    return () => {
      active = false;
      releaseCamera();
    };
  }, [open, releaseCamera, submit]);

  const openScanner = () => {
    setManualValue(actionOnly ? "" : normalizeBarcode(value));
    setError("");
    setOpen(true);
  };

  const handleKeyDown = (event, currentValue) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submit(currentValue);
  };

  return <>
    {actionOnly ? (
      <button type="button" className="barcode-action-button" disabled={disabled} onClick={openScanner}>
        <ScanLine size={17} />{actionLabel}
      </button>
    ) : (
      <span className="barcode-input-row">
        <input
          className={inputClassName}
          value={value}
          disabled={disabled}
          maxLength={120}
          autoComplete="off"
          inputMode="text"
          placeholder={placeholder}
          onChange={(event) => onChange?.(event.target.value)}
          onKeyDown={(event) => handleKeyDown(event, value)}
        />
        <button type="button" disabled={disabled} onClick={openScanner}><Camera size={17} />{actionLabel}</button>
      </span>
    )}

    <ResponsiveDialog
      open={open}
      onClose={close}
      initialFocusRef={inputRef}
      size="small"
      eyebrow="Código de barras"
      title="Escanear código"
      description="Apunta la cámara al código o usa un lector USB y presiona Enter."
    >
      <div className="barcode-scanner">
        <div className="barcode-scanner__camera">
          <video ref={videoRef} muted playsInline aria-label="Vista de la cámara para escanear" />
          <span><ScanLine size={28} />EAN-13, EAN-8, UPC y Code 128</span>
        </div>
        <label>
          <span>Ingreso manual o lector USB</span>
          <input
            ref={inputRef}
            className="erp-control"
            value={manualValue}
            maxLength={120}
            autoComplete="off"
            onChange={(event) => { setManualValue(event.target.value); setError(""); }}
            onKeyDown={(event) => handleKeyDown(event, manualValue)}
          />
        </label>
        {error && <p className="barcode-scanner__error" role="alert">{error}</p>}
        <div className="barcode-scanner__actions">
          <button type="button" disabled={submitting} onClick={close}>Cancelar</button>
          <button type="button" disabled={submitting || !normalizeBarcode(manualValue)} onClick={() => submit(manualValue)}>
            {submitting ? "Buscando…" : "Usar código"}
          </button>
        </div>
      </div>
    </ResponsiveDialog>
  </>;
}
