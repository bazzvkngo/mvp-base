import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";

// ETAPA 2 (estados de carga), PASO 3: prop `loading` de <Button>
// (src/components/ui/Button.jsx). Sin Firebase: se prueba vía Vite
// ssrLoadModule + renderToStaticMarkup, mismo patrón que skeleton-smoke.
// Button no usa hooks, así que se invoca Button.render(props, ref) y se
// inspecciona el elemento resultante (props.onClick) además del markup.

const assertClean = (markup, name) =>
  assert.doesNotMatch(markup, /undefined|NaN|Infinity|<!--/, `${name}: markup sin undefined/NaN/Infinity/comentarios`);

const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});

try {
  const {default: Button} = await vite.ssrLoadModule("/src/components/ui/Button.jsx");
  const {default: AppIcon} = await vite.ssrLoadModule("/src/components/ui/AppIcon.jsx");

  const FakeIcon = (props) => React.createElement("svg", {"data-icon": "fake", ...props});
  const render = (props, ref = null) => Button.render(props, ref);
  const html = (props) => renderToStaticMarkup(render(props));
  const hasDisabledAttribute = (markup) => /\sdisabled(=|\s|>)/.test(markup);

  // Implementación anterior de Button, tal cual, como referencia de equivalencia.
  function legacyButton({children, className = "", icon, iconSize = 18, variant = "primary", ...props}, ref) {
    const classes = ["ui-button", `ui-button--${variant}`, className].filter(Boolean).join(" ");
    return React.createElement(
      "button",
      {ref, className: classes, ...props},
      icon && React.createElement(AppIcon, {icon, size: iconSize}),
      children && React.createElement("span", {className: "ui-button__label"}, children)
    );
  }

  // --- Sin loading: DOM y handlers idénticos a los de antes ---
  const click = () => {};
  let compared = 0;
  for (const variant of ["primary", "secondary", "danger"]) {
    for (const icon of [undefined, FakeIcon]) {
      for (const children of ["Guardar", undefined]) {
        for (const className of ["", "extra"]) {
          for (const extra of [{}, {disabled: true}, {type: "submit", form: "f"}, {"aria-busy": true}, {onClick: click}]) {
            for (const loading of [undefined, false, null, 0, ""]) {
              const props = {variant, icon, children, className, ...extra};
              const current = html({...props, loading});
              const legacy = renderToStaticMarkup(legacyButton(props, null));
              assert.equal(current, legacy, `markup idéntico sin loading (${JSON.stringify({variant, className, loading, extra: Object.keys(extra)})})`);
              assertClean(current, "Button sin loading");
              compared += 1;
            }
          }
        }
      }
    }
  }
  const passthrough = render({children: "Guardar", onClick: click, loading: false});
  assert.equal(passthrough.props.onClick, click, "sin loading el onClick del consumidor pasa sin envolver");
  assert.equal(render({children: "Guardar"}).props.onClick, undefined, "sin loading y sin onClick no se agrega ninguno");
  assert.doesNotMatch(html({children: "Guardar"}), /aria-busy|aria-disabled|ui-button--loading|ui-spinner/);
  console.log(`OK: sin loading (undefined, false, null, 0, "") — ${compared} combinaciones con markup idéntico al anterior y onClick sin envolver`);

  // --- Con loading: atributos, clase, sin disabled, spinner ---
  const withIcon = html({children: "Guardando...", icon: FakeIcon, loading: true});
  assert.match(withIcon, /aria-busy="true"/);
  assert.match(withIcon, /aria-disabled="true"/);
  assert.match(withIcon, /class="ui-button ui-button--primary ui-button--loading"/);
  assert.equal(hasDisabledAttribute(withIcon), false, "loading no emite el atributo disabled nativo (conserva el foco)");
  assert.match(withIcon, /<span class="ui-spinner ui-spinner--sm ui-spinner--inherit" aria-hidden="true"><\/span>/);
  assert.doesNotMatch(withIcon, /data-icon="fake"|app-icon/, "con icon, el spinner reemplaza al ícono");
  assert.match(withIcon, /<span class="ui-button__label">Guardando\.\.\.<\/span>/, "la etiqueta no se toca");
  assert.ok(withIcon.indexOf("ui-spinner") < withIcon.indexOf("ui-button__label"), "spinner antes de la etiqueta");
  assertClean(withIcon, "Button loading con icon");

  const noIcon = html({children: "Guardando...", loading: true, className: "auth-submit", variant: "secondary"});
  assert.match(noIcon, /class="ui-button ui-button--secondary ui-button--loading auth-submit"/);
  assert.match(noIcon, /ui-spinner ui-spinner--sm ui-spinner--inherit/, "sin icon, el spinner se antepone");
  assert.ok(noIcon.indexOf("ui-spinner") < noIcon.indexOf("ui-button__label"), "spinner antes de la etiqueta");
  assert.equal((noIcon.match(/ui-spinner ui-spinner--sm/g) || []).length, 1, "un único spinner");
  assertClean(noIcon, "Button loading sin icon");

  const noChildren = html({loading: true, icon: FakeIcon});
  assert.match(noChildren, /ui-spinner/);
  assert.doesNotMatch(noChildren, /ui-button__label/);
  assertClean(noChildren, "Button loading sin children");
  console.log("OK: con loading — aria-busy, aria-disabled, ui-button--loading, sin disabled, spinner (reemplaza el ícono o se antepone)");

  // --- Guard de onClick ---
  const fakeEvent = () => {
    const calls = {preventDefault: 0, stopPropagation: 0};
    return {calls, preventDefault: () => { calls.preventDefault += 1; }, stopPropagation: () => { calls.stopPropagation += 1; }};
  };
  let consumerCalls = 0;
  const consumer = () => { consumerCalls += 1; };
  const loadingElement = render({children: "Guardando...", onClick: consumer, loading: true});
  assert.notEqual(loadingElement.props.onClick, consumer, "con loading el onClick resultante es el guard");
  const blockedEvent = fakeEvent();
  loadingElement.props.onClick(blockedEvent);
  assert.equal(consumerCalls, 0, "con loading NO se llama al onClick del consumidor");
  assert.equal(blockedEvent.calls.preventDefault, 1, "el guard llama preventDefault()");
  assert.equal(blockedEvent.calls.stopPropagation, 1, "el guard llama stopPropagation()");

  const idleElement = render({children: "Guardar", onClick: consumer, loading: false});
  const idleEvent = fakeEvent();
  idleElement.props.onClick(idleEvent);
  assert.equal(consumerCalls, 1, "con loading falso sí se llama al onClick del consumidor");
  assert.equal(idleEvent.calls.preventDefault + idleEvent.calls.stopPropagation, 0, "sin loading no se cancela el evento");

  const noHandler = render({children: "Guardando...", loading: true});
  assert.equal(typeof noHandler.props.onClick, "function", "con loading y sin onClick también hay guard");
  const noHandlerEvent = fakeEvent();
  assert.doesNotThrow(() => noHandler.props.onClick(noHandlerEvent));
  assert.equal(noHandlerEvent.calls.preventDefault, 1);
  assert.doesNotThrow(() => noHandler.props.onClick(), "el guard tolera un evento ausente");
  assert.equal(render({children: "Guardar", loading: false}).props.onClick, undefined, "sin loading y sin onClick no hay handler");

  const submitElement = render({type: "submit", form: "f", children: "Guardando...", onClick: consumer, loading: true});
  assert.equal(submitElement.props.type, "submit", "type y form no se tocan");
  assert.equal(submitElement.props.form, "f");
  console.log("OK: guard — con loading no llama al consumidor y cancela el evento; sin loading pasa; tolera no tener onClick");

  // --- Props explícitas del consumidor ---
  const explicitDisabled = html({children: "Guardando...", disabled: true, loading: true});
  assert.equal(hasDisabledAttribute(explicitDisabled), true, "un disabled explícito sigue emitido y nativo");
  assert.match(explicitDisabled, /aria-busy="true"/);
  const explicitBusy = html({children: "Guardando...", "aria-busy": false, loading: true});
  assert.match(explicitBusy, /aria-busy="false"/, "un aria-busy explícito prevalece");
  assert.equal((explicitBusy.match(/aria-busy/g) || []).length, 1);
  assertClean(explicitDisabled, "Button con disabled explícito");
  assertClean(explicitBusy, "Button con aria-busy explícito");
  console.log("OK: disabled explícito sigue nativo y aria-busy explícito prevalece");

  // --- CSS ---
  const css = await readFile(new URL("../src/styles/components.css", import.meta.url), "utf8");
  const loadingRule = css.match(/\.ui-button--loading \{([^}]*)\}/);
  assert.ok(loadingRule, "existe la regla .ui-button--loading");
  assert.match(loadingRule[1], /cursor: progress/);
  assert.doesNotMatch(loadingRule[1], /opacity|outline|focus/, "sin reducción de opacidad y sin tocar el focus-visible");
  const unguarded = css.match(/\.(?:ui-button--[a-z-]+|auth-submit|onboarding-submit):(?:hover|active):not\(:disabled\)(?!:not\(\.ui-button--loading\))/g);
  assert.equal(unguarded, null, "hover/active de variantes, .auth-submit y .onboarding-submit excluyen también los botones en carga");
  const guarded = css.match(/:(?:hover|active):not\(:disabled\):not\(\.ui-button--loading\)/g) || [];
  assert.equal(guarded.length, 13, "5 variantes + 4 de .auth-submit + 4 de .onboarding-submit");
  console.log("OK: CSS — cursor progress, sin opacidad ni foco propios, 13 selectores de hover/active excluyen la carga");

  console.log("BUTTON_SMOKE_OK");
} finally {
  await vite.close();
}
