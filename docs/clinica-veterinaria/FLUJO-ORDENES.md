# Flujo de órdenes de Clínica Veterinaria

## Entradas al flujo

- Con cita. Al agendar o reprogramar puedes indicar el profesional a cargo. Registra la llegada y el triage en Agenda. Al crear la orden desde la cita en espera, se conserva el responsable asignado.
- Sin cita. Abre **Órdenes de atención** desde Resumen clínico y selecciona **Recibir sin cita**. Selecciona un paciente registrado e indica hora, prioridad y motivo.
- Emergencia. Selecciona **Nueva emergencia** en Órdenes de atención. Usa un paciente registrado y confirma la prioridad de recepción. El sistema la presenta primero en la cola, según la prioridad registrada y la hora de llegada.
- Solo compra. Desde Órdenes de atención, selecciona **Venta directa**. Se abre el flujo comercial de ValoraCloud. Una venta de mostrador no crea cita ni orden clínica.

## Desde la recepción hasta el cierre

1. La cola de órdenes muestra las recepciones en espera y las consultas en atención.
2. Abre la orden. Asigna box, tipo de atención y profesional a cargo antes de iniciar.
3. El profesional asignado inicia la consulta con su cuenta. La pantalla muestra los datos de la orden y hasta tres atenciones anteriores finalizadas del paciente. La ficha conserva el historial completo y las fotos.
4. Completa el registro clínico y guarda el borrador cuando corresponda. También puedes registrar fotos y marcas.
5. Desde **Recetas veterinarias**, el profesional asignado puede ingresar los medicamentos, dosis, frecuencia, duración e indicaciones que él determine. La aplicación guarda la receta emitida, su autor y su fecha en el historial. Usa **Imprimir receta** desde la atención o el historial para abrir la hoja A4 con los datos guardados y el espacio de firma y timbre.
6. En **Servicios y productos utilizados**, registra la consulta y los medicamentos o productos efectivamente usados, con sus cantidades. Los medicamentos que solo se recetaron quedan en la receta.
7. Cierra la atención. Se libera el box y, cuando existe una cita vinculada, esta refleja el cierre. La orden finalizada aparece en el historial y genera una venta en borrador a nombre del tutor.
8. Quien tenga permiso de Ventas puede abrir el borrador, revisarlo y confirmarlo. Los ítems se cargan con el precio de inventario al momento del cierre. Al confirmar se descuenta el stock de los productos. Si falta stock, Ventas deja el borrador pendiente y mantiene cerrada la atención clínica.

## Compatibilidad y permisos de revisión

Se conservan las atenciones anteriores y sus fotos. Las nuevas órdenes usan un identificador de atención propio y la cita es opcional. La consulta debe incluir al menos un servicio o producto del catálogo para generar la venta. Las atenciones del flujo anterior que se cierran sin ítems siguen guardándose en el historial.

Propietario y Administrador gestionan la agenda, la recepción y las asignaciones. Para incorporar un veterinario, crea un perfil en **Empleados → Perfiles y permisos** y activa **Veterinaria · atenciones asignadas**. El perfil puede asignarse al invitar o desde **Usuarios con acceso**.

Con ese perfil, cada profesional dispone de **Mis citas** y **Mis órdenes**. Puede consultar la ficha y las atenciones finalizadas del paciente vinculado a una cita u orden propia, incluso cuando otro profesional lo atendió anteriormente. Las órdenes propias finalizadas siguen disponibles como referencia clínica. Una cita cancelada por sí sola no concede acceso a la ficha. Reasignar una cita u orden cambia la visibilidad al nuevo responsable.

El profesional registra y cierra sus órdenes una vez que administración asigna box y tipo de atención. Desde la consulta puede registrar fotos, emitir recetas y consultar el catálogo de servicios y productos para registrar su uso clínico. La creación del borrador forma parte del cierre. Los permisos de Ventas siguen controlando quién puede revisar y confirmar el documento comercial.

Validar con el equipo los nombres y la configuración de los boxes y tipos de atención y el formato de receta que la clínica quiera entregar. El ingreso de emergencia actual parte de un paciente registrado.

## Confirmación y recordatorio de citas por correo

Al agendar en **Agenda**, se registra una confirmación para el correo del tutor vinculado en **Clientes**. Al cambiar el horario se registra una confirmación con el nuevo horario y se actualiza el recordatorio. El aviso incluye el nombre de la clínica y de la mascota, la fecha y la hora local.

El recordatorio se envía 24 horas antes. Para citas agendadas con hasta 24 horas de anticipación se envía una hora antes, si queda más de una hora. Las citas más próximas reciben la confirmación. El sistema conserva la cita cuando falta el correo y omite los avisos de citas canceladas, ya recibidas o vencidas al procesar la cola.

### Activación para Mauricio

1. Publicar el índice de grupo de colecciones de `avisosCitasVeterinarias.procesarEn` definido en `firestore.indexes.json` y esperar a que esté disponible.
2. Verificar los secretos `RESEND_API_KEY` y `RESEND_FROM_EMAIL` del proyecto y el dominio del remitente. Definir `VETERINARY_APPOINTMENT_EMAILS_ENABLED=true` en el entorno de Functions si los avisos se deben activar en ese despliegue.
3. Desplegar `guardarCitaVeterinaria` y la Function programada `enviarAvisosCitasVeterinarias` con Cloud Scheduler habilitado. La Function procesa avisos pendientes cada minuto y omite el envío en emuladores. Al activarla, puede procesar avisos pendientes de citas futuras.
4. Para revisar la integración, ejecutar `npm run test:veterinary-appointment-notices`. Usa un proveedor simulado, y valida la confirmación, la zona horaria, el recordatorio, la reprogramación, la cancelación y los reintentos sin correos duplicados.

El canal implementado es correo. La entrega por WhatsApp requiere integrar un proveedor de mensajería.
