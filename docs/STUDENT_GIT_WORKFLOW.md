# Workflow Git para estudiantes

## Modelo de ramas

```text
student-baseline-20260901
  ├─ feature/taller-automotriz
  ├─ feature/modulo-estudiante-2
  └─ feature/modulo-estudiante-3
```

`student-baseline-20260901` es una base congelada para crear ramas, no una rama
de trabajo. `mvp-base-profesor` tampoco debe recibir cambios estudiantiles.

## Crear tu rama

Parte de una copia limpia de la baseline:

```bash
git status --short
git switch student-baseline-20260901
git switch -c feature/nombre-del-modulo
```

Si `git status --short` muestra cambios que no son tuyos, no los descartes ni
los mezcles: detente y pide revisión. Usa un nombre de rama breve y específico;
un alumno o equipo mantiene una sola responsabilidad por rama.

## Trabajo diario

Antes de editar:

```bash
git branch --show-current
git status --short
```

Durante el desarrollo:

- mantén el cambio dentro de la SPEC y del contrato del módulo;
- revisa `git diff` con frecuencia;
- no incluyas archivos de otros módulos;
- no agregues `.env.local`, secretos, logs, `dist/`, `output/`, `tmp/`, datos de
  emuladores ni `node_modules/`;
- no uses datos o servicios Firebase reales.

## Commits

Agrupa una decisión verificable por commit:

```bash
git add ruta/al/archivo
git diff --cached
git commit -m "feat(modulo): describe el cambio"
```

Evita `git add .` cuando pueda incluir archivos ajenos. Los mensajes deben
explicar el resultado, no sólo indicar “cambios” o “avance”. No mezcles módulos,
refactors generales y correcciones no relacionadas.

## Ramas compartidas

- No hagas rebase ni force push sobre ramas compartidas.
- No hagas merge a `student-baseline-20260901`.
- No hagas merge a `mvp-base-profesor`.
- No integres ramas de otros equipos por tu cuenta.
- Si necesitas actualizar la base, pide al mantenedor que indique la estrategia
  y el punto exacto de integración.

## Validar antes de entregar

Ejecuta las pruebas del módulo y, como mínimo cuando correspondan:

```bash
npm run build
npm --prefix functions run lint
git diff --check
git status --short
```

Usa emuladores para toda integración Firebase. El estado final debe contener
sólo archivos del alcance acordado.

## Entrega mediante branch o PR

Sube únicamente tu feature branch al remoto autorizado y abre un PR contra la
rama que indique el mantenedor. No completes el merge.

La descripción debe incluir:

- objetivo y límites del módulo;
- archivos, colecciones y campos añadidos;
- permisos y controles multiempresa;
- idempotencia y efectos autoritativos;
- pruebas ejecutadas y resultados;
- limitaciones, deuda y decisiones que requieren revisión.

El mantenedor revisa seguridad, compatibilidad y alcance, solicita ajustes y
decide si, cuándo y cómo integrar el módulo a una rama común.
