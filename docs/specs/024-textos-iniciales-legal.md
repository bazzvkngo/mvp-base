\# SPEC 024: textos iniciales de /privacidad y /terminos



Fuente de contenido para la etapa 3. \*\*Versión inicial, borrador técnico a nombre de Bagner, sin revisión legal.\*\* Los datos del proveedor ya están completos y viven una sola vez en una constante única (`LEGAL\_PROVIDER`, en `src/domain/legalDocumentsContent.mjs`, que es la fuente de verdad del texto de la aplicación). Lo marcado `\[CONFIRMAR]` (o `\[A DEFINIR]`) sigue pendiente: es una afirmación que no pudo verificarse en el código y que debe confirmarse antes de la revisión legal.



Aviso visible en ambas páginas, al inicio:



> Versión inicial. Este texto está pendiente de revisión legal por parte de Bagner.



Constante de datos del proveedor (única fuente):



\- Razón social: Servicios Integrales Bagner SpA

\- RUT: 77.091.679-8

\- Domicilio: Tamarugal 2985, Iquique, Chile

\- Correo de contacto de privacidad: bruno.pairumani@bagner.cl

\- Sitio: `https://valoracloud.bagner.cl`



\---



\## Documento 1: Política de privacidad



\### 1. Quién es responsable

ValoraCloud es un sistema de inventario, cotizaciones, ventas, compras y proyectos, operado por Servicios Integrales Bagner SpA, RUT 77.091.679-8, domicilio Tamarugal 2985, Iquique, Chile ("Bagner"). Para consultas de privacidad: bruno.pairumani@bagner.cl.



\### 2. Dos roles distintos

\- \*\*Datos de tu cuenta de usuario\*\* (los que entregas al registrarte y usar el sistema): Bagner los trata como responsable.

\- \*\*Datos de clientes, proveedores y otras personas que cada negocio carga en el sistema:\*\* el responsable es el negocio que los ingresa. Bagner los trata por encargo de ese negocio, solo para prestar el servicio.



\### 3. Qué datos tratamos

\- \*\*Cuenta:\*\* correo electrónico y datos de acceso; si los completas, nombres y apellidos, tipo y número de documento y teléfono.

\- \*\*Negocio y equipo:\*\* razón social, identificador fiscal o RUT, giro, correo, teléfono, dirección, responsable, e identidad y rol de los miembros del equipo.

\- \*\*Invitaciones de equipo:\*\* el correo de las personas invitadas a un equipo, incluso si todavía no tienen cuenta, para gestionar la invitación. Cada invitación tiene una vigencia de 7 días. Las invitaciones respondidas o vencidas se conservan hasta que se defina su plazo de eliminación. `\[A DEFINIR plazo de eliminación de invitaciones]`

\- \*\*Clientes y proveedores del negocio:\*\* nombre o razón social, identificador fiscal o RUT, correo, teléfono, dirección, persona de contacto y notas.

\- \*\*Archivos:\*\* logotipos de empresa, evidencia de verificación empresarial (PDF, JPG o PNG) `\[CONFIRMAR qué documento se solicita]` y evidencia de gastos de proyectos.

\- \*\*Documentos importados:\*\* facturas u otros documentos que el usuario sube para importar productos, que pueden contener datos de proveedores y del negocio receptor.



\### 4. Para qué los usamos

Prestar el servicio (autenticación, gestión de inventario, cotizaciones, ventas, compras y proyectos), enviar correos que el propio usuario solicita (por ejemplo cotizaciones y órdenes de compra), verificar negocios, dar soporte y mantener la seguridad del sistema.



\### 5. Con quién los compartimos

Usamos proveedores tecnológicos que reciben datos solo para prestar el servicio:

\- \*\*Google (Firebase):\*\* autenticación, base de datos y almacenamiento de archivos.

\- \*\*Google (Gemini):\*\* cuando se usan funciones de inteligencia artificial, se envía el contenido necesario para esa función: documentos o planillas subidos para importar productos, y descripciones de proyecto para sugerencias de cotización. `\[CONFIRMAR plan de Gemini y sus condiciones de uso de datos]`

\- \*\*Resend:\*\* envío de correos de cotización y de órdenes de compra, que incluyen el correo del destinatario, el mensaje y el PDF adjunto con datos del negocio y del cliente o proveedor.

\- \*\*Serper:\*\* consultas de referencias de precios, que incluyen datos del producto (marca, modelo, nombre o código de barras). No se envían datos personales.



Estos proveedores pueden tratar datos fuera de Chile. `\[CONFIRMAR ubicación y garantías de cada proveedor]`



\### 6. Enlaces públicos de cotización

Cuando un negocio comparte una cotización por enlace, cualquier persona con el enlace puede verla hasta su vencimiento. La página muestra datos del negocio (nombre comercial, razón social, RUT, giro, correo, teléfono, dirección y logotipo), el nombre o empresa del cliente, la persona de contacto, el proyecto, los ítems, precios y condiciones. No muestra el RUT, el correo ni el teléfono del cliente.



\### 7. Cuánto tiempo los conservamos

`\[CONFIRMAR plazos de conservación]`. Los registros de ventas y compras pueden tener plazos de conservación por obligaciones tributarias y contables.



\### 8. Tus derechos

Entre otros, los derechos de acceso, rectificación, supresión, oposición y portabilidad de tus datos personales, en los términos de la ley chilena de protección de datos personales. Para ejercerlos, escribe a bruno.pairumani@bagner.cl. Si tus datos fueron ingresados por un negocio, también puedes dirigirte a ese negocio.



\### 9. Seguridad

Aplicamos controles de acceso por rol, separación de datos por negocio y reglas que impiden la escritura directa desde el navegador. Ningún sistema es completamente invulnerable.



\### 10. Cookies y analítica

ValoraCloud no usa analítica de terceros ni píxeles de seguimiento. Usa el almacenamiento del navegador necesario para mantener tu sesión iniciada.



\### 11. Cambios en esta política

Si cambia, publicaremos una nueva versión y te pediremos aceptarla en tu siguiente ingreso.



\### 12. Contacto

bruno.pairumani@bagner.cl.



\---



\## Documento 2: Términos de uso



\### 1. Quiénes somos y qué ofrecemos

ValoraCloud es un sistema de inventario, cotizaciones, ventas, compras y gestión de proyectos, operado por Servicios Integrales Bagner SpA (RUT 77.091.679-8). Al crear una cuenta o seguir usando el sistema aceptas estos términos y la Política de privacidad.



\### 2. Cuentas

Debes entregar información veraz, mantener la confidencialidad de tu contraseña y avisar si sospechas un uso no autorizado. Eres responsable de la actividad realizada con tu cuenta.



\### 3. Uso aceptable

No puedes usar el sistema para fines ilegales, intentar acceder a datos de otros negocios, vulnerar su seguridad, ni subir contenido que no tengas derecho a usar.



\### 4. Datos que cargas

Eres responsable de los datos de clientes, proveedores y terceros que ingreses, y de contar con el derecho de tratarlos. Bagner los trata por tu encargo para prestar el servicio, según la Política de privacidad.



\### 5. Funciones con inteligencia artificial y referencias de precios

Las sugerencias generadas con inteligencia artificial y las referencias de precios de mercado son orientativas y pueden contener errores. Debes revisarlas antes de usarlas en cotizaciones, compras o decisiones de negocio.



\### 6. Disponibilidad

Intentamos mantener el sistema disponible, pero se ofrece "tal como está", puede tener interrupciones por mantención o fallas, y no garantizamos disponibilidad continua. `\[A DEFINIR con asesoría legal]`



\### 7. Limitación de responsabilidad

`\[A DEFINIR con asesoría legal]`



\### 8. Propiedad

El sistema, su código y su diseño son de Servicios Integrales Bagner SpA. Los datos que cargas siguen siendo tuyos o de tu negocio.



\### 9. Terminación y exportación de datos

Puedes dejar de usar el sistema cuando quieras. `\[A DEFINIR: procedimiento de cierre de cuenta y exportación de datos]`. Podemos suspender cuentas que incumplan estos términos o pongan en riesgo la seguridad.



\### 10. Cambios

Podemos actualizar estos términos. Publicaremos la nueva versión y te pediremos aceptarla en tu siguiente ingreso.



\### 11. Ley aplicable

Estos términos se rigen por las leyes de Chile. `\[A DEFINIR con asesoría legal: tribunales competentes]`



\### 12. Contacto

bruno.pairumani@bagner.cl.

