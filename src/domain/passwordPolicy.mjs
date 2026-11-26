// Política de contraseña para crear una cuenta nueva. Solo aplica al registro:
// el inicio de sesión no la usa, para que las cuentas existentes con una
// contraseña más corta puedan seguir entrando. Es una validación de interfaz;
// no sustituye la política de contraseñas de Firebase Authentication.
export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_POLICY_MESSAGE = "La contraseña no cumple los requisitos.";

export const PASSWORD_REQUIREMENTS = Object.freeze([
  Object.freeze({
    id: "length",
    label: `Al menos ${PASSWORD_MIN_LENGTH} caracteres`,
    test: (password) => password.length >= PASSWORD_MIN_LENGTH,
  }),
  Object.freeze({
    id: "uppercase",
    label: "Una letra mayúscula",
    test: (password) => /\p{Lu}/u.test(password),
  }),
  Object.freeze({
    id: "lowercase",
    label: "Una letra minúscula",
    test: (password) => /\p{Ll}/u.test(password),
  }),
  Object.freeze({
    id: "number",
    label: "Un número",
    test: (password) => /[0-9]/.test(password),
  }),
  Object.freeze({
    id: "symbol",
    label: "Un símbolo, por ejemplo ! ? # $ %",
    test: (password) => /[^\p{L}\p{N}\s]/u.test(password),
  }),
]);

// Resultado de evaluar una contraseña contra cada requisito. Un valor que no
// es texto cuenta como contraseña vacía.
export function evaluatePassword(password) {
  const value = typeof password === "string" ? password : "";
  const checks = PASSWORD_REQUIREMENTS.map(({ id, label, test }) => ({
    id,
    label,
    met: test(value),
  }));
  const metCount = checks.filter((check) => check.met).length;
  return {
    ok: metCount === checks.length,
    metCount,
    total: checks.length,
    checks,
  };
}

// Medidor del registro. No cambia la regla de aceptación: "strong" es
// exactamente evaluatePassword(...).ok. "fair" cumple la longitud y al menos
// 2 de los otros 4 requisitos pero todavía no se acepta.
export const PASSWORD_STRENGTH = Object.freeze({
  WEAK: "weak",
  FAIR: "fair",
  STRONG: "strong",
});

export const PASSWORD_STRENGTH_LABELS = Object.freeze({
  [PASSWORD_STRENGTH.WEAK]: "Débil",
  [PASSWORD_STRENGTH.FAIR]: "Casi segura",
  [PASSWORD_STRENGTH.STRONG]: "Segura",
});

export const PASSWORD_EMPTY_HINT =
  "Mínimo 8 caracteres, con mayúscula, minúscula, número y símbolo";

export const PASSWORD_COMPLETE_HINT = "Cumple todos los requisitos";

const MISSING_PHRASES = Object.freeze({
  uppercase: "una mayúscula",
  lowercase: "una minúscula",
  number: "un número",
  symbol: "un símbolo",
});

export function getPasswordStrength(password) {
  const evaluation = evaluatePassword(password);
  if (evaluation.ok) return PASSWORD_STRENGTH.STRONG;
  const lengthMet = evaluation.checks.find((check) => check.id === "length").met;
  const othersMet = evaluation.metCount - (lengthMet ? 1 : 0);
  return lengthMet && othersMet >= 2
    ? PASSWORD_STRENGTH.FAIR
    : PASSWORD_STRENGTH.WEAK;
}

function joinWithAnd(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

// Frase corta con lo que falta: primero la longitud con el número exacto de
// caracteres y después los demás requisitos. Vacía muestra la pista general.
export function describePasswordHelp(password) {
  const value = typeof password === "string" ? password : "";
  if (value === "") return PASSWORD_EMPTY_HINT;

  const evaluation = evaluatePassword(value);
  if (evaluation.ok) return PASSWORD_COMPLETE_HINT;

  const missing = [];
  const remaining = PASSWORD_MIN_LENGTH - value.length;
  if (remaining > 0) {
    missing.push(remaining === 1 ? "1 carácter más" : `${remaining} caracteres más`);
  }
  for (const check of evaluation.checks) {
    if (!check.met && MISSING_PHRASES[check.id]) missing.push(MISSING_PHRASES[check.id]);
  }
  return `Agrega ${joinWithAnd(missing)}`;
}
