// services/captchaService.js - Server-side CAPTCHA generation, storage and verification
//
// The expected answer is NEVER exposed to the client. Only captchaId and the SVG
// image leave the server. A SHA-256 hash of the normalized answer is stored in
// Redis with a short TTL, consumed atomically (single-use) on every verification
// attempt, and auto-expired by Redis.
//
// Uses only Node's built-in crypto + the application's existing Redis client.
import crypto from "crypto";
import redisClient from "../config/redis.js";

const KEY_PREFIX = "captcha:";
const TTL_SECONDS = 5 * 60; // 5 minutes
const ANSWER_LENGTH = 5;
// Ambiguity-safe alphabet (excludes 0/O, 1/I/L)
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// Atomic read-and-delete so a captcha is single-use even under concurrent requests.
const GETDEL_SCRIPT = `
  local value = redis.call("GET", KEYS[1])
  if value then
    redis.call("DEL", KEYS[1])
  end
  return value
`;

const hashAnswer = (answer) =>
  crypto.createHash("sha256").update(answer).digest("hex");

const randomInt = (max) => {
  const limit = 256 - (256 % max);
  let byte;
  do {
    byte = crypto.randomBytes(1)[0];
  } while (byte >= limit);
  return byte % max;
};

const generateAnswer = () => {
  let out = "";
  for (let i = 0; i < ANSWER_LENGTH; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
};

const escapeXml = (str) =>
  str.replace(/[<>&'"]/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  }[c]));

const renderSvg = (answer) => {
  const w = 160;
  const h = 56;
  const chars = answer.split("");
  const perChar = w / (chars.length + 1);

  let texts = "";
  chars.forEach((ch, i) => {
    const x = perChar * (i + 1);
    const y = 38 + randomInt(8) - 4;
    const rot = randomInt(24) - 12;
    const color = `#${[...crypto.randomBytes(3)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}`;
    texts += `<text x="${x}" y="${y}" transform="rotate(${rot} ${x} ${y})" fill="${color}" font-family="monospace, Arial, sans-serif" font-size="30" font-weight="700" text-anchor="middle">${escapeXml(ch)}</text>`;
  });

  let noise = "";
  for (let i = 0; i < 5; i++) {
    noise += `<line x1="${randomInt(w)}" y1="${randomInt(h)}" x2="${randomInt(w)}" y2="${randomInt(h)}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>`;
  }
  for (let i = 0; i < 24; i++) {
    noise += `<circle cx="${randomInt(w)}" cy="${randomInt(h)}" r="1" fill="rgba(255,255,255,0.2)"/>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="#141414"/>
  ${noise}
  ${texts}
</svg>`;

  return Buffer.from(svg).toString("base64");
};

const captchaService = {
  async create() {
    const answer = generateAnswer();
    const captchaId = crypto.randomUUID();
    const record = JSON.stringify({ answerHash: hashAnswer(answer) });
    await redisClient.set(`${KEY_PREFIX}${captchaId}`, record, {
      EX: TTL_SECONDS,
    });
    return { captchaId, svgBase64: renderSvg(answer) };
  },

  async verify(captchaId, answer) {
    if (!captchaId || typeof captchaId !== "string") {
      return { ok: false, reason: "invalid" };
    }

    const raw = await redisClient.eval(GETDEL_SCRIPT, {
      keys: [`${KEY_PREFIX}${captchaId}`],
    });
    if (!raw) {
      return { ok: false, reason: "not_found" };
    }

    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "invalid" };
    }

    const submitted = String(answer || "").trim().toUpperCase();
    const expected = Buffer.from(record.answerHash, "hex");
    const actual = Buffer.from(hashAnswer(submitted), "hex");
    const match =
      expected.length === actual.length &&
      crypto.timingSafeEqual(expected, actual);

    return match ? { ok: true } : { ok: false, reason: "wrong" };
  },
};

export default captchaService;
