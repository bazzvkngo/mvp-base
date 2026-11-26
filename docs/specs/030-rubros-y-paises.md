# SPEC 030: Rubros seleccionables y aviso fiscal por país

Estado: **implementada (2026-10-18)**; las decisiones 1 y 2 y el punto "Nada del sistema decide menús o módulos según el rubro" de la sección 2 quedan sustituidos por la SPEC 033 (9 rubros seleccionables con Taller y Veterinaria, y módulos habilitados por rubro al crear el negocio). Solo catálogo y presentación. No toca reglas Firestore, cálculos, esquema del catálogo ni países, monedas o regiones. Complementa la SPEC 016 (visión post-demo) y la documentación de onboarding; no sustituye ninguno de sus puntos.

## 1. Decisión

1. Quedan **7 rubros seleccionables**: `TECNOLOGIA_INFORMATICA`, `SEGURIDAD_TELECOMUNICACIONES`, `ELECTRICIDAD_ENERGIA_CLIMATIZACION`, `AUTOMATIZACION_CONTROL`, `MANTENIMIENTO_INSTALACIONES`, `INGENIERIA_CONSULTORIA` y `OTRO_SERVICIO_PROYECTOS`. Pasan a `selectable: false` (siguen `active`, versión 1, sector `SERVICIOS_PROYECTOS`): `AUTOMOTRIZ_MOVILIDAD`, `CONSTRUCCION_OBRAS`, `SOFTWARE_SOLUCIONES_DIGITALES` y `SERVICIOS_DIGITALES_CREATIVOS`. Se usa el campo ya existente; no se agregan campos al esquema. Esta lista reemplaza la primera versión de la SPEC (10 rubros).
2. El picker de rubros muestra, bajo las opciones, un grupo **"Próximamente"** con filas deshabilitadas (`aria-disabled`): "Taller automotriz (en construcción)", "Clínica veterinaria (en construcción)", "Construcción y obras", "Software y soluciones digitales" y "Servicios digitales y creativos" (estas tres con la etiqueta "Próximamente"), más la línea "Más rubros próximamente". No tienen código persistible: no entran al buscador ni al payload.
3. En el selector de país del onboarding, si el país no es Chile se muestra (texto sustituido por la SPEC 035, sección 3, punto 7): "Moneda y formato disponibles. Las reglas fiscales (facturas, boletas, IVA) están pensadas para Chile y están en revisión." Es solo presentación. La empresa adicional no tiene selector de país (asigna Chile y CLP), por lo que no lleva la nota.

## 2. Por qué

Taller y Clínica Veterinaria son módulos verticales en construcción, y los rubros de software, servicios digitales, construcción y automotriz no corresponden hoy al piloto. Nada del sistema decide menús o módulos según el rubro, de modo que el cambio no altera funciones. Los países distintos de Chile siguen disponibles, pero las reglas fiscales (IVA, facturas, boletas) solo están pensadas para Chile.

## 3. Compatibilidad

- Un negocio con alguno de los 4 rubros retirados lo conserva (código y nombre) y puede actualizar su perfil: el servidor acepta el código si coincide con el ya guardado.
- `createFirstBusiness` con cualquiera de los 4 códigos se rechaza con "Selecciona un rubro válido."
- Los países, monedas y regiones no cambian.

## 4. Pruebas

`business-catalog` (7 seleccionables exactos; los 4 retirados siguen existiendo y no son seleccionables), `business-category-selector` (7 visibles más el grupo Próximamente y la nota fiscal) y `business-onboarding-integrated` (rechazo en creación y conservación en actualización, para cada uno de los 4 rubros retirados). Guía operativa: `docs/como-agregar-un-rubro.md`.

## 5. Pendiente

- Interruptor de módulos por negocio (no existe hoy).
- Revisión de reglas fiscales para países distintos de Chile.
- Despliegue: Functions y Hosting.
