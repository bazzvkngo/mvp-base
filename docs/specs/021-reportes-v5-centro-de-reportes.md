# SPEC 021 — Reportes V5: Centro de reportes por subvistas

## 1. Propósito y estado

Documentar retroactivamente `REPORTES_V5`: la reorganización de `/reportes`
desde una única página vertical ("Resumen ejecutivo") a un centro de
reportes con seis subvistas navegables (Resumen, Ventas, Compras,
Inventario, Proyectos, Ganancias), sin recarga de página y conservando
filtros de período y moneda entre subvistas.

- Fecha conceptual: 4 de septiembre de 2026.
- **Estado: implementada en el working tree, pendiente de commit al momento
  de escribir esta SPEC.** A diferencia de otras SPEC de este proyecto, ésta
  no precede a la implementación — la documenta contra el código real ya
  escrito, verificado independientemente dos veces (auditoría inicial y
  reproducción posterior en entorno real: build y 7 suites de test en
  verde).
- Alcance: Core de ValoraCloud (módulo Reportes). Las verticales
  estudiantiles quedan excluidas.
- Precedencia: `AGENTS.md` conserva autoridad máxima. SPEC 009
  (`009-reportes-mvp.md`) y SPEC 018 (`018-reportes-rentabilidad-v4.md`)
  siguen siendo la definición de las fuentes económicas y de los principios
  de separación de rentabilidad; esta SPEC no las sustituye en ningún punto,
  sólo reorganiza cómo se navegan y presentan esas mismas fuentes.

## 2. Principios obligatorios

1. No se crean colecciones, índices, Cloud Functions ni reglas de Firestore
   nuevas. REPORTES_V5 es una reorganización de frontend (routing interno +
   agregadores de solo lectura) sobre datos ya cargados o ya expuestos por
   servicios existentes.
2. No se crea ningún permiso RBAC nuevo; cada subvista respeta exactamente
   las mismas gates de acceso que ya existían en `StatisticsPage`
   (`canViewProfitability`, `canViewInventory`, `links.sales/purchases/works`).
3. `calculateWorkBalance` y `calculateSaleCommercialMarginV1` no se tocan;
   toda cifra de rentabilidad sigue viniendo de `obtenerBalanceTrabajo` y del
   hook `useReportProfitabilityV4` ya existentes (SPEC 018).
4. Ganancia comercial (`COMMERCIAL_SALES`) y rentabilidad de proyecto
   (`PROJECT_PROFITABILITY`) permanecen como universos separados en la
   subvista Ganancias. No existe, y no debe agregarse, un "total de
   ganancias" que los sume.
5. Las monedas se agrupan por separado en todos los agregadores de
   `src/domain/reportModel.mjs` que participan en las subvistas nuevas: los
   seis agregadores nuevos (`getTopSalesClients`, `getTopSalesProducts`,
   `getTopPurchaseSuppliers`, `getTopPurchaseProducts`,
   `getInventoryTopValueProducts`, `getInventoryCategoryDistribution`) y el
   ya existente `getInventoryMetrics`, que la subvista Inventario reutiliza
   sin cambios. Ninguno convierte ni suma entre monedas.
6. Los filtros de período y moneda se conservan al cambiar de subvista vía
   query param (`?vista=`); cambiar de vista nunca reconstruye la URL
   eliminando `period`/`from`/`to`/`currency`.
7. El catálogo completo de inventario no se carga en cada visita a
   `/reportes`: se carga de forma perezosa, sólo cuando la subvista activa
   es `inventario` (decisión de costo, no un bug — ver §9, punto 2).

## 3. Arquitectura implementada (verificada contra código real)

```
/reportes  →  StatisticsPage.jsx   (el nombre de archivo quedó legacy del
                                     MVP original; funcionalmente es el
                                     "centro de reportes")
    → FinancialPeriodSelector + selector de moneda   (filtros compartidos,
                                                        conservados vía
                                                        useSearchParams)
    → ReportsNav.jsx                                  (tabs de subvista,
                                                        exporta
                                                        normalizeReportView)
    → vista activa por ?vista=:
         resumen    → ReportsResumenView.jsx
         ventas     → ReportsVentasView.jsx
         compras    → ReportsComprasView.jsx
         inventario → ReportsInventarioView.jsx
         proyectos  → ReportsProyectosView.jsx
         ganancias  → ReportsGananciasView.jsx
```

Todos los archivos de `views/` son nuevos (`src/features/reports/views/`).
`ReportsNav.jsx` y `ReportsSharedCards.jsx` son nuevos
(`src/features/reports/`). `src/domain/reportModel.mjs` gana ~134 líneas de
agregadores puros nuevos, sin dependencia de Firebase (verificado: ningún
`import` relacionado con Firebase en el archivo). `StatisticsPage.jsx` pasa
de renderizar todo el contenido en línea a orquestar: carga de datos,
memoización de agregadores, y despacho de la vista activa a su componente.

## 4. Contrato por subvista

- **Resumen** (`ReportsResumenView.jsx`): tarjetas por moneda de
  ventas/compras/resultado de proyecto (comportamiento heredado, reubicado,
  no reescrito), más accesos directos a cada subvista.
- **Ventas** (`ReportsVentasView.jsx`): línea de tiempo operacional de ventas
  confirmadas + `getTopSalesClients`/`getTopSalesProducts` sobre
  `summary.sales.confirmed`.
- **Compras** (`ReportsComprasView.jsx`): análogo para compras,
  `getTopPurchaseSuppliers`/`getTopPurchaseProducts`.
- **Inventario** (`ReportsInventarioView.jsx`): métricas de
  `getInventoryMetrics` (activos, bajo stock, cobertura, valor por moneda),
  `getInventoryTopValueProducts`, `getInventoryCategoryDistribution`. Único
  punto donde se invoca `getInventoryItems(businessId)`
  (`StatisticsPage.jsx:93`), gated por `vista === "inventario"` — no se
  dispara al entrar a ninguna otra subvista (verificado: es la única
  ocurrencia de `getInventoryItems(` en `StatisticsPage.jsx` y en todo
  `src/features/reports/`).
- **Proyectos** (`ReportsProyectosView.jsx`): resultado por proyecto,
  reutiliza `ProfitabilitySummary`/`ProjectResults`, componentes ya
  existentes desde antes de REPORTES_V5 (no forman parte del subsistema V4:
  consumen `profitability = getProjectProfitabilitySummary(...)`, la capa de
  `reportModel.mjs` anterior a V4 — ver SPEC 009/012), sin recalcular el
  balance.
- **Ganancias** (`ReportsGananciasView.jsx`): dos bloques deliberadamente
  separados — `SalesCommercialMarginV4Card` (Ganancias por Ventas) y
  `ProjectProfitabilityV4Summary` (Ganancias por Proyectos), estos sí parte
  del subsistema V4 (SPEC 018) — con nota en UI explicando que no se suman
  porque una venta puede estar asociada a un proyecto y contarse en ambos
  análisis con lógicas distintas.

## 5. Contratos reutilizados sin cambios

- `useReportProfitabilityV4`, `SalesCommercialMarginV4Card`,
  `ProjectProfitabilityV4Summary` (`ReportProfitabilityV4Section.jsx`,
  SPEC 018).
- `getSimplifiedReportSummary`, `aggregateOperationalTimeline`,
  `combineOperationalTimelines`, `getProjectProfitabilitySummary`,
  `getInventoryMetrics` (`reportModel.mjs`, preexistentes).
- `canAccessBusinessPath`, `hasBusinessPermission` (RBAC, sin cambios).
- `loadSimplifiedReportData` (`reportService.js`, sin cambios de contrato).

## 6. IN_SCOPE

- Reorganización de `/reportes` en 6 subvistas navegables sin F5.
- Persistencia de filtros compartidos (período, moneda) entre subvistas vía
  query param.
- Agregadores de solo lectura nuevos en `reportModel.mjs` (top clientes/
  productos de ventas y compras, valor top y distribución por categoría de
  inventario).
- Carga perezosa del catálogo de inventario, exclusiva a la subvista
  Inventario.

## 7. OUT_OF_SCOPE (explícitamente diferido, no pendiente de esta SPEC)

- Rotación de inventario y proyecciones/forecasting: el Core actual no
  soporta calcular esas métricas sin inventar datos; se difiere hasta que
  exista una fuente confiable.
- QA visual/manual en navegador real (apariencia, tabs, responsive) — ver
  §9, riesgo residual abierto.
- Cualquier cambio a `calculateWorkBalance`, `calculateSaleCommercialMarginV1`,
  RBAC, Rules o Functions.

## 8. Verificación realizada

- `npm run test:reports` — OK, incluyendo caso explícito de "separación
  económica Ventas/Proyectos/Ganancias preservada".
- `npm run test:reports-profitability-v4`,
  `test:reports-profitability-v4-stage2`,
  `test:reports-profitability-v4-stage2-integrated` (Emulator Suite real),
  `test:reports-profitability-v4-stage3-ui` — OK, incluyendo verificación
  por código fuente de ausencia de wording/fórmula de rentabilidad
  combinada.
- `npm run test:finance`, `npm run test:works-model` — OK.
- `npm run build` — OK, sin errores, working tree sin alterar (`dist/`,
  `output/`, `.firebase-emulator-data/` correctamente ignorados por git).
- Reproducido de forma independiente dos veces: una vez en la auditoría
  inicial, una segunda vez en entorno real (Windows) sin ninguna
  modificación de por medio.

## 9. Riesgos y pendientes conocidos

1. **QA visual manual en navegador real: no realizado.** Es el único riesgo
   residual real de esta SPEC — la lógica está probada, el render visual
   real (apariencia de tabs, responsive, cada subvista en pantalla) no.
   Bloqueante recomendado antes de exponer esto a Marcelo/Matías u otros
   usuarios de prueba.
2. El KPI "Valor de inventario" en la subvista Resumen muestra "—" hasta que
   el usuario visita la subvista Inventario en esa sesión. Es la
   consecuencia esperada de la carga perezosa (§2.7), no un bug. Si se
   decide más adelante precargarlo, debe hacerse sin volver a cargar el
   catálogo completo en cada carga de `/reportes`.
3. Brecha estructural preexistente, no introducida por esta SPEC: `src/` no
   tiene script ni configuración de lint (`functions/` sí). No bloquea esta
   SPEC porque ninguno de sus archivos requería lint para pasar CI hoy, pero
   queda registrado como deuda técnica del proyecto.

## 10. Criterios de aceptación

- [x] Las 6 subvistas existen y son accesibles vía `?vista=`.
- [x] Cambiar de subvista no dispara recarga de página ni pierde
      `period`/`from`/`to`/`currency`.
- [x] Ningún agregador nuevo mezcla o convierte monedas.
- [x] La subvista Ganancias no presenta ni permite derivar un total
      combinado de `COMMERCIAL_SALES` + `PROJECT_PROFITABILITY`.
- [x] El catálogo de inventario no se consulta fuera de la subvista
      Inventario.
- [x] `npm run build` y las 7 suites de test relacionadas pasan sin
      modificar el working tree.
- [ ] QA visual/manual en navegador real (pendiente, ver §9.1).

READY_FOR_REVIEW
