# SPEC 033: Módulos verticales habilitados por rubro al crear el negocio

Estado: **implementada en la rama `activacion-modulos-por-rubro` (2026-11-19), sin commit ni despliegue**. **La decisión 4 ya no rige: la [SPEC 039](039-rubro-define-modulos.md) hace que cambiar el rubro recalcule los módulos, y retira la pantalla del superadmin.** Complementa la SPEC 030 (rubros) y la 031 (interruptor de módulos). `AGENTS.md` sigue siendo la autoridad en seguridad y arquitectura multiempresa.

## 1. Qué sustituye

Esta SPEC reemplaza únicamente estos puntos:

- SPEC 031, sección 4: "Asociar módulos a un rubro no está en alcance: el rubro sigue siendo descriptivo." Ahora el rubro elegido **al crear** el negocio sí habilita módulos verticales (sección 2).
- SPEC 031, decisión 2 ("solo lo escribe la Function de plataforma"): `createFirstBusiness` y `createAdditionalBusiness` también escriben `modulosHabilitados`, y solo al crear el documento (sección 2).
- SPEC 030, decisiones 1 y 2: pasan a **9 rubros seleccionables** (se agregan `TALLER_AUTOMOTRIZ` y `CLINICA_VETERINARIA`) y la lista "Próximamente" del picker ya no incluye Taller automotriz ni Clínica veterinaria.
- SPEC 030, sección 2: "Nada del sistema decide menús o módulos según el rubro" deja de ser cierto en el momento de la creación.

Todo lo demás de las SPEC 030 y 031 sigue vigente: módulo deshabilitado = oculto y bloqueado con datos intactos, sin refresco en vivo, la autoridad real sigue en Functions y reglas, y el superadmin conserva `cambiarModulosEmpresaPlataforma` para agregar o quitar módulos después (la Function se conserva; la pantalla de la consola se retiró en la SPEC 039).

## 2. Decisiones

1. **Mapa rubro a módulos** en `functions/categoryModules.js` (archivo aparte de `verticalModules.js`, que tiene copia espejo en `src/domain` y prueba de paridad textual): `TALLER_AUTOMOTRIZ` habilita `["taller"]` y `CLINICA_VETERINARIA` habilita `["veterinaria"]`. `modulesForCategory(code, registry)` pasa el resultado por `normalizeEnabledModules`, así que un id que el registro no conozca se descarta. Un rubro sin mapeo devuelve `[]`.
2. **Solo al crear.** `createFirstBusinessHandler` y `createAdditionalBusinessHandler` escriben `modulosHabilitados: modulesForCategory(input.rubroCodigo)` en el documento del negocio. El valor se calcula **después** de `fingerprintBusinessInput`, por lo que no entra en la huella y no altera los reintentos idempotentes: un reintento con el mismo `requestId` devuelve el negocio ya creado, con los módulos que quedaron guardados.
3. **La respuesta incluye el campo.** El objeto `business` que devuelven ambos handlers al crear trae `modulosHabilitados`, para que el menú lo muestre sin recargar la sesión. Las respuestas idempotentes ya lo traían desde `businessResponse`.
4. ~~**Cambiar el rubro después no recalcula.**~~ **Sustituida por la SPEC 039** (cambiar el rubro recalcula los módulos, solo si el rubro realmente cambia). Texto histórico: **Cambiar el rubro después no recalcula.** `updateBusinessProfileHandler` no se toca. Un negocio que pasa de un rubro con módulos a otro conserva sus módulos, y uno que pasa a Taller no obtiene Taller. Quitar o agregar módulos después sigue siendo del superadmin (SPEC 031).
5. **Un rubro sin mapeo deja `[]`** (el campo existe y está vacío), en lugar de omitirlo. Campo ausente y lista vacía siguen significando lo mismo en lectura.
6. **Catálogo.** `businessCatalog.json` agrega `TALLER_AUTOMOTRIZ` ("Taller automotriz") y `CLINICA_VETERINARIA` ("Clínica veterinaria"), sector `SERVICIOS_PROYECTOS`, `catalogVersion` 1, seleccionables. `AUTOMOTRIZ_MOVILIDAD` sigue retirado (`selectable: false`) y no habilita ningún módulo.

## 3. Decisión de producto

El dueño **se autohabilita el módulo vertical al elegir el rubro**: no pasa por el superadmin ni por una aprobación. Es una decisión deliberada para el piloto y las primeras ventas a negocios del rubro.

Consecuencia a vigilar: cualquier usuario puede crear un negocio con rubro Taller o Veterinaria y obtener el módulo, sin límite. Hoy no hay planes de pago ni cuotas de módulos (el plan de propietario es `FREE` con `limite: null`). **Si se venden planes, habrá que poner un tope**: por ejemplo, que el mapa solo habilite el módulo en planes que lo incluyan, o que la habilitación al crear pase a requerir aprobación. Hasta entonces el superadmin puede quitar el módulo si detecta abuso, con la Function `cambiarModulosEmpresaPlataforma` (la pantalla de la consola se retiró en la SPEC 039, y un cambio de rubro posterior volvería a recalcular la lista).

## 4. Compatibilidad

- Negocios existentes: no se migran ni se recalculan. Un negocio sin `modulosHabilitados` sigue equivaliendo a lista vacía.
- No cambian reglas Firestore, índices, `functions/platformAdmin.js` ni el panel del superadmin.
- Sin despliegue todavía: el catálogo y el mapa llegan al servidor con el deploy de **Functions** y al cliente con el de **Hosting** (ver `docs/como-agregar-un-rubro.md`).

## 5. Pruebas

- `test:category-modules` (nuevo, sin emuladores): los ids del mapa existen en el registro, los códigos existen en el catálogo y son seleccionables, un rubro sin mapeo devuelve `[]` y los ids desconocidos se descartan con un registro inyectado.
- `business-catalog`, `business-category-selector` y `business-onboarding-integrated`: de 7 a 9 rubros seleccionables; el buscador devuelve Taller y Veterinaria; el texto "Próximamente" ya no los menciona.
- `business-onboarding-integrated` (con emuladores): crear con Taller deja `["taller"]` en el documento y en la sesión; negocio adicional con Veterinaria y con Taller igual; reintento con el mismo `requestId` devuelve lo mismo y no crea otro negocio; ~~cambiar el rubro después no altera `modulosHabilitados`~~ (invertido por la SPEC 039: ahora lo recalcula); un rubro sin mapeo deja `[]`; el SDK cliente sigue sin poder escribir el campo.

## 6. Pendiente

- Ubicación en el menú del módulo habilitado por rubro: la define la [SPEC 041](041-menu-rubro-en-operacion.md) (ítems dentro de "Operación", no bajo "Módulos"; sustituye a la sección principal de la [SPEC 037](037-sidebar-modulo-del-rubro.md)).
- Despliegue de Functions y Hosting.
- Revisión en el navegador del selector de rubros y del menú tras crear un negocio de Taller o Veterinaria.
- Tope por plan si se comercializan planes (sección 3).
