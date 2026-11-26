# SPEC 031: Interruptor de módulos por negocio

Estado: **implementada (2026-10-18)**, en dos partes. **La decisión 2 y la pantalla de la consola fueron sustituidas por la [SPEC 039](039-rubro-define-modulos.md)** (el rubro define los módulos; el panel "Módulos" se retiró). Parte 1 (commit `0a9236f`): registro vacío, acceso en Functions, reglas y Function de plataforma. Parte 2: interfaz, consola de plataforma y documentación. Complementa la SPEC 015 (panel superadmin) y la 016 (visión post-demo); no sustituye ninguno de sus puntos. `AGENTS.md` sigue siendo la autoridad en seguridad y arquitectura multiempresa.

## 1. Decisiones

1. Los módulos verticales (Taller, Clínica Veterinaria...) viven en su **propio registro** (`VERTICAL_MODULES`), no en `BUSINESS_MODULES` ni en los perfiles por módulos. El registro nace **vacío** en el Core: cada vertical agrega su entrada `{id, label, basePath}` al integrarse.
2. La habilitación es el campo `modulosHabilitados` (lista de ids) en `negocios/{businessId}`. Campo ausente equivale a lista vacía. Solo lo escribe la Function de plataforma `cambiarModulosEmpresaPlataforma` (superadmin, con motivo, `requestId` idempotente y evento `modulos_actualizados`). El SDK cliente no puede escribirlo. **Sustituido por la SPEC 033 y la SPEC 039:** también lo escriben la creación de negocios (SPEC 033) y, cuando el rubro cambia, `updateBusinessProfile` y `updateBusinessInformation` (SPEC 039). La Function de plataforma se conserva, pero ya no tiene pantalla.
3. Módulo deshabilitado = **oculto y bloqueado**, con sus datos intactos: sin ítem de menú, ruta denegada en el frontend, Functions con `failed-precondition` y lectura denegada por reglas.
4. **Sin refresco en vivo**: el cambio se ve al recargar la sesión. Es una decisión; no se agrega observación en tiempo real.
5. La autoridad real sigue en backend (Functions y reglas). El bloqueo del frontend es de presentación y no sustituye esa validación.

## 2. Interfaz (parte 2)

- `src/domain/verticalModules.mjs` agrega `getEnabledVerticalModules(sesión)`: toma `modulosHabilitados` del negocio activo (acepta la sesión o el negocio) y lo normaliza contra el registro. Es solo frontend y queda tras el marcador `// --- Solo frontend`; la paridad textual con `functions/verticalModules.js` cubre solo el bloque del registro.
- `src/domain/rbac.mjs`: `canAccessBusinessPath`, `filterNavigationSections` y `getDefaultBusinessPath` reciben una opción `enabledModules` (y `registry`, para pruebas). Una ruta bajo el `basePath` de un módulo vertical se deniega si el módulo no está en `enabledModules`, además de la comprobación normal de permisos. Con acceso en string o sin `enabledModules`, las rutas verticales quedan denegadas. Las rutas del Core no cambian. `getDefaultBusinessPath` nunca aterriza en un vertical deshabilitado (cae a `/cuenta`). `getBusinessPathOptions(negocio)` entrega las opciones desde la sesión.
- Los perfiles por módulos no cambian: los verticales no entran, y un acceso por perfil a una ruta vertical queda denegado.
- Menú: `buildNavigationSections()` (`src/app/navigation.js`) declara los ítems verticales desde el registro, agrupados bajo "Módulos" antes de "Cuenta". Solo aparecen si están habilitados. Con el registro vacío devuelve las secciones del Core sin cambios. **Para el módulo del rubro del negocio, la ubicación fue sustituida por la SPEC 037** (sección principal arriba del menú); los demás módulos habilitados siguen bajo "Módulos".
- ~~Consola de plataforma: sección "Módulos" en el detalle de la empresa (`PlatformModulesPanel.jsx`)~~ **Retirada por la SPEC 039** (el panel y su servicio ya no existen; el historial sigue mostrando `modulos_actualizados`). Descripción histórica: sección "Módulos" en el detalle de la empresa (`PlatformModulesPanel.jsx`), con una casilla por módulo del registro, motivo obligatorio, estado actual, botón Guardar (mismo helper `run` y `requestId` que Suspender) y el mensaje "No hay módulos verticales disponibles todavía." si el registro está vacío. El historial muestra `modulos_actualizados` como "Módulos actualizados" con el antes y el después.

## 3. Pruebas

- `platform-admin-integrated` (con emuladores): además de lo de la parte 1, regresión de que `updateBusinessProfile`, `updateBusinessInformation` y `updateBusinessSettings` conservan `modulosHabilitados` (desde la SPEC 039 vale mientras el rubro no cambie; un cambio de rubro los recalcula).
- `rbac-smoke`: ruta vertical denegada sin habilitar, permitida con el módulo más el permiso, denegada con acceso en string, `BUSINESS_MODULES` sin verticales y registro inyectado de prueba.
- `business-quick-flow`: el menú no muestra verticales por defecto.
- `platform-admin-smoke`: la sección, el servicio y la etiqueta del evento (la sección y el servicio se retiraron en la SPEC 039; el smoke ahora comprueba que ya no existen y que el historial se conserva).

## 4. Pendiente

- Despliegue de Functions, reglas y Hosting.
- La primera entrada real del registro llega con la integración de Taller o Clínica Veterinaria.
- ~~Asociar módulos a un rubro no está en alcance: el rubro sigue siendo descriptivo.~~ **Sustituido por la SPEC 033**: el rubro elegido al crear el negocio habilita sus módulos verticales (`functions/categoryModules.js`). ~~Cambiar el rubro después no recalcula los módulos.~~ **Sustituido por la SPEC 039**: cambiar el rubro recalcula los módulos (solo si el rubro realmente cambia).
