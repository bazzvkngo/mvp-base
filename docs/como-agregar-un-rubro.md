# Cómo agregar o habilitar un rubro

Guía corta. La decisión de fondo está en `docs/specs/030-rubros-y-paises.md`.

## Dónde está el catálogo

Solo en `functions/businessCatalog.json` (clave `businessCategories`). El servidor lo lee desde `functions/businessOnboarding.js` y el cliente lo importa por Vite desde `src/domain/businessCatalog`. No hay una segunda copia.

## Qué significan los campos

- `active`: el rubro existe y se reconoce. Un negocio que ya lo tiene lo conserva.
- `selectable: false`: el rubro **no** se ofrece a negocios nuevos ni se acepta en `createFirstBusiness`. Si falta el campo, cuenta como seleccionable.
- `legacy: true`: rubro heredado de catálogos anteriores. Solo se conserva en negocios que ya lo tenían.
- `catalogVersion`: versión del catálogo vigente (hoy `1`, ver `businessCategoryCatalogVersion`). Solo los rubros de la versión vigente pueden ser seleccionables.

Un negocio conserva su `rubroCodigo` y `rubroNombre` aunque el rubro deje de ser seleccionable: el servidor lo acepta si el código es igual al que ya tiene guardado.

## Rubros seleccionables hoy (6, SPEC 035)

`TECNOLOGIA_INFORMATICA`, `ELECTRICIDAD_ENERGIA_CLIMATIZACION`, `TALLER_AUTOMOTRIZ`, `CLINICA_VETERINARIA`, `INGENIERIA_CONSULTORIA` y `OTRO_SERVICIO_PROYECTOS` (en pantalla "Otro servicio técnico o profesional"). Dejaron de ser seleccionables, sin borrarse del catálogo: `SEGURIDAD_TELECOMUNICACIONES`, `AUTOMATIZACION_CONTROL` y `MANTENIMIENTO_INSTALACIONES`; un negocio que ya los tiene los conserva. Para volver a ofrecer uno basta quitarle `"selectable": false`. `TALLER_AUTOMOTRIZ` y `CLINICA_VETERINARIA` además habilitan su módulo vertical al crear el negocio (ver "Cómo se activa un módulo para un rubro").

Antes de la SPEC 035 eran 9 (estos seis más los tres ocultos). También existen pero no son seleccionables: `AUTOMOTRIZ_MOVILIDAD`, `CONSTRUCCION_OBRAS`, `SOFTWARE_SOLUCIONES_DIGITALES` y `SERVICIOS_DIGITALES_CREATIVOS`. El picker muestra "Construcción y obras", "Software y soluciones digitales" y "Servicios digitales y creativos" en el grupo "Próximamente" (solo texto, sin código).

## Cómo habilitar un rubro

1. En `businessCatalog.json`, deja `active: true`, `catalogVersion` igual al vigente y quita `selectable: false` (o no lo pongas).
2. Si es nuevo, agrega `code` (mayúsculas y guion bajo), `name`, `sectorCode` y `searchTerms`.
3. Si aparece en el texto "Próximamente" del picker (`COMING_SOON_TEXT` en `BusinessCategoryPicker.jsx`), quítalo de ese texto y ajusta la expresión que lo comprueba en `business-category-selector-smoke.mjs`.
4. Ajusta los smokes: la lista y el recuento de seleccionables en `business-catalog-smoke.mjs` y `business-category-selector-smoke.mjs`, y la lista `RETIRED_CATEGORIES` de `business-onboarding-integrated.mjs`.

## Cómo se activa un módulo para un rubro

Desde la SPEC 033 el rubro **sí** habilita módulos verticales, pero **solo al crear el negocio**. El mapa vive en `functions/categoryModules.js` (`TALLER_AUTOMOTRIZ` a `["taller"]` y `CLINICA_VETERINARIA` a `["veterinaria"]`); `createFirstBusiness` y `createAdditionalBusiness` guardan `modulesForCategory(rubroCodigo)` en `modulosHabilitados`. Un rubro sin mapeo deja `[]`.

- **Cambiar el rubro después recalcula los módulos (SPEC 039).** `updateBusinessProfile` y `updateBusinessInformation` mezclan `categoryModulesPatch` (en `functions/categoryModules.js`) en la actualización del negocio: si el rubro realmente cambia, `modulosHabilitados` pasa a ser exactamente `modulesForCategory(rubroNuevo)` (sin borrar datos del módulo anterior); si no cambia, no se toca. No hay activación manual ni pantalla de módulos en la consola de plataforma; la Function `cambiarModulosEmpresaPlataforma` se conserva solo como válvula de corrección. Un rubro nuevo no necesita nada más que su entrada en `CATEGORY_MODULES`.
- **Para que un rubro nuevo habilite un módulo:** el módulo debe existir en el registro (`docs/guia-practicantes.md`, sección 4); agrega el par `rubroCodigo` a `[idDelMódulo]` en `CATEGORY_MODULES` y un caso en `scripts/category-modules-smoke.mjs`. El rubro debe ser seleccionable: un código no seleccionable no se puede elegir al crear.
- **Decisión de producto:** el dueño se autohabilita el módulo al elegir el rubro, sin aprobación. Si se venden planes habrá que poner un tope (SPEC 033, sección 3).
- **Ítems del Core que el rubro no usa (SPEC 038, solo frontend).** `CATEGORY_HIDDEN_CORE_PATHS` en `src/domain/categoryModules.mjs` lista las rutas del Core que el menú de ese rubro no muestra (hoy `/trabajos` para Taller y Veterinaria). Solo oculta el menú: la ruta, los permisos y el backend no cambian. Decide caso por caso, no lo copies a un rubro nuevo por defecto; si la ruta oculta era el inicio de un rol, `getDefaultBusinessPath` busca otro. Agrega el caso en `business-quick-flow-smoke` y `category-modules-smoke`.
- El archivo `functions/categoryModules.js` está aparte de `functions/verticalModules.js` para no romper la paridad textual con `src/domain/verticalModules.mjs`. Si lo creas de nuevo en otro módulo, agrégalo también al script `lint` de `functions/package.json` (lista archivos uno a uno).

## Pruebas

```bash
npm run test:business-catalog
npm run test:category-modules
npm run test:business-category-selector
npm run test:business-quick-flow
npm run test:business-onboarding   # integrado, requiere emuladores
npm run test:business-multi        # integrado, requiere emuladores
npm run test:design
npm run test:contrast
npm run build
git diff --check
```

## Deploy

Cada cambio al catálogo exige deploy de **Functions** (validación en el servidor) y de **Hosting** (el cliente empaqueta el mismo JSON). Si se despliega solo uno, cliente y servidor discrepan sobre qué rubros son seleccionables.
