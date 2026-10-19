// Textos iniciales de /privacidad y /terminos (SPEC 024, etapa 3). Fuente:
// docs/specs/024-textos-iniciales-legal.md. Son datos puros, sin lógica de UI.
// Los marcadores [CONFIRMAR ...] y [A DEFINIR ...] son parte del texto y se
// conservan hasta la revisión legal. Los datos del proveedor viven una sola
// vez en LEGAL_PROVIDER.
import {LEGAL_DOCUMENT_KEYS} from "./legalDocuments.mjs";

export const LEGAL_NOTICE =
  "Versión inicial. Este texto está pendiente de revisión legal por parte de Bagner.";

export const LEGAL_PROVIDER = Object.freeze({
  razonSocial: "Servicios Integrales Bagner SpA",
  rut: "77.091.679-8",
  domicilio: "Tamarugal 2985, Iquique, Chile",
  correoPrivacidad: "bruno.pairumani@bagner.cl",
  sitio: "https://valoracloud.bagner.cl",
});

const P = LEGAL_PROVIDER;

const paragraph = (text) => Object.freeze({type: "paragraph", text});
const list = (items) =>
  Object.freeze({
    type: "list",
    items: Object.freeze(items.map((item) => Object.freeze(item))),
  });
const section = (title, ...blocks) =>
  Object.freeze({title, blocks: Object.freeze(blocks)});

const PRIVACY_SECTIONS = [
  section(
    "1. Quién es responsable",
    paragraph(
      `ValoraCloud es un sistema de inventario, cotizaciones, ventas, compras y proyectos, operado por ${P.razonSocial}, RUT ${P.rut}, domicilio ${P.domicilio} ("Bagner"). Para consultas de privacidad: ${P.correoPrivacidad}.`
    )
  ),
  section(
    "2. Dos roles distintos",
    list([
      {
        label: "Datos de tu cuenta de usuario",
        text: "(los que entregas al registrarte y usar el sistema): Bagner los trata como responsable.",
      },
      {
        label:
          "Datos de clientes, proveedores y otras personas que cada negocio carga en el sistema:",
        text: "el responsable es el negocio que los ingresa. Bagner los trata por encargo de ese negocio, solo para prestar el servicio.",
      },
    ])
  ),
  section(
    "3. Qué datos tratamos",
    list([
      {
        label: "Cuenta:",
        text: "correo electrónico y datos de acceso; si los completas, nombres y apellidos, tipo y número de documento y teléfono.",
      },
      {
        label: "Negocio y equipo:",
        text: "razón social, identificador fiscal o RUT, giro, correo, teléfono, dirección, responsable, e identidad y rol de los miembros del equipo.",
      },
      {
        label: "Invitaciones de equipo:",
        text: "el correo de las personas invitadas a un equipo, incluso si todavía no tienen cuenta, para gestionar la invitación. Cada invitación tiene una vigencia de 7 días. Las invitaciones respondidas o vencidas se conservan hasta que se defina su plazo de eliminación. [A DEFINIR plazo de eliminación de invitaciones]",
      },
      {
        label: "Clientes y proveedores del negocio:",
        text: "nombre o razón social, identificador fiscal o RUT, correo, teléfono, dirección, persona de contacto y notas.",
      },
      {
        label: "Archivos:",
        text: "logotipos de empresa, evidencia de verificación empresarial (PDF, JPG o PNG) [CONFIRMAR qué documento se solicita] y evidencia de gastos de proyectos.",
      },
      {
        label: "Documentos importados:",
        text: "facturas u otros documentos que el usuario sube para importar productos, que pueden contener datos de proveedores y del negocio receptor.",
      },
    ])
  ),
  section(
    "4. Para qué los usamos",
    paragraph(
      "Prestar el servicio (autenticación, gestión de inventario, cotizaciones, ventas, compras y proyectos), enviar correos que el propio usuario solicita (por ejemplo cotizaciones y órdenes de compra), verificar negocios, dar soporte y mantener la seguridad del sistema."
    )
  ),
  section(
    "5. Con quién los compartimos",
    paragraph(
      "Usamos proveedores tecnológicos que reciben datos solo para prestar el servicio:"
    ),
    list([
      {
        label: "Google (Firebase):",
        text: "autenticación, base de datos y almacenamiento de archivos.",
      },
      {
        label: "Google (Gemini):",
        text: "cuando se usan funciones de inteligencia artificial, se envía el contenido necesario para esa función: documentos o planillas subidos para importar productos, y descripciones de proyecto para sugerencias de cotización. [CONFIRMAR plan de Gemini y sus condiciones de uso de datos]",
      },
      {
        label: "Resend:",
        text: "envío de correos de cotización y de órdenes de compra, que incluyen el correo del destinatario, el mensaje y el PDF adjunto con datos del negocio y del cliente o proveedor.",
      },
      {
        label: "Serper:",
        text: "consultas de referencias de precios, que incluyen datos del producto (marca, modelo, nombre o código de barras). No se envían datos personales.",
      },
    ]),
    paragraph(
      "Estos proveedores pueden tratar datos fuera de Chile. [CONFIRMAR ubicación y garantías de cada proveedor]"
    )
  ),
  section(
    "6. Enlaces públicos de cotización",
    paragraph(
      "Cuando un negocio comparte una cotización por enlace, cualquier persona con el enlace puede verla hasta su vencimiento. La página muestra datos del negocio (nombre comercial, razón social, RUT, giro, correo, teléfono, dirección y logotipo), el nombre o empresa del cliente, la persona de contacto, el proyecto, los ítems, precios y condiciones. No muestra el RUT, el correo ni el teléfono del cliente."
    )
  ),
  section(
    "7. Cuánto tiempo los conservamos",
    paragraph(
      "[CONFIRMAR plazos de conservación]. Los registros de ventas y compras pueden tener plazos de conservación por obligaciones tributarias y contables."
    )
  ),
  section(
    "8. Tus derechos",
    paragraph(
      `Entre otros, los derechos de acceso, rectificación, supresión, oposición y portabilidad de tus datos personales, en los términos de la ley chilena de protección de datos personales. Para ejercerlos, escribe a ${P.correoPrivacidad}. Si tus datos fueron ingresados por un negocio, también puedes dirigirte a ese negocio.`
    )
  ),
  section(
    "9. Seguridad",
    paragraph(
      "Aplicamos controles de acceso por rol, separación de datos por negocio y reglas que impiden la escritura directa desde el navegador. Ningún sistema es completamente invulnerable."
    )
  ),
  section(
    "10. Cookies y analítica",
    paragraph(
      "ValoraCloud no usa analítica de terceros ni píxeles de seguimiento. Usa el almacenamiento del navegador necesario para mantener tu sesión iniciada."
    )
  ),
  section(
    "11. Cambios en esta política",
    paragraph(
      "Si cambia, publicaremos una nueva versión y te pediremos aceptarla en tu siguiente ingreso."
    )
  ),
  section("12. Contacto", paragraph(`${P.correoPrivacidad}.`)),
];

const TERMS_SECTIONS = [
  section(
    "1. Quiénes somos y qué ofrecemos",
    paragraph(
      `ValoraCloud es un sistema de inventario, cotizaciones, ventas, compras y gestión de proyectos, operado por ${P.razonSocial} (RUT ${P.rut}). Al crear una cuenta o seguir usando el sistema aceptas estos términos y la Política de privacidad.`
    )
  ),
  section(
    "2. Cuentas",
    paragraph(
      "Debes entregar información veraz, mantener la confidencialidad de tu contraseña y avisar si sospechas un uso no autorizado. Eres responsable de la actividad realizada con tu cuenta."
    )
  ),
  section(
    "3. Uso aceptable",
    paragraph(
      "No puedes usar el sistema para fines ilegales, intentar acceder a datos de otros negocios, vulnerar su seguridad, ni subir contenido que no tengas derecho a usar."
    )
  ),
  section(
    "4. Datos que cargas",
    paragraph(
      "Eres responsable de los datos de clientes, proveedores y terceros que ingreses, y de contar con el derecho de tratarlos. Bagner los trata por tu encargo para prestar el servicio, según la Política de privacidad."
    )
  ),
  section(
    "5. Funciones con inteligencia artificial y referencias de precios",
    paragraph(
      "Las sugerencias generadas con inteligencia artificial y las referencias de precios de mercado son orientativas y pueden contener errores. Debes revisarlas antes de usarlas en cotizaciones, compras o decisiones de negocio."
    )
  ),
  section(
    "6. Disponibilidad",
    paragraph(
      'Intentamos mantener el sistema disponible, pero se ofrece "tal como está", puede tener interrupciones por mantención o fallas, y no garantizamos disponibilidad continua. [A DEFINIR con asesoría legal]'
    )
  ),
  section(
    "7. Limitación de responsabilidad",
    paragraph("[A DEFINIR con asesoría legal]")
  ),
  section(
    "8. Propiedad",
    paragraph(
      `El sistema, su código y su diseño son de ${P.razonSocial}. Los datos que cargas siguen siendo tuyos o de tu negocio.`
    )
  ),
  section(
    "9. Terminación y exportación de datos",
    paragraph(
      "Puedes dejar de usar el sistema cuando quieras. [A DEFINIR: procedimiento de cierre de cuenta y exportación de datos]. Podemos suspender cuentas que incumplan estos términos o pongan en riesgo la seguridad."
    )
  ),
  section(
    "10. Cambios",
    paragraph(
      "Podemos actualizar estos términos. Publicaremos la nueva versión y te pediremos aceptarla en tu siguiente ingreso."
    )
  ),
  section(
    "11. Ley aplicable",
    paragraph(
      "Estos términos se rigen por las leyes de Chile. [A DEFINIR con asesoría legal: tribunales competentes]"
    )
  ),
  section("12. Contacto", paragraph(`${P.correoPrivacidad}.`)),
];

export const LEGAL_DOCUMENTS_CONTENT = Object.freeze({
  [LEGAL_DOCUMENT_KEYS.PRIVACY]: Object.freeze({
    sections: Object.freeze(PRIVACY_SECTIONS),
  }),
  [LEGAL_DOCUMENT_KEYS.TERMS]: Object.freeze({
    sections: Object.freeze(TERMS_SECTIONS),
  }),
});
