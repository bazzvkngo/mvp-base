import React, {useCallback, useEffect, useRef, useState} from "react";
import {Camera, RefreshCw, ScanLine} from "lucide-react";
import Button from "../ui/Button";
import ResponsiveDialog from "../ui/ResponsiveDialog";
import {
  barcodeCameraErrorMessage,
  barcodeSupportMessage,
  clearCameraNotice,
  clearScanError,
  describeBarcodeCamera,
  EMPTY_SCAN_SESSION,
  getBarcodeCameraSupport,
  isDuplicateBarcodeRead,
  normalizeBarcode,
  recordScanError,
  recordScanSuccess,
  stopBarcodeCamera,
} from "../../domain/barcode.mjs";
import {
  createBarcodeDecoderSession,
  startBarcodeCameraLoop,
  waitForBarcodeVideoReady,
  watchPageVisibility,
} from "../../services/barcodeDecoder";
import "./barcode.css";

const isPageVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

// continuous: el cuadro queda abierto, cada lectura se entrega a onSubmit y se
// acumula en la lista de la sesión; se cierra con "Terminar". onSubmit puede
// devolver {key, label} para identificar la lectura en esa lista.
// actionVariant: con actionOnly, dibuja el disparador con el Button común ("primary", "secondary"...) en vez del botón
// propio de este archivo. actionClassName se suma a las clases de ese Button. ScanProductButton lo usa.
export default function BarcodeInput({
  actionClassName = "",
  actionLabel = "Escanear código",
  actionOnly = false,
  actionVariant,
  continuous = false,
  disabled = false,
  inputClassName = "erp-control",
  onChange,
  onSubmit,
  placeholder = "Escanea o escribe el código del producto",
  value = "",
}) {
  const [open, setOpen] = useState(false);
  const [manualValue, setManualValue] = useState("");
  // Lista de la sesión y un único mensaje visible: el último resultado reemplaza al anterior.
  const [scanSession, setScanSession] = useState(EMPTY_SCAN_SESSION);
  const [submitting, setSubmitting] = useState(false);
  const [checkingSupport, setCheckingSupport] = useState(false);
  const [cameraStatus, setCameraStatus] = useState("idle");
  const [cameraSupport, setCameraSupport] = useState(null);
  // La cámara corre solo con la página visible; al volver se reactiva sola.
  const [pageVisible, setPageVisible] = useState(isPageVisible);
  // Cambiarlo reinicia la cámara ("Reactivar cámara") sin cerrar el cuadro.
  const [cameraRun, setCameraRun] = useState(0);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const decoderRef = useRef(null);
  const cameraAbortRef = useRef(null);
  const frameRef = useRef(0);
  const detectionTimerRef = useRef(0);
  const inputRef = useRef(null);
  const submittingRef = useRef(false);
  const pendingSubmitsRef = useRef(0);
  const submitQueueRef = useRef(Promise.resolve());
  const lastReadRef = useRef(null);
  const cameraReadRef = useRef(null);
  const cameraLoopRef = useRef(null);
  const sessionRef = useRef(0);
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;

  const releaseCamera = useCallback(() => {
    cameraLoopRef.current?.stop();
    cameraLoopRef.current = null;
    cameraAbortRef.current?.abort();
    cameraAbortRef.current = null;
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    if (detectionTimerRef.current) clearTimeout(detectionTimerRef.current);
    frameRef.current = 0;
    detectionTimerRef.current = 0;
    decoderRef.current?.stop?.();
    decoderRef.current = null;
    stopBarcodeCamera(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const close = useCallback(() => {
    releaseCamera();
    setOpen(false);
    setScanSession(EMPTY_SCAN_SESSION);
    setCameraStatus("idle");
    setCameraSupport(null);
    cameraReadRef.current = null;
    sessionRef.current += 1;
  }, [releaseCamera]);

  const showError = useCallback((text) => setScanSession((current) => recordScanError(current, text)), []);
  const showCameraError = useCallback(
    (text) => setScanSession((current) => recordScanError(current, text, "camera")),
    []
  );

  const recordScan = useCallback((result, barcode) => {
    const key = String(result?.key || barcode);
    const label = String(result?.label || barcode);
    setScanSession((current) => recordScanSuccess(current, {key, label}));
    try {
      globalThis.navigator?.vibrate?.(60);
    } catch {
      // La vibración es una señal opcional.
    }
  }, []);

  const processBarcode = useCallback(async (barcode) => {
    const readAt = Date.now();
    // Una lectura en cola que termina tras cerrar el cuadro no debe aparecer en la sesión siguiente.
    const session = sessionRef.current;
    lastReadRef.current = {barcode, readAt};
    pendingSubmitsRef.current += 1;
    setSubmitting(true);
    try {
      onChangeRef.current?.(barcode);
      const result = await onSubmitRef.current?.(barcode);
      if (!continuous) close();
      else if (session === sessionRef.current) recordScan(result, barcode);
      return true;
    } catch (submitError) {
      if (lastReadRef.current?.barcode === barcode && lastReadRef.current?.readAt === readAt) {
        lastReadRef.current = null;
      }
      const errorText = submitError?.message || "No se pudo usar el código leído.";
      if (session === sessionRef.current) showError(continuous ? `Código ${barcode}: ${errorText}` : errorText);
      return false;
    } finally {
      pendingSubmitsRef.current -= 1;
      setSubmitting(pendingSubmitsRef.current > 0);
    }
  }, [close, continuous, recordScan, showError]);

  const submit = useCallback(async (rawValue) => {
    const barcode = normalizeBarcode(rawValue);
    if (!barcode) {
      showError("Ingresa o escanea un código de barras.");
      return false;
    }
    if (continuous) {
      // Las lecturas se procesan en orden para no perder códigos de un lector USB rápido.
      const run = submitQueueRef.current.then(() => processBarcode(barcode));
      submitQueueRef.current = run.catch(() => false);
      return run;
    }
    if (submittingRef.current || isDuplicateBarcodeRead(lastReadRef.current, barcode)) {
      return false;
    }
    submittingRef.current = true;
    try {
      return await processBarcode(barcode);
    } finally {
      submittingRef.current = false;
    }
  }, [continuous, processBarcode, showError]);

  // Se reinicia al ocultarse/volver la página (pageVisible) y con "Reactivar
  // cámara" (cameraRun). La lista de la sesión y su mensaje no se tocan.
  useEffect(() => {
    if (!open || !cameraSupport?.supported || !pageVisible) return undefined;
    let active = true;
    const startCamera = async () => {
      const cameraAbortController = new AbortController();
      cameraAbortRef.current = cameraAbortController;
      try {
        setCameraStatus("starting");
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: {ideal: "environment"},
            width: {ideal: 1280},
            height: {ideal: 720},
          },
        });
        if (!active) {
          stopBarcodeCamera(stream);
          return;
        }
        streamRef.current = stream;
        const videoTrack = stream.getVideoTracks?.()[0];
        if (typeof videoTrack?.getCapabilities === "function") {
          try {
            const capabilities = videoTrack.getCapabilities();
            if (
              Array.isArray(capabilities?.focusMode) &&
              capabilities.focusMode.includes("continuous") &&
              typeof videoTrack.applyConstraints === "function"
            ) {
              await videoTrack.applyConstraints({advanced: [{focusMode: "continuous"}]});
            }
          } catch {
            // El autofocus es una mejora opcional; la webcam sigue siendo utilizable sin él.
          }
        }
        const video = videoRef.current;
        if (!video) {
          releaseCamera();
          return;
        }
        video.srcObject = stream;
        await video.play();
        await waitForBarcodeVideoReady(video, {signal: cameraAbortController.signal});
        if (!active) {
          releaseCamera();
          return;
        }
        setCameraStatus("ready");
        setScanSession(clearCameraNotice);
        const decoder = await createBarcodeDecoderSession({
          ...cameraSupport,
          onFallback: () => {
            if (import.meta.env.DEV) {
              console.debug("[BarcodeInput] decoder native sin lectura; alternando con ZXing.");
            }
          },
        });
        if (!active) {
          decoder.stop();
          releaseCamera();
          return;
        }
        decoderRef.current = decoder;
        if (import.meta.env.DEV) {
          const settings = videoTrack?.getSettings?.() || {};
          console.debug("[BarcodeInput] scanner iniciado.", {
            modo: continuous ? "continuo" : "lectura única",
            decoder: cameraSupport.decoder,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            track: {
              width: settings.width,
              height: settings.height,
              facingMode: settings.facingMode,
              frameRate: settings.frameRate,
              focusMode: settings.focusMode,
            },
          });
        }
        // La cámara sigue abierta mientras se busca: si el código no sirve, el
        // escaneo continúa sin tener que cerrar y reabrir el cuadro.
        cameraLoopRef.current = startBarcodeCameraLoop({
          continuous,
          decoder,
          getVideo: () => (active ? videoRef.current : null),
          readState: cameraReadRef.current,
          onReadState: (state) => { cameraReadRef.current = state; },
          // Diagnóstico solo en desarrollo: permite medir lecturas falsas en cada equipo.
          onDetection: import.meta.env.DEV
            ? (detection, confirmation) => console.debug("[BarcodeInput] lectura de cámara", {
              codigo: confirmation.barcode,
              formato: detection.format || "desconocido",
              decoder: detection.source || "desconocido",
              confirmada: confirmation.confirmed,
              ignoradaPorCodigoLargo: confirmation.ignored,
              lecturasIguales: confirmation.state.candidate?.count,
            })
            : undefined,
          onStatus: (status, barcode) => {
            if (!active) return;
            if (status === "processing") setManualValue(continuous ? "" : barcode);
            setCameraStatus(status);
          },
          onFatalError: () => {
            if (!active) return;
            releaseCamera();
            setCameraStatus("unavailable");
            showCameraError("La cámara se abrió, pero no pudo analizar la imagen. Reactívala o usa el lector USB o el ingreso manual.");
          },
          schedule: (run, kind) => {
            if (!active) return;
            if (kind !== "native") {
              detectionTimerRef.current = setTimeout(() => {
                detectionTimerRef.current = 0;
                if (active) frameRef.current = requestAnimationFrame(run);
              }, 120);
              return;
            }
            frameRef.current = requestAnimationFrame(run);
          },
          submit,
        });
      } catch (cameraError) {
        if (!active || cameraError?.name === "AbortError") return;
        releaseCamera();
        if (active) {
          setCameraStatus("unavailable");
          showCameraError(barcodeCameraErrorMessage(cameraError));
        }
      }
    };
    startCamera();
    return () => {
      active = false;
      releaseCamera();
    };
  }, [cameraRun, cameraSupport, continuous, open, pageVisible, releaseCamera, showCameraError, submit]);

  // Una llamada o un cambio de pestaña oculta la página: la cámara se apaga
  // (efecto anterior) y se reactiva sola al volver, sin cerrar el cuadro.
  useEffect(() => {
    if (!open) return undefined;
    setPageVisible(isPageVisible());
    return watchPageVisibility(globalThis.document, setPageVisible);
  }, [open]);

  const retryCamera = () => {
    setCameraStatus("starting");
    setCameraRun((current) => current + 1);
  };

  const openScanner = async () => {
    if (checkingSupport) return;
    setCheckingSupport(true);
    setManualValue(actionOnly ? "" : normalizeBarcode(value));
    setScanSession(EMPTY_SCAN_SESSION);
    try {
      const support = await getBarcodeCameraSupport();
      setCameraSupport(support);
      setCameraStatus(support.supported ? "starting" : "unavailable");
      if (!support.supported) showCameraError(barcodeSupportMessage(support.reason));
      setOpen(true);
    } finally {
      setCheckingSupport(false);
    }
  };

  const submitManual = (currentValue) => {
    // En modo continuo el campo se limpia de inmediato para recibir la próxima lectura USB.
    if (continuous && normalizeBarcode(currentValue)) setManualValue("");
    submit(currentValue);
  };

  const handleKeyDown = (event, currentValue) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submitManual(currentValue);
  };

  const blockedBySubmit = submitting && !continuous;
  const camera = describeBarcodeCamera({supported: Boolean(cameraSupport?.supported), pageVisible, cameraStatus});
  // Visible en DevTools: permite confirmar qué modo (y qué versión) cargó el navegador.
  const scanMode = continuous ? "continuous" : "single";
  const {entries: scanLog, message} = scanSession;
  const totalScans = scanLog.reduce((sum, entry) => sum + entry.count, 0);

  return <>
    {actionOnly ? (
      actionVariant ? (
        <Button type="button" variant={actionVariant} icon={ScanLine} className={actionClassName} data-scan-mode={scanMode} disabled={disabled || checkingSupport} onClick={openScanner}>{actionLabel}</Button>
      ) : (
        <button type="button" className="barcode-action-button" data-scan-mode={scanMode} disabled={disabled || checkingSupport} onClick={openScanner}>
          <ScanLine size={17} />{actionLabel}
        </button>
      )
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
        <button type="button" data-scan-mode={scanMode} disabled={disabled || checkingSupport} onClick={openScanner}><Camera size={17} />{actionLabel}</button>
      </span>
    )}

    <ResponsiveDialog
      open={open}
      onClose={close}
      initialFocusRef={inputRef}
      size="small"
      eyebrow="Código de barras"
      title={continuous ? "Escaneo continuo" : "Escanear código"}
      description={continuous
        ? "Cada código leído se agrega. Usa la cámara o un lector USB y presiona Terminar al finalizar."
        : "Apunta la cámara al código o usa un lector USB y presiona Enter."}
    >
      <div className="barcode-scanner">
        <div className="barcode-scanner__camera">
          <video ref={videoRef} muted playsInline aria-label="Vista de la cámara para escanear" />
          <span><ScanLine size={28} />{camera.label}</span>
        </div>
        {camera.canRetry && (
          <button type="button" className="barcode-action-button" onClick={retryCamera}>
            <RefreshCw size={17} />Reactivar cámara
          </button>
        )}
        <label>
          <span>Ingreso manual o lector USB</span>
          <input
            ref={inputRef}
            className="erp-control"
            value={manualValue}
            disabled={blockedBySubmit}
            maxLength={120}
            autoComplete="off"
            onChange={(event) => { setManualValue(event.target.value); setScanSession(clearScanError); }}
            onKeyDown={(event) => handleKeyDown(event, manualValue)}
          />
        </label>
        {/* Región persistente: cada resultado reemplaza al anterior y se anuncia. */}
        <p
          className={`barcode-scanner__message${message ? ` barcode-scanner__message--${message.tone}` : ""}`}
          aria-live="polite"
          aria-atomic="true"
        >{message?.text || ""}</p>
        {continuous && <section className="barcode-scanner__session" aria-label="Escaneados en esta sesión">
          <header><span>Escaneados en esta sesión</span><strong>{totalScans}</strong></header>
          {scanLog.length ? <ul>
            {scanLog.map((entry) => <li key={entry.key}><span>{entry.label}</span><strong>×{entry.count}</strong></li>)}
          </ul> : <p>Aún no hay lecturas.</p>}
        </section>}
        <div className="barcode-scanner__actions">
          <button type="button" disabled={blockedBySubmit} onClick={close}>{continuous ? "Terminar" : "Cancelar"}</button>
          <button type="button" disabled={blockedBySubmit || !normalizeBarcode(manualValue)} onClick={() => submitManual(manualValue)}>
            {submitting ? "Buscando…" : continuous ? "Agregar código" : "Usar código"}
          </button>
        </div>
      </div>
    </ResponsiveDialog>
  </>;
}
