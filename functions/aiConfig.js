const AI_MODELS = Object.freeze({
  DOCUMENT_IMPORT: "gemini-2.5-flash",
  QUOTE_SUGGESTIONS: "gemini-2.5-flash-lite",
});

const AI_RATE_LIMIT_TIME_ZONE = "America/Los_Angeles";

const AI_RATE_LIMIT_CONFIG = Object.freeze({
  [AI_MODELS.DOCUMENT_IMPORT]: Object.freeze({
    model: AI_MODELS.DOCUMENT_IMPORT,
    cooldownSeconds: 20,
    protectedDailyLimit: 15,
    providerDailyLimit: 20,
    inProgressTtlSeconds: 240,
  }),
  [AI_MODELS.QUOTE_SUGGESTIONS]: Object.freeze({
    model: AI_MODELS.QUOTE_SUGGESTIONS,
    cooldownSeconds: 10,
    protectedDailyLimit: 15,
    providerDailyLimit: 20,
    inProgressTtlSeconds: 180,
  }),
});

function getAiModelConfig(model) {
  const config = AI_RATE_LIMIT_CONFIG[model];
  if (!config) {
    throw new Error(`Modelo Gemini sin configuracion de cuota: ${model}`);
  }
  return config;
}

module.exports = {
  AI_MODELS,
  AI_RATE_LIMIT_CONFIG,
  AI_RATE_LIMIT_TIME_ZONE,
  getAiModelConfig,
};
