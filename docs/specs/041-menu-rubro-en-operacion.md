# SPEC 041: El módulo del rubro dentro de "Operación" y retiro del panel de inicio del Taller

Estado: **implementada en la rama `mejora-refresco-avisos` (2026-11-23), sin commit ni despliegue.** Actualizada en la rama `armonia-rubros` (2026-11-26): el Resumen clínico pasa a «Inicio» (sección 6). Solo cliente (Hosting): no cambia Functions, reglas, permisos, rutas ni datos. `AGENTS.md` sigue siendo la autoridad en seguridad y arquitectura multiempresa.

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
   - Veterinaria: Pacientes, Órdenes de atención, Agenda. Luego aparece Inventario si el perfil tiene acceso. El Resumen clínico no va aquí: va al comienzo de «Inicio» (sección 6).
2. **"Proyectos y trabajos" sigue oculto** en Taller y Veterinaria (SPEC 038); ocupa el lugar que ahora tienen los ítems del rubro. La ruta `/trabajos` no se bloquea.
3. **`buildNavigationSections(registro, {primaryModules, hiddenCorePaths})`** inserta los ítems planos del módulo del rubro (los hijos de `verticalNavigationItems`, sin el nivel anidado) en la sección "Operación", justo antes de Inventario; si Inventario no estuviera, al final. "Operación" la declara siempre el Core: no se crea otra ni se duplica, y no queda vacía. Un módulo sin ítems declarados aporta un solo enlace a su ruta base. Varios ids o ids repetidos no duplican ítems. Se elimina `accent` y `moduleId` de la salida.
4. **Sin opción**, con lista vacía o con ids que no estén en el registro, la salida es la de siempre. Los demás rubros (Tecnología, Electricidad, Ingeniería, Otro servicio, `TALLER_MECANICO`, `AUTOMOTRIZ_MOVILIDAD`) y Chile quedan idénticos a hoy. Un módulo activado a mano en un negocio de otro rubro sigue anidado bajo "Módulos".
5. **Permisos, estado activo y accesibilidad.** Los ítems pasan por `filterNavigationSections`. En Taller, OWNER y ADMIN ven los tres ítems, TECNICO y MEMBER ven Órdenes de trabajo y Vehículos, y VENTAS, COMPRAS y FINANZAS no ven ítems del rubro. En Veterinaria, OWNER y ADMIN acceden a los cuatro ítems (el Resumen clínico en «Inicio» y los otros tres en «Operación»). Los colaboradores con `veterinaria_asignada` acceden al menú de Veterinaria con la vista limitada a sus asignaciones. En Empleados, ese permiso se ofrece cuando el módulo está habilitado en el negocio. El filtro para negocios sin verificar sigue aplicándose. "Resumen clínico" coincide solo con la ruta del resumen. El menú de escritorio y el cajón móvil comparten `PrimaryNavigation` y los títulos de sección usan `--color-text-muted`.
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
- **Operación más larga.** Taller muestra hasta 4 ítems y Veterinaria hasta 4, incluido Inventario (con el Resumen clínico en «Inicio», Veterinaria deja de sumar uno). Revisar el menú lateral en pantallas bajas.
- **`/taller` sin pantalla propia.** Quien abre la ruta base cae en Órdenes de trabajo; ningún ítem del menú queda activo en `/taller` mientras redirige (se resuelve en la misma navegación).
- **Despliegue.** Solo Hosting. **Visual:** revisar en el navegador, en escritorio y cajón móvil, claro y oscuro, el menú de un negocio de Taller (OWNER, TECNICO) y de uno de Veterinaria (OWNER): orden de secciones, ítems de "Operación" antes de Inventario, estado activo, foco y contraste; `/taller` (redirige a órdenes); y un negocio de Informática y uno de Chile, que no deben cambiar.

## 6. Actualización (rama `armonia-rubros`): «Inicio» compartido por los rubros

Solo cliente: sin Functions, reglas, permisos ni rutas nuevas, y sin lecturas nuevas (la pantalla usa lo que ya leía; el perfil de atenciones asignadas lee sus órdenes con la misma consulta que ya usa en Órdenes de atención).

**Qué sustituye.** De la sección 2, punto 1, y de la sección 2, punto 3, solo la ubicación del Resumen clínico: sale de «Operación» y va al comienzo de «Inicio», junto a Reportes. Lo demás de esta SPEC sigue vigente. En esta rama el Panel del taller ya ocupa el comienzo de «Inicio» (`WorkshopHomePage`, ítem con `section: "Inicio"`); por eso lo que las secciones 2 y 3 dicen de Taller (sin panel, `/taller` redirigiendo a las órdenes) queda superado en ese punto. La sección 3 sigue describiendo el retiro de `TallerHomePage` (commit `95c117d`), que no se restaura.

**Menú.** `verticalNavigationItems.veterinaria` declara el Resumen clínico con `section: "Inicio"`, igual que el Panel del taller. «Inicio» queda con el Resumen clínico y Reportes; «Operación» con Pacientes, Órdenes de atención y Agenda antes de Inventario. Ingeniería, los demás rubros y Chile no cambian. Un módulo activado a mano sigue anidado bajo «Módulos» con su ruta base como primer hijo. Los permisos no cambian: el filtro es el mismo y el perfil `veterinaria_asignada` conserva su acceso limitado.

**Resumen clínico.** Misma estructura que el Panel del taller, con los componentes compartidos `components/ui/HomeDashboard.jsx` (estilos `ui-home` en `components.css`, que el panel del Taller también usa sin cambiar su aspecto) y el saludo compartido `hooks/useHomeGreeting.js`:

- Tarjeta de bienvenida: saludo, fecha, resumen del día y acciones (Registrar paciente, Ver agenda, Ver órdenes de atención; el perfil asignado ve Mis citas y Mis órdenes, sin Registrar paciente).
- Cuatro indicadores que llevan a su lista: Citas de hoy, En espera, En atención y Pacientes. No hay un indicador «por cerrar» aparte: una orden está por cerrar mientras sigue en atención.
- «Requiere atención»: órdenes en espera urgentes, prioritarias o sin box, tipo de atención o profesional; consultas que quedaron en atención desde un día anterior; y citas de hoy sin confirmar. Lo más grave primero, con tope de 8.
- «Citas de hoy» (el carrusel que ya existía) junto a «Requiere atención», y «Actividad de hoy» con el último movimiento de cada orden en el día.
- «Servicios y farmacia» se conserva al final (solo Administración).
- Modelo puro en `features/veterinary/veterinaryHomeModel.mjs` (fuera de `domain/`, que se empaqueta tal cual en Functions); prueba `test:veterinary-home`.

**Pruebas.** `business-quick-flow-smoke` cuenta ahora Resumen clínico en «Inicio» y tres ítems en «Operación», y se alineó con el Panel del taller (que ya estaba en «Inicio» y dejaba esas expectativas desfasadas). `work-order-ui-smoke` lee el saludo desde el hook compartido y exige los componentes compartidos.

**Visual.** Revisar en claro y oscuro, escritorio y móvil: el Resumen clínico de Veterinaria (OWNER y un perfil con `veterinaria_asignada`), el Panel del taller (debe verse igual que antes) y el menú de ambos rubros.
