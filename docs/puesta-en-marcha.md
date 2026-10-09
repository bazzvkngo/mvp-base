# Puesta en marcha de Bagner en producción

Checklist para pasar ValoraCloud de sandbox a uso real en Bagner a fines de
octubre de 2026.

**Objetivo:** que "Servicios Integrales Bagner SpA" quede en producción con
**Bruno como OWNER** (cuenta real) y **Mauricio como ADMIN**, sin datos
simulados.

**Alternativa elegida (A): eliminar y recrear.** El Bagner simulado que existe
hoy en producción tiene como OWNER una cuenta de prueba, y ValoraCloud todavía
no permite traspasar la propiedad de un negocio. Se elimina el negocio simulado
desde la consola de la plataforma y Bruno crea el negocio real desde su propia
cuenta. Así la numeración de cotizaciones y ventas parte desde 0001 y los
reportes no arrastran ventas ni stock simulados.

## Quién hace qué

| Persona | Rol en la puesta en marcha |
|---|---|
| **Bruno** | Crea su cuenta, crea el negocio real (queda como OWNER), solicita la verificación y agrega a Mauricio. Solo el OWNER puede solicitar la verificación. |
| **Mauricio** | Superadministrador de la plataforma: revisa producción, elimina el negocio simulado, suspende la cuenta de prueba y aprueba la verificación. Después queda como ADMIN del negocio real. |

## Orden importante

El paso 4 (eliminar el negocio simulado) debe completarse **antes** del paso 8
(aprobar la verificación). La reserva del RUT se crea al aprobar una
verificación. Si el Bagner simulado está verificado, su reserva bloquea la
aprobación del negocio real con el error *"La identidad fiscal ya pertenece a
otra empresa verificada"* hasta que se elimine.

## Pasos

### Paso 0 (opcional): respaldo previo

- [ ] **Quién:** Mauricio.
- [ ] **Hacer:** exportar Firestore antes de borrar, por ejemplo con
  `gcloud firestore export gs://<bucket-de-respaldos>/puesta-en-marcha-<fecha>`.
  Si se quiere conservar algún archivo del negocio simulado (logo,
  documentos), descargarlo desde Storage (`negocios/<id-del-negocio>/`).
- [ ] **Verificar:** la operación de exportación terminó sin errores y el
  respaldo aparece en el bucket.

La eliminación del paso 4 es irreversible. Sin este respaldo, los datos del
negocio simulado no se pueden recuperar.

### Paso 1: revisar el Bagner simulado en producción

- [ ] **Quién:** Mauricio, en la consola de Firebase y en la consola de la
  plataforma (`/admin/empresas`).
- [ ] **Revisar y anotar:**
  - RUT registrado y estado de verificación del negocio simulado.
  - Si existe el documento `identidadesFiscalesVerificadas/CL__<RUT sin
    puntos ni guion>` (por ejemplo, `CL__770916798`) y a qué `negocioId`
    apunta.
  - Miembros del negocio y cuál es la cuenta de prueba que figura como OWNER.
  - Si hay datos reales que convenga rescatar (por ejemplo, un catálogo de
    inventario cargado a mano) para reimportarlos en el paso 10.
- [ ] **Verificar:** quedan anotados el RUT, el `negocioId` del negocio
  simulado y el correo de la cuenta de prueba.

### Paso 2: Bruno crea su cuenta real

- [ ] **Quién:** Bruno.
- [ ] **Hacer:** registrarse en ValoraCloud con su correo real y verificar el
  correo desde el enlace que llega a su bandeja.
- [ ] **Verificar:** Bruno puede iniciar sesión. En **Mi cuenta → Acceso y
  seguridad** el correo aparece como verificado.

Bruno todavía no crea el negocio; eso es el paso 6.

### Paso 3: Mauricio confirma su propia cuenta

- [ ] **Quién:** Mauricio.
- [ ] **Hacer:** confirmar que su cuenta de ValoraCloud existe y que puede
  entrar a la consola de la plataforma.
- [ ] **Verificar:** Mauricio inicia sesión y ve el botón **Consola de
  Administración**. Su cuenta debe existir antes del paso 9.

### Paso 4: eliminar permanentemente el Bagner simulado

- [ ] **Quién:** Mauricio, en la consola de la plataforma.
- [ ] **Hacer:** **Empresas** → abrir el Bagner simulado → **Zona de peligro**
  → **Eliminar empresa permanentemente** → escribir el nombre comercial exacto.
- [ ] **No usar** la opción **Eliminar empresa** del ERP (Empresa → Eliminar
  empresa). Esa eliminación es lógica: marca el negocio como eliminado pero
  **no libera la reserva del RUT**, y el negocio real no se podría verificar.
- [ ] **Verificar:**
  - El negocio ya no aparece en **Empresas**.
  - El documento `identidadesFiscalesVerificadas/CL__<RUT>` ya no existe en la
    consola de Firebase.
  - Mauricio sigue entrando normalmente a sus otros negocios, como MAURICIO
    LIMITADA. Si el Bagner simulado era su negocio activo, la plataforma le
    asigna otro.

Si la eliminación falla a mitad de camino, se puede reintentar: la operación
queda registrada y continúa donde quedó.

### Paso 5: suspender la cuenta de prueba

- [ ] **Quién:** Mauricio, en la consola de la plataforma.
- [ ] **Hacer:** **Usuarios** → abrir la cuenta de prueba que era OWNER →
  **Control de acceso** → suspender, indicando el motivo.
- [ ] **Verificar:** la cuenta aparece como suspendida y ya no puede iniciar
  sesión.

### Paso 6: Bruno crea el negocio real

- [ ] **Quién:** Bruno.
- [ ] **Hacer:** al entrar sin negocios, el onboarding pide nombre comercial,
  rubro y país. Crear "Servicios Integrales Bagner SpA", con país Chile.
- [ ] **Verificar:** Bruno entra al ERP del negocio nuevo. En **Empleados**
  figura como propietario (OWNER).

### Paso 7: Bruno completa la empresa y solicita la verificación

- [ ] **Quién:** Bruno.
- [ ] **Hacer:**
  - En **Empresa**, completar razón social, RUT real, giro, dirección,
    teléfono o correo de contacto y logo.
  - Configurar los valores predeterminados de cotización (validez, plazo de
    entrega, garantía, condiciones de pago).
  - En **Empresa → Verificación**, pulsar **Solicitar verificación** y
    confirmar los datos.
- [ ] **Verificar:** el estado de verificación queda **en revisión** y la
  solicitud aparece en **Verificaciones** de la consola de la plataforma.

### Paso 8: Mauricio aprueba la verificación

- [ ] **Quién:** Mauricio, en la consola de la plataforma.
- [ ] **Antes:** confirmar que el paso 4 está completo.
- [ ] **Hacer:** **Verificaciones** → abrir la solicitud del negocio real →
  revisar los datos contra la documentación de Bagner → **Aprobar empresa**.
- [ ] **Verificar:**
  - El negocio aparece como **verificado**.
  - El documento `identidadesFiscalesVerificadas/CL__<RUT>` existe y apunta al
    `negocioId` del negocio **nuevo**.
  - Bruno ya puede operar: los módulos dejan de estar bloqueados.

### Paso 9: Bruno agrega a Mauricio como ADMIN

- [ ] **Quién:** Bruno.
- [ ] **Hacer:** **Empleados → Agregar usuario** → correo de Mauricio → perfil
  **Administrador**.
- [ ] **Verificar:** Mauricio ve el negocio en su selector de negocios y entra
  con rol ADMIN. Bruno sigue como OWNER.

### Paso 10: carga inicial de datos reales

- [ ] **Quién:** Bruno y Mauricio.
- [ ] **Hacer:**
  - Inventario: **Inventario → Importar inventario**, o cargar los ítems uno
    por uno.
  - Clientes y proveedores reales.
- [ ] **No crear** cotizaciones, ventas, compras ni movimientos "de prueba" en
  este negocio (ver la regla de abajo).
- [ ] **Verificar:** el inventario y los clientes cargados coinciden con la
  información de Bagner. La primera cotización real de Bruno será la
  COT-<año>-0001.

## Regla después de la puesta en marcha: no se prueba en el negocio real

Desde el paso 10, **el negocio real de Bagner solo se usa para operación
real**.

- Las pruebas de funciones nuevas, demostraciones y ensayos se hacen en
  **MAURICIO LIMITADA** (el negocio de pruebas de Mauricio en producción) o en
  los emuladores locales.
- Cotizaciones, ventas, compras, recepciones y movimientos de inventario no
  se pueden eliminar físicamente: una prueba en el negocio real deja huella en
  la numeración, el stock y los reportes.
- Si se crea algo por error en el negocio real, se anula, cancela o archiva
  desde su propio módulo; no se intenta borrar.

## Trabajo futuro: traspaso de propietario

ValoraCloud no permite hoy traspasar el rol OWNER de un negocio a otra
cuenta: OWNER no es un rol asignable y la membresía del propietario no se puede
modificar. Para esta puesta en marcha no hace falta, porque se recrea el
negocio. Sí hará falta al comercializar el sistema, por ejemplo cuando un dueño
venda o ceda su negocio.

Se debe especificar en una SPEC propia (número por asignar) antes de
implementarlo. Alcance previsto:

- Una Function de plataforma, solo para superadministradores, con confirmación
  por nombre comercial y solicitud idempotente.
- En una sola transacción: dejar la membresía de la cuenta nueva como OWNER
  activo, bajar al propietario anterior a ADMIN o desactivarlo, recalcular el
  contador de negocios propios de ambas cuentas y fijar el negocio activo del
  nuevo dueño si no tiene uno.
- Revisar `getOwnerEmailVerified` (`functions/businessOnboarding.js`), que hoy
  identifica al dueño por `negocios.creadoPorUid` antes que por la membresía
  OWNER.
- Registro en `auditoriaPlataforma` y acción en la ficha de empresa de la
  consola.
- Smoke integrado con emuladores. Las reglas de Firestore no cambian.
- Tamaño estimado: mediano, en una o dos etapas.
