# Manual de uso — Taller Automotriz

El módulo Taller Automotriz permite registrar vehículos de Clientes Core y gestionar su atención mediante Órdenes de Trabajo (OT), desde la recepción hasta la entrega.

Este manual se divide en tres partes según la responsabilidad de la persona: usuario, trabajador y administrador. No contiene contraseñas, claves, identificadores fiscales ni datos reales de personas o empresas.

## 1. Usuario

Esta sección sirve para cualquier persona que ingresa al módulo y necesita entender qué puede consultar, cómo acceder y cuáles son sus límites.

### 1.1 Para qué sirve Taller

Taller permite:

- consultar vehículos asociados a Clientes del Core;
- consultar OTs, su estado, aprobación, Plaza e historial;
- registrar y mantener vehículos cuando el rol lo permite;
- documentar recepción, diagnósticos, servicios y productos planificados;
- aprobar, ejecutar, finalizar y entregar una OT según los permisos del rol;
- conservar trazabilidad sin borrar la historia operacional.

Los datos se mantienen separados por empresa. La empresa activa solo determina el contexto de navegación: el acceso efectivo exige una membresía activa, permisos suficientes y que Taller esté habilitado para esa empresa.

### 1.2 Quién puede entrar

| Rol | Acceso principal |
| --- | --- |
| `OWNER` | Consulta, crea y opera Vehículos y OTs; aprueba o rechaza alcances; administra Plazas. |
| `ADMIN` | Tiene las mismas capacidades operacionales de Taller que `OWNER`. |
| `TECNICO` | Consulta, registra Vehículos y OTs y realiza la operación técnica. No administra Plazas ni aprueba alcances. |
| `MEMBER` | Consulta y opera OTs existentes. No crea Vehículos u OTs, no administra Plazas ni aprueba alcances. Si usa un perfil personalizado, ese perfil también debe incluir Taller. |
| `VENTAS`, `COMPRAS`, `FINANZAS` | No tienen permisos de Taller. |
| Superadministrador de plataforma | Habilita o deshabilita Taller para una empresa. Ese privilegio no concede por sí solo acceso a la operación diaria. |

La aprobación y el rechazo derivan de `TALLER_MANAGE`, capacidad disponible para `OWNER` y `ADMIN`. Taller no crea permisos económicos paralelos: la visibilidad de costos y precios depende de los permisos Core `INVENTORY_COSTS_READ` y `PRICING_READ`.

### 1.3 Requisitos de acceso

Antes de entrar, comprueba que:

1. La empresa está activa y verificada.
2. Tu membresía en la empresa está activa.
3. Taller está habilitado para esa empresa.
4. Seleccionaste la empresa correcta como empresa activa.
5. Tu rol o perfil tiene acceso al módulo.

Cuando está habilitado, Taller aparece en la sección **Módulos** de la navegación. Al entrar se abre el listado de Órdenes de Trabajo.

### 1.4 Consultar información

- **Vehículos:** busca por patente, VIN, marca o modelo.
- **Órdenes de Trabajo:** busca y filtra por estado y aprobación.
- **Plazas:** consulta su estado administrativo y ocupación calculada.
- **Historial:** revisa eventos persistidos de una OT; no se editan directamente.
- **Ficha del vehículo:** consulta datos técnicos y las OTs anteriores.

La identificación y el contacto del propietario en la ficha del Vehículo están restringidos a `OWNER` y `ADMIN`. Para `TECNICO` y `MEMBER`, la interfaz muestra: **“La información del propietario está restringida para tu perfil”**.

### 1.5 Mensajes frecuentes

#### “El módulo no está habilitado para esta empresa”

Solicita a un superadministrador de plataforma que revise los módulos de la empresa. Después del cambio, recarga la sesión.

#### Taller no aparece en el menú

Comprueba la empresa activa, la habilitación de Taller, el estado de la membresía y los permisos del rol. Si la activación fue reciente, recarga la sesión o vuelve a ingresar.

#### No puedo crear Vehículos u OTs

La creación está disponible para `OWNER`, `ADMIN` y `TECNICO`. `MEMBER` puede consultar y operar registros existentes, pero no crearlos.

#### No puedo aprobar o rechazar

La decisión está restringida a `OWNER` y `ADMIN` mediante `TALLER_MANAGE`.

#### No puedo asignar una Plaza

La Plaza debe estar activa y libre. La administración y asignación de Plazas corresponde a `OWNER` y `ADMIN`.

#### La OT no permite finalizar

Todos los servicios deben estar completados. Finalizar la reparación deja la OT pendiente de entrega; todavía se debe registrar la entrega para cerrarla.

### 1.6 Limitaciones actuales

Taller no incluye:

- consumo, devolución, reserva ni descuento físico de stock;
- movimientos de Inventario creados por Taller;
- costos operacionales nuevos, Horas Hombre o margen de Taller;
- precios ingresados manualmente dentro de la OT;
- creación automática de Ventas;
- pagos o estados de pago propios;
- dashboard propio de Taller;
- fotografías o archivos adjuntos del vehículo;
- agenda, reservas horarias o notificaciones;
- garantías, retrabajos o mantenimiento preventivo;
- reapertura de OTs cerradas o canceladas;
- eliminación física de OTs o de su historial;
- una decisión automática sobre **Proyectos y trabajos** cuando Taller está habilitado.

La planificación consulta disponibilidad del catálogo, pero no garantiza stock futuro. Una cantidad planificada no representa reserva, consumo ni movimiento físico.

## 2. Trabajador

Esta sección describe la operación diaria. Aplica a `TECNICO` y a quienes tengan `TALLER_OPERATE`; las diferencias de creación se indican en cada paso.

### 2.1 Preparación antes de atender

Confirma que:

1. El Cliente ya existe y está activo en Clientes Core.
2. El Vehículo no está registrado previamente con la misma patente o VIN.
3. Los Servicios y Productos necesarios existen y están activos en Inventario Core.
4. La empresa activa corresponde a la atención que vas a registrar.
5. Si usarás una Plaza, un administrador ya creó ubicaciones activas.

El selector para registrar un Vehículo muestra únicamente el nombre de los Clientes activos. No devuelve RUT, identificador fiscal, email ni teléfono.

### 2.2 Registrar un Vehículo

Disponible para `OWNER`, `ADMIN` y `TECNICO`.

1. Entra a **Taller automotriz > Vehículos**.
2. Selecciona **Crear vehículo**.
3. Selecciona el Cliente propietario por su nombre.
4. Completa patente, VIN si está disponible, marca, modelo, año, color y tipo.
5. Selecciona **Guardar vehículo**.

La patente es obligatoria y única dentro de la empresa. El VIN es opcional; cuando se informa también debe ser único dentro de la empresa.

El año debe tener exactamente cuatro dígitos y estar entre 1900 y el año siguiente al actual. El límite superior avanza automáticamente cada año; por ejemplo, durante 2026 se acepta hasta 2027.

### 2.3 Crear una Orden de Trabajo

Disponible para `OWNER`, `ADMIN` y `TECNICO`.

1. Desde la ficha del Vehículo, selecciona **Crear OT**; también puedes entrar a **Órdenes de Trabajo > Nueva OT**.
2. Busca y selecciona el Vehículo correcto.
3. Revisa patente y descripción del Vehículo.
4. Selecciona **Crear orden de trabajo**.

El número de OT se genera automáticamente. La OT conserva como Cliente histórico al propietario vigente en el momento de crearla.

### 2.4 Registrar la Recepción

1. Abre la OT.
2. Entra a **Recepción**.
3. Completa kilometraje, nivel de combustible, accesorios y observaciones.
4. Completa todos los controles de la checklist.
5. Si existe una anomalía, descríbela en **Daños observados**.
6. Guarda la Recepción.

El kilometraje debe ser un número entero entre 0 y 2.000.000 km.

La checklist documenta condiciones visibles al recibir el Vehículo; no sustituye el Diagnóstico técnico.

### 2.5 Registrar y completar el Diagnóstico

1. Entra a **Diagnósticos**.
2. Agrega un Diagnóstico.
3. Selecciona una persona responsable.
4. Registra descripción y observaciones.
5. Guarda el borrador si falta información.
6. Cuando la evaluación esté lista, selecciona **Completar diagnóstico**.

Para enviar la OT a aprobación debe existir al menos un Diagnóstico completado. Si aparece información nueva después de completarlo, registra otro Diagnóstico en vez de reescribir el anterior.

### 2.6 Planificar Servicios y Productos

1. Entra a **Servicios y repuestos**.
2. Selecciona **Agregar servicio**.
3. Elige un Servicio activo del Core y una persona responsable.
4. Guarda el Servicio.
5. Si corresponde, selecciona **Agregar producto** dentro del Servicio.
6. Elige un Producto activo e indica una cantidad positiva válida.
7. Repite hasta completar el alcance.

Agregar o modificar Productos solo planifica el trabajo. No reserva, descuenta ni mueve stock.

### 2.7 Enviar el alcance a aprobación

Quien tiene capacidad de operación puede enviar o revalidar. Solo `OWNER` y `ADMIN` pueden aprobar o rechazar.

1. En **Alcance y aprobación**, revisa Servicios, Productos, cantidades y valores visibles.
2. Selecciona **Enviar a aprobación**.
3. Confirma la acción.
4. El backend consulta nuevamente el catálogo y congela el alcance vigente.
5. Si faltan Productos, la OT queda esperando repuestos, sin reservar ni descontar stock.
6. Espera la decisión de `OWNER` o `ADMIN`.

Si cambia un Servicio, Producto o cantidad después de una aprobación, el alcance debe enviarse nuevamente.

### 2.8 Ejecutar los Servicios

Cuando la OT está aprobada y en reparación:

1. Abre **Servicios y repuestos**.
2. En cada Servicio pendiente, selecciona **Iniciar servicio**.
3. Cuando termine, selecciona **Completar servicio**.
4. Repite hasta completar todos los Servicios.

Las acciones quedan registradas en el historial.

### 2.9 Finalizar y entregar

1. Comprueba que todos los Servicios estén completados.
2. Selecciona **Finalizar orden de trabajo**.
3. La OT pasa a pendiente de entrega.
4. Al entregar físicamente el Vehículo, selecciona **Registrar entrega**.
5. Confirma la acción.

La entrega cierra la OT. Una OT cerrada no se reabre.

### 2.10 Cancelar y consultar historial

- Usa **Historial** para revisar los eventos persistidos de la OT.
- La ficha del Vehículo muestra sus OTs anteriores.
- La cancelación solo está disponible antes de entrar en reparación.
- Una OT cancelada no se elimina ni se reabre; una nueva visita requiere otra OT.

### 2.11 Buenas prácticas del trabajador

- Confirma la empresa activa antes de operar.
- Busca el Vehículo antes de registrarlo para evitar duplicados.
- Revisa el propietario antes de crear la OT.
- Describe claramente anomalías y daños observados.
- Completa el Diagnóstico solo cuando la evaluación esté lista.
- Revisa el alcance antes de enviarlo a aprobación.
- No interpretes Productos planificados como reserva o consumo.
- No escribas contraseñas, claves, tokens ni datos sensibles en observaciones.
- Usa el historial para auditar; no intentes corregir eliminando registros.

## 3. Administrador

Esta sección distingue dos responsabilidades:

- el **superadministrador de plataforma** habilita o deshabilita Taller para una empresa;
- `OWNER` y `ADMIN` administran la operación interna: Vehículos, propietarios, Plazas y aprobaciones.

### 3.1 Activar Taller para una empresa

Esta acción corresponde únicamente al superadministrador de plataforma.

1. Ingresa a la consola de administración de plataforma.
2. Abre **Empresas**.
3. Selecciona la empresa que utilizará Taller.
4. Verifica que la empresa esté activa y habilitada para operar.
5. En **Módulos**, marca **Taller automotriz**.
6. Escribe un motivo del cambio sin contraseñas, claves ni datos sensibles.
7. Selecciona **Guardar módulos**.
8. Confirma que **Habilitados ahora** incluya Taller automotriz.
9. Pide a los usuarios recargar la sesión; si el menú no cambia, deben salir y volver a ingresar.

Habilitar el módulo no sustituye la membresía ni los permisos de cada usuario.

### 3.2 Desactivar Taller

1. Abre la empresa en la consola de plataforma.
2. Desmarca **Taller automotriz**.
3. Registra el motivo y guarda.

Al deshabilitarlo:

- el módulo se oculta y sus rutas y Functions quedan bloqueadas;
- los datos existentes no se eliminan;
- el cambio se refleja al recargar la sesión;
- una reactivación posterior recupera el acceso según el rol y la membresía.

### 3.3 Crear y administrar Plazas

Esta tarea corresponde a `OWNER` o `ADMIN`.

1. Entra a **Módulos > Taller automotriz > Plazas**.
2. Selecciona **Nueva Plaza**.
3. Escribe un nombre descriptivo, por ejemplo, “Plaza 1”.
4. Selecciona **Crear Plaza**.
5. Repite para cada ubicación física.

Una Plaza puede estar activa o inactiva. **Disponible** y **En uso** se calculan desde las OTs activas; no se editan manualmente. Una Plaza en uso no puede asignarse simultáneamente a otra OT activa.

Para asignar una Plaza a una OT:

1. Abre la OT.
2. Selecciona **Asignar Plaza**.
3. Elige una Plaza activa y disponible.
4. Confirma la asignación.

También puedes cambiar o liberar la Plaza.

### 3.4 Aprobar o rechazar un alcance

La decisión deriva de `TALLER_MANAGE` y corresponde a `OWNER` y `ADMIN`.

1. Abre una OT en estado de espera de aprobación.
2. Revisa el Diagnóstico, los Servicios, los Productos, las cantidades y los valores visibles.
3. Selecciona **Aprobar** para permitir que la OT avance o **Rechazar** para devolver el alcance a revisión.
4. Si rechazas, registra un motivo útil sin información sensible.
5. Confirma la acción.

La decisión se valida nuevamente en backend. Si el alcance cambió, deberá enviarse otra vez.

### 3.5 Administrar Vehículos y propietarios

`OWNER` y `ADMIN` pueden:

- editar los datos descriptivos de un Vehículo;
- consultar la identificación y el contacto del propietario en la ficha;
- abrir **Cambiar propietario** usando el selector completo de Clientes Core;
- confirmar un nuevo propietario sin modificar el Cliente histórico de OTs anteriores.

Estas capacidades no están disponibles para `TECNICO` ni `MEMBER`.

### 3.6 Preparar dependencias del Core

Antes de operar Taller, el administrador debe comprobar que:

- existen Clientes Core activos;
- los Servicios y Productos necesarios están activos en Inventario Core;
- la moneda y los impuestos de la empresa están configurados;
- las membresías y perfiles están activos;
- las Plazas necesarias existen y están habilitadas.

Taller reutiliza estas fuentes de verdad y no mantiene catálogos paralelos.

### 3.7 Buenas prácticas del administrador

- Habilita Taller solo para empresas que realmente utilizarán la vertical.
- Revisa periódicamente Plazas inactivas u ocupadas.
- Confirma el alcance congelado antes de aprobar.
- No uses la habilitación del módulo como sustituto de los permisos de usuario.
- No incluyas secretos ni datos personales en motivos administrativos.
- Recuerda que Taller no descuenta stock ni crea Ventas en su alcance actual.
- Conserva las decisiones sobre **Proyectos y trabajos** fuera de este módulo hasta que Core las defina.
