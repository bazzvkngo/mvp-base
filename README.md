# ValoraCloud

ValoraCloud es un MVP de tesis orientado a la valorización de productos y
servicios TI y a la generación de cotizaciones para Bagner. Centraliza
inventario, referencias manuales de mercado, precios sugeridos, cotizaciones,
PDF, envío por correo y tareas de revisión de referencias.

No es un sistema de facturación electrónica ni genera documentos tributarios.
La asistencia con IA propone estructura y normalización, pero no define precios
finales ni reemplaza la revisión humana.

## Alcance del MVP

- Registro, inicio de sesión, verificación de correo y recuperación de
  contraseña mediante Firebase Authentication.
- Perfil comercial y logo de empresa.
- Selector multiempresa, cambio seguro de negocio activo y creación de negocios
  adicionales con límite configurable por plan.
- Inventario de productos, servicios y actividades.
- Importación local o asistida de archivos CSV, XLS y XLSX, con vista previa.
- Importación documental de PDF, JPG, PNG y WebP mediante análisis multimodal
  desde backend y revisión humana.
- Referencias manuales de mercado y valorización.
- Creación, emisión, historial y estados comerciales de cotizaciones.
- Generación de PDF y envío mediante Resend.
- Asistente híbrido con Gemini y fallback local.
- Revisión nocturna de referencias y tareas internas.

## Tecnologías

- React 19 y Vite 7.
- Firebase Authentication, Cloud Firestore y Firebase Storage.
- Cloud Functions for Firebase 2nd Gen sobre Node.js 22.
- Gemini API desde el backend.
- Resend para correo transaccional.
- jsPDF para PDF.
- Chart.js para visualizaciones.
- SheetJS CE 0.20.3 para importacion de planillas.

## Requisitos

- Node.js 22.
- npm 10 o compatible.
- Firebase CLI.
- Un proyecto Firebase con Authentication, Firestore, Storage y Functions.
- Java, solo si se utilizará Firebase Emulator Suite.

## Instalación y desarrollo

```bash
npm ci
npm run dev
```

En otra terminal, para trabajar con Functions:

```bash
npm --prefix functions ci
npm --prefix functions run lint
```

Build y vista previa:

```bash
npm run build
npm run preview
```

## Estructura principal

```text
src/
  app/          Rutas y protección de sesión.
  components/   Componentes reutilizables.
  domain/       Reglas puras de valorización y cotizaciones.
  features/     Formularios y módulos funcionales.
  firebase/     Inicialización del SDK cliente y rutas Firestore.
  layout/       Navegación y estructura general.
  pages/        Pantallas asociadas a rutas.
  services/     Acceso a Firebase y Cloud Functions.
  styles/       Estilos globales.
  utils/        Formateadores y generación de PDF.
functions/
  index.js      Cloud Functions 2nd Gen.
docs/
  arquitectura.md
  importador-documental.md
```

## Configuración de Firebase

La configuración del SDK cliente está en `src/firebase/firebaseConfig.js`.
Contiene identificadores públicos necesarios para conectar el navegador con
Firebase. No debe confundirse con credenciales privadas de servidor.

El proyecto predeterminado de Firebase se define en `.firebaserc`. Antes de
desplegar, se debe confirmar que corresponde al entorno autorizado.

## Secretos backend

Las Functions esperan únicamente estos secretos por nombre:

- `GEMINI_API_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `SERPER_API_KEY`

Ejemplo de configuración, sin incluir valores en el repositorio:

```bash
firebase functions:secrets:set GEMINI_API_KEY
firebase functions:secrets:set RESEND_API_KEY
firebase functions:secrets:set RESEND_FROM_EMAIL
firebase functions:secrets:set SERPER_API_KEY
```

## Cloud Functions

- `suggestQuoteItems`: sugiere hasta ocho ítems y nunca entrega precios.
- `normalizeInventoryItems`: normaliza un archivo con límites de tamaño y
  fallback local; no persiste automáticamente.
- `normalizeInventoryDocument`: analiza temporalmente PDF e imagenes
  comerciales en memoria, devuelve candidatos sanitizados y no guarda el
  documento fuente.
- `sendQuoteEmail`: valida propiedad, estado, correo y PDF antes de usar Resend.
- `nightlyInventoryReferenceReview`: se ejecuta a las 03:15 en
  `America/Santiago` y crea o actualiza tareas, sin modificar precios.

Las funciones están configuradas en `us-central1`. El runtime Node.js 22 se
declara en `functions/package.json`.

## Despliegue

Este repositorio no autoriza despliegues automáticos. Cada despliegue se hace a
mano, en este orden: reglas, Functions y frontend. Las reglas y las Functions
nuevas aceptan al frontend anterior; un frontend nuevo contra Functions
antiguas puede perder datos que el backend anterior no lee.

Verificación previa:

```bash
git status --short          # sin cambios pendientes
firebase use                # debe indicar tesis-inventario-ia
npm ci
npm --prefix functions ci
npm run test:rules          # reglas validadas en Emulator Suite
```

### 1. Reglas

```bash
firebase deploy --only firestore:rules --project tesis-inventario-ia
firebase deploy --only storage --project tesis-inventario-ia   # solo si cambió storage.rules
```

### 2. Functions

```bash
firebase deploy --only functions --project tesis-inventario-ia
```

El `predeploy` de `firebase.json` ejecuta el lint de `functions/`. Los
secretos de la sección anterior deben existir en Secret Manager antes del
despliegue. Si el CLI propone eliminar Functions que no están en el código,
responder que no salvo que se sepa cuáles son.

### 3. Frontend (cPanel)

El frontend no usa Firebase Hosting (`firebase.json` no tiene sección
`hosting`). Se publica en `https://valoracloud.bagner.cl`, un hosting cPanel,
subiendo el contenido de `dist/` con el Administrador de archivos.

1. Generar el build y un zip con el **contenido** de `dist/`, no la carpeta:

   ```powershell
   npm run build
   Compress-Archive -Path dist\* -DestinationPath valoracloud-AAAAMMDD.zip -Force
   ```

   En la raíz del zip deben quedar `index.html`, `favicon.svg` y `assets/`.
2. En cPanel, activar "Mostrar archivos ocultos" en la configuración del
   Administrador de archivos y abrir la raíz del documento del subdominio
   (Dominios → raíz del documento de `valoracloud.bagner.cl`).
3. Respaldo: seleccionar todo el contenido de la raíz del documento,
   comprimirlo como `backup-valoracloud-AAAAMMDD.zip`, descargarlo y moverlo
   fuera de la raíz del documento.
4. Subir el zip nuevo a la raíz del documento y extraerlo encima, aceptando
   sobrescribir. Se reemplazan `index.html` y `favicon.svg`, y `assets/`
   recibe los archivos nuevos (sus nombres llevan hash y no chocan con los
   anteriores).
5. Conservar `.htaccess`, `.well-known/` y cualquier archivo que no provenga
   de `dist/`. El build no incluye `.htaccess`, así que extraer el zip no lo
   toca.
6. Borrar el zip subido de la raíz del documento: queda descargable
   públicamente.
7. Verificar en una ventana privada: abrir la app, entrar directo a una ruta
   interna (por ejemplo `/inventario`) para comprobar la reescritura a
   `index.html`, y revisar que la consola no muestre recursos 404.
8. Los archivos anteriores de `assets/` se pueden borrar después, cuando nadie
   tenga abierta la versión previa. Para volver atrás, extraer el respaldo.

El `.htaccess` de la raíz del documento debe reescribir las rutas de la app
(React Router con `BrowserRouter`) a `index.html`, y evitar que el navegador
guarde en caché `index.html`, para que una nueva versión se cargue al
recargar:

```apache
Options -MultiViews
RewriteEngine On
RewriteBase /

RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]
RewriteRule ^ index.html [L]

<IfModule mod_headers.c>
  <FilesMatch "^index\.html$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>
```

## Seguridad y privacidad

- La creación rápida de negocios solicita nombre, rubro y región; Chile y CLP
  se asignan en servidor. La ficha completa se administra después desde
  `Empresa` mediante una operación autorizada para `OWNER` y `ADMIN`.
- Los datos empresariales activos se separan por
  `negocios/{businessId}/...` y se autorizan mediante membresías. Las rutas
  históricas por usuario permanecen disponibles únicamente como compatibilidad
  mientras se defina una migración remota explícita.
- Los estados de envío de correo solo pueden ser escritos por el backend.
- Los logos admiten PNG, JPG o WebP y un máximo de 2 MB.
- Las importaciones admiten hasta 5 MB. Las planillas admiten hasta 8 hojas y
  500 filas. Los documentos PDF o imagenes se procesan temporalmente para vista
  previa y no se almacenan en Firestore ni Storage.
- Los secretos no deben guardarse en frontend, documentación ni historial Git.
- El dictado usa la API de reconocimiento del navegador; ValoraCloud no
  persiste audio.

El sistema almacena datos de cuenta, empresa, inventario, referencias,
cotizaciones y datos de contacto de clientes. Gemini procesa descripciones e
inventario resumido cuando se habilita; Resend procesa destinatario, contenido
del correo y PDF. Antes de usar datos reales de Bagner se deben definir y
revisar profesionalmente política de privacidad, aviso de tratamiento,
retención, respaldo, eliminación, rectificación, exportación y
responsabilidades entre las partes.

## Limitaciones conocidas

- El correo verificado se informa en la interfaz, pero no bloquea el acceso al
  MVP.
- No existe eliminación física de datos desde la interfaz; inventario y
  referencias usan estados lógicos.
- La tarea nocturna no consulta precios externos ni crea referencias.
- Si Gemini no está disponible, las planillas pueden usar análisis local y
  revisión humana. Los PDF e imágenes no tienen fallback OCR local; deben
  reintentarse o convertirse temporalmente a una planilla compatible.
- La importación documental valida extensión, MIME, firma binaria y tamaño, pero
  la calidad final de PDF escaneados o fotografías depende de legibilidad,
  encuadre y calidad visual del documento.
- `gemini-2.5-flash-lite` tiene una fecha de cierre anunciada por Google para el
  16 de octubre de 2026.
- Las llamadas de Functions usan `@google/genai` y un control global persistente
  por modelo. Los límites protegidos se reservan antes de contactar al proveedor.
- No hay una suite automatizada que demuestre por sí sola los 35 casos de prueba
  descritos en la tesis; esos casos requieren evidencia externa.

## Licencia y titularidad

No se ha definido una licencia open source para ValoraCloud en este
repositorio. La titularidad y las condiciones de entrega a Bagner y a la
universidad deben ser confirmadas por el propietario antes de publicar o
redistribuir el código.
