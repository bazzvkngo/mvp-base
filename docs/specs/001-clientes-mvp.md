# Objetivo

Administrar clientes registrados por empresa y utilizarlos posteriormente en cotizaciones, ventas y reportes.

# Estado

- Etapas 1, 2 y 3 terminadas.
- Dominio, Cloud Functions, reglas de Firestore, servicio, interfaz y pruebas implementadas.
- Flujo de administración verificado manualmente con rol `OWNER`.
- Integración autoritativa con Cotizaciones terminada.

# Modelo Firestore

Colección operacional:

```text
negocios/{businessId}/clientes/{clienteId}
```

Campos:

- `modeloClienteVersion`
- `clienteId`
- `negocioId`
- `tipoCliente`
- `rut`
- `rutNormalizado`
- `nombreRazonSocial`
- `giro`
- `email`
- `telefono`
- `direccion`
- `regionCodigo`
- `regionNombre`
- `comunaCodigo`
- `comunaNombre`
- `personaContacto`
- `notas`
- `estado`
- `creadoPorUid`
- `actualizadoPorUid`
- `creadoEn`
- `actualizadoEn`
- `archivadoEn`

Colección interna de reservas:

```text
negocios/{businessId}/clientRutKeys/{rutNormalizado}
```

Esta colección impide RUT duplicados dentro de una empresa. Se administra mediante transacciones y no es accesible desde el SDK cliente. La reserva se mantiene al archivar; cuando el RUT cambia correctamente, el nuevo se reserva y el anterior se libera dentro de la misma transacción.

# Identificador canónico

- El campo persistido es `clienteId`.
- `clientId` solo puede leerse mediante adaptadores como compatibilidad legacy.
- Los documentos nuevos no deben guardar ambos nombres.

# Permisos

Pueden leer clientes los miembros activos con rol:

- `OWNER`;
- `ADMIN`;
- `MEMBER`.

Las escrituras se realizan exclusivamente mediante Cloud Functions. Solo `OWNER` y `ADMIN` pueden crear, actualizar, archivar o reactivar clientes. Un usuario sin membresía activa no tiene acceso.

No existe eliminación física de clientes.

# Operaciones

Las operaciones disponibles son:

- `crearCliente`;
- `actualizarCliente`;
- `archivarCliente`;
- `reactivarCliente`.

Cada operación valida autenticación, membresía activa, existencia y estado activo del negocio, `businessId` y rol autorizado. El backend usa una lista cerrada de campos, valida y normaliza el RUT, genera timestamps de servidor y ejecuta las modificaciones relacionadas con reservas dentro de transacciones atómicas.

Archivar y reactivar son idempotentes cuando cliente y reserva ya tienen el estado solicitado: responden con `sinCambios: true` y no reescriben documentos. Una inconsistencia entre el cliente y su reserva produce `failed-precondition` sin escrituras parciales.

# Contrato frontend

`clientService.js` construye los datos editables con:

```js
buildClientMutationPayload(raw)
```

El payload contiene exclusivamente:

- `tipoCliente`
- `rut`
- `nombreRazonSocial`
- `giro`
- `email`
- `telefono`
- `direccion`
- `regionCodigo`
- `regionNombre`
- `comunaCodigo`
- `comunaNombre`
- `personaContacto`
- `notas`

Nunca debe enviar `modeloClienteVersion`, `rutNormalizado`, `estado`, `clienteId`, `negocioId` ni campos de auditoría. Estos valores son autoritativos del backend.

# Consulta

La lectura de la colección debe incluir:

```js
where("negocioId", "==", businessId)
```

Firestore Rules no funciona como filtro. Una consulta sin una condición que garantice los permisos puede ser rechazada aunque los documentos existentes parezcan válidos.

# Interfaz

- Ruta `/clientes` y opción Clientes en la navegación.
- Lista y búsqueda por nombre o RUT.
- Creación, edición, archivado y reactivación.
- Estados activo y archivado.
- Vista de solo lectura para `MEMBER`.
- Estados de carga, vacío, error y permisos.
- Diseño responsive y accesible coherente con los estilos interiores.

# Integración con cotizaciones

- Una cotización nueva exige seleccionar un cliente activo registrado.
- El frontend envía `clienteId`; Functions lee el cliente dentro del negocio autorizado y construye el snapshot histórico.
- Se persisten `clienteId` y los datos históricos relevantes sin confiar en un snapshot enviado por el frontend.
- Editar o archivar el cliente no modifica cotizaciones anteriores.
- Al editar un borrador, mantener el mismo cliente conserva el snapshot; cambiarlo explícitamente obtiene uno nuevo.
- Las cotizaciones legacy sin `clienteId` siguen siendo válidas, editables y se muestran como cliente histórico no vinculado.
- La especificación detallada está en `docs/specs/002-clientes-cotizaciones.md`.

# Pendientes conocidos

- Definir formalmente la política para RUT con cuerpos inferiores a siete dígitos. La validación actual admite cuerpos de siete u ocho dígitos.
- Completar una revisión manual responsive y de accesibilidad en los anchos objetivo del proyecto.

# Pruebas ya cubiertas

- RUT válido e inválido y normalización.
- Creación por `OWNER` y `ADMIN`.
- Rechazo de `MEMBER` y usuarios sin membresía.
- Aislamiento multiempresa.
- Duplicidad y creación concurrente con el mismo RUT.
- Edición sin cambiar RUT y cambio de RUT con liberación de la reserva anterior.
- Detección de reservas corruptas sin escrituras parciales.
- Archivado, reactivación e idempotencia válida.
- Escrituras directas a clientes bloqueadas.
- Lectura y escritura de `clientRutKeys` bloqueadas, incluidas consultas.
- Catch-all de subcolecciones desconocidas cerrado.
- Payload frontend permitido.
- Rechazo de campos desconocidos y autoritativos enviados por el cliente.
- Selección de clientes activos por nombre o RUT con aislamiento por negocio.
- Rechazo de cotizaciones nuevas sin cliente, con cliente inexistente, archivado o de otro negocio.
- Snapshot de cliente construido por Functions e independiente de ediciones posteriores.
- Conservación del snapshot al editar con el mismo cliente, incluso si fue archivado.
- Renovación del snapshot solo ante un cambio explícito de cliente.
- Edición de cotizaciones legacy sin migración automática.

# Criterios de aceptación final

El alcance funcional de Clientes y su integración con Cotizaciones está implementado. Quedan como decisiones o verificaciones finales:

- cerrar la política formal de RUT indicada arriba;
- completar la revisión manual responsive y de accesibilidad;
- ejecutar la validación manual de roles adicionales cuando forme parte del protocolo de aceptación.
