# Proyecto

- ValoraCloud es un ERP SaaS multiempresa.
- Stack: React, Vite, JavaScript, Firebase Authentication, Firestore, Firebase Functions y Node.js.
- El objetivo inmediato es completar el MVP empresarial solicitado por el profesor sin IA en el flujo principal.
- El código existente de IA se conserva, pero no debe ampliarse ni eliminarse sin autorización.

# Arquitectura obligatoria

- Los datos operacionales viven bajo `negocios/{businessId}/...`.
- Las membresías viven en `membresias/{businessId}__{uid}`.
- `negocioActivoId` sirve como contexto de navegación, no como autorización.
- La autoridad real es una membresía activa.
- Las operaciones sensibles deben validarse en backend.
- No confiar únicamente en validaciones frontend.
- No permitir acceso cruzado entre empresas.

# Precedencia documental

- `AGENTS.md` sigue siendo la autoridad máxima en seguridad, arquitectura multiempresa y workflow.
- Para decisiones de producto post-demo, leer `docs/specs/016-vision-post-demo-bruno.md`.
- Una SPEC específica más reciente puede sustituir únicamente los puntos que declare explícitamente reemplazados.
- Las SPEC anteriores siguen siendo autoridad para invariantes, compatibilidad legacy y comportamiento no sustituido.
- Si código, una SPEC histórica y la visión post-demo parecen contradecirse, detenerse y analizar la precedencia antes de implementar.
- No convertir objetivos `PENDIENTES` de la SPEC 016 en funciones ya existentes.

# Convenciones

- En código nuevo, usar `businessId` para variables relacionadas con empresa.
- En Firestore, conservar nombres canónicos existentes en español: `negocioId`, `clienteId`, `creadoEn`, `actualizadoEn`, etc.
- No persistir dos nombres para el mismo concepto.
- Mantener compatibilidad legacy mediante adaptadores cuando corresponda.
- No realizar refactorizaciones generales dentro de tareas funcionales.
- No eliminar funcionalidades existentes sin autorización.
- Trabajar en etapas pequeñas.
- No hacer commit ni push salvo solicitud explícita.

# Seguridad

- No guardar secretos en `VITE_*`.
- No versionar secretos, `.env.local`, `functions/.secret.local`, logs, `output/`, `tmp/` ni datos de emuladores.
- Las colecciones internas no deben ser accesibles mediante el SDK cliente.
- No permitir eliminación física de registros referenciados.
- Las reglas Firestore no sustituyen validaciones autoritativas en Functions.

# Flujo de trabajo

Antes de modificar:

1. Leer `AGENTS.md`.
2. Leer la SPEC aplicable.
3. Revisar Git.
4. Analizar los archivos relacionados.
5. Respetar estrictamente el alcance.
6. Informar riesgos antes de cambios estructurales.

Después de modificar:

- Resumir archivos y decisiones.
- Informar pruebas ejecutadas y pendientes.
- Mostrar `git status --short`.
- Detenerse sin commit.

# Verificación mínima

Según el alcance, ejecutar:

```bash
npm run build
npm --prefix functions run lint
git diff --check
```

También ejecutar todos los smokes relacionados.
