# Objetivo

Vincular cotizaciones con clientes registrados sin perder el carácter histórico de los documentos comerciales.

# Alcance implementado

En una cotización nueva, “Escanear producto” resuelve por consulta exacta el `barcode` de un producto activo dentro del negocio. Agrega la línea usando la valorización vigente o incrementa su cantidad si ya existe; un código inexistente no crea inventario.

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

# Duplicación de documentos históricos

Una cotización que ya no es editable directamente puede duplicarse como un borrador independiente. La operación sigue el flujo:

```text
Documento histórico inmutable → Duplicar como borrador → Nuevo documento independiente
```

La Function recibe exclusivamente `businessId`, `sourceId` y `requestId`, lee la cotización original dentro del negocio autorizado y exige rol `OWNER` o `ADMIN`. El original conserva su ID, número, estado, snapshots y timestamps sin escrituras.

La copia obtiene un ID, número, fecha, creador y timestamps nuevos mediante el mismo contador transaccional vigente. El cliente se resuelve nuevamente desde su `clienteId` canónico y debe continuar activo en el mismo negocio; un cliente archivado bloquea la duplicación sin reactivarlo. Las líneas, precios, descuentos, alcance, condiciones, observaciones, tratamiento tributario, vigencia y opciones comerciales se reconstruyen desde el documento original leído por backend. Esto preserva descripciones comerciales personalizadas sin confiar en snapshots o totales enviados por el frontend.

La idempotencia usa `negocios/{businessId}/quoteDuplicateRequests/{requestId}`. Repetir la misma solicitud devuelve la misma copia y no consume otro correlativo. El backend agrega `cotizacionOrigenId` y `cotizacionOrigenNumero` únicamente como trazabilidad informativa.

`MEMBER` no recibe la acción y Functions rechaza un intento directo. La duplicación no cambia estados, no envía correo, no genera PDF y no emite automáticamente.

# Seguridad y reglas

Las cotizaciones conservan lectura para miembros activos, pero toda creación o
actualización directa queda bloqueada; persistencia y estados son autoritativos en
Cloud Functions. Las colecciones internas de requests permanecen cerradas y los
eventos sólo admiten lectura del negocio. `clientRutKeys` no participa en el selector.

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
- duplicación autoritativa de un documento histórico, nuevo ID y número, borrador independiente y original intacto;
- reintento idempotente, rol `MEMBER`, aislamiento entre negocios y rechazo de cliente archivado;
- omisión de snapshots y totales falsificados en la solicitud de duplicación.

# Ciclo autoritativo, reenvío y reapertura

El campo `estado` es una proyección autoritativa: ninguna transición se escribe
con el SDK cliente. `transitionQuoteStatus` valida las transiciones ordinarias y
`reopenQuote` es la única operación terminal a `emitida`. Rules conserva lectura
para miembros activos, pero bloquea toda escritura cliente sobre cotizaciones. La
edición de borradores continúa mediante `updateQuoteDraft`.

Cada respuesta, cambio de estado, reapertura y entrega confirmada crea un documento
inmutable en `cotizaciones/{cotizacionId}/eventos/{eventoId}`. El evento conserva
fecha de servidor, actor, medio, destinatario, estados y `requestId`. Los campos de
respuesta en la cotización siguen como proyección compatible con documentos legacy;
al reabrir uno, su respuesta anterior se importa primero a un evento.

Reenviar por correo o WhatsApp reutiliza la misma COT y nunca cambia su estado. En
`aceptada`, `rechazada` o `vencida`, el enlace es una copia pública sin respuesta;
en `borrador` o `emitida` conserva el flujo vigente. Los `requestId`, eventos
deterministas, lease y cooldown evitan duplicados técnicos razonables.

Reabrir `aceptada`, `rechazada` o `vencida` incrementa `oportunidadVersion`, calcula
una nueva vigencia y emite un token público ligado a esa versión. Los tokens de
versiones anteriores ya no pueden responder. Si existe `ventaId`, la reapertura se
rechaza siempre; la COT puede reenviarse como copia sin alterar su venta.
