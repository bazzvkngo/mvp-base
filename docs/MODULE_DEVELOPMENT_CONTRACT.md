# Contrato de desarrollo de módulos

## Alcance

Este contrato permite construir módulos aislados sobre ValoraCloud sin cambiar
el Core aprobado. `AGENTS.md` conserva la máxima autoridad en seguridad,
arquitectura multiempresa y workflow; las SPEC definen el producto vigente y
los pendientes confirmados.

## Core protegido

Sin aprobación explícita del mantenedor, un estudiante no puede modificar:

- autenticación, sesión ni recuperación de acceso;
- selección, autorización o aislamiento del negocio activo;
- el modelo central `negocios/{businessId}/...`;
- membresías `membresias/{businessId}__{uid}`;
- RBAC central ni helpers compartidos de autorización;
- verificación empresarial ni el gate `VERIFICADA`;
- Platform Admin;
- Firestore Rules o Storage Rules globales;
- economía Q/V de Inventario;
- `costoPromedio`, `valorInventario` o su moneda;
- el ledger `adquisicionesInventario`;
- Compras, Recepciones o Ventas core;
- reversión, cancelación o devolución de stock;
- snapshots históricos e idempotencia ya existentes;
- funciones centrales compartidas;
- configuración, proyectos, secretos o deploy de producción.

El módulo Taller/Automotriz es sólo un ejemplo de feature branch futura. Esta
baseline no autoriza diseñarlo o conectarlo al Core sin su propia SPEC aprobada.

## Requisitos de todo módulo nuevo

### Multiempresa y autorización

- Todos los datos operacionales deben vivir bajo
  `negocios/{businessId}/...`.
- `negocioActivoId` es contexto de navegación, no prueba de autorización.
- Toda lectura o mutación sensible debe comprobar una membresía activa y el rol
  requerido en backend.
- Debe negarse el acceso cross-tenant, incluso si el cliente manipula IDs.
- El frontend no sustituye validaciones de Functions o Rules.

### Mutaciones e integridad

- Usa identificadores y documentos deterministas cuando el caso lo permita.
- Las mutaciones críticas deben tener `requestId` e idempotencia comprobable.
- Evita efectos parciales; usa transacciones o batches dentro de sus límites.
- No modifiques stock desde frontend ni escribas directamente colecciones
  internas.
- No reinterpretes snapshots históricos ni campos legacy silenciosamente.
- No inventes IVA, impuestos, conversiones FX ni reglas contables.
- No llames APIs gubernamentales desde el módulo.

### Seguridad y entorno

- Desarrolla y prueba sólo con Firebase Emulator Suite.
- No accedas, solicites, registres ni expongas secretos.
- Nunca guardes secretos en `VITE_*`, código, fixtures, logs o documentación.
- No ejecutes deploy de Firebase, cPanel ni scripts/probes de producción.
- No cambies `.firebaserc` ni el proyecto Firebase autoritativo.

### Compatibilidad y documentación

- Mantén compatibilidad con consumidores y campos del Core.
- No hagas refactors generales como parte de un módulo.
- Documenta colecciones, documentos, campos, estados, índices requeridos,
  ownership, permisos e idempotencia.
- Distingue comportamiento implementado, limitaciones y trabajo pendiente.
- Añade pruebas unitarias/smoke y, cuando exista persistencia, una integración
  local que cubra autorización, aislamiento y reintentos.

## Checklist de entrega

- alcance limitado a una feature branch;
- SPEC o contrato del módulo identificado;
- rutas multiempresa y RBAC documentados;
- mutaciones críticas idempotentes;
- cross-tenant rechazado por prueba;
- ninguna escritura directa de stock desde frontend;
- smokes e integraciones relacionadas en verde;
- Functions lint y build en verde cuando correspondan;
- `git diff --check` limpio;
- sin credenciales, datos reales, artefactos generados ni deploy.

## Si tu módulo necesita modificar el Core

Detente antes de cambiarlo. Documenta:

1. la necesidad funcional concreta;
2. el archivo, colección o contrato Core afectado;
3. por qué una integración aislada no resuelve el caso;
4. los riesgos de seguridad, compatibilidad e históricos;
5. la propuesta mínima y las pruebas necesarias.

Entrega ese análisis al mantenedor y espera revisión explícita. La necesidad de
un módulo no concede autorización implícita para modificar el Core.
