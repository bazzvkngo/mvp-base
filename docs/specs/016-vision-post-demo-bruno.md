# SPEC 016 — Visión post-demo Bruno

## 1. Propósito

Consolidar las decisiones confirmadas después de la demostración con Bruno sin
reescribir la historia del MVP ni presentar como implementado aquello que sigue
pendiente. Esta SPEC orienta la siguiente etapa de ValoraCloud y enlaza las SPEC
específicas que conservan el detalle funcional vigente.

## 2. Estado y fecha conceptual

- Fecha conceptual: 31 de agosto de 2026.
- Estado: visión maestra confirmada para planificación post-demo.
- Alcance: documental; no implica migraciones, cambios de código ni despliegue.

Cada decisión usa una de estas clasificaciones:

- **IMPLEMENTADO:** existe en el código local y mantiene su contrato vigente.
- **CONFIRMADO PENDIENTE:** el resultado de producto fue acordado, pero falta
  diseño, implementación o validación completa.
- **FUTURO/EXPERIMENTAL:** línea de investigación no aprobada como arquitectura
  productiva.

## 3. Reglas de precedencia documental

1. `AGENTS.md` prevalece siempre en seguridad, arquitectura y workflow.
2. El código implementado define el comportamiento real actual.
3. Las decisiones confirmadas en esta SPEC definen el target post-demo, sin
   convertirlo automáticamente en comportamiento actual.
4. Las SPEC históricas conservan invariantes y compatibilidad que no hayan sido
   sustituidos explícitamente.

Ante una contradicción futura, la SPEC más específica y más reciente, marcada
explícitamente como sustituta, prevalece sólo sobre el punto que sustituye. No
autoriza eliminar compatibilidad legacy ni ampliar el cambio a otros contratos.

## 4. Decisiones confirmadas y clasificación

### A. Administración y activación

- **IMPLEMENTADO:** el gate `VERIFICADA` existe y `getBusinessSession` resuelve
  el estado empresarial al cargar o revalidar la sesión.
- **IMPLEMENTADO:** Platform Admin abre la evidencia mediante una URL firmada
  temporal entregada por Functions, sin acceso global del SDK al bucket.
- **IMPLEMENTADO:** una sesión ERP ya abierta observa la aprobación realizada
  desde otra sesión mediante el listener empresarial existente, revalida y
  actualiza `businessSession`, habilita los módulos y notifica sin F5 ni polling
  permanente.
- **IMPLEMENTADO:** las tarjetas Empresas, Usuarios, Verificaciones pendientes y
  Suspensiones del Dashboard Platform Admin son navegables; Suspensiones usa el
  filtro existente y muestra la cifra de empresas suspendidas correspondiente.

### B. Inventario

- **IMPLEMENTADO:** Inventario es el catálogo/stock maestro y admite carga
  inicial masiva desde Excel/CSV.
- **IMPLEMENTADO:** el código de barras es independiente del código interno y el
  scanner conserva entrada manual, lector USB e implementación de cámara con
  `getUserMedia`, detector nativo y fallback a ZXing para EAN-13, EAN-8, UPC-A,
  UPC-E y Code 128.
- **QA PENDIENTE / LIMITACIÓN CONOCIDA:** la cámara abre y muestra preview, pero
  la prueba física desktop no decodificó códigos reales de dos productos. La
  lectura física por cámara no está validada; se repetirá en teléfono móvil al
  desplegar sobre HTTPS, sin bloquear por ahora manual ni USB.
- **IMPLEMENTADO:** el alta manual siempre solicita a ValoraCloud un código
  interno automático, la edición lo conserva como sólo lectura y los payloads
  manuales y el Callable ignoran propuestas de reemplazo. Excel/CSV mantiene por
  compatibilidad su contrato histórico `codigo`/`codigoSolicitado`; su eventual
  retiro o cambio de semántica requiere una decisión separada.
- **IMPLEMENTADO (BRUNO POST-DEMO C):** el detalle de producto distingue costo
  base/manual, promedio vigente, último costo e historial de adquisiciones
  vigentes/revertidas, con transiciones económicas cuando existen.

### C. Abastecimiento

Se mantienen dos flujos conceptualmente diferentes.

**IMPLEMENTADO — abastecimiento con OC:**

```text
Orden de compra → Recepción → Compra económica
```

La OC conserva lo solicitado. La Recepción ligada a una OC nunca supera lo
pendiente, no acepta como recibidas líneas ajenas y conserva trazabilidad. Al
confirmarla, la transacción vigente aplica la entrada física y crea la Compra
económica confirmada correspondiente.

**IMPLEMENTADO — compra directa sin OC (BRUNO POST-DEMO B):**

```text
Factura/documento → Nueva compra → Revisar → Confirmar → Entrada física
```

Este flujo cubre adquisiciones presenciales o directas. Nueva compra reutiliza el
extractor documental existente, propone proveedor e ítems maestros y exige
revisión humana. Importar o aplicar sólo prepara el borrador; confirmar una V3
con `stockGestionadoPor: compra_directa` incrementa productos de forma atómica e
idempotente. Servicios y actividades no cambian stock. El acceso documental de
Inventario conduce a Nueva compra y Excel/CSV continúa siendo carga maestra.

V1/V2 no se migran ni cambian semántica. Una Compra V3 originada por Recepción
usa `stockGestionadoPor: recepcion` y nunca repite la entrada física. Desde
BRUNO C, confirmar una Compra directa de productos aplica el mismo núcleo
económico de adquisición que Recepción: mantiene Q/V, promedio, último costo y
ledger, sin modificar `costoBase`, margen o precio de venta.

### D. Costos

- **IMPLEMENTADO:** una Recepción congela datos de adquisición y actualiza
  autoritativamente stock, saldo de valor, `costoPromedio`, `ultimoCosto` y
  trazabilidad sin separar esos efectos transaccionales.
- **IMPLEMENTADO (BRUNO POST-DEMO C):** el saldo perpetuo versionado mantiene
  Q/V en Recepción, Compra directa, Venta, cancelación de Venta, consumo y
  devolución de materiales y ajustes físicos. El baseline legacy se inicializa
  de forma lazy y auditable, sin adquisiciones falsas ni migración masiva.
- **IMPLEMENTADO:** `costoBase` (manual/comercial), `costoPromedio` (V/Q),
  `ultimoCosto` (última adquisición vigente demostrable), ledger histórico y
  costo congelado de Venta/Proyecto son conceptos distintos. No se mezclan
  monedas ni se inventa FX.
- **IMPLEMENTADO:** la revisión documental de Recepción muestra
  Neto, impuesto/IVA, tasa y Total cuando existen.
- **CONFIRMADO PENDIENTE:** uniformar la presentación tributaria en todos los
  resúmenes y detalles pertinentes. Reports V4 y la evolución comercial de
  margen permanecen fuera de este bloque.

### E. Ventas y margen comercial

- **IMPLEMENTADO:** una Venta confirmada congela el costo histórico disponible
  de sus productos aunque no tenga Proyecto.
- **CONFIRMADO PENDIENTE:** calcular y presentar margen comercial de Ventas sin
  exigir asociación a Proyecto.
- **PENDIENTE DE DISEÑO:** tratamiento de efectos legacy sin costo congelado y
  regla de agregación que evite contabilizar dos veces la misma Venta cuando
  también forme parte del resultado de un Proyecto.
- Nunca se define ganancia como `ventas - compras`.

### F. Proyectos y trabajos

- **IMPLEMENTADO:** ficha con nombre, cliente y cotización opcionales,
  responsable, participantes reales, prioridad y fechas; tareas con subtareas;
  HH, gastos, materiales, documentación textual y balance autoritativo.
- **CONFIRMADO PENDIENTE:** selector de cotización buscable, menor contaminación
  visual y separación clara entre ficha administrativa/comercial y operación.
- **CONFIRMADO PENDIENTE:** el tablero se abrirá para un Proyecto y mostrará sus
  tareas. El tablero vigente de `/trabajos` todavía representa Proyectos como
  tarjetas.
- **CONFIRMADO PENDIENTE:** distinguir costos internos no facturables de
  materiales/adicionales facturables solicitados por cliente.
- **CONFIRMADO PENDIENTE:** un adicional facturable consumirá stock e
  incrementará el cobro asociado; HH, comida, combustible y gastos internos no
  se cobrarán automáticamente.
- **PENDIENTE DE DISEÑO:** cómo modificar el cobro/Cotización/Venta sin duplicar
  documentos, ingresos, costos ni movimientos.
- **CONFIRMADO PENDIENTE:** un gasto interno conservará evidencia/boleta y
  autoría. Storage, retención, permisos y contrato documental no están definidos.
- Ningún PDF propio se denomina “factura electrónica” sin integración tributaria
  oficial.

### G. Reportes

- **IMPLEMENTADO:** Ventas confirmadas, Compras confirmadas y
  resultado/rentabilidad autoritativa de Proyectos, separados por moneda y
  permisos.
- **CONFIRMADO PENDIENTE:** distinguir ingresos, gastos, margen comercial y
  resultado/rentabilidad de Proyectos, incluyendo métricas útiles para Ventas sin
  Proyecto.
- **PENDIENTE DE DISEÑO:** semántica exacta de ingresos y gastos frente a
  documentos confirmados, pagos y movimientos financieros.
- Reportes sigue siendo resumen operacional; no es contabilidad formal ni SII.

### H. IA de cotizaciones

- **FUTURO/EXPERIMENTAL:** recuperar un flujo donde el usuario describe un
  trabajo, la IA propone líneas y el usuario acepta o rechaza.
- **FUTURO/EXPERIMENTAL:** un producto nuevo aceptado podría incorporarse al
  catálogo con stock cero.
- **FUTURO/EXPERIMENTAL:** investigar un modelo donde cada cliente aporte su
  credencial, cuota o tokens del proveedor IA.
- No se aprueba todavía un proveedor, una API ni la idea de “abrir su Codex” como
  arquitectura. La IA no vuelve al flujo principal del MVP en esta etapa.

### I. Vertical automotriz

- **CONFIRMADO PENDIENTE:** para rubros de automotriz/movilidad, Proyectos y
  trabajos evolucionará conceptualmente a Taller.
- El flujo objetivo es:

```text
Cliente → Vehículo → patente/VIN/datos → historial/ficha
→ ingreso al taller → diagnóstico → tareas/reparaciones
→ repuestos/materiales → HH/gastos → adicionales
→ costo/cobro final → pago/entrega
```

- El esquema Firestore, estados, permisos, documentos y UX quedan pendientes de
  diseño. Esta confirmación no autoriza implementar ni duplicar todavía el
  modelo genérico de Proyectos.

## 5. Mapa de flujos principales

```text
Carga maestra: Excel/CSV → revisión → Inventario

Abastecimiento planificado:
Orden de compra → Recepción acotada a pendiente → stock + Compra económica

Adquisición directa:
Factura/documento → Nueva compra → revisión → confirmación → stock

Venta:
Venta confirmada → ingreso comercial + costo histórico de productos
                  ↘ Proyecto opcional, sin doble contabilización

Proyecto:
Ficha administrativa → tareas/subtareas → costos/materiales/adicionales
→ resultado de Proyecto
```

## 6. Resumen por estado

### Implementado

- Arquitectura multiempresa, membresías autoritativas y operaciones sensibles en
  backend.
- Catálogo/stock, barcode y carga inicial tabular.
- Flujo OC → Recepción → Compra, con restricciones y trazabilidad.
- Compra directa V3 con importación documental, revisión humana, entrada física
  y adquisición económica confirmada sin alterar `costoBase`.
- Saldo perpetuo Q/V, baseline legacy lazy, promedio/último costo, ledger
  auditable y costos históricos congelados de Ventas/Proyectos.
- Ventas con costo histórico congelado cuando está disponible.
- Proyectos con equipo, tareas/subtareas, costos, materiales y balance.
- Reportes actuales de Ventas, Compras y Proyectos.
- Gate `VERIFICADA` y evidencia segura de Platform Admin.
- Activación reactiva sin F5 y navegación de tarjetas Platform Admin.
- Generación exclusiva del código interno en alta manual, preservando códigos
  legacy y compatibilidad de cargas maestras.

### Confirmado pendiente

- QA móvil HTTPS del scanner por cámara.
- Margen comercial y evolución de Reportes.
- UX/tablero por Proyecto, adicionales facturables y evidencia de gastos.
- Vertical Taller para automotriz/movilidad.

### Futuro/experimental

- Asistencia IA para proponer líneas de cotización.
- Alta opcional de productos sugeridos con stock cero.
- Credenciales/cuotas/tokens de IA aportados por cada cliente.

## 7. Invariantes que no deben romperse

- Los datos operacionales permanecen bajo `negocios/{businessId}/...`.
- La autoridad es una membresía activa; `negocioActivoId` sólo da contexto.
- Functions revalida operaciones sensibles y Rules no sustituye esa autoridad.
- No existe acceso cruzado entre empresas ni acceso cliente a colecciones
  internas.
- No se eliminan físicamente registros referenciados ni se reescribe historia.
- Snapshots, movimientos, adquisiciones y eventos históricos se conservan.
- Stock sólo cambia por una operación física autoritativa, transaccional e
  idempotente.
- Código interno y barcode siguen siendo conceptos distintos.
- No se mezclan monedas ni se inventa conversión FX.
- Reportes no usa `ventas - compras` como ganancia.
- No se amplía ni elimina IA existente sin autorización.
- Compatibilidad legacy se mantiene mediante adaptadores cuando corresponda.

## 8. Orden sugerido de implementación

1. Validar en QA la activación reactiva sin F5 y la navegación de tarjetas
   Platform Admin, conservando la evidencia segura ya existente.
2. Validar en QA Compra directa V3 con importador documental y entrada física,
   preservando la compatibilidad de cargas maestras y el flujo con OC.
3. Implementar margen comercial de Ventas y luego ampliar Reports V4 con reglas
   explícitas contra doble contabilización.
4. Simplificar Proyectos y construir Projects V3/tablero por Proyecto.
5. Diseñar adicionales facturables y evidencia de gastos antes de persistirlos.
6. Diseñar la vertical Taller reutilizando invariantes comunes sin fijar todavía
   un esquema prematuro.
7. Evaluar IA de cotizaciones únicamente como investigación separada después del
   flujo ERP principal.
