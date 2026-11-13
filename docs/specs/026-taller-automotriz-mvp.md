# SPEC 026 — Taller Automotriz

**Estado:** Definitivo para MVP  
**Vertical:** Taller Automotriz / Mecánico  
**Base técnica analizada:** `feature/taller-mecanico`, commit `1bd1e6c467dae4425b818edc742fd1e41ac9a94d`  
**Ámbito:** contrato funcional, arquitectónico y de integración del módulo Taller con ValoraCloud Core

---

## 1. Propósito

Implementar una vertical de Taller Automotriz sobre ValoraCloud que permita administrar el ciclo operativo de un Vehículo desde su ingreso hasta su entrega, reutilizando los contratos autoritativos existentes del Core.

La entidad operacional central será la **Orden de Trabajo (OT)**.

Taller no debe duplicar Clientes, Inventario, Ventas, Compras, Proveedores, membresías ni configuración empresarial, y tampoco debe representar cada OT mediante un `Trabajo` artificial del módulo Proyectos.

---

## 2. Autoridad y precedencia

Esta SPEC aplica exclusivamente al módulo Taller y respeta, en este orden:

1. `AGENTS.md`;
2. comportamiento actualmente implementado en el Core;
3. esta SPEC para decisiones específicas de Taller;
4. documentación funcional ampliada del Taller cuando no contradiga los puntos anteriores.

Los flujos económicos, Inventario, Ventas, Compras, RBAC, Firestore Rules, Storage Rules e idempotencia son contratos protegidos.

Taller solo puede integrarse mediante extensiones localizadas que respeten dichos contratos.

---

## 3. Principios e invariantes

1. **OT única:** no existe una entidad paralela `Atención`.
2. **Core como fuente de verdad:** Cliente, Producto, Servicio, persona asignable, moneda, impuestos y documentos comerciales pertenecen al Core.
3. **Autoridad backend:** estados sensibles, aprobación, ocupación de Plaza, snapshots y movimientos físicos no se escriben autoritativamente desde el frontend.
4. **Aislamiento multiempresa:** toda operación valida negocio activo, negocio verificado y membresía activa.
5. **Sin borrado físico de historia operacional:** cancelaciones y correcciones conservan trazabilidad.
6. **Idempotencia:** toda operación que cree movimientos o efectos sensibles debe evitar duplicación por reintentos.
7. **Un solo efecto físico:** un repuesto no puede descontarse en Taller y volver a descontarse posteriormente por otro flujo.
8. **Correcciones compensatorias:** los efectos económicos se corrigen mediante devolución o movimiento compensatorio, no reescribiendo el movimiento original.
9. **Historial derivado:** el historial de un Vehículo se obtiene desde sus OTs; no existe una entidad `HistorialVehiculo`.
10. **MVP acotado:** no se incorporan contratos que el Core todavía no soporta de forma segura.
11. **Precios Core:** Taller no mantiene una fuente de precios independiente.
12. **Consumo físico separado de planificación:** planificar un Producto en una OT no modifica stock.

---

## 4. Alcance

### 4.1 Obligatorio

- Vehículos asociados a Clientes del Core.
- Creación, actualización, consulta y búsqueda de Vehículos.
- Cambio de propietario de Vehículo conservando la relación histórica de OTs anteriores.
- Patente obligatoria y única por negocio.
- VIN opcional y único por negocio cuando esté informado.
- Datos descriptivos persistentes del Vehículo:
  - marca;
  - modelo;
  - año;
  - color;
  - tipo.
- Tipo de Vehículo basado en catálogo predefinido.
- OT con número único e incremental por negocio.
- Recepción digital del Vehículo.
- Checklist de Recepción con controles predefinidos.
- Diagnósticos múltiples.
- Acción explícita de completar Diagnóstico.
- ServiciosOT basados en Servicios del Core.
- ProductosOT basados en Productos del Core.
- Asociación de cada ProductoOT a un ServicioOT.
- Responsables obtenidos desde personas asignables del negocio.
- Estados de ejecución por ServicioOT.
- Aprobación interna del alcance de la OT.
- Snapshots históricos del alcance al enviar a aprobación.
- Máquina de estados validada en backend.
- Plaza física básica.
- Historial del Vehículo derivado de sus OTs.
- Validación y revalidación de stock actual.
- Salida y devolución autoritativa de repuestos.
- Costo histórico congelado en movimientos.
- Auditoría de operaciones relevantes.
- RBAC, rutas y protección de acceso de Taller.
- Reutilización de moneda, impuestos y configuración empresarial.

### 4.2 Opcional

Solo si no afecta el alcance obligatorio:

- lectura de Productos por código de barras;
- gastos no inventariables.

### 4.3 Fuera del MVP

- reserva de stock;
- estado de pago propio de Taller;
- creación automática de Venta desde OT;
- Cotización → OT;
- aprobación digital del cliente;
- agenda horaria y reservas;
- notificaciones;
- fotografías mientras no exista contrato de Storage aprobado;
- garantías y retrabajos;
- mantenimiento preventivo;
- compatibilidad avanzada de repuestos;
- biblioteca técnica;
- dashboard consolidado de rentabilidad;
- generación automática de órdenes de compra;
- cronómetro o registro automático de HH;
- cálculo automático de costo de HH;
- `Servicio.horasEstimadas`;
- `Trabajador.costoHoraInterna`;
- Servicios temporales o tipo `Otro`.

---

## 5. Integración con ValoraCloud Core

| Capacidad Core | Uso en Taller | Tipo de integración | Regla |
|---|---|---|---|
| Empresa activa y negocio verificado | Contexto de todas las operaciones | Directa | Toda Function de Taller valida contexto empresarial. |
| Membresías | Autoridad del usuario | Directa | La autoridad proviene de membresía activa. |
| RBAC | Control de acciones | Extensión localizada | Taller incorpora capacidades propias y las valida en backend. |
| Clientes | Propietario del Vehículo | Directa | No existe colección paralela de Clientes. |
| Miembros / perfiles | Responsables | Adaptador mínimo | Taller expone solo datos necesarios para asignación. |
| Inventario | Productos y Servicios | Directa | Taller utiliza ítems `producto` y `servicio`. |
| Economía de Inventario | Salidas y devoluciones | Reutilización interna | Se reutiliza el núcleo económico protegido del Core. |
| `movimientosInventario` | Ledger físico | Extensión autoritativa | Taller registra movimientos propios asociados a OT. |
| Trabajos / Proyectos | Referencia técnica | Conceptual | No crear un `Trabajo` por OT ni invocar sus endpoints. |
| Ventas | Integración comercial futura | Futuro | El MVP no genera Venta automáticamente. |
| Pagos | Condición comercial futura | Fuera del MVP | Taller no inventa estado de pago. |
| Proveedores / OC / Recepciones / Compras | Reposición | Indirecta | Taller no duplica estos dominios. |
| Moneda e impuestos | Valorización | Directa | No se mantienen reglas tributarias paralelas. |
| Storage | Evidencia fotográfica futura | Nuevo contrato | Fotografías fuera del MVP. |

### 5.1 Identificación de Productos y Servicios

Productos y Servicios pertenecen al catálogo de Inventario Core.

Taller utiliza como referencia canónica:

```text
itemId
```

La diferenciación se realiza mediante:

```text
ServicioOT
→ itemId
→ tipoItem = servicio
```

```text
ProductoOT
→ itemId
→ tipoItem = producto
```

Taller no mantiene identificadores paralelos para representar el mismo ítem Core.

### 5.2 Contratos de Inventario reutilizados

Taller reutiliza el catálogo existente.

Las nuevas operaciones físicas deben reutilizar el núcleo económico protegido del Core.

Los endpoints de materiales del módulo Proyectos constituyen un precedente técnico, pero no deben invocarse directamente desde una OT.

---

## 6. Modelo de dominio

### 6.1 Cliente

Entidad del Core.

```text
Cliente 1 ─── N Vehículos
```

Taller conserva referencias al Cliente y no crea una copia completa de la entidad.

---

### 6.2 Vehículo

Entidad propia de Taller.

Debe mantener:

- propietario actual;
- patente;
- VIN cuando exista;
- marca;
- modelo;
- año;
- color;
- tipo.

#### Propietario

```text
Vehiculo.clienteId
= propietario actual
```

El propietario puede cambiar.

El cambio de propietario no modifica el Cliente histórico asociado a OTs anteriores.

#### Patente

La patente es:

- obligatoria;
- canónica;
- normalizada antes de persistir;
- única por negocio.

#### VIN

El VIN es:

- opcional;
- recomendado;
- normalizado cuando exista;
- único por negocio cuando esté informado.

La ausencia de VIN no bloquea el registro del Vehículo.

#### Datos descriptivos

Son obligatorios:

```text
marca
modelo
anio
color
tipo
```

#### Tipo de Vehículo

`tipo` debe seleccionarse desde el catálogo predefinido:

```text
sedan
hatchback
suv
pickup
station_wagon
furgon
van
coupe
convertible
otro
```

No se permiten valores libres fuera del catálogo.

#### Historial

El historial del Vehículo se obtiene consultando sus OTs:

```text
Cliente
└── Vehículo
    ├── OT-000001
    ├── OT-000002
    └── OT-000003
```

No existe una entidad separada de historial de propietarios ni de historial del Vehículo en el MVP.

---

### 6.3 Orden de Trabajo

Entidad central del módulo.

Debe mantener o relacionar:

- `vehiculoId`;
- `clienteId` histórico;
- número operacional;
- Recepción;
- Diagnósticos;
- ServicioOT;
- ProductoOT;
- responsables;
- Plaza actual;
- estado operacional;
- estado de aprobación;
- referencias a movimientos de Inventario;
- auditoría;
- fechas y autoría requeridas.

#### Cliente histórico

```text
OrdenTrabajo.clienteId
= propietario del Vehículo al crear la OT
```

Un cambio posterior en `Vehiculo.clienteId` no modifica OTs anteriores.

---

### 6.4 Número de OT

Reglas:

- único por negocio;
- incremental;
- generado en backend;
- transaccional;
- no reutilizable.

Formato visible inicial:

```text
OT-000001
```

El identificador técnico no reemplaza el número visible de OT.

---

### 6.5 Recepción

La Recepción forma parte de la OT.

No existe una entidad empresarial `RecepcionTaller` independiente.

Datos del MVP:

- kilometraje;
- nivel de combustible;
- checklist;
- accesorios;
- `danosObservados`;
- observaciones;
- usuario responsable;
- fecha/hora de recepción.

#### Propósito de la checklist

La checklist registra exclusivamente condiciones observables del Vehículo al momento de la Recepción.

No constituye un Diagnóstico mecánico.

#### Campos obligatorios

Los siguientes diez controles deben estar siempre informados:

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

#### Valores permitidos

| Campo | Valores |
|---|---|
| `carroceriaPintura` | `SIN_DANOS_VISIBLES`, `CON_OBSERVACIONES`, `NO_REVISADO` |
| `vidriosEspejos` | `SIN_DANOS_VISIBLES`, `CON_OBSERVACIONES`, `NO_REVISADO` |
| `lucesOpticos` | `SIN_DANOS_VISIBLES`, `CON_OBSERVACIONES`, `NO_REVISADO` |
| `neumaticosLlantas` | `SIN_DANOS_VISIBLES`, `CON_OBSERVACIONES`, `NO_REVISADO` |
| `interior` | `SIN_DANOS_VISIBLES`, `CON_OBSERVACIONES`, `NO_REVISADO` |
| `tableroIndicadores` | `SIN_ALERTAS_VISIBLES`, `CON_ALERTAS`, `NO_REVISADO` |
| `encendido` | `NORMAL`, `CON_DIFICULTAD`, `NO_ENCIENDE`, `NO_PROBADO` |
| `fugasVisibles` | `NO_SE_OBSERVAN`, `SE_OBSERVAN`, `NO_REVISADO` |
| `nivelesVisibles` | `SIN_OBSERVACIONES`, `CON_OBSERVACIONES`, `NO_REVISADO` |
| `estadoGeneral` | `SIN_OBSERVACIONES`, `CON_OBSERVACIONES` |

#### Registro de anomalías

Se consideran valores indicativos de anomalía:

```text
CON_OBSERVACIONES
CON_ALERTAS
CON_DIFICULTAD
NO_ENCIENDE
SE_OBSERVAN
```

Cuando exista al menos una anomalía, deberá describirse manualmente en:

```text
danosObservados
```

En ese caso:

```text
danosObservados != "Ninguno"
```

Si no existe ninguna anomalía visible:

```text
danosObservados = "Ninguno"
```

`NO_REVISADO` y `NO_PROBADO` indican que una condición no fue comprobada y no constituyen una anomalía por sí mismos.

No se crean campos independientes de observaciones por cada ítem de la checklist.

---

### 6.6 Diagnóstico

Una OT admite múltiples Diagnósticos.

Cada Diagnóstico registra:

- responsable;
- descripción manual;
- observaciones;
- estado;
- fechas y autoría.

Estados:

```text
borrador
completado
```

Regla:

```text
Guardar Diagnóstico ≠ Completar Diagnóstico
```

Completar un Diagnóstico significa que el técnico considera finalizada y utilizable esa evaluación para definir el alcance de la reparación.

No constituye una certificación objetiva del estado mecánico.

Al completar deben registrarse:

```text
completadoPorUid
completadoEn
```

Se requiere al menos un Diagnóstico `completado` antes de enviar la OT a aprobación.

Un Diagnóstico completado no debe reescribirse mediante edición ordinaria.

Si aparece nueva información, se registra otro Diagnóstico.

---

### 6.7 ServicioOT

`ServicioOT` representa una instancia ejecutable de un Servicio del Core dentro de una OT.

Reemplaza el concepto anterior de `Tarea`.

Cada ServicioOT:

- pertenece a una única OT;
- referencia un único Servicio Core mediante `itemId`;
- debe corresponder a `tipoItem = servicio`;
- tiene un responsable;
- mantiene estado de ejecución;
- puede tener cero o más ProductosOT asociados.

Estados:

```text
pendiente
en_progreso
completado
```

No existe Servicio manual `Otro`.

Si falta un Servicio, debe crearse primero mediante el catálogo Core y los permisos correspondientes.

---

### 6.8 ProductoOT

`ProductoOT` representa un Producto Core planificado para ejecutar un ServicioOT.

Cada ProductoOT:

- pertenece a un único ServicioOT;
- referencia un Producto Core mediante `itemId`;
- debe corresponder a `tipoItem = producto`;
- registra una cantidad planificada.

Relación:

```text
OT
└── ServicioOT
    └── ProductoOT
        └── Producto Core
```

La cantidad de ProductoOT es planificación:

```text
cantidad planificada ≠ cantidad consumida
```

Agregar, eliminar o modificar ProductoOT no modifica stock.

El consumo físico ocurre exclusivamente mediante movimientos `SALIDA_TALLER` y `DEVOLUCION_TALLER`.

---

### 6.9 Plaza

Plaza representa una ubicación física.

Ejemplos:

```text
Taller - Plaza 1
Taller - Plaza 2
Estacionamiento - Plaza 1
```

Estados permitidos:

```text
activa
inactiva
```

No se persisten estados funcionales:

```text
ocupada
disponible
```

La ocupación se deriva de la asignación de Plazas a OTs activas.

Reglas:

- una OT puede existir sin Plaza;
- una Plaza no puede estar asignada simultáneamente a dos OTs activas;
- cambiar de Plaza libera la anterior y asigna la nueva de forma autoritativa;
- la autoridad para asignación pertenece al backend;
- no se modelan capacidades, equipamiento, agenda ni reservas en el MVP.

---

## 7. Estado y aprobación

La OT mantiene dos dimensiones independientes:

### 7.1 Estado operacional

Valores canónicos:

```text
ingresada
en_cola
en_diagnostico
esperando_repuestos
esperando_aprobacion
en_reparacion
pendiente_entrega
cerrada
cancelada
```

### 7.2 Estado de aprobación

```text
pendiente
aprobada
rechazada
```

La aprobación cubre el alcance vigente:

- ServiciosOT;
- ProductosOT;
- cantidades planificadas;
- precios Core congelados para ese alcance.

Taller no permite ingresar precios manuales.

### 7.3 Flujo autoritativo

```text
Crear OT
→ ingresada
```

Con Recepción completada:

```text
ingresada
├── sin Plaza → en_cola
└── con Plaza → en_diagnostico
```

Una OT `en_cola` puede pasar a `en_diagnostico` al asignar una Plaza.

Con al menos un Diagnóstico completado y ServiciosOT definidos:

```text
Enviar a aprobación
→ validar stock actual
├── insuficiente → esperando_repuestos
└── suficiente   → esperando_aprobacion
```

En ambos casos:

```text
estadoAprobacion = pendiente
```

Si una OT espera repuestos antes de aprobación:

```text
esperando_repuestos
+ estadoAprobacion = pendiente
+ stock suficiente
→ esperando_aprobacion
```

Al aprobar:

```text
estadoAprobacion = aprobada
→ revalidar stock
├── insuficiente → esperando_repuestos
└── suficiente   → en_reparacion
```

Una OT puede encontrarse válidamente en:

```text
estado = esperando_repuestos
estadoAprobacion = aprobada
```

Cuando exista stock suficiente podrá continuar a `en_reparacion` sin nueva aprobación siempre que el alcance no haya cambiado.

Si se rechaza:

```text
estadoAprobacion = rechazada
```

La OT no avanza a reparación.

Al modificar y reenviar el alcance:

```text
estadoAprobacion = pendiente
```

### 7.4 Snapshots al enviar a aprobación

Los snapshots del alcance se generan al:

```text
Enviar a aprobación
```

No al agregar inicialmente un ServicioOT o ProductoOT.

El backend debe volver a consultar las referencias Core y congelar la información histórica necesaria, incluyendo los precios aplicables.

El frontend no es autoridad para construir dichos snapshots.

Los cambios posteriores en nombre o precio del Core no modifican retroactivamente el alcance histórico congelado.

### 7.5 Invalidación de aprobación

Después de aprobar una OT, cualquier modificación del alcance invalida la aprobación.

Se consideran cambios de alcance:

- agregar ServicioOT;
- eliminar ServicioOT;
- reemplazar Servicio Core;
- agregar ProductoOT;
- eliminar ProductoOT;
- reemplazar Producto Core;
- modificar cantidad planificada de ProductoOT.

Resultado:

```text
estadoAprobacion = pendiente
```

La OT debe enviarse nuevamente a aprobación y los snapshots deben reconstruirse desde Core.

Los cambios posteriores de precio en Core no modifican automáticamente una OT ya aprobada.

### 7.6 Ejecución de Servicios

Durante la reparación, cada ServicioOT evoluciona:

```text
pendiente
→ en_progreso
→ completado
```

Para finalizar la reparación:

```text
todos los ServicioOT
deben estar completados
```

### 7.7 Finalización y cierre

```text
en_reparacion
→ Finalizar reparación
→ pendiente_entrega
```

Finalizar la reparación no cierra la OT.

```text
pendiente_entrega
→ Registrar entrega
→ cerrada
```

La entrega física del Vehículo cierra la OT.

### 7.8 Cancelación

Para el MVP:

- `cancelada` es terminal;
- no existe reapertura;
- el número OT no se reutiliza;
- Cliente y Vehículo permanecen;
- una nueva visita crea una nueva OT;
- se permite cancelar antes de `en_reparacion`;
- cualquier efecto físico previo debe corregirse mediante devolución o movimiento compensatorio antes de cancelar.

---

## 8. Inventario y repuestos

### 8.1 Propiedad del movimiento físico

Taller es propietario del consumo físico de los repuestos utilizados durante la reparación.

```text
Producto utilizado
→ SALIDA_TALLER
→ disminución de stock
```

El consumo se registra cuando ocurre físicamente, no al planificar ni al cobrar.

### 8.2 Reserva de stock

El MVP no implementa reserva de stock.

Taller solo consulta y revalida stock actual.

No se utilizan los conceptos:

```text
stock reservado
stock comprometido
```

### 8.3 Salida de material

Contrato backend de Taller:

```text
registrarSalidaMaterialOT
```

Debe, en una operación autoritativa e idempotente:

1. validar negocio;
2. validar membresía;
3. validar permiso;
4. validar OT y estado compatible;
5. validar ServicioOT;
6. validar Producto Core;
7. validar cantidad;
8. bloquear stock insuficiente;
9. resolver el estado económico vigente;
10. aplicar salida valorizada;
11. actualizar stock y saldo económico;
12. registrar movimiento inmutable;
13. congelar costo histórico;
14. asociar movimiento a OT y ServicioOT;
15. registrar auditoría.

### 8.4 Devolución

Contrato backend de Taller:

```text
registrarDevolucionMaterialOT
```

Debe:

- referenciar una salida original;
- impedir sobredevolución;
- reutilizar el costo congelado;
- reponer cantidad y valor de forma consistente;
- crear un movimiento compensatorio;
- asociarse a OT y ServicioOT;
- ser idempotente.

### 8.5 Ledger

Tipos aprobados:

```text
SALIDA_TALLER
DEVOLUCION_TALLER
```

Cada movimiento debe conservar como mínimo:

- negocio;
- OT;
- `servicioOtId`;
- `itemId` del Producto;
- cantidad;
- stock anterior/posterior;
- costo unitario congelado;
- costo total;
- moneda;
- actor;
- fecha;
- snapshot mínimo del Producto;
- movimiento de origen en devoluciones.

### 8.6 Gastos

Un Producto con movimiento físico autoritativo no puede registrarse además como gasto material.

Los gastos opcionales de Taller se limitan a conceptos no inventariables.

---

## 9. Ventas y pagos

### 9.1 Venta desde OT

La generación automática de Venta desde OT queda fuera del MVP.

El Core ya puede generar efectos físicos al confirmar una Venta.

Por tanto, una integración futura OT → Venta deberá evitar que los Productos consumidos por Taller vuelvan a generar una segunda salida física.

```text
SALIDA_TALLER
+
confirmación futura de Venta
≠
segunda salida física
```

El contrato específico pertenece a una evolución posterior.

### 9.2 Pago

El Core no dispone actualmente de un estado de pago autoritativo suficiente para integrar este comportamiento al Taller.

Por tanto:

- el MVP no incluye `pendiente_pago`;
- Taller no permite marcar manualmente una Venta como pagada;
- la entrega no depende de un estado de pago inventado por Taller.

---

## 10. Horas hombre

El cálculo automático de horas hombre y su costo interno queda fuera del MVP.

Se difiere específicamente:

```text
Servicio.horasEstimadas
Trabajador.costoHoraInterna
```

También quedan fuera:

- HH reales automáticas;
- cronómetro;
- cálculo automático de costo de mano de obra.

El flujo completo de OT debe funcionar sin estas capacidades.

---

## 11. RBAC y seguridad

Taller incorpora capacidades propias.

| Capacidad | Permite |
|---|---|
| Lectura | Consultar Vehículos y OTs autorizadas. |
| Operación | Registrar Recepción, Diagnósticos, operar ServiciosOT y movimientos permitidos. |
| Aprobación | Aprobar o rechazar el alcance de una OT. |
| Administración | Gestionar la operación general y Plazas. |
| Costos | Consultar costos internos y valorizaciones cuando corresponda. |

Reglas:

- Functions valida la capacidad requerida;
- toda operación valida membresía activa;
- no se confía únicamente en roles globales;
- no existe escritura directa de movimientos de Inventario desde SDK cliente;
- ningún usuario puede operar datos de otro negocio;
- selectores de responsables deben exponer únicamente los datos necesarios.

---

## 12. Contratos backend de Taller

Los nombres técnicos pueden ajustarse a las convenciones del repositorio, pero las responsabilidades funcionales son las siguientes.

### Vehículos

- crear Vehículo;
- actualizar Vehículo;
- cambiar propietario respetando unicidad e historial.

### OT

- crear OT;
- actualizar datos ordinarios;
- cambiar estado mediante transiciones permitidas;
- cancelar OT.

Una actualización genérica no puede saltarse contratos específicos de estado, aprobación, Plaza o Inventario.

### Recepción

- registrar o actualizar Recepción;
- validar checklist completa;
- validar reglas de `danosObservados`.

### Diagnósticos

- registrar Diagnóstico;
- actualizar Diagnóstico en borrador;
- completar Diagnóstico.

### ServiciosOT

- crear ServicioOT;
- actualizar ServicioOT;
- asignar responsable;
- cambiar estado de ejecución.

### ProductosOT

- agregar ProductoOT;
- actualizar cantidad planificada;
- eliminar ProductoOT.

### Personas

- listar personas asignables de Taller.

### Plazas

- asignar Plaza;
- liberar Plaza.

### Aprobación

- enviar OT a aprobación;
- aprobar OT;
- rechazar OT;
- invalidar aprobación al modificar alcance.

### Inventario

- `registrarSalidaMaterialOT`;
- `registrarDevolucionMaterialOT`.

No se recomienda un endpoint genérico capaz de modificar libremente toda la OT.

---

## 13. Navegación, configuración y archivos

### 13.1 Navegación

Taller debe registrarse como módulo real:

- entrada de navegación;
- rutas protegidas;
- metadatos;
- validación de acceso;
- UI coherente con el shell actual.

### 13.2 Configuración

No se crea configuración adicional sin una necesidad empresarial concreta.

Las Plazas se mantienen como recursos operacionales propios del dominio Taller.

### 13.3 Fotografías

Quedan fuera del MVP.

Su incorporación posterior deberá definir explícitamente:

- ruta canónica de Storage;
- aislamiento por negocio;
- formatos;
- tamaño máximo;
- metadatos;
- permisos;
- retención;
- eliminación;
- comportamiento de una OT cerrada;
- Storage Rules.

---

## 14. Auditoría y correcciones

Se deben registrar eventos relevantes para:

- creación de OT;
- cambio de estado;
- cambio de propietario de Vehículo cuando corresponda;
- registro de Recepción;
- asignación/cambio de Plaza;
- creación de Diagnóstico;
- completar Diagnóstico;
- creación/cambio de ServicioOT;
- asignación de responsable;
- cambio de estado de ServicioOT;
- cambios de ProductoOT;
- envío a aprobación;
- aprobación/rechazo;
- invalidación de aprobación;
- salida y devolución de material;
- finalización de reparación;
- entrega;
- cancelación.

Cada evento conserva fecha autoritativa, actor y referencias necesarias.

Las correcciones económicas no eliminan ni reescriben el movimiento original.

---

## 15. Restricciones de implementación

Taller no debe:

- escribir stock directamente desde frontend;
- modificar el ledger económico fuera de operaciones autoritativas;
- llamar endpoints de materiales de `Trabajo` desde una OT;
- duplicar Clientes, Productos, Servicios, Compras, OC, Recepciones o Proveedores;
- mantener identificadores paralelos para Productos o Servicios Core;
- modificar `confirmarVenta` informalmente;
- crear estados de pago propios;
- introducir reservas de stock sin ledger;
- borrar físicamente OTs o movimientos;
- crear rutas de Storage no aprobadas;
- permitir cambios arbitrarios de estado mediante un dropdown genérico;
- introducir Servicio `Otro`;
- permitir precios manuales dentro de Taller;
- tratar la checklist de Recepción como Diagnóstico.

---

## 16. Riesgos principales

| Riesgo | Consecuencia | Mitigación |
|---|---|---|
| Taller y Venta descuentan el mismo Producto | Doble stock y doble costo | Taller controla el consumo físico; futura integración comercial debe reconocer stock previamente gestionado. |
| Dos OTs planifican el mismo stock | Faltante al iniciar reparación | Revalidar stock en puntos críticos; no afirmar que existe reserva. |
| Producto registrado también como gasto | Costo duplicado | Prohibir gasto inventariable cuando existe movimiento físico. |
| OT usa endpoints de Trabajo | Acoplamiento y entidades artificiales | Contratos propios de Taller sobre núcleo compartido. |
| Datos de checklist incompletos | Recepción ambigua | Los diez controles son obligatorios y contemplan estados no revisados/no probados. |
| Anomalía sin descripción | Pérdida de evidencia de Recepción | Exigir descripción en `danosObservados`. |
| Pago manual dentro de Taller | Cierre comercial sin evidencia | Pagos fuera del MVP. |
| Selectores exponen administración completa | Exceso de permisos | DTO mínimo y RBAC. |
| Archivos en rutas improvisadas | Riesgo de acceso o fuga | Fotografías fuera hasta aprobar Storage. |
| Reportes suman OT y Venta sin procedencia | Doble imputación | Integración futura con origen económico explícito. |

---

## 17. Criterios de aceptación

### Vehículo

- pertenece a un Cliente del mismo negocio;
- `clienteId` representa al propietario actual;
- cambiar el propietario no altera OTs históricas;
- patente es obligatoria y única por negocio;
- VIN es opcional y único por negocio cuando existe;
- registra obligatoriamente marca, modelo, año, color y tipo;
- `tipo` solo acepta valores del catálogo definido;
- puede buscarse por patente y, cuando exista, VIN;
- su historial se obtiene desde OTs sin entidad paralela.

### Recepción

- contiene los diez controles definidos;
- todos los controles tienen un valor;
- `NO_REVISADO` y `NO_PROBADO` representan una comprobación no realizada;
- no utiliza la checklist como Diagnóstico;
- `danosObservados` siempre está informado;
- cualquier anomalía requiere descripción manual;
- sin anomalías, `danosObservados` es exactamente `Ninguno`.

### OT

- recibe número único e incremental desde backend;
- conserva `clienteId` histórico;
- puede existir sin Plaza;
- cambios sensibles pasan por backend;
- `cerrada` y `cancelada` son terminales;
- una OT cancelada no se reabre.

### Diagnóstico

- admite múltiples registros;
- guardar y completar son acciones distintas;
- exige al menos uno `completado` antes de enviar a aprobación;
- un Diagnóstico completado no se reescribe mediante edición ordinaria.

### ServicioOT

- referencia un Servicio Core mediante `itemId`;
- el ítem debe ser de tipo `servicio`;
- mantiene responsable;
- mantiene estado `pendiente`, `en_progreso` o `completado`;
- no admite Servicio `Otro`;
- todos deben estar completados antes de finalizar reparación.

### ProductoOT

- pertenece a un ServicioOT;
- referencia un Producto Core mediante `itemId`;
- el ítem debe ser de tipo `producto`;
- mantiene cantidad planificada;
- modificar planificación no altera stock.

### Aprobación

- está separada del estado operacional;
- exige al menos un Diagnóstico completado;
- genera snapshots desde Core al enviar a aprobación;
- solo una capacidad autorizada aprueba/rechaza;
- modificar Servicios, Productos o cantidades invalida aprobación;
- una OT aprobada puede esperar repuestos sin perder aprobación mientras no cambie el alcance;
- precios Core modificados después de la aprobación no alteran automáticamente el snapshot histórico.

### Plaza

- puede estar activa o inactiva;
- no mantiene estado persistente `ocupada/disponible`;
- una OT puede existir sin Plaza;
- una Plaza no puede asignarse simultáneamente a dos OTs activas.

### Inventario

- solo Productos generan movimiento físico;
- `itemId` identifica el Producto Core;
- stock insuficiente bloquea una salida real;
- salida/devolución y saldo económico se mantienen consistentes;
- costo histórico queda congelado;
- reintentos no duplican movimientos;
- devolución no supera consumo pendiente;
- los movimientos se relacionan con OT y ServicioOT;
- no existe reserva en el MVP.

### Cierre

- todos los ServiciosOT deben estar completados;
- `Finalizar reparación` produce `pendiente_entrega`;
- `Registrar entrega` produce `cerrada`;
- no se genera Venta automática;
- no se depende de un estado de pago inexistente.

### Seguridad

- toda operación valida negocio y membresía;
- RBAC se valida en backend;
- no hay escrituras cliente autoritativas sobre movimientos físicos;
- no existe acceso cruzado entre negocios.

---

## 18. Decisiones aprobadas y evolución futura

### 18.1 Aprobado para el MVP

- capacidades RBAC específicas de Taller;
- movimientos `SALIDA_TALLER` y `DEVOLUCION_TALLER`;
- reutilización del núcleo económico protegido de Inventario;
- Vehículo con propietario actual y Cliente histórico en OT;
- patente obligatoria;
- VIN opcional;
- datos descriptivos obligatorios del Vehículo;
- catálogo controlado de tipo de Vehículo;
- checklist definitiva de Recepción;
- Diagnóstico con acción `Completar`;
- ServicioOT en reemplazo de Tarea;
- ProductoOT asociado a ServicioOT;
- snapshots al enviar a aprobación;
- precios provenientes exclusivamente del Core;
- Plaza sin estado persistente de ocupación.

### 18.2 Evolución posterior

Mediante SPEC específica podrán incorporarse:

- `crearCotizacionDesdeOT`;
- `crearVentaDesdeOT`;
- contrato de stock previamente gestionado por Taller;
- sincronización comercial;
- Pagos;
- fotografías;
- agenda;
- notificaciones;
- garantías;
- mantenimiento preventivo;
- compatibilidad avanzada de repuestos;
- solicitudes de compra desde faltantes;
- HH estimadas automáticas;
- costo interno de HH;
- HH reales;
- reportes y rentabilidad.

---

## 19. Flujo objetivo del MVP

```text
Cliente Core
→ Vehículo
→ Crear OT
→ Recepción
→ Plaza / En cola
→ Diagnóstico
→ Completar diagnóstico
→ Definir ServicioOT
→ Asociar ProductoOT
→ Validar stock actual
→ Enviar a aprobación
→ Generar snapshots
→ Aprobar OT
→ Revalidar stock
→ En reparación
→ Ejecutar ServiciosOT
→ SALIDA_TALLER / DEVOLUCION_TALLER
→ Completar todos los ServiciosOT
→ Finalizar reparación
→ Pendiente de entrega
→ Registrar entrega
→ Cerrada
```

Flujos alternativos admitidos:

```text
sin Plaza
→ en_cola
→ asignar Plaza
→ en_diagnostico
```

```text
stock insuficiente antes de aprobación
→ esperando_repuestos
```

```text
OT aprobada + stock insuficiente
→ esperando_repuestos
→ continuar cuando exista stock
```

```text
alcance modificado después de aprobación
→ aprobación invalidada
→ pendiente
→ nuevo envío a aprobación
```

```text
rechazo
→ estadoAprobacion = rechazada
→ modificar alcance
→ reenviar
```

---

## 20. Estado de definición

Con las decisiones incorporadas en esta versión:

- el alcance funcional del MVP está cerrado;
- el modelo de dominio está cerrado;
- la checklist de Recepción está definida;
- los datos obligatorios del Vehículo están definidos;
- no quedan definiciones funcionales pendientes para comenzar implementación.

Los detalles de persistencia física, índices, colecciones internas de idempotencia, mecanismos transaccionales y otras decisiones específicas de Firestore pertenecen al diseño técnico y deben respetar esta SPEC sin modificar su contrato funcional.
