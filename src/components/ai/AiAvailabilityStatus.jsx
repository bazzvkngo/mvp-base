import React from "react";

function formatCountdown(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
      2,
      "0"
    )}:${String(remainder).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(
    2,
    "0"
  )}`;
}

function formatLocalDate(value) {
  if (!value) return "la próxima ventana disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "la próxima ventana disponible";
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getStatusText(status, remainingSeconds, actionLabel) {
  const countdown = formatCountdown(remainingSeconds);
  if (status.reason === "loading") return "Comprobando disponibilidad de IA...";
  if (status.reason === "processing") return "Procesando solicitud de IA...";
  if (status.reason === "cooldown") {
    return `Podrás ${actionLabel} en ${countdown}.`;
  }
  if (status.reason === "in_progress") {
    return `Ya existe una solicitud en curso. Podrás reintentar en ${countdown}.`;
  }
  if (status.reason === "daily_limit") {
    return `Se alcanzó el límite protegido de uso por hoy. Podrás volver a utilizarlo el ${formatLocalDate(
      status.retryAt || status.nextResetAt
    )}.`;
  }
  if (status.reason === "provider_rate_limit") {
    return `El proveedor limitó temporalmente las solicitudes. Podrás reintentar en ${countdown}.`;
  }
  if (status.reason === "provider_error") {
    return status.message || "La IA no pudo completar la solicitud. Puedes reintentar.";
  }
  if (status.reason === "status_error") return status.message;
  return "IA disponible.";
}

function AiAvailabilityStatus({ status, remainingSeconds, actionLabel }) {
  const isError = ["provider_rate_limit", "provider_error", "status_error"].includes(
    status.reason
  );
  return (
    <p
      className={`ai-availability ai-availability--${status.reason}`}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
    >
      {getStatusText(status, remainingSeconds, actionLabel)}
    </p>
  );
}

export default AiAvailabilityStatus;
