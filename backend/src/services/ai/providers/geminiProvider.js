import { GoogleGenerativeAI } from "@google/generative-ai";
import logger from "../../../core/logger.js";
import { AIProviderError, ProviderErrorCodes, createCapabilities } from "./aiProvider.js";

/**
 * Gemini adapter over the already-installed @google/generative-ai SDK.
 * Exposed through the provider factory; nothing else in the app talks to
 * this SDK directly.
 */
export class GeminiProvider {
  constructor({ apiKey, model, timeoutMs }) {
    this.name = "gemini";
    this.modelName = model;
    this.timeoutMs = timeoutMs || 15000;
    this.client = apiKey ? new GoogleGenerativeAI(apiKey) : null;
    this._model = null;
    this.capabilities = createCapabilities({
      supportsTools: true,
      // Gemini Pro/Flash supports function-declaration
      supportsStructuredOutput: true, // response_mime_type / json
      supportsStreaming: false,   // not used by current architecture
    });
  }

  get isConfigured() {
    return Boolean(this.client);
  }

  _getModel() {
    if (!this.client) {
      throw new AIProviderError(
        "Gemini provider is not configured (missing API key)",
        ProviderErrorCodes.AUTH,
        false
      );
    }
    if (!this._model) {
      this._model = this.client.getGenerativeModel({ model: this.modelName });
    }
    return this._model;
  }

  withTimeout(promise) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new AIProviderError(
              `AI request timed out after ${this.timeoutMs}ms`,
              ProviderErrorCodes.TIMEOUT,
              true
            )
          ),
        this.timeoutMs
      );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  /**
   * @param {object} options
   * @param {string} options.systemPrompt
   * @param {Array<{role:string, parts:Array<{text:string}>}>} options.history
   * @param {string} options.userMessage
   * @returns {Promise<string>} the generated text
   */
  async generate({ systemPrompt, history = [], userMessage }) {
    const model = this._getModel();

    try {
      const chat = model.startChat({
        history,
        systemInstruction: {
          role: "system",
          parts: [{ text: systemPrompt }],
        },
      });
      const response = await this.withTimeout(chat.sendMessage(userMessage));
      const text = response?.response?.text?.() ?? "";
      if (!text) {
        throw new AIProviderError(
          "Gemini returned an empty response",
          ProviderErrorCodes.MALFORMED,
          false
        );
      }
      return text;
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      logger.warn("[AI][gemini] provider error:", error?.message || error);
      throw this._mapSdkError(error);
    }
  }

  _mapSdkError(error) {
    const status = error?.status;
    const message = error?.message || error?.statusText || "Gemini provider error";
    if (status === 429) {
      return new AIProviderError("Gemini rate limit exceeded", ProviderErrorCodes.RATE_LIMIT, false);
    }
    if (status === 401 || status === 403) {
      return new AIProviderError("Gemini authentication failed", ProviderErrorCodes.AUTH, false);
    }
    if (status === 404 || status === 400) {
      return new AIProviderError("Gemini model not found or invalid request", ProviderErrorCodes.MALFORMED, false);
    }
    if (status === 500 || status === 502 || status === 503 || status === 504) {
      return new AIProviderError("Gemini unavailable", ProviderErrorCodes.UNAVAILABLE, true);
    }
    return new AIProviderError(message, ProviderErrorCodes.UNKNOWN, false);
  }
}