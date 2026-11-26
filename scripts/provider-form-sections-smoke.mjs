import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";

// Formulario de proveedor (nuevo y edición): secciones visibles como Nuevo cliente, sin el acordeón "Más datos del
// proveedor (opcional)", y un texto guía genérico ("Escribe ...") en cada campo de texto, igual en todos los países;
// solo el identificador fiscal conserva su ejemplo de formato por país. Sin emuladores ni red.

const source = readFileSync(new URL("../src/features/providers/ProviderFormDialog.jsx", import.meta.url), "utf8");
assert.doesNotMatch(source, /Disclosure|Más datos del proveedor/, "el formulario no importa el plegable");

Object.assign(process.env, {
  VITE_FIREBASE_MODE: "emulator",
  VITE_USE_FIREBASE_CORE_EMULATORS: "true",
  VITE_USE_FIREBASE_FUNCTIONS_EMULATOR: "true",
  VITE_USE_FIREBASE_STORAGE_EMULATOR: "true",
});
const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});
try {
  const {default: ProviderFormDialog} = await vite.ssrLoadModule("/src/features/providers/ProviderFormDialog.jsx");
  const render = (countryCode, props = {}) => renderToStaticMarkup(
    React.createElement(ProviderFormDialog, {countryCode, open: true, onClose() {}, onSubmit() {}, ...props}),
  ).replace(/<!-- -->/g, "");
  // Campos de texto (input que no es casilla ni botón, y textarea) con su placeholder, en orden de aparición.
  const textFields = (html) => [...html.matchAll(/<(input|textarea)\b([^>]*)>/g)]
    .filter((m) => !/type="(checkbox|radio|hidden|submit|button)"/.test(m[2]))
    .map((m) => (m[2].match(/placeholder="([^"]*)"/) || [])[1]);

  // Texto genérico, igual en todos los países (importado del copy para que el smoke no lo duplique).
  const {GENERIC_FIELD_HINTS: G} = await vite.ssrLoadModule("/src/domain/countryFormCopy.mjs");
  const generic = {
    legal: "Escribe el nombre o razón social",
    trade: "Escribe el nombre de fantasía",
    activity: "Escribe la actividad económica",
    email: "Escribe el correo electrónico",
    phone: "Escribe el teléfono de contacto",
    contact: "Escribe el nombre de la persona de contacto",
    address: "Escribe la dirección",
    region: "Escribe el departamento o región",
    municipality: "Escribe el municipio o comuna",
    notes: "Escribe una nota interna",
    credit: "Escribe los días de crédito",
    fiscal: "Escribe el identificador fiscal",
  };
  assert.deepEqual([G.legalName, G.tradeName, G.businessActivity, G.email, G.phone, G.contactPerson, G.address, G.region, G.municipality, G.notes, G.creditDays, G.fiscalId],
    [generic.legal, generic.trade, generic.activity, generic.email, generic.phone, generic.contact, generic.address, generic.region, generic.municipality, generic.notes, generic.credit, generic.fiscal], "el texto del smoke es el del copy");
  // Orden de los campos de texto: identificador, razón social, fantasía, actividad, correo, teléfono, contacto, dirección,
  // territorio de texto (Chile: listas; Bolivia: solo municipio; otros: región y municipio) y notas.
  const placeholdersFor = (fiscal, territory) => [fiscal, generic.legal, generic.trade, generic.activity, generic.email, generic.phone, generic.contact, generic.address, ...territory, generic.notes];
  const countries = {
    BO: {label: "Actividad económica", territory: ["Departamento", "Municipio"], placeholders: placeholdersFor("Ej.: 1234567", [generic.municipality])},
    CL: {label: "Giro", territory: ["Región", "Comuna"], placeholders: placeholdersFor("Ej.: 12.345.678-5", [])},
    MX: {label: "Giro", territory: ["Estado", "Municipio"], placeholders: placeholdersFor(generic.fiscal, [generic.region, generic.municipality])}, // país sin entrada propia
  };

  for (const [country, want] of Object.entries(countries)) {
    for (const [mode, props] of [["nuevo", {}], ["edición", {provider: {proveedorId: "p1", rut: "1234567", razonSocial: "Comercial", paisCodigo: country}}]]) {
      const label = `${country} · ${mode}`;
      const html = render(country, props);

      // Sin acordeón; secciones visibles con el patrón del formulario de cliente.
      assert.doesNotMatch(html, /Más datos del proveedor|ui-disclosure|aria-expanded/, `${label}: sin acordeón`);
      assert.match(html, /<legend>Datos del proveedor<\/legend>/, `${label}: sección Datos del proveedor`);
      for (const title of ["Contacto", "Ubicación", "Condiciones comerciales", "Notas"]) {
        assert.match(html, new RegExp(`<legend>${title} <span>\\(opcional\\)</span></legend>`), `${label}: sección ${title} (opcional)`);
      }
      assert.equal((html.match(/class="client-form-section"/g) || []).length, 5, `${label}: cinco secciones`);
      const order = ["Datos del proveedor", "Contacto", "Ubicación", "Condiciones comerciales", "Notas"].map((t) => html.indexOf(`<legend>${t}`));
      assert.deepEqual([...order].sort((a, b) => a - b), order, `${label}: secciones en orden`);

      // Todos los campos siguen presentes.
      for (const text of ["Razón social", "Nombre de fantasía", want.label, "Correo", "Teléfono", "Persona de contacto", "Dirección", ...want.territory, "Condiciones de pago", "Notas internas"]) {
        assert.ok(html.includes(`>${text}`), `${label}: campo "${text}"`);
      }
      assert.ok(html.includes("Sin especificar"), `${label}: la lista de condiciones de pago sigue`);

      // Texto guía en cada campo de texto, con el valor de la capa que corresponde.
      assert.deepEqual(textFields(html), want.placeholders, `${label}: texto guía por campo, en orden`);
      assert.ok(textFields(html).every((value) => typeof value === "string" && value.trim() !== ""), `${label}: ningún campo de texto sin texto guía`);
      assert.ok(!html.includes("¿"), `${label}: sin signo de apertura de interrogación`);
      // Solo el identificador fiscal puede llevar un ejemplo; ningún otro texto guía empieza con "Ej.".
      assert.deepEqual(textFields(html).filter((value) => /^Ej\./.test(value)), want.placeholders.filter((value, index) => index === 0 && /^Ej\./.test(value)), `${label}: solo el identificador fiscal con ejemplo`);
      assert.ok(!html.includes("Escribe municipio") && !html.includes("Escribe departamento"), `${label}: sin el "Escribe ..." antiguo`);
      assert.ok(!html.includes("+1 202 555 0100") && !html.includes("Servicios técnicos") && !/@empresa\.|Comercial Andina|Banzer|Arturo Prat|Santa Cruz de la Sierra|Prefiere contacto/.test(html), `${label}: sin ejemplos locales ni los anteriores`);

      // Los selects no llevan texto guía; el botón principal sigue.
      assert.ok(!/<select[^>]*placeholder/.test(html), `${label}: los selects sin texto guía`);
      assert.match(html, mode === "nuevo" ? /Crear proveedor/ : /Guardar cambios/, `${label}: botón principal`);
    }

    // Con "Crédito" aparece Días de crédito, también con texto guía.
    const credit = render(country, {provider: {proveedorId: "p1", rut: "1234567", razonSocial: "Comercial", condicionesPago: "credito", diasCredito: 15, paisCodigo: country}});
    assert.ok(credit.includes(">Días de crédito"), `${country}: con crédito aparece Días de crédito`);
    assert.ok(credit.includes(`placeholder="${generic.credit}"`), `${country}: Días de crédito con texto guía genérico`);
    assert.equal(textFields(credit).length, want.placeholders.length + 1, `${country}: con crédito hay un campo más`);
  }
} finally {
  await vite.close();
}

console.log("PROVIDER_FORM_SECTIONS_SMOKE_OK");
