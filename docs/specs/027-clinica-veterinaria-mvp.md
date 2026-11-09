# SPEC 027 — Clínica Veterinaria MVP



> Estado: propuesta no implementada.

> Este documento debe ser revisado y aprobado antes de comenzar la implementación del módulo.



> La aprobación de esta SPEC autoriza únicamente el alcance descrito aquí. No autoriza modificaciones al Core protegido de ValoraCloud.



\#Objetivo



Incorporar a ValoraCloud un módulo aislado de Clínica Veterinaria que permita administrar pacientes veterinarios y registrar su proceso básico de atención, reutilizando las capacidades existentes de Clientes, Empresas, autenticación, membresías, permisos e Inventario sin duplicar ni modificar dichas funcionalidades Core.



El flujo principal del MVP será:



`Tutor → Paciente → Agenda → Recepción → Consulta clínica → Diagnóstico → Tratamiento → Servicios/productos → Cierre → Historial clínico`



El paciente será el eje clínico del módulo.



El tutor será representado mediante un Cliente existente de ValoraCloud.



\---



\#Alcance del MVP



La primera versión incluye:



\* búsqueda y selección de un tutor existente en Clientes;

\* registro de tutor mediante el flujo existente de Clientes cuando corresponda;

\* asociación de múltiples pacientes a un mismo tutor;

\* registro y edición de pacientes veterinarios;

\* ficha integral del paciente;

\* agenda veterinaria;

\* recepción del paciente;

\* atención clínica;

\* anamnesis;

\* examen clínico;

\* diagnóstico;

\* tratamiento;

\* indicaciones;

\* asociación informativa de servicios, productos y medicamentos utilizados;

\* cierre de atención;

\* historial clínico;

\* aislamiento multiempresa;

\* validación de permisos;

\* validaciones funcionales y clínicas básicas;

\* trazabilidad mediante Git y Pull Request;

\* pruebas locales con Firebase Emulator Suite.



El módulo no implementará un sistema paralelo de Clientes, autenticación, empleados, permisos, Inventario o Ventas.



\---



\#Flujo principal



&#x20;1. Tutor



El usuario busca al tutor dentro de Clientes Core.



Si existe:



`Buscar Cliente → Seleccionar Cliente`



Si no existe:



`Registrar mediante Clientes Core → Seleccionar Cliente`



El módulo veterinario no crea una colección independiente de tutores.



\---



&#x20;2. Paciente



Una vez seleccionado el tutor, el sistema consulta sus pacientes veterinarios.



Si el paciente existe:



`Tutor → Pacientes asociados → Seleccionar paciente`



Si no existe:



`Tutor → Nuevo paciente → Registrar → Asociar`



Un tutor puede mantener múltiples pacientes.



Cada paciente conserva su propia ficha e historial clínico.



\---



&#x20;3. Agenda



El usuario podrá crear una cita asociando:



\* tutor;

\* paciente;

\* fecha;

\* hora;

\* tipo o motivo de atención;

\* observaciones opcionales.



La cita deberá pertenecer al mismo negocio que tutor y paciente.



\---



&#x20;4. Recepción



Cuando el paciente llegue a la clínica, la cita podrá avanzar al estado correspondiente de recepción.



El flujo permitirá identificar claramente:



\* tutor;

\* paciente;

\* cita;

\* estado actual.



\---



&#x20;5. Atención clínica



Desde una cita válida se podrá iniciar una atención veterinaria.



La atención permitirá registrar como mínimo:



\* motivo de consulta;

\* anamnesis;

\* peso cuando corresponda;

\* examen clínico;

\* diagnóstico o diagnóstico presuntivo;

\* tratamiento;

\* indicaciones;

\* profesional responsable.



\---



&#x20;6. Servicios, productos y medicamentos



La atención podrá relacionar servicios, productos o medicamentos existentes.



En el MVP esta asociación tendrá carácter clínico/operacional.



Podrá registrar:



\* identificador del ítem Core;

\* nombre;

\* tipo;

\* cantidad;

\* valor de referencia cuando corresponda.



Esta asociación \*\*no modifica stock\*\* y \*\*no crea automáticamente una Venta\*\*.



\---



&#x20;7. Cierre



Una atención solamente podrá finalizar cuando tenga registrados los antecedentes mínimos definidos.



Al finalizar:



\* la atención pasa a estado finalizado;

\* queda disponible para consulta;

\* se incorpora al historial clínico del paciente;

\* no se elimina ni se reemplaza por una atención posterior.



\---



&#x20;8. Historial



La ficha del paciente permitirá consultar cronológicamente las atenciones finalizadas.



El historial pertenece exclusivamente al paciente seleccionado y no debe mezclar antecedentes de otros pacientes, aunque compartan tutor.



\---



\# Reutilización del Core



Clientes:



El tutor reutiliza Clientes Core.



Referencia esperada:



`clienteId`



El módulo no duplicará:



\* datos personales;

\* información fiscal;

\* dirección;

\* teléfono;

\* correo;

\* lógica de creación o modificación de Clientes.



Las operaciones sobre un tutor como Cliente deberán realizarse utilizando los mecanismos ya existentes de Clientes.



\---



Empresas y multiempresa:



El módulo utilizará el `businessId` existente.



Toda información veterinaria operacional deberá vivir bajo:



`negocios/{businessId}/...`



`negocioActivoId` podrá utilizarse como contexto de navegación, pero nunca como prueba suficiente de autorización.



\---



&#x20;Autenticación:



Se reutiliza Firebase Authentication y el flujo de sesión existente.



No se implementará:



\* login veterinario independiente;

\* recuperación de contraseña propia;

\* sesiones paralelas.



\---



&#x20;Membresías y permisos:



Se reutiliza la membresía canónica existente.



No se crearán:



\* nuevas membresías veterinarias;

\* sistemas paralelos de roles;

\* autorización independiente del Core.



Para el MVP inicial se propone que las mutaciones veterinarias estén disponibles únicamente para `OWNER` y `ADMIN`.



La ampliación a `TECNICO`, perfiles personalizados u otros perfiles deberá aprobarse antes de implementarse y no deberá requerir modificar el RBAC central.



\---



Empleados:



Cuando se requiera registrar al profesional responsable, se reutilizará la identidad existente del usuario/empleado autorizado.



No se creará una colección veterinaria paralela de empleados.



\---



&#x20;Inventario;



El módulo podrá consultar ítems existentes de Inventario para relacionarlos con una atención.



Ejemplos:



\* medicamentos;

\* insumos;

\* productos;

\* servicios.



El módulo veterinario no será autoridad sobre stock ni economía de Inventario.



\---



Ventas:



Ventas Core no forma parte de la implementación obligatoria del primer MVP veterinario.



Una futura conversión:



`Atención → Venta`



sólo podrá implementarse utilizando un mecanismo Core aprobado.



No se escribirá directamente en documentos internos de Ventas.



\---



Modelo Firestore propuesto:



Los nombres siguientes forman parte de esta propuesta y deberán quedar aprobados antes de implementación.



Pacientes:





negocios/{businessId}/pacientesVeterinarios/{pacienteId}





Campos propuestos:



\* `pacienteId`;

\* `negocioId`;

\* `tutorClienteId`;

\* `nombre`;

\* `especie`;

\* `raza`;

\* `sexo`;

\* `fechaNacimiento`;

\* `edadEstimada`;

\* `peso`;

\* `color`;

\* `microchip`;

\* `alergias`;

\* `antecedentes`;

\* `observaciones`;

\* `estado`;

\* `creadoPorUid`;

\* `actualizadoPorUid`;

\* `creadoEn`;

\* `actualizadoEn`.



Estados:



\* `activo`;

\* `inactivo`;

\* `fallecido`.



No existe eliminación física del historial clínico asociado al paciente.



\---



Citas veterinarias:





negocios/{businessId}/citasVeterinarias/{citaId}





Campos propuestos:



\* `citaId`;

\* `negocioId`;

\* `pacienteId`;

\* `tutorClienteId`;

\* `fecha`;

\* `hora`;

\* `tipoAtencion`;

\* `observaciones`;

\* `estado`;

\* `creadoPorUid`;

\* `actualizadoPorUid`;

\* `creadoEn`;

\* `actualizadoEn`.



Estados:



\* `agendada`;

\* `confirmada`;

\* `en\_espera`;

\* `en\_atencion`;

\* `finalizada`;

\* `cancelada`.



Una cita cancelada no puede pasar directamente a atención.



\---



&#x20;Atenciones veterinarias:





negocios/{businessId}/atencionesVeterinarias/{atencionId}





Campos propuestos:



\* `atencionId`;

\* `negocioId`;

\* `pacienteId`;

\* `tutorClienteId`;

\* `citaId`;

\* referencia al profesional responsable;

\* `motivoConsulta`;

\* `anamnesis`;

\* `examenClinico`;

\* `diagnostico`;

\* `tratamiento`;

\* `indicaciones`;

\* `pesoRegistrado`;

\* `itemsUtilizados`;

\* `estado`;

\* `iniciadaEn`;

\* `finalizadaEn`;

\* `creadoPorUid`;

\* `actualizadoPorUid`.



Estados:



\* `en\_atencion`;

\* `finalizada`.



Una atención finalizada será histórica y no podrá eliminarse físicamente mediante el flujo normal del módulo.



\---



Relación Tutor - Paciente:



La relación principal será:



`Cliente Core 1 → N Pacientes Veterinarios`



Un tutor puede poseer múltiples pacientes.



Para el MVP:



\* cada paciente tendrá un tutor responsable principal;

\* tutor y paciente deberán pertenecer al mismo negocio;

\* un paciente no podrá utilizar un `clienteId` perteneciente a otro negocio;

\* el historial pertenece al paciente y no al tutor.



La administración de múltiples tutores para un mismo paciente queda fuera del MVP inicial.



\---



Validaciones de paciente:



Para crear o editar un paciente:



\* nombre obligatorio;

\* especie obligatoria;

\* tutor válido obligatorio;

\* tutor perteneciente al mismo negocio;

\* fecha de nacimiento no futura;

\* peso, cuando exista, numérico y mayor que cero;

\* microchip, cuando exista, validado para evitar duplicados dentro del mismo negocio cuando corresponda;

\* estado perteneciente al conjunto permitido.



Los campos autoritativos de negocio, identidad, autoría y timestamps no deberán confiarse al frontend.



\---



Invariantes autoritativas:



Toda operación sensible deberá validar en backend:



\* usuario autenticado;

\* `businessId`;

\* negocio válido;

\* membresía activa;

\* rol autorizado;

\* pertenencia de todas las referencias al mismo negocio;

\* existencia del tutor;

\* existencia del paciente cuando corresponda;

\* estado válido de paciente, cita y atención.



Un identificador manipulado desde el frontend no deberá permitir acceder a información de otro negocio.



Debe rechazarse explícitamente cualquier operación cross-tenant.



\---



Autoridad del frontend:



El frontend podrá enviar únicamente datos editables necesarios para la operación.



No deberá utilizarse como autoridad para:



\* `businessId`;

\* permisos;

\* membresía;

\* autoría;

\* timestamps;

\* estados internos no permitidos;

\* stock;

\* costos de Inventario;

\* documentos internos de Venta.



Las validaciones visuales del formulario complementan, pero no sustituyen, las validaciones backend.



\---



Idempotencia y atomicidad:



Las mutaciones críticas deberán evitar duplicados y efectos parciales.



En particular, el cierre de una atención deberá considerar un `requestId` o mecanismo equivalente de idempotencia.



Un reintento de la misma operación no deberá:



\* crear una segunda atención;

\* cerrar dos veces;

\* duplicar registros relacionados;

\* crear múltiples consecuencias comerciales.



Cuando una operación veterinaria afecte varios documentos propios del módulo, deberá utilizar transacción o batch cuando corresponda y dentro de los límites técnicos permitidos.



\---



Integración con Inventario Core:



El módulo podrá leer Inventario para seleccionar servicios, medicamentos, insumos o productos.



No podrá escribir directamente:



\* `stock`;

\* `costoPromedio`;

\* `valorInventario`;

\* moneda del saldo;

\* economía Q/V;

\* `adquisicionesInventario`;

\* movimientos internos.



El registro de un medicamento o producto en una atención no implica automáticamente consumo de stock.



Una futura afectación física deberá utilizar exclusivamente un mecanismo Core aprobado.



\---



Integración con Ventas Core:



El módulo podrá preparar información comercial proveniente de una atención:



\* servicios;

\* productos;

\* medicamentos;

\* cantidades;

\* valores.



El MVP veterinario no escribirá directamente en:



`negocios/{businessId}/ventas/...`



La generación de una Venta sólo podrá incorporarse posteriormente si existe un contrato Core aprobado para dicha integración.



\---



Core protegido:



Esta SPEC no autoriza modificaciones a:



\* autenticación;

\* sesión;

\* recuperación de acceso;

\* selección del negocio activo;

\* autorización y aislamiento multiempresa Core;

\* modelo central `negocios/{businessId}/...`;

\* membresías;

\* RBAC central;

\* helpers compartidos de autorización;

\* verificación empresarial;

\* Platform Admin;

\* Firestore Rules globales;

\* Storage Rules globales;

\* economía Q/V de Inventario;

\* `costoPromedio`;

\* `valorInventario`;

\* moneda de Inventario;

\* `adquisicionesInventario`;

\* Compras Core;

\* Recepciones Core;

\* Ventas Core;

\* reversas, cancelaciones o devoluciones de stock;

\* snapshots históricos Core;

\* idempotencia Core existente;

\* Functions centrales compartidas;

\* `.firebaserc`;

\* configuración o proyecto Firebase productivo;

\* secretos;

\* deploy de producción.



Si una funcionalidad necesita modificar cualquiera de estos elementos, su implementación se detiene hasta obtener autorización.



\---



Firestore Rules y Functions:



El módulo no modificará Firestore Rules globales ni Functions centrales compartidas sin autorización.



Las operaciones backend del módulo deberán mantenerse aisladas de la lógica Core.



Si la implementación requiere ampliar Rules globales o modificar una Function Core existente, deberá documentarse la necesidad y solicitar aprobación antes del cambio.



\---



&#x20;Interfaz propuesta:



El módulo podrá organizarse bajo una ruta principal:





/clinica-veterinaria





Rutas propuestas:





/clinica-veterinaria/pacientes

/clinica-veterinaria/pacientes/{pacienteId}

/clinica-veterinaria/agenda

/clinica-veterinaria/atenciones/{atencionId}





Las pantallas principales serán:



\* listado/búsqueda de pacientes;

\* ficha integral del paciente;

\* agenda veterinaria;

\* recepción;

\* consulta clínica;

\* historial clínico.



La interfaz deberá incluir estados de:



\* carga;

\* vacío;

\* error;

\* permiso insuficiente.



conservar coherencia visual y responsive con ValoraCloud.



\---

&#x20;Pruebas requeridas:



Todas las pruebas se ejecutarán utilizando Firebase Emulator Suite.



Como mínimo deberán cubrirse:



Tutor y paciente:



\* selección de Cliente válido;

\* creación de paciente;

\* múltiples pacientes para el mismo tutor;

\* rechazo de tutor inexistente;

\* rechazo de tutor de otro negocio;

\* validación de nombre, especie, fecha y peso.



Multiempresa:



\* usuario del negocio A puede consultar datos del negocio A;

\* usuario del negocio A no puede consultar paciente del negocio B;

\* usuario del negocio A no puede modificar cita o atención del negocio B;

\* manipular IDs desde cliente no evita el rechazo backend.



Permisos:



\* `OWNER` autorizado;

\* `ADMIN` autorizado;

\* usuario sin membresía rechazado;

\* membresía inactiva rechazada;

\* rol no autorizado rechazado.



Agenda:



\* creación de cita válida;

\* paciente y tutor coincidentes;

\* cambio entre estados permitidos;

\* rechazo de transiciones inválidas.



Atención clínica:



\* inicio con paciente válido;

\* registro de información clínica;

\* rechazo de cierre sin campos mínimos;

\* cierre correcto;

\* atención finalizada disponible en historial.



&#x20;Idempotencia:



\* repetir cierre con el mismo request no duplica atención ni consecuencias.



Integración Core:



\* ninguna escritura directa de stock desde frontend;

\* ningún cambio de `costoPromedio`;

\* ningún cambio de `valorInventario`;

\* ninguna escritura directa en Ventas;

\* Clientes Core continúa funcionando sin regresión.



\---



Criterios de aceptación:



El MVP se considerará aceptable cuando:



\* un Cliente existente puede utilizarse como tutor;

\* un tutor puede poseer múltiples pacientes;

\* puede registrarse y consultarse una ficha de paciente;

\* puede crearse una cita;

\* puede registrarse la llegada del paciente;

\* puede iniciarse una atención;

\* pueden registrarse anamnesis, examen, diagnóstico, tratamiento e indicaciones;

\* pueden asociarse servicios/productos sin alterar stock directamente;

\* una atención puede finalizar sólo con sus datos mínimos;

\* una atención finalizada aparece en el historial del paciente correcto;

\* no existe acceso cross-tenant;

\* las operaciones sensibles validan membresía y permisos en backend;

\* un reintento crítico no genera duplicados;

\* Inventario Core no es modificado directamente;

\* Ventas Core no es modificado directamente;

\* los smokes y pruebas de integración local están en verde;

\* build y lint terminan correctamente cuando correspondan;

\* `git diff --check` está limpio;

\* no existen credenciales, datos reales ni secretos;

\* no se ejecutó ningún deploy de producción.



\---



Fuera de alcance del MVP:



No forman parte de esta primera implementación:



\* hospitalización;

\* gestión quirúrgica avanzada;

\* portal para tutores;

\* aplicación móvil independiente;

\* telemedicina;

\* diagnóstico mediante IA;

\* integración automática con laboratorios;

\* firma electrónica avanzada;

\* facturación electrónica;

\* pagos;

\* integraciones gubernamentales;

\* múltiples tutores por paciente;

\* recordatorios avanzados;

\* dashboard avanzado;

\* analítica de rentabilidad;

\* documentos clínicos adjuntos;

\* fotografías obligatorias;

\* lotes o vencimientos farmacológicos;

\* modificación directa de stock;

\* lógica propia de Compras;

\* lógica propia de Ventas;

\* reversas o devoluciones Core.



Prescripciones, vacunas, desparasitación, recordatorios y seguimiento avanzado podrán evaluarse después de completar el flujo principal.



\---



Pendientes antes de aprobación:



Antes de aprobar esta SPEC deberán confirmarse:



1\. Los nombres definitivos de las colecciones veterinarias.

2\. El mapa definitivo de permisos del módulo.

3\. Si `TECNICO` podrá operar funciones clínicas o si el MVP quedará inicialmente limitado a `OWNER` y `ADMIN`.

4\. Los campos clínicos mínimos obligatorios para cerrar una atención.

5\. Si la selección de productos/medicamentos desde Inventario será parte de la primera implementación o una segunda iteración.

6\. Si existe actualmente un mecanismo Core aprobado para convertir una atención en Venta. Si no existe, dicha integración permanecerá fuera del MVP.



\---

Condición de inicio de implementación:



La implementación no comienza hasta que esta SPEC sea revisada y aprobada.



Cualquier necesidad de modificar el Core protegido obliga a detener el desarrollo de esa parte y solicitar una revisión adicional.



## 38. Integración con Core autorizada para el traspaso

La implementación aislada del módulo Clínica Veterinaria se encuentra preparada.
La nueva `student-baseline` incorpora el mecanismo oficial de módulos verticales
y define la forma en que Veterinaria debe integrarse con el Core.

Las reglas vigentes para este traspaso corresponden a `AGENTS.md` y al manual de
traspaso entregado por el mantenedor.

### 38.1 Necesidad funcional

El módulo necesita:

- registrarse como módulo vertical con el identificador `veterinaria`;
- utilizar como ruta base `/clinica-veterinaria`;
- montar `VeterinaryPage` desde `App.jsx`;
- habilitar lectura autorizada de:
  - `negocios/{businessId}/pacientesVeterinarios`;
  - `negocios/{businessId}/citasVeterinarias`;
  - `negocios/{businessId}/atencionesVeterinarias`;
- mantener las escrituras desde navegador deshabilitadas.

Actualmente las rutas internas React, los paths Firestore y la capa de lectura
del módulo ya se encuentran implementados, pero todavía deben alinearse con el
nuevo registro y la nueva ruta base.

### 38.2 Core afectado

Los cambios de integración autorizados corresponden a:

- `functions/verticalModules.js`;
- `src/domain/verticalModules.mjs`;
- `src/app/App.jsx`;
- `firestore.rules`.

No se debe agregar Veterinaria a `BUSINESS_MODULES`.

El menú principal no requiere una entrada manual en `navigation.js`, ya que se
genera a partir del registro de módulos verticales.

La definición de permisos `VETERINARIA_*` debe proponerse primero en la
descripción del PR y no se modificará `src/domain/rbac.mjs` hasta recibir el
visto bueno del mantenedor.

### 38.3 Por qué se requiere integración con Core

La nueva base utiliza un interruptor de módulos verticales por negocio.

Un negocio solamente puede acceder a Veterinaria cuando el módulo
`veterinaria` está registrado y aparece dentro de sus módulos habilitados.

Las reglas Firestore también deben comprobar que el módulo se encuentre
habilitado, además del rol autorizado.

Por esta razón, las colecciones veterinarias continúan rechazando las lecturas
mientras no existan reglas explícitas para ellas.

### 38.4 Riesgos

Una modificación incorrecta podría:

- permitir acceso a un negocio sin Veterinaria habilitada;
- permitir acceso de un perfil no autorizado;
- romper el aislamiento entre negocios;
- habilitar lecturas o escrituras cross-tenant;
- introducir escrituras desde frontend como autoridad;
- modificar contratos centrales que no forman parte del módulo.

Por estas razones Veterinaria no reutiliza artificialmente permisos de
Inventario, Clientes u otros módulos para autorizar operaciones clínicas.

### 38.5 Integración mínima autorizada

El mantenedor autorizó para esta etapa:

1. registrar:

   `{ id: "veterinaria", label: "Clínica veterinaria", basePath: "/clinica-veterinaria" }`

   en:
   - `functions/verticalModules.js`;
   - `src/domain/verticalModules.mjs`;

2. alinear las rutas internas desde `/veterinaria/...` hacia
   `/clinica-veterinaria/...`;

3. montar `VeterinaryPage` en `App.jsx`;

4. agregar reglas de lectura para las tres colecciones veterinarias,
   comprobando módulo habilitado y los roles permitidos para el MVP;

5. mantener:

   `allow write: if false;`

   para escrituras desde el navegador;

6. proponer en el PR el mapa de permisos `VETERINARIA_*` antes de modificar el
   RBAC.

No se propone modificar la economía de Inventario, costos, valorización,
ledger, Ventas, Compras o Recepciones.

### 38.6 Pruebas necesarias para aprobar la integración

La integración deberá validar como mínimo:

- módulo habilitado: lectura permitida para un rol autorizado;
- módulo deshabilitado: lectura denegada;
- usuario o negocio no autorizado: lectura denegada;
- escrituras desde navegador siempre denegadas;
- rechazo de acceso cross-tenant;
- integración de Inventario únicamente en lectura;
- ausencia de escrituras directas de stock desde frontend;
- `npm run test:veterinary`;
- `npm run test:rules`;
- `npm run test:rbac`;
- `npm run test:design`;
- `npm run test:contrast`;
- `npm run build`;
- `npm --prefix functions run lint`;
- `git diff --check`.

Las verificaciones deberán registrarse con su código de salida real.

### 38.7 Estado actual

Implementado en la feature branch:

- modelo de datos veterinario;
- paths Firestore aislados dentro del módulo;
- capa de lectura para pacientes, citas y atenciones;
- integración con `businessId`;
- integración de solo lectura con Inventario Core;
- rutas React internas;
- `VeterinaryPage`;
- `VeterinaryManager`;
- modelos y smoke tests del dominio veterinario.

El 19 de octubre de 2026 la rama
`feature/clinica-veterinaria` fue trasladada mediante merge a la nueva
`student-baseline` (`baseline-v2`).

Pendiente dentro del proceso de traspaso:

- registro del módulo vertical;
- cambio de rutas a `/clinica-veterinaria`;
- montaje global de `VeterinaryPage`;
- reglas de lectura veterinarias;
- correcciones visuales y de validación indicadas por el mantenedor;
- propuesta de permisos `VETERINARIA_*`.

## 39. Revisión del mantenedor y estado del traspaso

### 39.1 Resultado de la revisión

El mantenedor revisó el PR del módulo Clínica Veterinaria hasta el commit
`29084be`.

La revisión original correspondía a la baseline anterior. Posteriormente se
publicó la nueva rama `student-baseline`, marcada como `baseline-v2`, y el módulo
fue trasladado a esa nueva base mediante merge.

Se confirmó especialmente que:

- la integración con Inventario Core es únicamente de lectura;
- las lecturas utilizan el `businessId` del negocio activo;
- no existen escrituras directas desde el navegador;
- la validación duplicada de farmacia fue corregida;
- existe una sola implementación de `requireBusinessId`;
- el manejo de errores distingue `permission-denied` de errores generales;
- no se modificaron Functions centrales;
- no se implementó descuento de stock desde Veterinaria.

### 39.2 Correcciones aplicadas después de la revisión

#### Manejo de errores de Firestore

`VeterinaryManager.jsx` dejó de asumir que todos los errores de las
suscripciones corresponden a permisos.

Actualmente:

- `permission-denied` muestra un mensaje asociado a falta de permisos;
- errores de red, índices u otros fallos muestran un mensaje general de carga.

#### Helper `requireBusinessId`

Se eliminó la implementación duplicada de `requireBusinessId`.

La función se exporta desde:

`src/features/veterinary/data/veterinaryFirestorePaths.mjs`

y es reutilizada desde:

`src/features/veterinary/data/veterinaryDataService.js`.

### 39.3 Rutas React

Las rutas implementadas antes del traspaso utilizan todavía:

- `/veterinaria`;
- `/veterinaria/pacientes`;
- `/veterinaria/pacientes/nuevo`;
- `/veterinaria/pacientes/:pacienteId`;
- `/veterinaria/agenda`;
- `/veterinaria/agenda/nueva`;
- `/veterinaria/citas/:citaId`.

La nueva baseline establece como ruta oficial:

`/clinica-veterinaria`

Por lo tanto, esas rutas deben migrarse durante la etapa de registro e
integración del módulo.

Estas rutas representan la estructura de navegación y no deben considerarse
como siete pantallas productivas independientes terminadas, ya que actualmente
reutilizan el contenedor principal.

### 39.4 Validaciones ejecutadas antes del traspaso

Antes de recibir la nueva baseline se ejecutaron correctamente:

- `npm run build`;
- `npm run test:veterinary`;
- `npm run test:rules`;
- `npm run test:rbac`;
- `npm run test:inventory-service`;
- `npm run test:inventory-model`;
- `git diff --check`.

Los siete smoke tests del dominio veterinario permanecían en verde en esa
baseline.

Después del traspaso deberán ejecutarse nuevamente las verificaciones exigidas
por la nueva base y registrarse sus códigos de salida reales.

### 39.5 Integración autorizada sobre la nueva baseline

El mantenedor autorizó:

- registrar `veterinaria` en las dos copias del registro de módulos verticales;
- usar `/clinica-veterinaria` como `basePath`;
- montar `VeterinaryPage` en `App.jsx`;
- agregar reglas Firestore de lectura para las tres colecciones veterinarias;
- desarrollar Functions propias del módulo utilizando el mecanismo de acceso
  autorizado del Core cuando corresponda.

El menú principal se obtiene desde el registro de módulos verticales y no debe
agregarse manualmente en `navigation.js`.

El mapa de permisos `VETERINARIA_*` todavía debe ser propuesto en el PR y
requiere visto bueno del mantenedor antes de modificar RBAC.

### 39.6 Restricciones vigentes

Continúa sin autorización:

- modificar Functions centrales existentes;
- descontar stock desde Farmacia Veterinaria;
- crear un mecanismo propio de consumo de inventario;
- escribir directamente stock, costos, valorización o movimientos de
  Inventario;
- utilizar el rubro del negocio como mecanismo de activación del módulo.

Farmacia Veterinaria continúa operando únicamente en modo lectura hasta que el
Core entregue un mecanismo único y autorizado de consumo de stock.

La activación de Veterinaria depende del interruptor de módulos por negocio y
será realizada por el mantenedor desde la consola de plataforma.