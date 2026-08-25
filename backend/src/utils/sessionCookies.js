// utils/sessionCookies.js - Session-scoped cookie name helpers
//
// Each login gets its own cookie pair (gym_admin_token_<sid> /
// gym_admin_refresh_<sid>) so two different admin sessions can coexist in the
// SAME browser. Each tab pins its session with the X-Session-Id header (an
// opaque id held in per-tab sessionStorage — NOT a JWT) while the JWT itself
// stays in an HttpOnly cookie. Pure module: no side effects, safe to import
// from tests.
//
// STRICT CONTRACT (legacy shared-cookie fallback removed):
//   The X-Session-Id header is REQUIRED. The server only ever reads the
//   session-scoped cookie named by that header. There is no bare-cookie path.

export const ACCESS_COOKIE = "gym_admin_token";
export const REFRESH_COOKIE = "gym_admin_refresh";

export const sessionCookieName = (sessionId, type) => `${type}_${sessionId}`;

// Access-cookie name for a session. Returns null when no header sid is
// present (middleware rejects with 401 — there is no legacy fallback).
export const accessCookieForSession = (headerSid) =>
  headerSid ? sessionCookieName(headerSid, ACCESS_COOKIE) : null;

// Refresh-cookie name for a session. Returns null when no header sid present.
export const refreshCookieForSession = (headerSid) =>
  headerSid ? sessionCookieName(headerSid, REFRESH_COOKIE) : null;
