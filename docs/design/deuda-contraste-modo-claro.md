# Deuda de contraste en modo claro

> Estado: **registro de deuda preexistente, no un plan de trabajo**. Ningún valor de `src/styles/tokens.css` ni de ningún selector se modificó para producir este documento. Es el resultado de auditar manualmente, par por par, los pares que `scripts/contrast-smoke.mjs` (`npm run test:contrast`) había reportado al revisar también el modo claro.

## Contexto

La etapa 5 (modo oscuro) midió y corrigió a mano, paso por paso, el contraste de cada par texto/fondo y borde/fondo **en modo oscuro**. El modo claro es el diseño original del proyecto, anterior a esa etapa, y nunca fue auditado como parte de ella.

Al construir `scripts/contrast-smoke.mjs` se probó, por curiosidad, el mismo conjunto de pares también contra los valores claros de `tokens.css`. Eso reportó 27 fallas. Una revisión posterior con grep (confirmando selector por selector, no solo por familia de token) separó esas 27 en:

- **16 pares reales**: existe al menos un selector CSS real, sin ninguna condición de `@media`, que efectivamente pinta ese texto/borde sobre ese fondo en modo claro hoy mismo. Esto es lo que se documenta abajo.
- **10 pares (más 1 ambiguo) teóricos**: la combinación nunca ocurre en ningún selector real — eran el resultado de comparar cada variante de un token contra cada superficie de la familia, sin que el CSS real use esa combinación. No se documentan aquí porque no representan un problema visible; `scripts/contrast-smoke.mjs` se acotó a modo oscuro para no volver a mezclarlos (ver commit `b1cea20`).

`scripts/contrast-smoke.mjs` **no verifica este archivo ni lo mantiene actualizado automáticamente** — es un registro manual. Si se corrige alguno de estos pares, o se encuentra uno nuevo, actualizar esta tabla a mano.

## Los 16 pares reales

Contraste calculado con la fórmula de luminancia relativa de WCAG 2, sobre los valores claros actuales de `tokens.css`. Umbral: 4.5:1 para texto, 3:1 para bordes/componentes no textuales (WCAG 1.4.11).

### Escala genérica de texto

| Par | Ratio | Selector(es) |
|---|---|---|
| `--color-text-muted` sobre `--color-surface-subtle` (texto, umbral 4.5:1) | **4.33:1** | `.inventory-type-selector button`, `.inventory-row-status.is-excluded`, `.po-empty`, `.quote-workspace__empty`, `.sale-more-actions summary`, `.sale-commercial-margin__status--anulada/--no_disponible/--inconsistente_moneda`, `.works-task-board__legacy`, `.ui-button--secondary:hover:not(:disabled):not(.ui-button--loading)`, `.quote-email-dialog__field input:disabled/textarea:disabled`, `.quote-email-dialog__alternate-note`, `.erp-table th`, `.erp-empty-state`, `.nav-link__completion`, `.business-drawer-field select:disabled`, `.platform-table th` |

### Familias semánticas — borde (-200/-300/-500) contra su propia -50

| Par | Ratio | Selector(es) |
|---|---|---|
| `--color-success-200` sobre `--color-success-50` (borde, umbral 3:1) | **1.22:1** | `.inventory-feedback--success`, `.inventory-import-result`, `.reception-success`, `.reception-import__steps li.is-complete > span`, `.reception-import__provider-status--coincidencia`, `.sale-commercial-margin__status`, `.dashboard-v2-clean-state`, `.company-verified-status`, `.settings-verification-card.is-verificada`, `.settings-locked-field__value.is-verified`, `.settings-verification-pill.is-verificada`, `.settings-message--success` |
| `--color-success-300` sobre `--color-success-50` (borde, umbral 3:1) | **1.64:1** | `.ui-status-badge--success`, `.verification-notice` |
| `--color-warning-200` sobre `--color-warning-50` (borde, umbral 3:1) | **1.20:1** | `.inventory-feedback--notice`, `.inventory-import-analysis-warnings`, `.po-status--borrador`, `.reception-import__provider-status--no_identificado/--sin_datos_oc`, `.sale-commercial-margin__status--parcial/--pendiente/--no_aplica`, `.works-message--warning`, `.ai-availability--daily_limit/--provider_rate_limit`, `.business-category-picker__legacy`, `.financial-readonly-notice`, `.dashboard-attention-item__icon`, `.reports-v4-warning`, `.settings-activation-notice`, `.settings-verification-card.is-pendiente`, `.settings-verification-pill.is-pendiente`, `.settings-message--warning`, `.client-message--warning`, `.quote-legacy-client-note`, `.environment-notice--existing`, `.verification-banner` |
| `--color-warning-300` sobre `--color-warning-50` (borde, umbral 3:1) | **1.71:1** | `.ui-status-badge--warning` |
| `--color-danger-200` sobre `--color-danger-50` (borde, umbral 3:1) | **1.32:1** | `.employees-message--error`, `.inventory-feedback--error`, `.inventory-catalog-load-error`, `.po-status--cancelada`, `.purchase-reversal-note`, `.works-message--error`, `.ai-availability--provider_error/--status_error`, `.onboarding-alert`, `.quote-email-dialog__error`, `.financial-feedback--error`, `.settings-verification-card.is-rechazada`, `.settings-verification-pill`, `.settings-message--error`, `.client-message--error`, `.business-drawer-alert` |
| `--color-info-200` sobre `--color-info-50` (borde, umbral 3:1) | **1.50:1** | `.quote-workspace__status--emitida`, `.financial-feedback`/`.financial-readonly-notice`/`.financial-inline-loading`, `.dashboard-activity-v2-type--purchase`, `.client-message`, `.notification-list__item.is-unread` |
| `--color-stock-alert-200` sobre `--color-stock-alert-50` (borde, umbral 3:1) | **1.27:1** | `.reception-import__provider-status`, `.reception-import__provider-alert`, `.sale-confirm-blocked` |
| `--color-stock-alert-500` sobre `--color-stock-alert-50` (borde-acento, umbral 3:1) | **2.64:1** | `.sale-stock-warning` |

### Casos puntuales: borde/acento contra `--color-surface-panel` (no contra la propia -50)

| Par | Ratio | Selector(es) |
|---|---|---|
| `--color-danger-200` sobre `--color-surface-panel` (borde, umbral 3:1) | **1.45:1** | `.po-button--danger-subtle`, `.po-button--danger`, `.sale-more-actions > button` (los tres declaran `background: var(--color-surface-panel)` y `border-color: var(--color-danger-200)` en la misma regla) |
| `--color-brand-400` sobre `--color-surface-panel` (borde, umbral 3:1) | **2.42:1** | `.po-history-card.po-history__recent` (fondo heredado de `.po-history-card`, que usa `--color-surface-panel`), `.reports-simple-card--link:hover` (fondo heredado de `.reports-simple-card`, mismo token) |
| `--color-brand-400` sobre `--color-surface-subtle` (borde, umbral 3:1) | **2.28:1** | `.works-timeline blockquote` (declara `background: var(--color-surface-subtle)` y `border-left: 3px solid var(--color-brand-400)` en la misma regla) |

Nota: `--color-brand-400` se introdujo en los pasos 3-4 como la variante seleccionada para texto/ícono sobre las 6 superficies **oscuras**, con una matriz de contraste verificada solo ahí (mínimo 4.92:1). Los 3 selectores de arriba son usos preexistentes, independientes de esa decisión, que ya referenciaban `--color-brand-400` en claro antes de esta etapa (excepto el anillo `box-shadow` de `.po-history-card.po-history__recent`, alineado en el paso 5 al mismo tono que su propio `border-color`, que ya era así desde antes).

### Colores de gráficos JS (Chart.js), vía el mecanismo `isDarkMode`

| Par | Ratio | Dónde |
|---|---|---|
| `--color-data-paid` sobre `--color-surface-panel` (relleno de gráfico, umbral 3:1) | **1.89:1** | `FinancialStatusChart` en `src/components/finance/FinancialCharts.jsx` (donut "Pagados/Pendientes", borde del segmento) |
| `--color-data-paid` sobre `--color-surface-canvas` (relleno de gráfico, umbral 3:1) | **1.73:1** | Mismo componente; el mismo valor (`tealSoft`, #8bc8c2) es idéntico en claro y oscuro desde el paso 7 |
| `--color-quote-status-draft` sobre `--color-surface-panel` (relleno de gráfico, umbral 3:1) | **2.56:1** | `DashboardDonutChart` vía `QUOTE_STATUS` en `src/pages/DashboardPage.jsx` (estado "borrador") |
| `--color-quote-status-issued` sobre `--color-surface-panel` (relleno de gráfico, umbral 3:1) | **2.14:1** | Mismo componente, estado "emitida" |

Estos cuatro se renderizan hoy porque `isDarkMode` (via `usePrefersDarkMode()`) resuelve a `false` para cualquier usuario con el sistema en modo claro, seleccionando el valor `.light` de cada color — el mismo valor que ya existía desde antes del paso 7 de esta etapa, sin cambios.

## Por qué no se corrige aquí

- Está fuera del alcance de la etapa 5 (modo oscuro específicamente).
- Corregir cualquiera de estos valores en claro cambiaría la apariencia actual de selectores que llevan tiempo en producción, sin que nadie lo haya pedido ni autorizado.
- Varios afectan docenas de selectores a la vez (las familias semánticas se reutilizan en decenas de badges/notices) — cualquier cambio de valor merece su propia revisión visual dedicada, no un ajuste de paso.
