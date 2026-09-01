# ValoraCloud

ValoraCloud es un MVP de tesis orientado a la valorización de productos y
servicios TI y a la generación de cotizaciones para Bagner. Centraliza
inventario, referencias manuales de mercado, precios sugeridos, cotizaciones,
PDF, envío por correo y tareas de revisión de referencias.

No es un sistema de facturación electrónica ni genera documentos tributarios.
La asistencia con IA propone estructura y normalización, pero no define precios
finales ni reemplaza la revisión humana.

## Desarrollo de módulos / Student Baseline

Los colaboradores que parten desde `student-baseline-20260901` deben trabajar
exclusivamente en una feature branch y usar Firebase Emulator Suite. `npm run
dev` apunta a datos reales; para desarrollo estudiantil se usan
`npm run emulators:start` y `npm run dev:emulator`. No se autoriza desplegar ni
modificar el Core sin revisión.

- [Guía de inicio para estudiantes](docs/STUDENT_GETTING_STARTED.md)
- [Contrato de desarrollo de módulos](docs/MODULE_DEVELOPMENT_CONTRACT.md)
- [Workflow Git para estudiantes](docs/STUDENT_GIT_WORKFLOW.md)

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

Ejemplo de configuración, sin incluir valores en el repositorio:

```bash
firebase functions:secrets:set GEMINI_API_KEY
firebase functions:secrets:set RESEND_API_KEY
firebase functions:secrets:set RESEND_FROM_EMAIL
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

Build y Hosting, si Hosting está configurado en el proyecto Firebase:

```bash
npm ci
npm run build
firebase deploy --only hosting
```

Functions:

```bash
npm --prefix functions ci
npm --prefix functions run lint
firebase deploy --only functions
```

Reglas:

```bash
firebase deploy --only firestore:rules
firebase deploy --only storage
```

Las reglas deben validarse en Emulator Suite o mediante pruebas controladas
antes de desplegarse. Este repositorio no autoriza despliegues automáticos.

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
