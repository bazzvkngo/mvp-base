const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const DEMO_CATALOG = [
  {
    sku: "DEMO-TI-SOP-001",
    nombre: "Diagnóstico técnico de computador",
    tipoItem: "actividad",
    categoria: "Soporte técnico y hardware",
    unidad: "servicio",
    costoBase: 18000,
    margenDeseado: 45,
    descripcion:
      "Revisión inicial de hardware, sistema y síntomas reportados para definir acciones correctivas.",
  },
  {
    sku: "DEMO-TI-SOP-002",
    nombre: "Limpieza interna de computador",
    tipoItem: "servicio",
    categoria: "Soporte técnico y hardware",
    unidad: "servicio",
    costoBase: 22000,
    margenDeseado: 40,
    descripcion:
      "Limpieza física interna, retiro de polvo y revisión visual de componentes principales.",
  },
  {
    sku: "DEMO-TI-SOP-003",
    nombre: "Cambio de pasta térmica",
    tipoItem: "servicio",
    categoria: "Soporte técnico y hardware",
    unidad: "servicio",
    costoBase: 16000,
    margenDeseado: 50,
    descripcion:
      "Retiro de pasta térmica antigua, limpieza de superficie y aplicación de compuesto nuevo.",
  },
  {
    sku: "DEMO-TI-SOP-004",
    nombre: "Instalación de SSD",
    tipoItem: "servicio",
    categoria: "Soporte técnico y hardware",
    unidad: "servicio",
    costoBase: 25000,
    margenDeseado: 45,
    descripcion:
      "Instalación física de unidad SSD y validación básica de reconocimiento por el equipo.",
  },
  {
    sku: "DEMO-TI-SOP-005",
    nombre: "Instalación de memoria RAM",
    tipoItem: "servicio",
    categoria: "Soporte técnico y hardware",
    unidad: "servicio",
    costoBase: 18000,
    margenDeseado: 45,
    descripcion:
      "Instalación de módulo RAM compatible y verificación inicial de capacidad detectada.",
  },
  {
    sku: "DEMO-TI-SOP-006",
    nombre: "Cambio de gabinete",
    tipoItem: "servicio",
    categoria: "Soporte técnico y hardware",
    unidad: "servicio",
    costoBase: 42000,
    margenDeseado: 35,
    descripcion:
      "Traslado de componentes a nuevo gabinete, ordenamiento básico y prueba de encendido.",
  },
  {
    sku: "DEMO-TI-SOP-007",
    nombre: "Armado de computador",
    tipoItem: "servicio",
    categoria: "Soporte técnico y hardware",
    unidad: "servicio",
    costoBase: 65000,
    margenDeseado: 35,
    descripcion:
      "Montaje de computador por piezas, conexión interna y validación de funcionamiento inicial.",
  },
  {
    sku: "DEMO-TI-SOP-008",
    nombre: "Mantención preventiva de notebook",
    tipoItem: "servicio",
    categoria: "Soporte técnico y hardware",
    unidad: "servicio",
    costoBase: 32000,
    margenDeseado: 40,
    descripcion:
      "Mantención preventiva de notebook con limpieza, revisión térmica y chequeo operativo básico.",
  },
  {
    sku: "DEMO-TI-SO-001",
    nombre: "Respaldo de información",
    tipoItem: "actividad",
    categoria: "Sistemas operativos",
    unidad: "servicio",
    costoBase: 20000,
    margenDeseado: 45,
    descripcion:
      "Copia de archivos del usuario antes de formateo, migración o intervención del sistema.",
  },
  {
    sku: "DEMO-TI-SO-002",
    nombre: "Formateo e instalación de Windows",
    tipoItem: "servicio",
    categoria: "Sistemas operativos",
    unidad: "servicio",
    costoBase: 38000,
    margenDeseado: 45,
    descripcion:
      "Instalación limpia de Windows, configuración inicial y revisión de funcionamiento general.",
  },
  {
    sku: "DEMO-TI-SO-003",
    nombre: "Instalación de Linux",
    tipoItem: "servicio",
    categoria: "Sistemas operativos",
    unidad: "servicio",
    costoBase: 36000,
    margenDeseado: 40,
    descripcion:
      "Instalación de distribución Linux, particionado básico y configuración inicial del entorno.",
  },
  {
    sku: "DEMO-TI-SO-004",
    nombre: "Instalación de drivers",
    tipoItem: "servicio",
    categoria: "Sistemas operativos",
    unidad: "servicio",
    costoBase: 16000,
    margenDeseado: 45,
    descripcion:
      "Instalación y validación de controladores principales para el equipo intervenido.",
  },
  {
    sku: "DEMO-TI-SO-005",
    nombre: "Instalación de software base",
    tipoItem: "servicio",
    categoria: "Sistemas operativos",
    unidad: "servicio",
    costoBase: 18000,
    margenDeseado: 45,
    descripcion:
      "Instalación de aplicaciones base de productividad, navegador, compresor y utilidades comunes.",
  },
  {
    sku: "DEMO-TI-SO-006",
    nombre: "Configuración inicial de equipo",
    tipoItem: "actividad",
    categoria: "Sistemas operativos",
    unidad: "servicio",
    costoBase: 22000,
    margenDeseado: 40,
    descripcion:
      "Configuración de cuenta, idioma, red, actualizaciones y parámetros iniciales del equipo.",
  },
  {
    sku: "DEMO-TI-SO-007",
    nombre: "Migración de datos",
    tipoItem: "servicio",
    categoria: "Sistemas operativos",
    unidad: "servicio",
    costoBase: 30000,
    margenDeseado: 40,
    descripcion:
      "Traspaso controlado de datos de usuario entre equipos, discos o instalaciones de sistema.",
  },
  {
    sku: "DEMO-TI-RED-001",
    nombre: "Diagnóstico de red",
    tipoItem: "actividad",
    categoria: "Redes y conectividad",
    unidad: "servicio",
    costoBase: 24000,
    margenDeseado: 45,
    descripcion:
      "Revisión de conectividad, direccionamiento, equipos de red y posibles puntos de falla.",
  },
  {
    sku: "DEMO-TI-RED-002",
    nombre: "Configuración de router",
    tipoItem: "servicio",
    categoria: "Redes y conectividad",
    unidad: "servicio",
    costoBase: 26000,
    margenDeseado: 45,
    descripcion:
      "Configuración básica de router, red local, DHCP, credenciales y parámetros de acceso.",
  },
  {
    sku: "DEMO-TI-RED-003",
    nombre: "Configuración de red WiFi",
    tipoItem: "servicio",
    categoria: "Redes y conectividad",
    unidad: "servicio",
    costoBase: 22000,
    margenDeseado: 45,
    descripcion:
      "Configuración de nombre de red, clave, canal y parámetros básicos de seguridad WiFi.",
  },
  {
    sku: "DEMO-TI-RED-004",
    nombre: "Instalación de punto de red",
    tipoItem: "servicio",
    categoria: "Redes y conectividad",
    unidad: "punto",
    costoBase: 35000,
    margenDeseado: 40,
    descripcion:
      "Instalación y terminación de punto de red cableado con prueba básica de enlace.",
  },
  {
    sku: "DEMO-TI-RED-005",
    nombre: "Cableado UTP",
    tipoItem: "producto",
    categoria: "Redes y conectividad",
    unidad: "metro",
    costoBase: 650,
    margenDeseado: 55,
    descripcion:
      "Cable UTP por metro para instalaciones de red local, cámaras o puntos de conectividad.",
  },
  {
    sku: "DEMO-TI-RED-006",
    nombre: "Configuración de impresora en red",
    tipoItem: "servicio",
    categoria: "Redes y conectividad",
    unidad: "servicio",
    costoBase: 24000,
    margenDeseado: 40,
    descripcion:
      "Conexión de impresora a red local e instalación de acceso desde equipos de usuario.",
  },
  {
    sku: "DEMO-TI-RED-007",
    nombre: "Pruebas de conectividad",
    tipoItem: "actividad",
    categoria: "Redes y conectividad",
    unidad: "servicio",
    costoBase: 14000,
    margenDeseado: 45,
    descripcion:
      "Validación de navegación, latencia, alcance y funcionamiento posterior a cambios de red.",
  },
  {
    sku: "DEMO-TI-WEB-001",
    nombre: "Levantamiento de requerimientos",
    tipoItem: "actividad",
    categoria: "Desarrollo web y software",
    unidad: "hora",
    costoBase: 18000,
    margenDeseado: 50,
    descripcion:
      "Sesión para definir alcance, objetivos, funcionalidades, restricciones y criterios de entrega.",
  },
  {
    sku: "DEMO-TI-WEB-002",
    nombre: "Diseño de página web one page",
    tipoItem: "servicio",
    categoria: "Desarrollo web y software",
    unidad: "proyecto",
    costoBase: 110000,
    margenDeseado: 45,
    descripcion:
      "Diseño e implementación de página web simple de una sección principal con contenido institucional.",
  },
  {
    sku: "DEMO-TI-WEB-003",
    nombre: "Desarrollo de sitio web corporativo",
    tipoItem: "servicio",
    categoria: "Desarrollo web y software",
    unidad: "proyecto",
    costoBase: 220000,
    margenDeseado: 45,
    descripcion:
      "Construcción de sitio web corporativo con secciones informativas y estructura administrable básica.",
  },
  {
    sku: "DEMO-TI-WEB-004",
    nombre: "Formulario de contacto",
    tipoItem: "servicio",
    categoria: "Desarrollo web y software",
    unidad: "modulo",
    costoBase: 45000,
    margenDeseado: 45,
    descripcion:
      "Implementación de formulario de contacto con validaciones y envío de datos según alcance definido.",
  },
  {
    sku: "DEMO-TI-WEB-005",
    nombre: "Implementación de carrito de compras básico",
    tipoItem: "servicio",
    categoria: "Desarrollo web y software",
    unidad: "modulo",
    costoBase: 160000,
    margenDeseado: 45,
    descripcion:
      "Módulo inicial de carrito para agregar productos, revisar resumen y preparar flujo de compra.",
  },
  {
    sku: "DEMO-TI-WEB-006",
    nombre: "Diseño de base de datos",
    tipoItem: "actividad",
    categoria: "Desarrollo web y software",
    unidad: "proyecto",
    costoBase: 85000,
    margenDeseado: 45,
    descripcion:
      "Modelo inicial de datos, colecciones o tablas, relaciones y criterios de almacenamiento.",
  },
  {
    sku: "DEMO-TI-WEB-007",
    nombre: "Desarrollo de módulo CRUD",
    tipoItem: "servicio",
    categoria: "Desarrollo web y software",
    unidad: "modulo",
    costoBase: 140000,
    margenDeseado: 45,
    descripcion:
      "Módulo para crear, listar, editar y eliminar registros con validaciones básicas.",
  },
  {
    sku: "DEMO-TI-CLOUD-001",
    nombre: "Configuración de hosting",
    tipoItem: "servicio",
    categoria: "Cloud y despliegue",
    unidad: "servicio",
    costoBase: 30000,
    margenDeseado: 45,
    descripcion:
      "Preparación inicial de alojamiento para publicar sitio o aplicación web según proveedor definido.",
  },
  {
    sku: "DEMO-TI-CLOUD-002",
    nombre: "Configuración de dominio",
    tipoItem: "servicio",
    categoria: "Cloud y despliegue",
    unidad: "servicio",
    costoBase: 26000,
    margenDeseado: 45,
    descripcion:
      "Configuración DNS básica para apuntar dominio a hosting, sitio web o servicio cloud.",
  },
  {
    sku: "DEMO-TI-CLOUD-003",
    nombre: "Configuración de certificado SSL",
    tipoItem: "servicio",
    categoria: "Cloud y despliegue",
    unidad: "servicio",
    costoBase: 24000,
    margenDeseado: 45,
    descripcion:
      "Activación o configuración de HTTPS mediante certificado SSL en el entorno publicado.",
  },
  {
    sku: "DEMO-TI-CLOUD-004",
    nombre: "Despliegue de aplicación web",
    tipoItem: "servicio",
    categoria: "Cloud y despliegue",
    unidad: "servicio",
    costoBase: 50000,
    margenDeseado: 45,
    descripcion:
      "Publicación de aplicación web en ambiente definido y verificación posterior al despliegue.",
  },
  {
    sku: "DEMO-TI-CLOUD-005",
    nombre: "Configuración básica de Firebase",
    tipoItem: "servicio",
    categoria: "Cloud y despliegue",
    unidad: "servicio",
    costoBase: 55000,
    margenDeseado: 45,
    descripcion:
      "Configuración inicial de proyecto Firebase, servicios base y parámetros necesarios para la app.",
  },
  {
    sku: "DEMO-TI-CAL-001",
    nombre: "Revisión básica de seguridad",
    tipoItem: "actividad",
    categoria: "Seguridad y calidad",
    unidad: "servicio",
    costoBase: 42000,
    margenDeseado: 45,
    descripcion:
      "Revisión de configuraciones, accesos, exposición básica y recomendaciones iniciales de seguridad.",
  },
  {
    sku: "DEMO-TI-CAL-002",
    nombre: "Checklist OWASP básico",
    tipoItem: "actividad",
    categoria: "Seguridad y calidad",
    unidad: "servicio",
    costoBase: 65000,
    margenDeseado: 45,
    descripcion:
      "Aplicación de checklist OWASP básico para detectar riesgos comunes en aplicaciones web.",
  },
  {
    sku: "DEMO-TI-CAL-003",
    nombre: "Configuración de respaldos",
    tipoItem: "servicio",
    categoria: "Seguridad y calidad",
    unidad: "servicio",
    costoBase: 38000,
    margenDeseado: 45,
    descripcion:
      "Definición y configuración inicial de respaldos para archivos, datos o configuraciones críticas.",
  },
  {
    sku: "DEMO-TI-CAL-004",
    nombre: "Pruebas funcionales",
    tipoItem: "actividad",
    categoria: "Seguridad y calidad",
    unidad: "hora",
    costoBase: 16000,
    margenDeseado: 50,
    descripcion:
      "Ejecución de pruebas funcionales sobre flujos acordados y registro de hallazgos relevantes.",
  },
  {
    sku: "DEMO-TI-CAL-005",
    nombre: "Informe técnico",
    tipoItem: "actividad",
    categoria: "Seguridad y calidad",
    unidad: "documento",
    costoBase: 28000,
    margenDeseado: 45,
    descripcion:
      "Documento de cierre con actividades realizadas, resultados, evidencias y recomendaciones.",
  },
  {
    sku: "DEMO-TI-CAL-006",
    nombre: "Capacitación de usuario",
    tipoItem: "actividad",
    categoria: "Seguridad y calidad",
    unidad: "hora",
    costoBase: 18000,
    margenDeseado: 45,
    descripcion:
      "Capacitación práctica para usuario final sobre uso básico, cuidados y buenas prácticas.",
  },
  {
    sku: "DEMO-TI-CAL-007",
    nombre: "Soporte inicial",
    tipoItem: "servicio",
    categoria: "Seguridad y calidad",
    unidad: "hora",
    costoBase: 15000,
    margenDeseado: 50,
    descripcion:
      "Bolsa inicial de soporte posterior a entrega para resolver dudas o ajustes menores.",
  },
];

const BATCH_LIMIT = 450;

function parseArgs(argv) {
  const args = {
    uid: "",
    apply: false,
  };

  for (const arg of argv) {
    if (arg.startsWith("--uid=")) {
      args.uid = arg.slice("--uid=".length).trim();
    }
    if (arg === "--apply") {
      args.apply = true;
    }
  }

  return args;
}

function normalizeSku(value) {
  return String(value || "").trim().toUpperCase();
}

function precioInterno(costoBase, margenDeseado) {
  return Math.round(costoBase + (costoBase * margenDeseado) / 100);
}

function buildPayload(uid, item, { isCreate, existingData = null }) {
  const now = FieldValue.serverTimestamp();
  const payload = {
    nombre: item.nombre,
    tipoItem: item.tipoItem,
    categoria: item.categoria,
    unidad: item.unidad,
    costoBase: item.costoBase,
    margenDeseado: item.margenDeseado,
    precioInterno: precioInterno(item.costoBase, item.margenDeseado),
    sku: normalizeSku(item.sku),
    descripcion: item.descripcion,
    estado: "activo",
    actualizadoEn: now,
    uidUsuario: uid,
  };

  if (isCreate || !existingData?.creadoEn) {
    payload.creadoEn = now;
  }

  return payload;
}

async function commitChunks(db, operations) {
  let committed = 0;

  for (let i = 0; i < operations.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    const chunk = operations.slice(i, i + BATCH_LIMIT);

    for (const operation of chunk) {
      if (operation.type === "set") {
        batch.set(operation.ref, operation.data, { merge: true });
      }
      if (operation.type === "update") {
        batch.update(operation.ref, operation.data);
      }
    }

    await batch.commit();
    committed += chunk.length;
  }

  return committed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.uid) {
    throw new Error(
      "Debes indicar el usuario destino. Uso: npm run demo:reset-inventory -- --uid=UID --apply"
    );
  }

  initializeApp({
    credential: applicationDefault(),
  });

  const db = getFirestore();
  const inventoryRef = db.collection("usuarios").doc(args.uid).collection("inventario");
  const snapshot = await inventoryRef.get();
  const demoSkuSet = new Set(DEMO_CATALOG.map((item) => normalizeSku(item.sku)));
  const existingBySku = new Map();
  const operations = [];
  let softDeleted = 0;
  let created = 0;
  let updated = 0;
  let duplicateDemoSkusSoftDeleted = 0;

  snapshot.docs.forEach((docSnap) => {
    const data = docSnap.data();
    const sku = normalizeSku(data.sku);

    if (sku) {
      if (!existingBySku.has(sku)) existingBySku.set(sku, []);
      existingBySku.get(sku).push(docSnap);
    }

    if (!demoSkuSet.has(sku) && (data.estado || "activo") !== "eliminado") {
      softDeleted += 1;
      operations.push({
        type: "set",
        ref: docSnap.ref,
        data: {
          estado: "eliminado",
          eliminadoEn: FieldValue.serverTimestamp(),
          actualizadoEn: FieldValue.serverTimestamp(),
        },
      });
    }
  });

  for (const item of DEMO_CATALOG) {
    const sku = normalizeSku(item.sku);
    const matches = existingBySku.get(sku) || [];
    const [primary, ...duplicates] = matches;

    if (primary) {
      updated += 1;
      operations.push({
        type: "set",
        ref: primary.ref,
        data: buildPayload(args.uid, item, {
          isCreate: false,
          existingData: primary.data(),
        }),
      });
    } else {
      created += 1;
      operations.push({
        type: "set",
        ref: inventoryRef.doc(),
        data: buildPayload(args.uid, item, { isCreate: true }),
      });
    }

    for (const duplicate of duplicates) {
      duplicateDemoSkusSoftDeleted += 1;
      operations.push({
        type: "set",
        ref: duplicate.ref,
        data: {
          estado: "eliminado",
          eliminadoEn: FieldValue.serverTimestamp(),
          actualizadoEn: FieldValue.serverTimestamp(),
        },
      });
    }
  }

  const summary = {
    uid: args.uid,
    modo: args.apply ? "apply" : "dry-run",
    catalogoDemo: DEMO_CATALOG.length,
    inventarioActual: snapshot.size,
    marcadosEliminado: softDeleted,
    creados: created,
    actualizadosPorSku: updated,
    duplicadosSkuDemoMarcadosEliminado: duplicateDemoSkusSoftDeleted,
    escriturasPlanificadas: operations.length,
  };

  if (!args.apply) {
    console.log(JSON.stringify(summary, null, 2));
    console.log(
      "Dry-run: no se escribio en Firestore. Agrega --apply para ejecutar el reset/carga demo."
    );
    return;
  }

  summary.escriturasEjecutadas = await commitChunks(db, operations);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
