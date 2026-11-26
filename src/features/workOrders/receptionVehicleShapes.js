// Contornos de encuadre de cada zona exterior (prototipo «Panel del Taller», lienzo de 320 × 220).
// Cada parte tiene un rol (carrocería, vidrio, foco, detalle, rueda, buje o línea); los colores
// los pone la hoja de estilos con tokens. Los costados derechos son el reflejo de los izquierdos.
const FRONT = [
  {role: "body", d: "M50 180 V132 Q50 118 66 116 L82 114 L100 62 H220 L238 114 L254 116 Q270 118 270 132 V180 Z"},
  {role: "glass", d: "M110 70 H210 L226 108 H94 Z"},
  {role: "light", d: "M58 126 H104 V146 H58 Z"}, {role: "light", d: "M216 126 H262 V146 H216 Z"},
  {role: "detail", d: "M122 134 H198 V162 H122 Z"},
  {role: "wheel", d: "M36 160 H52 V196 H36 Z"}, {role: "wheel", d: "M268 160 H284 V196 H268 Z"},
];
const REAR = [
  {role: "body", d: "M50 180 V126 Q50 112 66 110 L88 106 L104 62 H216 L232 106 L254 110 Q270 112 270 126 V180 Z"},
  {role: "glass", d: "M112 70 H208 L222 100 H98 Z"},
  {role: "light", d: "M56 120 H100 V138 H56 Z"}, {role: "light", d: "M220 120 H264 V138 H220 Z"},
  {role: "detail", d: "M130 146 H190 V168 H130 Z"},
  {role: "wheel", d: "M36 160 H52 V196 H36 Z"}, {role: "wheel", d: "M268 160 H284 V196 H268 Z"},
];
const SIDE_FRONT = [
  {role: "body", d: "M14 168 V132 Q14 116 36 112 L100 100 L146 58 H306 V168 Z"},
  {role: "glass", d: "M112 98 L150 66 H220 V98 Z"}, {role: "glass", d: "M228 98 V66 H300 V98 Z"},
  {role: "line", d: "M226 100 V166"}, {role: "detail", d: "M104 100 H134 V114 H104 Z"},
  {role: "light", d: "M16 126 H40 V142 H16 Z"},
  {role: "wheel", cx: 66, cy: 170, r: 34}, {role: "hub", cx: 66, cy: 170, r: 12},
];
const SIDE_REAR = [
  {role: "body", d: "M14 168 V58 H160 L206 98 L284 106 Q306 110 306 132 V168 Z"},
  {role: "glass", d: "M22 98 V66 H92 V98 Z"}, {role: "glass", d: "M100 98 V66 H160 L190 98 Z"},
  {role: "line", d: "M96 100 V166"}, {role: "light", d: "M286 120 H304 V140 H286 Z"},
  {role: "wheel", cx: 254, cy: 170, r: 34}, {role: "hub", cx: 254, cy: 170, r: 12},
];

const ZONE_SHAPES = Object.freeze({
  "delantera": {parts: FRONT, mirror: false},
  "lateral-izquierdo-delantero": {parts: SIDE_FRONT, mirror: false},
  "lateral-izquierdo-trasero": {parts: SIDE_REAR, mirror: false},
  "lateral-derecho-delantero": {parts: SIDE_FRONT, mirror: true},
  "lateral-derecho-trasero": {parts: SIDE_REAR, mirror: true},
  "trasera": {parts: REAR, mirror: false},
});

export function getZoneGuideShape(zoneId) {
  return ZONE_SHAPES[zoneId] || null;
}
