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
/veterinaria
/veterinaria/pacientes
/veterinaria/pacientes/nuevo
/veterinaria/pacientes/:pacienteId
/veterinaria/agenda
/veterinaria/agenda/nueva
/veterinaria/citas/:citaId
```

Estas rutas representan la estructura inicial de navegación.

Actualmente reutilizan el contenedor principal del módulo, por lo que no deben
considerarse como siete pantallas productivas independientes terminadas.

La conexión global de `/veterinaria/*` se realizará cuando se integre el módulo
sobre la nueva baseline de ValoraCloud.

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

## 13. Integración pendiente con nueva baseline

El mantenedor autorizó realizar posteriormente:

- integración de `/veterinaria/*` en `App.jsx`;
- entrada de Clínica Veterinaria en el menú;
- módulo y permisos propios en RBAC;
- Firestore Rules para las colecciones veterinarias;
- Functions propias para crear y modificar pacientes;
- Functions propias para citas;
- Functions propias para atenciones.

Estos cambios se realizarán sobre la nueva baseline para evitar conflictos con
las modificaciones recientes del Core.

---

## 14. Cambios visuales pendientes

Cuando se realice la migración a la nueva baseline también deberán incorporarse:

- tokens de diseño en reemplazo de valores `rgba()` escritos directamente;
- `LoadingState`;
- `SkeletonCards`;
- clases visuales compartidas `ui-`.

Estos cambios no se realizan todavía porque dependen de los componentes y
tokens de la nueva versión del sistema.

---

## 15. Restricciones actuales

Por indicación del mantenedor, actualmente no se debe:

- modificar Functions centrales;
- implementar un mecanismo propio de descuento de stock;
- modificar la economía del Inventario Core;
- desplegar cambios a producción;
- modificar secretos o configuración productiva.

La activación del módulo según el rubro del negocio será implementada
posteriormente desde el Core de ValoraCloud.

---

## 16. Documentación relacionada

La especificación técnica principal se encuentra actualmente en:

```text
docs/specs/027-clinica-veterinaria-mvp.md
```

El número oficial de esta especificación es `027`.