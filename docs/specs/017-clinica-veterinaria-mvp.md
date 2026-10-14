# Clínica Veterinaria MVP

## Estado

Diseño inicial del módulo Clínica Veterinaria de ValoraCloud.

Esta especificación define inicialmente el modelo de datos Firestore, la arquitectura de componentes React y la relación del módulo veterinario con los componentes Core existentes.

La persistencia definitiva, Firestore Rules, Functions y cambios sobre componentes protegidos del Core quedan sujetos a revisión antes de su implementación.

## Objetivo

Incorporar un módulo de gestión clínica veterinaria que permita administrar:

- pacientes veterinarios;
- agenda y citas;
- recepción;
- triage;
- consulta clínica;
- diagnóstico y tratamiento;
- servicios y productos utilizados;
- cierre clínico;
- historial clínico.

El módulo debe reutilizar las capacidades existentes de ValoraCloud para:

- clientes;
- inventario;
- ventas;
- autenticación;
- membresías;
- roles y permisos;
- aislamiento multiempresa.

El módulo veterinario no debe duplicar la autoridad de estos componentes Core.

---

# 1. Aislamiento multiempresa

Los datos operacionales del módulo pertenecen al negocio autorizado:

```text
negocios/{businessId}/...
```

`businessId` debe provenir del contexto autorizado de ValoraCloud.

No debe utilizarse un identificador fijo ni `localStorage` como fuente de autoridad.

Flujo esperado:

```text
Sesión / membresía
        ↓
businessId autorizado
        ↓
Clínica Veterinaria
        ↓
Datos del negocio
```

El módulo debe respetar el mismo patrón utilizado actualmente por otras áreas de ValoraCloud.

---

# 2. Modelo Firestore propuesto

La estructura general propuesta para el MVP es:

```text
negocios/{businessId}
│
├── clientes/{clienteId}
│     └── Core: tutor del paciente
│
├── inventario/{itemId}
│     └── Core: productos y servicios
│
├── pacientesVeterinarios/{pacienteId}
│
├── citasVeterinarias/{citaId}
│
└── atencionesVeterinarias/{citaId}
```

Se mantiene una separación entre:

```text
Datos maestros del paciente
        ↓
Agenda
        ↓
Información clínica
        ↓
Integraciones Core
```

---

# 3. Pacientes veterinarios

Ruta propuesta:

```text
negocios/{businessId}/pacientesVeterinarios/{pacienteId}
```

Campos funcionales actualmente definidos:

```text
tutorClienteId
nombre
especie
raza
sexo
fechaNacimiento
edadEstimada
peso
color
microchip
alergias
antecedentes
observaciones
```

El tutor continúa siendo un cliente del Core.

Relación:

```text
clientes/{clienteId}
        ↑
        │ tutorClienteId
        │
pacientesVeterinarios/{pacienteId}
```

No se propone crear una colección independiente de tutores veterinarios.

Los campos de auditoría, negocio, autorización, usuario creador y timestamps autoritativos no deben ser controlados libremente por el cliente.

---

# 4. Citas veterinarias

Ruta propuesta:

```text
negocios/{businessId}/citasVeterinarias/{citaId}
```

Campos funcionales actualmente definidos:

```text
pacienteId
tutorClienteId
fecha
hora
motivo
observaciones
```

Estados actualmente definidos:

```text
agendada
confirmada
cancelada
completada
```

La cita representa la planificación de la atención.

No debe utilizarse como contenedor principal de la historia clínica.

Relación:

```text
pacientesVeterinarios/{pacienteId}
              ↑
              │ pacienteId
              │
citasVeterinarias/{citaId}
```

---

# 5. Atenciones veterinarias

Se propone separar la información clínica de la Agenda mediante:

```text
negocios/{businessId}/atencionesVeterinarias/{citaId}
```

Para el MVP se propone utilizar `citaId` como identificador del documento clínico.

Esto mantiene una relación uno a uno:

```text
citasVeterinarias/ABC123
          ↓
atencionesVeterinarias/ABC123
```

Campos principales de relación:

```text
citaId
pacienteId
tutorClienteId
```

El documento de atención agrupa las diferentes etapas correspondientes a una misma visita clínica.

Estructura conceptual:

```text
atencionesVeterinarias/{citaId}
│
├── citaId
├── pacienteId
├── tutorClienteId
│
├── recepcion
├── triage
├── consultaClinica
├── atencion
└── cierreClinico
```

---

# 6. Recepción

La información de recepción se propone dentro del documento de atención:

```text
recepcion {
  horaLlegada
  observacionesRecepcion
}
```

Los modelos de dominio actuales trabajan también con:

```text
citaId
pacienteId
tutorClienteId
```

Dentro del documento consolidado estos identificadores quedan disponibles en el nivel principal de la atención.

---

# 7. Triage

La información del triage se propone de la siguiente forma:

```text
triage {
  prioridad
  pesoKg
  temperaturaC
  frecuenciaCardiaca
  frecuenciaRespiratoria
  observacionesTriage
}
```

Prioridades actualmente definidas:

```text
normal
prioritaria
urgente
```

Los valores clínicos pueden ser opcionales cuando corresponda, pero deben respetar las validaciones definidas en el modelo de dominio.

---

# 8. Consulta clínica

La consulta clínica se propone dentro de:

```text
consultaClinica {
  motivoConsulta
  anamnesis
  examenClinico
}
```

El objetivo es mantener separada la información obtenida durante la consulta de los datos administrativos de la cita.

---

# 9. Atención clínica

La atención clínica registra diagnóstico, tratamiento, indicaciones y los elementos utilizados durante la consulta.

Estructura propuesta:

```text
atencion {
  motivoConsulta
  diagnostico
  tratamiento
  indicaciones
  servicios[]
  productos[]
}
```

Los servicios utilizados conservan únicamente las referencias necesarias:

```text
{
  itemId
  tipoItem
  nombre
  codigoInterno
  unidad
  cantidad
}
```

Los productos utilizados mantienen el mismo contrato:

```text
{
  itemId
  tipoItem
  nombre
  codigoInterno
  unidad
  cantidad
}
```

Los tipos utilizados actualmente por Clínica Veterinaria son:

```text
servicio
producto
```

No deben copiarse hacia la atención campos autoritativos de Inventario como:

```text
stock
stockMinimo
costoBase
costoPromedio
valorInventario
precioInterno
```

La atención conserva referencias clínicas y operativas, pero no se convierte en autoridad sobre Inventario.

---

# 10. Cierre clínico

El cierre clínico se incorpora al mismo documento de atención:

```text
cierreClinico {
  resultadoClinico
  resumenCierre
  indicacionesCierre
  proximoControl
  prepararVenta
}
```

Resultados clínicos actualmente definidos:

```text
alta
control
derivacion
```

`prepararVenta` indica que la información de la atención puede utilizarse posteriormente para preparar un traspaso hacia Ventas Core.

No significa que Clínica Veterinaria cree directamente una venta.

---

# 11. Historial clínico

El historial clínico de un paciente puede obtenerse desde sus atenciones:

```text
atencionesVeterinarias
where pacienteId == {pacienteId}
```

Conceptualmente:

```text
Paciente
   │
   ├── Atención 1
   ├── Atención 2
   ├── Atención 3
   └── ...
```

Esto evita duplicar toda la historia clínica dentro del documento maestro del paciente.

La ficha integral podrá utilizar estas atenciones para construir una línea de tiempo clínica.

---

# 12. Integración con Clientes Core

El propietario o tutor continúa siendo un cliente del Core.

Ruta Core:

```text
negocios/{businessId}/clientes/{clienteId}
```

Clínica Veterinaria conserva únicamente la referencia:

```text
tutorClienteId
```

No se crea una colección paralela como:

```text
tutoresVeterinarios
```

La información comercial del tutor sigue perteneciendo al módulo Clientes.

---

# 13. Integración con Inventario Core

El inventario autoritativo permanece en:

```text
negocios/{businessId}/inventario/{itemId}
```

La lectura debe reutilizar los mecanismos existentes del Core.

Actualmente el servicio de Inventario proporciona:

```text
subscribeToInventory(
  businessId,
  onItems,
  onError
)
```

Flujo previsto:

```text
businessId autorizado
        ↓
subscribeToInventory(businessId)
        ↓
Inventario Core
        ↓
inventoryPharmacyIntegrationModel
        ↓
Productos y servicios
        ↓
Atención veterinaria
```

Farmacia no constituye un nuevo tipo de Inventario.

Dentro de Clínica Veterinaria corresponde a una vista o utilización específica de los ítems Core cuyo:

```text
tipoItem = "producto"
```

Los servicios se reutilizan desde ítems cuyo:

```text
tipoItem = "servicio"
```

---

# 14. Autoridad del stock

Las validaciones realizadas en React corresponden a controles de experiencia de usuario.

Ejemplo:

```text
stock disponible = 3
cantidad solicitada = 5

Frontend:
muestra advertencia
o limita visualmente la cantidad
```

Estas validaciones no convierten al navegador en autoridad sobre el stock.

La validación definitiva debe realizarse mediante mecanismos Core aprobados antes de efectuar cualquier operación que afecte Inventario.

Clínica Veterinaria no debe modificar directamente:

```text
stock
costoPromedio
valorInventario
adquisicionesInventario
economía Q/V
```

Tampoco debe realizar desde React una operación equivalente a:

```text
stock = stock - cantidad
```

La lógica autoritativa deberá permanecer en los mecanismos definidos por Inventario, Ventas y Functions.

---

# 15. Integración con Ventas Core

El cierre clínico puede preparar información para una futura operación de Venta Core.

Contrato actualmente diseñado:

```text
{
  clienteId,
  lineas: [
    {
      itemId,
      tipoItem,
      cantidad
    }
  ],
  observaciones
}
```

Las líneas se construyen desde los servicios y productos asociados a la atención.

Flujo previsto:

```text
Atención veterinaria
        ↓
Servicios y productos
        ↓
Cierre clínico
        ↓
Preparación de venta
        ↓
Ventas Core
        ↓
Validaciones autoritativas
        ↓
Operación comercial / stock
```

Clínica Veterinaria no asigna precios autoritativos mediante este contrato.

Tampoco debe crear una colección:

```text
ventasVeterinarias
```

ya que Ventas pertenece al Core de ValoraCloud.

---

# 16. Límites del módulo

Clínica Veterinaria puede:

- crear y consultar pacientes veterinarios;
- gestionar citas veterinarias;
- registrar recepción;
- registrar triage;
- registrar consulta clínica;
- registrar diagnóstico;
- registrar tratamiento;
- asociar productos y servicios del Inventario Core;
- registrar cierre clínico;
- consultar historial clínico;
- preparar información para una futura operación de Venta Core.

Clínica Veterinaria no debe:

- crear un sistema paralelo de clientes;
- crear un sistema paralelo de inventario;
- modificar stock directamente desde React;
- modificar la economía autoritativa de Inventario;
- modificar `costoPromedio`;
- modificar `valorInventario`;
- escribir directamente en `adquisicionesInventario`;
- crear una implementación paralela de Ventas;
- utilizar `localStorage` como autoridad del negocio;
- confiar en un `businessId` ingresado libremente por el usuario;
- modificar componentes protegidos del Core sin revisión.

---

# 17. Diseño de componentes React

La interfaz definitiva de Clínica Veterinaria debe separar:

```text
obtención de datos
        ↓
lógica de dominio
        ↓
presentación
        ↓
persistencia
```

Los componentes de presentación no deben determinar por sí mismos el negocio activo ni utilizar `localStorage` como fuente autoritativa.

El `businessId` debe ingresar desde la capa superior de ValoraCloud y propagarse solamente a los componentes o servicios que lo necesiten.

---

# 18. Arquitectura general React

La arquitectura general propuesta es:

```text
ValoraCloud
    │
    │ businessId + role
    ▼
src/pages/VeterinaryPage.jsx
    │
    ▼
src/features/veterinary/VeterinaryManager.jsx
    │
    ├── Pacientes
    │     ├── PatientList
    │     ├── PatientCreate
    │     └── PatientDetail
    │
    ├── Agenda
    │     ├── AppointmentList
    │     └── AppointmentCreate
    │
    └── Flujo clínico
          ├── ReceptionTriage
          ├── ClinicalConsultation
          ├── Attention
          └── ClinicalClosure
```

---

# 19. VeterinaryPage y VeterinaryManager

La integración del módulo sigue el patrón utilizado actualmente por ValoraCloud: una página delgada ubicada en `src/pages/` delega la lógica a un componente `Manager` dentro de `src/features/`.

La estructura implementada es:

```text
src/pages/VeterinaryPage.jsx
        │
        ▼
src/features/veterinary/VeterinaryManager.jsx
```

## VeterinaryPage

`VeterinaryPage` actúa únicamente como wrapper de entrada al módulo.

Responsabilidades:

```text
- recibir businessId desde ValoraCloud;
- recibir role desde el negocio activo;
- entregar ambos valores a VeterinaryManager;
- no realizar consultas directas a Firestore;
- no contener lógica clínica ni lógica de inventario.
```

Contrato implementado:

```jsx
<VeterinaryPage
  businessId={businessId}
  role={activeBusiness?.role}
/>
```

Internamente delega en:

```jsx
<VeterinaryManager
  businessId={businessId}
  role={role}
/>
```

## VeterinaryManager

`VeterinaryManager` corresponde al contenedor principal del módulo veterinario.

Sus responsabilidades incluyen:

```text
- recibir businessId y role;
- coordinar los datos utilizados por las vistas veterinarias;
- consumir servicios existentes de ValoraCloud;
- mantener estados de carga y error;
- entregar datos reales a los componentes clínicos;
- no modificar directamente lógica protegida del Core.
```

Actualmente se encuentra implementada la integración de lectura con Inventario Core mediante:

```js
subscribeToInventory(businessId)
```

Flujo actual:

```text
VeterinaryManager
        │
        │ businessId
        ▼
subscribeToInventory
        │
        ▼
Inventario Core
        │
        ▼
inventoryItems
        │
        ▼
inventoryPharmacyIntegrationModel
        │
        ├── servicios veterinarios
        └── productos de farmacia
```

Esta integración es actualmente de solo lectura.

No se realizan desde `VeterinaryManager`:

```text
- descuentos de stock;
- modificaciones de costo;
- modificaciones de valorización;
- escrituras directas sobre Inventario Core.
```

La autoridad para operaciones sensibles debe continuar utilizando los mecanismos aprobados del Core.

Ni `VeterinaryPage` ni `VeterinaryManager` deben obtener `businessId` desde:

```text
localStorage
parámetros ingresados libremente por el usuario
identificadores hardcodeados
```

El `businessId` debe provenir del contexto autorizado de ValoraCloud.


---

# 20. Contenedor de pacientes

Se propone una capa encargada de consultar y administrar los pacientes correspondientes al negocio activo.

```text
VeterinaryPatients
      │
      ├── PatientList
      ├── PatientCreate
      └── PatientDetail
```

El contenedor recibe:

```text
businessId
role
```

y administra conceptualmente:

```text
patients
loading
error
selectedPatient
```

Los componentes de formulario y detalle reciben la información mediante props.

---

# 21. PatientCreate

El prototipo actual:

```text
PatientCreatePreview
```

debe servir como base funcional del formulario definitivo.

Flujo:

```text
Formulario de paciente
        ↓
patientModel.mjs
        ↓
payload validado
        ↓
callback del contenedor
```

El formulario no debe decidir:

```text
businessId
creadoPorUid
permisos
timestamps autoritativos
```

Estos datos pertenecen a una capa superior o a un mecanismo backend autorizado.

---

# 22. PatientDetail

El componente existente:

```text
src/features/veterinary/patients/PatientDetail.jsx
```

puede mantenerse como componente de presentación de la ficha integral.

Debe recibir mediante props la información necesaria:

```text
patient
tutor
appointments
history
loading
error
canMutate
```

El historial clínico deberá provenir posteriormente de:

```text
negocios/{businessId}/atencionesVeterinarias
```

filtrado por:

```text
pacienteId
```

---

# 23. Contenedor de Agenda

Se propone:

```text
VeterinaryAgenda
```

como responsable de consultar y coordinar las citas veterinarias.

Flujo:

```text
businessId
    ↓
VeterinaryAgenda
    ├── pacientes disponibles
    ├── citas veterinarias
    ├── cita seleccionada
    └── flujo clínico
```

Estado conceptual:

```text
appointments
patients
selectedAppointment
loading
error
```

---

# 24. AppointmentCreate

El prototipo actual:

```text
AppointmentCreatePreview
```

trabaja mediante:

```text
patientRecords
appointments
onCancel
onCreated
```

Este patrón debe conservarse conceptualmente.

El formulario crea únicamente el payload funcional de la cita y entrega el resultado al contenedor mediante:

```text
onCreated
```

La persistencia Firestore no debe realizarse directamente desde el componente de formulario.

---

# 25. Flujo clínico

Una cita seleccionada puede avanzar progresivamente por las etapas clínicas:

```text
Cita
 ↓
Recepción / Triage
 ↓
Consulta clínica
 ↓
Atención
 ↓
Cierre clínico
```

El contenedor de Agenda o un futuro contenedor específico de atención debe controlar qué etapa se encuentra activa.

Los formularios individuales no deben encargarse de resolver por sí mismos el negocio activo ni la navegación global.

---

# 26. ReceptionTriage

Base actual:

```text
ReceptionTriagePreview
```

Props actuales relevantes:

```text
appointment
patientRecord
onCancel
onCompleted
```

Responsabilidad:

```text
registrar recepción
registrar triage
validar información
devolver payload validado
```

No debe buscar por sí mismo la cita ni el paciente directamente en Firestore.

---

# 27. ClinicalConsultation

Base actual:

```text
ClinicalConsultationPreview
```

Props actuales:

```text
appointment
patientRecord
onCancel
onCompleted
```

Responsabilidad:

```text
motivoConsulta
anamnesis
examenClinico
```

El componente debe devolver un payload validado mediante:

```text
onCompleted
```

---

# 28. Attention

Base actual:

```text
AttentionPreview
```

Props relevantes:

```text
appointment
patientRecord
inventoryItems
onCancel
onCompleted
```

Esta separación es especialmente importante para la integración con Inventario.

`Attention` no debe consultar directamente la colección de Inventario.

Flujo propuesto:

```text
businessId
    ↓
Contenedor veterinario
    ↓
subscribeToInventory(businessId)
    ↓
inventoryItems
    ↓
Attention
    ↓
inventoryPharmacyIntegrationModel
```

De esta forma el componente clínico consume datos entregados por su capa superior.

---

# 29. Adaptador Inventario/Farmacia

La lógica existente:

```text
inventoryPharmacyIntegrationModel.mjs
```

se mantiene entre los datos provenientes del Inventario Core y la interfaz veterinaria.

Flujo:

```text
Inventario Core
      ↓
inventoryItems
      ↓
inventoryPharmacyIntegrationModel
      ├── servicios veterinarios
      └── productos / farmacia
              ↓
          Attention
```

El adaptador puede:

```text
filtrar
normalizar
clasificar
mostrar disponibilidad
preparar referencias seguras
```

pero no se convierte en propietario del stock.

---

# 30. ClinicalClosure

Base actual:

```text
ClinicalClosurePreview
```

Props:

```text
appointment
patientRecord
onCancel
onCompleted
```

Responsabilidad:

```text
registrar resultado clínico
registrar resumen
registrar indicaciones finales
registrar próximo control
indicar si corresponde preparar venta
```

El componente puede preparar el contrato de salida hacia Ventas.

No debe:

```text
crear directamente una venta autoritativa
modificar stock
asignar precios autoritativos
```

---

# 31. Responsabilidad de los callbacks

Se mantiene el patrón:

```text
Componente de formulario
        ↓
modelo de dominio
        ↓
payload validado
        ↓
onCreated / onCompleted
        ↓
contenedor
        ↓
servicio de persistencia
```

Esto permite mantener separados:

```text
Presentación
     ↓
Dominio
     ↓
Persistencia
     ↓
Core / Functions
```

---

# 32. Componentes de laboratorio

Los archivos ubicados actualmente en:

```text
src/features/veterinary/dev/
```

se consideran implementaciones de laboratorio o prototipos funcionales.

Actualmente existen, entre otros:

```text
AppointmentCreatePreview.jsx
AttentionPreview.jsx
ClinicalClosurePreview.jsx
ClinicalConsultationPreview.jsx
PatientCreatePreview.jsx
PatientDetailLabPreview.jsx
PatientDetailPreview.jsx
ReceptionTriagePreview.jsx
VeterinaryAgendaLab.jsx
VeterinaryPatientLab.jsx
```

No deben convertirse automáticamente en componentes productivos únicamente mediante un cambio de carpeta.

Su lógica y contratos de props pueden reutilizarse progresivamente después de separar:

```text
datos simulados
localStorage
navegación del laboratorio
persistencia temporal
```

de la lógica propia de presentación y dominio.

---

# 33. Estructura React objetivo

Como diseño de referencia se propone:

```text
src/
├── pages/
│   └── VeterinaryPage.jsx
│
└── features/
    └── veterinary/
        ├── VeterinaryManager.jsx
        │
        ├── domain/
        │   ├── patientModel.mjs
        │   ├── appointmentModel.mjs
        │   ├── receptionTriageModel.mjs
        │   ├── clinicalConsultationModel.mjs
        │   ├── attentionModel.mjs
        │   ├── clinicalClosureModel.mjs
        │   └── inventoryPharmacyIntegrationModel.mjs
        │
        ├── patients/
        │   ├── PatientList.jsx
        │   ├── PatientCreate.jsx
        │   └── PatientDetail.jsx
        │
        ├── agenda/
        │   ├── VeterinaryAgenda.jsx
        │   └── AppointmentCreate.jsx
        │
        └── clinical/
            ├── ReceptionTriage.jsx
            ├── ClinicalConsultation.jsx
            ├── Attention.jsx
            └── ClinicalClosure.jsx

```

Esta estructura representa el diseño objetivo del módulo.

Actualmente ya se encuentran implementados:

```text
src/pages/VeterinaryPage.jsx
src/features/veterinary/VeterinaryManager.jsx
```

---

# 34. Estado de implementación

Actualmente existen modelos de dominio para:

```text
pacientes
citas
recepción y triage
consulta clínica
atención
cierre clínico
adaptación de Inventario/Farmacia
```

También existen prototipos funcionales de las interfaces principales dentro del entorno de laboratorio:

```text
src/features/veterinary/dev/
```

Actualmente ya se encuentran implementados como parte de la integración productiva inicial:

```text
src/pages/VeterinaryPage.jsx
src/features/veterinary/VeterinaryManager.jsx
```

`VeterinaryPage` actúa como página delgada del módulo y delega la lógica a `VeterinaryManager`.

`VeterinaryManager` ya recibe el `businessId` y utiliza:

```js
subscribeToInventory(businessId)
```

para consumir el Inventario Core real del negocio activo.

El flujo actualmente implementado es:

```text
businessId
    ↓
VeterinaryManager
    ↓
subscribeToInventory
    ↓
Inventario Core
    ↓
inventoryPharmacyIntegrationModel
    ↓
servicios y productos veterinarios
```

Esta integración es únicamente de lectura.

Actualmente no se realizan desde Clínica Veterinaria:

```text
descuentos de stock
modificaciones de costo
modificaciones de valorización
escrituras directas sobre Inventario Core
```

La persistencia Firestore definitiva de:

```text
pacientes
citas
atenciones clínicas
```

todavía no está implementada.

La incorporación de Clínica Veterinaria al router central de `App.jsx` tampoco está implementada todavía.

---

# 35. Pendientes de implementación

El diseño principal del módulo ya se encuentra definido.

Los siguientes puntos permanecen pendientes:

1. integrar `VeterinaryPage` en `App.jsx` mediante una modificación pequeña y revisable;
2. conectar los componentes productivos de pacientes;
3. conectar los componentes productivos de Agenda;
4. conectar progresivamente Recepción/Triage, Consulta, Atención y Cierre;
5. implementar persistencia Firestore para pacientes, citas y atenciones;
6. definir los permisos definitivos del módulo;
7. revisar Firestore Rules antes de incorporar nuevas colecciones;
8. identificar el mecanismo Core aprobado para el traspaso hacia Ventas;
9. revisar Functions antes de cualquier operación autoritativa relacionada con stock;
10. mantener las modificaciones de stock fuera del frontend;
11. migrar progresivamente los componentes que actualmente se encuentran en `dev/`;
12. reemplazar estilos hardcodeados por design tokens cuando se reciba la guía correspondiente.

La lectura real desde Inventario Core ya se encuentra conectada mediante el `businessId` recibido por `VeterinaryManager`.

El diseño de rutas React también se encuentra definido en la siguiente sección.

---



# 36. Diseño de rutas React

Clínica Veterinaria debe integrarse al sistema de rutas existente de ValoraCloud.

El patrón actual de la aplicación entrega desde `App.jsx` el `businessId` correspondiente al negocio activo y, cuando corresponde, el rol asociado.

El módulo veterinario debe reutilizar este mismo patrón.

Flujo esperado:

```text
App.jsx
   │
   │ businessId + role
   ▼
Página veterinaria
   │
   ▼
Componentes del módulo
```

No se propone crear un router independiente para Clínica Veterinaria.

## Ruta principal

```text
/veterinaria
```

Corresponde al punto de entrada del módulo.

La ruta principal del módulo debe renderizar:

```text
src/pages/VeterinaryPage.jsx
```

Esta página recibe el contexto autorizado desde ValoraCloud y delega la lógica en:

```text
src/features/veterinary/VeterinaryManager.jsx
```

Flujo:

```text
App.jsx
   │
   │ businessId + role
   ▼
VeterinaryPage
   │
   ▼
VeterinaryManager
```

Contrato conceptual:

```jsx
<Route
  path="/veterinaria"
  element={
    <VeterinaryPage
      key={businessId}
      businessId={businessId}
      role={activeBusiness?.role}
    />
  }
/>
```

Este fragmento representa solamente el diseño esperado.

La incorporación de esta ruta a `App.jsx` todavía no está implementada.

## Rutas de pacientes

Listado de pacientes:

```text
/veterinaria/pacientes
```

Creación de paciente:

```text
/veterinaria/pacientes/nuevo
```

Ficha integral de un paciente:

```text
/veterinaria/pacientes/:pacienteId
```

Flujo:

```text
/veterinaria/pacientes
          │
          ├── /nuevo
          │
          └── /:pacienteId
```

`pacienteId` identifica únicamente el paciente dentro del negocio actualmente autorizado.

El `businessId` no debe obtenerse desde la URL.

## Rutas de Agenda

Listado y calendario veterinario:

```text
/veterinaria/agenda
```

Creación de una nueva cita:

```text
/veterinaria/agenda/nueva
```

Detalle y flujo clínico de una cita:

```text
/veterinaria/citas/:citaId
```

Flujo:

```text
/veterinaria/agenda
        │
        ├── /nueva
        │
        └── /veterinaria/citas/:citaId
```

## Flujo clínico dentro de la cita

No se propone crear rutas independientes para:

```text
recepción
triage
consulta clínica
atención
cierre clínico
```

Estas etapas pertenecen a una misma visita veterinaria.

Por lo tanto:

```text
/veterinaria/citas/:citaId
```

puede coordinar internamente:

```text
Detalle de cita
      ↓
Recepción / Triage
      ↓
Consulta clínica
      ↓
Atención
      ↓
Cierre clínico
```

Esto mantiene una URL estable para la cita y evita fragmentar el flujo clínico en rutas innecesarias.

## Relación entre rutas y Firestore

La URL puede contener:

```text
pacienteId
citaId
```

pero nunca debe utilizar la URL como fuente de autoridad para:

```text
businessId
role
permisos
membresía
```

Ejemplo:

```text
/veterinaria/pacientes/PAC123
```

debe resolverse conceptualmente como:

```text
businessId autorizado
        +
PAC123
        ↓
negocios/{businessId}/pacientesVeterinarios/PAC123
```

De igual manera:

```text
/veterinaria/citas/CITA456
```

corresponde conceptualmente a:

```text
businessId autorizado
        +
CITA456
        ↓
negocios/{businessId}/citasVeterinarias/CITA456
```

y su atención clínica relacionada:

```text
negocios/{businessId}/atencionesVeterinarias/CITA456
```

## Navegación propuesta

La navegación principal del módulo queda:

```text
Clínica Veterinaria
│
├── Pacientes
│     ├── Listado
│     ├── Nuevo paciente
│     └── Ficha integral
│
└── Agenda
      ├── Calendario / listado
      ├── Nueva cita
      └── Detalle de cita
             │
             ├── Recepción / Triage
             ├── Consulta clínica
             ├── Atención
             └── Cierre clínico
```

## Rutas objetivo del MVP

Las rutas propuestas para el MVP son:

```text
/veterinaria
/veterinaria/pacientes
/veterinaria/pacientes/nuevo
/veterinaria/pacientes/:pacienteId
/veterinaria/agenda
/veterinaria/agenda/nueva
/veterinaria/citas/:citaId
```

Las rutas representan el diseño objetivo.

Su incorporación a `App.jsx` deberá realizarse posteriormente mediante un cambio pequeño y revisable, ya que dicho archivo pertenece a la integración central de la aplicación.

---

# 37. Resultado del diseño

Con esta especificación quedan diseñados los tres elementos previstos para esta etapa:

```text
Modelo de datos Firestore   ✅
Componentes React           ✅
Rutas React                 ✅
```

El diseño establece además:

```text
businessId desde ValoraCloud
        ↓
datos aislados por negocio
        ↓
componentes veterinarios
        ↓
integraciones Core controladas
```

La siguiente etapa corresponde a implementar progresivamente este diseño, comenzando por servicios de persistencia y conexión del módulo con el contexto real de ValoraCloud, sin modificar de forma directa componentes protegidos del Core.


## 38. Integración con Core pendiente de revisión

La implementación aislada del módulo Clínica Veterinaria se encuentra preparada,
pero su habilitación global requiere cambios en componentes protegidos del Core
de ValoraCloud. Conforme a `MODULE_DEVELOPMENT_CONTRACT.md`, estos cambios no se
realizan sin aprobación explícita del mantenedor.

### 38.1 Necesidad funcional

El módulo necesita:

- exponer la ruta principal `/veterinaria/*` desde el router global;
- permitir el acceso a Veterinaria mediante el RBAC central;
- habilitar acceso autorizado a las colecciones:
  - `negocios/{businessId}/pacientesVeterinarios`;
  - `negocios/{businessId}/citasVeterinarias`;
  - `negocios/{businessId}/atencionesVeterinarias`.

Actualmente las rutas internas React, los paths Firestore y la capa de lectura
del módulo ya se encuentran implementados.

### 38.2 Core afectado

La integración requiere revisión de los siguientes componentes protegidos:

- `src/app/App.jsx`;
- `src/domain/rbac.mjs`;
- `firestore.rules`.

Las futuras mutaciones clínicas también deberán revisarse antes de incorporar
Functions o mecanismos autoritativos de escritura.

### 38.3 Por qué no basta una integración aislada

`App.jsx` valida las rutas mediante `canAccessBusinessPath()`. Como
`/veterinaria` todavía no pertenece al RBAC central, una ruta agregada solamente
en React sería redirigida antes de cargar el módulo.

Además, las Firestore Rules actuales bloquean cualquier colección de negocio que
no tenga una regla explícita. Por esta razón, las colecciones veterinarias no
pueden leerse ni escribirse desde el cliente hasta que el Core autorice su
contrato de acceso.

### 38.4 Riesgos

Una modificación incorrecta podría:

- permitir acceso de un perfil no autorizado;
- romper el aislamiento entre negocios;
- habilitar lecturas o escrituras cross-tenant;
- otorgar permisos clínicos mediante módulos no relacionados;
- introducir escrituras frontend como autoridad;
- afectar contratos existentes de RBAC o Firestore Rules.

Por estas razones no se reutilizan artificialmente permisos de Inventario,
Clientes u otros módulos para autorizar Veterinaria.

### 38.5 Propuesta mínima para revisión

Se propone al mantenedor:

1. registrar el módulo `veterinaria` en el RBAC central;
2. definir permisos y perfiles autorizados para lectura y operación clínica;
3. registrar `/veterinaria/*` en el router global;
4. habilitar Rules explícitas para las tres colecciones veterinarias;
5. mantener `businessId` derivado exclusivamente del contexto autorizado;
6. mantener las operaciones de stock mediante mecanismos aprobados del Core;
7. definir Functions autoritativas antes de habilitar mutaciones clínicas
   sensibles.

No se propone modificar la economía de Inventario, costos, valorización,
ledger, Ventas, Compras o Recepciones.

### 38.6 Pruebas necesarias para aprobar la integración

La integración Core deberá validar como mínimo:

- negocio activo requerido;
- rechazo de acceso cross-tenant;
- acceso permitido y denegado según RBAC;
- lectura aislada de pacientes, citas y atenciones;
- bloqueo de mutaciones no autorizadas;
- integración de Inventario únicamente en lectura desde Veterinaria;
- ausencia de escrituras directas de stock desde frontend;
- `npm run test:veterinary` en verde;
- `npm run build` en verde;
- pruebas de Firestore Rules mediante Emulator Suite.

### 38.7 Estado actual

Implementado en la feature branch:

- modelo de datos veterinario;
- paths Firestore aislados dentro del módulo;
- capa de lectura para pacientes, citas y atenciones;
- integración con `businessId`;
- integración de lectura con Inventario Core;
- rutas React internas;
- `VeterinaryPage`;
- `VeterinaryManager`.

Pendiente exclusivamente de aprobación del mantenedor:

- conexión global en `App.jsx`;
- alta del módulo y permisos en RBAC;
- Rules para las colecciones veterinarias;
- mecanismos autoritativos de escritura.

No se modificó ningún componente Core protegido para resolver estos pendientes.

## 39. Revisión del mantenedor y validación final

### 39.1 Resultado de la revisión

El mantenedor revisó el PR del módulo Clínica Veterinaria y confirmó que no
existen observaciones que bloqueen el avance actual.

Se validó especialmente que:

- la rama se encuentra actualizada con la baseline;
- la integración con Inventario Core es únicamente de lectura;
- las lecturas utilizan el `businessId` del negocio activo;
- no existen escrituras directas desde el navegador;
- la validación duplicada de farmacia fue corregida;
- no se modificaron componentes protegidos del Core sin autorización;
- las pruebas de Rules, RBAC y los smokes veterinarios se encuentran en verde.

### 39.2 Correcciones aplicadas después de la revisión

Se aplicaron las siguientes observaciones del mantenedor:

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

Las rutas internas implementadas son:

- `/veterinaria`;
- `/veterinaria/pacientes`;
- `/veterinaria/pacientes/nuevo`;
- `/veterinaria/pacientes/:pacienteId`;
- `/veterinaria/agenda`;
- `/veterinaria/agenda/nueva`;
- `/veterinaria/citas/:citaId`.

Estas rutas representan actualmente la estructura de navegación del módulo.

No deben considerarse como siete pantallas productivas terminadas, ya que por
ahora reutilizan el contenedor principal y todavía deben conectarse a sus
componentes específicos.

### 39.4 Validaciones ejecutadas

Después de las correcciones se ejecutaron:

- `npm run build`;
- `npm run test:veterinary`;
- `npm run test:rules`;
- `npm run test:rbac`;
- `npm run test:inventory-service`;
- `npm run test:inventory-model`;
- `git diff --check`.

Todos finalizaron correctamente.

Los siete smoke tests del dominio veterinario permanecen en verde.

### 39.5 Integración autorizada pendiente de nueva baseline

El mantenedor autorizó posteriormente la integración del módulo con:

- `App.jsx` y `/veterinaria/*`;
- menú principal;
- módulo y permisos propios en RBAC;
- reglas Firestore para las tres colecciones veterinarias;
- Functions propias para crear y modificar pacientes, citas y atenciones.

La integración no se realizará todavía sobre la baseline actual porque el Core
cambió significativamente y se publicará una nueva versión.

Cuando esa baseline esté disponible también se deberán incorporar:

- tokens de diseño en reemplazo de los `rgba()` existentes;
- componentes compartidos como `LoadingState` y `SkeletonCards`;
- clases visuales `ui-`;
- pruebas de presupuesto de Firestore Rules.

### 39.6 Restricciones vigentes

Continúa sin autorización:

- modificar Functions centrales existentes;
- descontar stock desde Farmacia Veterinaria;
- crear un mecanismo propio de consumo de inventario.

Farmacia Veterinaria continúa operando únicamente en modo lectura hasta que el
Core entregue un mecanismo único y autorizado de consumo de stock.

La activación futura del módulo según el rubro del negocio también corresponde
al Core y no forma parte de la responsabilidad del módulo.