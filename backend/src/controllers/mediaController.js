// controllers/mediaController.js - Presigned upload + edge media session
//
// Endpoints (all branch-scoped through the authenticated principal):
//   POST /api/media/presign        authorize a photo upload, return a signed PUT
//   POST /api/media/session        issue the short-lived edge media cookie (admin)
//   POST /api/media/session/kiosk  same, for an authenticated kiosk device
//   DELETE /api/media/session      drop the cookie (logout / device handover)
//
// The backend never receives image bytes here: it only authorizes the upload
// and reports the object key the client is allowed to write.
import { asyncHandler, ForbiddenError, NotFoundError } from "../core/errorHandler.js";
import { MEDIA_CONFIG } from "../config/mediaConfig.js";
import Branch from "../models/Branch.js";
import Member from "../models/Member.js";
import scopeResolver from "../core/scopeResolver.js";
import logger from "../core/logger.js";
import {
  getMediaConstraints,
  isMediaEnabled,
  presignPhoto,
} from "../media/mediaService.js";
import { mediaTokenCookieOptions, signMediaToken } from "../media/token.js";

/** Resolve the tenant code used in object keys + edge tokens (server-side). */
async function requireBranchCode(branchId) {
  const branch = await Branch.findById(branchId).select("code").lean();
  if (!branch || !branch.code) {
    throw new ForbiddenError("Forbidden: No branch context.");
  }
  return branch.code;
}

function issueMediaCookie(res, token) {
  res.cookie(MEDIA_CONFIG.token.cookieName, token, {
    ...mediaTokenCookieOptions({
      ttlSeconds: MEDIA_CONFIG.token.ttlSeconds,
      isProduction: MEDIA_CONFIG.enabled ? process.env.NODE_ENV === "production" : false,
    }),
    ...(MEDIA_CONFIG.token.cookieDomain ? { domain: MEDIA_CONFIG.token.cookieDomain } : {}),
  });
}

function mediaSessionPayload({ enabled, subject, branchCode }) {
  if (!enabled) return { enabled: false };
  const issuedAt = Math.floor(Date.now() / 1000);
  return {
    enabled: true,
    subject,
    branchCode,
    expiresAt: issuedAt + MEDIA_CONFIG.token.ttlSeconds,
    ttlSeconds: MEDIA_CONFIG.token.ttlSeconds,
    cookieName: MEDIA_CONFIG.token.cookieName,
  };
}

export const mediaController = {
  /**
   * POST /api/media/presign
   * Authorizes a photo upload for the caller's branch (and gender scope when an
   * existing member is named) and returns a short-lived presigned PUT.
   */
  presignPhoto: asyncHandler(async (req, res) => {
    const { memberId, extension } = req.validatedBody ?? req.body ?? {};
    const branchCode = await requireBranchCode(req.branchId);

    if (memberId) {
      const member = await Member.findById(memberId).select("gender branchId").lean();
      // Cross-tenant ids are reported as "not found" so they leak nothing.
      if (!member || String(member.branchId) !== String(req.branchId)) {
        throw new NotFoundError("Member not found");
      }
      if (!scopeResolver.checkMemberScope(req, member.gender)) {
        throw new ForbiddenError(
          "Access denied: cannot upload a photo for a member outside your scope"
        );
      }
    }

    const upload = await presignPhoto({
      branchCode,
      memberId: memberId ?? null,
      extension: extension ?? "webp",
    });

    return res.status(201).json({
      success: true,
      data: {
        ...upload,
        ...getMediaConstraints(),
        mediaEnabled: true,
      },
    });
  }),

  /**
   * POST /api/media/session
   * Binds a short-lived, HttpOnly edge token to this admin session + branch.
   * Returns `enabled: false` (never a failure) when the media pipeline is not
   * configured, so clients can keep using the legacy photo path.
   */
  createAdminMediaSession: asyncHandler(async (req, res) => {
    if (!isMediaEnabled() || !MEDIA_CONFIG.token.secret) {
      return res.json({ success: true, data: mediaSessionPayload({ enabled: false }) });
    }

    const branchCode = await requireBranchCode(req.branchId);
    const subject = `admin:${String(req.admin.id)}`;
    const token = await signMediaToken({
      secret: MEDIA_CONFIG.token.secret,
      branchCode,
      subject,
      ttlSeconds: MEDIA_CONFIG.token.ttlSeconds,
    });
    issueMediaCookie(res, token);

    return res.json({
      success: true,
      data: mediaSessionPayload({ enabled: true, subject, branchCode }),
    });
  }),

  /**
   * POST /api/media/session/kiosk
   * Same contract for an authenticated kiosk device. Revoking the device stops
   * the NEXT session request, so media access ends within one token TTL.
   */
  createKioskMediaSession: asyncHandler(async (req, res) => {
    if (!isMediaEnabled() || !MEDIA_CONFIG.token.secret) {
      return res.json({ success: true, data: mediaSessionPayload({ enabled: false }) });
    }

    const branchCode = await requireBranchCode(req.kiosk.branchId);
    const subject = `kiosk:${req.kiosk.kioskId}`;
    const token = await signMediaToken({
      secret: MEDIA_CONFIG.token.secret,
      branchCode,
      subject,
      ttlSeconds: MEDIA_CONFIG.token.ttlSeconds,
    });
    issueMediaCookie(res, token);

    return res.json({
      success: true,
      data: mediaSessionPayload({ enabled: true, subject, branchCode }),
    });
  }),

  /** DELETE /api/media/session */
  clearMediaSession: asyncHandler(async (req, res) => {
    res.clearCookie(MEDIA_CONFIG.token.cookieName, {
      path: "/",
      ...(MEDIA_CONFIG.token.cookieDomain ? { domain: MEDIA_CONFIG.token.cookieDomain } : {}),
    });
    return res.json({ success: true, data: { cleared: true } });
  }),

  /**
   * GET /api/media/config
   * Public-ish (rate-limited): lets a client discover whether photo delivery is
   * on the new pipeline before rendering, without probing uploads. Contains no
   * secrets — only the delivery base and constraints.
   */
  getMediaConfig: asyncHandler(async (req, res) => {
    const enabled = isMediaEnabled();
    if (!enabled) {
      return res.json({ success: true, data: { enabled: false } });
    }
    return res.json({
      success: true,
      data: {
        enabled: true,
        deliveryBaseUrl: MEDIA_CONFIG.deliveryBaseUrl,
        ...getMediaConstraints(),
        tokenTtlSeconds: MEDIA_CONFIG.token.ttlSeconds,
      },
    });
  }),
};

export default mediaController;

// Keep a structured record when the pipeline is off, so an ops question like
// "why are photos still on /uploads?" is answerable from the logs.
if (!MEDIA_CONFIG.enabled) {
  logger.info("MEDIA_PIPELINE_DISABLED", {
    reason: "storage credentials missing or MEDIA_STORAGE_ENABLED=false",
    legacyPath: "/uploads",
  });
}
