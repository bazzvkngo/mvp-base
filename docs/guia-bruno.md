# Guía de ValoraCloud para Bruno: puesta en marcha

**Para:** Bruno, dueño de Bagner.
**Estado:** borrador del 10 de noviembre de 2026. Escrito sobre lo que dice el repositorio; todavía no se ha probado paso a paso en pantalla con Bruno.

## Cómo leer este documento

Cada dato lleva una de dos marcas:

- **VISTO** y el lugar donde consta (`archivo:línea`): se comprobó en el repositorio.
- **PENDIENTE DE CONFIRMAR**: no se pudo comprobar en el repositorio. No se pone ninguna cifra ni afirmación en su lugar; hay que confirmarlo con Mauricio.

Los nombres entre comillas son los que se ven en pantalla. Si en tu pantalla algo se llama distinto, avísale a Mauricio: el documento se corrige.

La lista técnica de la puesta en marcha, escrita para Mauricio, está aparte en `docs/puesta-en-marcha.md`. Bruno no necesita leerla.

---

## 1. Antes de empezar

- Necesitas un correo real que uses a diario, porque ahí llega la verificación de tu cuenta.
- El sistema funciona desde el navegador. La dirección es `https://valoracloud.bagner.cl`. **VISTO:** `README.md:173`. Que ese sitio esté publicado y al día hoy: **PENDIENTE DE CONFIRMAR**.
- ValoraCloud **no emite facturas ni boletas electrónicas** ni documentos tributarios. Sirve para ordenar el negocio: inventario, cotizaciones, ventas, compras, proyectos y reportes. **VISTO:** `README.md:9`.
- **Pendiente:** si el negocio de prueba de Bagner que existe en producción ya se eliminó y quedó listo para crear el negocio real. **PENDIENTE DE CONFIRMAR** con Mauricio antes de la sección 3.

## 2. Cómo ingresar

1. Abre `https://valoracloud.bagner.cl`. Te lleva a la pantalla de ingreso. **VISTO:** `src/app/App.jsx:189-190`.
2. La pantalla tiene dos pestañas: **"Mi empresa"** y **"Soy colaborador"**. **VISTO:** `src/features/auth/Login.jsx:50-51`.
   - **Mi empresa:** para ti, que eres el dueño.
   - **Soy colaborador:** para quien trabajará en una empresa que lo invitó (ver sección 5).
3. Si es tu primera vez, crea la cuenta con tu correo y una contraseña. Hay que aceptar los términos y la política de privacidad marcando una casilla, que no viene marcada. **VISTO:** `docs/specs/024-aceptacion-terminos-privacidad.md:28`.
4. Te llega un correo para **verificar tu dirección**. Hasta que lo hagas, algunas funciones no están disponibles; por ejemplo, un correo sin verificar no puede ver ni aceptar invitaciones. **VISTO:** `README.md:15` (verificación de correo), `src/layout/AppLayout.jsx:111` (el sistema comprueba si el correo del propietario está verificado) y `docs/specs/032-invitaciones-equipo.md:57`.
5. Si olvidas la contraseña, usa **"¿Olvidaste tu contraseña?"**. **VISTO:** `src/features/auth/Login.jsx:594`.
6. **El ingreso con Google está apagado.** Se entra con correo y contraseña. **VISTO:** `src/config/featureFlags.mjs:8-11`.
7. Los textos de términos y privacidad se pueden leer sin ingresar en `/terminos` y `/privacidad`. **VISTO:** `src/app/App.jsx:178-179`. Son una versión inicial, "pendiente de revisión legal por parte de Bagner". **VISTO:** `src/domain/legalDocumentsContent.mjs:8-9`.

## 3. Crear la empresa real

Cuando entras con una cuenta que no tiene ninguna empresa, el sistema te lleva a una pantalla de inicio donde pide solo tres datos. **VISTO:** `docs/BUSINESS_ONBOARDING.md:7-11`.

1. **Nombre comercial.** Para esta puesta en marcha, el nombre acordado es "Servicios Integrales Bagner SpA". **VISTO:** `docs/puesta-en-marcha.md`, paso 6.
2. **Rubro.** Se elige de una lista.
3. **País:** Chile. La moneda inicial la fija el sistema según el país. **VISTO:** `docs/BUSINESS_ONBOARDING.md:9-11` y `README.md:229-231`.
4. Al terminar, quedas como **Propietario** de la empresa. **VISTO:** `docs/BUSINESS_ONBOARDING.md:12-14`.

Después de crear la empresa, el sistema te lleva al menú de tu rol. Para Propietario, Administrador y Finanzas la primera pantalla es **Reportes**. **VISTO:** `docs/BUSINESS_ONBOARDING.md:19-22`.

**Importante:** el sistema no permite hoy traspasar la propiedad de una empresa a otra cuenta. Por eso la empresa real debe crearla Bruno desde su propia cuenta, y no otra persona. **VISTO:** `docs/puesta-en-marcha.md`, sección "Trabajo futuro: traspaso de propietario".

## 4. Completar la empresa: datos, logo, correo comercial y verificación

Entra al menú **Empresa** (grupo "Gestión"). **VISTO:** `src/app/navigation.js` (ítem "Empresa"). Tiene estas secciones: **Información empresa**, **Verificación**, **Impuestos**, **Inventario**, **Cotizaciones** y **Eliminar empresa** (esta última solo la ve el Propietario). **VISTO:** `src/features/company/CompanyConfig.jsx:68-75`.

### 4.1 Datos de la empresa (sección "Información empresa")

- **Datos comerciales:** Nombre comercial, Giro, Región, Comuna o ciudad, Dirección comercial y Código postal. **VISTO:** `CompanyConfig.jsx:610-667`.
- **Contacto:** Teléfono comercial, **Correo comercial** y Sitio web. **VISTO:** `CompanyConfig.jsx:721-727`.
- Solo el Propietario y los Administradores pueden guardar estos datos. **VISTO:** `docs/BUSINESS_ONBOARDING.md` (sección "Configuración completa").
- Solo el nombre, el rubro, el país, la moneda y la región son obligatorios. El RUT, la comuna, la dirección y un medio de contacto son recomendados, pero no bloquean el uso. **VISTO:** `docs/BUSINESS_ONBOARDING.md` (sección "Configuración completa").
- Los datos fiscales (país, moneda, identificación fiscal) aparecen en un recuadro de solo lectura. **VISTO:** `CompanyConfig.jsx:542-593`.

### 4.2 Cargar el logo

1. En "Información empresa" busca **"Logo de la empresa"**. **VISTO:** `CompanyConfig.jsx:680`.
2. Elige una imagen y súbela. El archivo debe ser **PNG, JPG o WebP** y pesar **hasta 2 MB**. Si no cumple, el sistema avisa "Usa un archivo PNG, JPG o WebP." o "El logo no puede superar 2 MB." **VISTO:** `CompanyConfig.jsx:180-187` y `README.md:237`.
3. Se puede quitar el logo con el botón de eliminar que hay junto a él. **VISTO:** `CompanyConfig.jsx:702`.
4. **PENDIENTE DE CONFIRMAR:** dónde exactamente aparece el logo (por ejemplo, en el PDF de la cotización). Se confirma generando una cotización de prueba en el negocio de pruebas de Mauricio, no en el negocio real.

### 4.3 Correo comercial: qué hace

- Cuando envías una cotización o una orden de compra por correo, el mensaje **sale desde la dirección de envío de ValoraCloud**, con tu nombre comercial seguido de "(vía ValoraCloud)". **VISTO:** `functions/emailEnvelope.js:1`.
- Las **respuestas** llegan a tu **Correo comercial**. Si no lo has completado, llegan al correo de tu cuenta, siempre que esté verificado. Si no hay ninguno, el correo sale sin dirección de respuesta. **VISTO:** `functions/emailEnvelope.js:34-40` y `src/domain/emailReplyTo.mjs:17-21`.
- Por eso conviene completar el **Correo comercial** con un correo que revises todos los días.
- **PENDIENTE DE CONFIRMAR:** cuál es la dirección desde la que salen los correos y si su dominio está verificado en el servicio de correo (Resend). Hoy se guarda en un secreto del servidor que no se ve en el repositorio.

### 4.4 Valores predeterminados de las cotizaciones (sección "Cotizaciones")

Aquí se dejan listos los textos que se repiten en cada cotización: **Condiciones de pago**, **Validez (días)**, plazo de entrega y **Garantía**. **VISTO:** `CompanyConfig.jsx:1251-1262`.

### 4.5 Verificar la empresa

Mientras la empresa no esté verificada, los módulos de trabajo no se pueden usar y el sistema te lleva a **Empresa → Verificación**. **VISTO:** `src/app/App.jsx:284-286` y `CompanyConfig.jsx:918` ("Solicita la revisión para activar los módulos operativos de ValoraCloud").

1. Entra a **Empresa → Verificación** y pulsa **"Solicitar verificación"**. **VISTO:** `CompanyConfig.jsx:929` y `src/app/App.jsx:286`.
2. **Solo el Propietario puede solicitarla.** Otros perfiles ven el estado. **VISTO:** `CompanyConfig.jsx:837` y `:928`.
3. El formulario pide, entre otros datos: país, tipo de identificación fiscal, identificador fiscal declarado, relación o cargo, correo y teléfono de quien solicita, y observaciones. **VISTO:** `CompanyConfig.jsx:968-1079`.
4. La solicitud la revisa un superadministrador de la plataforma desde la consola, en la sección de verificaciones. **VISTO:** `src/app/App.jsx:212`.
5. El estado pasa a "Verificación en revisión" mientras tanto. **VISTO:** `src/domain/businessCompletion.mjs:21`.
6. **PENDIENTE DE CONFIRMAR:** cuánto demora la revisión y quién la atiende en el día a día.

## 5. Invitar usuarios y elegir perfiles

### 5.1 Cómo invitar

1. Entra a **Empleados** y pulsa **"Invitar usuario"**. **VISTO:** `src/pages/EmployeesPage.jsx:276` y `:287`.
2. Escribe el **correo** de la persona y elige su **perfil** (o un perfil personalizado, ver 5.3).
3. La persona recibe la invitación como un aviso en su **centro de notificaciones** y la **acepta o la rechaza**. Si todavía no tiene cuenta, la crea con ese mismo correo y la ve al entrar como colaborador. **VISTO:** `docs/specs/032-invitaciones-equipo.md:55-57`.
4. La invitación **vence a los 7 días**. **VISTO:** `docs/specs/032-invitaciones-equipo.md:31`.
5. Solo el Propietario y los Administradores pueden invitar. **VISTO:** `docs/specs/032-invitaciones-equipo.md:45`.
6. Por seguridad, el sistema responde lo mismo exista o no una cuenta con ese correo, y quien acepta debe tener el correo verificado y que coincida con el de la invitación. **VISTO:** `docs/specs/032-invitaciones-equipo.md:45-49`.
7. Hay un máximo de **20 invitaciones por día** y **50 pendientes** por empresa. **VISTO:** `functions/teamInvitations.js:20-21`.
8. Se puede revocar una invitación pendiente. **VISTO:** `docs/specs/032-invitaciones-equipo.md` (Function `revocarInvitacionNegocio`, sección 6).
9. **PENDIENTE DE CONFIRMAR:** que el sistema de invitaciones ya esté subido a producción. La SPEC lo dejó "pendiente de la revisión en el navegador y el despliegue" el 19 de octubre (`docs/specs/032-invitaciones-equipo.md:3`).

### 5.2 Los perfiles del sistema

| Perfil | Qué puede hacer, según el sistema |
|---|---|
| **Propietario** | Acceso completo, incluida la administración de miembros y perfiles. |
| **Administrador** | Acceso amplio a los módulos, salvo funciones reservadas al propietario. |
| **Ventas** | Clientes, cotizaciones y ventas, con consulta de inventario y referencias. |
| **Compras** | Proveedores, órdenes, recepciones y compras, con acceso a inventario y costos. |
| **Técnico** | Inventario y proyectos y trabajos, para consulta y operación técnica. |
| **Finanzas** | Ventas, compras, inventario, reportes, rentabilidad y finanzas. |
| **Colaborador** | Consulta transversal del negocio y operación técnica de proyectos y trabajos. |

**VISTO:** nombres en `src/domain/rbac.mjs:22-30`; descripciones en `src/pages/EmployeesPage.jsx:47-55`.

- Propietario no se puede asignar a otra persona: es quien creó la empresa. **VISTO:** `docs/specs/032-invitaciones-equipo.md:30` ("Nunca OWNER").
- La **ganancia** en Reportes solo la ven los perfiles con permiso de rentabilidad: Propietario, Administrador y Finanzas. **VISTO:** `docs/specs/025-reportes-simplificado.md:20`.

### 5.3 Perfiles personalizados

En **Empleados** hay una pestaña de **Perfiles y permisos**, con los perfiles del sistema (fijos) y los personalizados, que se crean con **"Crear perfil"** eligiendo qué módulos ve cada uno. **VISTO:** `src/pages/EmployeesPage.jsx:126-139`.

## 6. El flujo básico del negocio

Los módulos están en el menú lateral, agrupados así: **Inicio** (Reportes), **Comercial** (Clientes, Cotizaciones, Ventas), **Operación** (Proyectos y trabajos, Inventario), **Abastecimiento** (Proveedores, Órdenes de compra, Recepciones, Compras), **Gestión** (Empresa, Empleados) y **Cuenta** (Mi cuenta). **VISTO:** `src/app/navigation.js:17-135`. Cada persona solo ve lo que su perfil permite.

### 6.1 Cotización

1. Primero registra al **cliente** en **Clientes**; una cotización nueva exige un cliente activo. **VISTO:** `docs/specs/002-clientes-cotizaciones.md` (sección "Alcance implementado").
2. En **Cotizaciones**, crea la cotización con sus ítems.
3. Márcala **"emitida"** y envíala con **"Enviar cotización por correo"**. **VISTO:** `src/pages/QuoteHistoryPage.jsx:1290` y `src/features/quotes/SendQuoteEmailModal.jsx:303`.
4. El cliente la revisa y responde desde un **enlace público** (`/propuesta/…`). **VISTO:** `src/app/App.jsx:169` y `src/domain/emailReplyTo.mjs:17-18`.
5. Los estados de una cotización son: borrador, emitida, aceptada, rechazada, vencida y archivada. **VISTO:** `src/domain/reportModel.mjs:29-36`.
6. El sistema tiene una ayuda con inteligencia artificial para **sugerir ítems**, que nunca entrega precios: los precios los decide una persona. **VISTO:** `README.md:120`.
7. **PENDIENTE DE CONFIRMAR:** cómo queda marcada una cotización como "aceptada" en la práctica (por el cliente desde el enlace o a mano), y los nombres exactos de los botones en esa pantalla.

### 6.2 Venta

- Solo una cotización **aceptada** puede registrarse como venta. **VISTO:** `functions/salePersistence.js:489`.
- También se puede crear una venta sin cotización, con **"Nueva venta"**. **VISTO:** `src/app/App.jsx:603`.
- Al pulsar **"Confirmar venta"**, el sistema descuenta del inventario los productos vendidos y **congela su costo de ese momento**; con eso se puede calcular la ganancia de la venta. **VISTO:** `functions/salePersistence.js:598` y `docs/specs/007-ventas-mvp.md:3-9`.
- Una venta confirmada se puede cancelar: el stock vuelve al inventario y la venta deja de contar en los reportes. **VISTO:** `functions/salePersistence.js:796-801`.

### 6.3 Compra directa

- Con **"Nueva compra"** se registra una factura o boleta de un proveedor. Crearla o editarla solo deja un borrador. Al **"Confirmar compra"**, el stock de los productos sube. Los servicios y actividades no mueven el stock. **VISTO:** `docs/specs/006-compras-mvp.md:3-6`.
- El costo se registra **sin IVA**; en una boleta, el IVA cuenta como costo. **VISTO:** `src/features/reports/OperationalNetProfitBreakdown.jsx` y `src/domain/reportModel.mjs:67-69`; `docs/guia-practicantes.md` (SPEC 023).

### 6.4 Orden de compra y recepción

1. En **Órdenes de compra** se arma lo que se le pide a un proveedor. **La orden no mueve el stock.** **VISTO:** `docs/specs/005-ordenes-compra-mvp.md:5`.
2. La orden se puede **emitir y enviar por correo** al proveedor. **VISTO:** `functions/purchaseOrderEmail.js:215` y `:386-427`.
3. Cuando llega la mercadería, se registra una **Recepción** desde la orden y se pulsa **"Confirmar recepción"**. **VISTO:** `src/pages/NewReceptionPage.jsx:157`.
4. Confirmar una recepción crea **una sola Compra**, sin duplicar la entrada de stock. **VISTO:** `docs/specs/006-compras-mvp.md:8-10` y `docs/specs/025-reportes-simplificado.md:15`.
5. Una compra **no se puede borrar**: si algo se cargó mal, se revierte o se cancela. **VISTO:** `src/domain/purchaseModel.mjs:5` (estados: borrador, confirmada, cancelada, revertida).

### 6.5 Reportes

La pantalla **Reportes** tiene cuatro pestañas: **Resumen**, **Ventas**, **Compras** y **Ganancia**. **VISTO:** `src/features/reports/ReportsNav.jsx:10-15`.

| Cifra | Qué significa | Dónde consta |
|---|---|---|
| **Vendí** | Ventas confirmadas del mes, sin IVA. No cuentan las canceladas. Incluye servicios y ventas con proyecto. | `src/domain/reportMonthlySummary.mjs:15`; `src/features/reports/views/ReportsVentasView.jsx` |
| **Compré** | Compras confirmadas, sin IVA. **Incluye stock que aún no vendes.** No cuentan las revertidas. | `src/domain/reportMonthlySummary.mjs:16` |
| **Me quedó** | Lo vendido menos su costo, más lo que dejaron los proyectos. Los servicios sin proyecto no entran. **No incluye gastos generales del negocio.** | `src/domain/reportMonthlySummary.mjs:17`; `src/features/reports/OperationalNetProfitBreakdown.jsx:74-76` |

- **Compré menos Vendí no es la ganancia.** Las compras incluyen mercadería que todavía no se vende. Por eso "Me quedó" se calcula aparte. **VISTO:** `src/features/reports/views/ReportsComprasView.jsx` (nota del gráfico "Comparar ventas y compras no es ganancia").
- En el **Resumen** navegas mes a mes con las flechas y ves la comparación con el mes anterior. Mientras el mes no termina, el sistema muestra el total del mes anterior completo en vez de un porcentaje. **VISTO:** `src/domain/reportMonthlySummary.mjs:43-47`.
- Las pestañas **Ventas**, **Compras** y **Ganancia** tienen un selector de período: esta semana, este mes, últimos 3 o 6 meses, este año o un rango propio. **VISTO:** `src/domain/reportModel.mjs:11-18`.
- Los **íconos "i"** de cada cifra abren la explicación completa. **VISTO:** `src/features/reports/ReportsInfoTip.jsx`.
- Si aparece **"Parcial · N cosas por revisar"** en "Me quedó", significa que algunos registros no entran en la ganancia (por ejemplo, ventas sin costo registrado). El detalle se abre desde el mismo aviso. **VISTO:** `src/features/reports/views/ReportsProfitNotice.jsx:28`.
- Para sacar datos del sistema (por ejemplo, a una planilla): **PENDIENTE DE CONFIRMAR** si existe una exportación en cada pestaña.

### 6.6 Inventario y proveedores

- **Inventario:** se puede cargar uno por uno, importar una planilla (CSV, XLS o XLSX) o analizar un documento (PDF o imagen) con ayuda de inteligencia artificial, siempre con revisión humana antes de guardar. **VISTO:** `README.md:21-24`.
- Los documentos que se analizan **no se guardan**: se procesan en el momento. **VISTO:** `README.md` (sección "Seguridad y privacidad").
- La ayuda de inteligencia artificial tiene **topes diarios compartidos por todas las empresas**; si se alcanzan, el sistema avisa que hay que esperar. **VISTO:** `functions/aiConfig.js:8-23` y `functions/aiRateLimiter.js:272`.
- **Proveedores:** se pueden archivar. Un proveedor sin movimientos se puede eliminar permanentemente, solo por Propietario o Administrador. **VISTO:** mensaje del commit `45d41e9`. **PENDIENTE DE CONFIRMAR** que ya esté publicado.

## 7. Reglas para no ensuciar los datos reales

- **Desde el primer día de uso real, el negocio real de Bagner se usa solo para trabajo real.** Las pruebas y demostraciones se hacen en el negocio de pruebas de Mauricio ("MAURICIO LIMITADA") o en su computador. **VISTO:** `docs/puesta-en-marcha.md`, sección "Regla después de la puesta en marcha".
- Cotizaciones, ventas, compras, recepciones y movimientos de inventario **no se pueden eliminar físicamente**: una prueba deja huella en la numeración, el stock y los reportes. Si algo se crea por error, se anula, cancela o archiva desde su módulo. **VISTO:** `docs/puesta-en-marcha.md`.
- **No uses "Eliminar empresa"** (Empresa → Eliminar empresa) para repetir la puesta en marcha: no libera la reserva del RUT. **VISTO:** `docs/puesta-en-marcha.md`, paso 4.
- La numeración de un negocio nuevo parte desde 0001; la primera cotización real sería la `COT-<año>-0001`. **VISTO:** `docs/puesta-en-marcha.md`, paso 10. **PENDIENTE DE CONFIRMAR** el formato exacto en pantalla.

## 8. Si algo falla

El repositorio **no define** un canal de soporte ni quién responde. Hasta que se acuerde, la tabla queda así:

| Situación | A quién acudir | Dónde consta |
|---|---|---|
| No puedo entrar o no me llega el correo de verificación | Primero revisa spam y usa "¿Olvidaste tu contraseña?". Si sigue fallando, avisa a Mauricio. | Recuperación: `Login.jsx:594`. Canal y tiempo de respuesta: **PENDIENTE DE CONFIRMAR** |
| Una pantalla da error o un botón no responde | Mauricio, como mantenedor del sistema. | **VISTO:** `docs/BUSINESS_ONBOARDING.md` (último párrafo: "contacta al mantenedor") y `docs/guia-practicantes.md:3`. Medio de contacto: **PENDIENTE DE CONFIRMAR** |
| Una cifra del reporte no cuadra | Mauricio. Antes, revisa el ícono "i" de esa cifra y si aparece "Parcial". | `ReportsInfoTip.jsx`; `ReportsProfitNotice.jsx:28` |
| La verificación de la empresa no avanza | Mauricio, que revisa las solicitudes desde la consola de la plataforma. | **VISTO:** `src/app/App.jsx:212`. Plazo: **PENDIENTE DE CONFIRMAR** |
| Los correos de cotización no llegan al cliente | Mauricio (servicio de correo). | **VISTO:** `functions/quoteEmail.js`. Plan y límites del servicio: **PENDIENTE DE CONFIRMAR** |
| Dudas sobre privacidad y datos personales | El correo de privacidad que figura en los textos legales es `bruno.pairumani@bagner.cl`, es decir, el tuyo. | **VISTO:** `src/domain/legalDocumentsContent.mjs:15` |

**Cuando avises de un problema, ayuda mucho decir:** qué pantalla estabas usando, qué querías hacer, qué mensaje apareció, a qué hora fue y con qué correo entraste. Una foto de la pantalla ayuda. Esta recomendación no viene del repositorio.

## 9. Lo que todavía falta confirmar antes de usar el sistema en serio

- [ ] Qué versión está publicada hoy en `valoracloud.bagner.cl` y qué cambios están pendientes de subir.
- [ ] Si el negocio de prueba de Bagner ya se eliminó y si el negocio real ya se creó.
- [ ] Quién es el contacto de soporte, por qué medio y en qué horario.
- [ ] La dirección de envío de los correos y la verificación de su dominio.
- [ ] Planes, límites y costos de los servicios externos (ver el acta de entrega).
- [ ] Revisión legal de los textos de términos y privacidad.
- [ ] Una prueba de punta a punta con Bruno: cotización, venta, compra, recepción y reportes, en el negocio de pruebas.
