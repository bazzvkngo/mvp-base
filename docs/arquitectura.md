# Arquitectura de ValoraCloud

## Propósito y estado

ValoraCloud es un ERP SaaS multiempresa construido con React, Vite, Firebase
Authentication, Cloud Firestore, Firebase Storage y Cloud Functions. El flujo
principal del MVP es empresarial y no depende de inteligencia artificial.

Este documento describe la arquitectura implementada. La evolución de producto
confirmada después de la demostración con Bruno se clasifica en la
[`SPEC 016`](specs/016-vision-post-demo-bruno.md); sus objetivos pendientes no
forman parte de la arquitectura actual hasta ser diseñados, implementados y
validados. Las SPEC específicas conservan el detalle funcional y la
compatibilidad legacy.

## Componentes

```text
Navegador
  React + Vite
    Firebase Authentication
    Cloud Firestore
    Firebase Storage
    Cloud Functions 2nd Gen
      Gemini API, sólo en asistentes/importadores existentes
      Resend
      Cloud Scheduler

Contexto separado de plataforma
  Platform Admin
    Cloud Functions + Firebase Admin SDK
```

El frontend accede a las colecciones operacionales permitidas por Firestore
Rules y a rutas acotadas de Storage. Las operaciones sensibles, los secretos,
las mutaciones autoritativas y las consultas globales de plataforma se ejecutan
en Functions. Las Rules son defensa adicional y no sustituyen la autorización
del backend.

## Organización del frontend

```text
src/
  app/          Configuración de rutas y protección de sesión.
  components/   Componentes reutilizables.
  domain/       Reglas, cálculos y adaptadores sin dependencia de React.
  features/     Formularios y módulos del negocio.
  firebase/     SDK cliente y construcción centralizada de rutas.
  layout/       Navegación y estructura visual común.
  pages/        Pantallas de cada ruta.
  platform/     Interfaz separada de Platform Admin.
  services/     Firestore, Storage, Authentication y Functions.
  styles/       Estilos globales y layout.
  utils/        Formateadores y generación de documentos.
```

`pages` orquesta cada pantalla; `features` implementa la interacción;
`services` encapsula infraestructura; `domain` mantiene reglas compartidas.

## Identidad, empresa y autorización

Firebase Authentication gestiona la identidad. La autorización ERP se resuelve
con una membresía activa de ID determinista:

```text
membresias/{businessId}__{uid}
```

`negocioActivoId` selecciona el contexto de navegación, pero no concede acceso.
Functions vuelve a validar identidad, membresía, estado del negocio, rol o
perfil y `businessId` en cada operación sensible. El modelo vigente incluye los
perfiles protegidos `OWNER`, `ADMIN`, `VENTAS`, `COMPRAS`, `TECNICO`, `FINANZAS`
y `MEMBER`; un `MEMBER` puede usar un perfil personalizado por módulos guardado
en `negocios/{businessId}/perfilesEmpleados`. El perfil complementa la
membresía, nunca la reemplaza.

El correo verificado se muestra, pero `email_verified` no es actualmente una
condición general de acceso. Una cuenta o negocio suspendido, una membresía
inactiva o la falta de permiso impiden operar aunque el frontend conserve un
contexto previo.

## Modelo multiempresa

Los datos operacionales canónicos viven bajo la empresa:

```text
usuarios/{uid}                                identidad y preferencias personales
negocios/{businessId}                         raíz y estado empresarial
negocios/{businessId}/empresa/perfil          perfil comercial y fiscal
negocios/{businessId}/inventario/{itemId}
negocios/{businessId}/clientes/{clienteId}
negocios/{businessId}/proveedores/{proveedorId}
negocios/{businessId}/cotizaciones/{cotizacionId}
negocios/{businessId}/ordenesCompra/{ordenCompraId}
negocios/{businessId}/recepciones/{recepcionId}
negocios/{businessId}/compras/{compraId}
negocios/{businessId}/ventas/{ventaId}
negocios/{businessId}/trabajos/{trabajoId}
negocios/{businessId}/movimientosInventario/{movimientoId}
negocios/{businessId}/adquisicionesInventario/{adquisicionId}
```

Contadores, reservas, claves únicas, solicitudes idempotentes y otras
colecciones internas también se segmentan por `businessId` y permanecen
cerradas al SDK cliente. Algunas rutas históricas bajo `usuarios/{uid}` se
conservan mediante adaptadores de compatibilidad; no son el modelo canónico ni
una fuente alternativa de autorización.

No se permite acceso cruzado entre empresas ni eliminación física de registros
referenciados. Los cambios de estado son lógicos cuando el historial debe
preservarse.

## Verificación empresarial y Platform Admin

La verificación vive en `negocios/{businessId}.verificacionEmpresa`. Para el ERP
normal, el gate `VERIFICADA` se aplica además de la membresía y los permisos; el
contexto no verificado queda limitado al onboarding, configuración y solicitud
de verificación que correspondan. `getBusinessSession` resuelve el estado
empresarial al cargar o revalidar la sesión. Una sesión ERP abierta observa la
transición a `VERIFICADA` mediante el listener empresarial existente, revalida
`businessSession`, habilita los módulos y notifica al usuario sin F5 ni polling
permanente.

Solicitudes, decisiones y eventos de verificación son autoritativos. La
evidencia opcional realmente implementada se limita a PDF, JPG o PNG en una ruta
inmutable de Storage:

```text
negocios/{businessId}/verificacion/{ownerUid}/{requestId}/...
```

Platform Admin es un contexto separado del ERP. Su autoridad proviene del
custom claim firmado `platformRole: "PLATFORM_SUPERADMIN"`, nunca de una
membresía. Los directorios, detalles, suspensiones y resoluciones pasan por
Functions; la evidencia se abre con una URL firmada temporal, sin dar acceso
global del SDK a Firestore o Storage.

## Módulos operacionales actuales

- **Inventario:** catálogo de productos, servicios y actividades, stock de
  productos, códigos internos, barcode, áreas/categorías, carga inicial
  Excel/CSV y trazabilidad de movimientos y adquisiciones.
- **Ventas:** venta directa o desde cotización, snapshots de cliente e ítems,
  totales, costo histórico disponible, salida de stock de productos e
  idempotencia transaccional.
- **Abastecimiento:** proveedores, Órdenes de Compra, Recepciones y Compras. La
  OC no mueve stock; una Recepción confirmada y acotada a lo pendiente aplica
  la entrada física y crea su Compra V3 económica marcada como gestionada por
  Recepción. Una Compra directa V3 aplica la entrada de productos únicamente al
  confirmar; crear, editar o importar su factura sólo prepara un borrador.
- **Proyectos/Trabajos:** ficha, responsables y participantes, tareas y
  subtareas, horas, gastos, materiales, documentación textual e indicadores de
  balance según su contrato actual.
- **Reportes:** resúmenes operacionales implementados de Ventas, Compras y
  resultado/rentabilidad de Proyectos, separados por moneda y permiso. No son
  contabilidad formal ni integración tributaria.

Los cambios de experiencia de Proyectos, la ampliación de
costos/margen/reportes y los demás objetivos post-demo que la SPEC 016 todavía
clasifica como pendientes no se describen aquí como arquitectura existente.

## Stock, snapshots e idempotencia

El stock sólo cambia mediante operaciones físicas autoritativas y
transaccionales: confirmación de Recepción, confirmación de Venta, consumo o
devolución de materiales en Trabajos, confirmación de Compra directa V3, ajustes
autorizados y compatibilidad explícita con documentos legacy. Una OC, un
borrador y una vista previa de importación no modifican stock. Una Compra V3
marcada `stockGestionadoPor: recepcion` tampoco repite la entrada ya aplicada.

Para productos inicializados en el modelo económico versionado, cada mutación
de stock mantiene conjuntamente cantidad (`stock`) y saldo perpetuo de valor
(`valorInventario`) en una única moneda; `costoPromedio` se deriva como valor
dividido por cantidad. Los productos legacy se inicializan de forma lazy desde
su promedio válido o desde el fallback de costo histórico, guardando metadata
del baseline sin inventar adquisiciones. Recepción y Compra directa crean
adquisiciones; Ventas y materiales de Trabajos descuentan y reponen el mismo
costo congelado. Los ajustes físicos conservan el promedio vigente. Functions
bloquea saldos negativos, residuos de valor con stock cero y mezcla de monedas.
`costoBase` continúa siendo el costo comercial/manual del maestro y no equivale
al promedio, al último costo, al ledger de adquisiciones ni al snapshot histórico
de una Venta o Trabajo.

Cotizaciones, Órdenes de Compra, Recepciones, Compras, Ventas y Trabajos
conservan los snapshots históricos definidos por sus SPEC. Contadores
transaccionales, `requestId`, registros de solicitud, IDs deterministas y
estados finales evitan duplicar números, movimientos o efectos cuando el
contrato de cada operación así lo define. La historia se adapta en lectura; no
se reescribe desde maestros actuales.

## Documentos, evidencia e integraciones

- Los documentos comerciales imprimibles se generan desde snapshots de la
  aplicación; no equivalen a factura electrónica ni acreditan integración SII.
- El importador documental existente acepta PDF e imágenes acotadas, las valida
  y las procesa temporalmente mediante `normalizeInventoryDocument` y Gemini
  multimodal. El archivo fuente viaja en Base64 y no se persiste en Firestore ni
  Storage. No existe OCR local.
- En Recepciones, el resultado documental es sólo una propuesta editable
  reconciliada con la OC; el Base64 se descarta y únicamente pueden persistirse
  metadatos sanitizados al guardar el borrador.
- En Nueva compra, el mismo extractor propone proveedor, líneas y datos
  tributarios. El usuario debe vincular maestros existentes; aplicar la factura
  sólo completa el borrador y confirmar mantiene la autoridad de stock en
  Functions.
- La evidencia binaria persistida actualmente corresponde a la verificación
  empresarial. La documentación de Trabajos vigente es textual; la evidencia
  de gastos post-demo sigue pendiente de diseño.
- Los logos empresariales nuevos usan la ruta por negocio en Storage. La ruta
  histórica por usuario se conserva sólo como compatibilidad.
- Gemini permanece limitado a los asistentes/importadores ya existentes y no
  es requisito del flujo principal. Resend se usa desde Functions para el envío
  de correo implementado. Sus secretos nunca se exponen al frontend.

## Seguridad y privacidad técnica

- Firestore y Storage aíslan datos por negocio y deniegan rutas no previstas.
- Functions no confía en roles, snapshots, totales, estados o `businessId`
  construidos por el frontend como autoridad suficiente.
- Los índices, contadores, reservas, idempotencia y eventos internos no son
  accesibles mediante el SDK cliente.
- Platform Admin recibe DTO mínimos y no obtiene acceso global a las
  colecciones operacionales.
- Los archivos documentales enviados a Gemini se procesan temporalmente; Resend
  recibe sólo los datos necesarios para el correo solicitado.

El sistema puede almacenar identidad de usuarios, datos fiscales y comerciales,
clientes, proveedores, inventario y documentos operacionales. El repositorio no
define por sí solo política jurídica definitiva, retención, respaldo,
exportación, rectificación o eliminación física; esas decisiones requieren
definición organizacional antes de operar con datos reales.

## Despliegue y operación

Los archivos principales de configuración son `.firebaserc`, `firebase.json`,
`firestore.rules`, `storage.rules` y `functions/package.json`. El despliegue se
realiza con Firebase CLI después de las validaciones correspondientes. El código
local no confirma por sí solo el estado real de Functions, Rules, índices,
Scheduler, Storage o secretos desplegados.
