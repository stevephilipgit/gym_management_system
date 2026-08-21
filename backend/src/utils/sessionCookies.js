// utils/sessionCookies.js - Session-scoped cookie name helpers
//
// Each login gets its own cookie pair (gym_admin_token_<sid> /
// gym_admin_refresh_<sid>) so two different admin sessions can coexist in the
// SAME browser. Each tab pins its session with the X-Session-Id header (an
// opaque id held in per-tab sessionStorage — NOT a JWT) while the JWT itself
// stays in an HttpOnly cookie. Pure module: no side effects, safe to import
// from tests.

export const ACCESS_COOKIE = "gym_admin_token";
export const REFRESH_COOKIE = "gym_admin_refresh";

export const sessionCookieName = (sessionId, type) => `${type}_${sessionId}`;
