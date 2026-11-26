# SPEC 039: El rubro define los módulos de la empresa (entrega G)

Estado: **implementada en la rama `mejora-refresco-avisos` (2026-11-22), sin commit ni despliegue.** Complementa la SPEC 031 (interruptor de módulos) y la 033 (módulos por rubro). `AGENTS.md` sigue siendo la autoridad en seguridad y arquitectura multiempresa.

Lecturas previas: `AGENTS.md`, SPEC 031, 033, 037 y 038, y el informe `output/investigacion-modulos-admin.txt`.

## 1. Principio

El rubro que elige el cliente define los módulos verticales de su empresa, de forma automática y sin activación manual: Taller automotriz habilita solo Taller, Clínica veterinaria solo Veterinaria y los demás rubros ninguno. Quien necesite otro rubro crea otra empresa. El interruptor "Módulos" de la consola de plataforma fue una maqueta y se retira.

## 2. Qué sustituye

Esta SPEC reemplaza únicamente estos puntos:

- **SPEC 031, decisión 2** ("solo lo escribe la Function de plataforma `cambiarModulosEmpresaPlataforma`"): `modulosHabilitados` lo escriben ahora, además, `createFirstBusiness` y `createAdditionalBusiness` al crear (SPEC 033) y `updateBusinessProfile` y `updateBusinessInformation` cuando el rubro cambia (sección 3). El SDK cliente sigue sin poder escribirlo, y la Function de plataforma sigue existiendo (sección 5).
- **SPEC 031, sección 2, punto "Consola de plataforma"**: ya no hay sección "Módulos" ni casillas en el detalle de la empresa. El historial sigue mostrando los eventos `modulos_actualizados`.
- **SPEC 033, decisión 4** ("cambiar el rubro después no recalcula"): ahora sí recalcula, solo cuando el rubro realmente cambia (sección 3). También deja de ser cierto en la SPEC 033 que "el superadmin conserva `cambiarModulosEmpresaPlataforma` para agregar o quitar módulos después" **desde la interfaz**: la Function se conserva, la pantalla no.
- **SPEC 037, sección 6**, nota "Cambio de rubro después de crear": ya no es cierto que un negocio que pasa de Taller a otro rubro conserve el módulo habilitado.

Todo lo demás de las SPEC 031, 033, 037 y 038 sigue vigente: módulo deshabilitado = oculto y bloqueado con sus datos intactos, sin refresco en vivo en el cliente, la autoridad real en Functions y reglas, el mapa `CATEGORY_MODULES`, el módulo del rubro en el menú (desde la SPEC 041, ítems dentro de "Operación"; antes, sección principal) y "Proyectos y trabajos" oculto en Taller y Veterinaria.

## 3. Recálculo al cambiar el rubro

1. **Helper.** `categoryModulesPatch(negocioActual, rubroNuevo, registro)` en `functions/categoryModules.js` devuelve `{modulosHabilitados: modulesForCategory(rubroNuevo)}` si el código de rubro cambió y `{}` si no. Compara el `rubroCodigo` del documento del negocio leído **dentro de la transacción** con el del perfil validado (ausente equivale a vacío; los espacios no cuentan).
2. **Dónde se aplica.** Las dos Functions de Core que escriben `rubroCodigo`, mezclando el parche en el `transaction.update` del negocio:
   - `updateBusinessProfileHandler` (`functions/businessOnboarding.js`).
   - `updateBusinessInformationHandler` (`functions/businessSettings.js`). **Esta es la que usa la pantalla Empresa → Información** (`saveBusinessInformation`, `CompanyConfig.jsx`); omitirla habría dejado un camino sin recálculo. No estaba nombrada en el encargo: se incluye para que el principio se cumpla en todos los caminos que cambian el rubro.
   - `updateBusinessSettingsHandler` no escribe rubro y no se toca.
3. **Resultado exacto.** Si el rubro cambió, la lista pasa a ser **exactamente** la del rubro nuevo según el mapa: Taller a otro rubro sin módulo deja `[]`; Taller a Veterinaria deja `["veterinaria"]`; de vuelta a Taller deja `["taller"]`; un rubro sin mapeo, `OTRO`, un rubro heredado (`TALLER_MECANICO`, `AUTOMOTRIZ_MOVILIDAD`) o un rubro de texto libre sin código dejan `[]`. Los módulos que el superadmin hubiera activado a mano y no correspondan al rubro nuevo también salen. El resultado pasa por `normalizeEnabledModules`, así que un id fuera del registro se descarta.
4. **Solo cuando el rubro cambia.** Guardar el mismo rubro (por ejemplo, cambiar el teléfono) no toca la lista, aunque el negocio sea antiguo, no tenga el campo o tenga módulos a mano. Corregir esos negocios existentes no es parte de esta entrega (sección 6).
5. **Sin borrar datos.** Solo cambia el campo `modulosHabilitados`. Los vehículos, órdenes de trabajo, pacientes, etc. del módulo que sale quedan intactos y reaparecen si el rubro vuelve (SPEC 031, decisión 3).
6. **Sin reglas ni Functions de Taller o Veterinaria.** No cambian `firestore.rules`, `tallerAccess.js`, `veterinary*.js`, `moduleAccess.js` ni `platformAdmin.js`.
7. **Cliente.** Sin cambios. `AppLayout` ya calcula los ítems del rubro en el menú (SPEC 041: dentro de "Operación") y la ocultación de `/trabajos` desde `rubroCodigo` y `modulosHabilitados`. La pantalla Empresa → Información refresca la sesión al guardar (`onBusinessUpdated`), así que el menú cambia al guardar; en cualquier otro caso rige "sin refresco en vivo" (SPEC 031, decisión 4).

## 4. Consola de plataforma

- Se elimina el panel "Módulos" del detalle de la empresa (`PlatformModulesPanel.jsx`) y su envoltorio `setPlatformBusinessModules` en `platformAdminService.js`, junto con sus estilos `platform-modules__*`.
- `MODULES_EVENT_TYPE` y `moduleEventSummary` pasan a `src/platform/platformModuleEvents.mjs`, y el historial (`PlatformAdminPages.jsx`) sigue mostrando "Módulos actualizados" con el antes y el después de los eventos ya guardados.
- El detalle sigue recibiendo `modulosDisponibles` (sirve para las etiquetas del historial) y `empresa.modulosHabilitados`.
- **Error al aprobar o rechazar una verificación (2026-11-23, solo cliente).** Si `resolverVerificacionEmpresa` rechaza la acción (p. ej. `already-exists`: "La identidad fiscal ya pertenece a otra empresa verificada."), el modal "Confirmar aprobación/rechazo" sigue abierto y muestra dentro un aviso de error (`Notice`): el texto del servidor si es un error de negocio legible (`already-exists`, `failed-precondition`, `invalid-argument`, `not-found`) o "No se pudo completar la acción. Intenta de nuevo." en cualquier otro caso. Antes el mensaje iba a un aviso de página que quedaba detrás del modal. Lógica en `src/platform/verificationDecision.mjs`, modal en `VerificationDecisionDialog.jsx`; Functions, permisos y acciones no cambian.

## 5. Lo que no cambia

- **`cambiarModulosEmpresaPlataforma`** (`functions/platformAdmin.js`, `functions/index.js`) y la regla `platformModulesRequests` se conservan: es la vía autoritativa para corregir datos o revocar un módulo por abuso (SPEC 033 sección 3) sin pasar por la interfaz. Quitarla es otra decisión.
- **La sección "Módulos" del menú lateral** (`buildNavigationSections`, SPEC 031/037) se conserva. Tras esta entrega solo se puede llegar a ella con datos anteriores o con la Function de plataforma; retirarla sería una refactorización de Core fuera de alcance.
- **Chile y los demás rubros**: sin cambios de comportamiento. Un negocio de Tecnología, Electricidad, Ingeniería u otros rubros sigue con `[]` y no recibe sección ni cambios en el menú.
- Catálogo de rubros, mapa `CATEGORY_MODULES`, creación de negocios, reglas de Firestore, índices y Hosting de Taller y Veterinaria.

## 6. Pendiente y riesgos

- **Negocios existentes.** Un negocio de Taller o Veterinaria que ya existiera sin su módulo (cambió de rubro antes de esta entrega) no se corrige solo: el recálculo ocurre únicamente en el próximo cambio de rubro. Sigue pendiente la consulta de solo lectura de producción y, si encuentra casos, una migración puntual con Admin SDK y dry-run (opción c2 del informe), que requiere autorización aparte.
- **Autoactivación.** Cualquier OWNER o ADMIN puede obtener el módulo cambiando el rubro de una empresa existente, igual que ya podía crear una empresa nueva con ese rubro (SPEC 033 sección 3). Si se venden planes habrá que poner un tope.
- **Decisión de producto.** Cambiar de Taller a otro rubro oculta y bloquea el módulo (con datos intactos); si el dueño vuelve a Taller lo recupera. También se pierden los módulos activados a mano.
- **Verificación empresarial.** Un cambio de rubro no depende de ella: el recálculo ocurre aunque la verificación se invalide por otros motivos (`buildVerificationInvalidationPlan` no se toca).
- **Despliegue.** **Functions** (`businessOnboarding.js`, `businessSettings.js`, `categoryModules.js`) y **Hosting** (consola de plataforma). Sin reglas ni índices. El panel puede retirarse antes que las Functions sin efecto visible; el recálculo solo rige tras el despliegue de Functions.

## 7. Pruebas

- `category-modules-smoke` (sin emuladores, `npm run test:category-modules`): `categoryModulesPatch` con Taller a otro rubro y de vuelta, entre Taller y Veterinaria, rubro sin módulo, `OTRO`, rubros heredados, módulos a mano, negocios sin campo, rubro de texto libre, sin cambio (parche `{}`, incluso con lista distinta o espacios), entradas inválidas, arreglo nuevo, registro inyectado, una secuencia larga de cambios y el cableado de las dos Functions (dentro de la transacción, con el documento leído en ella; `updateBusinessSettings` y las Functions de creación no lo usan); la Function de plataforma y la sección "Módulos" del menú siguen en su sitio.
- `platform-admin-smoke` (sin emuladores, `npm run test:platform-admin`): el panel y su servicio ya no existen, no quedan estilos `platform-modules`, el historial conserva `MODULES_EVENT_TYPE` y `moduleEventSummary` (con casos de texto) y la Function de plataforma sigue exportada.
- `business-onboarding-integrated` (**con emuladores, a ejecutar por la persona responsable**): recálculo por `updateBusinessProfile` y por `updateBusinessInformation`, ida y vuelta Taller a Tecnología a Taller, Veterinaria, sin cambio de rubro no recalcula, datos del módulo intactos, la sesión refleja la lista y cada negocio conserva la suya; el SDK cliente sigue sin poder escribir el campo.
- `platform-admin-integrated` (**con emuladores**): las regresiones existentes siguen valiendo porque el rubro no cambia en ellas (`updateBusinessProfile`, `updateBusinessInformation` y `updateBusinessSettings` conservan `modulosHabilitados`).
