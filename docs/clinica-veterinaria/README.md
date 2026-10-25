# Clínica Veterinaria

## 1. Descripción

Clínica Veterinaria es un módulo desarrollado para ValoraCloud orientado a la
gestión clínica de pacientes veterinarios dentro de un negocio.

El módulo contempla el manejo de pacientes, agenda de citas, recepción,
triage, consulta clínica, atención, cierre clínico e integración con
Inventario/Farmacia.

El desarrollo se realiza de forma aislada respecto del Core de ValoraCloud,
respetando el contrato de desarrollo de módulos y utilizando `businessId`
como contexto multiempresa.

---

## 2. Alcance

El módulo considera las siguientes áreas funcionales:

- ficha integral del paciente;
- agenda veterinaria;
- recepción;
- triage;
- consulta clínica;
- atención veterinaria;
- cierre clínico;
- integración con Inventario y Farmacia.

Actualmente el módulo cuenta con modelos de dominio, validaciones, rutas
internas React y una capa inicial de lectura de datos.

---

## 3. Arquitectura del módulo

La integración principal sigue la estructura:

```text
VeterinaryPage
      |
      v
VeterinaryRoutes
      |
      v
VeterinaryManager
      |
      +--> Modelo de datos veterinario
      |
      +--> Inventario Core
```

`VeterinaryPage` actúa como punto de entrada del módulo.

`VeterinaryRoutes` contiene la estructura de navegación interna.

`VeterinaryManager` recibe el `businessId` autorizado desde la aplicación y
coordina las lecturas de datos veterinarios y de Inventario.

---

## 4. Estructura principal de archivos

```text
src/
├── pages/
│   └── VeterinaryPage.jsx
│
└── features/
    └── veterinary/
        ├── VeterinaryManager.jsx
        ├── VeterinaryRoutes.jsx
        │
        ├── data/
        │   ├── veterinaryDataService.js
        │   └── veterinaryFirestorePaths.mjs
        │
        └── domain/
            ├── patientModel.mjs
            ├── appointmentModel.mjs
            ├── receptionTriageModel.mjs
            ├── clinicalConsultationModel.mjs
            ├── attentionModel.mjs
            ├── clinicalClosureModel.mjs
            └── inventoryPharmacyIntegrationModel.mjs
```

Los archivos existentes bajo `src/features/veterinary/dev/` corresponden a
previsualizaciones y laboratorios de desarrollo y no forman parte de la
integración productiva actual.

---

## 5. Modelo de datos

El modelo propuesto utiliza las siguientes colecciones:

```text
negocios/{businessId}
├── pacientesVeterinarios/{pacienteId}
├── citasVeterinarias/{citaId}
└── atencionesVeterinarias/{atencionId}
```

También se consumen datos existentes del Core:

```text
negocios/{businessId}/clientes
negocios/{businessId}/inventario
```

El identificador `businessId` siempre debe provenir del contexto autorizado
del negocio activo y no debe obtenerse desde parámetros manipulables por el
usuario.

---

## 6. Flujo clínico

El flujo clínico diseñado es:

```text
Paciente
   |
   v
Agenda / Cita
   |
   v
Recepción
   |
   v
Triage
   |
   v
Consulta clínica
   |
   v
Atención
   |
   v
Cierre clínico
```

Durante una atención se pueden referenciar servicios y productos provenientes
del Inventario Core.

---

## 7. Rutas React

Actualmente están definidas las siguientes rutas internas:

```text
/clinica-veterinaria
/clinica-veterinaria/pacientes
/clinica-veterinaria/pacientes/nuevo
/clinica-veterinaria/pacientes/:pacienteId
/clinica-veterinaria/agenda
/clinica-veterinaria/agenda/nueva
/clinica-veterinaria/citas/:citaId
```

Estas rutas representan la estructura inicial de navegación.

Actualmente reutilizan el contenedor principal del módulo, por lo que no deben
considerarse como siete pantallas productivas independientes terminadas.

La ruta global `/clinica-veterinaria/*` ya se encuentra integrada en `App.jsx`.

---

## 8. Integración con Inventario Core

El módulo utiliza:

```text
subscribeToInventory(businessId)
```

para consultar el inventario real correspondiente al negocio activo.

La información es adaptada para identificar:

- servicios veterinarios;
- productos de farmacia;
- stock disponible para fines informativos.

La integración actual es únicamente de lectura.

El módulo no modifica:

- stock;
- costo promedio;
- valorización;
- movimientos de inventario;
- adquisiciones;
- ledger de inventario.

El descuento real de stock queda pendiente de un mecanismo único que será
definido por el Core de ValoraCloud.

---

## 9. Seguridad y multiempresa

Todos los datos veterinarios deben permanecer bajo:

```text
negocios/{businessId}/...
```

El frontend no constituye autoridad de autorización.

Las futuras escrituras deberán realizarse mediante Functions y validarse con:

- usuario autenticado;
- negocio activo;
- membresía activa;
- permisos correspondientes;
- aislamiento entre negocios.

No se permiten escrituras directas de stock desde el navegador.

---

## 10. Manejo de errores

Las suscripciones de datos veterinarios distinguen actualmente entre:

```text
permission-denied
```

y otros errores de carga.

Un error de permisos informa que el usuario no tiene autorización para acceder
a los datos clínicos.

Los errores de red, índices u otros problemas utilizan un mensaje general de
carga.

---

## 11. Pruebas ejecutadas

La validación realizada sobre la baseline actual incluye:

```text
npm run build
npm run test:veterinary
npm run test:rules
npm run test:rbac
npm run test:inventory-service
npm run test:inventory-model
git diff --check
```

Resultados:

- compilación general correcta;
- 7/7 smoke tests veterinarios correctos;
- Firestore Rules correctas;
- RBAC correcto;
- servicio de Inventario correcto;
- modelo y MVP de Inventario correctos;
- validación de diferencias Git sin errores.

---

## 12. Estado actual

Actualmente se encuentran implementados:

- modelos de dominio veterinarios;
- validaciones principales;
- integración mediante `businessId`;
- paths Firestore veterinarios;
- capa de lectura de pacientes;
- capa de lectura de citas;
- capa de lectura de atenciones;
- integración de lectura con Inventario Core;
- `VeterinaryManager`;
- `VeterinaryPage`;
- rutas internas React;
- smoke tests del módulo.

---

## 13. Integracion con student-baseline

Actualmente el modulo ya se encuentra integrado con student-baseline.

La integracion incluye:

- registro de veterinaria en VERTICAL_MODULES;
- ruta base /clinica-veterinaria;
- montaje de VeterinaryPage en App.jsx;
- entrada de menu obtenida desde el registro de modulos verticales;
- permiso veterinaria.read en RBAC;
- Firestore Rules para las colecciones veterinarias;
- bloqueo de escrituras directas desde el navegador.

Para el MVP, la lectura de datos clinicos queda limitada a OWNER y ADMIN.

Los roles TECNICO y MEMBER no tienen acceso a datos clinicos veterinarios en
esta etapa.

Quedan pendientes para una etapa posterior:

- Functions para crear y modificar pacientes;
- Functions para citas;
- Functions para atenciones;
- pruebas de aislamiento entre empresas a nivel de Functions.

---
## 14. Cambios visuales pendientes

Los siguientes ajustes se realizaran cuando Mauricio entregue la nueva baseline
con las guias visuales correspondientes:

- tokens de diseno segun la nueva guia;
- LoadingState;
- SkeletonCards;
- clases visuales compartidas ui-;
- validaciones adicionales de colores y contraste.

Estos cambios se dejan pendientes expresamente para la nueva baseline.

---
## 15. Restricciones actuales

Por indicacion del mantenedor, actualmente no se debe:

- modificar Functions centrales;
- implementar un mecanismo propio de descuento de stock;
- modificar la economia del Inventario Core;
- desplegar cambios a produccion;
- modificar secretos o configuracion productiva.

La activacion de Veterinaria no depende del rubro del negocio. El acceso se
controla mediante el registro de modulos verticales y los modulos habilitados
para cada negocio.

---
## 16. Documentación relacionada

La especificación técnica principal se encuentra actualmente en:

```text
docs/specs/027-clinica-veterinaria-mvp.md
```

El número oficial de esta especificación es `027`.