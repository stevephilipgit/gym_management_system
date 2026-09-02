// routes/kioskRoutes.js - PUBLIC customer kiosk attendance routes
//
// Route isolation:
//   PUBLIC CUSTOMER KIOSK   → /api/attendance/kiosk/*  (kioskAuth)
//   ADMIN ATTENDANCE        → /api/attendance/*        (adminAuth)
//
// The kiosk surface is intentionally narrow: only the punch operation.
// One shared kiosk serves Male, Female and Transgender customers; customer
// identity is resolved at punch time (never via kiosk scope).

import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import kioskAuth from "../middleware/kioskAuth.js";
import { kioskPunch } from "../controllers/kioskController.js";

const router = express.Router();

// Tight body limit for the kiosk endpoint — payloads are tiny. The global
// express.json limit (10mb) must not allow arbitrary large JSON here.
const kioskBodyParser = express.json({ limit: "10kb" });

// Dedicated kiosk punch limiter. IP-based baseline (like the admin
// searchPunch limiter) — enough to blunt brute-force Gym ID / phone guessing
// and repeated punch attempts. The global /api/ limiter also applies on top.
const kioskPunchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { status: "rate_limited", message: "Too many attempts. Please wait." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Failed-identifier limiter: throttles repeated DISTINCT failed Gym ID / phone
// lookups from a single IP, protecting against numeric-ID enumeration without
// punishing a busy shared-IP kiosk (successful traffic is not limited here).
// Uses the library's ipKeyGenerator helper so IPv6 clients are normalized and
// the v8 validation is satisfied. In express-rate-limit v8 ipKeyGenerator is a
// pure function (ip → normalized key string), NOT a factory — so we wrap it to
// extract req.ip.
const ipKey = (req) => ipKeyGenerator(String(req.ip || ""));
const kioskFailedIdLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => {
    const input = String(req.body?.input || "").replace(/\D/g, "");
    return `kiosk-fail:${ipKey(req)}:${input}`;
  },
  message: { status: "rate_limited", message: "Too many attempts. Please wait." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Only apply to identifier-resolution attempts; skip memberCode/token
    // (they are server-issued/unique and already rate-limited per-IP).
    return typeof req.body?.input !== "string" || !req.body.input;
  },
});

// Per-kiosk punch limiter: caps total punches per device so one compromised or
// misbehaving kiosk cannot flood the endpoint even behind a shared IP.
// Generous for a busy physical kiosk; the per-IP limiters still apply on top.
const kioskPerDeviceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (req) => `kiosk-device:${String(req.get("x-kiosk-id") || ipKey(req))}`,
  message: { status: "rate_limited", message: "Too many attempts. Please wait." },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/attendance/kiosk/punch
// Public customer interaction guarded by trusted kiosk identity + rate limits.
// kioskAuth terminates (without next()) on missing/invalid credentials; the
// per-IP + per-device + failed-ID limiters bound enumeration and punch abuse.
// Kiosk keys are 192-bit random secrets (bcrypt-hashed) — brute-force is
// infeasible, and the real controls are key rotation/disable in the admin API.
router.post(
  "/punch",
  kioskBodyParser,
  kioskPunchLimiter,
  kioskFailedIdLimiter,
  kioskPerDeviceLimiter,
  kioskAuth,
  kioskPunch
);

export default router;
