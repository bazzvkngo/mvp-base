# Etapa 15 — Revisión de seguridad de Taller

## Alcance y precedencia

Revisión de Vehículos, OT, Recepción, Diagnósticos, Servicios/Productos,
aprobación, Plazas, Historial y selectores. AGENTS.md prevalece;
se conserva el contrato Core de membresías y módulos. La SPEC definitiva MVP
(VIN opcional, checklist definida) es la utilizada, no la propuesta histórica
de actualización que aún exigía VIN y dejaba checklist pendiente.

## Hallazgos antes de modificar

1. Algunas mutaciones (Vehículos, creación OT, Recepción, Diagnósticos y
   planificación) autorizan antes de la transacción pero no releen la autoridad
   al escribir. Una revocación concurrente puede no participar en el conflicto.
2. Las capacidades de Taller están dispersas entre conjuntos de roles. El
   frontend recibe solo rol, perdiendo el contexto de perfil personalizado.
   Se explicitarán capacidades preservando la operación ya implementada para
   MEMBER con perfil Taller, como el precedente WORKS_OPERATE del Core.
3. La implementación de movimientos físicos de Taller fue retirada posteriormente
   del PR y quedó preservada en `backup/taller-etapa-11-materiales`.
4. El selector de Clientes permite que clienteId almacenado reemplace la identidad
   de documento al construir su DTO. Debe omitir referencias inconsistentes.

## Resolución de Core sobre visibilidad de costos

`firestore.rules`, lectura de `negocios/{businessId}/inventario/{itemId}`:
El análisis comprobó que Firestore entrega el documento de Inventario completo
cuando la regla autoriza la lectura; no admite ocultar campos individuales. La
revisión del mantenedor del 13-10-2026 confirmó que esto es el comportamiento
esperado para TECNICO: debe poder consultar costos de materiales en terreno y
solo se restringe su edición.

La matriz de permisos Core aún no refleja esa decisión mediante
`INVENTORY_COSTS_READ`. El mantenedor alineará ese contrato central en la próxima
baseline. Esta diferencia no bloquea Taller ni requiere modificar Rules globales
desde esta rama. La propuesta de un catálogo público sin costos queda registrada
como mejora futura para negocios que requieran una política distinta.

## Matriz compatible

| Perfil | Lectura | Operación | Crear Vehículo/OT | Aprobación | Administración | Costos Taller |
|---|---|---|---|---|---|---|
| OWNER / ADMIN sin perfil personalizado | Sí | Sí | Sí | Sí | Sí | Sí |
| TECNICO sin perfil personalizado | Sí | Sí | Sí | No | No | Sí, según decisión Core |
| MEMBER legacy sin perfil personalizado | Sí | Sí | No | No | No | Sí (Core) |
| MEMBER con perfil activo que incluye Taller | Sí | Sí | No | No | No | No |
| Otros roles / sin módulo / membresía inactiva | No | No | No | No | No | No |

No se crean roles ni campos de permisos en membresías. El Core actual configura
módulos, no capacidades individuales de Taller; un perfil Taller de solo lectura
independiente requiere un contrato adicional y no se inventa en esta etapa.

## Verificación

Ejecutada el 13-10-2026, sobre emuladores sin importar ni exportar datos locales:

| Comando | Resultado |
|---|---|
| `npm run test:rbac` | OK: matriz frontend/backend, roles y perfiles |
| `npm run test:vehicles-model` | OK |
| `npm run test:vehicles-ui` | OK (smoke de código, no recorrido manual de navegador) |
| `npm run test:work-orders-model` | OK |
| `npm run test:work-orders-ui` | OK (smoke de código, no recorrido manual de navegador) |
| `npm run test:vehicles-integrated` | `VEHICLES_INTEGRATED_LOCAL_OK`, salida 0 |
| `npm run test:work-orders-integrated` | Salida 0: OT, Recepción, Diagnósticos, planificación, Plazas, aprobación, ejecución, cierre e Historial |
| `npm run test:rules` | `RULES_SMOKE_OK`, salida 0 |
| `npm --prefix functions run lint` | OK |
| `npm run build` | OK; advertencia de chunks mayores a 500 kB |
| `git diff --check` | OK |

La matriz integrada actual cubre 35 Functions × 5 escenarios (175 rechazos):
sin sesión, usuario de otro negocio, membresía inactiva, perfil sin Taller y
usuario suspendido. Además verifica 55 denegaciones SDK sobre las 11 colecciones
internas (get/list/create/update/delete), incluyendo OWNER.

Se comprobó revocación entre la autorización inicial y la transacción: se rechaza
la creación sin persistir Vehículo ni recibo de idempotencia. Las suites existentes verifican además estados inválidos, referencias
ajenas, permisos de aprobación/Plazas, costos, concurrencia e idempotencia.

La primera ejecución integrada detectó una capacidad denegada serializada como
null en lugar de false para perfiles sin módulos resueltos. Se corrigió el
retorno booleano y se añadió regresión; la repetición completa pasó.

La prueba sintética confirmó la lectura directa de costoBase por TECNICO. Tras
la decisión del mantenedor, se registra como evidencia de la política vigente,
no como filtración. El DTO de Taller continúa sin exponer costos hasta que la
alineación central de capacidades sea publicada.

El runtime Java del emulador de reglas imprimió un NullPointerException durante
el apagado, después de `RULES_SMOKE_OK` y salida 0. No hubo aserciones fallidas;
se registra esta incidencia del entorno sin ocultarla. Build y emuladores
requirieron ejecución fuera del sandbox tras restricciones locales; no hubo
deploy ni acceso a datos productivos.

## Correcciones aplicadas

- `functions/tallerAccess.js` centraliza capacidades de Taller sin reemplazar
  la autorización Core. Reutiliza `requireOperationalBusinessAccess`,
  `assertBusinessCanOperate` y `resolveBaseTaxSettings`.
- Vehículos, OT, Recepción, Diagnósticos, planificación, ejecución,
  aprobación, cierre y Plazas releen membresía, perfil, usuario, negocio y
  configuración de impuestos dentro de la transacción. La lectura participa
  en la detección de cambios concurrentes; no se usa negocioActivoId como permiso.
- Se conserva la comprobación específica de aprobación y los permisos
  administrativos de Plazas y modificación de Vehículos.
- El selector de Clientes omite identidades inconsistentes; sus respuestas,
  catálogo, responsables e Historial siguen acotadas sin costos internos.
- Las páginas reciben el contexto completo de acceso, incluido perfil y módulos,
  y utilizan `hasBusinessPermission` en lugar de conjuntos de roles locales.
  La ruta protegida Core se conserva; la interfaz no sustituye al backend.
- No se modifican reglas globales, roles, stock, kernel económico ni persistencia
  local de emuladores. Los cambios preexistentes de etapa 14 se preservan.

## Controles inspeccionados

| Superficie | Control |
|---|---|
| Todas las Functions Taller | Sesión autenticada, negocio operativo y membresía activa del negocio solicitado |
| Referencias | Documentos bajo negocio autorizado; validación de negocio/identidad de OT, Vehículo, Cliente, Servicio, Producto y Plaza |
| Mutaciones sensibles | Capacidades backend y revalidación transaccional de autoridad, además de invariantes y estados existentes |
| Aprobación y Plazas | Aprobación separada de operación; administración de Plazas reservada a OWNER/ADMIN |
| Historial | Eventos inmutables por SDK, lectura mediante DTO sin costo; sin reconstrucción artificial de eventos |
| Rutas y botones | Protección Core y capacidades coherentes con membresía/perfil; sin autorización basada solo en UI |
| Colecciones internas | Reglas explícitas o denegación final; sin lectura/escritura SDK incluso para OWNER |

Colecciones internas cubiertas por pruebas de get/list/create/update/delete:
`vehiclePlateKeys`, `vehicleVinKeys`, `vehicleCreateRequests`, `otCounters`,
`otCreateRequests`, `otApprovalState`, `otApprovalRequests`,
`otServiceExecutionRequests`, `otClosureRequests`, `plazaOccupancyKeys` y la
subcolección `historial` de OT.

## Archivos de esta etapa

- Backend: `functions/tallerAccess.js`, `vehiclePersistence.js`,
  `workOrderPersistence.js`, `workOrderPlazas.js`;
  `functions/package.json` incorpora el helper al lint.
- Frontend: `src/domain/rbac.mjs`, `workshopPlazaModel.mjs`, `src/app/App.jsx`,
  páginas de Vehículos/OT, `DiagnosisPanel.jsx` y `ServicePlanningPanel.jsx`.
- Pruebas: `scripts/workshop-security-cases.mjs`, `rbac-smoke.mjs`,
  `work-orders-integrated-local.mjs`,
  `work-order-model-smoke.mjs`, `work-order-ui-smoke.mjs`, `vehicle-ui-smoke.mjs`.

El diff de trabajo también contiene cambios previos de Historial y persistencia
local; no deben atribuirse a esta revisión de seguridad ni descartarse.

## Dictamen y riesgos residuales

**La etapa 15 queda aceptable dentro del alcance de Taller.** Los controles de
autorización, aislamiento y colecciones internas se verificaron en emuladores.
La visibilidad de costos para TECNICO es una decisión explícita de producto;
la posterior alineación de `INVENTORY_COSTS_READ` pertenece al Core y no bloquea
este módulo.

Como mejora futura, el Core podrá introducir proyecciones de catálogo sin costos
para empresas que necesiten ocultarlos a perfiles operacionales. Esa alternativa
afecta consumidores compartidos de Inventario, Proyectos y Reportes, por lo que
debe diseñarse, aprobarse y probarse fuera de esta rama.

No se incorporaron capacidades configurables nuevas en membresías ni se cambió
la semántica legacy de MEMBER. No se realizó despliegue ni prueba manual completa
de interfaz. Las carpetas `firebase-export-*` ya presentes siguen sin seguimiento
en Git; no fueron leídas, borradas, restauradas ni añadidas. No deben incluirse
en el commit del módulo.
