# Objetivo

Completar primero una base ERP funcional, multiempresa y sin inteligencia artificial antes de avanzar hacia automatizaciones inteligentes.

# Alcance del MVP

- Login y recuperación de acceso.
- Una o más empresas por usuario.
- Información y configuración de empresa.
- Productos y servicios.
- Categorías.
- Inventario manual.
- Importación de inventario desde Excel.
- Control de compras y ventas.
- Cotizaciones vinculadas con clientes registrados.
- Clientes con RUT.
- Proveedores.
- Empleados y permisos.
- Órdenes de compra.
- Configuración de cuenta y cambio de contraseña.
- Reportes.

# Fuera del alcance inmediato

- Referencias automáticas.
- Sugerencias mediante Gemini.
- Procesamiento inteligente.
- Automatizaciones dependientes de IA.

El código de IA existente se conserva, pero no forma parte del flujo principal del MVP y no debe ampliarse ni eliminarse sin autorización.

# Orden de desarrollo

1. Clientes.
2. Proveedores.
3. Órdenes de compra.
4. Integración entre compras, ventas, inventario y finanzas.
5. Empleados y permisos.
6. Cuenta y seguridad.
7. Reportes.
8. Auditoría productiva.
9. Fase IA.

# Avance real

- Clientes e integración con Cotizaciones: terminados según las especificaciones 001 y 002.
- Proveedores: terminado según la especificación 004, con persistencia autoritativa, RUT único por negocio, roles, archivado lógico e interfaz responsive.
- Órdenes de Compra: terminado según la especificación 005, con revisión visual manual aprobada.
- Compras: terminado según la especificación 006, con revisión funcional y visual manual aprobada.
- Ventas: terminado e implementado, con QA manual aprobado; incluye historial de ventas, venta directa y desde cotización aceptada, numeración `VTA-YYYY-NNNN`, estados borrador / confirmada / cancelada, snapshot histórico de cliente e ítems, conservación de descuentos, IVA y tratamiento tributario desde cotización, descuento de stock solo para productos, movimientos de inventario `salida_venta`, rechazo completo por stock insuficiente, confirmación atómica, idempotencia y protección ante concurrencia, aislamiento multiempresa, escritura para OWNER/ADMIN y lectura para MEMBER, impresión y vínculo histórico Cotización -> Venta.
- Inventario manual e importación local desde Excel/CSV: renovados según la especificación 003; pendientes de aceptación manual final en emuladores y anchos objetivo.

# Criterio general de terminado

Un módulo no está terminado solo porque tenga interfaz. Debe incluir:

- persistencia;
- aislamiento multiempresa;
- permisos;
- validación backend;
- estados de carga, vacío y error;
- diseño responsive;
- pruebas;
- documentación;
- ausencia de regresiones.
