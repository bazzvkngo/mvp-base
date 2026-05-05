# Backlog MVP ValoraCloud

## Inventario

- Revisar textos y encoding visible en formulario/tablas.
- Validar campos minimos antes de guardar.
- Agregar filtros utiles por tipo, categoria y busqueda.
- Definir campos finales para producto, servicio y actividad/costo.

## Referencias de mercado

- Crear CRUD manual de referencias.
- Asociar referencias a items del inventario.
- Registrar fuente, fecha, precio observado y comentario.
- Evitar scraping en el MVP.

## Valorizacion / precio sugerido

- Conectar inventario + referencias + margenes.
- Mostrar costo interno, rango de mercado y precio sugerido.
- Permitir ajustar margen manualmente.
- Guardar resultado de valorizacion como base para cotizacion.

## Cotizaciones

- Crear formulario editable de nueva cotizacion.
- Transformar items valorizados en items de cotizacion.
- Guardar cotizaciones en Firestore.
- Implementar historial.
- Integrar vista imprimible/PDF con datos reales de empresa y cliente.

## Asistente IA minimo

- Mantenerlo como apoyo, no como requisito.
- Sugerir estructura de cotizacion o checklist de items.
- Usar Cloud Functions con secret configurado.
- Registrar claramente cuando la sugerencia fue generada por IA.

## Pruebas

- Probar Auth guard y rutas principales.
- Probar calculo de precios en `domain/pricing.js`.
- Probar transformacion de items en `quoteItemFactory.js`.
- Probar build antes de cada entrega.
