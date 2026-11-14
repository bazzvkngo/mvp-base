import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PASSWORD_COMPLETE_HINT,
  PASSWORD_EMPTY_HINT,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGE,
  PASSWORD_REQUIREMENTS,
  PASSWORD_STRENGTH,
  PASSWORD_STRENGTH_LABELS,
  describePasswordHelp,
  evaluatePassword,
  getPasswordStrength,
} from "../src/domain/passwordPolicy.mjs";
import * as policy from "../src/domain/passwordPolicy.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// --- Helper -------------------------------------------------------------
assert.equal(PASSWORD_MIN_LENGTH, 8);
assert.equal(PASSWORD_REQUIREMENTS.length, 5);
assert.equal(PASSWORD_POLICY_MESSAGE, "La contraseña no cumple los requisitos.");

const ids = (password) =>
  evaluatePassword(password)
    .checks.filter((check) => check.met)
    .map((check) => check.id);

assert.equal(evaluatePassword("Abcdef1!").ok, true, "8 caracteres con todo cumple");
assert.equal(evaluatePassword("Abcde1!").ok, false, "7 caracteres no cumple");
assert.deepEqual(ids("Abcde1!"), ["uppercase", "lowercase", "number", "symbol"]);
assert.equal(evaluatePassword("abcdef1!").ok, false, "sin mayúscula");
assert.equal(evaluatePassword("ABCDEF1!").ok, false, "sin minúscula");
assert.equal(evaluatePassword("Abcdefg!").ok, false, "sin número");
assert.equal(evaluatePassword("Abcdefg1").ok, false, "sin símbolo");
assert.equal(evaluatePassword("Abcdef1 ").ok, false, "un espacio no cuenta como símbolo");
assert.equal(evaluatePassword("Ñandú123$").ok, true, "mayúscula y minúscula con tilde y eñe");
assert.equal(evaluatePassword("").ok, false);
assert.equal(evaluatePassword("").metCount, 0);
assert.equal(evaluatePassword(undefined).ok, false);
assert.equal(evaluatePassword(null).metCount, 0);
assert.equal(evaluatePassword(12345678).ok, false, "un valor que no es texto cuenta como vacío");
assert.equal(evaluatePassword("Abcdef1!").metCount, 5);
assert.equal(evaluatePassword("Abcdef1!").total, 5);
assert.equal("describePasswordProgress" in policy, false, "describePasswordProgress eliminada");
console.log("OK Política: 8 caracteres con mayúscula, minúscula, número y símbolo");

// --- Medidor: nivel derivado sin cambiar la regla de aceptación ---------
assert.deepEqual(PASSWORD_STRENGTH_LABELS, { weak: "Débil", fair: "Casi segura", strong: "Segura" });
assert.equal(PASSWORD_STRENGTH.FAIR, "fair");
const strengthCases = [
  ["", "weak"],
  ["abcdefgh", "weak"],
  ["Abc1!", "weak"],
  ["abcdefg1", "fair"],
  ["Abcdefg1", "fair"],
  ["ABCDEFG1", "fair"],
  ["Abcdef1!", "strong"],
];
for (const [password, expected] of strengthCases) {
  assert.equal(getPasswordStrength(password), expected, `nivel de "${password}"`);
}
for (const password of ["", "a", "Abcdef1!", "Abcdefg1", "abcdefg1", "Ñandú123$", "ABCDEFGH1!", "12345678"]) {
  assert.equal(
    getPasswordStrength(password) === "strong",
    evaluatePassword(password).ok,
    `"Segura" coincide con la regla de aceptación para "${password}"`
  );
}
assert.equal(PASSWORD_EMPTY_HINT, "Mínimo 8 caracteres, con mayúscula, minúscula, número y símbolo");
assert.equal(describePasswordHelp(""), PASSWORD_EMPTY_HINT);
assert.equal(describePasswordHelp(undefined), PASSWORD_EMPTY_HINT);
assert.equal(describePasswordHelp("abcdefg1"), "Agrega una mayúscula y un símbolo");
assert.equal(describePasswordHelp("Abcde1!"), "Agrega 1 carácter más");
assert.equal(describePasswordHelp("Abc1!"), "Agrega 3 caracteres más");
assert.equal(describePasswordHelp("Abc!"), "Agrega 4 caracteres más y un número");
assert.equal(describePasswordHelp("abcde"), "Agrega 3 caracteres más, una mayúscula, un número y un símbolo");
assert.equal(describePasswordHelp("abcdefgh"), "Agrega una mayúscula, un número y un símbolo");
assert.equal(describePasswordHelp("ABCDEFGH"), "Agrega una minúscula, un número y un símbolo");
assert.equal(describePasswordHelp("Abcdefg1"), "Agrega un símbolo");
assert.equal(describePasswordHelp("Abcdef1!"), PASSWORD_COMPLETE_HINT);
console.log("OK Medidor: Débil, Casi segura y Segura; la frase pone primero la longitud exacta");

// --- Registro y login ---------------------------------------------------
const loginSource = await read("src/features/auth/Login.jsx");
const css = await read("src/styles/components.css");

assert.doesNotMatch(loginSource, /minLength/, "sin minLength en el formulario");
assert.doesNotMatch(loginSource, /\bmás? 6|Mínimo 6|al menos 6|< 6/i, "sin rastro de la regla de 6");
assert.doesNotMatch(loginSource, /\\u[0-9a-fA-F]{4}/, "sin escapes unicode en el JSX");
assert.equal(loginSource.match(/<h1\b/g).length, 1, "un solo h1");
assert.equal(loginSource.match(/type="submit"/g).length, 1, "un solo botón de envío");
// El mensaje de contraseña débil vive en el helper de errores que usa Login.
const userFacingErrorSource = await read("src/domain/userFacingError.mjs");
assert.match(userFacingErrorSource, /"auth\/weak-password":\s*PASSWORD_POLICY_MESSAGE,/);
assert.match(loginSource, /userErrorMessage\(error, AUTH_GENERIC_MESSAGE\)/);

const submitStart = loginSource.indexOf("const handleSubmit");
const submitEnd = loginSource.indexOf("const handleGoogle");
const submit = loginSource.slice(submitStart, submitEnd);
const emptyCheck = submit.indexOf('setError("Ingresa una contraseña.")');
const registerBlock = submit.indexOf("if (!isLoginView) {");
const policyCheck = submit.indexOf("evaluatePassword(password)");
assert.ok(emptyCheck > -1 && emptyCheck < registerBlock, "vacío se valida para login y registro");
assert.ok(policyCheck > registerBlock, "la política solo se evalúa dentro del registro");
assert.ok(
  policyCheck < submit.indexOf("await registerWithEmail("),
  "la política se evalúa antes de registrar"
);
assert.match(submit, /setError\(PASSWORD_POLICY_MESSAGE\);\s*return;/);
assert.doesNotMatch(
  submit.slice(0, registerBlock),
  /evaluatePassword|PASSWORD_POLICY_MESSAGE|length/,
  "el login solo exige que no esté vacía"
);
assert.match(submit, /await loginWithEmail\(email, password\);/);
console.log("OK Login: no aplica la política; registro la valida antes de crear la cuenta");

// --- Medidor en vivo ----------------------------------------------------
assert.doesNotMatch(loginSource, /describePasswordProgress|passwordCheck|ui-password-requirements/);
assert.doesNotMatch(loginSource, /\b(?:Check|Circle)\b/, "sin iconos de lista");
assert.match(loginSource, /\{!isLoginView && \(\s*<div\s+id="auth-password-hint"/);
assert.equal(loginSource.match(/aria-live/g).length, 2, "aria-live en la frase y en el aviso de copiar enlace");
assert.match(
  loginSource,
  /<p className="ui-password-meter__hint" aria-live="polite">\s*\{describePasswordHelp\(password\)\}/
);
assert.match(loginSource, /<span className="ui-password-meter__bar" aria-hidden="true">/, "barra decorativa");
assert.doesNotMatch(loginSource, /role="(?:progressbar|meter)"/, "sin rol que duplique el anuncio");
assert.match(
  loginSource,
  /\{PASSWORD_STRENGTH_LABELS\[passwordStrength\]\}/,
  "el nivel es texto visible"
);
// Con la contraseña vacía no hay barra ni etiqueta: solo la pista.
assert.match(loginSource, /\{password && \(\s*<div className="ui-password-meter__row">/);
assert.match(loginSource, /password\s*\?\s*`ui-password-meter ui-password-meter--\$\{passwordStrength\}`\s*:\s*"ui-password-meter"/);

const block = css.slice(css.indexOf(".ui-password-meter {"));
const meterCss = block.slice(0, block.indexOf("/* fin ui-password-meter */"));
assert.ok(meterCss.length > 0, "CSS del medidor presente");
assert.doesNotMatch(css, /ui-password-requirements/, "CSS de la lista anterior eliminado");
assert.doesNotMatch(meterCss, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/, "sin colores literales");
assert.doesNotMatch(meterCss, /transition|animation/, "sin transiciones");
assert.doesNotMatch(meterCss, /\b\d+(?:\.\d+)?(?:ms|s)\b/, "sin duraciones");
for (const token of [
  "--color-danger-600",
  "--color-danger-700",
  "--color-warning-700",
  "--color-success-700",
  "--color-text-muted",
  "--color-border-default",
  "--radius-pill",
]) {
  assert.ok(meterCss.includes(`var(${token})`), `usa ${token}`);
}
for (const level of ["weak", "fair", "strong"]) {
  assert.ok(meterCss.includes(`.ui-password-meter--${level} .ui-password-meter__fill {`), `relleno ${level}`);
  assert.ok(meterCss.includes(`.ui-password-meter--${level} .ui-password-meter__label {`), `etiqueta ${level}`);
}
console.log("OK Medidor: sin barra ni etiqueta al estar vacío, un solo aria-live, nivel en texto y CSS solo con tokens");
