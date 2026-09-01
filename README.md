# ValoraCloud

ValoraCloud es una plataforma SaaS/ERP multiempresa para negocios técnicos y
profesionales. Combina un Core empresarial común con módulos verticales según
el rubro de cada negocio.

## Desarrollo estudiantil

Esta rama es la base segura para desarrollar módulos independientes mediante
Firebase Emulator Suite. Antes de comenzar, consulta:

- [Guía de inicio para estudiantes](docs/STUDENT_GETTING_STARTED.md)
- [Contrato de desarrollo de módulos](docs/MODULE_DEVELOPMENT_CONTRACT.md)
- [Workflow Git para estudiantes](docs/STUDENT_GIT_WORKFLOW.md)

## Inicio rápido

```bash
git clone https://github.com/bazzvkngo/mvp-base.git
cd mvp-base
git switch student-baseline-20260901
npm install
npm --prefix functions install
```

Terminal 1:

```bash
npm run emulators:start
```

Terminal 2:

```bash
npm run dev:emulator
```

> [!CAUTION]
> `npm run dev` y `npm run dev:existing` usan Firebase real y están
> **PROHIBIDOS para el desarrollo estudiantil**.

## Core disponible

- Empresas/multiempresa
- Verificación empresarial
- Clientes
- Proveedores
- Inventario
- Cotizaciones
- Ventas
- Órdenes de compra
- Recepciones
- Compras
- Proyectos/Trabajos
- Empleados/RBAC
- Reportes
- Platform Admin

## Localización empresarial

El país seleccionado para la empresa permite que el backend derive la moneda,
la localización, el identificador fiscal y el impuesto base correspondientes.
La plataforma no fija Chile ni CLP para todas las empresas.

## Tecnologías

- React 19
- Vite 7
- Firebase Auth/Firestore/Functions/Storage
- Node.js 22
- Firebase Emulator Suite

## Despliegue

Los estudiantes no realizan deploy. Integración y publicación corresponden al
mantenedor.

## Licencia y titularidad

No se ha definido una licencia open source para ValoraCloud en este
repositorio. La titularidad y las condiciones de entrega a Bagner y a la
universidad deben ser confirmadas por el propietario antes de publicar o
redistribuir el código.
