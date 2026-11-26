# Perfiles de acceso en Clínica Veterinaria

En `baseline-v4`, la empresa con rubro **Clínica veterinaria** muestra **Resumen clínico**, **Pacientes** y **Agenda** dentro de **Operación** para los perfiles autorizados.

| Pantalla o flujo | Perfil que lo usa | Acceso actual |
| --- | --- | --- |
| Resumen clínico | Propietario y Administrador | Consultar el resumen y las cifras de servicios y farmacia. |
| Pacientes, ficha e historial clínico | Propietario y Administrador | Buscar, registrar y editar pacientes, y consultar su historial. |
| Agenda, registro y detalle de cita | Propietario y Administrador | Consultar y agendar citas. El estado de la cita determina si se puede reprogramar o cancelar. |
| Recepción y triage | Propietario y Administrador | Registrar la llegada desde Agenda o recibir directamente en Órdenes de atención, incluidas las emergencias. |
| Órdenes de atención | Propietario y Administrador | Crear una orden, asignar box, tipo y profesional, o cancelar una orden en espera. |
| Atención clínica, fotos, recetas y cierre | Profesional asignado con acceso de Propietario o Administrador | Iniciar una orden nueva, guardar el borrador, registrar fotos y marcas, emitir una receta y cerrar. |

Propietarios y administradores pueden consultar las órdenes. Las atenciones previas conservan sus permisos originales. Consulta el [flujo de órdenes](./FLUJO-ORDENES.md).

En una empresa de rubro Clínica veterinaria, el **Técnico** aterriza en **Inventario**. Su perfil no incluye acceso a las pantallas ni a los registros veterinarios. Los permisos de este perfil quedan pendientes de revisión con Bruno.

Referencia técnica: las rutas de Veterinaria requieren `veterinaria.read`. Las reglas de Firestore limitan la lectura a `OWNER` y `ADMIN` en empresas con el módulo habilitado, y las Functions veterinarias verifican dichos roles para operar.
