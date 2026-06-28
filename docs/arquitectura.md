# Arquitectura de ValoraCloud

## Propósito

ValoraCloud es un MVP web para apoyar la valorización y preparación de
cotizaciones TI de Bagner. Su arquitectura separa interfaz, reglas de negocio,
acceso a Firebase e integraciones externas. La IA es opcional y no determina
precios finales.

## Componentes

```text
Navegador
  React + Vite
    Firebase Authentication
    Cloud Firestore
    Firebase Storage
    Cloud Functions 2nd Gen
      Gemini API
      Resend
      Cloud Scheduler
```

El frontend se comunica directamente con Firestore y Storage bajo reglas de
seguridad. Las operaciones que requieren secretos o privilegios administrativos
se ejecutan en Cloud Functions.

## Organización del frontend

```text
src/
  app/          Configuración de rutas y protección de sesión.
  components/   Marca y gráficos reutilizables.
  domain/       Cálculos de valorización y normalización de ítems.
  features/     Formularios y módulos del negocio.
  firebase/     SDK cliente y construcción centralizada de rutas.
  layout/       Navegación y estructura visual común.
  pages/        Pantallas de cada ruta.
  services/     Firestore, Storage, Authentication y Functions.
  styles/       Estilos globales y layout.
  utils/        Formateadores y PDF.
```

`pages` orquesta cada pantalla; `features` implementa la interacción; `services`
encapsula infraestructura; `domain` mantiene reglas sin dependencia de React o
Firebase.

## Autenticación y rutas

Firebase Authentication gestiona registro, login, cierre de sesión, correo de
verificación y recuperación de contraseña. `RequireAuth` impide acceder a rutas
privadas sin una sesión autenticada.

La versión actual muestra el estado de verificación de correo, pero no exige
`email_verified` en rutas ni reglas. Si Bagner requiere bloqueo obligatorio,
debe implementarse y probarse como una decisión funcional explícita.

## Modelo de datos

```text
usuarios/{uid}
usuarios/{uid}/config/negocio
usuarios/{uid}/empresa/perfil
usuarios/{uid}/inventario/{itemId}
usuarios/{uid}/referencias/{referenceId}
usuarios/{uid}/cotizaciones/{quoteId}
usuarios/{uid}/contadores/{counterId}
usuarios/{uid}/tareasReferencias/{taskId}
```

Los documentos de negocio se ubican bajo el `uid` propietario. Las reglas
deniegan rutas no declaradas y evitan lectura o escritura entre usuarios.

### Empresa

El perfil guarda identificación comercial, contacto, dirección, logo,
condiciones de pago, validez y nota de pie. El logo se almacena en
`usuarios/{uid}/empresa/logo/`, admite PNG, JPG o WebP y un máximo de 2 MB.

### Inventario y referencias

El inventario maneja productos, servicios y actividades. Las eliminaciones son
lógicas mediante estados. Las referencias de mercado son manuales y se asocian
a un ítem de inventario.

### Valorización

`domain/pricing.js` calcula precio base desde costo y margen, promedio de
referencias, precio sugerido y estado de valorización. La ponderación vigente
combina precio interno y promedio de referencias. El usuario mantiene la
decisión final.

### Cotizaciones

Las cotizaciones guardan una copia de los datos comerciales, datos del cliente,
ítems, totales y estado. La numeración comercial se asigna por transacción con
un contador anual.

Los estados comerciales son independientes de los estados de correo. Las reglas
reservan al backend los campos de envío y evitan editar el contenido de una
cotización que ya no está en borrador; el frontend conserva acciones de cambio
de estado.

## Cloud Functions

Todas usan API v2 y región `us-central1`. El runtime es Node.js 22.

### `suggestQuoteItems`

- Requiere autenticación.
- Acepta hasta 1200 caracteres y un resumen máximo de 40 ítems.
- Devuelve hasta ocho sugerencias de tipo producto, servicio o actividad.
- No devuelve precios, totales ni crea cotizaciones.
- Usa Gemini cuando está disponible y fallback local en caso contrario.

### `normalizeInventoryItems`

- Requiere autenticación.
- Acepta hasta 8 hojas, 500 filas, 40 columnas por fila y 500 caracteres por
  celda.
- El frontend limita el archivo a 5 MB.
- Normaliza de forma conservadora y mantiene costo cero cuando no existe
  contexto monetario confiable.
- Devuelve una vista previa; la persistencia requiere confirmación del usuario.

### `normalizeInventoryDocument`

- Requiere autenticación.
- Acepta PDF, JPG, JPEG, PNG y WebP de hasta 5 MB.
- Valida extensión, MIME declarado, firma binaria real, tamaño y casos básicos
  de corrupción antes de invocar Gemini.
- Procesa el archivo temporalmente en memoria mediante Base64 dentro del
  callable; no escribe el documento fuente en Firestore ni Firebase Storage.
- Usa análisis multimodal para interpretar estructura visual, tablas, filas,
  columnas, precios unitarios, cantidades y totales de línea.
- Devuelve solo candidatos sanitizados, advertencias y metadatos necesarios para
  la vista previa editable. La persistencia requiere confirmación del usuario.
- No implementa OCR local ni fallback heurístico para imágenes o PDF escaneados.
  Si Gemini no está disponible, informa el error y no inventa candidatos.

### `sendQuoteEmail`

- Requiere autenticación y busca la cotización bajo el `uid` de la sesión.
- Valida estado comercial, destinatario, asunto, mensaje y PDF.
- El PDF es obligatorio, debe ser `application/pdf` y no superar 8 MB.
- Escapa contenido HTML y utiliza Resend desde el backend.
- Registra el resultado en campos separados del estado comercial.

La interfaz reduce duplicados deshabilitando la acción mientras existe una
solicitud, pero no hay una clave de idempotencia distribuida. Un reintento
concurrente extremo podría duplicar un envío y debe considerarse una limitación.

### `nightlyInventoryReferenceReview`

- Se ejecuta diariamente a las 03:15 en `America/Santiago`.
- Revisa inventario activo y referencias activas.
- Crea o actualiza tareas por falta de referencias o antigüedad superior a 30
  días.
- Evita duplicar tareas pendientes o aplazadas del mismo tipo.
- No consulta internet, no usa Gemini y no modifica precios.

## Integraciones externas

### Gemini

La clave `GEMINI_API_KEY` se obtiene desde Secret Manager. El modelo principal
configurado es `gemini-2.5-flash-lite`. Google anunció su cierre para el 16 de
octubre de 2026. Si el modelo no responde, el sistema usa el fallback local.
El SDK `@google/generative-ai` está obsoleto; su migración requiere una prueba
real de integración y no se realizó de forma automática durante el cierre.

El flujo documental usa `gemini-2.5-flash` de forma aislada para PDF e imagenes,
sin cambiar el modelo del asistente de cotizaciones ni el importador tabular.
La separacion evita que un ajuste del procesamiento multimodal altere el
fallback local de planillas.

### Resend

`RESEND_API_KEY` y `RESEND_FROM_EMAIL` solo se usan en Functions. El frontend no
recibe estas credenciales.

## Seguridad

- Firestore y Storage separan datos por propietario.
- Las rutas no previstas quedan denegadas.
- Los campos de envío de correo son de escritura exclusiva del backend.
- Las cotizaciones no borrador solo admiten cambios controlados de estado desde
  el cliente.
- Los enlaces externos de referencias usan `noopener noreferrer`.
- No se usa `dangerouslySetInnerHTML`.
- La configuración pública del SDK de Firebase no sustituye secretos privados.

Las reglas no validan exhaustivamente todos los tipos y rangos de cada
colección. Esa ampliación debe realizarse junto con pruebas de Emulator Suite
para no romper documentos existentes.

## Privacidad técnica

El sistema puede almacenar correo de usuario, datos de empresa, RUT, teléfonos,
direcciones, inventario, referencias y datos de contacto de clientes. Los PDF y
correos contienen datos comerciales y del cliente.

Gemini recibe descripciones y datos resumidos necesarios para asistencia. En el
flujo documental recibe el archivo comercial solo durante la ejecucion de la
Function para generar una vista previa; el repositorio no lo guarda como fixture
ni la aplicacion lo persiste en Firestore o Storage.
Resend recibe el destinatario, mensaje y PDF. El dictado depende del servicio de
reconocimiento del navegador y ValoraCloud no guarda audio.

No existe en el repositorio una política jurídica definitiva, período de
retención, procedimiento formal de respaldo, exportación, eliminación física o
rectificación. Estos puntos requieren definición organizacional y revisión
profesional antes de operar con datos reales.

## Despliegue y operación

Los archivos de configuración son:

- `.firebaserc`
- `firebase.json`
- `firestore.rules`
- `storage.rules`
- `functions/package.json`

El despliegue se realiza con Firebase CLI después de `npm ci`, lint, build y
pruebas controladas. El código local no confirma por sí solo el estado real de
Functions, reglas, Scheduler o secretos desplegados.
