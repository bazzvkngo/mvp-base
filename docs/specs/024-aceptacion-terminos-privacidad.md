# SPEC 024: Aceptación de términos y política de privacidad (etapa 1)

Estado: **etapas 1 a 5 construidas; textos con datos reales del proveedor, pendientes de revisión legal**. Versión vigente de los documentos: **2026-10-19** (`LEGAL_DOCUMENTS_VERSION`; antes 2026-10-15). Diseño técnico cerrado con la Parte A de investigación (2026-10-15).

Actualización 2026-10-19: los datos del proveedor (razón social Servicios Integrales Bagner SpA, RUT 77.091.679-8, domicilio Tamarugal 2985, Iquique, Chile, y correo de privacidad bruno.pairumani@bagner.cl) están completos en `LEGAL_PROVIDER` (`src/domain/legalDocumentsContent.mjs`), su única fuente. La política de privacidad incluye ahora el correo de las personas invitadas a un equipo (SPEC 032; vigencia de 7 días). Siguen como marcadores solo plazos y decisiones: `[CONFIRMAR ...]` y `[A DEFINIR ...]`, incluido el plazo de eliminación de invitaciones respondidas o vencidas. Se mantiene el aviso de versión inicial pendiente de revisión legal. Al subir la versión, toda cuenta debe aceptar de nuevo una sola vez.

## 1. Objetivo

Que ValoraCloud tenga páginas públicas de política de privacidad y términos de uso, y que cada persona que usa el sistema los acepte de forma explícita, quedando registrada la versión aceptada y la fecha.

Contexto: el sistema será propiedad de Bagner y se comercializará a otros negocios a mediano plazo. La Ley 21.719 entra en vigencia el 2026-12-01, salvo que prospere el proyecto que la posterga al 2027-12-01 (estado no verificado al 2026-10-15). El README (línea ~246) ya exige revisión profesional de los textos antes de usar datos reales de Bagner.

## 2. Hechos verificados en el repo

- **`usuarios/{uid}` no se crea al registrarse.** Se crea de forma diferida, siempre con `set(..., {merge:true})` y `creadoEn` solo si no existía: `createFirstBusiness` (`functions/businessOnboarding.js` ~827-837), rama de membresía existente (~748-761), `createAdditionalBusiness` (~990-999), `getBusinessSession` (~1428-1440), `setActiveBusiness` (~1356) y el panel de plataforma (`platformAdmin.js` ~722).
- El registro vive en `Login.jsx` (`isLoginView` línea 44, `handleSubmit` 72-124, `registerWithEmail` 112). `authService.js:20-31` crea la cuenta y envía el correo de verificación.
- Tras registrarse, `onAuthStateChanged` (`App.jsx` ~621-636) dispara `getBusinessSession` (~647-670), que lleva a `/onboarding` si no hay negocio.
- Rutas: `/propuesta/:token` se resuelve en un bloque superior de `AppRoutes` (`App.jsx:121-128`), antes de `loading` y del auth. `/login` está en 132-139, solo sin sesión. No hay lazy loading ni guards como componentes: son `return` condicionales.
- Reglas de `usuarios/{uid}`: `read: isOwner`, `create/update/delete: false` (`firestore.rules:721-723`). El cliente no puede escribir.
- No existe componente de checkbox en el sistema de diseño. No hay i18n: los textos están en español dentro del JSX o de módulos de dominio.
- `public-quote.css` tiene un `rgb(...)` literal que `test:design` no aceptaría en código nuevo. No reutilizar sus clases.
- No hay analítica ni scripts de terceros; las tipografías son del sistema. No se requiere banner de cookies.
- El hosting es cPanel con `.htaccess` que reescribe a `index.html`, así que los deep links funcionan sin configuración extra.

## 3. Alcance de la etapa 1

1. Páginas públicas `/privacidad` y `/terminos`, sin sesión, con tokens del sistema de diseño y modo oscuro.
2. Casilla de aceptación en el registro, sin premarcar, que bloquea el envío mientras no esté marcada.
3. Registro de la aceptación: versión y fecha del servidor, escrito solo por backend.
4. Guard para cuentas existentes y para cuentas sin aceptación vigente: pantalla de aceptación antes del onboarding y del resto de la app.
5. Enlaces en el login (ingreso y recuperar contraseña; en el registro, la casilla es el único punto) y en el pie de la propuesta pública.
6. Mostrar versión y fecha aceptadas en `AccountPage`.

## 4. Fuera de alcance

- Flujo de derechos y supresión de datos (SPEC aparte).
- Banner de cookies (no hay analítica).
- Bloquear la creación de cuentas de Auth hechas directamente contra Firebase (exigiría blocking functions de Identity Platform).
- Enlaces en correos de cotización y órdenes de compra a terceros (evaluar en la etapa 2).
- Contrato de encargo y términos para otros negocios.
- Código muerto `VERIFICATION_NOTICE_KEY` en `Login.jsx:116` (nada lo lee). No se toca aquí.

## 5. Diseño

### 5.1 Versión vigente

`src/domain/legalDocuments.mjs`: constante de versión vigente y contenido de los textos, función pura sin Firebase. `functions/` no puede importar de `src/`, así que la versión se duplica en `functions/` con un smoke de paridad, igual que `scripts/rbac-smoke.mjs`.

### 5.2 Escritura de la aceptación

Callable nueva `acceptLegalTerms` en `functions/legalAcceptance.js`, exportada en `functions/index.js`.

- Exige autenticación y respeta `assertPlatformUserActive`.
- Valida que la versión enviada sea exactamente la vigente.
- Idempotente: si ya está la versión vigente, no hace nada y no pisa la fecha original.
- Si el documento `usuarios/{uid}` no existe, lo crea con `email` y `creadoEn`, porque otras ramas asumen que `!exists` es quien los pone.
- Guarda en `usuarios/{uid}`: versión aceptada y fecha del servidor. Además, historial append-only en una subcolección, con regla explícita `create/update/delete: false` para el cliente.
- Alternativa descartada: escribir dentro de la creación de negocio, porque toca el Core de onboarding en tres ramas, choca con el `fingerprint` y no cubre a quien no crea negocio ni a las cuentas actuales.

### 5.3 Lectura del estado en el cliente

- **R1 (recomendada):** campo aditivo en la respuesta de `getBusinessSession` (~1450-1480). `userData` ya está cargado (línea 1382), sin lectura extra. Es el único toque al Core.
- **R3 (alternativa sin Core):** lectura directa de `usuarios/{uid}` con el SDK, que las reglas ya permiten.

### 5.4 Carrera tras registrarse

`onAuthStateChanged` dispara `getBusinessSession` antes de que termine la callable. Para evitar que la persona vea la pantalla de aceptación recién registrada: promesa "pendiente" en `authService` que `App` espera antes de decidir. Si resulta compleja, se acepta el parpadeo, porque la callable es idempotente.

### 5.5 Guard de aceptación

- En `AppRoutes`, después de `businessLoading` y `businessError` (`App.jsx:161-165`) y **antes** de `unavailable` (167) y de `needsOnboarding` (183).
- Pantalla de aceptación con enlace a los dos textos y botón de cerrar sesión, como `OnboardingPage`, para no dejar a nadie atrapado.
- Al aceptar, `refreshBusinessSession` (`App.jsx:575`). No debe interferir con `initialActivationRoute` (108-119).
- `/admin` se resuelve antes (141-159), así que el guard no lo alcanza (ver decisión 2).
- Rutas exentas: `/privacidad`, `/terminos` y `/propuesta/:token`, resueltas en el bloque superior antes del auth. Sin ese bloque, un usuario con sesión no podría leer los textos desde la pantalla de aceptación.

### 5.6 UI

- Páginas de texto largo con CSS propio (`legal-page`) y tokens (`--font-size-*`, `--line-height-default`, `--space-*`, `--color-surface-*`, `--color-text-*`, `--radius-lg`).
- Reutilizar `BrandLogo variant="auth"`, `Button` (ghost para volver) y `SkipLink`.
- Crear una clase `ui-` para el checkbox, tras buscar duplicados. Hoy hay `<input type="checkbox">` sueltos en `CompanyConfig` e inventario.
- Casilla con enlaces dentro del formulario, solo en registro, entre `Login.jsx:359` y `375`. Pie con ambos enlaces junto a `.auth-actions` (403-432), solo en login y recuperar contraseña: en el registro la casilla es el único punto de enlace. Usar `Link` de react-router.
- Pie de `PublicQuoteProposalPage.jsx:237-239`. Las ramas de carga y error (113-136) no tienen pie: decidir si llevan enlaces.

## 6. Pruebas

- Ampliar `test:business-onboarding` (`business-onboarding-integrated.mjs`, que ya prueba que el cliente no escribe `usuarios`): idempotencia, versión inválida, sin auth, cuenta suspendida, historial, y que el cliente no pueda falsear el campo.
- Ampliar `test:reactive-business-session` y `test:business-multi` si cambia la forma de la sesión (R1).
- `test:rules` solo si hay subcolección nueva.
- Smoke nuevo: paridad de versión entre `src/` y `functions/`, más aserciones estáticas de rutas públicas y de la casilla en `Login`.
- No romper: `test:business-quick-flow` (regex sobre la ruta `/login` de `App.jsx`, línea ~189) ni `test:firebase-environment` (`assertClientWriteAllowed("crear cuentas")` y que `Login` no contenga `firebaseEnvironment.isReadOnly`, líneas ~131 y ~141).
- Antes de crear `usuarios/{uid}` de forma anticipada, verificar cómo cuenta usuarios el panel de plataforma (`PlatformAdminPages.jsx:185`) y los smokes `test:platform-admin`.
- `test:design`, `test:contrast`, `build` y `git diff --check`, según la verificación por defecto de `AGENTS.md`.

## 7. Etapas de construcción propuestas

1. Dominio: `legalDocuments.mjs`, copia en `functions/` y smoke de paridad.
2. Backend: callable `acceptLegalTerms`, Rules de la subcolección, campo en `getBusinessSession`, pruebas de integración.
3. Páginas públicas y rutas en `App.jsx`, con CSS propio y texto provisional.
4. Registro: casilla, enlaces del login y del pie de la propuesta pública.
5. Guard y pantalla de aceptación para cuentas existentes, versión y fecha en `AccountPage`.

Cada etapa en una sesión nueva, sin commit automático.

## 8. Decisiones de negocio a confirmar

1. Casilla única para ambos documentos, con una sola versión común.
2. Cuentas existentes: bloqueo en el próximo ingreso, sin periodo de gracia. Superadmin fuera de la etapa 1.
3. Evidencia: versión y fecha del servidor. No se guarda IP, user-agent ni hash del texto.
4. Toda versión nueva exige re-aceptación (sin distinguir cambios materiales por ahora).
5. Textos: borrador técnico a nombre de Bagner, con marcadores para razón social, RUT, domicilio y correo de contacto. Antes de usar datos reales de Bagner, definir si se publican como definitivos o con marca de revisión pendiente (el README exige revisión profesional).
6. Si la persona rechaza: solo cerrar sesión. La eliminación de cuenta va en la SPEC de supresión.
7. Correos a terceros: sin enlace en esta etapa.
8. Bloqueo solo con guard, sin blocking functions.

## 9. Criterios de aceptación

- Una cuenta nueva no puede completar el registro sin marcar la casilla, y la aceptación queda registrada con versión y fecha.
- Una cuenta existente ve la pantalla de aceptación en el siguiente ingreso y puede cerrar sesión desde ella.
- `/privacidad` y `/terminos` abren sin sesión y con sesión, en modo claro y oscuro.
- Los enlaces están en el login y en el pie de la propuesta pública.
- Ninguna Rule nueva permite escritura desde el cliente.
- No se agregan scripts ni fuentes de terceros.
- Todas las pruebas listadas en la sección 6 pasan con código de salida real 0.

## 10. Etapas posteriores

- SPEC de supresión de datos (solicitud, anonimización de lo que debe conservarse, borrado del resto, cuenta de acceso y membresías).
- Enlace de privacidad en correos a terceros.
- Términos y contrato de encargo para otros negocios, al comercializar.
