# Propuesta de modernización visual — Diagnóstico y tokens (borrador)

> Estado: **solo propuesta, no implementado**. Ningún componente ni archivo CSS funcional fue modificado para producir este documento. Es insumo para decidir el siguiente paso.

## 1. Contenido actual de los archivos base

### `src/styles/tokens.css` (97 líneas, único punto de `:root`)

```css
:root {
  color-scheme: light;

  /* Brand */
  --color-brand-50: #edf8f7;
  --color-brand-100: #d5efec;
  --color-brand-200: #acdeda;
  --color-brand-500: #13877e;
  --color-brand-600: #0f766e;
  --color-brand-700: #0b5f59;
  --color-brand-800: #104d49;

  /* Surfaces */
  --color-surface-canvas: #f3f5f7;
  --color-surface-panel: #ffffff;
  --color-surface-subtle: #f8fafc;
  --color-surface-raised: #ffffff;
  --color-surface-hover: #edf6f5;
  --color-surface-selected: #e0f1ef;

  /* Text and borders */
  --color-text-strong: #0f172a;
  --color-text-default: #334155;
  --color-text-muted: #64748b;
  --color-text-inverse: #ffffff;
  --color-border-subtle: #d7dee7;
  --color-border-default: #c5ced9;
  --color-border-control: #7c899b;

  /* Semantic status */
  --color-success-50: #ecfdf5;
  --color-success-700: #047857;
  --color-warning-50: #fffbeb;
  --color-warning-200: #fde68a;
  --color-warning-800: #92400e;
  --color-danger-50: #fef2f2;
  --color-danger-600: #dc2626;
  --color-danger-700: #b91c1c;
  --color-info-50: #eff6ff;
  --color-info-700: #1d4ed8;

  /* Typography */
  --font-family-sans: "Segoe UI Variable Text", "Segoe UI Variable", Inter,
    ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
  --font-family-mono: "Cascadia Code", "SFMono-Regular", Consolas,
    "Liberation Mono", monospace;
  --font-size-xs: 0.8125rem;
  --font-size-sm: 0.875rem;
  --font-size-md: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.375rem;
  --font-size-2xl: 1.75rem;
  --line-height-tight: 1.25;
  --line-height-default: 1.5;
  --font-weight-medium: 550;
  --font-weight-semibold: 650;
  --font-weight-bold: 700;

  /* Spacing */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;

  /* Shape and elevation */
  --radius-sm: 3px;
  --radius-md: 4px;
  --radius-pill: 999px;
  --shadow-sm: 0 1px 2px rgb(15 23 42 / 0.06);
  --shadow-md: 0 8px 24px rgb(15 23 42 / 0.1);

  /* Shell */
  --shell-sidebar-width: 248px;
  --shell-topbar-height: 52px;
  --shell-content-max: 1600px;
  --z-sticky: 20;
  --z-overlay: 80;
  --z-drawer: 90;
  --z-dialog: 110;

  /* Breakpoint reference tokens (media queries use their literal equivalents). */
  --breakpoint-wide: 1200px;
  --breakpoint-shell: 960px;
  --breakpoint-compact: 640px;
  --breakpoint-narrow: 380px;

  /* Interaction */
  --focus-outline: 2px solid #0b5f59;
  --focus-offset: 2px;
  --focus-ring: 0 0 0 3px rgb(19 135 126 / 0.24);
}
```

**Notas sobre lo que hay hoy:**
- No existe `--radius-lg` ni `--radius-xl`. Solo `sm` (3px), `md` (4px) y `pill` (999px).
- No existe `--z-modal`.
- No hay tokens de "acento" separados del brand (todo pasa por `--color-brand-*`).
- No hay tokens de sombra para "card" específicamente, solo `shadow-sm`/`shadow-md` genéricos.

### `src/styles/platform.css` (296 líneas)

Es el layout del panel de super-admin (`PlatformAdminLayout`). Contenido completo ya revisado; puntos clave:

- Define su **propia mini-paleta local** en `.platform-shell`:
  ```css
  .platform-shell {
    --platform-ink: #071725;
    --platform-panel: #0d2436;
    --platform-accent: #53d3c8;
    ...
  }
  ```
  Estas 3 variables no existen en `tokens.css` y no se reutilizan en ningún otro archivo. Es un sistema de color paralelo.
- Usa `var(--radius-lg)` en 3 lugares (líneas 147, 174, 187) — **variable inexistente**, así que el `border-radius` de esas cards del panel admin cae a inválido (efectivamente sin redondeo, esquinas cuadradas) en vez de fallar de forma visible.
- Usa `var(--z-modal)` en la línea 285 — también **inexistente** (los tokens de z-index definidos son `--z-sticky`, `--z-overlay`, `--z-drawer`, `--z-dialog`). Probablemente quiso decir `--z-drawer` o `--z-dialog`.
- Docenas de colores hardcodeados que no vienen de `tokens.css`: `#fff`, `#dbe4e9`, `#187d78`, `#577080`, `#78909d`, `#e7f8f6`, `#82c9c4`, `#526b7a`, `#203846`, `#718794`, `#667e8c`, `#93dcd6`, `#efb4b4`, `#74ccc5`, `#e5ecef`, `#e1e9ed`, `#cbd8de`, etc. — 57 ocurrencias de literales de color en total en este archivo.
- Sombras propias no tomadas de `--shadow-sm`/`--shadow-md`: `box-shadow: 0 8px 22px rgb(7 23 37 / 0.04)` y `0 12px 28px rgb(7 23 37 / 0.1)`.

En resumen: `platform.css` es visualmente **un sistema aparte** del resto de la app (paleta azul-marino/teal oscuro vs. la paleta clara del resto), y además tiene 2 bugs de tokens inexistentes.

## 2. Componentes: quién usa tokens de forma consistente y quién no

### Consistentes (toda su apariencia sale de `components.css`, que sí usa tokens)
- **`Button`** (`src/components/ui/Button.jsx`) — solo aplica clases `ui-button ui-button--{variant}`; cero estilos inline, cero color hardcodeado en el componente. Toda la apariencia vive en `components.css` y ahí sí se usan `var(--color-brand-600)`, `var(--radius-md)`, etc.
- **`StatusBadge`** (`src/components/ui/StatusBadge.jsx`) — mismo patrón: solo clases (`ui-status-badge--{variant}`), estilos en `components.css` con tokens (aunque con 2 excepciones: `border-color: #86d5b2` y `#e7bd55` hardcodeados en vez de un tono de `success`/`warning`).
- **`PageHeader`**, `SkipLink`, `AppIcon` — sin estilos propios relevantes, delegan a clases con tokens.
- **`globals.css`, `layout.css`, `components.css`** (los 3 archivos "core") — son los más disciplinados: prácticamente todo pasa por variables, salvo un puñado de excepciones puntuales (bordes de status badges, algún `#fecaca` suelto, gradientes decorativos del login).

### Con hardcoding que debería ser tokens
- **`platform.css`** — ver arriba, es el peor caso proporcionalmente (57 hex/rgb en 296 líneas).
- **`src/features/purchaseOrders/purchase-orders.css`** (1763 líneas) — define **su propia sub-paleta** (`--po-teal`, `--po-teal-dark`, `--po-navy`, `--po-ink`, `--po-muted`, `--po-border`) y más abajo **otra más** para vistas de documento/impresión (`--po-doc-navy`, `--po-doc-red`, `--po-doc-ink`, `--po-doc-muted`, `--po-doc-border`). 130 literales de color/rgb en total, más ~20 `border-radius` con píxeles sueltos (`7px`, `8px`, `9px`, `11px`) en vez de un token de radio.
- **`src/features/sales/sales.css`** (982 líneas) — 89 literales de color, más de 15 `border-radius` con valores sueltos distintos entre sí (4px, 5px, 6px, 7px, 8px, 10px...).
- **`src/features/quotes/quote-workspace.css`** (786 líneas) — 75 literales de color, radios sueltos (6,7,8,9,10,11,12px).
- **`src/features/receptions/receptions.css`** (140 líneas) — 64 literales de color, casi ningún token; es el archivo proporcionalmente más "crudo" (casi todo su color y radio está hardcodeado, muy poco usa `var(--color-*)`).
- **`src/features/inventory/inventory.css`** (239 líneas) — 28 literales, mezcla de tokens y hardcode.
- **`src/features/purchases/purchases.css`** (81 líneas) — 30 literales, casi todo hardcodeado (`#f8fafc`, `#d6dee8`, `#ecfdf5`, `#075f59`...) pese a que esos mismos tonos ya existen como token (`--color-surface-subtle`, `--color-success-50`, etc.).
- **`src/styles/interior.css`** (5117 líneas — el archivo más grande del proyecto) — 37 literales de color y 15 `box-shadow` no basados en `--shadow-*`, además usa `var(--radius-lg)` (inexistente) en la línea 4660.
- **`src/features/employees/employees.css`** y **`src/features/quotes/public-quote.css`** también referencian `var(--radius-lg)` inexistente.

### Componentes con `style={{ }}` inline usando color
Solo 2 archivos `.jsx` inyectan color por estilo inline en vez de clase/token: `SalePrintView.jsx` y `DashboardDonutChart.jsx` (el segundo es esperable, un gráfico necesita colores calculados en runtime; el primero es una vista de impresión, candidata a revisar si el color inline duplica algo que ya existe como token).

## 3. Tamaño real del problema (conteo)

| Métrica | Cantidad |
|---|---|
| Archivos CSS con al menos un color hardcodeado | 15 de ~19 archivos CSS del proyecto |
| Total de literales de color (`#hex` o `rgb(...)`) fuera de `tokens.css` | **559** (590 totales − 31 que son la definición legítima de los tokens) |
| Paletas de color "locales" paralelas a `tokens.css` | **3**: `.platform-shell` (3 variables), `.purchase-orders` bloque 1 (6 variables `--po-*`), bloque 2 documento (5 variables `--po-doc-*`) |
| Referencias a variables de radio/z-index **inexistentes** (`--radius-lg`, `--z-modal`) | 8 referencias en 6 archivos (bug activo, no solo deuda estética) |
| `border-radius` con valor numérico suelto (no token) | ~60+ ocurrencias, con al menos 10 valores distintos (4,5,6,7,8,9,10,11,12px) que en un sistema de tokens deberían colapsar a 2-3 tamaños |
| `box-shadow` no basado en `--shadow-sm`/`--shadow-md` | 8 declaraciones con sombra custom |
| Componentes UI reutilizables 100% alineados a tokens | `Button`, `StatusBadge`, `PageHeader`, `SkipLink` (4) |

**Lectura:** el 80% de la superficie de código *core* (`globals.css`, `layout.css`, `components.css`, `Button`, `StatusBadge`) ya está bien encaminado y modernizar ahí es barato. El costo real está concentrado en **6 archivos grandes por feature** (`purchase-orders.css`, `sales.css`, `quote-workspace.css`, `interior.css`, `receptions.css`, `purchases.css`) que juntos representan la mayoría de los ~559 literales, más `platform.css` que vive en su propio universo visual. Migrar esos 7 archivos es el verdadero trabajo, no tocar los tokens en sí.

## 4. Propuesta de tokens actualizados (paleta "portal de salud" con identidad ValoraCloud)

Objetivo: mantener el verde-teal que ya es la marca de ValoraCloud (no copiar el azul/verde típico de un portal de salud genérico), pero:
- Fondos más suaves y cálidos (menos gris frío `#f3f5f7`, más un blanco roto cálido).
- Radios más generosos en cards (look "amigable", no look "tabla de spreadsheet").
- Sombras más suaves y difusas (elevación sutil, no sombras duras).
- Un color de acento *secundario* claro (para chips, iconos destacados, progreso) distinto del brand principal, para dar variedad sin salirse de la identidad.
- Resolver los dos bugs (`--radius-lg`, `--z-modal`) como parte del mismo set, para que quien migre no vuelva a pisar el mismo hoyo.

Esto es **solo la propuesta de valores**, no un reemplazo de `tokens.css` todavía.

```css
:root {
  color-scheme: light;

  /* Brand — mismo hue base (teal ValoraCloud), calibrado con un paso más
     y con el 500 un poco más vívido para usarlo como "acento" en UI clara */
  --color-brand-50:  #eefaf8;
  --color-brand-100: #d7f1ec;
  --color-brand-200: #b0e3da;
  --color-brand-300: #7fd0c2;
  --color-brand-400: #45b8a8;
  --color-brand-500: #14a08f;  /* antes #13877e — un punto más luminoso, sirve como acento */
  --color-brand-600: #0f766e;  /* se mantiene: es el verde "oficial" ya reconocible */
  --color-brand-700: #0b5f59;
  --color-brand-800: #104d49;
  --color-brand-900: #0a3733;

  /* Acento cálido secundario — para progreso, iconos destacados, hover suave.
     No reemplaza al brand, lo complementa (mismo tono frío-cálido que un portal
     de salud, pero derivado del propio teal, no un azul/verde genérico ajeno) */
  --color-accent-100: #fdf1e0;
  --color-accent-300: #f3c98a;
  --color-accent-500: #e8a44f;
  --color-accent-700: #b97a2e;

  /* Surfaces — fondo cálido tipo "papel", no gris frío de spreadsheet */
  --color-surface-canvas: #f7f5f1;
  --color-surface-panel: #ffffff;
  --color-surface-subtle: #faf8f4;
  --color-surface-raised: #ffffff;
  --color-surface-hover: #eef8f6;
  --color-surface-selected: #dff3ef;

  /* Text and borders — se mantienen casi igual, ya funcionan bien */
  --color-text-strong: #16211f;
  --color-text-default: #3a4744;
  --color-text-muted: #6b7876;
  --color-text-inverse: #ffffff;
  --color-border-subtle: #e4e0d8;
  --color-border-default: #d3cdc2;
  --color-border-control: #93a09c;

  /* Semantic status — sin cambios de fondo, se mantiene compatibilidad */
  --color-success-50: #ecfdf5;
  --color-success-700: #047857;
  --color-warning-50: #fffbeb;
  --color-warning-200: #fde68a;
  --color-warning-800: #92400e;
  --color-danger-50: #fef2f2;
  --color-danger-600: #dc2626;
  --color-danger-700: #b91c1c;
  --color-info-50: #eff6ff;
  --color-info-700: #1d4ed8;

  /* Typography — sin cambios */
  --font-family-sans: "Segoe UI Variable Text", "Segoe UI Variable", Inter,
    ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
  --font-family-mono: "Cascadia Code", "SFMono-Regular", Consolas,
    "Liberation Mono", monospace;
  --font-size-xs: 0.8125rem;
  --font-size-sm: 0.875rem;
  --font-size-md: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.375rem;
  --font-size-2xl: 1.75rem;
  --line-height-tight: 1.25;
  --line-height-default: 1.5;
  --font-weight-medium: 550;
  --font-weight-semibold: 650;
  --font-weight-bold: 700;

  /* Spacing — sin cambios, ya es una escala sana */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;

  /* Shape and elevation — radios más generosos, se agregan los que faltaban
     (lg y xl cubren lo que hoy se resuelve con `calc(var(--radius-md) * N)`
     repetido en 15+ lugares distintos) */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;   /* nuevo — hoy se usa sin existir, esto lo resuelve */
  --radius-xl: 24px;   /* nuevo — para cards "hero" tipo onboarding */
  --radius-pill: 999px;

  --shadow-sm: 0 1px 3px rgb(22 33 31 / 0.06);
  --shadow-md: 0 10px 28px rgb(22 33 31 / 0.09);
  --shadow-lg: 0 20px 48px rgb(22 33 31 / 0.12); /* nuevo — cards flotantes/hero */

  /* Shell — sin cambios estructurales */
  --shell-sidebar-width: 248px;
  --shell-topbar-height: 52px;
  --shell-content-max: 1600px;
  --z-sticky: 20;
  --z-overlay: 80;
  --z-drawer: 90;
  --z-modal: 100;   /* nuevo — hoy se usa sin existir (platform.css), esto lo resuelve */
  --z-dialog: 110;

  --breakpoint-wide: 1200px;
  --breakpoint-shell: 960px;
  --breakpoint-compact: 640px;
  --breakpoint-narrow: 380px;

  --focus-outline: 2px solid #0b5f59;
  --focus-offset: 2px;
  --focus-ring: 0 0 0 3px rgb(20 160 143 / 0.24);
}
```

### Decisiones de diseño explicadas
- **No se toca `--color-brand-600` (`#0f766e`)**: es el verde que ya aparece en logo/branding existente; cambiarlo sería cambiar la marca, no modernizarla.
- **Se sube `--color-brand-500`** a un tono más saturado para poder usarlo como "acento vivo" en botones secundarios o indicadores, sin inventar un color ajeno a la marca.
- **Se agrega una familia `--color-accent-*` ámbar-cálida**, pensada solo para detalles (barras de progreso, iconos de tips, badges de "nuevo"), no para acciones primarias — así no compite con el verde de marca ni con los colores semánticos de éxito/alerta/error que ya existen.
- **Fondos** pasan de gris azulado frío a un blanco cálido tipo hueso — es el cambio que más se siente como "portal de salud" sin copiar literalmente paletas de salud (que suelen ser azul/verde menta genérico).
- **Radios**: subir de 3-4px a 6-10-16-24px es el cambio de mayor impacto visual para lograr el look "cards redondeadas". Se agregan `--radius-lg`/`--radius-xl` que hoy faltan y ya se referencian rotos en el código.
- **`--z-modal` se agrega** con valor 100 (entre `--z-drawer: 90` y `--z-dialog: 110`) para no romper el orden de apilamiento existente y arreglar el bug de `platform.css` de forma no disruptiva.
- Todo lo semántico (success/warning/danger/info) **se deja intacto** — no hay razón de negocio para tocarlo y reduce el riesgo de regresión visual en estados críticos (errores, validaciones).

## 5. Siguiente paso sugerido (no ejecutado todavía)

Una migración razonable en etapas pequeñas, en este orden de riesgo creciente:

1. Actualizar `tokens.css` con los valores de arriba (cambio aislado, pero afecta visualmente TODA la app de inmediato porque son variables globales — conviene revisarlo visualmente completo antes de seguir).
2. Arreglar `--radius-lg` y `--z-modal` en `platform.css` (ya quedan resueltos por el punto 1, pero conviene confirmarlo).
3. Migrar `platform.css` para que use `--color-*` en vez de `--platform-*` locales (retirar la paleta paralela).
4. Migrar los 6 archivos de feature más hardcodeados, uno por uno: `purchase-orders.css` → `sales.css` → `quote-workspace.css` → `interior.css` → `receptions.css` → `purchases.css`.

## 6. Estado de ejecución (actualizado)

- **Etapa 1** (valores de `tokens.css`): aplicada.
- **Etapa 2** (paleta oscura compartida `--color-dark-*`, migración de `.platform-sidebar` y `.auth-visual`): aplicada.
- **Etapa 3** (resto de `platform.css` — topbar, cards, tablas, filtros): aplicada. Se agregó además `--color-danger-200: #fecaca` a `tokens.css` (mismo valor que ya usan 23 lugares del resto del proyecto de facto; esos 23 usos **no** se migraron, quedan para una etapa futura).

> **Nota (actualización posterior):** la lista de "Pendiente explícito" de abajo refleja el cierre de la etapa 3. Después se resolvieron `#f3f6f8`, `#87a2b2`, `#7894a4` y `#c6d6df` (ver `--color-dark-text-*` y `--color-surface-*` en `tokens.css`); en `platform.css` solo quedan los 4 literales de scrim/hairlines blancos descritos abajo. El detalle de la etapa 4 (`interior.css`) está en la sección 7.

### Pendiente explícito — no tocado a propósito

Quedan 8 literales de color en `platform.css`, agrupados en 2 motivos:

**Diferidos por decisión explícita (etapa futura de scrims/overlays de toda la app):**
- `rgb(3 12 20 / 0.68)` — fondo del overlay del drawer móvil (`.platform-mobile-overlay`). No coincide ni con `--color-dark-ink` ni con el scrim estándar que ya usa el resto de la app (`rgb(15 23 42 / X)`, el viejo `--color-text-strong`) — es una tercera receta de "negro para overlay" que merece revisarse junto con los demás overlays del proyecto, no aislada.
- `rgb(255 255 255 / 0.12)` (×2), `rgb(255 255 255 / 0.06)`, `rgb(255 255 255 / 0.2)` — hairlines/hovers blancos translúcidos sobre las superficies oscuras del sidebar y del drawer móvil. Son un recurso genérico (blanco + alpha), no tienen identidad de marca; se dejan para cuando se decida si vale la pena una familia `--color-dark-hairline-*`.

**Omisión de la categorización original — detectada al ejecutar, no tocados por no tener aprobación explícita:**
- `#f3f6f8` — fondo general de `.platform-shell` (el lienzo detrás de sidebar+topbar+contenido). Coincidía casi exacto con el valor **viejo** de `--color-surface-canvas` (`#f3f5f7`); con la paleta cálida nueva ya no.
- `#87a2b2` — texto del subtítulo de marca y de los `span` del topbar (selector compartido entre sidebar oscuro y topbar claro).
- `#7894a4` — título de sección del nav del sidebar (`AGRUPADORES`).
- `#c6d6df` — color por defecto de los links de navegación del sidebar.

Estos 4 últimos se me escaparon al armar la tabla de categorización que se aprobó — viven en el sidebar oscuro pero no son parte de la familia ink/panel/accent que ya se migró. No se tocaron en esta etapa porque nunca se presentaron para aprobación; quedan pendientes de una decisión explícita (probablemente encajen como variantes de `--color-dark-text` con distinta opacidad, o ameriten su propia sub-familia).

Además, dos literales que sí encajaban sin ambigüedad en mapeos ya aprobados para *otros* literales idénticos en rol se migraron por extensión directa del criterio aprobado (no por decisión nueva): `#e5ecef` (borde de celda de tabla) → `--color-border-subtle`, y `#294252` (texto de celda de tabla) → `--color-text-strong`. Ambos son el mismo rol que otros literales ya aprobados en la misma tabla, solo que no habían quedado listados explícitamente.

## 7. Etapa 4 — `interior.css` (5117 líneas, 4 pasadas)

Último archivo de la etapa 4 (los demás: `platform.css`, `purchase-orders.css`, `sales.css`, `purchases.css`, `receptions.css`, `quote-workspace.css`). Método: por cada sección, categorizar literales como (a) coincide con un token existente, (b) encaja en una familia existente, (c) identidad propia; revisar radio de impacto, código muerto (grep de clases **más** verificación de construcción dinámica), variables locales, duplicados y `git blame`; commits separados.

### Pasadas

| Pasada | Secciones | Resultado | Commit |
|---|---|---|---|
| 1 | 1 (líneas 1–599: `.erp-*`, donut, `ResponsiveDialog`) | 1 literal: el scrim de `.responsive-dialog-overlay` (ver "Hallazgo del scrim") | `6cbda63` |
| 2 | 2 y 3 (Resumen/Finanzas/Estadísticas, Dashboard V2, `.report-*`) | `#a7f3d0`→`--color-success-200`, `#fecaca`→`--color-danger-200`, `#eff6ff`→`--color-info-50`, `#0f766e`→`--color-brand-600`, `#bfdbfe`→`--color-info-200` (**cambio visual leve**, ver abajo); nueva familia `--color-data-*` | `916975f` |
| 3 | 4, 5 y 6 (Reportes V3/V5, Rentabilidad V4) | Ningún literal vivo migrable directo: el bloque V3 estaba muerto; los 4 slots de `.reports-cost-breakdown` se resolvieron con la familia `--color-data-cost-*` | `fd2a4a3` |
| 4 | 7, 8 y 9 (Empresa y cuenta, Clientes, Historial de cotizaciones) | 12 literales exactos: `#a7f3d0`→`--color-success-200` (7), `#fecaca`→`--color-danger-200` (5). Sin cambio visual | `8d5a058` |

Tras las 4 pasadas y la limpieza de código muerto (commit `23f53b4`, ver más abajo) `interior.css` no tiene literales de color: los 2 que quedaban (`#fff` y `#d97706`) vivían dentro del bloque V3 muerto.

`#bfdbfe`→`--color-info-200` (`#b8cce7`): aceptado como cambio visual leve. Son 4 bordes de 1 px que pasan a un azul algo más grisáceo. No se creó un token nuevo para conservar el valor original.

### Tokens nuevos que salieron de esta etapa

**`--color-data-*` — esquema categórico ingreso/gasto/neto/pendiente** (mismos valores que los literales originales, sin cambio visual):

| Token | Valor | Uso |
|---|---|---|
| `--color-data-expense` | `#1e3a5f` | gasto/compras: tarjeta de métrica, monto, badge de compra, leyenda de gráfico |
| `--color-data-net` | `#475569` | neto |
| `--color-data-pending` | `#d97706` | pendiente |
| `--color-data-pending-700` | `#b45309` | variante oscura para el ícono de "pendiente" |

"Ingreso" **no** tiene token propio: el CSS usa `--color-brand-600` directamente (mismo valor, `#0f766e`), para no duplicar el valor con otro nombre. El navy `#1e3a5f` se investigó antes de categorizarlo: no era código muerto (como `--po-navy`) ni un color de documento formal (como `--po-doc-navy`), sino un esquema categórico estable desde el checkpoint base (`966d3b1`), compartido con los gráficos de JS.

**`--color-data-cost-materials/-labor/-direct/-indirect`** (`#0f766e`, `#1e3a5f`, `#b7791f`, `#64748b`): paleta posicional de 4 categorías de costo de proyecto para la leyenda `.reports-cost-breakdown`. Se declaran separados de `--color-data-*` aunque `materials` y `labor` coincidan en valor con `--color-brand-600` y `--color-data-expense`, porque significan otra cosa ("horas hombre" no es "gasto") y no deben acoplarse.

**Deuda documentada, no silenciosa:** los gráficos en JS (`FinancialCharts.jsx`, `OperationalComparisonChart.jsx`, `CostCompositionChart.jsx`) todavía usan literales propios (`#0f766e`, `#1e3a5f`, `#475569`, `#d97706`, `#b7791f`, `#64748b`, etc.) y **no están sincronizados** con estas dos familias. Si se cambia un valor en `tokens.css`, hay que cambiarlo también a mano en esos archivos. Hay un comentario equivalente en `tokens.css` junto a cada familia. Migrarlos es un tipo de cambio distinto (JS, no CSS) y queda como etapa futura.

### Hallazgo del scrim canónico

En la sección de `platform.css` de esta propuesta se describió el "scrim estándar" del resto de la app como `rgb(15 23 42 / X)`, es decir, el valor **viejo** de `--color-text-strong`. La pasada 1 lo confirmó en `.responsive-dialog-overlay`: el scrim canónico es "`--color-text-strong` con alpha", y se migró como `color-mix(in srgb, var(--color-text-strong) 50%, transparent)`.

**Cambio visual explícito** (declarado en el commit `6cbda63`): como `--color-text-strong` ahora es `#16211f` (neutro verdoso) y antes era `#0f172a` (azul-negro frío), el fondo detrás de los modales cambia de tono, no de opacidad.

Siguen **diferidos** (esta decisión no los desbloquea): `rgb(3 12 20 / 0.68)` del drawer móvil de `platform.css` (tercera receta de "negro de overlay", propia del tema oscuro), los hairlines blancos translúcidos del sidebar (`platform.css`) y `rgba(255,255,255,.65)` de `.reception-import__provider-compare article` (`receptions.css`).

### Código muerto eliminado de `interior.css`

Commit `23f53b4` (`interior.css` pasa de 5117 a 4360 líneas). Criterio: ninguna referencia en `src`, `functions`, `public` ni `index.html`, **y** verificación de construcción dinámica de className. Sin cambio visual. Áreas: Resumen/Finanzas, Reportes V3 y Empresa/Clientes.

- **Resumen / Finanzas / Estadísticas:** `.summary-activity-row*` (fila y marcadores ingreso/gasto), `.summary-financial-grid`, `.summary-quick-actions__buttons`, `.financial-comparison-grid`, `.financial-data-note` (solo el selector; compartía regla con `.financial-readonly-notice`, que sí se usa), `.statistics-chart-grid`, `.statistics-overview-grid`, `.statistics-module-grid`, `.statistics-inventory-metrics`.
- **Reportes:** todo `.reports-v3-*` (panel ejecutivo V3, ~382 líneas más fragmentos en `@media`; salió del JSX en el commit `eb89ca7`), `.reports-executive-grid`, `.reports-simple-chart__header`, `.report-status*`, `.report-movement-type*`, `.report-timeline` (base y `__row`), `.report-four-metrics`, `.report-quote-metrics`.
- **Empresa / Clientes:** `.settings-role-badge` (con su modificador `.is-readonly`), `.settings-choice-list`, `.settings-choice`, `.settings-toggle-row--nested`, `.clients-page-heading`, `.client-form-field__optional`.

**Falsos positivos que un grep de texto marca como muertos y siguen vivos (no se eliminaron):**
- `.reports-simple-card--margin` y `--result`: `ReportsResumenView.jsx` los pasa como `variant="margin"` / `variant="result"`.
- `.reports-v4-badge--*`: `reports-v4-badge--${c.estado.toLowerCase()}` con los estados `SIN_DATOS`, `COMPLETO`, `PARCIAL`, `NO_DISPONIBLE`, `NO_APLICA`.
- `.reports-project-status--*`: `reports-project-status--${project.estado}`.
- `.is-verificada`, `.is-rechazada`, `.is-pendiente`: `is-${estado.toLowerCase()}` en `CompanyConfig.jsx` con los estados `VERIFICADA`, `RECHAZADA`, `PENDIENTE`.
