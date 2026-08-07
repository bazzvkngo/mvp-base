# Empleados y Permisos MVP

## Objetivo

Administrar las personas que tienen acceso al negocio activo sin implementar un sistema de Recursos Humanos. La membresía sigue siendo la única fuente de autorización y `negocioActivoId` conserva únicamente su función de contexto de navegación.

## Alcance

El módulo incluye:

- ruta `/empleados` con directorio responsive;
- nombre, correo, rol, estado y fecha de incorporación cuando exista;
- asociación por correo exacto de una cuenta Firebase Authentication existente;
- cambio de rol entre `ADMIN` y `MEMBER`;
- activación e inactivación lógica;
- lectura mínima según rol;
- validación autoritativa mediante Cloud Functions.

No incluye remuneraciones, contratos, vacaciones, asistencia, turnos, datos previsionales, creación de cuentas, invitaciones, envío de correo ni transferencia de propiedad.

## Modelo y autoridad

La membresía canónica vive en:

```text
membresias/{businessId}__{uid}
```

Cada documento mantiene:

- `negocioId` y `uid` coherentes con su ID determinista;
- `rol`: `OWNER`, `ADMIN` o `MEMBER`;
- `estado`: `activo` o `inactivo`;
- `creadoEn` y `actualizadoEn`;
- autoría de creación y actualización cuando corresponda.

No se crea una colección paralela de empleados. `creadoEn` es la fecha de incorporación disponible y las membresías legacy sin esa fecha se muestran sin inventarla.

El correo se resuelve desde Firebase Authentication. El nombre se construye únicamente desde `nombres` y `apellidos` del perfil personal, con `displayName` de Auth como respaldo. El DTO de directorio no expone documento, teléfono ni otros datos privados.

## Estados

- `activo`: la membresía autoriza acceso al negocio mientras éste también esté activo.
- `inactivo`: la membresía se conserva históricamente, pero no autoriza acceso.

No existe eliminación física de membresías. Una membresía inactiva se reactiva actualizando el mismo documento determinista.

## Roles y permisos

- `OWNER`: consulta miembros activos e inactivos, asocia cuentas existentes, cambia `ADMIN` <-> `MEMBER` y activa o inactiva miembros no OWNER.
- `ADMIN`: consulta únicamente el directorio mínimo de miembros activos.
- `MEMBER`: consulta únicamente el directorio mínimo de miembros activos.

Una membresía `OWNER` es inmutable en este MVP: no se degrada, desactiva ni elimina. No se implementa transferencia de propiedad. Una asociación nueva siempre nace como `MEMBER` y `activo`.

## Operaciones autoritativas

Las Callables son:

- `listarMiembrosNegocio`;
- `asociarUsuarioExistente`;
- `actualizarMembresiaNegocio`.

Todas validan autenticación, `businessId`, negocio activo, membresía activa del actor y aislamiento multiempresa. Las mutaciones exigen rol `OWNER` y revalidan actor, negocio y destino dentro de una transacción. Las escrituras directas del SDK cliente sobre `membresias` permanecen bloqueadas.

La asociación busca el correo exacto mediante Firebase Admin Auth, rechaza cuentas inexistentes o deshabilitadas y usa el ID determinista para impedir duplicados y carreras. ValoraCloud no bloquea actualmente el acceso por `emailVerified`, por lo que este módulo tampoco introduce esa exigencia aislada.

## Interfaz

La navegación conserva Sidebar V1 y agrega `Empleados` bajo `Gestión`, junto a `Empresa`. La página incluye estados de carga, vacío y error, tabla en escritorio y tarjetas en móvil.

Los controles administrativos aparecen solamente para `OWNER`. `ADMIN` y `MEMBER` reciben una vista limpia de solo lectura, sin controles deshabilitados innecesarios.

## Seguridad

- La membresía activa es la autoridad; `negocioActivoId` no concede acceso.
- No se aceptan IDs de membresía ni roles construidos por el frontend como autoridad.
- El backend comprueba que actor y destino pertenecen al mismo `businessId`.
- Sólo se aceptan roles y estados canónicos.
- Las membresías OWNER se rechazan como destino de cualquier mutación.
- No se exponen perfiles completos ni datos de autenticación adicionales.
- La desactivación surte efecto en Rules y Functions sin depender de controles visuales.

## Límites del MVP

- Sólo se asocian cuentas Auth ya existentes.
- No hay estado pendiente ni flujo de invitación.
- No se crean credenciales ni se envían enlaces o correos.
- No se transfiere ni se agrega el rol OWNER.
- No se corrigen permisos históricos de Cotizaciones, Referencias u otros módulos.
- Los usuarios sin nombre configurado se muestran como “Sin nombre registrado”.

## Criterios de aceptación

- OWNER lista miembros activos e inactivos de su negocio.
- ADMIN y MEMBER listan solamente miembros activos.
- OWNER asocia una cuenta existente y habilitada como MEMBER activo.
- Una asociación activa existente no se duplica y una inactiva se conserva para reactivación.
- Sólo OWNER cambia roles o estados de miembros no OWNER.
- Ningún actor puede modificar una membresía OWNER.
- Un `businessId` externo es rechazado.
- La escritura directa cliente de membresías continúa bloqueada.
- Cuenta inexistente y cuenta Auth deshabilitada son rechazadas.
- El directorio no expone datos privados fuera del contrato mínimo.
- Build, lint, smokes del módulo y Rules terminan sin regresiones.
