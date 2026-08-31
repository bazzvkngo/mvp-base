# Empleados y Permisos MVP

## Enmienda RBAC vigente

Las afirmaciones históricas de esta SPEC que limitaban el sistema a
`OWNER`/`ADMIN`/`MEMBER` quedan sustituidas sólo en materia de roles y permisos.
El código vigente incluye perfiles protegidos `OWNER`, `ADMIN`, `VENTAS`,
`COMPRAS`, `TECNICO`, `FINANZAS` y `MEMBER`, además de perfiles personalizados
por negocio basados en módulos completos. La membresía canónica sigue siendo la
única autoridad; un perfil personalizado complementa esa membresía y nunca la
reemplaza.

## Objetivo

Administrar las personas que tienen acceso al negocio activo sin implementar un sistema de Recursos Humanos. La membresía sigue siendo la única fuente de autorización y `negocioActivoId` conserva únicamente su función de contexto de navegación.

## Alcance

El módulo incluye:

- ruta `/empleados` con directorio responsive;
- nombre, correo, rol, estado y fecha de incorporación cuando exista;
- asociación por correo exacto de una cuenta Firebase Authentication existente;
- asignación de perfiles protegidos permitidos o de un perfil personalizado;
- creación, edición y baja lógica de perfiles personalizados por módulos;
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
- `rol`: uno de los perfiles protegidos vigentes;
- `profileId` opcional para una membresía `MEMBER` con perfil personalizado;
- `estado`: `activo` o `inactivo`;
- `creadoEn` y `actualizadoEn`;
- autoría de creación y actualización cuando corresponda.

No se crea una colección paralela de empleados. Los perfiles personalizados
viven bajo `negocios/{businessId}/perfilesEmpleados` y no duplican personas ni
membresías. `creadoEn` es la fecha de incorporación disponible y las membresías
legacy sin esa fecha se muestran sin inventarla.

El correo se resuelve desde Firebase Authentication. El nombre se construye únicamente desde `nombres` y `apellidos` del perfil personal, con `displayName` de Auth como respaldo. El DTO de directorio no expone documento, teléfono ni otros datos privados.

## Estados

- `activo`: la membresía autoriza acceso al negocio mientras éste también esté activo.
- `inactivo`: la membresía se conserva históricamente, pero no autoriza acceso.

No existe eliminación física de membresías. Una membresía inactiva se reactiva actualizando el mismo documento determinista.

## Roles y permisos

- `OWNER`: administra miembros, perfiles protegidos asignables y perfiles
  personalizados; no puede mutar otra membresía `OWNER`.
- `ADMIN`: administra miembros no `OWNER` y no `ADMIN`; no puede asignar ni
  modificar administradores.
- Los perfiles operativos acceden sólo a los módulos y permisos definidos por su
  perfil protegido.
- Una membresía `MEMBER` puede conservar el fallback legacy o recibir un
  `profileId` cuyo conjunto de módulos se resuelve autoritativamente.

Una membresía `OWNER` es inmutable en este MVP: no se degrada, desactiva ni elimina. No se implementa transferencia de propiedad. Una asociación nueva nace activa con el perfil protegido asignable o perfil personalizado que el actor autorizado seleccione; nunca nace como `OWNER`.

## Operaciones autoritativas

Las Callables son:

- `listarMiembrosNegocio`;
- `asociarUsuarioExistente`;
- `actualizarMembresiaNegocio`.

Todas validan autenticación, `businessId`, negocio activo, membresía activa del actor y aislamiento multiempresa. Las mutaciones exigen `OWNER` o `ADMIN`, con las restricciones jerárquicas descritas arriba, y revalidan actor, negocio, perfil y destino dentro de una transacción. Las escrituras directas del SDK cliente sobre `membresias` permanecen bloqueadas.

La administración de perfiles personalizados usa Callables separadas para
listar, crear, actualizar y eliminar lógicamente. Un perfil asignado no puede
eliminarse y sus reservas/nombres internos permanecen cerrados al SDK cliente.

La asociación busca el correo exacto mediante Firebase Admin Auth, rechaza cuentas inexistentes o deshabilitadas y usa el ID determinista para impedir duplicados y carreras. ValoraCloud no bloquea actualmente el acceso por `emailVerified`, por lo que este módulo tampoco introduce esa exigencia aislada.

## Interfaz

La navegación conserva Sidebar V1 y agrega `Empleados` bajo `Gestión`, junto a `Empresa`. La página incluye estados de carga, vacío y error, tabla en escritorio y tarjetas en móvil.

Los controles administrativos aparecen para `OWNER` y `ADMIN` conforme a sus
restricciones jerárquicas. Los perfiles sin permiso de administración reciben
una vista limpia de sólo lectura cuando su módulo permite consultar Empleados.

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

- OWNER y ADMIN listan miembros activos e inactivos de su negocio.
- Los perfiles de sólo lectura con acceso al módulo listan únicamente miembros
  activos.
- OWNER o ADMIN asocia una cuenta existente y habilitada con un perfil permitido.
- Una asociación activa existente no se duplica y una inactiva se conserva para reactivación.
- OWNER administra miembros no OWNER; ADMIN administra miembros que no sean
  OWNER ni ADMIN.
- Ningún actor puede modificar una membresía OWNER.
- Un `businessId` externo es rechazado.
- La escritura directa cliente de membresías continúa bloqueada.
- Cuenta inexistente y cuenta Auth deshabilitada son rechazadas.
- El directorio no expone datos privados fuera del contrato mínimo.
- Build, lint, smokes del módulo y Rules terminan sin regresiones.
