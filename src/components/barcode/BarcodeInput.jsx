import React, {useCallback, useEffect, useRef, useState} from "react";
import {Camera, ScanLine} from "lucide-react";
import ResponsiveDialog from "../ui/ResponsiveDialog";
import {
  barcodeCameraErrorMessage,
  barcodeSupportMessage,
  getBarcodeCameraSupport,
  isDuplicateBarcodeRead,
  normalizeBarcode,
  stopBarcodeCamera,
} from "../../domain/barcode.mjs";
import "./barcode.css";

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
  const [checkingSupport, setCheckingSupport] = useState(false);
  const [cameraStatus, setCameraStatus] = useState("idle");
  const [cameraSupport, setCameraSupport] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(0);
  const inputRef = useRef(null);
  const submittingRef = useRef(false);
  const lastReadRef = useRef(null);
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
    setCameraStatus("idle");
    setCameraSupport(null);
  }, [releaseCamera]);

  const submit = useCallback(async (rawValue) => {
    const barcode = normalizeBarcode(rawValue);
    if (!barcode) {
      setError("Ingresa o escanea un código de barras.");
      return false;
    }
    if (submittingRef.current || isDuplicateBarcodeRead(lastReadRef.current, barcode)) {
      return false;
    }
    const readAt = Date.now();
    lastReadRef.current = {barcode, readAt};
    try {
      submittingRef.current = true;
      setSubmitting(true);
      setError("");
      onChangeRef.current?.(barcode);
      await onSubmitRef.current?.(barcode);
      close();
      return true;
    } catch (submitError) {
      if (lastReadRef.current?.barcode === barcode && lastReadRef.current?.readAt === readAt) {
        lastReadRef.current = null;
      }
      setError(submitError?.message || "No se pudo usar el código leído.");
      return false;
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [close]);

  useEffect(() => {
    if (!open || !cameraSupport?.supported) return undefined;
    let active = true;
    const startCamera = async () => {
      try {
        setCameraStatus("starting");
        const detector = new globalThis.BarcodeDetector({formats: cameraSupport.formats});
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
        if (!active) {
          releaseCamera();
          return;
        }
        setCameraStatus("ready");
        let consecutiveDetectionErrors = 0;
        const detect = async () => {
          if (!active || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            consecutiveDetectionErrors = 0;
            const detected = normalizeBarcode(codes?.[0]?.rawValue);
            if (detected) {
              releaseCamera();
              setManualValue(detected);
              await submit(detected);
              return;
            }
          } catch {
            consecutiveDetectionErrors += 1;
            if (consecutiveDetectionErrors >= 5) {
              releaseCamera();
              setCameraStatus("unavailable");
              setError("La cámara se abrió, pero no pudo analizar la imagen. Usa el lector USB o ingresa el código manualmente.");
              return;
            }
          }
          if (active) frameRef.current = requestAnimationFrame(detect);
        };
        frameRef.current = requestAnimationFrame(detect);
      } catch (cameraError) {
        releaseCamera();
        if (active) {
          setCameraStatus("unavailable");
          setError(barcodeCameraErrorMessage(cameraError));
        }
      }
    };
    startCamera();
    return () => {
      active = false;
      releaseCamera();
    };
  }, [cameraSupport, open, releaseCamera, submit]);

  useEffect(() => {
    if (!open) return undefined;
    const releaseWhenHidden = () => {
      if (document.visibilityState !== "hidden") return;
      releaseCamera();
      setCameraStatus("unavailable");
      setError("La cámara se detuvo al cambiar de vista. Cierra este cuadro y vuelve a abrirlo para reintentar.");
    };
    document.addEventListener("visibilitychange", releaseWhenHidden);
    return () => document.removeEventListener("visibilitychange", releaseWhenHidden);
  }, [open, releaseCamera]);

  const openScanner = async () => {
    if (checkingSupport) return;
    setCheckingSupport(true);
    setManualValue(actionOnly ? "" : normalizeBarcode(value));
    setError("");
    try {
      const support = await getBarcodeCameraSupport();
      setCameraSupport(support);
      setCameraStatus(support.supported ? "starting" : "unavailable");
      if (!support.supported) setError(barcodeSupportMessage(support.reason));
      setOpen(true);
    } finally {
      setCheckingSupport(false);
    }
  };

  const handleKeyDown = (event, currentValue) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submit(currentValue);
  };

  return <>
    {actionOnly ? (
      <button type="button" className="barcode-action-button" disabled={disabled || checkingSupport} onClick={openScanner}>
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
        <button type="button" disabled={disabled || checkingSupport} onClick={openScanner}><Camera size={17} />{actionLabel}</button>
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
          <span><ScanLine size={28} />{cameraStatus === "ready" ? "Cámara lista: apunta al código" : cameraStatus === "starting" ? "Iniciando cámara…" : "Ingreso manual disponible"}</span>
        </div>
        <label>
          <span>Ingreso manual o lector USB</span>
          <input
            ref={inputRef}
            className="erp-control"
            value={manualValue}
            disabled={submitting}
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
