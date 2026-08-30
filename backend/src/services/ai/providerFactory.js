import aiConfig from "../../config/aiConfig.js";
import logger from "../../core/logger.js";
import { GeminiProvider } from "./providers/geminiProvider.js";
import { OpenAICompatProvider } from "./providers/openaiCompatProvider.js";
import { AIProviderError, ProviderErrorCodes, isRetryableProviderError } from "./providers/aiProvider.js";

const PROVIDER_REGISTRY = {
  gemini: GeminiProvider,
  "openai-compat": OpenAICompatProvider,
};

const resolveProvider = (name, config) => {
  const ProviderClass = PROVIDER_REGISTRY[name];
  if (!ProviderClass) {
    logger.warn(`[AI] Unknown provider "${name}", falling back to gemini`);
    return null;
  }
  const instance = new ProviderClass(config);
  return instance.isConfigured ? instance : null;
};

let primaryProvider = null;
let fallbackProvider = null;

const initializeProviders = () => {
  aiConfig.enabled = aiConfig.enabled; // ensure config is read

  if (!aiConfig.enabled) {
    primaryProvider = null;
    fallbackProvider = null;
    return;
  }

  primaryProvider = resolveProvider(aiConfig.provider, {
    apiKey: aiConfig.apiKey,
    model: aiConfig.model,
    timeoutMs: aiConfig.timeoutMs,
    baseUrl: aiConfig.baseUrl || undefined,
  });

  if (aiConfig.fallbackProvider) {
    fallbackProvider = resolveProvider(aiConfig.fallbackProvider, {
      apiKey: aiConfig.fallbackApiKey,
      model: aiConfig.fallbackModel,
      timeoutMs: aiConfig.timeoutMs,
      baseUrl: aiConfig.fallbackBaseUrl || undefined,
    });
  }
};

export const getProviderStatus = () => ({
  enabled: aiConfig.enabled,
  primaryProvider: aiConfig.provider,
  primaryModel: aiConfig.model,
  primaryConfigured: Boolean(primaryProvider),
  fallbackProvider: aiConfig.fallbackProvider || null,
  fallbackModel: aiConfig.fallbackModel || null,
  fallbackConfigured: Boolean(fallbackProvider),
});

/**
 * Generate a response using the primary provider, with fallback on
 * retryable errors. Non-retryable errors (auth, malformed) are raised
 * immediately. If both providers fail, the last error is thrown.
 */
export const generateWithFallback = async (generateOptions) => {
  initializeProviders();

  if (!aiConfig.enabled) {
    throw new AIProviderError("AI assistant is disabled", ProviderErrorCodes.UNAVAILABLE, false);
  }

  if (!primaryProvider) {
    throw new AIProviderError(
      "AI provider is not configured",
      ProviderErrorCodes.AUTH,
      false
    );
  }

  const startTime = Date.now();
  let lastError = null;

  try {
    const text = await primaryProvider.generate(generateOptions);
    logger.info("[AI] request completed", {
      provider: primaryProvider.name,
      model: primaryProvider.modelName,
      latencyMs: Date.now() - startTime,
    });
    return { text, source: "ai" };
  } catch (error) {
    lastError = error;
    logger.warn("[AI] primary provider failed", {
      provider: primaryProvider.name,
      error: error.message,
      code: error.code,
      retryable: error.retryable,
      latencyMs: Date.now() - startTime,
    });

    if (!isRetryableProviderError(error)) {
      throw error;
    }
  }

  if (fallbackProvider) {
    try {
      const text = await fallbackProvider.generate(generateOptions);
      logger.info("[AI] fallback provider succeeded", {
        provider: fallbackProvider.name,
        model: fallbackProvider.modelName,
        latencyMs: Date.now() - startTime,
      });
      return { text, source: "fallback_ai" };
    } catch (error) {
      lastError = error;
      logger.warn("[AI] fallback provider also failed", {
        provider: fallbackProvider.name,
        error: error.message,
        code: error.code,
        latencyMs: Date.now() - startTime,
      });
    }
  }

  throw new AIProviderError(
    "AI assistant is temporarily unavailable. Please try again in a moment.",
    ProviderErrorCodes.UNAVAILABLE,
    false
  );
};

initializeProviders();