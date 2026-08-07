# Proveedores MVP

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

Los estados admitidos son `activo` y `archivado`. No existe eliminación física.

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

Los miembros activos con rol `OWNER`, `ADMIN` o `MEMBER` pueden leer proveedores del negocio autorizado. Sólo `OWNER` y `ADMIN` pueden:

- crear;
- editar;
- archivar;
- reactivar.

Las escrituras se realizan exclusivamente mediante las Functions:

- `crearProveedor`;
- `actualizarProveedor`;
- `archivarProveedor`;
- `reactivarProveedor`.

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
- filtrar activos y archivados;
- crear y editar;
- archivar y reactivar.

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

## Criterios de aceptación

- `/proveedores` funciona para los tres roles de lectura.
- `OWNER` y `ADMIN` administran; `MEMBER` sólo consulta.
- RUT se valida y reserva por negocio mediante Functions.
- Un proveedor archivado conserva su RUT y puede reactivarse.
- No existen eliminaciones físicas ni accesos directos a colecciones internas.
- La interfaz presenta estados de carga, error, vacío y filtros.
- La lista usa tabla en escritorio y tarjetas en móvil.
- No se implementan módulos de compras u órdenes de compra.
- Smokes, Rules, build y lint pasan sin regresiones.
