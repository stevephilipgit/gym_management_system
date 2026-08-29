import logger from "../../../core/logger.js";
import { AIProviderError, ProviderErrorCodes } from "./aiProvider.js";

/**
 * Generic OpenAI-compatible provider adapter.
 *
 * Handles any provider that exposes an OpenAI-compatible chat completions
 * endpoint (e.g. OpenAI, OpenRouter, Groq, DeepSeek, Together, etc.).
 * No additional SDK dependency required — uses the native `fetch` API.
 */
export class OpenAICompatProvider {
  constructor({ apiKey, model, baseUrl, timeoutMs }) {
    this.name = "openai-compat";
    this.modelName = model;
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    this.timeoutMs = timeoutMs || 15000;
  }

  get isConfigured() {
    return Boolean(this.apiKey) && Boolean(this.modelName);
  }

  /**
   * @param {object} options
   * @param {string} options.systemPrompt
   * @param {Array<{role:string, parts:Array<{text:string}>}>} options.history
   * @param {string} options.userMessage
   * @returns {Promise<string>} the generated text
   */
  async generate({ systemPrompt, history = [], userMessage }) {
    if (!this.isConfigured) {
      throw new AIProviderError(
        "OpenAI-compatible provider is not configured (missing API key or model)",
        ProviderErrorCodes.AUTH,
        false
      );
    }

    const messages = [{ role: "system", content: systemPrompt }];

    for (const entry of history) {
      const text = entry.parts?.map((p) => p.text).join(" ") || "";
      if (text) {
        messages.push({ role: entry.role === "model" ? "assistant" : "user", content: text });
      }
    }

    messages.push({ role: "user", content: userMessage });

    try {
      const response = await this._fetchWithTimeout(
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.modelName,
            messages,
            max_tokens: 2048,
          }),
        },
        this.timeoutMs
      );

      const data = await response.json();

      if (!response.ok) {
        logger.warn("[AI][openai-compat] HTTP error:", response.status, data?.error?.message);
        throw this._mapHttpError(response.status, data?.error?.message);
      }

      const text = data?.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) {
        throw new AIProviderError(
          "Provider returned an empty response",
          ProviderErrorCodes.MALFORMED,
          false
        );
      }
      return text;
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      logger.warn("[AI][openai-compat] fetch error:", error?.message || error);
      throw new AIProviderError(
        "Provider communication failed",
        error?.name === "AbortError" ? ProviderErrorCodes.TIMEOUT : ProviderErrorCodes.UNAVAILABLE,
        error?.name === "AbortError" ? true : false
      );
    }
  }

  async _fetchWithTimeout(resource, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(resource, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  _mapHttpError(status, message) {
    if (status === 429) {
      return new AIProviderError("Provider rate limit exceeded", ProviderErrorCodes.RATE_LIMIT, false);
    }
    if (status === 401 || status === 403) {
      return new AIProviderError("Provider authentication failed", ProviderErrorCodes.AUTH, false);
    }
    if (status === 400 || status === 404) {
      return new AIProviderError(
        message || "Provider request rejected",
        ProviderErrorCodes.MALFORMED,
        false
      );
    }
    if (status >= 500) {
      return new AIProviderError(
        message || "Provider unavailable",
        ProviderErrorCodes.UNAVAILABLE,
        true
      );
    }
    return new AIProviderError(
      message || "Unknown provider error",
      ProviderErrorCodes.UNKNOWN,
      false
    );
  }
}