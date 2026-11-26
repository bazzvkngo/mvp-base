# SPEC 038: Taller y Veterinaria sin "Proyectos y trabajos" (entrega F)

Estado: **implementada en la rama `mejora-refresco-avisos` (2026-11-21), sin commit ni despliegue.** **La [SPEC 041](041-menu-rubro-en-operacion.md) cambió dónde se muestra el módulo del rubro (ítems dentro de "Operación", sin sección propia) y retiró el panel de inicio del Taller: `/taller` vuelve a redirigir a `/taller/ordenes`.** **La nota de servicios, la tabla "Total" de Ganancia y el subtítulo de Ganancia fueron ajustados por la [SPEC 040](040-pulido-core-clientes-y-ganancia.md).** Solo cliente (Hosting): no cambia Functions, reglas, permisos, rutas ni datos. `AGENTS.md` sigue siendo la autoridad en seguridad y arquitectura multiempresa.

Lecturas previas: `AGENTS.md`, SPEC 016 (§E, §G e §I), SPEC 037 (menú del rubro; su diseño lo sustituyó la SPEC 041) y el informe `output/investigacion-menu-reportes-rubro.txt`. La SPEC 016 §I anticipa que "Proyectos y trabajos" evoluciona conceptualmente a Taller para el rubro automotriz; la entrega A de la SPEC 037 mostró el módulo del rubro como sección principal (desde la SPEC 041, como ítems de "Operación"). Esta SPEC quita del menú lo que esos rubros no usan y deja a Reportes coherente con eso.

## 1. Qué sustituye

Sustituye de la SPEC 037, **solo para Taller automotriz y Clínica veterinaria**:

- §2.7 ("No cambia el aterrizaje"): el TECNICO de esos rubros ya no aterriza en `/trabajos` (sección 3).
- §4 (pregunta abierta sobre el aterrizaje): queda resuelta solo para el caso del TECNICO y solo porque su inicio de hoy sería una ruta que el rubro oculta. El resto de la pregunta (que OWNER, ADMIN u otros roles aterricen en su módulo) **sigue abierta para Bruno**.

Todo lo demás de la SPEC 037 sigue vigente, incluido que `getRouteMeta` usa el árbol por defecto y que las rutas no cambian. Los demás rubros (Tecnología, Electricidad, Ingeniería, Otro servicio, `TALLER_MECANICO`, `AUTOMOTRIZ_MOVILIDAD`), Chile y Bolivia quedan idénticos a hoy: la clave es el rubro, no el país.

## 2. Menú

1. **Mapa y helper (`src/domain/categoryModules.mjs`, zona solo frontend).** `CATEGORY_HIDDEN_CORE_PATHS`: `TALLER_AUTOMOTRIZ` y `CLINICA_VETERINARIA` ocultan `["/trabajos"]` (mapa y listas congelados). `getHiddenCorePaths(sesión | negocio, registro)` devuelve esa lista solo si el negocio tiene el módulo de su rubro habilitado (la misma condición de `getPrimaryVerticalModules`). Un módulo activado a mano en otro rubro, un Taller sin el módulo habilitado, un rubro sin mapeo y cualquier entrada inválida devuelven `[]`. Devuelve un arreglo nuevo. No tiene copia en `functions/categoryModules.js` ni afecta la paridad.
2. **Opción en `buildNavigationSections(registro, {primaryModules, hiddenCorePaths})`.** Quita del Core los ítems cuyo `to` esté en la lista y omite la sección que quede vacía. Con los ítems del rubro de la SPEC 041, "Operación" queda con ellos más Inventario (sin ellos, solo Inventario). Sin la opción, con lista vacía o con un valor que no es arreglo, la salida es la de siempre. El ítem sigue declarado en `navigationSections`.
3. **`AppLayout`** pasa `hiddenCorePaths: getHiddenCorePaths(negocioActivo)` junto a `primaryModules`; el menú de escritorio y el del cajón móvil comparten `PrimaryNavigation`.
4. **La ruta no se bloquea.** `/trabajos` sigue abierta con los mismos permisos (`App.jsx` no cambia): puede haber proyectos, cotizaciones y ventas con proyecto anteriores cuyos enlaces apuntan allí. Ocultar es de presentación; la autoridad sigue en Functions y reglas, que no dependen del rubro.

## 3. Aterrizaje del TECNICO

`getDefaultBusinessPath(access, options)` (`rbac.mjs`): si el inicio que le correspondería al acceso es una ruta que `getHiddenCorePaths(access)` oculta, elige la primera de estas que el rol pueda abrir según `canAccessBusinessPath`: la ruta base del módulo del rubro y luego `/inventario`; si ninguna, `/cuenta`.

- TECNICO de Taller: `/taller`, la ruta base del módulo, que redirige a `/taller/ordenes` (SPEC 041: ya no hay panel de inicio).
- TECNICO de Veterinaria: `/inventario` (no tiene `veterinaria.read`; sí `inventory.read`).
- Perfil personalizado cuyo primer módulo es "trabajos": `/inventario` si su perfil lo incluye; si no, `/cuenta`.
- OWNER, ADMIN, FINANZAS, VENTAS, COMPRAS y MEMBER aterrizan como hoy. Con el rol en string (sin negocio) no hay rubro y el resultado es el de hoy (`/trabajos` para TECNICO).
- Los módulos habilitados se toman de `options.enabledModules` o, si faltan, del propio negocio. Se aplica a todos los puntos que ya llaman a `getDefaultBusinessPath` (inicio de sesión, cambio de negocio, activación inicial, redirecciones): no hay ninguno nuevo.

## 4. Reportes

`StatisticsPage` calcula `showProjects = !getHiddenCorePaths(role).includes("/trabajos")` (`role` es el negocio activo) y lo pasa al Resumen y a Ganancia. Con `showProjects` en falso:

- **Resumen:** no se dibuja "Proyectos del mes" (con su "Ver todos los proyectos" y los enlaces a las fichas), y el aviso de proyectos incompletos no aparece. `links.works` también queda en falso, así que no hay otro enlace a `/trabajos` en Reportes (por ejemplo el botón "Revisar" de las alertas de proyectos).
- **Consejo de servicios:** el aviso de "Me quedó" dice ~~`Hay $X en servicios vendidos. Incluye solo el margen de productos; los servicios vendidos fuera de un proyecto no se cuentan.`~~ (SPEC 040: la nota ahora dice "Incluye solo el margen de productos; los servicios no se cuentan en la ganancia.") `Hay $X en servicios vendidos. Incluye solo el margen de productos; los servicios vendidos fuera de un proyecto no se cuentan.` en lugar de "Vincúlalos a un proyecto…". El ícono "i" de "Me quedó" dice `Lo vendido menos su costo. ` + la misma nota, para no mencionar proyectos que el rubro no usa (`PROFIT_PRODUCTS_ONLY_NOTE` y `MONTHLY_PROFIT_EXPLANATION_WITHOUT_PROJECTS` en `reportMonthlySummary.mjs`).
- **Ganancia:** se oculta la tabla "Proyectos" del cálculo paso a paso. ~~La tabla "Total" y las cifras no cambian.~~ **SPEC 040:** también se oculta la fila "Resultado de proyectos" de "Total" y el subtítulo pasa a "Ganancia de los productos vendidos en el período."; las cifras no cambian.
- **Sin cambios:** la fórmula de "Me quedó" (`calculateOperationalNetProfit`), el margen, "Vendí", "Compré", las mini-líneas, "Evolución del mes", las pestañas Ventas y Compras, las cargas de datos y los permisos. Con `showProjects` en verdadero (valor por defecto de los tres componentes) la pantalla es la de siempre.

## 5. Pendiente para Bruno (no se implementa aquí)

"Me quedó" sigue contando solo el margen de productos de ventas sin proyecto más el resultado de proyectos; los **servicios** vendidos sin proyecto no entran (SPEC 022 §4.4). En Taller y Veterinaria la mayor parte del ingreso son servicios, así que la cifra queda subestimada y la nota lo dice. Cómo medir la ganancia de esos servicios es el punto `CONFIRMADO PENDIENTE` de la SPEC 016 §E y §G (margen comercial sin exigir proyecto, regla contra el doble conteo; "nunca se define ganancia como ventas − compras"). Hasta que Bruno lo decida no se cambia la fórmula ni la pestaña Ganancia.

Sigue abierta también la parte de la SPEC 037 §4 que no se resuelve aquí: si OWNER, ADMIN u otros roles de estos rubros deben aterrizar en su módulo.

## 6. Pruebas

- `category-modules-smoke`: mapa y listas congeladas, helper por rubro, módulo no habilitado, módulo del otro rubro, módulos a mano en otros rubros, sesión vs. negocio, entradas inválidas, claves heredadas de `Object.prototype`, arreglo nuevo y registro inyectado.
- `business-quick-flow-smoke`: opción opt-in (sin opción, vacía o inválida = menú de hoy; sección vacía omitida; el árbol por defecto no se muta); Taller y Veterinaria por rol y país (sin `/trabajos` y el resto del Core igual); otros rubros y módulos a mano conservan `/trabajos`; la ruta sigue abierta (`canAccessBusinessPath`) y `App.jsx` no usa el helper; aterrizaje por rol, perfiles personalizados, rol en string y negocios fuera del caso; `AppLayout` pasa la opción.
- `work-order-summary-smoke` (retirado por la SPEC 041): su caso de aterrizaje pasó a `business-quick-flow-smoke`: el TECNICO de Taller aterriza en `/taller` y los demás roles, como hoy.
- `report-model-smoke` (`test:reports`): render real del Resumen con y sin `showProjects` (secciones, enlaces, consejo, nota, ícono, cifras y margen intactos), aviso del componente, tabla "Proyectos" de Ganancia, botón "Revisar" de las alertas y cableado de `StatisticsPage`.

## 7. Notas y riesgos

- **Datos previos.** Un negocio de estos rubros que ya tuviera proyectos conserva sus datos y la ruta; sus resultados siguen sumando en "Me quedó" y en la tabla "Total" de Ganancia, pero ya no se listan en Reportes ni se muestran en el menú. Para el piloto no aplica (Bagner es de informática).
- **Perfil personalizado.** Un miembro con perfil que solo incluye "trabajos" en un negocio de Taller o Veterinaria aterriza en `/cuenta` (o `/inventario`) y no ve el ítem; la ruta le sigue abierta por URL.
- **Pestaña Ganancia.** Su "Evolución mensual" conserva el componente de proyectos (en cero para estos rubros) ~~y la fila "Resultado de proyectos" de la tabla "Total": no se tocó por indicación expresa.~~ (SPEC 040: la fila de "Total" ya no se muestra sin proyectos.)
- **Despliegue.** Solo Hosting. **Visual:** revisar en el navegador, en escritorio y cajón móvil, claro y oscuro, el menú de un negocio de Taller y de uno de Veterinaria (OWNER y TECNICO; "Operación" con los ítems del rubro e Inventario, según la SPEC 041), el aterrizaje al iniciar sesión y al cambiar de negocio, `/reportes` (Resumen: sin "Proyectos del mes", nota del aviso y del ícono; Ganancia: sin la tabla "Proyectos") y un negocio de Informática y uno de Chile para confirmar que no cambian.
