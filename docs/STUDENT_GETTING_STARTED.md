# ValoraCloud: guía de inicio para estudiantes

## Propósito de esta rama

ValoraCloud es un ERP SaaS multiempresa construido como proyecto de tesis. Esta
rama es una base congelada para desarrollar módulos independientes sin alterar
el núcleo ya validado. No es una rama de integración ni de despliegue.

Baseline funcional congelado para estudiantes. La rama puede incorporar commits
documentales posteriores, por lo que su HEAD actual no necesariamente coincide
con este punto de referencia:

```text
rama: student-baseline-20260901
commit: 2dd9581
tag: checkpoint-student-baseline-20260901
```

Core congelado:

```text
commit: 3036228
tag: checkpoint-bruno-c-post-demo-20260901
```

Antes de empezar, lee en este orden:

1. `AGENTS.md`, autoridad operativa para seguridad, arquitectura y workflow;
2. `docs/MODULE_DEVELOPMENT_CONTRACT.md`;
3. `docs/STUDENT_GIT_WORKFLOW.md`;
4. `docs/specs/016-vision-post-demo-bruno.md`;
5. la SPEC específica del módulo en `docs/specs/`.

Si una decisión de negocio es ambigua o los documentos parecen contradecirse,
detén la implementación, registra la duda y pide revisión al mantenedor. No
conviertas una idea pendiente en comportamiento existente.

## Stack

- React 19, Vite 7 y JavaScript;
- Firebase Authentication, Firestore, Functions y Storage;
- Functions 2nd Gen sobre Node.js 22;
- reglas y pruebas locales mediante Firebase Emulator Suite;
- Node.js y npm para scripts, smokes y build.

## Estructura principal

```text
src/                 frontend, dominio, páginas, componentes y servicios
functions/           backend autoritativo y validaciones sensibles
scripts/             smokes, integraciones y utilidades controladas
docs/specs/          contratos funcionales e invariantes del producto
firestore.rules      autorización global de Firestore
storage.rules        autorización global de Storage
firebase.json        configuración de Firebase y emuladores
AGENTS.md             reglas operativas del repositorio
```

## Instalación

Requisitos: Node.js 22, npm, Firebase CLI y Java compatible con los emuladores.

Desde la raíz:

```bash
npm install
npm --prefix functions install
```

No solicites ni copies credenciales de producción. Las variables `VITE_*` son
visibles en el navegador y nunca deben contener secretos privados.

## Desarrollo local obligatorio

El flujo estudiantil es siempre emulator-first. Abre dos terminales desde la
raíz del repositorio.

Terminal 1, backend y servicios Firebase locales:

```bash
npm run emulators:start
```

Terminal 2, frontend conectado a los emuladores:

```bash
npm run dev:emulator
```

La aplicación debe indicar `Entorno QA local`. Auth, Firestore, Functions y
Storage deben apuntar juntos a los emuladores; una combinación híbrida se
rechaza. Los datos locales pueden persistirse en `.firebase-emulator-data/`,
que está ignorado por Git.

## Verificación local de empresas

La aprobación empresarial mantiene el mismo flujo seguro del Core: el `OWNER`
envía una solicitud y una cuenta separada de Platform Admin la revisa desde
`/admin/verificaciones`. Para disponer de esa cuenta exclusivamente local,
mantén Emulator Suite iniciado y ejecuta en otra terminal:

```bash
npm run bootstrap:platform-admin:emulator
```

El bootstrap crea o actualiza `platform-admin@valoracloud.local`, le asigna el
custom claim `platformRole: "PLATFORM_SUPERADMIN"` y muestra una contraseña
generada para el entorno local. Si necesitas una contraseña local estable,
puedes definir `VALORACLOUD_LOCAL_PLATFORM_ADMIN_PASSWORD` antes de ejecutar el
comando; debe tener entre 12 y 128 caracteres y no debe ser una credencial real.

Después inicia la aplicación con `npm run dev:emulator`, ingresa como `OWNER`,
crea la empresa y envía su verificación. Abre una segunda sesión o ventana de
incógnito, inicia sesión con la cuenta local mostrada por el bootstrap, visita
`/admin/verificaciones`, abre la empresa y apruébala indicando su razón social
oficial. Al volver a la sesión `OWNER`, ValoraCloud revalidará la sesión y
habilitará los módulos.

El script valida Auth y Firestore antes de escribir y aborta si cualquiera no
apunta a `localhost`, `127.0.0.1` o `::1`. Esta cuenta jamás debe utilizarse con
Firebase real. El bootstrap no verifica empresas automáticamente ni reemplaza
las validaciones de Functions y Rules.

### Advertencia de producción

En este repositorio, `npm run dev` y `npm run dev:existing` usan datos Firebase
reales y permiten escritura. `.firebaserc` también contiene el proyecto
autoritativo. Un estudiante no debe ejecutar esos comandos ni los probes/reset
de producción.

También están prohibidos:

```text
firebase deploy ...
npm --prefix functions run deploy
despliegues a cPanel
scripts/reset-production-for-v1-qa.mjs
scripts/firebase-real-*.mjs
```

No cambies `.firebaserc`, proyectos Firebase, secretos ni configuración de
deploy para intentar crear un entorno propio. Si el emulador no inicia, informa
el error y pide ayuda.

## Rama de trabajo

Nunca trabajes directamente sobre `student-baseline-20260901` ni sobre
`mvp-base-profesor`. Crea una rama exclusiva para tu módulo:

```bash
git switch student-baseline-20260901
git switch -c feature/nombre-del-modulo
```

Mantén commits pequeños, descriptivos y limitados al módulo. El flujo completo
de entrega está en `docs/STUDENT_GIT_WORKFLOW.md`.

## Validación antes de entregar

Como mínimo:

```bash
npm run build
npm --prefix functions run lint
git diff --check
git status --short
```

Ejecuta además todos los smokes e integraciones relacionados con tu módulo. Si
una prueba requiere emuladores, úsala únicamente contra Emulator Suite. Informa
qué pasó, qué no pudiste ejecutar y cualquier deuda o decisión pendiente.

## Entrega para revisión

Publica únicamente tu feature branch en el remoto autorizado y abre un PR, o
entrega el nombre exacto de la rama al mantenedor. Incluye alcance, colecciones
y campos creados, decisiones de seguridad, pruebas ejecutadas y capturas sólo
cuando aporten evidencia. No hagas merge a la baseline ni despliegues.
