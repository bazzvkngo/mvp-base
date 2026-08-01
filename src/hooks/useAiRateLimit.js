import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAiRateLimitErrorDetails,
  getAiRateLimitStatus,
  normalizeAiRateLimitStatus,
} from "../services/aiRateLimitService";

function getRetryMilliseconds(status) {
  if (!status?.retryAt) return 0;
  const value = new Date(status.retryAt).getTime();
  return Number.isFinite(value) ? value : 0;
}

export default function useAiRateLimit(model, { enabled = true } = {}) {
  const [status, setStatus] = useState(() => ({
    allowed: !enabled,
    reason: enabled ? "loading" : "available",
    model,
    retryAt: null,
    retryAfterSeconds: 0,
    nextResetAt: null,
    message: "",
  }));
  const [nowMs, setNowMs] = useState(Date.now());
  const statusRef = useRef(status);
  statusRef.current = status;

  const refresh = useCallback(async () => {
    if (!enabled) {
      setStatus((current) => ({
        ...current,
        allowed: true,
        reason: "available",
        model,
        retryAt: null,
      }));
      return;
    }

    setStatus((current) => ({ ...current, allowed: false, reason: "loading", model }));
    try {
      setStatus(await getAiRateLimitStatus(model));
    } catch (error) {
      setStatus({
        allowed: true,
        reason: "status_error",
        model,
        retryAt: null,
        retryAfterSeconds: 0,
        nextResetAt: null,
        message: "No fue posible comprobar la disponibilidad de IA.",
      });
    }
  }, [enabled, model]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const retryMs = getRetryMilliseconds(status);
  useEffect(() => {
    if (!retryMs || retryMs <= Date.now()) return undefined;
    const remainingMs = retryMs - Date.now();
    const interval = window.setInterval(
      () => setNowMs(Date.now()),
      remainingMs > 60 * 60 * 1000 ? 60000 : 1000
    );
    return () => window.clearInterval(interval);
  }, [retryMs]);

  const remainingSeconds = retryMs
    ? Math.max(0, Math.ceil((retryMs - nowMs) / 1000))
    : 0;

  useEffect(() => {
    if (!retryMs || remainingSeconds > 0) return;
    setStatus((current) => ({
      ...current,
      allowed: true,
      reason: "available",
      retryAt: null,
      retryAfterSeconds: 0,
    }));
  }, [remainingSeconds, retryMs]);

  const isBlocked = useMemo(
    () =>
      [
        "loading",
        "processing",
        "cooldown",
        "in_progress",
        "daily_limit",
        "provider_rate_limit",
        "provider_error",
      ].includes(status.reason) &&
      (status.reason === "loading" ||
        status.reason === "processing" ||
        status.reason === "daily_limit" ||
        remainingSeconds > 0),
    [remainingSeconds, status.reason]
  );

  const begin = useCallback(() => {
    if (!enabled) return true;
    const current = statusRef.current;
    const currentRetryMs = getRetryMilliseconds(current);
    const blocked =
      ["loading", "processing", "daily_limit"].includes(current.reason) ||
      currentRetryMs > Date.now();
    if (blocked) return false;
    const processingStatus = {
      ...current,
      allowed: false,
      reason: "processing",
      message: "",
    };
    statusRef.current = processingStatus;
    setStatus(processingStatus);
    return true;
  }, [enabled]);

  const applySuccess = useCallback(
    (nextStatus) => {
      if (!enabled || !nextStatus) {
        setStatus((current) => ({
          ...current,
          allowed: true,
          reason: "available",
          retryAt: null,
        }));
        return;
      }
      setNowMs(Date.now());
      setStatus(normalizeAiRateLimitStatus(nextStatus, model));
    },
    [enabled, model]
  );

  const applyError = useCallback(
    (error) => {
      const details = getAiRateLimitErrorDetails(error, model);
      setNowMs(Date.now());
      setStatus(
        details || {
          allowed: true,
          reason: "provider_error",
          model,
          retryAt: null,
          retryAfterSeconds: 0,
          nextResetAt: null,
          message: error?.message || "No se pudo completar la solicitud de IA.",
        }
      );
      return details;
    },
    [model]
  );

  return {
    applyError,
    applySuccess,
    begin,
    isBlocked,
    refresh,
    remainingSeconds,
    status,
  };
}
