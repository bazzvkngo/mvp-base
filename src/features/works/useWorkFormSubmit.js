import {useEffect, useRef, useState} from "react";
import {userErrorMessage} from "../../domain/userFacingError.mjs";

// Envío de los formularios de Proyectos y Trabajos (gasto, horas, material, adicional, nota y anulaciones).
// Resuelve dos cosas, con el mismo patrón que ya usa Compras:
// 1) requestId estable. Se crea en el primer envío y se reutiliza en los reintentos (un corte de red
//    puede haber dejado el registro guardado: reenviar con el mismo requestId lo devuelve sin duplicarlo).
//    Se renueva solo tras un éxito o si el usuario cambió los datos (otra `signature`): el backend rechaza
//    reutilizar un requestId con datos distintos.
// 2) Error dentro del diálogo. El rechazo del backend queda en `error`, el formulario conserva lo escrito,
//    el foco pasa al aviso y el aviso se limpia al editar.
// No importa servicios: el envío real lo hace la página con el requestId que recibe.

export function createStableRequestId(prefix = "work") {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random()}`;
  return `${prefix}_${String(value).replace(/[^a-zA-Z0-9_-]/g, "")}`.slice(0, 120);
}

// Núcleo sin React (se prueba solo). `send(requestId, onError)` devuelve una promesa con true si se aplicó;
// `onError` recibe el error original y deja el mensaje para la persona en `onMessage`.
export function createWorkSubmitController({prefix = "", onMessage = () => {}, createRequestId = createStableRequestId} = {}) {
  let current = null;
  let busy = false;
  return {
    async submit(payload, send) {
      if (busy) return false;
      const signature = JSON.stringify(payload ?? null);
      if (!current || current.signature !== signature) current = {id: prefix ? createRequestId(prefix) : "", signature};
      busy = true;
      try {
        const success = await send(current.id, (failure) => onMessage(userErrorMessage(failure)));
        if (success) current = null;
        return Boolean(success);
      } finally {
        busy = false;
      }
    },
  };
}

// Sin `prefix` no hay requestId (el backend de las notas no lo recibe): solo error dentro del formulario.
export default function useWorkFormSubmit({prefix = ""} = {}) {
  const [error, setError] = useState(null);
  const noticeRef = useRef(null);
  const controllerRef = useRef(null);
  if (!controllerRef.current) controllerRef.current = createWorkSubmitController({prefix, onMessage: (message) => setError({message})});
  // Un objeto nuevo por fallo: el mismo mensaje repetido también vuelve a llevar el foco al aviso.
  useEffect(() => { if (error) noticeRef.current?.focus(); }, [error]);
  const clearError = () => setError((current) => (current ? null : current));
  const submit = (payload, send) => {
    clearError();
    return controllerRef.current.submit(payload, send);
  };
  return {clearError, error: error?.message || "", noticeRef, submit};
}
