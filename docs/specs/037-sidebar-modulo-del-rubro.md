# SPEC 037: El módulo del rubro como sección principal del menú

Estado: **entrega A (menú) y entrega B (panel de inicio del Taller) implementadas en la rama `mejora-refresco-avisos` (2026-11-21), sin commit ni despliegue. La [SPEC 041](041-menu-rubro-en-operacion.md) (2026-11-23) sustituye el diseño del menú (decisiones 3 y 5 de la sección 2: el módulo del rubro ya no es una sección propia sino ítems de "Operación") y retira la entrega B (sección 7).** Complementa la SPEC 031 (interruptor de módulos) y la 033 (módulos por rubro). No cambia permisos, rutas, reglas ni Functions. `AGENTS.md` sigue siendo la autoridad en seguridad y arquitectura multiempresa.

Lecturas previas: `AGENTS.md`, SPEC 016 (visión post-demo), SPEC 031 y SPEC 033. La SPEC 016 marca la vertical Taller como `CONFIRMADO PENDIENTE` y no autoriza fijar esquema, estados ni documentos nuevos; la entrega A solo reubica entradas de menú que ya existen y no introduce ninguna pantalla ni dato; la entrega B (sección 7) agrega una pantalla de solo lectura que únicamente muestra datos ya existentes.

## 1. Qué sustituye

> **SPEC 041:** la ubicación que fija esta sección (sección propia, primera del menú) fue sustituida: los ítems del módulo del rubro van dentro de "Operación", antes de Inventario. Lo que sigue es el diseño original, conservado como historia.

Esta SPEC reemplaza únicamente la **ubicación en el menú** del módulo vertical que corresponde al rubro del negocio:

- SPEC 031, sección 2, punto "Menú": los módulos verticales "agrupados bajo 'Módulos', antes de 'Cuenta'". Para el módulo del rubro ya no es así (sección 2). Los demás módulos habilitados siguen agrupados bajo "Módulos".
- SPEC 033 no decía dónde se mostraba el módulo habilitado por rubro; heredaba la ubicación de la 031. Hereda ahora la de esta SPEC.

Todo lo demás de las SPEC 031 y 033 sigue vigente: habilitación, `modulosHabilitados`, módulo deshabilitado = oculto y bloqueado, sin refresco en vivo, autoridad en backend.

## 2. Decisiones

1. **Espejo cliente del mapa.** `src/domain/categoryModules.mjs` copia `CATEGORY_MODULES` y `modulesForCategory` de `functions/categoryModules.js`, con prueba de paridad en `category-modules-smoke` (mapa, congelado y resultado de `modulesForCategory` sobre todos los códigos del catálogo y entradas inválidas). Un cambio del mapa en Functions obliga a copiarlo aquí.
2. **`getPrimaryVerticalModules(sesión | negocio, registro)`** devuelve los ids de los módulos que son del rubro del negocio (`rubroCodigo` según el mapa) **y** están habilitados (`modulosHabilitados`). Un módulo activado a mano en un negocio de otro rubro, un módulo del rubro que ya no está habilitado, un rubro sin mapeo y cualquier entrada inválida devuelven `[]`.
3. ~~**Sección del rubro.**~~ **Sustituida por la SPEC 041** (los ítems pasan a "Operación"; ya no hay sección propia, `accent` ni `moduleId`). Diseño original: `buildNavigationSections(registro, {primaryModules})` recibe esos ids. Cada módulo principal sale de "Módulos" y pasa a ser la **primera** sección del menú, con el nombre del módulo como título y sus ítems **planos** (sin el nivel anidado). "Módulos" se omite si queda vacío. La sección lleva `accent: true` y `moduleId`.
4. **Opt-in.** Sin `primaryModules` (o con una lista vacía o con ids que no estén en el registro) la salida es la de siempre, y la firma de `getBusinessPathOptions` no cambia. Solo `AppLayout` pasa `primaryModules`. El menú de escritorio y el del cajón móvil comparten `PrimaryNavigation`, así que ambos muestran la sección.
5. ~~**Acento visual.**~~ **Retirado por la SPEC 041** (se elimina `nav-section--primary` y su CSS). Diseño original: la sección lleva la clase `nav-section--primary` (`src/styles/layout.css`): fondo `--color-surface-brand`, radio `--radius-md` y título con `--color-text-brand-accent`. Solo tokens existentes; no se agregó ninguno.
6. **Los permisos no cambian.** La sección pasa por el mismo `filterNavigationSections`: un rol sin lectura del módulo no la ve y un negocio sin verificar sigue viendo solo Empresa y Cuenta (la sección no figura en `UNVERIFIED_BUSINESS_PATHS`). Un miembro con perfil personalizado (`modules`) queda como hoy, sin la sección: los perfiles no incluyen verticales (SPEC 031). Roles que ven la sección de Taller: OWNER, ADMIN, TECNICO y MEMBER (este último sin "Plazas", que exige `taller.manage`); la de Veterinaria: OWNER y ADMIN. VENTAS, COMPRAS y FINANZAS no ven ninguna. Es exactamente lo que ya veían bajo "Módulos".
7. **No cambia el aterrizaje.** *(Sustituido solo para el TECNICO de Taller y Veterinaria por la SPEC 038: su inicio ya no es `/trabajos`.)* `getDefaultBusinessPath` no se toca: el inicio por defecto de cada rol es el de hoy (ver pregunta abierta de la sección 4). Tampoco cambian `platformAdmin`, el título de la barra superior (`getRouteMeta` usa el árbol por defecto) ni las rutas.

## 3. Pruebas

- `category-modules-smoke` (sin emuladores): paridad del espejo con Functions y casos de `getPrimaryVerticalModules`: Taller y Veterinaria habilitados, módulo no habilitado, módulo del otro rubro, módulos activados a mano en Tecnología, Electricidad, Ingeniería, Otro servicio, `TALLER_MECANICO` y `AUTOMOTRIZ_MOVILIDAD`, sesión vs. negocio, registro inyectado y entradas inválidas.
- `business-quick-flow-smoke` (sin emuladores), todo con `deepEqual` sobre un árbol comparable (las `activeWhen` se sondean con rutas de ejemplo):
  - La salida por defecto no cambia con ninguna forma de "sin módulo principal", y conserva "Módulos" anidado antes de "Cuenta".
  - Tecnología, Electricidad, Ingeniería, Otro servicio y negocios sin `modulosHabilitados` (o con Taller/Veterinaria sin habilitar): el menú es idéntico al de hoy para OWNER, ADMIN, TECNICO y VENTAS.
  - Taller y Veterinaria por rol (OWNER, ADMIN, TECNICO, MEMBER, VENTAS, COMPRAS, FINANZAS): lo que muestra la sección es exactamente lo que mostraba "Módulos", la sección va primera y "Módulos" no queda vacío.
  - Perfil personalizado, negocio sin verificar, módulo activado a mano en otro rubro (sigue anidado bajo "Módulos"), Veterinaria con Taller a mano, registro inyectado sin ítems.
  - `AppLayout` usa el helper y la clase; las reglas CSS del acento no tienen colores literales ni colores de marca fija.
- Las pruebas que fijaban la estructura anterior de "Módulos" siguen válidas sin cambios, porque la salida por defecto no cambió.

## 4. Pregunta abierta para Bruno

> La SPEC 038 resuelve solo el caso del TECNICO (su inicio ya no es `/trabajos` en Taller y Veterinaria). El resto de la pregunta sigue abierta.

**¿Dónde debe aterrizar un usuario de Taller o Veterinaria al entrar?** Hoy aterriza como cualquier otro negocio: OWNER, ADMIN y FINANZAS en `/reportes`, TECNICO en `/trabajos`, VENTAS en `/cotizaciones`, COMPRAS en `/ordenes-compra`. Si el rubro es el centro de su día, tal vez deba aterrizar en su módulo (órdenes de trabajo para Taller, resumen clínico para Veterinaria), quizá solo para algunos roles. No se implementó: cambiar `getDefaultBusinessPath` toca el inicio de la sesión, el cambio de negocio y la activación inicial, y es decisión de producto.

## 5. Fuera de alcance

- El distintivo "Incluido en tu rubro".
- ~~El panel de inicio del taller (entrega B).~~ Implementado (sección 7) y luego retirado por la SPEC 041.
- `platformAdmin` y el aterrizaje por rubro (sección 4).

## 6. Notas y riesgos

- **Rubros con nombre parecido.** El mapa solo conoce `TALLER_AUTOMOTRIZ` ("Taller automotriz", el que ofrece el selector) y `CLINICA_VETERINARIA`. `TALLER_MECANICO` ("Taller mecánico") es un rubro heredado que no es seleccionable en el selector, no habilita módulos y por eso no tiene sección principal; si un negocio existente lo tiene y el superadmin le activó Taller, sigue bajo "Módulos". Decidir si se agrega al mapa es cambio de la SPEC 033, no de esta.
- **Cambio de rubro después de crear.** ~~Como la SPEC 033 no recalcula `modulosHabilitados`, un negocio que cambia de Taller a otro rubro conserva el módulo habilitado pero lo ve de nuevo bajo "Módulos".~~ **Sustituido por la SPEC 039**: el cambio de rubro recalcula `modulosHabilitados`, así que un negocio que pasa de Taller a otro rubro pierde el módulo (queda oculto y bloqueado, con sus datos intactos). Se calcula al cargar la sesión y no se refresca en vivo.
- **Despliegue.** Solo Hosting (cliente). Sin Functions ni reglas.
- **Visual.** Cambia el menú de los negocios de Taller y Veterinaria, en escritorio y en el cajón móvil, claro y oscuro. Revisar en el navegador: la sección primera con fondo de marca, el estado activo y el foco de sus enlaces, el contraste del título en oscuro y la sidebar de pantallas bajas (la sección agrega unos 16 px de padding).

## 7. Entrega B: panel de inicio del Taller (RETIRADA por la SPEC 041)

> **Retirada el 2026-11-23 por la [SPEC 041](041-menu-rubro-en-operacion.md), sección 3.** Motivo: el panel fijaba decisiones de producto de la vertical Taller (`CONFIRMADO PENDIENTE` en la SPEC 016) y cargaba todo el historial sin límite. Se eliminaron `TallerHomePage.jsx`, `TallerHomeView.jsx`, `workOrderSummary.mjs`, `work-order-summary-smoke.mjs`, el script `test:work-order-summary`, el ítem "Inicio" del menú y el bloque `taller-home__*` de `taller.css`; `/taller` vuelve a redirigir a `/taller/ordenes`. La base completa queda en el commit `95c117d` para una propuesta futura de Matías. El texto que sigue es historia: ya no describe el código.

Implementada el 2026-11-21, sin commit ni despliegue. Solo lectura de datos existentes: no define esquema, estados ni documentos (SPEC 016: Taller `CONFIRMADO PENDIENTE`), no agrega Functions ni reglas.

1. **Ruta e ítem.** `/taller` (índice) abre `TallerHomePage` en lugar de redirigir a `/taller/ordenes`. El menú agrega "Inicio" como primer hijo de `verticalNavigationItems.taller` (`path: ""`, coincidencia exacta, como "Resumen clínico" de Veterinaria), tanto en la sección del rubro como en "Módulos". Lo ven los roles con `taller.read` (OWNER, ADMIN, TECNICO, MEMBER); VENTAS, COMPRAS y FINANZAS siguen sin sección de Taller. `getDefaultBusinessPath` no cambia: nadie aterriza en `/taller` (sigue abierta la pregunta de la sección 4). Barra superior: `getRouteMeta("/taller")` muestra el nombre del módulo ("Taller automotriz"), igual que la ruta base de Veterinaria; las pantallas hijas conservan sus títulos.
2. **Contenido.** Órdenes por estado (los 9 estados del modelo, también en cero, y "Sin estado" si hay OT con un estado que el modelo no conoce); alertas con enlaces al detalle de las OT "Esperando aprobación" y "Pendiente de entrega" (hasta 5 enlaces por alerta); Plazas en uso y libres con la OT que ocupa cada una; las últimas 5 OT (número descendente con orden numérico) con vehículo, estado y fecha; y accesos a "Nueva OT" y "Nuevo vehículo".
3. **Permisos.** Sin `taller.create` no hay accesos de creación. Sin `taller.manage` no se dibuja el bloque de Plazas **ni se consultan las Plazas** (es el mismo permiso de la pantalla de Plazas); con `taller.manage` el bloque incluye el enlace "Administrar Plazas". Una Plaza inactiva no cuenta como libre. La autoridad real sigue en las reglas de Firestore: el panel solo decide qué mostrar.
4. **Datos y estados.** Usa `listarOrdenesTrabajo`, `listarVehiculos` y `listarPlazasTaller` (sin Function nueva). Orden: cargando (`LoadingState`, un solo `role="status"`), error (alerta con "Reintentar", sin estado de carga colgado), vacío (sin OT ni vehículos; sin skeleton) y datos. Una respuesta tardía de un reintento o de otro negocio se descarta.
5. **Lógica pura.** `src/domain/workOrderSummary.mjs` (`summarizeWorkOrders`, `summarizeWorkshopPlazas`) reutiliza `WORK_ORDER_STATUSES` y `deriveWorkshopPlazaOccupancy`. La vista (`src/features/taller/TallerHomeView.jsx`) no accede a datos; la página (`src/pages/TallerHomePage.jsx`) carga y decide por permisos. Estilos `taller-home__*` en `taller.css`, solo tokens.
6. **Pruebas.** `work-order-summary-smoke` (`npm run test:work-order-summary`, sin emuladores): función pura (vacío, estados desconocidos, suma de conteos, orden y límite de las últimas OT, Plazas, entradas inválidas, sin mutar), render real de la vista en sus cuatro estados y por permisos, navegación por rol (Inicio para OWNER, ADMIN, TECNICO y MEMBER; nada para VENTAS, COMPRAS y FINANZAS), aterrizaje sin cambios, `getRouteMeta`, rutas de `App.jsx`, solo lectura y solo tokens. `business-quick-flow-smoke` se ajustó: las listas de hijos de Taller ahora empiezan por `/taller`, y la regex que cuenta etiquetas de sección en `navigation.js` exige `items:` para no confundir el ítem "Inicio" con una sección.
7. **Riesgos.** (a) Las tres consultas traen **todo** el historial de OT, vehículos y Plazas del negocio: los servicios no aceptan límite y no se cambió su API; las "últimas OT" se recortan en el cliente. Con miles de OT conviene una consulta acotada (por ejemplo `orderBy` + `limit`) y conteos agregados en una entrega futura. (b) El panel no se refresca en vivo: se carga al entrar. (c) "Esperando aprobación" se toma del `estado` de la OT, no de `estadoAprobacion`.
8. **Despliegue.** Solo Hosting. **Visual:** revisar en el navegador `/taller` en claro y oscuro (tarjetas de estado, alertas, Plazas, últimas OT), el ítem "Inicio" activo solo en la ruta base, y el panel con un rol sin `taller.create` y otro sin `taller.manage`.
