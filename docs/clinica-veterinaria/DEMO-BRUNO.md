# Demo de Veterinaria para Bruno

Duración orientativa: 7–10 minutos. Usar emuladores, empresa de demostración, usuario OWNER o ADMIN y módulo habilitado. Solo nombres, antecedentes y fotos de prueba; sin RUT, claves ni datos reales.

1. **Paciente y tutor.** Abrir un paciente ficticio, mostrar su tutor de Clientes y los antecedentes. Explicar que la ficha pertenece a una empresa y que el perfil del trabajador sigue pendiente.
2. **Cita.** Agendar un control, indicar la hora y explicar la zona de referencia por país. Intentar el mismo cupo con otro paciente para mostrar el aviso; reprogramar y comprobar que conserva el estado confirmado si ya lo tenía.
3. **Recepción.** Registrar llegada, prioridad y triage. Pasar la cita a espera y luego iniciar la atención.
4. **Atención.** Completar motivo, diagnóstico, tratamiento e indicaciones. Asociar un producto o servicio de demostración y aclarar que es una referencia informativa: todavía no descuenta stock ni crea una venta.
5. **Fotos.** Seleccionar fotos de prueba por vista, revisar la lista y subirlas. Marcar una zona y enfocar la lesión; cambiar de vista para mostrar que son fotos de esa mascota. Guardar las marcas antes del cierre.
6. **Cierre e historial.** Completar el resultado clínico, cerrar al final y abrir la ficha. Mostrar la atención finalizada y consultar sus fotos y marcas desde el historial.
7. **Decisiones.** Confirmar con Bruno las tres definiciones siguientes y dejar registrados responsable, acuerdo y siguiente paso. No presentarlas como funciones ya implementadas.

## Decisiones para conversar

- **Stock insuficiente al cerrar:** ¿bloquear el cierre, permitir con aviso o permitir saldo negativo? Propuesta para discutir: conservar el cierre clínico y dejar el consumo pendiente con aviso, para no perder el registro de la atención; el movimiento de inventario debe usar el mecanismo del Core. No se programa hasta aprobar el criterio.
- **Retención de fotos:** ¿cuánto tiempo conservar los archivos retirados, quién puede consultarlos y quién autoriza su eliminación? Hoy la lista en la atención conserva las últimas 24 retiradas y mantiene identificadores para impedir reutilizarlos; esa rotación no elimina los archivos ni define un plazo de retención.
- **Selector de tutor sin RUT:** confirmar mostrar solo el nombre y cargar exclusivamente clienteId, negocioId, nombre y estado desde una Function propia mediante loadClients, coordinada con la integración de Matías y sin modificar ClientSelector.jsx. Acordar cómo distinguir tutores con el mismo nombre sin exponer datos personales.
