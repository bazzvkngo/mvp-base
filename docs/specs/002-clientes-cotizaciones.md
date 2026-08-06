# Objetivo

Vincular cotizaciones con clientes registrados sin perder el carácter histórico de los documentos comerciales.

# Alcance implementado

- Las cotizaciones nuevas requieren un cliente activo del negocio actual.
- El selector consulta `negocios/{businessId}/clientes`, filtra por `negocioId` y muestra únicamente clientes activos.
- La búsqueda tolerante encuentra clientes por nombre o RUT.
- El identificador persistido canónico es `clienteId`; `clientId` solo se admite al leer documentos legacy.
- El frontend envía `clienteId` y no envía como autoridad los datos del cliente.
- `createQuoteWithNumber` obtiene el cliente desde Firestore dentro de la misma transacción que crea la cotización.
- La cotización guarda un snapshot histórico con nombre o razón social, RUT, correo, teléfono, dirección y los demás campos de identificación disponibles.

# Autoridad y aislamiento

Functions valida el acceso al negocio mediante la membresía existente. El documento seleccionado debe:

- existir en `negocios/{businessId}/clientes/{clienteId}`;
- declarar el mismo `negocioId` y `clienteId`;
- tener estado `activo` al crear una cotización o al cambiar explícitamente de cliente.

Los campos de cliente enviados manualmente junto a `clienteId` se ignoran. El backend construye el snapshot desde el documento autorizado, por lo que un cliente de otra empresa, inexistente o archivado no puede usarse en una cotización nueva.

# Edición y snapshot histórico

- Mantener el mismo `clienteId` conserva exactamente el snapshot ya persistido.
- El borrador continúa editable si ese cliente fue archivado después de crear la cotización.
- Cambiar explícitamente a otro `clienteId` activo reemplaza el snapshot por una nueva copia autoritativa.
- Un rechazo al cambiar de cliente no escribe parcialmente la cotización.
- Las vistas de historial, impresión, correo y PDF consumen el snapshot almacenado; no consultan el cliente vivo.

# Compatibilidad legacy

Una cotización histórica sin `clienteId`:

- abre con sus campos históricos;
- se identifica como “Cliente histórico no vinculado”;
- puede guardarse como borrador sin inferir coincidencias por nombre o RUT;
- solo pasa al contrato vinculado cuando el usuario selecciona explícitamente un cliente registrado.

# Seguridad y reglas

No fue necesario ampliar `firestore.rules`. Las cotizaciones conservan la política de lectura y actualización existente, las creaciones directas siguen bloqueadas y la creación autoritativa continúa en Cloud Functions. La colección interna `clientRutKeys` no participa en el selector.

# Pruebas

Los smokes cubren:

- selección por nombre y RUT, clientes activos y cambio de negocio;
- obligatoriedad de `clienteId` en cotizaciones nuevas;
- rechazo de clientes inexistentes, archivados y externos;
- omisión del snapshot de cliente en el payload frontend;
- snapshot autoritativo y rechazo de valores manipulados;
- independencia frente a ediciones posteriores del cliente;
- conservación con el mismo cliente y renovación ante cambio explícito;
- edición de un borrador cuyo cliente fue archivado;
- compatibilidad de `clientId` al leer y de cotizaciones sin vínculo;
- idempotencia de creación y numeración concurrente existente.
