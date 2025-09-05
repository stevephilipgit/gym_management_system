import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import logger from "../../core/logger.js";

dotenv.config();

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const AI_ENABLED = String(process.env.AI_ENABLED).toLowerCase() === "true";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

let warnedMissingKey = false;
let modelInstance = null;

const getModel = () => {
  if (!AI_ENABLED) {
    return null;
  }

  if (!GEMINI_API_KEY) {
    if (!warnedMissingKey) {
      logger.warn("[AI] GEMINI_API_KEY is missing while AI_ENABLED=true. Falling back gracefully.");
      warnedMissingKey = true;
    }
    return null;
  }

  if (!modelInstance) {
    const client = new GoogleGenerativeAI(GEMINI_API_KEY);
    modelInstance = client.getGenerativeModel({ model: GEMINI_MODEL });
  }

  return modelInstance;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = (promise, timeoutMs = 10000) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("AI request timed out")), timeoutMs);
    }),
  ]);

export const callGemini = async (systemPrompt, history, userMessage) => {
  const model = getModel();

  if (!model) {
    throw new Error("AI service unavailable");
  }

  const attempt = async () => {
    const chat = model.startChat({
      history,
      systemInstruction: {
        role: "system",
        parts: [{ text: systemPrompt }],
      },
    });
    const response = await withTimeout(chat.sendMessage(userMessage), 10000);
    return response.response.text();
  };

  try {
    return await attempt();
  } catch (firstError) {
    if (firstError.message === "AI request timed out") {
      throw firstError;
    }

    await sleep(1000);

    try {
      return await attempt();
    } catch {
      throw new Error("AI service unavailable");
    }
  }
};
