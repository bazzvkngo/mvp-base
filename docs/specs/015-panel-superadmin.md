# SPEC 015 — Panel PLATFORM_SUPERADMIN

## Estado post-demo

**Implementado:** directorios y detalles de Empresas/Usuarios/Verificaciones,
resolución y suspensiones autoritativas, y apertura segura de evidencia mediante
una URL firmada temporal obtenida desde Functions. Las cuatro tarjetas del
Dashboard son enlaces completos accesibles por teclado: Empresas, Usuarios y
Verificaciones abren sus directorios; Suspensiones abre Empresas con el filtro
`SUSPENDIDA` activo y su cifra cuenta exclusivamente empresas suspendidas.

## Contexto y autoridad

`/admin` es un contexto separado del ERP, con shell, navegación y servicios propios. El guard de cliente sólo mejora la experiencia: cada consulta y mutación revalida en Functions el custom claim firmado `platformRole: "PLATFORM_SUPERADMIN"` y el estado activo de la cuenta. `OWNER`, `ADMIN` y `MEMBER` nunca derivan privilegios de plataforma desde `membresias`.

Firestore y Storage no ofrecen lecturas globales al claim. Los directorios y detalles se obtienen mediante DTO mínimos de Functions. El documento acreditativo se entrega, cuando existe, mediante una URL firmada de lectura con vigencia de diez minutos; no se abre la colección ni el bucket al SDK global.

## Navegación

- Resumen: Dashboard con conteos de empresas, usuarios, verificaciones y
  empresas suspendidas, con navegación desde cada tarjeta a su directorio o
  filtro coherente existente.
- Clientes de ValoraCloud: Empresas, Usuarios y Verificaciones.
- Un superadmin con una empresa ERP activa puede volver al ERP; un superadmin sin empresas puede entrar a `/admin` sin ser forzado al onboarding.

Empresas muestra nombre, país, propietario, usuarios activos, estado, verificación y registro. El detalle agrega datos legales, miembros, solicitud vigente y eventos resumidos. Usuarios muestra identidad Auth, correo, empresas, estado, alta y último acceso; el detalle conserva sus membresías y eventos.

## Acciones

La resolución de verificación reutiliza `resolverVerificacionEmpresa` y su reserva fiscal global. Suspender/reactivar empresas usa `cambiarEstadoEmpresaPlataforma`; sólo cambia el estado raíz y agrega `eventosPlataforma`. No modifica ni borra membresías o datos operacionales.

Suspender/reactivar usuarios usa `cambiarEstadoUsuarioPlataforma`: persiste `usuarios/{uid}.estadoPlataforma`, agrega historial y deshabilita/habilita Firebase Auth. La suspensión invalida refresh tokens y Functions/Rules verifican también el estado persistido para cerrar tokens ya emitidos. No se permite suspender la cuenta actuante ni otra cuenta `PLATFORM_SUPERADMIN` desde el panel.

## Idempotencia y compatibilidad

Las mutaciones requieren `requestId`; sus registros internos y eventos son autoritativos y cerrados al SDK. Reintentar no duplica eventos. Negocios y usuarios legacy sin estado platform se interpretan activos. Reactivar no recrea datos: historiales, membresías y documentos permanecen en sus ubicaciones originales.
