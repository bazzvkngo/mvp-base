# SPEC 014 — Verificación empresarial

## Contrato y estados

El estado vigente vive en `negocios/{businessId}.verificacionEmpresa.estado` y admite `NO_VERIFICADA`, `PENDIENTE`, `VERIFICADA` y `RECHAZADA`. Un negocio legacy sin el objeto se interpreta como `NO_VERIFICADA`, sin migración. Sólo un `OWNER` activo puede crear una solicitud mediante `solicitarVerificacionEmpresa`; `ADMIN` y `MEMBER` sólo consultan el estado resumido del negocio.

La solicitud autoritativa se conserva append-only en `negocios/{businessId}/solicitudesVerificacionEmpresa/{solicitudId}`. Contiene la razón social e identidad fiscal obtenidas del perfil persistido, relación, correo, teléfono y observaciones del solicitante, UID y fecha. Opcionalmente referencia un PDF, JPG o PNG de hasta 5 MB almacenado en la ruta inmutable `negocios/{businessId}/verificacion/{ownerUid}/{requestId}/...`. Los eventos de solicitud, decisión e invalidación se agregan en `eventosVerificacionEmpresa`; ninguna colección admite escrituras desde el SDK.

## Autoridad de plataforma

Resolver una solicitud requiere el custom claim firmado `platformRole: "PLATFORM_SUPERADMIN"`. El privilegio se provisiona fuera de la aplicación ERP con credenciales administrativas y nunca se deriva ni se concede desde `membresias`. Aunque posea el claim, una identidad con membresía `OWNER` o `ADMIN` activa en el negocio objetivo no puede resolver su verificación. La interfaz separada se define en la SPEC 015.

## Identidad fiscal global

Al aprobar, una transacción reserva `identidadesFiscalesVerificadas/{paisCodigo}__{identificadorFiscalNormalizado}` y actualiza el negocio. El índice global está cerrado al SDK; una reserva perteneciente a otro `businessId` impide la aprobación. Reintentos con el mismo `requestId` y payload devuelven el resultado previo, mientras reutilizarlo con datos diferentes se rechaza.

## Cambios posteriores

Cambiar razón social, país, tipo o valor fiscal durante `PENDIENTE` o `VERIFICADA` invalida el proceso, registra un evento y vuelve a `NO_VERIFICADA`. Si existía una reserva verificada, se libera en la misma transacción. Cambios no fiscales, como teléfono, dirección o logo, conservan el estado. Negocios suspendidos o eliminados no pueden solicitar ni ser resueltos.

## Seguridad y compatibilidad

Functions revalida negocio, membresía, perfil e identidad fiscal; no confía en país, estado o normalización enviados por el cliente. Firestore sólo expone el resumen a miembros activos; la solicitud/evidencia se limita al OWNER solicitante y a plataforma, y los índices/idempotencia permanecen internos. Los perfiles legacy conservan los adaptadores fiscales existentes (`rut` como fallback) y adquieren el estado inicial al primer uso o creación nueva.
