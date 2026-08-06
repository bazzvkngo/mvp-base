# Objetivo

Administrar clientes registrados por empresa y utilizarlos posteriormente en cotizaciones, ventas y reportes.

# Estado

- Etapas 1 y 2 terminadas.
- Dominio, Cloud Functions, reglas de Firestore y pruebas implementadas.
- Interfaz e integración con cotizaciones pendientes.

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

El futuro `clientService.js` debe construir los datos editables con:

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

# Consulta futura

La lectura de la colección debe incluir:

```js
where("negocioId", "==", businessId)
```

Firestore Rules no funciona como filtro. Una consulta sin una condición que garantice los permisos puede ser rechazada aunque los documentos existentes parezcan válidos.

# Interfaz pendiente

- Ruta `/clientes`.
- Opción Clientes en la navegación.
- Lista y búsqueda por nombre o RUT.
- Crear y editar.
- Archivar y reactivar.
- Estados activo y archivado.
- Vista de solo lectura para `MEMBER`.
- Estados de carga, vacío, error y permisos.
- Diseño responsive y accesible.

# Integración futura con cotizaciones

- Una cotización nueva debe seleccionar un cliente activo registrado.
- Debe guardar `clienteId`.
- Debe guardar un snapshot histórico de los datos relevantes del cliente.
- Editar un cliente no debe modificar cotizaciones anteriores.
- Las cotizaciones legacy sin `clienteId` siguen siendo válidas.
- Deben mostrar el cliente histórico como no vinculado cuando corresponda.

# Pendientes conocidos

- Validar región y comuna contra el catálogo existente.
- Reutilizar `functions/businessCatalog.json` y la abstracción frontend existente.
- Definir formalmente la política para RUT con cuerpos inferiores a siete dígitos. La validación actual admite cuerpos de siete u ocho dígitos.
- Implementar `clientService.js`.
- Implementar la interfaz.
- Integrar cotizaciones.

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

# Criterios de aceptación final

El módulo se considerará terminado cuando:

- la interfaz y el servicio estén implementados;
- `MEMBER` tenga modo de solo lectura;
- `OWNER` y `ADMIN` puedan administrar clientes;
- la validación de región y comuna esté conectada;
- la integración con cotizaciones conserve snapshots históricos;
- todos los smokes, build y lint pasen;
- se complete una revisión responsive y de accesibilidad.
