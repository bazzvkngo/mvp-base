# SPEC 013 — Snapshot empresarial histórico

## Objetivo

Los documentos comerciales nuevos conservan la identidad de la empresa emisora vigente al crearlos. Un cambio posterior en Empresa no modifica retroactivamente cotizaciones, ventas, órdenes de compra, recepciones, compras ni sus representaciones impresas, PDF, correo o propuesta pública.

## Contrato canónico

`empresaSnapshot` se construye exclusivamente en Functions a partir de `negocios/{businessId}` y `negocios/{businessId}/empresa/perfil`, después de validar la membresía activa. En Firestore conserva los nombres canónicos:

- `negocioId`;
- `nombreComercial`, `razonSocial`;
- `identificadorFiscalTipo`, `identificadorFiscalValor`;
- `giro`, `email`, `telefono`;
- `direccion`, `comunaCodigo`, `comunaNombre`, `ciudad`, `regionCodigo`, `regionNombre`, `regionEstado`, `codigoPostal`;
- `sitioWeb`, `logoUrl`, `responsable`, `cargoResponsable`.

El backend ignora `empresa` y `empresaSnapshot` enviados por el cliente. Un helper compartido normaliza el contrato para evitar variantes entre módulos.

## Responsabilidad de localización

`empresaSnapshot` representa identidad y datos de presentación de la empresa. No duplica país, moneda, locale ni configuración tributaria. Estos continúan congelados en los campos documentales raíz `paisCodigo`, `moneda`, `locale`, `impuestoNombre` y `tasaIva`, consumidos mediante los adaptadores de localización existentes.

La identificación fiscal histórica de la empresa sí pertenece a `empresaSnapshot`; usa exclusivamente `identificadorFiscalTipo` e `identificadorFiscalValor`. `rut` se admite sólo como alias de lectura legacy.

## Creación, edición y duplicación

- Cotización, Venta directa, Orden de compra, Recepción y Compra directa nuevas capturan el perfil autoritativo vigente.
- Editar un borrador conserva exactamente el snapshot ya persistido. No se refresca ni se completa automáticamente.
- Duplicar una Cotización u Orden de compra crea un documento independiente y captura un snapshot nuevo del perfil vigente. El original queda intacto.

## Semántica de conversiones

- `COT → Venta`: la Venta propaga exactamente `empresaSnapshot` de la Cotización, porque representa la continuidad del documento comercial aceptado.
- `OC → Recepción → Compra`: la Recepción propaga exactamente el snapshot de la OC y la Compra propaga el de la Recepción. Así la cadena logística y económica conserva una sola identidad histórica.
- Si el origen es legacy y no tiene snapshot, el primer documento derivado captura el perfil autoritativo actual. Desde ese punto, los siguientes documentos propagan esa captura.

## Compatibilidad legacy

No existe migración ni escritura retroactiva al leer. El orden explícito de resolución es:

1. `empresaSnapshot`;
2. `empresa` legacy, cuando existe;
3. perfil actual como fallback de sólo lectura o como captura autoritativa al crear un documento derivado nuevo.

Print, PDF, correo y propuesta pública prefieren el snapshot histórico. Los adaptadores aceptan documentos antiguos sin romper y no persisten el fallback.
