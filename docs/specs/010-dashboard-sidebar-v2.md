# Dashboard V2 y Sidebar V2

## Objetivo

Convertir Resumen y el shell de ValoraCloud en una portada ERP coherente, profesional y responsive, sin agregar nuevas funciones de negocio. Dashboard y Reportes comparten las mismas definiciones operacionales y siempre trabajan con la empresa activa.

## Dashboard V2

`/dashboard` continúa como ruta canónica y `/resumen` como alias. La cabecera interna presenta el estado operacional, un selector de periodo compartido con Reportes y acceso directo a `/reportes`.

La portada contiene cinco métricas, acciones rápidas según rol, evolución operacional, cotizaciones por estado actual, actividad comercial reciente y atención requerida.

## Métricas y semántica

- **Total vendido:** suma de ventas `confirmada` cuya `fechaVenta` pertenece al periodo. Informa también la cantidad confirmada.
- **Total comprado:** suma de compras `confirmada` cuya `fechaCompra` pertenece al periodo. Informa también la cantidad confirmada.
- **Cotizaciones:** documentos fechados en el periodo, cantidad aceptada y conversión `aceptadas / (aceptadas + rechazadas)`. El estado informado es el estado actual. Las cotizaciones no son ingresos.
- **Inventario:** productos activos y productos con stock actual menor o igual al mínimo. Es un estado actual, no histórico.
- **Saldo financiero registrado:** ingresos pagados menos egresos pagados de movimientos efectivamente registrados en Finanzas, con referencia a por cobrar y por pagar.

El Dashboard no presenta utilidad, ganancia, margen, balance, resultado comercial ni ventas menos compras. Ventas y Compras no alimentan Finanzas automáticamente.

## Acciones rápidas

OWNER y ADMIN pueden acceder, en este orden, a Nueva venta, Nueva cotización, Nueva compra, Nueva orden de compra y Nuevo ítem. El alta de inventario no posee deep-link: “Nuevo ítem” navega a `/inventario`, donde se utiliza la acción existente del módulo.

MEMBER no ve acciones de escritura. Puede consultar Ventas, Compras, Inventario y Reportes.

## Visualizaciones

- Evolución de ventas y compras confirmadas usando las series compartidas de Reportes. No se calcula una diferencia entre ambas.
- Cotizaciones por estado actual dentro del periodo mediante el gráfico reutilizable de cotizaciones.

No se incluyen gráficos decorativos ni valorización en la portada.

## Actividad reciente

Combina ventas y compras confirmadas del periodo, ordenadas por fecha comercial descendente. Se muestran hasta cinco documentos con tipo, número, fecha comercial, contraparte, monto y ruta de detalle. La fecha no se presenta como timestamp exacto de confirmación.

## Atención requerida

Incluye hasta cinco productos con stock bajo y el aviso de perfil empresarial incompleto. Cada alerta enlaza al módulo correspondiente. No se replica la tabla de Tareas de referencias.

## Sidebar V2

Se conservan todas las rutas y agrupaciones. En Análisis se ordenan Reportes, Finanzas, Valorización, Referencias y Tareas de referencias. Mi cuenta se presenta en un footer visible y el resto de la navegación utiliza scroll interno. No existen secciones colapsables.

Branding, selector de empresa y “Agregar otro negocio” permanecen estables. El subtítulo de marca pasa a “Gestión empresarial”.

## Shell y topbar

Se conservan topbar sticky, empresa como eyebrow, título, email, verificación, salir, banner de verificación, drawer móvil, focus trap, cierre con Escape y bloqueo de scroll.

Entre 641 y 959 px se usa el acceso compacto de cuenta para evitar saturación. En móvil se conserva el contexto de empresa mientras el ancho lo permita.

## Responsive

- Desktop: cinco métricas cuando caben, dos visualizaciones y dos bloques secundarios en columnas.
- Notebook: métricas adaptables sin tarjetas estrechas.
- Tablet: sidebar en drawer, cuenta compacta, dos columnas de métricas y contenido principal apilable.
- Móvil: una columna, acciones a ancho completo, actividad en lista y sin scroll horizontal del shell.

## Permisos y multiempresa

Todas las lecturas utilizan `businessId` derivado de la sesión activa y las reglas de membresía existentes. OWNER/ADMIN reciben accesos de creación; MEMBER sólo accesos de consulta. Dashboard no persiste información.

## Reutilización de Reportes

Dashboard consume `loadReportData`, `getSalesMetrics`, `getPurchaseMetrics`, `getQuoteMetrics`, `getInventoryMetrics`, `aggregateOperationalTimeline`, las opciones compartidas de periodo, `getFinancialPeriodRange` y `useFinancialMovements`.

Actividad reciente y combinación de series son funciones puras de `reportModel.mjs` y cuentan con smoke.

## Limitaciones

- `reportService` carga colecciones completas y utiliza `Promise.all`; una falla operacional impide construir el bloque operacional completo.
- Finanzas se carga separadamente y puede fallar sin impedir las métricas operacionales.
- No existe paginación ni agregación backend.
- Las lecturas de colecciones diferentes no constituyen una fotografía atómica.
- Inventario siempre representa el estado actual.
- La fecha de actividad reciente es la fecha comercial del documento.

## Criterios de aceptación

- Dashboard presenta métricas de Ventas, Compras, Cotizaciones, Inventario y Finanzas con semántica compartida con Reportes.
- No aparecen las métricas legacy de cotizaciones ni widgets dominantes de referencias/valorización.
- Acciones rápidas respetan el rol y reutilizan rutas existentes.
- Las dos visualizaciones usan datos del periodo.
- Actividad reciente excluye borradores y canceladas y abre documentos existentes.
- Atención requerida muestra stock bajo y perfil incompleto.
- Sidebar conserva módulos y rutas, reordena Análisis y mantiene Mi cuenta accesible.
- Topbar no se satura en tablet y conserva contexto en móvil.
- La experiencia es usable en desktop, notebook, tablet y móvil.
- No se modifican Functions, Rules, índices ni modelos operacionales.
