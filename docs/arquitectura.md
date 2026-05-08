# Arquitectura ValoraCloud MVP

ValoraCloud usa una arquitectura por capas simple para que el MVP sea facil de mantener, explicar y extender durante la tesis.

## Estructura de carpetas

```txt
src/
  app/        Configuracion principal de rutas y proteccion de sesion.
  firebase/   Inicializacion Firebase y rutas Firestore centralizadas.
  layout/     Estructura visual comun: sidebar, topbar y contenedor.
  pages/      Pantallas de ruta. Orquestan features, no contienen logica pesada.
  features/   UI funcional agrupada por modulo del negocio.
  services/   Acceso a Firebase, Auth, Firestore y Cloud Functions.
  domain/     Reglas puras del negocio, sin dependencia de Firebase ni React.
  utils/      Formateadores, validadores y utilidades compartidas.
  styles/     Estilos globales y layout base.
```

## Capas y responsabilidades

- `pages`: representan rutas del sistema, por ejemplo inventario o nueva cotizacion.
- `features`: contienen componentes React de cada modulo, por ejemplo `InventoryManager` o `QuoteAssistant`.
- `services`: encapsulan infraestructura. Los componentes no deberian importar Firestore/Auth directamente.
- `domain`: contiene reglas testeables del negocio, especialmente calculo de precios y transformacion de items.
- `firebase`: concentra configuracion y paths para evitar strings de colecciones repartidos por la app.

Esta separacion evita que la UI quede acoplada a Firebase y permite explicar el MVP como un sistema con responsabilidades claras.

## Servicios Firebase

Los servicios base son:

- `authService.js`: login, registro, cierre de sesion y observador de usuario.
- `companyService.js`: configuracion de empresa, margenes y valor hora.
- `inventoryService.js`: CRUD de inventario y verificacion de precio por Cloud Function.
- `referenceService.js`: placeholder para referencias manuales de mercado.
- `quoteService.js`: fachada para propuesta local y futura Cloud Function de cotizacion.

Firestore usa la estructura principal:

```txt
usuarios/{userId}
usuarios/{userId}/config/negocio
usuarios/{userId}/inventario/{itemId}
usuarios/{userId}/referencias/{referenceId}
usuarios/{userId}/cotizaciones/{quoteId}
```

## Patron Service/Repository

Los archivos en `services/` funcionan como una capa Service/Repository ligera. Su objetivo es esconder detalles de Firebase:

- como se construye una ruta de Firestore,
- como se suscribe una tabla en tiempo real,
- como se crea, actualiza o elimina un documento,
- como se llama una Cloud Function.

Esto mantiene los componentes enfocados en estado de UI, formularios y eventos del usuario.

## Strategy para precios

El calculo de precio sugerido vive en `domain/pricing.js`. Se preparo una estrategia inicial llamada `margen_simple`, basada en:

- costo de materiales,
- mano de obra,
- transporte,
- margen por nivel de calidad.

La funcion `getPricingStrategy()` permite reemplazar o agregar estrategias sin reescribir la UI. Para el MVP basta con una estrategia simple y defendible.

## Adapter para fuentes externas

Las referencias de mercado manuales seran el primer origen de datos. Si luego se agregan fuentes externas, deben entrar como adapters, por ejemplo:

```txt
externalReferenceAdapter -> referencia normalizada -> referenceService
```

Esto evita que scraping, APIs externas o IA contaminen la logica central del MVP.

## Factory/helper de items

`domain/quoteItemFactory.js` prepara la transformacion de un item de inventario en un item de cotizacion. Esto permite reutilizar la misma forma de datos en valorizacion, cotizaciones y PDF.

## Asistente hibrido para estructura de cotizacion

La funcion callable `suggestQuoteItems` usa un asistente hibrido para sugerir posibles items a partir de una descripcion escrita por el usuario. Esta asistencia solo estructura la cotizacion: no calcula precios finales, no entrega totales, no crea cotizaciones automaticamente y no reemplaza el criterio profesional ni la valorizacion del sistema.

La primera capa es local y gratuita: usa reglas, palabras clave e inventario activo para generar sugerencias sin costo de API. La segunda capa es premium/opcional: usa Gemini mediante Secret Manager (`GEMINI_API_KEY`) cuando exista disponibilidad de creditos o plan API. Si la API externa falla por cuota, creditos, timeout o disponibilidad, ValoraCloud cae automaticamente a la capa local y mantiene operativo el flujo principal.

El frontend envia una descripcion y un resumen de items activos/valorizados. La respuesta se normaliza a un maximo de 8 sugerencias con tipo permitido (`producto`, `servicio` o `actividad`) y una posible coincidencia con inventario. Si existe coincidencia, el usuario puede agregar manualmente ese item usando el precio sugerido por ValoraCloud, no por la IA.

## Revision nocturna de referencias

La funcion programada `nightlyInventoryReferenceReview` se ejecuta una vez al dia en la zona horaria `America/Santiago`. Revisa inventario activo y referencias manuales para crear tareas internas en `usuarios/{uid}/tareasReferencias` cuando un item no tiene referencias activas o cuando su referencia activa mas reciente supera 30 dias.

Esta revision no busca precios en internet, no usa Gemini, no hace scraping, no modifica inventario, no modifica precios y no crea referencias automaticamente. Su objetivo en el MVP es recordar al usuario que debe actualizar referencias de mercado manualmente. En una etapa premium futura se podria agregar busqueda asistida con APIs externas o IA, manteniendo controles de costo, trazabilidad y validacion humana.

## Flujo principal del MVP

1. Usuario inicia sesion o se registra con Firebase Auth.
2. Configura datos base de empresa: rubro, valor hora y margenes.
3. Crea o importa inventario de productos y servicios.
4. Registra referencias manuales de mercado.
5. Valora un proyecto usando inventario, costos internos y margenes.
6. Genera una cotizacion editable.
7. Guarda historial y emite vista formal imprimible/PDF.
8. El asistente IA queda como apoyo minimo, no como dependencia critica del flujo.

## Decisiones tecnicas defendibles

- React + Vite reduce complejidad frente a Create React App.
- Firebase acelera autenticacion, persistencia y despliegue para un MVP de un mes.
- La IA no es obligatoria para que el sistema funcione; el calculo base es transparente.
- No se implementa scraping en esta etapa porque aumenta riesgo tecnico y legal.
- La arquitectura evita sobreingenieria: servicios, dominio y features son suficientes para explicar crecimiento futuro.
