# Proveedores MVP

## Enmienda multipaís pre-V1

Desde el modelo 2, los proveedores nuevos persisten `paisCodigo`,
`identificadorFiscalTipo`, `identificadorFiscalValor` e
`identificadorFiscalNormalizado`. Functions deriva el país del negocio
autorizado, no del payload ni de su moneda: CL valida RUT, BO NIT, BR CPF/CNPJ,
PE RUC y los demás países una identificación fiscal genérica.

La unicidad sigue siendo por negocio en `providerRutKeys`, nombre interno
conservado por compatibilidad con Rules y reservas. Los documentos modelo 1 con
`rut`/`rutNormalizado` continúan operables sin migración. Las secciones RUT
siguientes aplican a CL/legacy; para documentos nuevos prevalece esta enmienda.

## Enmienda 2026-11-05: eliminación permanente y roles vigentes

Motivo: poder quitar proveedores creados por error o duplicados que
nunca se usaron, sin dejar basura en el listado ni un RUT reservado para
siempre. Archivar sigue disponible y es la vía para proveedores con historia.
Esta enmienda reemplaza únicamente los puntos que se indican; el resto de la
SPEC y sus invariantes siguen vigentes (AGENTS.md y SPEC 016: no se eliminan
físicamente registros referenciados ni se reescribe historia).

- **Reemplaza** «No existe eliminación física» (sección Modelo Firestore) y el
  criterio de aceptación «No existen eliminaciones físicas…». Ahora existe una
  única vía de eliminación física, la Function `eliminarProveedor`, y solo para
  un proveedor sin movimientos.
- **Roles (corrige la redacción original, que estaba desactualizada)**: crean,
  editan, archivan y reactivan `OWNER`, `ADMIN` y `COMPRAS`
  (`PURCHASE_WRITE_ROLES`). Eliminan permanentemente solo `OWNER` y `ADMIN`
  (`BUSINESS_MANAGEMENT_ROLES`). El rol se valida en el servidor; la interfaz
  solo oculta el botón.
- **`eliminarProveedor`**: exige negocio verificado, membresía activa de
  `OWNER`/`ADMIN` y que el usuario escriba la palabra «permanente» (validada
  también en el backend). Una sola transacción lee el proveedor, su reserva
  fiscal y las dependencias, y si no hay ninguna borra el documento, libera la
  reserva en `providerRutKeys` y retira sus solicitudes en
  `providerCreateRequests`. El RUT queda libre para volver a registrarse.
- **Dependencias que bloquean** (se buscan por `proveedorId` y por el id dentro
  de `proveedorSnapshot`, porque los documentos antiguos pueden traer solo uno):
  `ordenesCompra`, `compras`, `recepciones` y `adquisicionesInventario`; y en
  `inventario`, `ultimoProveedor.proveedorId`. Cualquier estado cuenta (también
  borradores). Si hay alguna, la Function responde `failed-precondition` con
  la cantidad por tipo («…tiene movimientos: 2 órdenes de compra, 1 compra.
  Archívalo para dejar de usarlo.») y no borra nada. Los textos libres
  `proveedorNombre`/`proveedorRut` del inventario no son referencias y no
  bloquean.
- **Carrera**: las Functions que crean órdenes de compra y compras leen el
  documento del proveedor dentro de su propia transacción, de modo que
  Firestore serializa esas operaciones con el borrado: o gana la creación y el
  borrado se rechaza, o gana el borrado y la creación falla con «No se
  encontró el proveedor». No puede quedar un documento apuntando a un
  proveedor inexistente.
- **Interfaz**: botón «Eliminar permanentemente» en proveedores activos y
  archivados, visible solo para `OWNER` y `ADMIN`, con diálogo que pide escribir
  «permanente». El filtro Estado de la lista parte en «Activos».
- No cambian las Rules (`delete` directo sigue denegado) ni los índices
  (consultas de igualdad sobre un campo).

## Objetivo

Administrar proveedores registrados por empresa con aislamiento multiempresa, RUT chileno único dentro de cada negocio, persistencia autoritativa y archivado lógico. El módulo deja definido el contrato que podrán consumir posteriormente Órdenes de Compra, Compras e Inventario, sin implementar todavía esos flujos.

## Modelo Firestore

Colección operacional:

```text
negocios/{businessId}/proveedores/{proveedorId}
```

`proveedorId` es el único identificador canónico. No se persiste `supplierId` como alias.

Campos editables:

- `rut`;
- `razonSocial`;
- `nombreFantasia`;
- `giro`;
- `personaContacto`;
- `email`;
- `telefono`;
- `direccion`;
- `regionCodigo` y `regionNombre`;
- `comunaCodigo` y `comunaNombre`;
- `condicionesPago`;
- `diasCredito`;
- `notas`.

Campos autoritativos:

- `modeloProveedorVersion`;
- `proveedorId`;
- `negocioId`;
- `rutNormalizado`;
- `estado`;
- `creadoPorUid` y `actualizadoPorUid`;
- `creadoEn`, `actualizadoEn` y `archivadoEn`.

Los estados admitidos son `activo` y `archivado`. La eliminación física solo existe como `eliminarProveedor` para proveedores sin movimientos (enmienda 2026-11-05).

## RUT único y reservas

La reserva interna vive en:

```text
negocios/{businessId}/providerRutKeys/{rutNormalizadoSinGuion}
```

La reserva es independiente de `clientRutKeys`: un cliente y un proveedor del mismo negocio pueden compartir RUT. El mismo proveedor no puede duplicarse dentro de un negocio, incluso cuando está archivado, pero el mismo RUT sí puede existir como proveedor en negocios diferentes.

Crear y cambiar RUT se ejecutan mediante transacciones. Al cambiarlo se reserva el nuevo, se actualiza el proveedor y se libera el anterior atómicamente. Archivar conserva la reserva; un intento de crear con ese RUT orienta a reactivar el registro existente.

Los reintentos de creación usan una solicitud interna:

```text
negocios/{businessId}/providerCreateRequests/{requestId}
```

Una misma solicitud y payload devuelven el proveedor ya creado. Solicitudes concurrentes distintas para el mismo RUT quedan serializadas por `providerRutKeys`, por lo que sólo una puede crear.

## Roles y autoridad

Los miembros activos con rol `OWNER`, `ADMIN`, `COMPRAS` o `MEMBER` pueden leer proveedores del negocio autorizado. Sólo `OWNER`, `ADMIN` y `COMPRAS` pueden (enmienda 2026-11-05):

- crear;
- editar;
- archivar;
- reactivar.

Sólo `OWNER` y `ADMIN` pueden además eliminar permanentemente un proveedor sin movimientos.

Las escrituras se realizan exclusivamente mediante las Functions:

- `crearProveedor`;
- `actualizarProveedor`;
- `archivarProveedor`;
- `reactivarProveedor`;
- `eliminarProveedor`.

Cada operación valida autenticación, `businessId`, membresía activa, negocio activo y rol. `negocioActivoId` sólo selecciona contexto de navegación y nunca concede autoridad.

Functions valida una lista cerrada de campos editables, deriva `negocioId`, estado, identidad y auditoría, y vuelve a validar RUT, correo, teléfono, días de crédito y territorio. Los nombres de región y comuna se obtienen desde `businessCatalog.json`; los nombres enviados por el navegador no son autoritativos.

## Firestore Rules

Las Rules permiten leer `proveedores` únicamente a miembros activos cuando el documento declara el mismo `negocioId`. Crear, modificar o eliminar documentos operacionales directamente desde el SDK cliente está denegado.

`providerRutKeys` y `providerCreateRequests` son colecciones internas: lectura, consultas, creación, actualización y eliminación directas están denegadas. El catch-all del negocio permanece cerrado.

## Servicio frontend

`providerService.js` consulta exclusivamente:

```text
negocios/{businessId}/proveedores
```

La consulta incluye `where("negocioId", "==", businessId)` y ordena localmente por razón social para no exigir índices adicionales. El servicio no accede a reservas internas ni construye campos autoritativos.

La administración limpia la lista al iniciar una carga y usa una secuencia de solicitud: una respuesta tardía del negocio A no puede sobrescribir los proveedores del negocio B.

## Interfaz

La ruta `/proveedores`, ubicada bajo Comercial junto a Clientes, permite:

- listar proveedores;
- buscar por razón social, nombre de fantasía o RUT;
- filtrar activos y archivados (parte en Activos);
- crear y editar;
- archivar y reactivar;
- eliminar permanentemente un proveedor sin movimientos (`OWNER` y `ADMIN`).

En escritorio se muestran las columnas Proveedor, Contacto, Ubicación, Condiciones, Estado y Acciones. En móvil se usan tarjetas sin tabla ni scroll horizontal. `MEMBER` ve un aviso de solo lectura y no recibe controles de escritura.

El formulario usa el catálogo territorial vigente. Cambiar región limpia la comuna, los errores se muestran junto al campo y el primer campo inválido recibe foco. El diálogo incluye foco inicial, Escape, scroll interno y restauración de foco mediante `ResponsiveDialog`. Un error backend conserva los datos ingresados.

Las condiciones de pago admiten `contado`, `transferencia`, `credito` y `otro`. `diasCredito` es un entero mayor o igual a cero y sólo se habilita en el formulario cuando la condición es crédito. No se calculan vencimientos ni se agrega lógica contable.

## Integración futura

Órdenes de Compra deberán guardar:

```text
proveedorId + snapshot histórico del proveedor
```

El snapshot deberá construirse autoritativamente desde el proveedor vivo al crear el documento, siguiendo el patrón Clientes–Cotizaciones. Editar o archivar un proveedor no deberá modificar documentos históricos, y un proveedor archivado deberá seguir visible mediante el snapshot guardado.

Este MVP no implementa Órdenes de Compra, compras, pagos, facturas, cuentas por pagar, recepción ni movimientos de inventario.

## Pruebas

`provider-model-smoke.mjs` cubre:

- formato, normalización, clave y DV del RUT;
- campos requeridos;
- correo y teléfono;
- días de crédito;
- región y comuna;
- búsqueda por nombre, fantasía y RUT;
- payload exclusivamente editable;
- `proveedorId` canónico;
- permisos UI y contrato estructural.

`providers-integrated-local.mjs` cubre:

- creación por `OWNER` y `ADMIN`;
- rechazo de `MEMBER` y usuarios de otro negocio;
- lectura de `MEMBER`;
- territorio autoritativo;
- RUT duplicado y concurrencia;
- mismo RUT compartido por un cliente y un proveedor del negocio;
- mismo RUT en negocios diferentes;
- reintento idempotente de creación;
- edición sin cambiar RUT;
- cambio de RUT y liberación del anterior;
- archivado, reactivación e idempotencia;
- bloqueo cross-business;
- bloqueo de escritura directa;
- inaccesibilidad de reservas y solicitudes internas.

`provider-delete-integrated-local.mjs` (emulador) cubre `eliminarProveedor`:

- borrado de un proveedor activo y de uno archivado sin movimientos;
- liberación de la reserva y de la solicitud de creación, y reutilización del RUT;
- rechazo de `COMPRAS`, `MEMBER`, usuarios de otro negocio, palabra de confirmación ausente o incorrecta, id inválido, proveedor inexistente y SDK cliente;
- rechazo con cada dependencia (id directo e id en el snapshot), con su cantidad y sin borrar nada;
- aislamiento entre negocios;
- carrera entre crear una orden de compra y eliminar el proveedor, sin órdenes huérfanas.

## Criterios de aceptación

- `/proveedores` funciona para los tres roles de lectura.
- `OWNER`, `ADMIN` y `COMPRAS` administran; `MEMBER` sólo consulta. Sólo `OWNER` y `ADMIN` eliminan.
- RUT se valida y reserva por negocio mediante Functions.
- Un proveedor archivado conserva su RUT y puede reactivarse.
- La única eliminación física es `eliminarProveedor` (sin movimientos, `OWNER`/`ADMIN`, con confirmación); no hay accesos directos a colecciones internas ni escrituras directas desde el cliente.
- La interfaz presenta estados de carga, error, vacío y filtros.
- La lista usa tabla en escritorio y tarjetas en móvil.
- No se implementan módulos de compras u órdenes de compra.
- Smokes, Rules, build y lint pasan sin regresiones.
