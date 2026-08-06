# Onboarding inicial y administración multiempresa

## Flujo

1. Firebase Auth crea o autentica la cuenta con correo y contraseña.
2. `getBusinessSession` resuelve las membresías del UID y el negocio activo.
3. Una cuenta sin una membresía válida sobre un negocio activo es enviada a
   `/onboarding`.
4. El onboarding solicita solamente nombre, rubro y región. Chile y CLP se
   asignan en el backend, sin depender de valores editables del cliente.
5. `createFirstBusiness` valida los códigos de catálogo y ejecuta una sola
   transacción para crear negocio, membresía `OWNER`, bloqueo de primer negocio,
   registro idempotente y contexto activo del usuario.
6. La sesión se vuelve a resolver y el usuario entra a `/dashboard` aunque el
   RUT, comuna, dirección o contacto todavía estén pendientes.

El request de creación contiene únicamente `nombreComercial`, `rubroCodigo`,
`regionCodigo` y, cuando corresponde, `rubroOtro`. El backend fija Chile y CLP.
Una comuna vacía se trata como ausente y no se persiste; si una operación de
perfil envía una comuna real, se valida que pertenezca a la región elegida.

El mismo `requestId` puede reenviarse sin duplicar datos. Un `requestId` usado
con un contenido diferente se rechaza. Un segundo intento con otro identificador
también devuelve el primer negocio ya creado.

## Esquema Firestore

- `usuarios/{uid}`: identidad mínima y punteros `negocioActivoId` y
  `primerNegocioId`. Los punteros solo los escribe el backend.
- `negocios/{negocioId}`: datos esenciales del negocio, ubicación, moneda,
  estado, versión y auditoría.
- `membresias/{negocioId}__{uid}`: relación usuario-negocio, rol
  `OWNER | ADMIN | MEMBER`, estado y auditoría.
- `usuarios/{uid}/sistema/primerNegocio`: bloqueo transaccional servidor-servidor.
- `usuarios/{uid}/businessCreateRequests/{requestId}`: idempotencia servidor-servidor.
- `usuarios/{uid}/sistema/negociosPropios`: contador transaccional y límite del
  plan para negocios con rol `OWNER`.
- `paises`, `regiones`, `comunas`, `monedas`, `rubros`: catálogos globales de
  solo lectura para usuarios autenticados.
- `metadatos/esquema`: versión y conteos del catálogo.

Los datos operacionales activos se ubican bajo `negocios/{negocioId}/...`:
perfil y configuración de empresa, inventario, catálogos de inventario,
referencias, tareas, cotizaciones, contadores y solicitudes idempotentes. Las
reglas validan la membresía activa para cada acceso. Las rutas históricas bajo
`usuarios/{uid}` se conservan temporalmente para compatibilidad; esta entrega no
ejecuta una migración remota automática.

## Selector y creación adicional

- `BusinessCategoryPicker` es el selector compartido por onboarding, creación
  adicional y `Empresa`. La selección permanece provisional hasta confirmar.
  La búsqueda ignora mayúsculas y tildes y consulta nombre y alias.
- `OTRO` conserva el código canónico y guarda el nombre personalizado en
  `rubroOtro`; este texto no modifica el catálogo global.

- `getBusinessSession` entrega solo negocios activos con una membresía válida,
  el rol del usuario, el negocio activo y el estado del límite del plan.
- `setActiveBusiness` comprueba negocio y membresía en backend antes de cambiar
  `negocioActivoId`; el puntero no concede autorización por sí solo.
- `createAdditionalBusiness` usa los mismos tres campos de creación rápida y
  crea en una única
  transacción el negocio, la membresía `OWNER`, el perfil comercial inicial, el
  registro idempotente, el contador del plan y el nuevo contexto activo.
- El plan `FREE` permite dos negocios con rol `OWNER`. Las membresías `ADMIN` y
  `MEMBER` no consumen el límite. El contador y la consulta de membresías se leen
  dentro de la transacción para impedir que solicitudes concurrentes excedan el
  máximo.

## Negocio activo, inactivo o eliminado

- Si `negocioActivoId` no es accesible y existe otra membresía activa sobre un
  negocio activo, `getBusinessSession` selecciona ese negocio como fallback y
  actualiza el puntero del usuario.
- Si no queda ninguna membresía válida sobre un negocio activo, se muestra el
  onboarding breve. `createFirstBusiness` vuelve a comprobar las membresías y
  el límite dentro de su transacción para evitar duplicados o saltarse el plan.
- Un negocio inexistente o con `eliminadoEn` se considera no disponible.

## Configuración completa

- `negocios/{negocioId}/empresa/perfil` contiene la ficha comercial completa.
- `updateBusinessProfile` es una operación independiente que exige membresía
  `OWNER` o `ADMIN`, normaliza los datos y actualiza solamente el negocio activo.
- Los campos mínimos son nombre, rubro, país, moneda y región. El RUT, comuna,
  dirección y un medio de contacto son recomendados, pero no bloquean el ERP.
- El estado de completitud se deriva de los campos actuales; no se persiste un
  booleano manual que pueda quedar desactualizado.
- Los perfiles existentes sin documento anidado se hidratan desde los campos
  canónicos de `negocios/{negocioId}` y pueden completarse desde `Empresa`.

## Catálogo de Chile

`functions/businessCatalog.json` es la fuente compartida por frontend, backend y
seed. Contiene los 16 códigos de región y las 346 comunas con CUT estable,
incluyendo provincia para evolución futura. La fuente es SUBDERE, planilla
`CUT_2018_v04.xls`.

El mismo archivo contiene el catálogo empresarial versión 2: 75 categorías
con código estable, sector, estado y términos de búsqueda. Las categorías
generales históricas siguen activas para lectura y validación de datos ya
guardados, pero tienen `selectable: false` y no se ofrecen para nuevas
selecciones. Un código histórico desconocido o un registro antiguo que solo
contenga texto puede conservarse al editar otros campos; solo se reemplaza si
el usuario elige explícitamente una categoría canónica.

Para cargar un emulador ya iniciado:

```powershell
npm run seed:business-catalogs:emulator
```

La escritura remota está bloqueada por defecto. En un entorno de desarrollo
confirmado, con credenciales de Application Default Credentials configuradas:

```powershell
node scripts/seed-business-catalogs.mjs --allow-remote-development --project tesis-inventario-ia
```

## Reset seguro

El reset local se obtiene iniciando los emuladores sin `--import`. Para un reset
remoto del proyecto de pruebas, solo después de desplegar las dos Functions y las
reglas de esta etapa:

```powershell
firebase firestore:delete --all-collections --force --project tesis-inventario-ia
node scripts/seed-business-catalogs.mjs --allow-remote-development --project tesis-inventario-ia
```

No ejecutar esos comandos contra otro proyecto ni antes de disponer del backend
nuevo, porque las cuentas existentes quedarían sin su contexto de negocio.
