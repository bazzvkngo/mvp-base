# ValoraCloud

MVP de tesis para apoyar la valorizacion previa y generacion de cotizaciones.

## Base tecnica

- React + Vite
- Firebase Auth
- Firestore
- Firebase Functions
- jsPDF para salida formal de cotizacion

## Scripts

```bash
npm install
npm run dev
npm run build
npm run preview
```

## Seguridad

No se deben guardar claves reales en el repositorio. La integracion de Gemini en
Firebase Functions debe usar Secret Manager:

```bash
firebase functions:secrets:set GEMINI_API_KEY
```

Si el secret no existe, las funciones dejan Gemini desactivado y usan el flujo
controlado definido para el MVP.
