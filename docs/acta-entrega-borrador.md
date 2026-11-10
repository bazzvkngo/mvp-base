# Acta de entrega de ValoraCloud (BORRADOR)

**Estado de este documento:** borrador para conversar con Bruno. No es un contrato ni tiene valor legal. No está firmado.
**Fecha del borrador:** 10 de noviembre de 2026.
**Partes:** Bagner (Servicios Integrales Bagner SpA), representada por Bruno, y Mauricio Guerrero, desarrollador del sistema.

## Cómo leer este documento

Cada dato lleva una de dos marcas:

- **VISTO** y el lugar donde consta (`archivo:línea`): se comprobó en el repositorio.
- **PENDIENTE DE CONFIRMAR**: no se pudo comprobar en el repositorio. Hay que confirmarlo con quien corresponda antes de firmar. No se pone ninguna cifra ni afirmación en su lugar.

Los informes `output\*.txt` que se citan son notas locales del proyecto. No están en Git (la carpeta `output/` está excluida en `.gitignore:56`), así que quien los quiera ver debe pedirlos.

---

## 1. Qué es lo que se entrega

### 1.1 Qué es el sistema

ValoraCloud es un sistema de gestión para negocios: inventario, cotizaciones, ventas, compras, proyectos y reportes. Se construye para uso real en Bagner, con Bruno como supervisor y dueño del negocio. Bagner es el piloto; la meta a mediano plazo es poder ofrecerlo a otros negocios. **VISTO:** `AGENTS.md:5`.

No es un sistema de facturación electrónica ni genera documentos tributarios. **VISTO:** `README.md:9`.

### 1.2 Código y documentación

| Qué | Dónde consta |
|---|---|
| Repositorio de código: `bazzvkngo/mvp-base` en GitHub. Rama de trabajo: `mvp-base-profesor`. | **VISTO:** remoto `origin` de Git |
| Proyecto de Firebase: `tesis-inventario-ia`. | **VISTO:** `.firebaserc:3` |
| Sitio publicado: `https://valoracloud.bagner.cl` (alojamiento cPanel, no Firebase Hosting). | **VISTO:** `README.md:173` |
| Documentos: `README.md`, `AGENTS.md`, `docs/arquitectura.md`, `docs/BUSINESS_ONBOARDING.md`, `docs/guia-bruno.md`, `docs/puesta-en-marcha.md`, `docs/guia-practicantes.md`, `docs/novedades-baseline.md`, `docs/importador-documental.md`, `docs/como-agregar-un-rubro.md` y las SPEC en `docs/specs/` (000 a 032). | **VISTO:** carpeta `docs/` |
| Última versión del sitio empaquetada en el repositorio: `valoracloud-20261106.zip`. Que esa sea la versión publicada hoy. | Existe el archivo (**VISTO**). Que esté publicada: **PENDIENTE DE CONFIRMAR** |
| Qué parte del código ya está subida a producción (reglas, Functions y sitio). Varios cambios figuran "pendientes de subir" en las SPEC y en los mensajes de commit (por ejemplo `docs/specs/005-ordenes-compra-mvp.md:9`, `docs/specs/032-invitaciones-equipo.md:3`, `docs/specs/028-proyectos-ficha-y-tablero.md:5`). | **PENDIENTE DE CONFIRMAR** |
| Despliegue: es manual y en este orden: reglas, Functions y sitio. No hay despliegue automático. | **VISTO:** `README.md` sección "Despliegue" |

### 1.3 Módulos

La columna "En el código" dice solo lo que se ve en el repositorio: que existe la pantalla en el menú y su lógica de servidor. **No significa que Bruno ya lo haya probado y aceptado ni que esté desplegado**; esas dos columnas quedan por confirmar.

| Módulo | En el código | Aceptado por Bruno | En producción |
|---|---|---|---|
| Ingreso, registro, verificación de correo y aceptación de términos | Pantalla de ingreso con "Mi empresa" y "Soy colaborador" (`src/features/auth/Login.jsx:50-51`). Ingreso con Google **apagado** por decisión de Mauricio (`src/config/featureFlags.mjs:4-11`, `docs/specs/029-ingreso-google-colaborador.md:3`). | PENDIENTE DE CONFIRMAR | PENDIENTE DE CONFIRMAR |
| Creación de la empresa (onboarding) y selector de empresas | `docs/BUSINESS_ONBOARDING.md:3-12`; `functions/businessOnboarding.js` | PENDIENTE DE CONFIRMAR | PENDIENTE DE CONFIRMAR |
| Empresa (datos, logo, impuestos, valores de cotización) y verificación empresarial | Secciones "Información empresa", "Verificación", "Impuestos", "Inventario", "Cotizaciones" y "Eliminar empresa" (`src/features/company/CompanyConfig.jsx:68-75`). Verificación: SPEC 014. | PENDIENTE DE CONFIRMAR | PENDIENTE DE CONFIRMAR |
| Empleados, perfiles e invitaciones | Siete perfiles de sistema (`src/domain/rbac.mjs:22-30`), perfiles personalizados y botón "Invitar usuario" (`src/pages/EmployeesPage.jsx:276`). SPEC 008 y SPEC 032 (esta última dice "pendientes la revisión en el navegador y el despliegue", línea 3). | PENDIENTE DE CONFIRMAR | PENDIENTE DE CONFIRMAR |
| Clientes | Ruta `/clientes` (`src/app/App.jsx:429`); `functions/clientPersistence.js`; SPEC 001 | PENDIENTE DE CONFIRMAR | PENDIENTE DE CONFIRMAR |
| Cotizaciones (con envío por correo y propuesta pública) | Rutas `/cotizaciones` (`App.jsx:452`) y `/propuesta/:token` (`App.jsx:169`); `functions/quoteEmail.js`, `functions/quotePublicProposal.js`; SPEC 002 | PENDIENTE DE CONFIRMAR | PENDIENTE DE CONFIRMAR |
| Ventas (con costo congelado al confirmar y margen) | Ruta `/ventas` (`App.jsx:593`); `functions/salePersistence.js`; SPEC 007 y SPEC 017 (esta última: "implementada; QA final completado el 2 de septiembre de 2026", línea 11) | PENDIENTE DE CONFIRMAR | PENDIENTE DE CONFIRMAR |
| Inventario, importación de planillas y de documentos, referencias de mercado | Rutas `/inventario` (`App.jsx:409`) y `/inventario/:itemId/referencias` (`App.jsx:419`); `functions/inventoryDocumentImport.js`, `functions/marketReferences.js`; SPEC 003 | PENDIENTE DE CONFIRMAR | PENDIENTE DE CONFIRMAR |
| Proveedores (incluye eliminar un proveedor sin movimientos) | Ruta `/proveedores` (`App.jsx:441`); `functions/providerPersistence.js`, `functions/providerDeletion.js`; SPEC 004 | PENDIENTE DE CONFIRMAR | El mensaje del commit `2057f41` y los siguientes dicen "frontend pendiente de subir": PENDIENTE DE CONFIRMAR |
| Órdenes de compra | Ruta `/ordenes-compra` (`App.jsx:483`); `functions/purchaseOrderPersistence.js`, `functions/purchaseOrderEmail.js`. La eliminación permanente figura "implementada, pendiente de desplegar" (`docs/specs/005-ordenes-compra-mvp.md:9`). | PENDIENTE DE CONFIRMAR | PENDIENTE DE CONFIRMAR |
| Recepciones | Ruta `/recepciones` (`App.jsx:523`); `functions/receptionPersistence.js`; SPEC 011 | PENDIENTE DE CONFIRMAR | PENDIENTE DE CONFIRMAR |
| Compras | Ruta `/compras` (`App.jsx:553`); `functions/purchasePersistence.js`; SPEC 006 y SPEC 023 (costo neto de IVA) | PENDIENTE DE CONFIRMAR | PENDIENTE DE CONFIRMAR |
| Reportes: Resumen, Ventas, Compras y Ganancia | Cuatro pestañas (`src/features/reports/ReportsNav.jsx:10-15`). Últimas mejoras de presentación en la rama (commits `0477220`, `de38fd0`, `725744d`, `ce8bfe5`). SPEC 025. | PENDIENTE DE CONFIRMAR | PENDIENTE DE CONFIRMAR |
| Finanzas | Ruta `/finanzas` (`App.jsx:336`); SPEC 010 | PENDIENTE DE CONFIRMAR | PENDIENTE DE CONFIRMAR |
| Consola de la plataforma (solo superadministradores): empresas, usuarios, verificaciones y módulos por empresa | Rutas `/admin/...` (`App.jsx:206-212`); `functions/platformAdmin.js`; SPEC 015 y SPEC 031 | PENDIENTE DE CONFIRMAR | PENDIENTE DE CONFIRMAR |
| Textos legales públicos `/privacidad` y `/terminos` | Rutas en `App.jsx:178-179`. Son una versión inicial "pendiente de revisión legal por parte de Bagner" (`src/domain/legalDocumentsContent.mjs:8-9`). | Revisión legal: PENDIENTE DE CONFIRMAR | PENDIENTE DE CONFIRMAR |

### 1.4 Pruebas

El repositorio trae pruebas automáticas (`npm run test:*` en `package.json`). **PENDIENTE DE CONFIRMAR:** el resultado de una corrida completa justo antes de firmar. Se sugiere adjuntarlo a esta acta con el código de salida de cada prueba.

---

## 2. Qué queda fuera de esta entrega

| Tema | Estado | Dónde consta |
|---|---|---|
| **Proyectos y trabajos** | En revisión. En el código quedan pendientes la validación de cierre, el botón «Cerrar proyecto» y la confirmación de subtareas, y el despliegue de la etapa C (eliminación de tareas). | **VISTO:** `docs/specs/028-proyectos-ficha-y-tablero.md:5`. Que esté "en revisión" es lo que se indicó para esta acta: **PENDIENTE DE CONFIRMAR** con quién revisa. |
| **Segunda fase de Reportes** | No incluida. Quedaron aplazadas: la consulta en el servidor (rendimiento y permisos), que ya se había descartado y diferido, y la etapa opcional 5. | **VISTO:** `docs/specs/025-reportes-simplificado.md:72` y `:82-85` |
| Posibles ampliaciones de Reportes (vista por mes de los últimos 6 o 12 meses, ganancia por mes en el Resumen, filtros por cliente, proveedor o proyecto) | Solo propuestas, sin acordar. Ver las notas de trabajo `output\reportes-r5.txt` y `output\reportes-r6.txt`. | **VISTO** en esos informes locales |
| Módulos de otros rubros (Taller automotriz y Clínica veterinaria) | No integrados al sistema. Ver sección 5. | **VISTO:** sección 5 |
| Facturación electrónica y documentos tributarios | No existe en el sistema. | **VISTO:** `README.md:9` |
| Ingreso con Google | Apagado. El código se conserva. | **VISTO:** `src/config/featureFlags.mjs:8-11` |
| Traspaso del rol de propietario de una empresa a otra cuenta | No existe todavía. Hace falta una especificación propia. | **VISTO:** `docs/puesta-en-marcha.md`, sección "Trabajo futuro: traspaso de propietario" |
| Revisión legal de privacidad, términos, retención, respaldo, eliminación y exportación de datos | Pendiente. | **VISTO:** `README.md`, sección "Seguridad y privacidad" (desde la línea 227) |
| Migración de los datos históricos guardados por usuario hacia las rutas por empresa | No hecha; se conservan por compatibilidad. | **VISTO:** `README.md` sección "Seguridad y privacidad" y `docs/BUSINESS_ONBOARDING.md` sección "Esquema Firestore" |
| Planes de pago y cobro | No implementados. En el piloto no hay tope de negocios por propietario. | **VISTO:** `docs/BUSINESS_ONBOARDING.md` sección "Selector y creación adicional" |

---

## 3. Servicios externos y cuentas

Todo el sistema depende de cuentas que hoy están a nombre de quien las creó. Para cada una, la columna "Titular hoy" no consta en el repositorio.

La columna "Titular al final" es una **propuesta para conversar con Bruno**, no un acuerdo. Se apoya en que el propio código dice que el sistema se traspasa a Bagner y que su servidor puede cambiar (`src/config/featureFlags.mjs:8-9`).

| Servicio | Para qué se usa | Dónde consta | Límites que constan en el repositorio | Titular hoy | Titular al final (propuesta) |
|---|---|---|---|---|---|
| **Firebase / Google Cloud** (proyecto `tesis-inventario-ia`) | Cuentas de usuario, base de datos, archivos (logos) y Functions en `us-central1` | `.firebaserc:3`; `README.md` (Configuración de Firebase y Cloud Functions) | Logo: PNG, JPG o WebP, hasta 2 MB (`CompanyConfig.jsx:180-187`). Importaciones: hasta 5 MB; planillas hasta 8 hojas y 500 filas (`README.md:237-238`). Invitaciones de equipo: 20 por día y 50 pendientes por empresa (`functions/teamInvitations.js:20-21`). Plan de facturación, cuotas y costo mensual: **PENDIENTE DE CONFIRMAR** | PENDIENTE DE CONFIRMAR | Cuenta de Bagner, con Mauricio como usuario con permisos. A acordar |
| **Resend** | Correo de cotizaciones y órdenes de compra. El remitente aparece como "(vía ValoraCloud)" y las respuestas van al correo comercial de la empresa. | `functions/quoteEmail.js:253`, `functions/purchaseOrderEmail.js:182`, `functions/emailEnvelope.js:1` y `:34`; secretos `RESEND_API_KEY` y `RESEND_FROM_EMAIL` (`README.md`, sección Secretos backend) | Plan, tope de envíos y dominio de envío verificado: **PENDIENTE DE CONFIRMAR** | PENDIENTE DE CONFIRMAR | Cuenta de Bagner. A acordar |
| **Serper** | Búsqueda de precios de mercado (Google Shopping) para las referencias de Inventario | `functions/marketReferences.js:3`; secreto `SERPER_API_KEY` | Máximo 10 resultados por consulta (`functions/marketReferences.js:4`). Plan y cuota: **PENDIENTE DE CONFIRMAR** | PENDIENTE DE CONFIRMAR | Cuenta de Bagner. A acordar |
| **Gemini** (Google) | Importar documentos de inventario (`gemini-2.5-flash`) y sugerir ítems de cotización (`gemini-2.5-flash-lite`). Propone, no fija precios. | `functions/aiConfig.js:2-3`; secreto `GEMINI_API_KEY` | Por modelo: espera de 20 s (importación) y 10 s (sugerencias) entre usos, tope protegido de 15 por día y tope del proveedor de 20 por día (`functions/aiConfig.js:8-23`). El contador es un solo registro por modelo (`functions/aiRateLimiter.js:313`), es decir que lo comparten todas las empresas. Día contado en hora de Los Ángeles (`aiConfig.js:6`). Cuota real de la cuenta: **PENDIENTE DE CONFIRMAR** | PENDIENTE DE CONFIRMAR | Cuenta de Bagner. A acordar |
| **Dominio y alojamiento** `valoracloud.bagner.cl` | Sitio publicado en un cPanel | `README.md:173`, `:186` | Plan del alojamiento y vencimiento del dominio: **PENDIENTE DE CONFIRMAR** | PENDIENTE DE CONFIRMAR | Bagner (el dominio es `bagner.cl`). A acordar |
| **GitHub** (`bazzvkngo/mvp-base`) | Repositorio de código y de los PR de los practicantes | remoto `origin` | Sin límites en el repositorio | Cuenta de Mauricio (`bazzvkngo`) | A acordar con Bruno (ver recuadro de la sección 6) |
| **Cuentas de plataforma** (superadministrador) | Entrar a `/admin` | `src/app/App.jsx:206-212` | — | PENDIENTE DE CONFIRMAR qué cuentas son superadministradoras | A acordar |

Otros hechos útiles:

- La revisión nocturna de referencias corre a las 03:15 hora de Santiago y no cambia precios (`README.md`, sección Cloud Functions).
- Los secretos se cargan por nombre en Firebase y no están en el repositorio. **PENDIENTE DE CONFIRMAR:** quién tiene hoy los valores y cómo se los entregará.

---

## 4. Qué debe quedar hecho antes de firmar (lista de control)

- [ ] Confirmar qué está desplegado hoy en producción (reglas, Functions y sitio) y anotar la fecha.
- [ ] Probar los flujos de la guía `docs/guia-bruno.md` en producción con Bruno.
- [ ] Correr todas las pruebas y adjuntar sus códigos de salida.
- [ ] Confirmar el estado del negocio simulado de Bagner y si ya se creó el negocio real.
- [ ] Confirmar quién es titular de cada cuenta de la sección 3 y cuáles se traspasan.
- [ ] Definir cómo se entregan los secretos y accesos.
- [ ] Revisión legal de los textos `/privacidad` y `/terminos`.
- [ ] Definir el canal de soporte y quién responde (ver `docs/guia-bruno.md`, sección "Si algo falla").
- [ ] Firmas.

---

## 5. Trabajo de practicantes

Dos módulos de otros rubros se hicieron como Pull Requests de practicantes. Esta sección solo registra hechos; no evalúa el trabajo.

| | PR #2 | PR #4 |
|---|---|---|
| Módulo | Clínica veterinaria | Taller mecánico |
| Practicante | Marcelo | Matías |
| Rama y base | Rama `feature/clinica-veterinaria`, hacia `student-baseline` | Rama `feature/taller-mecanico`, hacia `student-baseline-20260901` |
| Dónde consta | `docs/novedades-baseline.md:3` (nombres y módulos); ramas y bases en `output\pr2-revision-final.txt:8-10` y `output\pr4-revision.txt:9-16` | Igual |
| ¿Integrado a `mvp-base-profesor`? | **No.** **VISTO:** su referencia local `remotes/pr/2` no es ancestro de la rama actual (`git merge-base --is-ancestor`) | **No.** **VISTO:** su referencia local `remotes/pr/4` no es ancestro de la rama actual |
| Estado del PR en GitHub | **PENDIENTE DE CONFIRMAR** | **PENDIENTE DE CONFIRMAR** |

Contexto del repositorio: ningún módulo de otro rubro llega a producción sin el interruptor de módulos por empresa, que ya existe. **VISTO:** `docs/guia-practicantes.md`, sección 4 "Reglas"; `docs/specs/031-interruptor-modulos.md:3`.

Los acuerdos sobre este trabajo van en el recuadro de la sección 6.

---

## 6. A acordar con Bruno

> **Temas que se conversan y se acuerdan antes de firmar. Este documento no propone ni redacta ninguna condición.**
>
> - Propiedad del código fuente del sistema.
> - Propiedad del logo y de la marca ValoraCloud.
> - Precios: del sistema, de la puesta en marcha, del mantenimiento y de los servicios externos.
> - Cláusulas: garantía, soporte, confidencialidad, tratamiento de datos personales, responsabilidades y término.
> - Qué pasa con lo que aportaron los practicantes (PR #2 y PR #4) y con terceros.
> - Condiciones para ofrecer el sistema a otros negocios.
> - Titularidad final de las cuentas de la sección 3.

---

## 7. Firmas

| Por Bagner | Por el desarrollador |
|---|---|
| Nombre: Bruno (apellido y RUT: PENDIENTE DE CONFIRMAR) | Nombre: Mauricio Guerrero (RUT: PENDIENTE DE CONFIRMAR) |
| Firma: | Firma: |
| Fecha: | Fecha: |
