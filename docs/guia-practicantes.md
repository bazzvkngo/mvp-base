# Guía para practicantes: nueva `student-baseline`

Lo marcado `[CONFIRMAR]` se verifica al cortar la rama. Si algo de esta guía no coincide con el código, manda el detalle a Mauricio.

## 1. Cómo funciona ahora

- La rama `student-baseline` (sin fecha) sale de `mvp-base-profesor` y tiene la misma protección que la anterior: 1 aprobación, sin force push.
- Ya no se congela: se actualiza con merges periódicos, así que los cambios de Core te llegan sin esperar una baseline nueva.
- `student-baseline-20260901` queda como registro histórico, con el tag `baseline-20260901-final`, que apunta al último commit de la baseline anterior (`61b0c69`). El tag se crea al cortar la nueva rama. No trabajes sobre ella.
- El flujo sigue igual: fork, rama de feature, commits, PR hacia `student-baseline`. Aprobar un PR y mergearlo son dos acciones separadas, y el merge lo hace el mantenedor.

## 2. Cómo pasar tu trabajo a la nueva baseline

1. Verifica que tienes el remoto del repositorio principal: `git remote -v`. Si falta `upstream`, agrégalo con la URL de `bazzvkngo/mvp-base`.
2. Trae los cambios: `git fetch upstream`.
3. En tu rama de feature: `git merge upstream/student-baseline`. **Nunca rebase ni force push.**
4. Si hay conflictos:
   - En archivos de Core, quédate con la versión de Core (la de `upstream`) y anota en la descripción del PR lo que tu módulo necesitaba de ahí.
   - En tus archivos propios, conserva los tuyos.
   - En `firestore.rules` y `functions/index.js`: toma la versión de Core y vuelve a agregar encima lo tuyo (tus colecciones y tus exports).
5. Corre las verificaciones de la sección 5 y corrige lo que falle.
6. Cambia la rama destino de tu PR a `student-baseline` (en GitHub: Edit, junto al título del PR, y cambia la base). No cierres el PR para abrir otro: sigue subiendo commits a la misma rama.

## 3. Qué cambió desde `student-baseline-20260901`

- **Sistema de diseño.** Tokens en `src/styles/tokens.css` y modo oscuro. Componentes compartidos: `MoreActionsMenu`, `BarcodeInput`, `ContactLinks`, `LoadingState`, `SkeletonCards` y `Tabs` (pestañas accesibles, con teclado). Smokes `test:design` y `test:contrast`. En tus pantallas: sin colores ni radios literales, usa tokens. `scripts/design-baseline.json` tiene topes por archivo y no se suben.
- **Costo neto e IVA (SPEC 023).** El costo de lo comprado se registra neto de IVA; en boletas el IVA cuenta como costo. Si tu módulo lee costos o montos de compras, usa `neto`.
- **Aceptación de términos y privacidad (SPEC 024).** Toda cuenta debe aceptar los textos al registrarse o en su primer ingreso. En el emulador, un usuario creado a mano en Authentication verá la pantalla de aceptación una vez. Rutas públicas `/privacidad` y `/terminos`. Nuevos: `functions/legalAcceptance.js` y reglas de `aceptacionesLegales`.
- **Reportes (SPEC 025).** Ahora son Resumen, Ventas, Compras y Ganancia. Ventas y Compras suman neto. Se eliminaron vistas sin uso.
- **Permisos.** TECNICO tiene `INVENTORY_COSTS_READ` y ve el historial de adquisiciones solo si además puede leer compras. En Taller, la capacidad `costs` debe derivarse de ese permiso al adaptar tu PR; tu DTO hoy depende de una capacidad propia. [CONFIRMAR: la rama `feature/taller-mecanico` no está en este repo, no se pudo comprobar el DTO.]
- **`AGENTS.md`.** Nueva sección "Verificación por defecto".
- **Escáner de códigos de barras** (`BarcodeInput`) en Inventario, Recepciones, Ventas, Cotizaciones, Órdenes de compra y Proyectos.
- **Specs de tus módulos** en `docs/specs/`: Taller es la 026 y Clínica Veterinaria la 027 (antes 017, que ya era la de margen comercial de Core).

## 4. Reglas

- **No toques Core sin declararlo** en la descripción del PR, con su motivo.
- **Cambios de integración permitidos**, declarados en el PR:
  - rutas en `App.jsx` y menú;
  - tu módulo en `rbac`;
  - reglas para tus propias colecciones (lectura con el módulo, escritura `if false`);
  - tus propias Functions en archivos nuevos, exportadas en `index.js`.
- **No autorizado:** modificar Functions centrales existentes y descontar stock (espera la forma única de consumo de inventario de Core).
- Ningún módulo vertical llega a producción sin el interruptor de módulos por negocio (ya existe; ver "Cómo registrar un módulo vertical" más abajo).
- **Saca taller de `BUSINESS_MODULES` en tu rama.** Los módulos verticales no son módulos del Core ni entran en los perfiles por módulos.
- Un commit por etapa. Los documentos deben coincidir con el diff real.
- Reporta siempre el código de salida real de cada prueba.
- **Modo oscuro: color de texto.** No uses `--color-brand-600/700/800/900` ni `--color-dark-*` como color de texto (`color`, `fill`, `stroke`, en CSS o en estilos inline de JSX): no cambian con el tema y en oscuro quedan casi invisibles. Usa `--color-text-brand` (enlaces, pestañas) o `--color-text-strong` (títulos y cifras). Para fondos de marca claros usa `--color-surface-brand` (nunca `--color-brand-50`). `npm run test:contrast-usage` te lo avisa. Detalle en `docs/novedades-baseline.md`.

### Cómo registrar un módulo vertical

El interruptor de módulos por negocio ya existe (SPEC 031). Un módulo vertical vive en su propio registro, separado de los módulos del Core, y el superadmin lo habilita negocio por negocio. Para registrar el tuyo:

1. **Entrada en el registro, con paridad.** Agrega `{id, label, basePath}` (por ejemplo `{id: "taller", label: "Taller", basePath: "/taller"}`) en `VERTICAL_MODULES` de **`functions/verticalModules.js`** y de **`src/domain/verticalModules.mjs`**. Las dos copias deben quedar idénticas: `npm run test:rbac` compara el bloque del registro texto a texto.
2. **No lo agregues a `BUSINESS_MODULES`** (`rbac`) ni a los perfiles por módulos. Un módulo vertical no aparece en los perfiles personalizados; lo ven los roles con permiso, solo si el negocio lo tiene habilitado.
3. **Permisos y rutas en `rbac`.** Agrega tu permiso y la ruta en `routePermissions` para tu `basePath`. La habilitación del negocio se comprueba además del permiso: `canAccessBusinessPath`, `filterNavigationSections` y `getDefaultBusinessPath` deniegan toda ruta bajo tu `basePath` si el módulo no está en `enabledModules` (se obtiene de la sesión con `getBusinessPathOptions(negocioActivo)`).
4. **Menú.** No declares el ítem a mano: sale del registro, bajo el grupo "Módulos", y solo aparece si el módulo está habilitado.
5. **Functions.** En cada Function de tu módulo, pasa `requiredVerticalModule: "<id>"` a `requireBusinessAccess`. Si el negocio no lo tiene habilitado, responde `failed-precondition` ("Este módulo no está habilitado para tu empresa.").
6. **Reglas Firestore.** En las colecciones de tu módulo combina `hasBusinessModuleAccess` con `isBusinessModuleEnabled(businessId, "<id>")` para la lectura; la escritura sigue `if false`.
7. **Habilitación.** El superadmin lo activa por negocio desde la consola de plataforma (detalle de la empresa, sección "Módulos"), con un motivo que queda en el historial. El cambio se ve al recargar la sesión.

## 5. Verificación antes de pedir revisión

Con los emuladores levantados donde corresponda:

```
npm run test:rules
npm run test:rbac
npm run test:design
npm run test:contrast
npm run test:contrast-usage
npm run build
npm --prefix functions run lint
git diff --check
```

Más los smokes de tu módulo. Si algo del Core falla y no es tuyo, avisa con el error exacto en vez de arreglarlo.

Aclaraciones:

- Esta lista es la exigencia del mantenedor para revisar un PR. Es más estricta que el mínimo diario de `AGENTS.md` (los smokes del módulo, `test:design`, `build` y `git diff --check`).
- `AGENTS.md` rige a los asistentes de IA: no commitean sin que se les pida. A las personas se les pide un commit por etapa (sección 4).

## 6. Qué viene

La integración de Taller y Clínica Veterinaria al Core, ya con el interruptor de módulos por negocio. Las revisiones técnicas completas de cada PR se hacen cuando ya estén adaptados a esta baseline.
