# Novedades de la baseline v2

Para Matías (Taller) y Marcelo (Clínica Veterinaria). Léelo junto con `docs/guia-practicantes.md`, que sigue siendo la guía del paso a paso. Aquí está lo que cambió **desde la baseline anterior** y lo que tienes que ajustar en tu módulo.

## 1. Qué cambió en el Core

| Área | Cambio | Dónde mirar |
|---|---|---|
| **Interruptor de módulos** | Los módulos verticales (Taller, Veterinaria) ya **no** se agregan a `BUSINESS_MODULES`. Tienen un registro propio, vacío por defecto, y un negocio solo los ve si el superadmin se los habilita desde la consola de plataforma | SPEC 031, guía sección 4, `functions/verticalModules.js`, `src/domain/verticalModules.mjs` |
| **Acceso en Functions** | `requireBusinessAccess` acepta la opción `requiredVerticalModule: "taller"` (o `"veterinaria"`). Si el negocio no tiene el módulo habilitado, la Function falla con "Este módulo no está habilitado para tu empresa." | `functions/moduleAccess.js` |
| **Reglas** | Existe `isBusinessModuleEnabled(businessId, moduleId)`, sin uso todavía. Tus colecciones deben usarla | `firestore.rules` |
| **Invitaciones de equipo** | `asociarUsuarioExistente` **ya no existe**. Los miembros entran por invitación: el dueño invita, la persona acepta o rechaza | SPEC 032, `functions/teamInvitations.js`, `createMembershipForUser` en `businessMemberships.js` |
| **Rubros** | Solo 7 rubros son seleccionables. Taller y Clínica aparecen como "en construcción" en el selector, sin código | SPEC 030, `docs/como-agregar-un-rubro.md` |
| **Ingreso** | Pantalla de ingreso nueva (panel animado, pestañas Mi empresa y Soy colaborador, pantalla de espera para quien no tiene empresa). El ingreso con Google queda apagado por un interruptor de compilación | SPEC 029 |
| **Logo y marca** | Logo nuevo (`BrandMark`) y token `--color-logo-accent` | `src/components/brand/` |
| **Aceptación legal** | Toda cuenta debe aceptar la política de privacidad y los términos. Una cuenta de prueba sin aceptación verá la pantalla de aceptación antes que cualquier otra | SPEC 024 |
| **Permisos** | TECNICO tiene `INVENTORY_COSTS_READ`. El historial de adquisiciones exige además poder leer compras | `src/domain/rbac.mjs` |
| **Componentes compartidos nuevos** | `Tabs` (pestañas accesibles), `InvitationsInbox`, `RejectInvitationDialog` | `src/components/` |

### Modo oscuro: tokens nuevos

El modo oscuro ya cubre toda la app. Si tu módulo pinta colores, esto te afecta:

- **No uses como color de texto** `--color-brand-600/700/800/900` ni `--color-dark-*` (`color`, `fill`, `stroke`; en CSS y en estilos inline). No cambian con el tema: en oscuro dan entre 1,1:1 y 3,1:1 de contraste. `--color-dark-*` es solo del sidebar de la consola y del panel del login.
- **Qué usar en su lugar** (en claro valen lo mismo que el color que reemplazan, así que el modo claro no cambia):

| Para… | Usa |
|---|---|
| Enlaces, pestañas activas | `--color-text-brand` |
| Eyebrows, iconos, marcadores y bordes de marca | `--color-text-brand-accent` |
| Hover de un enlace de texto | `--color-text-brand-hover` |
| Títulos, cifras | `--color-text-strong` (también `-default` y `-muted`) |
| Texto sobre un fondo `--color-text-strong` (botón oscuro, skip-link) | `--color-text-on-strong` |
| Montos de gasto | `--color-text-expense` |
| Fondo de marca claro con texto del tema encima | `--color-surface-brand` (no `--color-brand-50`) |
| Contorno de foco | `--color-focus` |

- **Bordes:** `--color-border-subtle`, `--color-border-default` y `--color-border-control` suben en oscuro para que las tarjetas y los campos se distingan del fondo. No cambies sus valores claros.
- **Gráficos (Chart.js):** pintan con hex y no leen `var()`. Si agregas uno, espeja los colores oscuros en `CHART_MIRRORS` de `scripts/contrast-smoke.mjs`.
- **Pruebas:** `npm run test:contrast` mide los pares de los tokens y los gráficos; `npm run test:contrast-usage` falla si usas uno de los colores prohibidos como texto. Las dos van en la lista de la sección 5.

También cambiaron Proyectos y trabajos (SPEC 028), Reportes (SPEC 025) y las SPEC 026 y 027 ya están numeradas en `docs/specs/`.

## 2. Qué haces tú, paso a paso

1. Trae la baseline y crea tu rama de integración desde `student-baseline`. El procedimiento exacto está en la guía.
2. Pasa tu trabajo sobre esa rama. Declara en la descripción del PR **cada cambio fuera de tu carpeta** y su motivo.
3. Antes de abrir el PR, corre las pruebas de la sección 5.
4. Un solo PR por módulo, con commits por etapa.

## 3. Matías: Taller

1. **Saca la etapa 11** (la que descuenta stock) a una rama aparte, sin borrarla. El consumo de inventario de los módulos verticales se define aparte en el Core.
2. **Quita `taller` de `BUSINESS_MODULES`** y de los perfiles por módulos. Regístralo en las dos copias del registro con `{id: "taller", label, basePath}`, con la misma entrada en ambas.
3. **Tus Functions** llaman a `requireBusinessAccess` con `requiredVerticalModule: "taller"`.
4. **Tus reglas** usan `isBusinessModuleEnabled(businessId, "taller")` junto con el rol, y la escritura de tus colecciones sigue en `if false`.
5. **Costos:** tu capacidad `costs` se deriva del permiso `INVENTORY_COSTS_READ` del Core, no de una capacidad propia.
6. **Rutas:** toda ruta de Taller debe colgar de tu `basePath` registrado. Una ruta de Taller sin entrada en el registro quedaría abierta a cualquier rol con el permiso, esté o no habilitado el módulo.
7. **Tests y fixtures:** si alguno usaba `asociarUsuarioExistente`, crea las membresías con el Admin SDK o con el flujo de invitación.
8. El `MODULE_DEVELOPMENT_CONTRACT.md` que cita tu SPEC no está en este repositorio. Las reglas vigentes son `AGENTS.md` y la guía.

## 4. Marcelo: Clínica Veterinaria

1. Los tres `rgba()` de `patient-detail.css` pasan a tokens del sistema de diseño.
2. El mensaje de error de `VeterinaryManager.jsx` (~línea 148) no debe engañar: que diga lo que realmente pasó.
3. `requireBusinessId` está duplicada: usa la del Core.
4. **Registra tu módulo** con `{id: "veterinaria", label, basePath: "/clinica-veterinaria"}` en las dos copias del registro, y no lo agregues a `BUSINESS_MODULES`.
5. Tus Functions (cuando existan) usan `requiredVerticalModule: "veterinaria"` y tus reglas `isBusinessModuleEnabled`.
6. El mapa de permisos `VETERINARIA_*` queda pendiente en tu SPEC: defínelo antes de tocar `rbac`.

## 5. Pruebas que debes correr antes del PR

```
npm run test:rbac
npm run test:rules
npm run test:business-onboarding
npm run test:business-members-integrated
npm run test:team-invitations-integrated
npm run test:design
npm run test:contrast
npm run test:contrast-usage
npm run build
npm --prefix functions run lint
git diff --check
```

Más los smokes de tu propio módulo. Las que usan emuladores arrancan solas. Envía el resultado (código de salida de cada una) en la descripción del PR.

- `npm run verify:deploy` junta en una sola corrida las comprobaciones de entrega: proyecto Firebase por defecto, JSON de configuración, scripts npm existentes, `git diff --check`, lint de functions, build y los smokes principales (incluidas las dos guardias de contraste y la de Storage). No despliega nada y termina con `Fallas: N` y código distinto de 0 si N > 0. Córrelo antes de pedir revisión; con `-- --emuladores` suma las pruebas de reglas, y úsalo así siempre que toques `firestore.rules` o `storage.rules`.
- `npm run test:storage-rules-budget` es una guardia estática de `storage.rules`: Storage solo permite leer 2 documentos de Firestore por petición, y una regla que necesite más devuelve 403 en producción aunque el usuario tenga permiso, sin que el emulador lo avise. La guardia cuenta, para cada `allow`, las lecturas del peor caso. Córrela cada vez que agregues o cambies una ruta o una función en `storage.rules` (por ejemplo, adjuntos de tu módulo). No necesita emuladores.

## 6. Qué no tocas

- Functions centrales existentes: `requireBusinessAccess`, `getBusinessSession`, las de plataforma.
- La consola de plataforma y el interruptor de módulos (los gestiona el mantenedor).
- El stock y los costos de inventario.
- `BUSINESS_MODULES` y las reglas de las colecciones del Core.
- Si ante un conflicto al integrar un archivo del Core dudas, **se conserva la versión del Core**.

## 7. Qué viene

Durante la semana habrá correcciones menores del Core (resultado de las pruebas con el usuario piloto). Llegarán como actualizaciones normales de `student-baseline`. No deberían afectar tu módulo si sigues la guía; si algo choca, avisa con el error exacto y el archivo.
