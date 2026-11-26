# SPEC 041: El módulo del rubro dentro de "Operación" y retiro del panel de inicio del Taller

Estado: **implementada en la rama `mejora-refresco-avisos` (2026-11-23), sin commit ni despliegue.** Solo cliente (Hosting): no cambia Functions, reglas, permisos, rutas ni datos. `AGENTS.md` sigue siendo la autoridad en seguridad y arquitectura multiempresa.

Lecturas previas: `AGENTS.md`, SPEC 037 (menú del rubro), 038 (Taller y Veterinaria sin Proyectos) y 039 (el rubro define los módulos).

## 1. Qué sustituye

Esta SPEC **sustituye a la SPEC 037 en el diseño del menú** y retira su entrega B. En concreto:

- **SPEC 037, decisión 3** (sección propia del rubro como primera sección del menú, con `accent: true` y `moduleId`): el módulo del rubro ya no es una sección. Sus ítems pasan a "Operación" (sección 2).
- **SPEC 037, decisión 5** (acento visual, clase `nav-section--primary`): se elimina la clase y su CSS en `layout.css`.
- **SPEC 037, decisión 4** (opt-in): sigue valiendo, pero lo que se inserta son ítems de "Operación", no una sección. La firma de `getBusinessPathOptions` no cambia y solo `AppLayout` pasa `primaryModules`.
- **SPEC 037, sección 7** (entrega B, panel de inicio del Taller): **retirada** (sección 3).
- **SPEC 038, sección 2.2 y sección 6**: "Operación conserva Inventario" pasa a "Operación = ítems del rubro + Inventario"; y el TECNICO de Taller aterriza en `/taller`, que vuelve a redirigir a `/taller/ordenes` (no hay "inicio del taller").

Sigue vigente de la SPEC 037: el espejo cliente del mapa (decisión 1), `getPrimaryVerticalModules` (decisión 2), que los permisos no cambian (decisión 6) y que `getRouteMeta` usa el árbol por defecto. Sigue vigente la SPEC 038 completa (Proyectos y trabajos oculto en Taller y Veterinaria, sin bloquear la ruta, Reportes sin proyectos) y la SPEC 039 (el rubro define los módulos).

## 2. Menú

1. **Orden final** de un negocio con el módulo del rubro habilitado: Inicio, Comercial, **Operación**, Abastecimiento, Gestión, Cuenta. "Operación" contiene, en este orden, los ítems del módulo del rubro e Inventario. Sin sección con el nombre del módulo y sin la sección "Módulos" (queda vacía y se omite).
   - Taller: Órdenes de trabajo, Vehículos, Plazas (este último exige `taller.manage`), Inventario.
   - Veterinaria: Resumen clínico, Pacientes, Agenda, Inventario.
2. **"Proyectos y trabajos" sigue oculto** en Taller y Veterinaria (SPEC 038); ocupa el lugar que ahora tienen los ítems del rubro. La ruta `/trabajos` no se bloquea.
3. **`buildNavigationSections(registro, {primaryModules, hiddenCorePaths})`** inserta los ítems planos del módulo del rubro (los hijos de `verticalNavigationItems`, sin el nivel anidado) en la sección "Operación", justo antes de Inventario; si Inventario no estuviera, al final. "Operación" la declara siempre el Core: no se crea otra ni se duplica, y no queda vacía. Un módulo sin ítems declarados aporta un solo enlace a su ruta base. Varios ids o ids repetidos no duplican ítems. Se elimina `accent` y `moduleId` de la salida.
4. **Sin opción**, con lista vacía o con ids que no estén en el registro, la salida es la de siempre. Los demás rubros (Tecnología, Electricidad, Ingeniería, Otro servicio, `TALLER_MECANICO`, `AUTOMOTRIZ_MOVILIDAD`) y Chile quedan idénticos a hoy. Un módulo activado a mano en un negocio de otro rubro sigue anidado bajo "Módulos".
5. **Permisos, estado activo y accesibilidad conservados.** Los ítems pasan por el mismo `filterNavigationSections` y por los mismos permisos: un rol ve en "Operación" exactamente los ítems del rubro que hoy veía bajo "Módulos" (Taller: OWNER y ADMIN los tres; TECNICO y MEMBER sin "Plazas"; VENTAS, COMPRAS y FINANZAS ninguno; Veterinaria: solo OWNER y ADMIN). Un perfil personalizado y un negocio sin verificar quedan como hoy. "Resumen clínico" sigue con coincidencia exacta (no queda activo en Pacientes ni Agenda). El menú de escritorio y el cajón móvil comparten `PrimaryNavigation`. Los títulos de sección siguen con `--color-text-muted`; no se agregó ningún color.
6. **Aterrizaje sin cambios.** `getDefaultBusinessPath` no se toca; el TECNICO de Taller aterriza en `/taller` (SPEC 038 §3), que redirige a `/taller/ordenes`.

## 3. Retiro del panel de inicio del Taller (entrega B de la SPEC 037)

**Motivo.** El panel resumía las órdenes de trabajo por estado, destacaba alertas ("Esperando aprobación", "Pendiente de entrega"), listaba las últimas OT y las Plazas: decisiones de producto de la vertical Taller, que la SPEC 016 mantiene como `CONFIRMADO PENDIENTE` y que corresponden a quien lleva esa vertical (Matías). Además cargaba todo el historial de OT, vehículos y Plazas sin límite (SPEC 037 §7, riesgo a). Se retira en lugar de ajustarlo.

**Base para el futuro.** La implementación completa queda en el commit `95c117d` (`TallerHomePage.jsx`, `TallerHomeView.jsx`, `workOrderSummary.mjs`, `work-order-summary-smoke.mjs` y el bloque `taller-home__*` de `taller.css`) como punto de partida de una propuesta futura de Matías. No se restaura sin una decisión nueva.

**Qué se quitó, y solo eso:**

- Archivos: `src/pages/TallerHomePage.jsx`, `src/features/taller/TallerHomeView.jsx`, `src/domain/workOrderSummary.mjs` y `scripts/work-order-summary-smoke.mjs`; el script `test:work-order-summary` de `package.json`.
- `navigation.js`: el ítem "Inicio" de Taller y el import sin uso de `LayoutDashboard`. `getRouteMeta("/taller")` vuelve a mostrar "Taller automotriz" (el módulo), como antes del panel.
- `App.jsx`: `/taller` vuelve a redirigir a `/taller/ordenes` y se quita el import. Las rutas hijas no cambian.
- `taller.css`: solo el bloque del panel agregado al final.
- Lo que conservó validez del smoke del panel pasó a `business-quick-flow-smoke`: el aterrizaje del TECNICO de Taller en `/taller` (ya estaba en la sección de la SPEC 038), los demás roles sin cambio, los `getRouteMeta` del Taller y de Veterinaria, las rutas hijas registradas y la redirección de `/taller`.

No se tocó nada de lo que crearon otras personas (Matías, Marcelo): ni las pantallas de órdenes, vehículos y Plazas, ni sus servicios, ni `WorkOrderDetailPage.jsx`.

## 4. Pruebas

- `business-quick-flow-smoke` (sin emuladores): salida por defecto sin cambios; rubros sin módulo y módulos a mano idénticos a hoy; Taller y Veterinaria con el orden de secciones, los ítems y su orden dentro de "Operación", sin sección del rubro, sin `accent`/`moduleId`, el resto del menú igual salvo `/trabajos` (comparación completa del árbol), permisos por rol (OWNER, ADMIN, TECNICO, MEMBER, VENTAS, COMPRAS, FINANZAS) y coincidencia con lo que mostraba "Módulos", estado activo (exacto en Resumen clínico), perfil personalizado, negocio sin verificar, registro inyectado, "Operación" sin Inventario o sin Proyectos y trabajos (ni vacía ni duplicada), varios ids sin duplicar, árbol por defecto sin mutar, `AppLayout` sin clase de acento y `layout.css` sin su CSS; el retiro del panel (archivos, `App.jsx`, `taller.css`, `package.json`, `getRouteMeta`). Quedan las pruebas de la SPEC 038 (ocultación y aterrizaje).
- `category-modules-smoke` (sin emuladores): sin cambios de comportamiento; solo se ajustó un comentario. La ocultación (`getHiddenCorePaths`) sigue yendo con el módulo del rubro habilitado.

## 5. Notas y riesgos

- **Desaparece el aviso visual del rubro.** Sin sección destacada, el módulo del rubro ya no se distingue por color; queda dentro de "Operación". Era la intención del cambio.
- **Operación más larga.** En Taller pasa a 4 ítems y en Veterinaria a 4; revisar la sidebar en pantallas bajas.
- **`/taller` sin pantalla propia.** Quien abre la ruta base cae en Órdenes de trabajo; ningún ítem del menú queda activo en `/taller` mientras redirige (se resuelve en la misma navegación).
- **Despliegue.** Solo Hosting. **Visual:** revisar en el navegador, en escritorio y cajón móvil, claro y oscuro, el menú de un negocio de Taller (OWNER, TECNICO) y de uno de Veterinaria (OWNER): orden de secciones, ítems de "Operación" antes de Inventario, estado activo, foco y contraste; `/taller` (redirige a órdenes); y un negocio de Informática y uno de Chile, que no deben cambiar.
