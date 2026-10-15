# Taller Automotriz — Documento de implementación (etapas 1 a 15)

## 1. Propósito y estado del documento

Este documento deja trazabilidad funcional y técnica de la implementación del
módulo Taller Automotriz en ValoraCloud. Consolida las etapas 1 a 15 y se utiliza
como referencia para revisión, mantenimiento y futuras etapas.

El módulo cubre el flujo principal desde el registro de un vehículo hasta la
entrega de la Orden de Trabajo (OT), incluyendo recepción, diagnóstico,
planificación, aprobación, ejecución de servicios, plazas e historial. No sustituye la SPEC vigente: ante una
contradicción, prevalecen `AGENTS.md`, la SPEC aplicable y los contratos Core.

## 2. Límites del módulo

### Incluido

- Vehículos asociados a Clientes existentes de ValoraCloud.
- Órdenes de Trabajo con numeración autoritativa y cliente histórico.
- Recepción, diagnósticos, servicios y productos planificados.
- Aprobación con snapshot de alcance y precios Core.
- Ejecución de servicios sin modificar físicamente el stock.
- Administración y asignación exclusiva de plazas.
- Finalización, entrega e historial de eventos persistidos.
- Controles RBAC, validaciones de negocio y aislamiento multiempresa.

### Deliberadamente excluido

- Dashboard específico de Taller.
- Creación de Clientes, Inventario, Ventas, Compras, Proveedores o membresías
  duplicadas.
- Trabajo de Proyectos por cada OT.
- Reserva de stock, venta automática, pago o estado `pendiente_pago`.
- Precios manuales, descuentos manuales o costos editables desde Taller.
- Agenda, reservas, capacidad o equipamiento de Plaza.
- Historial independiente de propietarios.
- Páginas globales independientes de Diagnósticos, Aprobaciones, Repuestos o
  Movimientos.
- Horas-hombre y margen manuales en Taller. Estas reglas deben definirse por el
  Core antes de integrarse al flujo.
- Consumo y devolución física de repuestos desde Taller. Esta integración queda
  pendiente del mecanismo único de consumo de Inventario Core.

## 3. Arquitectura, datos y seguridad transversal

### 3.1 Aislamiento multiempresa

Los datos operacionales del módulo viven bajo
`negocios/{businessId}/...`. En los documentos Firestore se conserva el nombre
canónico `negocioId`. El `negocioActivoId` del cliente sirve únicamente para
dar contexto de navegación: la autorización real depende de una membresía activa
en `membresias/{businessId}__{uid}`.

Cada Function que muta datos vuelve a comprobar, dentro de su operación
autoritativa, la sesión, la membresía, el perfil habilitado, el negocio del
documento involucrado y la capacidad requerida. Por ello, ocultar una acción en
la interfaz nunca reemplaza la validación del backend.

### 3.2 Datos operacionales principales

| Dominio | Ubicación funcional | Propósito |
| --- | --- | --- |
| Vehículos | `negocios/{businessId}/vehiculos/{vehiculoId}` | Vehículo y propietario actual. |
| Órdenes de trabajo | `negocios/{businessId}/ordenesTrabajo/{otId}` | OT, estados, cliente histórico, vehículo y plaza. |
| Diagnósticos | Subcolección de la OT | Registros independientes de diagnóstico y auditoría. |
| ServiciosOT y ProductosOT | Subcolecciones de la OT/Servicio | Alcance operativo y planificación de materiales. |
| Recepción | Registro 1:1 asociado a la OT | Condición observable de ingreso del vehículo. |
| Plazas | `negocios/{businessId}/plazasTaller/{plazaId}` | Estado administrativo y nombre de Plaza. |
| HistorialOT | Subcolección de la OT | Eventos persistidos de solo lectura. |

### 3.3 Colecciones técnicas internas

Las llaves de unicidad, solicitudes idempotentes, contadores, balances y locks
son detalles internos del backend. Entre ellas se encuentran
`vehiclePlateKeys`, `vehicleVinKeys`, `vehicleCreateRequests`,
`otCounters`, `otCreateRequests`, `otApprovalState`,
`otApprovalRequests`, `otServiceExecutionRequests`, `otClosureRequests` y
`plazaOccupancyKeys`.

Estas colecciones no se exponen por el SDK cliente. Firestore Rules permite
lectura controlada de datos operacionales de Taller y bloquea las escrituras
directas sensibles, las cuales se realizan por Firebase Functions.

### 3.4 Principios de integración Core

- Clientes se reutilizan como propietarios actuales e históricos; Taller no crea
  una entidad paralela.
- Inventario mantiene catálogo, tipos de ítem, stock y precio. Taller referencia
  `itemId`, consulta disponibilidad y no ejecuta movimientos físicos en este PR.
- Las rutas, navegación, layout, badges, tablas, formularios, estilos, permisos
  y mensajes reutilizan patrones existentes de ValoraCloud.
- Los cambios compartidos fueron extensiones localizadas de rutas, RBAC,
  Rules, índices y servicios, sin modificar informalmente contratos económicos
  del Core.

## 4. Modelo operativo y máquinas de estado

### 4.1 Orden de Trabajo

Una OT pertenece a un Vehículo del mismo negocio. Al crearla, se copia el
`clienteId` del propietario actual como dato histórico: un cambio posterior de
propietario no altera OTs existentes. El número visible es autoritativo,
incremental, no reutilizable y tiene formato inicial `OT-000001`.

La dimensión operacional y la dimensión de aprobación son independientes:

| Dimensión | Valores relevantes | Uso |
| --- | --- | --- |
| Estado operacional | `ingresada`, `en_cola`, `en_diagnostico`, `esperando_aprobacion`, `esperando_repuestos`, `en_reparacion`, `pendiente_entrega`, `cerrada` | Describe el avance real de la atención. |
| Estado de aprobación | `pendiente`, `aprobada`, `rechazada` | Describe el estado comercial/operativo del alcance congelado. |

La OT cerrada es terminal. No se reabre mediante una acción ordinaria y no se
crea una Venta automáticamente al entregarla.

### 4.2 ServiciosOT

Un ServicioOT solo puede avanzar mediante acciones explícitas de backend:

```
pendiente → en_progreso → completado
```

No se usa un selector libre de estado. La transición exige una OT compatible,
un responsable válido dentro del negocio y una capacidad operacional adecuada.

### 4.3 Plaza

La Plaza solo persiste su estado administrativo:

```
activa | inactiva
```

La ocupación no se persiste como estado. `Disponible` y `En uso` se derivan
de OTs activas asignadas. Una clave técnica transaccional impide que dos OTs
activa compartan simultáneamente la misma Plaza.

## 5. Implementación por etapa

### Etapa 1 — Shell, navegación y rutas base

**Objetivo.** Integrar Taller como módulo real de ValoraCloud sin implementar
dominio adicional.

**Entregables.**

- Registro del módulo en RBAC, navegación y metadatos.
- Navegación principal a Órdenes de trabajo, Vehículos y Plazas.
- Rutas protegidas: `/taller`, `/taller/ordenes`,
  `/taller/ordenes/nueva`, `/taller/ordenes/:otId`,
  `/taller/vehiculos`, `/taller/vehiculos/nuevo`,
  `/taller/vehiculos/:vehiculoId` y `/taller/plazas`.
- Redirección de `/taller` a `/taller/ordenes`.
- Placeholders mínimos solo donde fueron necesarios para hacer navegables las
  rutas.

**Decisiones.** Se reutilizó el layout y el patrón de rutas protegidas del Core;
no se creó dashboard ni sistema de navegación propio.

### Etapa 2 — Dominio y backend de Vehículos

**Objetivo.** Crear el contrato autoritativo de Vehículo.

**Reglas implementadas.**

- El Vehículo pertenece a un Cliente Core del mismo negocio; `clienteId`
  representa al propietario actual.
- Patente obligatoria, normalizada y única por negocio.
- VIN opcional, normalizado y único solo cuando se informa.
- Marca, modelo, año, color y tipo obligatorios.
- Tipo limitado a `sedan`, `hatchback`, `suv`, `pickup`,
  `station_wagon`, `furgon`, `van`, `coupe`, `convertible` u
  `otro`.
- Cambio de propietario autoritativo, sin alterar el `clienteId` histórico
  de OTs ya creadas.
- Creación idempotente, timestamps y autoría según convenciones Core.

**Integridad.** La unicidad de patente y VIN se protege transaccionalmente con
llaves técnicas internas. El backend verifica Cliente, negocio, membresía y
capacidad antes de escribir.

### Etapa 3 — Interfaz de gestión de Vehículos

**Objetivo.** Habilitar consulta, alta y administración de Vehículos sin
duplicar Clientes.

**Entregables.**

- Listado con búsqueda por patente, VIN, marca o modelo.
- Tabla con patente, marca/modelo, año, tipo y propietario actual.
- Formulario con selector de Cliente Core, VIN claramente opcional y selector
  controlado de tipo.
- Ficha con datos del vehículo, propietario, edición, cambio de propietario,
  acceso a creación de OT y sección de historial de OTs basada en datos reales.
- Mensajes comprensibles para duplicidad de patente/VIN y validaciones de
  marca, color, año y formatos de patente.

**Experiencia.** Se corrigieron problemas de validación al escribir y se
adoptaron patrones visuales existentes, incluyendo tarjetas y acciones del
sistema.

### Etapa 4 — Creación y listado de Órdenes de Trabajo

**Objetivo.** Crear OTs desde Vehículos existentes y mostrarlas con datos
históricos correctos.

**Reglas implementadas.**

- La OT solo se crea para un Vehículo del mismo negocio.
- El backend asigna `numeroOT`; el frontend nunca lo genera.
- Contador transaccional y creación idempotente evitan números duplicados o
  reutilizados ante concurrencia y reintentos.
- `clienteId` se copia desde el propietario actual del Vehículo en el
  instante de creación y permanece congelado para la historia.
- Estado inicial `ingresada` y aprobación inicial `pendiente`.

**Interfaz.** `/taller/ordenes/nueva` parte con búsqueda por patente; si no
existe Vehículo, dirige al flujo ya existente de alta de Vehículo. El listado
muestra número, patente, vehículo, cliente histórico, estados, Plaza y fecha de
actualización con datos reales.

### Etapa 5 — Estructura base de ficha de OT

**Objetivo.** Centralizar el ciclo de vida completo en una única ficha.

**Entregables.**

- Cabecera persistente con número OT, marca/modelo, patente, Cliente histórico,
  estado operacional, estado de aprobación y Plaza cuando existe.
- Pestañas: Resumen, Recepción, Diagnósticos, Servicios y repuestos e Historial.
- Resumen construido solo con información disponible, sin contadores ni datos
  ficticios.
- Una misma ruta soporta todos los estados, sin páginas separadas por estado ni
  pestaña aislada de aprobación.

### Etapa 6 — Recepción de OT

**Objetivo.** Registrar la condición observable de ingreso del vehículo, sin
convertirla en diagnóstico mecánico.

**Datos.** La recepción es 1:1 con la OT e incluye kilometraje, nivel de
combustible, checklist, accesorios, daños observados, observaciones,
`recibidoPorUid` y `recibidoEn`. Combustible utiliza opciones predefinidas
para una captura consistente.

**Checklist obligatorio.**

1. `carroceriaPintura`
2. `vidriosEspejos`
3. `lucesOpticos`
4. `neumaticosLlantas`
5. `interior`
6. `tableroIndicadores`
7. `encendido`
8. `fugasVisibles`
9. `nivelesVisibles`
10. `estadoGeneral`

**Validación.** Los valores de anomalía admitidos son
`CON_OBSERVACIONES`, `CON_ALERTAS`, `CON_DIFICULTAD`,
`NO_ENCIENDE` y `SE_OBSERVAN`. Ante anomalías,
`danosObservados` debe describir el caso y no puede ser `Ninguno`. Sin
anomalías debe ser exactamente `Ninguno`. `NO_REVISADO` y
`NO_PROBADO` son válidos y no son anomalías por sí mismos.

La operación autoritativa registra autoría y fecha y aplica la transición
operacional definida por la SPEC y la disponibilidad de Plaza.

### Etapa 7 — Diagnósticos

**Objetivo.** Mantener diagnósticos independientes, auditables e inmutables al
completarse.

**Reglas implementadas.**

- Una OT admite múltiples diagnósticos.
- Estados permitidos: `borrador` y `completado`.
- Guardar un borrador no equivale a completarlo.
- Completar se ejecuta mediante acción explícita de backend; registra
  `completadoPorUid` y `completadoEn`.
- Un registro completado no se edita ordinariamente; nueva información se
  incorpora en un nuevo diagnóstico.
- El responsable debe ser asignable y pertenecer al negocio.
- No se puede enviar una OT a aprobación sin, al menos, un diagnóstico
  completado.
- OTs cerradas se mantienen en modo consulta: no se agregan diagnósticos.

**Interfaz.** Borradores con edición contextual, completados en modo lectura y
actor mostrado preferentemente con nombre real, usando correo como respaldo si
no existe nombre de perfil.

### Etapa 8 — ServicioOT y ProductoOT

**Objetivo.** Definir el alcance técnico usando exclusivamente el catálogo Core.

**Reglas implementadas.**

- ServicioOT referencia `itemId` de Inventario con `tipoItem = servicio`.
- ProductoOT pertenece a un ServicioOT y referencia `itemId` con
  `tipoItem = producto`.
- Cada servicio tiene responsable válido del negocio y estados
  `pendiente`, `en_progreso` y `completado`.
- La cantidad planificada es entera, visible y no mueve stock.
- El precio Core se muestra cuando corresponde, pero no puede editarse desde
  Taller.
- No existe servicio “Otro”, identificadores paralelos `servicioId`/
  `productoId`, ni uso de endpoints de materiales de Proyectos.

**Interfaz.** Los selectores filtran catálogo por tipo de ítem y los formularios
reutilizan componentes del sistema.

### Etapa 9 — Aprobación y snapshots de OT

**Objetivo.** Congelar autoritativamente el alcance aprobado sin permitir al
cliente manipular precios o snapshots.

**Flujo implementado.**

1. Enviar a aprobación exige al menos un diagnóstico completado.
2. El backend relee servicios y productos por `itemId` desde Inventario Core.
3. Valida el tipo de cada ítem y obtiene nombre y precio Core vigentes.
4. Construye el snapshot, congela `precioUnitario` y registra auditoría.
5. Valida disponibilidad actual de stock, sin crear reserva.
6. Cambia la aprobación a `pendiente` y determina el estado operacional
   compatible.
7. Aprobar exige capacidad específica y revalida stock.
8. Si después de aprobar falta stock, la OT puede quedar en
   `esperando_repuestos` con aprobación `aprobada`.
9. Rechazar conserva trazabilidad.
10. Modificar servicios, productos o cantidades invalida automáticamente la
    aprobación y vuelve a `pendiente`; reenviar reconstruye el snapshot.

Los cambios posteriores de nombre o precio en Inventario no alteran la historia
aprobada.

### Etapa 10 — Ejecución de ServiciosOT

**Objetivo.** Ejecutar servicios aprobados sin permitir saltos de estado.

**Entregables.**

- Functions explícitas para iniciar y completar servicios.
- Validación de estado previo, estado compatible de OT, responsable, membresía
  y permisos operacionales.
- Auditoría al iniciar y completar.
- Acciones visuales contextuales y badges de estado.

Iniciar o completar un servicio no consume stock ni genera movimientos.

### Etapa 11 — Retirada del PR

La implementación de consumo y devolución física se conserva en la rama
`backup/taller-etapa-11-materiales`, pero se retiró de
`feature/taller-mecanico`. El descuento de stock debe esperar el mecanismo único
de consumo definido por Inventario Core.

ProductoOT permanece como planificación: referencia un Producto Core, conserva
cantidad y snapshot de aprobación, pero no modifica stock, no genera movimientos
y no ofrece acciones de consumo o devolución.

### Etapa 12 — Plazas del Taller

**Objetivo.** Administrar puestos físicos sin confundir su estado administrativo
con ocupación funcional.

**Entregables.**

- CRUD administrativo mínimo para nombre de Plaza.
- Activar e inactivar.
- Asignar, cambiar y liberar Plaza desde una OT.
- Bloqueo transaccional ante doble asignación concurrente.
- Rechazo de asignación de Plaza inactiva.
- Tabla de Plazas con nombre, estado persistido, ocupación derivada, OT y
  vehículo cuando se encuentra ocupada.

Cambiar Plaza libera la anterior y asigna la nueva dentro de la misma operación
consistente. La entrega de una OT libera su Plaza asignada.

### Etapa 13 — Finalización de reparación y entrega

**Objetivo.** Cerrar el ciclo operacional sin introducir Venta o Pago.

**Flujo implementado.**

- **Finalizar orden de trabajo:** solo desde `en_reparacion`, con todos los
  ServiciosOT completados. El backend vuelve a comprobar la condición y
  transita a `pendiente_entrega`.
- **Registrar entrega:** solo desde `pendiente_entrega`; transita a
  `cerrada`, libera Plaza y registra auditoría.
- `cerrada` es terminal; la interfaz mantiene la OT en modo de lectura y
  no ofrece acciones incompatibles.

La interfaz usa avisos visibles para “Vehículo listo para entrega” y acciones
contextuales, sin añadir páginas nuevas ni estados de pago.

### Etapa 14 — Historial de OT

**Objetivo.** Presentar trazabilidad basada en eventos reales, no inferida desde
el estado presente.

**Entregables.**

- Pestaña Historial de solo lectura.
- Orden cronológico estable.
- Fecha, actor, tipo de evento y detalle relevante.
- Cobertura de creación de OT, recepción, Plaza, diagnósticos, planificación,
  aprobación e invalidación, ejecución de servicio, finalización, entrega y cancelación cuando exista un evento
  persistido.
- Compatibilidad para OTs históricas creadas antes de la incorporación completa
  del ledger: no se inventan eventos ausentes.

### Etapa 15 — Revisión final de RBAC y seguridad

**Objetivo.** Revisar de forma transversal Functions, servicios frontend, rutas,
Rules y colecciones técnicas de Taller.

**Correcciones y controles.**

- Se centralizaron capacidades de Taller para lectura, operación, creación,
  aprobación, administración y costos.
- Las mutaciones validan reiteradamente identidad, membresía activa, perfil,
  negocio y capacidad; una revocación concurrente se rechaza.
- La interfaz refleja permisos, pero no es la autoridad.
- Se revisaron Vehículos, OT, Recepción, Diagnósticos, ServiciosOT, ProductosOT,
  aprobación, Plazas, Historial y selectores auxiliares.
- Las colecciones internas se bloquearon al SDK cliente.
- Taller no expone operaciones de movimientos físicos de Inventario.
- DTOs y pantallas no exponen costos a usuarios sin capacidad de costos.

**Decisión pendiente de Core.** La visibilidad de costos de Inventario para
TECNICO fue confirmada por la mantención como decisión funcional central. La
matriz `INVENTORY_COSTS_READ` se alineará en una baseline posterior; no se
consideró un bloqueo de seguridad específico de Taller.

## 6. Interfaz y experiencia de usuario

La SPEC determina qué datos y acciones debe entregar Taller; ValoraCloud define
cómo se integra visualmente. La implementación reutiliza layout, jerarquía,
tipografía, componentes, tokens, tablas, filtros, formularios, badges, modales,
estados de carga, vacío, error y permisos existentes.

Decisiones UX relevantes:

- No se usan dropdowns libres para cambiar estados de OT, aprobación o
  ServicioOT.
- Acciones sensibles se presentan como botones explícitos y contextuales:
  completar diagnóstico, enviar/aprobar/rechazar, iniciar/completar servicio,
  finalizar orden de trabajo y registrar entrega.
- Se diferencia estado operacional de aprobación, planificación de ProductoOT,
  estado persistido de Plaza de su ocupación derivada y recepción de diagnóstico.
- Las pantallas de Vehículos, OTs, Servicios y Plazas se ajustaron para mantener
  espaciado, densidad, acciones y tablas coherentes con el resto del producto.
- Cuando no existe backend de una etapa posterior, se prepara la sección sin
  fabricar datos ni estados.

## 7. Verificaciones ejecutadas

Las siguientes verificaciones se ejecutaron durante las etapas implementadas:

```text
npm run test:rbac
npm run test:vehicles-model
npm run test:vehicles-ui
npm run test:work-orders-model
npm run test:work-orders-ui
npm run test:vehicles-integrated
npm run test:work-orders-integrated
npm run test:rules
npm --prefix functions run lint
npm run build
git diff --check
```

Además se ejecutaron smokes y casos específicos de aprobación, ejecución de
servicios, Plazas, cierre, entorno Firebase e interfaz.

La matriz de seguridad cubrió 37 Functions con cinco escenarios negativos:
sin sesión, negocio ajeno, membresía inactiva, perfil sin módulo Taller y usuario
suspendido. También se comprobó que 13 colecciones técnicas internas queden
denegadas para el SDK cliente.

## 8. Archivos y extensiones compartidas relevantes

La implementación agregó archivos propios de Taller y extendió de manera
localizada archivos compartidos que eran necesarios para integrarlo:

- `firestore.rules` y `firestore.indexes.json`: lectura controlada, bloqueo
  de colecciones internas e índices del módulo.
- `functions/index.js`, `functions/rbac.js` y
  `functions/tallerAccess.js`: exportación de Functions, capacidades y
  validación de acceso.
- `src/app/App.jsx`, navegación, `src/domain/rbac.mjs` y
  `src/firebase/firestorePaths.js`: rutas, metadatos y paths canónicos.
- `src/features/clients/ClientSelector.jsx`: reutilización del selector Core
  autorizado.
- `src/services/workService.js` y `src/services/reportService.js`:
  aislamiento de responsabilidades de Proyectos y reportes.
- `src/styles/components.css` y `src/styles/interior.css`: extensiones
  visuales localizadas siguiendo convenciones existentes.

El resto de los cambios corresponde a dominio, Functions, servicios, páginas,
componentes, pruebas y documentación propios de Taller.

## 9. Riesgos residuales y próximas decisiones

- La matriz central de costos del Core debe alinearse en la próxima baseline
  para resolver de forma uniforme la visibilidad esperada por los técnicos.
- Reportes económicos, horas-hombre y margen requieren una decisión Core previa;
  no deben agregarse como cálculos paralelos de Taller.
- Las mejoras posteriores deben abrir una nueva etapa, con SPEC aprobada,
  revisión de contratos Core y pruebas de regresión correspondientes.
- Los datos de emuladores y exportaciones locales son artefactos de desarrollo,
  se ignoran en Git y no forman parte del contrato del módulo ni del Pull Request.

## 10. Conclusión

Taller Automotriz quedó integrado como un módulo multiempresa de ValoraCloud con
un flujo trazable desde Vehículo y OT hasta entrega, reutilizando Clientes e
Inventario Core y manteniendo controles autoritativos en backend. Las próximas
iteraciones deben conservar estas invariantes y limitar cualquier ampliación de
alcance a una etapa explícitamente aprobada.
+

## 11. Matriz de trazabilidad por etapa

Esta sección relaciona cada etapa con los contratos entregados, sus puntos de
integración y el comportamiento que debe mantenerse en futuras modificaciones.

### Etapa 1 — Integración de shell

- **Entrada de navegación:** módulo Taller en navegación principal.
- **Rutas entregadas:** rutas de Órdenes, Vehículos y Plazas descritas en la
  etapa 1.
- **Protección:** se reutiliza la capa de rutas protegidas, capacidades y
  metadatos de navegación existentes; no hay un shell paralelo.
- **Regresión a evitar:** una ruta visible sin la protección equivalente en el
  layout principal.

### Etapa 2 — Vehículos

- **Functions autoritativas:** crear, actualizar, cambiar propietario y listar
  Clientes seleccionables para Taller.
- **Modelo de interfaz:** `vehicleModel.mjs` adapta datos históricos,
  normaliza patente, limita los tipos y entrega errores de formulario para UX.
- **Garantía de persistencia:** una llave de patente por negocio y, cuando
  existe, una llave de VIN por negocio. La creación usa una solicitud
  identificable para reintentos idempotentes.
- **Regresión a evitar:** aceptar una patente con formato distinto del contrato,
  permitir una marca o color numérico, o consultar un Cliente de otro negocio.

### Etapa 3 — Gestión visual de Vehículos

- **Pantallas:** listado, alta y ficha; los campos se concentran en
  `VehicleFormFields` para mantener consistencia entre creación y edición.
- **Dependencia Core:** selector de Cliente Core autorizado, sin crear ni copiar
  Clientes al módulo.
- **Permisos:** las acciones visibles dependen de capacidades, mientras la
  Function conserva la decisión final.
- **Regresión a evitar:** sustituir el selector de tipo por texto libre,
  mostrar un vínculo de gestión de Clientes fuera de contexto o crear datos
  ficticios para historial de OTs.

### Etapa 4 — Creación y listado de OT

- **Function autoritativa:** creación de OT con `vehiculoId` como única
  entrada de negocio relevante; el número y el cliente histórico se resuelven
  en backend.
- **Datos congelados al crear:** `numeroOT`, `clienteId` histórico, relación
  con el Vehículo, estados iniciales, fechas y actor.
- **Listado:** consulta dentro del negocio activo y asociación con Vehículo,
  Cliente histórico y Plaza solo cuando los datos existen.
- **Regresión a evitar:** calcular `numeroOT` en React o reemplazar el cliente
  histórico por el propietario actual del Vehículo.

### Etapa 5 — Ficha única

- **Pantalla:** `WorkOrderDetailPage`.
- **Componentes funcionales:** Recepción, Diagnósticos, Servicios/Repuestos,
  aprobación, Plaza e Historial se alojan bajo la misma ficha.
- **Regla de diseño:** una cabecera persistente evita repetir identidad de OT y
  separa las dimensiones de estado y aprobación.
- **Regresión a evitar:** abrir páginas independientes por cada estado o crear
  una pestaña de aprobación aislada de su alcance.

### Etapa 6 — Recepción

- **Function autoritativa:** registro o actualización de Recepción con
  verificación completa del payload permitido.
- **Validaciones:** los diez controles son obligatorios; combustible está
  restringido a `Vacío`, `1/4`, `1/2`, `3/4` y `Lleno`.
- **Auditoría:** `recibidoPorUid` y `recibidoEn` se asignan en backend.
- **Regresión a evitar:** añadir comentarios por ítem como sustituto de
  Diagnóstico, aceptar una recepción parcial o clasificar `NO_REVISADO`/
  `NO_PROBADO` como anomalías.

### Etapa 7 — Diagnósticos

- **Functions autoritativas:** crear borrador, actualizar borrador y completar
  diagnóstico.
- **Datos de cierre:** un completado guarda actor y fecha y bloquea la edición
  ordinaria.
- **Identidad visual:** el actor usa nombre de perfil cuando está disponible;
  correo es respaldo, nunca UID como dato principal de interfaz.
- **Regresión a evitar:** actualizar `estado: completado` directamente desde
  cliente, introducir el estado “validado” o modificar diagnósticos tras el
  cierre de OT.

### Etapa 8 — Servicios y productos planificados

- **Functions autoritativas:** crear, actualizar y eliminar ServicioOT; agregar,
  actualizar y eliminar ProductoOT.
- **Dependencia Core:** cada selector y validación relee el ítem Core y exige
  el `tipoItem` correcto.
- **Cantidad:** planificación en enteros positivos; no cambia stock, balances
  ni movimientos.
- **Regresión a evitar:** aceptar servicio/producto arbitrario, crear precio
  manual o usar contratos de materiales de Proyectos.

### Etapa 9 — Aprobación

- **Functions autoritativas:** enviar, aprobar, rechazar, revalidar y obtener
  resumen de aprobación.
- **Snapshot:** se deriva exclusivamente desde Core; contiene el alcance
  congelado y sus precios vigentes en el instante de envío.
- **Invalidación:** cualquier cambio estructural de servicios, productos o
  cantidades elimina la vigencia de la aprobación para que se envíe
  nuevamente.
- **Regresión a evitar:** confiar en una cotización/snapshot enviado por
  frontend, conservar aprobación tras alterar el alcance o convertir la
  aprobación en el estado operacional de la OT.

### Etapa 10 — Ejecución

- **Functions autoritativas:** iniciar y completar ServicioOT.
- **Precondiciones:** secuencia normal, OT habilitada, responsable compatible y
  capacidad operacional.
- **Auditoría:** inicio y completado quedan registrados como eventos.
- **Regresión a evitar:** permitir `pendiente → completado` o exponer un
  selector libre para todos los estados.

### Etapa 11 — Retirada del PR

- **Estado:** implementación preservada en
  `backup/taller-etapa-11-materiales` y retirada de la rama del PR.
- **Contrato vigente:** ProductoOT es planificación y no cambia stock.
- **Pendiente:** integrar Taller con la futura forma única de consumo de
  Inventario Core, sin crear un mecanismo paralelo.
- **Regresión a evitar:** reintroducir salidas/devoluciones propias de Taller o
  descontar stock al planificar, ejecutar, finalizar o entregar una OT.

### Etapa 12 — Plazas

- **Functions autoritativas:** crear, editar, activar, inactivar, asignar y
  liberar Plaza.
- **Modelo de interfaz:** la ocupación se calcula a partir de OTs activas y no
  se almacena en el documento de Plaza.
- **Concurrencia:** la operación de cambio libera la Plaza anterior y toma la
  nueva de manera consistente; la llave técnica evita doble ocupación.
- **Regresión a evitar:** persistir `ocupada`/`disponible`, asignar una
  Plaza inactiva o basar la exclusividad en una consulta visual.

### Etapa 13 — Cierre operacional

- **Functions autoritativas:** finalizar reparación, registrar entrega y
  consultar eventos de cierre.
- **Precondiciones:** finalizar requiere `en_reparacion` y todos los
  ServiciosOT completados; entregar requiere `pendiente_entrega`.
- **Efectos:** la entrega deja la OT `cerrada`, libera su Plaza y registra
  auditoría; no crea una Venta.
- **Regresión a evitar:** reabrir una OT cerrada, cerrar desde otro estado o
  exigir pago/venta como condición operativa.

### Etapa 14 — Historial

- **Fuente:** ledger de eventos persistidos en vez de reconstrucción del estado
  actual.
- **Lectura:** `workOrderHistoryModel.mjs` traduce tipo, fecha y detalle para
  una vista de solo lectura.
- **Compatibilidad:** una OT antigua sin eventos no se rellena artificialmente.
- **Regresión a evitar:** inventar eventos, editar el historial desde UI o
  exponer datos sensibles que no aporten trazabilidad.

### Etapa 15 — Seguridad

- **Acceso centralizado:** `tallerAccess.js` concentra evaluación de
  capacidades y comprobación fresca de acceso.
- **Superficie revisada:** Vehicles, OT, recepción, diagnósticos, servicios,
  productos, aprobación, plazas, cierre, historial, selectores y
  rutas.
- **Defensa en profundidad:** Firestore Rules limitan SDK; Functions validan
  autoridad e invariantes; UI solo representa acciones disponibles.
- **Regresión a evitar:** confiar en `negocioActivoId`, devolver costos sin
  capacidad, dejar accesibles colecciones técnicas o permitir escritura directa
  de inventario.

## 12. Mapa de componentes y operaciones principales

### Backend

- `functions/vehiclePersistence.js`: normalización, validación y operaciones
  de Vehículos.
- `functions/workOrderPersistence.js`: creación de OT, Recepción,
  Diagnósticos, ServiciosOT, ProductosOT, aprobación, ejecución, cierre e
  historial.
- `functions/workOrderPlazas.js`: administración y exclusividad de Plazas.
- `functions/tallerAccess.js`: verificación central de capacidades y
  membresía para Taller.

### Frontend

- `src/pages/VehiclesPage.jsx`, `NewVehiclePage.jsx` y
  `VehicleDetailPage.jsx`: recorrido de Vehículos.
- `src/pages/WorkOrdersPage.jsx`, `NewWorkOrderPage.jsx` y
  `WorkOrderDetailPage.jsx`: listado, creación y ficha única de OT.
- `src/features/workOrders/DiagnosisPanel.jsx`,
  `ServicePlanningPanel.jsx`,
  `ApprovalPanel.jsx` y `WorkOrderPlazaControl.jsx`: secciones
  especializadas de la ficha.
- `src/pages/WorkshopPlazasPage.jsx`: administración y estado derivado de
  Plazas.
- `src/services/vehicleService.js`, `workOrderService.js` y
  `workshopPlazaService.js`: adaptadores de llamadas a Functions y
  normalización de errores para interfaz.
- `src/domain/vehicleModel.mjs`, `workOrderModel.mjs`,
  `workOrderReceptionModel.mjs`, `workshopPlazaModel.mjs` y
  `workOrderHistoryModel.mjs`: modelos de presentación y validaciones de UX;
  no sustituyen el backend.

## 13. Cobertura de pruebas y criterios de regresión

Las verificaciones se organizan en cuatro niveles:

1. **Modelo y UX:** validaciones de Vehículo, Recepción, OT, estados, búsqueda,
   rutas y patrones de interfaz.
2. **Integración local:** creación y listado de Vehículos/OTs, contratos de
   Functions e interacción con emuladores.
3. **Reglas y RBAC:** permisos de módulo, aislamiento entre negocios y
   restricciones de Firestore/Storage.
4. **Calidad estática:** lint de Functions, build del frontend y revisión de
   whitespace del diff.

Al modificar una etapa existente, se deben ejecutar primero los smokes
directamente vinculados y después, como mínimo, `npm run build`,
`npm --prefix functions run lint` y `git diff --check`. Si la modificación
toca persistencia, autorización o inventario, se agregan las pruebas integradas,
de Rules y negativas de seguridad correspondientes.

## 14. Estado de entrega y mantenimiento

El documento describe una implementación acumulativa. Una próxima etapa no debe
reemplazar ni duplicar los contratos aquí detallados sin una decisión explícita
de arquitectura o una actualización aprobada de la SPEC. En especial:

- El cliente histórico de la OT, el snapshot aprobado y el costo congelado son
  datos históricos que no se recalculan desde el estado actual.
- El stock no se descuenta por planificación ni aprobación; solo por salida
  física autorizada.
- Plaza no guarda ocupación persistida.
- El cierre operacional no se transforma en flujo de Venta o Pago.
- Los artefactos `.firebase-emulator-data` y `firebase-export-*` son
  exclusivamente locales y no deben versionarse.
+

## 15. Reutilización explícita de contratos, funciones y componentes Core

Esta sección diferencia lo que Taller implementa de lo que reutiliza. El
objetivo fue extender ValoraCloud sin copiar ni sustituir responsabilidades
existentes.

### 15.1 Integración con Inventario Core

Taller reutiliza el catálogo, tipos, precios y stock visible de Inventario Core
para planificar y aprobar el alcance. La rama del PR no llama el kernel económico,
no descuenta ni repone stock y no crea movimientos. El consumo físico queda
pendiente de la forma única que defina Inventario Core.

### 15.2 Clientes, identidad y negocio

- `listarClientes` de `src/services/clientService.js` se reutiliza para
  obtener propietarios y Cliente histórico en las pantallas.
- `ClientSelector` de `src/features/clients/ClientSelector.jsx` se
  reutiliza en creación de Vehículo y cambio de propietario. El selector no
  crea Clientes; la Function confirma nuevamente que el Cliente pertenece al
  negocio.
- `normalizeBusinessVerificationState` de
  `functions/businessOperations.js` se reutiliza en flujos de OT y Plazas
  para respetar la condición operativa del negocio definida por el Core.
- Los perfiles y membresías existentes se releen antes de mutar datos. Taller
  no introduce tablas, usuarios ni membresías paralelas.

### 15.3 RBAC y autorización

- `ASSIGNABLE_BUSINESS_ROLES`, `TALLER_CREATION_ROLES`,
  `TALLER_MANAGEMENT_ROLES` y `TALLER_OPERATION_ROLES` de
  `functions/rbac.js` se usan para restringir responsables, creación,
  operación y administración.
- `BUSINESS_PERMISSIONS` y `hasBusinessPermission` de
  `src/domain/rbac.mjs` permiten que las pantallas expresen permisos de
  lectura, operación, aprobación, administración y costos.
- `requireTallerAccess`, `assertFreshTallerAccess` y
  `hasTallerCapability` de `functions/tallerAccess.js` concentran la
  comprobación autoritativa de acceso. La verificación fresca dentro de
  transacciones evita que una revocación concurrente sea ignorada.
- Firestore Rules y Rules de Storage complementan estas comprobaciones; no las
  reemplazan.

### 15.4 Infraestructura Firebase y rutas canónicas

- `db` y `getFirebaseFunctions` de
  `src/firebase/firebaseConfig` son el punto común para Firestore y
  Functions.
- `assertCloudFunctionAllowed` de
  `src/config/firebaseEnvironment.mjs` mantiene la protección existente
  para llamadas desde frontend.
- `httpsCallable` es el único mecanismo de mutación sensible desde los
  servicios de Taller; las consultas de lectura utilizan Firestore con los
  paths canónicos.
- `vehicleDocPath`, `vehiclesCollectionPath`, `workOrderDocPath`,
  `workOrdersCollectionPath`, `workOrderDiagnosesCollectionPath`,
  `workOrderServicesCollectionPath` y
  `workshopPlazasCollectionPath` de
  `src/firebase/firestorePaths.js` centralizan rutas y conservan el
  esquema `negocios/{businessId}/...`.

### 15.5 Shell, navegación y componentes visuales

- `App.jsx` y `navigation.js` aportan el layout, rutas protegidas,
  metadatos y estado activo de navegación.
- `Button`, `ResponsiveDialog`, `StatusBadge` y `AppIcon` son las
  primitivas visuales reutilizadas en Vehículos, OTs y Plazas.
- `formatDate` de `src/utils/formatters` se utiliza para fechas de listas
  y fichas, respetando el formato ya usado por ValoraCloud.
- Los íconos se toman de la librería existente `lucide-react`; no se agrega
  una iconografía exclusiva del módulo.
- Las extensiones de `components.css` e `interior.css` se limitan a
  necesidades de Taller y conservan la tipografía, espaciado, colores, bordes,
  badges, tablas y comportamiento responsive del sistema.

### 15.6 Separación respecto de otros dominios

- `src/services/workService.js` conserva el contrato propio de materiales de
  Proyectos, sin filtros ni conocimiento especial de movimientos de Taller.
- `src/services/reportService.js` conserva el contrato general de Reportes Core,
  sin exclusiones específicas para tipos de movimiento retirados de Taller.
- No se reutilizaron endpoints de materiales de Proyectos.
- No se creó una Venta, Compra, Pago, Cliente, Producto o Proveedor paralelo
  para resolver necesidades de Taller.

## 16. Inventario de operaciones autoritativas de Taller

Las acciones que cambian datos se ejecutan mediante Firebase Functions y reciben
el `businessId` como contexto explícito. En cada caso, el backend verifica la
membresía activa y el negocio real del documento antes de actuar.

### Vehículos

- Crear Vehículo con solicitud idempotente.
- Actualizar datos permitidos.
- Cambiar propietario actual.
- Listar Clientes seleccionables para Taller, filtrados al negocio autorizado.

### Orden de Trabajo y Recepción

- Crear OT con contador transaccional y cliente histórico congelado.
- Registrar o actualizar Recepción.
- Consultar personas asignables y catálogo filtrado de Taller.
- Consultar resumen de aprobación y eventos de cierre/historial.

### Diagnósticos, Servicios y Productos

- Crear, actualizar y completar Diagnóstico.
- Crear, actualizar, eliminar, iniciar y completar ServicioOT.
- Agregar, actualizar y eliminar ProductoOT.
- Cada operación emplea revisión de versión o fecha de actualización cuando
  corresponde, para informar conflictos concurrentes en vez de sobrescribir
  silenciosamente.

### Aprobación, Plaza y cierre

- Enviar, aprobar, rechazar y revalidar alcance.
- Crear, editar, activar/inactivar, asignar y liberar Plaza.
- Finalizar reparación y registrar entrega.

## 17. Puntos de auditoría y trazabilidad

El HistorialOT conserva eventos emitidos desde las operaciones autoritativas.
Los tipos actualmente presentados por la interfaz incluyen:

- Creación de OT y registro/actualización de Recepción.
- Asignación y liberación de Plaza.
- Creación, edición y completado de Diagnósticos.
- Alta, edición, eliminación, inicio y término de ServiciosOT.
- Alta, edición y eliminación de ProductosOT planificados.
- Envío, aprobación, rechazo, invalidación y revalidación de disponibilidad.
- Finalización de reparación y entrega de vehículo.

Para recepción se muestran los campos modificados; para aprobación, los estados anteriores/actuales y el motivo
cuando existe. El detalle se mantiene acotado para no exponer información
sensible innecesaria.

## 18. Detalle verificable de cada implementación del MVP

### 18.1 Etapa 1 — Registro de módulo, navegación y rutas

**Archivos de integración.** `src/app/App.jsx`,
`src/app/navigation.js`, `src/domain/rbac.mjs`, `functions/rbac.js`,
`functions/index.js`, `firestore.rules` y `firestore.indexes.json`.

**Resultado técnico.**

- Se añadió Taller a la navegación principal con las entradas Órdenes de
  trabajo, Vehículos y Plazas.
- Se registró la redirección `/taller → /taller/ordenes` y las rutas
  protegidas de listado, creación y ficha de Vehículos/OTs, además de Plazas.
- La resolución del permiso sigue el patrón de rutas y layout de ValoraCloud;
  no se creó un router, guard ni shell exclusivo.
- Las rutas de ficha aceptan identificadores de documento, pero la lectura y
  las acciones posteriores siguen limitadas al negocio autorizado.

**Límite de la etapa.** No introdujo dashboard, lógica de OT ni interfaces
funcionales que anticiparan etapas posteriores.

### 18.2 Etapa 2 — Contrato autoritativo de Vehículo

**Archivos principales.** `functions/vehiclePersistence.js`,
`src/domain/vehicleModel.mjs`, `src/services/vehicleService.js` y helpers
de paths Firestore.

**Datos aceptados.** `clienteId`, `patente`, `vin`, `marca`,
`modelo`, `anio`, `color` y `tipo`. El backend restringe los campos
aceptados y rechaza payloads con propiedades extra.

**Normalización y validación.**

- Patente: mayúsculas sin separadores; patrones aceptados `AAAA00`,
  `AAA00`, `AAAAA0` y `AAAA0`.
- VIN: opcional, normalizado y sometido a unicidad únicamente si contiene
  valor.
- Marca y color: texto; modelo permite texto y números; año es entero válido;
  tipo pertenece al conjunto cerrado del módulo.
- La patente y VIN no se guardan como duplicados “normalizados” del mismo
  concepto: el dato canónico es el campo persistido.

**Persistencia y seguridad.**

- Una operación transaccional crea las llaves de patente/VIN del negocio y el
  documento Vehículo.
- `requestId` hace idempotente la creación: un reintento recupera el resultado
  anterior sin duplicar entidad.
- La Function comprueba que el Cliente exista y sea del mismo negocio.
- Actualización y cambio de propietario no admiten campos ajenos al contrato.
  El cambio actualiza el dueño del Vehículo, no OTs históricas.

### 18.3 Etapa 3 — Interfaz de Vehículos

**Archivos principales.** `VehiclesPage.jsx`, `NewVehiclePage.jsx`,
`VehicleDetailPage.jsx` y `features/vehicles/VehicleFormFields.jsx`.

**Listado.**

- Busca localmente por patente, VIN, marca y modelo.
- Presenta patente, marca/modelo, año, tipo y propietario actual.
- Entrega acciones de creación y acceso a ficha según permisos de interfaz.
- Usa estados de carga, vacío, sin resultados, error y falta de permisos
  conforme a los patrones existentes.

**Formulario y ficha.**

- Cliente se selecciona con `ClientSelector`; VIN se etiqueta como opcional.
- Tipo utiliza opciones controladas y etiquetas en español.
- El input de marca y color restringe caracteres no textuales para UX; el
  backend vuelve a validarlos.
- La ficha muestra dueño actual, edición y cambio de propietario. El historial
  de OTs solo muestra registros consultados; no genera información de prueba.

### 18.4 Etapa 4 — Creación y listado de OT

**Archivos principales.** `functions/workOrderPersistence.js`,
`NewWorkOrderPage.jsx`, `WorkOrdersPage.jsx`,
`workOrderService.js` y `workOrderModel.mjs`.

**Creación.**

- El único dato de dominio necesario en el payload es `vehiculoId`;
  `businessId` y `requestId` entregan contexto y reintento.
- El backend lee Vehículo y Cliente, verifica su negocio, asigna
  `numeroOT` desde un contador transaccional y genera el formato visible
  `OT-000001`.
- La creación congela `clienteId`, inicializa `estado = ingresada` y
  `estadoAprobacion = pendiente`, y registra autoría/fechas.
- La secuencia no se reutiliza ni se duplica ante solicitudes concurrentes.

**Interfaz.**

- La alta busca inicialmente por patente y permite seleccionar un Vehículo
  existente.
- Si no se encuentra un Vehículo, dirige a su flujo de creación, sin construir
  un segundo formulario de Vehículo.
- El listado busca por número o patente y combina datos reales de Vehículo,
  Cliente histórico y Plaza.

### 18.5 Etapa 5 — Ficha única y resumen de OT

**Archivo principal.** `WorkOrderDetailPage.jsx`.

**Estructura.**

- La cabecera persistente contiene número, vehículo, patente, Cliente histórico,
  estado operacional, aprobación y Plaza.
- La ficha organiza el flujo por pestañas: Resumen, Recepción, Diagnósticos,
  Servicios y repuestos e Historial.
- Resumen muestra únicamente información que ya existe: no calcula costos,
  consumos, aprobaciones ni contadores inexistentes.
- La misma ficha se conserva durante todas las transiciones, reduciendo cambios
  de contexto para el usuario.

**Control de interfaz.** Las secciones quedan en modo lectura cuando el estado
terminal lo exige; no se sustituyen las validaciones backend por botones
ocultos.

### 18.6 Etapa 6 — Recepción

**Modelo y panel.** `workOrderReceptionModel.mjs` y la sección de Recepción
de `WorkOrderDetailPage.jsx`.

**Contrato persistido.**

- Kilometraje, nivel de combustible, checklist, accesorios, daños observados y
  observaciones provienen del formulario.
- `recibidoPorUid` y `recibidoEn` provienen de la Function, no del cliente.
- Cada uno de los diez campos de checklist se valida contra su enum específico,
  no contra un texto libre genérico.

**Regla de daños.**

- Si alguno de los valores representa anomalía, `danosObservados` debe ser una
  descripción efectiva y distinta de `Ninguno`.
- Si no existe anomalía, `danosObservados` debe ser exactamente `Ninguno`.
- `NO_REVISADO` y `NO_PROBADO` se aceptan sin forzar daño observado.

**Efecto operacional.** La Function determina la transición posterior de la OT
considerando recepción y Plaza, en lugar de aceptar un estado propuesto por la
interfaz.

### 18.7 Etapa 7 — Diagnósticos

**Componentes.** `DiagnosisPanel.jsx`, Functions
`registrarDiagnostico`, `actualizarDiagnostico` y
`completarDiagnostico`.

**Comportamiento.**

- Crear registra un borrador con responsable, descripción y observaciones.
- Editar exige que el documento siga en `borrador` y que su revisión sea la
  esperada; los cambios concurrentes devuelven conflicto.
- Completar es una operación distinta: cambia al estado `completado`,
  registra actor/fecha y bloquea posteriores ediciones ordinarias.
- El responsable se resuelve contra las personas asignables del negocio y no
  puede ser un UID arbitrario de otro negocio.

**Relación con aprobación.** El envío de OT a aprobación vuelve a comprobar que
exista al menos un diagnóstico completado. No se enlaza un diagnóstico a un
ServicioOT porque el contrato no establece esa relación.

### 18.8 Etapa 8 — ServiciosOT y ProductosOT

**Componentes.** `ServicePlanningPanel.jsx` y operaciones de planificación en
`workOrderPersistence.js`.

**ServicioOT.**

- Al crear o actualizar, el backend relee `itemId` en Inventario Core y
  exige `tipoItem = servicio`.
- Persiste responsable válido y el estado operativo cerrado
  `pendiente/en_progreso/completado`.
- El precio se obtiene de Core para mostrarlo; Taller no permite modificarlo.

**ProductoOT.**

- Se almacena dentro de un ServicioOT y exige `tipoItem = producto`.
- La cantidad planificada es un entero positivo.
- Agregar, modificar o eliminar planificación no cambia stock, valor ni
  movimientos de Inventario.
- Modificar el alcance ejecuta la invalidación de aprobación correspondiente,
  cuando existe una aprobación vigente.

### 18.9 Etapa 9 — Aprobación y snapshots

**Componente y Functions.** `ApprovalPanel.jsx`,
`enviarOTAprobacion`, `aprobarOT`, `rechazarOT`,
`revalidarDisponibilidadOT` y `obtenerResumenAprobacionOT`.

**Construcción de snapshot.**

- El frontend solicita la acción, pero no envía el contenido autoritativo del
  snapshot.
- La Function relee ServiciosOT y ProductosOT, relee sus `itemId` en
  Inventario Core, valida tipo, nombre, moneda y precio vigente.
- Calcula una huella del alcance y persiste el snapshot asociado a ella.
- El resultado conserva precio unitario y estructura aprobada aunque el
  catálogo cambie después.

**Estados y disponibilidad.**

- Enviar exige recepción compatible y diagnóstico completado.
- Aprobar requiere la capacidad específica y revalida disponibilidad.
- La falta de stock no crea reserva; puede mantener la aprobación y ubicar la
  OT en `esperando_repuestos`.
- Rechazar registra el motivo cuando fue informado.
- Cualquier cambio de alcance invalida la aprobación, por lo que reenviar
  siempre construye un snapshot nuevo.

### 18.10 Etapa 10 — Ejecución de ServiciosOT

**Functions.** `iniciarServicioOT` y `completarServicioOT`.

**Precondiciones comunes.**

- Membresía activa, permiso operacional, responsable válido y ServicioOT del
  mismo negocio/OT.
- OT en `en_reparacion` y aprobación `aprobada`.
- Revisión de fecha/versión para detectar modificación simultánea.

**Resultado.**

- Iniciar solo acepta `pendiente → en_progreso`.
- Completar solo acepta `en_progreso → completado`.
- Ambas transiciones escriben eventos de auditoría.
- El panel muestra únicamente la acción permitida por el estado vigente.

### 18.11 Etapa 11 — Retirada del PR

La implementación original se conserva íntegra en la rama local
`backup/taller-etapa-11-materiales`. Se retiraron de la rama del PR sus
Functions, UI, servicios, pruebas, reglas, índices y colecciones técnicas.

El comportamiento vigente es deliberadamente acotado:

- ProductoOT mantiene `itemId`, cantidad planificada, precio y snapshot de
  aprobación.
- La validación de disponibilidad antes y después de aprobar sigue vigente.
- Planificar, ejecutar, finalizar, entregar o cancelar no cambia stock.
- Taller no registra salidas, devoluciones, balances ni costos históricos de
  consumo.
- La integración física queda pendiente del mecanismo único de Inventario Core.

### 18.12 Etapa 12 — Plazas

**Modelo, pantalla y Functions.** `workshopPlazaModel.mjs`,
`WorkshopPlazasPage.jsx`, `WorkOrderPlazaControl.jsx`,
`crearPlazaTaller`, `actualizarPlazaTaller`, `activarPlazaTaller`,
`inactivarPlazaTaller`, `asignarPlazaOT` y `liberarPlazaOT`.

**Administración.**

- Nombre obligatorio con longitud controlada.
- Estado persistido limitado a `activa` e `inactiva`.
- Inactivar una Plaza no elimina registros ni altera la historia.

**Ocupación.**

- La UI deriva `Disponible` y `En uso` desde las OTs activas.
- La Function usa una llave técnica para obtener exclusividad y no depende de
  esa derivación visual.
- Asignar exige Plaza activa; cambiar Plaza libera la anterior y toma la nueva
  de forma coherente; liberar elimina la asignación de la OT.
- OT cerrada o cancelada no se considera activa para la ocupación.

### 18.13 Etapa 13 — Finalización y entrega

**Functions.** `finalizarReparacionOT` y `registrarEntregaOT`.

**Finalizar orden de trabajo.**

- Solo permite OT en `en_reparacion`.
- Relee los ServiciosOT y rechaza la operación si alguno no está
  `completado`.
- Escribe estado `pendiente_entrega`, auditoría y fecha de transición.

**Registrar entrega.**

- Solo permite OT en `pendiente_entrega`.
- Transita a `cerrada`, genera auditoría y libera la Plaza cuando existe.
- No genera Venta, Pago, cobro, movimiento de inventario adicional ni
  reapertura posterior.

**Interfaz.** El aviso de vehículo listo para entrega se ubica entre Resumen y
las pestañas; el botón es contextual y el estado cerrado bloquea acciones de
edición.

### 18.14 Etapa 14 — Historial

**Modelo y consulta.** `workOrderHistoryModel.mjs`,
`obtenerHistorialOT` y la pestaña Historial de `WorkOrderDetailPage.jsx`.

**Renderizado.**

- Ordena por la marca temporal persistida y conserva un criterio estable.
- Convierte tipos de evento a etiquetas humanas.
- Para recepción enumera campos modificados; para aprobación muestra estado
  previo/actual, aprobación y motivo.
- Muestra actor y fecha en modo solo lectura.

**Compatibilidad.** Una OT cerrada antes del ledger puede no tener eventos
históricos completos. El sistema no sintetiza eventos ni intenta reconstruir
acciones a partir del documento actual.

### 18.15 Etapa 15 — RBAC y seguridad

**Archivos principales.** `functions/tallerAccess.js`, `functions/rbac.js`,
`firestore.rules`, `scripts/workshop-security-cases.mjs` y servicios/UI de
Taller.

**Controles implementados.**

- Lectura, operación, creación, aprobación, administración y costos se
  resuelven por capacidades de Taller.
- Cada Function sensible verifica autenticación, membresía activa, estado de
  usuario/perfil, negocio solicitado, negocio del documento y capacidad.
- El negocio activo del navegador no autoriza una mutación por sí solo.
- Las Rules niegan acceso SDK a contadores, requests idempotentes, llaves de
  unicidad, locks, balances y demás colecciones internas.
- Las acciones de costo no se exponen a usuarios sin capacidad. La futura
  alineación de `INVENTORY_COSTS_READ` para técnicos corresponde a Core y fue
  identificada como decisión no bloqueante.

**Prueba negativa.** La matriz de seguridad cubre funciones de Taller frente a
falta de sesión, negocio ajeno, membresía inactiva, perfil sin Taller y usuario
suspendido.

## 19. Revisión de integración — etapa 16 (2026-10-14)

### Hallazgos previos a las correcciones

- **Cancelación faltante al iniciar la revisión:** la SPEC final contempla
  cancelar antes de `en_reparacion`, pero el código solamente reconocía
  `cancelada` como estado terminal. Confirmado que pertenece al MVP, se incorporó
  la acción pública autoritativa y su interfaz sin ampliar estados ni efectos.
- **Terminalidad de Plaza:** `liberarPlazaOTHandler` comprobaba autorización,
  pertenencia y revisión, pero no el estado terminal. Una OT histórica cerrada
  que conservara `plazaId` podía ser modificada. Se corrigió en Taller, sin
  migrar registros ni modificar contratos del Core.
- **Cantidades:** la planificación admite números positivos con hasta tres
  decimales en backend (comportamiento cubierto por pruebas anteriores), mientras
  la UI usa enteros. No se cambia este contrato
  silenciosamente en una revisión de integración; requiere una decisión de
  producto para su eventual alineación.
- **Alcance de la evidencia:** los smokes de UI existentes son verificaciones de
  código, no sesiones de navegador. No equivalen a validación visual o responsive.

### 19.1 Planificado

Revisar integración, invariantes, seguridad y regresiones del flujo ya existente,
desde Cliente Core hasta entrega. Corregir únicamente fallos de ese contrato;
no implementar nuevas operaciones, cambiar el kernel económico, modificar la
persistencia local ni ampliar el MVP.

Autoridades revisadas: `AGENTS.md`, contrato de desarrollo de módulos, SPEC final
de Taller, modelo definitivo y propuesta de navegación. La propuesta histórica
que exigía VIN no sustituye la SPEC final: VIN sigue siendo opcional.

### 19.2 Implementado

Se incorporó `scripts/work-order-end-to-end-cases.mjs` al runner integrado
existente. No introduce un framework, dependencia ni comando paralelo.

El recorrido crea un Cliente mediante `crearCliente` y reutiliza
`buildClientMutationPayload` del Core. El técnico registra un Vehículo sin VIN,
crea la OT, registra Recepción sin Plaza, asigna una Plaza creada por OWNER,
completa un Diagnóstico, planifica ServicioOT y ProductoOT, envía a aprobación,
ejecuta el servicio sin modificar stock. OWNER aprueba; el técnico
finaliza reparación y registra entrega. No se fuerzan estados de esa OT con
Admin SDK. El catálogo Core es un fixture sintético; no se prueba aquí el alta
del catálogo, que tiene sus propias pruebas.

Las regresiones legacy finales sí preparan documentos terminales con `plazaId`
residual. Están separadas del flujo feliz.

Se implementó además la cancelación explícita de OT desde `ingresada`, `en_cola`,
`en_diagnostico`, `esperando_aprobacion` y `esperando_repuestos`. La acción usa
la capacidad operacional existente, conserva `estadoAprobacion`, snapshots,
Cliente, Vehículo y número OT; libera Plaza y lock en la misma transacción, crea
el evento `ot_cancelada` y deja la OT terminal. No se agregó motivo obligatorio
porque la SPEC no lo exige.

### 19.3 Verificado

| Contrato | Evidencia ejecutada |
| --- | --- |
| Cliente Core y Vehículo | Alta pública, VIN ausente, patente canónica, duplicado rechazado y reintento sin duplicación. |
| Cliente histórico | Cambio de propietario por Function; la OT conserva el `clienteId` original hasta su consulta cerrada. |
| Creación de OT | Número backend, estado `ingresada`, aprobación `pendiente`, idempotencia y concurrencia en la suite existente. |
| Recepción | Diez enums, anomalías, `Ninguno`, `NO_REVISADO`/`NO_PROBADO`, autoría y transición sin/con Plaza. |
| Plaza | `en_cola → en_diagnostico`, exclusividad, cambio/liberación, inactivas y carreras de doble asignación. |
| Diagnóstico | Borrador distinto de completado, completado explícito, responsable y bloqueo de edición posterior. |
| Alcance | Referencias y tipos Core, planificación sin stock, prohibición de precio/snapshot autoritativo del cliente. |
| Aprobación | Diagnóstico requerido, snapshots y precios backend, rechazo, reenvío e invalidación al editar alcance. |
| Stock antes/después de aprobar | Esperas correspondientes, aprobación independiente, revalidación y ausencia de reserva. |
| ServicioOT | Secuencia explícita, permiso y responsable, OT habilitada, carreras y reintentos. |
| Finalización/entrega | Todos los servicios completados, estados previos, terminalidad, auditoría y liberación de Plaza. |
| Cancelación | Estados previos permitidos, rechazo desde reparación o estados posteriores, número conservado, Plaza liberada, idempotencia y carrera concurrente. |
| Historial | Eventos persistidos, actor/fecha, orden estable, sin costos en DTO y OT cerrada consultable por Vehículo. |
| Aislamiento/RBAC | 35 Functions por cinco escenarios negativos: sin sesión, negocio ajeno, membresía inactiva, perfil sin Taller y usuario suspendido. |
| Colecciones internas | 11 rutas internas sometidas a denegación de get/list/create/update/delete incluso para OWNER. |

**Ausencia de efecto físico:** planificar y aprobar dos unidades mantiene el stock
inicial. Iniciar/completar el ServicioOT, finalizar y entregar tampoco cambian
stock ni crean movimientos asociados a la OT. Cambiar nombre/precio del catálogo
no reescribe el snapshot y el cierre no crea una Venta.

**Reutilización Core inspeccionada, sin modificarla en esta etapa:**

- `functions/businessOnboarding.js`: guard de acceso operacional, aplicado por
  las dependencias de las Functions.
- `functions/businessOperations.js` y `businessJurisdiction.js`: habilitación
  del negocio y contexto fiscal, reutilizados por `tallerAccess.js`.
- `functions/rbac.js`, membresías/perfiles y reglas: autoridad de permisos;
  ocultar botones no autoriza operaciones.
- `src/domain/clientModel.mjs` y `crearCliente`: contrato existente de Clientes,
  utilizado por la prueba nueva sin duplicar esa entidad.
- Layout, navegación y primitivas existentes (`Button`, `StatusBadge`,
  `ResponsiveDialog`): inspección estática de rutas, estados, formularios y acciones.

No se detectaron escrituras SDK autoritativas de stock, aprobación, estado OT ni
snapshots en los servicios frontend revisados de Taller. Las
mutaciones pasan por Functions; las Rules niegan escrituras directas de Taller.

### 19.4 Correcciones realizadas y archivos

1. `functions/workOrderPlazas.js`: `liberarPlazaOTHandler` rechaza `cerrada` y
   `cancelada` dentro de la transacción y antes de tocar OT, lock o historial.
   Conserva los guards de negocio, membresía, capacidad y revisión. La liberación
   normal al entregar sigue en su transacción de cierre; no se ve alterada.
2. `scripts/work-order-end-to-end-cases.mjs`: recorrido público continuo y
   regresiones terminales, incluidas OTs históricas con asignación residual.
3. `scripts/work-orders-integrated-local.mjs`: ejecuta los casos nuevos antes
   de la matriz de seguridad existente.
4. Este documento consolidado: evidencia, diferencias y pendientes de etapa 16.
5. `functions/workOrderPersistence.js` y `functions/index.js`: transición
   transaccional `cancelarOT`, idempotencia compartida con cierres, liberación de
   Plaza, evento y exportación callable.
6. `src/services/workOrderService.js`, `src/pages/WorkOrderDetailPage.jsx` y
   `src/domain/workOrderHistoryModel.mjs`: llamada controlada, acción contextual,
   confirmación destructiva y lectura del evento en Historial.
7. `scripts/work-order-cancellation-cases.mjs`, runner, smoke UI y matriz de
   seguridad: cobertura positiva, negativa y concurrente de cancelación.

No se modificaron contratos compartidos del Core, Rules, índices, contratos de
precios, roles globales, launcher de emuladores ni datos locales. No hubo commit,
push ni despliegue. No se recrearon los documentos eliminados de etapas anteriores.

### 19.5 Pruebas ejecutadas

Resultados de esta sesión, no inferidos de ejecuciones históricas:

| Verificación | Resultado |
| --- | --- |
| `npm run test:work-orders-integrated` | Pasó: suite existente, cancelación, recorrido continuo y seguridad. |
| `npm run test:rules` | Pasó (`RULES_SMOKE_OK`, código 0); advertencia de apagado descrita abajo. |
| `npm run test:vehicles-integrated` | Pasó (`VEHICLES_INTEGRATED_LOCAL_OK`); reintentado tras liberar el proceso de prueba huérfano. |
| `npm run test:work-orders-model` / `test:work-orders-ui` | Pasaron; UI es smoke estático. |
| `npm run test:vehicles-model` / `test:vehicles-ui` | Pasaron; UI es smoke estático. |
| `npm run test:rbac` / `test:firebase-environment` | Pasaron. |
| `npm run test:inventory-model` | Pasaron modelo y MVP de Inventario. |
| `node scripts/inventory-acquisition-smoke.mjs` | Pasó: kernel económico. |
| `npm run test:works-model` / `test:reports` | Pasaron: regresiones Proyectos, balance y Reportes. |
| `npm run build` | Pasó; advertencia de bundle grande, no fallo de compilación. |
| `npm --prefix functions run lint` | Pasó. |
| `node --check scripts/work-order-end-to-end-cases.mjs` | Pasó. |
| `git diff --check` | Pasó, sin errores de whitespace; Git avisa conversión LF/CRLF. |

Los tests usan `emulators:exec` sin importar ni exportar respaldos. Los registros
detallados de esta ejecución están en `.local-logs/etapa16-*.log`, ignorados por
Git. Los rechazos `PERMISSION_DENIED` esperados son evidencia de pruebas negativas,
no fallos de la suite.

Los primeros intentos de build/emuladores encontraron restricciones del entorno
aislado. Se repitieron con permiso. Rules terminó correctamente, pero su proceso
Java emitió una excepción durante el apagado y quedó ocupando 8080. Se identificó
por PID, padre, comando y hora de inicio como perteneciente a la prueba antes de
cerrarlo. No se detuvieron procesos ajenos ni se borraron exports.

### 19.6 Riesgos pendientes

- **Validación UI pendiente:** no se ejecutó un recorrido interactivo en navegador
  ni comparación visual/responsive. Build, revisión de código y smokes no prueban
  interacción real, accesibilidad o los estados visuales bajo red lenta.
- **Matriz de costos Core:** la prueba confirma que TECNICO puede leer costos de
  Inventario Core según el contrato vigente. Los DTOs de Taller revisados siguen
  filtrados. La alineación central previamente indicada por Mauricio no se cambió
  ni se presenta como resuelta por Taller.
- **Ambiente:** pruebas ejecutadas con Node 26 del host; Functions declara Node 22
  y el emulador advierte del desajuste. No se verificó esta ejecución con Node 22
  ni en producción. El apagado de emuladores presentó la incidencia descrita.

### 19.7 Deuda técnica detectada

- Alinear explícitamente cantidad planificada decimal backend frente a controles
  enteros de UI. Mientras tanto no se afirma que backend restrinja
  toda planificación a enteros.
- Los listados e historial cargan colecciones completas; revisar volumen y
  paginación en una tarea autorizada, sin introducirlos aquí.
- Completar automatización de navegador; los smokes con expresiones sobre código
  no reemplazan pruebas de interacción.
- Warning de bundle superior a 500 kB. Se conserva el diseño de empaquetado actual;
  no se efectuó un refactor de rendimiento fuera de alcance.

### 19.8 Funcionalidades fuera de alcance confirmadas

Esta revisión no implementa consumo/devolución física de Taller, Pago, Venta automática, reservas, fotografías, HH,
agenda, capacidad/equipamiento de Plaza, reapertura de OT ni entidades paralelas
de Clientes/Inventario/Proyectos. El recorrido comprueba ausencia de Venta
automática y de descuento de stock adicional al cierre. Esto se refiere a Taller:
las funcionalidades preexistentes de otros módulos Core no se eliminan.

### 19.9 Recomendación de estado final

**Listo con observaciones.** El flujo completo, la cancelación y las correcciones
automatizadas pasan. Permanece pendiente una validación interactiva/visual de
navegador, la ejecución con Node 22 y las observaciones técnicas indicadas. No se
han identificado en las pruebas ejecutadas fallos críticos/altos sin documentar;
esto no constituye garantía de ausencia de defectos fuera de su cobertura.

## 20. Retiro de la etapa 11 del PR

El 15-10-2026 se retiró de `feature/taller-mecanico` la implementación de
consumo y devolución física de Inventario. Antes de modificar la rama se creó
`backup/taller-etapa-11-materiales` apuntando al commit
`736e4f526a26b49542fb561a0e3b91d813d15b7d`, que conserva el trabajo completo.

### 20.1 Implementación retirada

- Functions y servicios cliente para registrar salidas, registrar devoluciones
  y consultar materiales consumidos por una OT.
- Tipos `SALIDA_TALLER` y `DEVOLUCION_TALLER`, balances, solicitudes
  idempotentes y costo histórico propios de esos movimientos.
- Panel de consumo, devolución, stock consumido y movimientos físicos dentro de
  ServicioOT.
- Pruebas, estilos, eventos de Historial y documentación exclusivos de ese flujo.
- Reglas e índices agregados para consultar movimientos físicos de Taller.
- Filtros especiales que Reportes y Proyectos necesitaban únicamente para
  distinguir los movimientos retirados.

No se eliminó ni modificó el kernel económico protegido de Inventario Core ni
los contratos de materiales propios de Proyectos.

### 20.2 Funcionalidad conservada

- ProductoOT continúa referenciando un `itemId` de Inventario Core con
  `tipoItem=producto` y cantidad planificada.
- Agregar, modificar o eliminar planificación no cambia stock.
- Enviar y aprobar una OT revalida stock y congela nombres, precios y cantidades
  en snapshots autoritativos; esto no constituye una reserva ni un movimiento.
- Las transiciones de ServicioOT, finalización, entrega, cancelación, Plaza,
  Historial y RBAC permanecen operativas sin presuponer consumos físicos.
- El frontend no muestra acciones para consumir o devolver materiales.

### 20.3 Verificación del retiro

| Verificación | Código de salida | Resultado |
| --- | ---: | --- |
| `npm run test:rules` | 0 | `RULES_SMOKE_OK` |
| `npm run test:vehicles-integrated` | 0 | `VEHICLES_INTEGRATED_LOCAL_OK` |
| `npm run test:work-orders-integrated` | 0 | Suite integrada y seguridad correctas sin movimientos físicos de Taller. |
| `git diff --check` | 0 | Sin errores de whitespace; solo advertencias LF/CRLF. |
| `npm --prefix functions run lint` | 0 | Sin errores. |
| `npm run build` | 0 | Compilación correcta; permanece la advertencia conocida de bundle grande. |
| `npm run test:reports` | 0 | Regresión de Reportes correcta. |
| `npm run test:works-model` | 0 | Regresión de Proyectos y su kernel de materiales correcta. |

La integración física de Taller queda pendiente de la futura forma única de
consumo de Inventario Core. No se implementó descuento alternativo, reserva,
Venta, Pago ni horas-hombre como reemplazo.
