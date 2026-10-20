# Proyecto

- ValoraCloud es un ERP SaaS multiempresa.
- Stack: React, Vite, JavaScript, Firebase Authentication, Firestore, Firebase Functions y Node.js.
- ValoraCloud se construye para uso real en Bagner (soluciones integrales de informática y electricidad), con Bruno como supervisor del proyecto y a la vez dueño del negocio destinatario. Bagner es el piloto; la meta a mediano plazo es poder comercializar el sistema a otros negocios.
- La ampliación de funciones con IA en el flujo principal está autorizada cuando el dueño del negocio la solicite explícitamente para una tarea concreta (por ejemplo, carga de facturas con ítems agregados dinámicamente, o apoyo en recepciones). No es una autorización general para agregar IA donde sea: cada ampliación se acuerda por tarea. El código existente de IA se conserva y sigue sin eliminarse sin autorización.

# Arquitectura obligatoria

- Los datos operacionales viven bajo `negocios/{businessId}/...`.
- Las membresías viven en `membresias/{businessId}__{uid}`.
- `negocioActivoId` sirve como contexto de navegación, no como autorización.
- La autoridad real es una membresía activa.
- Las operaciones sensibles deben validarse en backend.
- No confiar únicamente en validaciones frontend.
- No permitir acceso cruzado entre empresas.

# Precedencia documental

- `AGENTS.md` sigue siendo la autoridad máxima en seguridad, arquitectura multiempresa y workflow.
- Para decisiones de producto post-demo, leer `docs/specs/016-vision-post-demo-bruno.md`.
- Una SPEC específica más reciente puede sustituir únicamente los puntos que declare explícitamente reemplazados.
- Las SPEC anteriores siguen siendo autoridad para invariantes, compatibilidad legacy y comportamiento no sustituido.
- Si código, una SPEC histórica y la visión post-demo parecen contradecirse, detenerse y analizar la precedencia antes de implementar.
- No convertir objetivos `PENDIENTES` de la SPEC 016 en funciones ya existentes.

# Convenciones

- En código nuevo, usar `businessId` para variables relacionadas con empresa.
- En Firestore, conservar nombres canónicos existentes en español: `negocioId`, `clienteId`, `creadoEn`, `actualizadoEn`, etc.
- No persistir dos nombres para el mismo concepto.
- Mantener compatibilidad legacy mediante adaptadores cuando corresponda.
- No realizar refactorizaciones generales dentro de tareas funcionales.
- No eliminar funcionalidades existentes sin autorización.
- Trabajar en etapas pequeñas.
- No hacer commit ni push salvo solicitud explícita.

# Diseño y sistema visual

- Esta sección aplica a código nuevo y a tareas de modernización visual. No migrar código existente dentro de tareas funcionales.
- Colores, radios, sombras, espaciado y movimiento salen de los tokens de `src/styles/tokens.css` (`--color-*`, `--radius-*`, `--shadow-*`, `--space-*`, `--motion-*`).
- En código nuevo no escribir `#hex`, `rgb()`, `hsl()` ni valores literales de radio, sombra o duración, ni en CSS, ni en estilos inline ni en CSS-in-JS.
- Si falta un token para un hueco real de una escala semántica, agregarlo a `tokens.css`. No crear paletas locales por feature.
- Excepciones documentadas, que no se cambian sin autorización: `--color-document-*` (documentos formales), `--color-data-*` (gráficos), `--color-dark-*` (sidebar y login) y `--color-stock-alert-*`.
- Los estilos compartidos viven en `src/styles/components.css` con prefijo `ui-`. El CSS de un feature contiene solo estilos de ese feature, y un feature no importa el CSS de otro.
- El CSS se empaqueta de forma global: buscar si una clase ya existe antes de crear otra.
- Reutilizar antes de crear: `Button` (con `loading`), `Spinner`, `LoadingState`, `Skeleton`, `SkeletonRegion`, `SkeletonTable`, `SkeletonCards`, `LoadingScreen` y `BrandLogo`. No crear otra familia de botón.
- Orden de los estados de datos: cargando, error, vacío, datos. Un vacío real nunca muestra skeleton, y un skeleton nunca debe quedar colgado si la carga falla.
- Tablas y tarjetas cargan con `SkeletonTable` o `SkeletonCards`. Secciones y páginas cargan con `LoadingState`.
- Un solo `role="status"` por estado de carga. No anidar `role="status"` ni `aria-live`. `BrandLogo` va siempre como hermano, nunca dentro de un `role="status"`.
- Modo oscuro y color de texto: no uses `--color-brand-600/700/800/900` ni `--color-dark-*` como color de texto (`color`, `fill`, `stroke`), ni en CSS ni en estilos inline de JSX: no cambian con el tema y quedan ilegibles en oscuro. Usa `--color-text-brand` (enlaces, pestañas activas), `--color-text-brand-accent` (eyebrows, iconos, marcadores y bordes de marca), `--color-text-brand-hover`, `--color-text-strong` / `--color-text-default` / `--color-text-muted`, `--color-text-on-strong` (texto sobre un fondo `--color-text-strong`) y `--color-text-expense` (montos de gasto). Para fondos de marca claros con texto del tema encima usa `--color-surface-brand`, nunca `--color-brand-50`; para el contorno de foco, `--color-focus`.
- `--color-dark-*` es solo para el sidebar de la consola y el panel visual del login (fondo oscuro fijo en ambos temas).
- Un token nuevo vale en claro lo mismo que el color al que reemplaza; solo su valor oscuro es nuevo. El modo claro no cambia.
- `npm run test:contrast-usage` es el guardia de lo anterior: falla si un CSS o un estilo inline usa uno de esos colores como texto, salvo la lista blanca comentada en `scripts/contrast-usage-smoke.mjs`. `npm run test:contrast` mide los pares de los tokens (y los espejos de Chart.js) en oscuro. Ejecutarlos si el cambio toca colores.
- Si el cambio toca `src/components/ui/`, ejecutar además `npm run test:button`, `npm run test:skeleton` y `npm run test:loading-screen`.

# Seguridad

- No guardar secretos en `VITE_*`.
- No versionar secretos, `.env.local`, `functions/.secret.local`, logs, `output/`, `tmp/` ni datos de emuladores.
- Las colecciones internas no deben ser accesibles mediante el SDK cliente.
- No permitir eliminación física de registros referenciados.
- Las reglas Firestore no sustituyen validaciones autoritativas en Functions.

# Módulos verticales

- Un módulo vertical (por ejemplo Taller o Clínica Veterinaria) se integra al Core solo con cambios localizados, declarados en la descripción del PR con su motivo.
- Permitido: rutas en `App.jsx` y menú, el módulo en `rbac`, reglas para sus propias colecciones (lectura por módulo, escritura `if false`) y sus propias Functions en archivos nuevos, exportadas en `index.js`.
- No autorizado: modificar Functions centrales existentes y descontar stock hasta que exista la forma única de consumo de inventario.
- Ante un conflicto en archivos de Core al integrar la baseline, se conserva la versión de Core.

# Flujo de trabajo

Antes de modificar:

1. Leer `AGENTS.md`.
2. Leer la SPEC aplicable.
3. Revisar Git.
4. Analizar los archivos relacionados.
5. Respetar estrictamente el alcance.
6. Informar riesgos antes de cambios estructurales.

Después de modificar:

- Resumir archivos y decisiones.
- Informar pruebas ejecutadas y pendientes.
- Mostrar `git status --short`.
- Indicar si el cambio altera el resultado visual y qué pantallas revisar en el navegador.
- Detenerse sin commit.

# Verificación por defecto

Solo los smokes del módulo que tocas, `npm run test:design`, `npm run build` y `git diff --check`. Sin pruebas de mutación ni renders de prueba salvo que se pidan. Reporta siempre el código de salida real de cada prueba.

# Verificación mínima

Cuando el alcance lo requiera (por ejemplo, cambios en `functions/` o de efecto transversal), ejecutar además de la verificación por defecto:

```bash
npm run build
npm run test:design
npm --prefix functions run lint
git diff --check
```

También ejecutar todos los smokes relacionados.
