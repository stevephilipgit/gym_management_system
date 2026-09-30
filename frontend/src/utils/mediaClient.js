// utils/mediaClient.js — presigned member-photo upload + edge media session.
//
// WRITE PATH (plan §7): process the photo → POST /media/presign → the browser
// PUTs the bytes straight to object storage → the returned `photoKey` is sent to the
// member API, where the backend verifies the object before persisting it.
// Image bytes NEVER pass through the application backend.
//
// READ PATH (plan §12): the edge Worker serves private photos only with the
// short-lived media cookie, so screens call ensureMediaSession() once before
// rendering media delivery URLs.
//
// Uploads are for ADMIN/TRAINER screens only — the kiosk never uploads; it
// only establishes its own media cookie for reads (ensureKioskMediaSession).
import apiClient from "./apiClient.js";
import kioskApiClient from "./kioskApiClient.js";
import { processMemberPhoto } from "./imageProcessor.js";

let configPromise = null;

/** GET /media/config, cached per page load. Failure = pipeline unavailable. */
export function getMediaConfig() {
  if (!configPromise) {
    configPromise = apiClient
      .get("/media/config")
      .then((res) => res.data?.data || res.data || null)
      .catch(() => null);
  }
  return configPromise;
}

/** Test/cold-start helper: forget the cached config. */
export function resetMediaConfigCache() {
  configPromise = null;
}

// The media cookie is short-lived (default 900 s), so a long-running kiosk or
// admin screen must re-issue it before it expires — otherwise every photo
// starts 401ing and the UI silently degrades to initials. Each session manager
// below keeps one in-flight promise, records the server-provided expiry, and
// schedules a refresh just before that expiry.
const SESSION_REFRESH_MARGIN_MS = 15_000;
const SESSION_FALLBACK_TTL_MS = 900_000;

function createSessionManager(post) {
  let promise = null;
  let expiresAt = 0;
  let timer = null;

  const stop = () => {
    promise = null;
    expiresAt = 0;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const scheduleRefresh = () => {
    if (timer) clearTimeout(timer);
    const delay = Math.max(expiresAt - Date.now() - SESSION_REFRESH_MARGIN_MS, 5_000);
    timer = setTimeout(() => {
      timer = null;
      promise = null; // next ensure() re-issues the cookie
    }, delay);
  };

  const ensure = () => {
    // Share the in-flight request (expiresAt === 0 while pending) and any
    // still-fresh result; otherwise re-issue.
    if (promise && (expiresAt === 0 || Date.now() < expiresAt - SESSION_REFRESH_MARGIN_MS)) {
      return promise;
    }
    promise = post()
      .then((res) => {
        const data = res?.data?.data || res?.data || {};
        const parsed = data.expiresAt ? Date.parse(data.expiresAt) : NaN;
        expiresAt = Number.isFinite(parsed)
          ? parsed
          : Date.now() + (Number(data.ttlSeconds) * 1000 || SESSION_FALLBACK_TTL_MS);
        scheduleRefresh();
        return true;
      })
      .catch(() => {
        stop(); // allow a later retry (e.g. transient 5xx)
        return false;
      });
    return promise;
  };

  return ensure;
}

const ensureAdminMediaSession = createSessionManager(() =>
  apiClient.post("/media/session", {})
);
const ensureDeviceMediaSession = createSessionManager(() =>
  kioskApiClient.post("/media/session/kiosk", {})
);

/** Issue the edge media cookie for the current admin session (idempotent). */
export function ensureMediaSession() {
  return ensureAdminMediaSession();
}

/** Issue the edge media cookie for the kiosk device credentials (read-only). */
export function ensureKioskMediaSession() {
  return ensureDeviceMediaSession();
}

/**
 * Upload one photo through the media pipeline.
 *
 * @param {File} file
 * @param {object} [options]
 * @param {string} [options.memberId] existing member's Mongo id; omit during
 *   registration (a pending key is issued instead)
 * @returns {Promise<{photoKey: string} | {legacyFile: File}>} `photoKey` when
 *   the pipeline handled the file, `legacyFile` when the pipeline is disabled
 *   (caller falls back to the multipart upload path).
 * @throws on client-side processing or upload failure.
 */
export async function uploadMemberPhoto(file, { memberId = null } = {}) {
  const config = await getMediaConfig();
  if (!config?.enabled) return { legacyFile: file };

  const processed = await processMemberPhoto(file);

  const presignRes = await apiClient.post("/media/presign", {
    extension: processed.extension,
    ...(memberId ? { memberId } : {}),
  });
  const upload = presignRes.data?.data || presignRes.data || {};
  if (!upload.url || !upload.key) {
    throw new Error("Could not start the photo upload. Please try again.");
  }

  // Direct browser → storage PUT: no apiClient (no JSON defaults, no auth
  // interceptors), exactly the headers the signature covers.
  const putRes = await fetch(upload.url, {
    method: upload.method || "PUT",
    headers: upload.headers || {},
    body: processed.blob,
  });
  if (!putRes.ok) {
    throw new Error("Photo upload failed. Please try again.");
  }

  return { photoKey: upload.key };
}
