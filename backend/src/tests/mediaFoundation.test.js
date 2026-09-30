/**
 * Member Photo Media Pipeline — Phase 1 foundation (unit).
 *
 * Covers the isolated media layer before any route/member integration:
 *   KEYS    — versioned, immutable, tenant-scoped object keys + parsing
 *   TOKEN   — short-lived edge media token (sign/verify/tamper/expiry)
 *   STORAGE — storage adapter contract (memory adapter used as the fake)
 *   SERVICE — presign authorization, post-upload verification, delivery URLs
 *
 * No database and no network: the service runs against the in-memory adapter.
 *
 * Run: cd backend && npm test
 */

import { expect } from "chai";

import {
  BRANCH_CODE_PATTERN,
  buildMemberPhotoKey,
  buildPendingPhotoKey,
  isMemberKeyFor,
  isPhotoObjectKey,
  isPendingKeyFor,
  isTenantOwned,
  memberPhotoPrefix,
  normalizeExtension,
  parsePhotoKey,
  pendingPhotoPrefix,
  randomHex,
  tenantPrefix,
} from "../media/objectKeys.js";
import {
  mediaTokenCookieOptions,
  signMediaToken,
  verifyMediaToken,
} from "../media/token.js";
import { createMemoryStorage, createStorageAdapter } from "../media/storage.js";
import {
  MediaError,
  configureMediaForTests,
  deliveryUrl,
  getCleanupConfig,
  getMediaConstraints,
  isMediaEnabled,
  presignPhoto,
  resetMediaForTests,
  resolvePhotoUrl,
  verifyUploadedPhoto,
} from "../media/mediaService.js";

const BRANCH = "MATHUR";
const OTHER_BRANCH = "VEPERY";
const MEMBER_ID = "64b0f0a1a1a1a1a1a1a1a1a1";
const OTHER_MEMBER_ID = "64b0f0a1a1a1a1a1a1a1a1a2";

/* ============================================================
   OBJECT KEYS
   ============================================================ */
describe("media object keys (unit)", () => {
  it("builds a versioned key inside the branch prefix and parses it back", () => {
    const key = buildMemberPhotoKey(BRANCH, MEMBER_ID, 3, { extension: "webp" });

    expect(key.startsWith(`tenants/${BRANCH}/members/${MEMBER_ID}/`)).to.equal(true);
    const parsed = parsePhotoKey(key);
    expect(parsed).to.deep.include({
      branchCode: BRANCH,
      scope: "member",
      memberId: MEMBER_ID,
      version: 3,
      extension: "webp",
    });
  });

  it("never reuses a key — photo updates cannot overwrite cached objects", async () => {
    const keys = new Set();
    for (let i = 0; i < 25; i += 1) {
      keys.add(buildMemberPhotoKey(BRANCH, MEMBER_ID, 2, { extension: "webp" }));
    }
    expect(keys.size).to.equal(25);
  });

  it("issues pending (not yet attached) keys for registration uploads", () => {
    const key = buildPendingPhotoKey(BRANCH, { extension: "jpeg" });
    const parsed = parsePhotoKey(key);

    expect(key.startsWith(pendingPhotoPrefix(BRANCH))).to.equal(true);
    expect(parsed.scope).to.equal("pending");
    expect(parsed.memberId).to.equal(null);
    expect(parsed.extension).to.equal("jpeg");
    expect(isPendingKeyFor(key, BRANCH)).to.equal(true);
  });

  it("rejects branch codes / member ids / extensions that cannot be keys", () => {
    expect(() => tenantPrefix("bad code!")).to.throw();
    expect(() => tenantPrefix("")).to.throw();
    expect(() => memberPhotoPrefix(BRANCH, "not-an-id")).to.throw();
    expect(() => normalizeExtension("gif")).to.throw();
    expect(() => buildMemberPhotoKey(BRANCH, MEMBER_ID, 1, { extension: "svg" })).to.throw();
  });

  it("normalizes .jpg to jpeg and keeps webp", () => {
    expect(normalizeExtension(".JPG")).to.equal("jpeg");
    expect(normalizeExtension("webp")).to.equal("webp");
  });

  it("keeps the branch code pattern aligned with counter-key conventions", () => {
    expect(BRANCH_CODE_PATTERN.test("MATHUR")).to.equal(true);
    expect(BRANCH_CODE_PATTERN.test("TEST")).to.equal(true);
    expect(BRANCH_CODE_PATTERN.test("has space")).to.equal(false);
    expect(BRANCH_CODE_PATTERN.test("../escape")).to.equal(false);
  });

  it("treats foreign tenant keys as not owned", () => {
    const key = buildMemberPhotoKey(BRANCH, MEMBER_ID, 1, { extension: "webp" });

    expect(isTenantOwned(key, BRANCH)).to.equal(true);
    expect(isTenantOwned(key, OTHER_BRANCH)).to.equal(false);
    expect(isMemberKeyFor(key, OTHER_BRANCH, MEMBER_ID)).to.equal(false);
    expect(isMemberKeyFor(key, BRANCH, OTHER_MEMBER_ID)).to.equal(false);
    expect(isMemberKeyFor(key, BRANCH, MEMBER_ID)).to.equal(true);
  });

  it("only accepts a pending key for a new member when explicitly allowed", () => {
    const pending = buildPendingPhotoKey(BRANCH, { extension: "webp" });

    expect(isMemberKeyFor(pending, BRANCH, MEMBER_ID, { allowPending: true })).to.equal(true);
    expect(isMemberKeyFor(pending, BRANCH, MEMBER_ID)).to.equal(false);
  });

  it("rejects anything that is not a well-formed photo key", () => {
    for (const candidate of [
      null,
      undefined,
      "",
      "photo-1.webp",
      `tenants/${BRANCH}/members/${MEMBER_ID}/photo-1-abc.gif`,
      `tenants/${BRANCH}/members/${MEMBER_ID}/avatar.png`,
      `tenants/${BRANCH}/members/${MEMBER_ID}/../../../etc/passwd`,
      `tenants/${BRANCH}/members/pending/short/photo-1-abc.webp`,
      `tenants/${BRANCH}/members/${MEMBER_ID}/photo-1-abc.webp?sig=x`,
      `tenants/${BRANCH}/members/${MEMBER_ID}/photo-1-abc.webp/extra`,
    ]) {
      expect(isPhotoObjectKey(candidate), `expected rejection for ${candidate}`).to.equal(false);
    }
  });

  it("generates URL-safe random ids of the requested length", () => {
    expect(randomHex(12)).to.match(/^[0-9a-f]{12}$/);
    expect(randomHex(12)).to.not.equal(randomHex(12));
  });
});

/* ============================================================
   EDGE MEDIA TOKEN
   ============================================================ */
describe("media edge token (unit)", () => {
  const SECRET = "test-media-token-secret";

  it("round-trips branch scope and subject", async () => {
    const token = await signMediaToken({
      secret: SECRET,
      branchCode: BRANCH,
      subject: "kiosk:kiosk-1",
      ttlSeconds: 900,
      now: 1_700_000_000,
    });

    const payload = await verifyMediaToken(token, { secret: SECRET, now: 1_700_000_100 });
    expect(payload).to.be.an("object");
    expect(payload.branchCode).to.equal(BRANCH);
    expect(payload.subject).to.equal("kiosk:kiosk-1");
    expect(payload.expiresAt).to.equal(1_700_000_000 + 900);
  });

  it("rejects a tampered payload", async () => {
    const token = await signMediaToken({
      secret: SECRET,
      branchCode: BRANCH,
      subject: "admin:1",
      now: 1_700_000_000,
    });
    const [encoded, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ v: 1, b: OTHER_BRANCH, s: "admin:1", iat: 1_700_000_000, exp: 1_700_000_900 })
    ).toString("base64url");

    expect(await verifyMediaToken(`${forged}.${signature}`, { secret: SECRET })).to.equal(null);
    expect(await verifyMediaToken(`${encoded}x.${signature}`, { secret: SECRET })).to.equal(null);
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signMediaToken({
      secret: SECRET,
      branchCode: BRANCH,
      subject: "admin:1",
      now: 1_700_000_000,
    });

    expect(await verifyMediaToken(token, { secret: "other-secret" })).to.equal(null);
  });

  it("rejects expired tokens (30s skew tolerated)", async () => {
    const token = await signMediaToken({
      secret: SECRET,
      branchCode: BRANCH,
      subject: "admin:1",
      ttlSeconds: 60,
      now: 1_700_000_000,
    });

    expect(await verifyMediaToken(token, { secret: SECRET, now: 1_700_000_050 })).to.be.an("object");
    expect(await verifyMediaToken(token, { secret: SECRET, now: 1_700_000_100 })).to.equal(null);
  });

  it("rejects malformed tokens", async () => {
    for (const bad of [null, undefined, "", "no-dot", "a.b.c", "..", "not-base64!!."]) {
      expect(await verifyMediaToken(bad, { secret: SECRET })).to.equal(null);
    }
  });

  it("hands the browser an HttpOnly, non-JS-readable cookie", () => {
    const options = mediaTokenCookieOptions({ ttlSeconds: 900, isProduction: true });

    expect(options.httpOnly).to.equal(true);
    expect(options.secure).to.equal(true);
    expect(options.path).to.equal("/");
    expect(options.maxAge).to.equal(900);
    // Path-scoped to "/" so the Worker sees it on /photos/* requests.
    expect(options.sameSite).to.equal("lax");
  });
});

/* ============================================================
   STORAGE ADAPTER
   ============================================================ */
describe("storage adapter contract (unit, memory adapter)", () => {
  it("presigns a PUT with the signed content type and an expiry", async () => {
    const storage = createMemoryStorage();
    const result = await storage.presignPut({
      key: buildPendingPhotoKey(BRANCH, { extension: "webp" }),
      contentType: "image/webp",
      expiresIn: 60,
    });

    expect(result.method).to.equal("PUT");
    expect(result.headers).to.deep.equal({ "Content-Type": "image/webp" });
    expect(result.url).to.be.a("string").and.not.equal("");
    expect(new Date(result.expiresAt).getTime()).to.be.greaterThan(Date.now());
  });

  it("supports the head/list/remove lifecycle used by the cleanup jobs", async () => {
    const storage = createMemoryStorage();
    const key = buildMemberPhotoKey(BRANCH, MEMBER_ID, 1, { extension: "webp" });

    expect(await storage.head(key)).to.equal(null);

    await storage.putSized(key, { contentType: "image/webp", size: 1024 });
    const head = await storage.head(key);
    expect(head).to.deep.include({ key, size: 1024, contentType: "image/webp" });

    const listed = await storage.list(tenantPrefix(BRANCH));
    expect(listed.map((entry) => entry.key)).to.deep.equal([key]);

    await storage.remove(key);
    expect(await storage.head(key)).to.equal(null);
    expect(await storage.list(tenantPrefix(BRANCH))).to.deep.equal([]);
  });
});

/* ============================================================
   STORAGE PROVIDER REGISTRY
   ============================================================ */
describe("storage provider registry (unit)", () => {
  const CONFIG = {
    endpoint: "https://s3.us-west-004.backblazeb2.com",
    region: "us-west-004",
    accessKeyId: "test-key-id",
    secretAccessKey: "test-secret",
    bucket: "giri-gym-media",
  };

  it("routes every supported provider name to the S3-compatible adapter", () => {
    for (const provider of ["b2", "s3", "aws", "r2", "minio", "wasabi", "B2"]) {
      expect(createStorageAdapter(provider, CONFIG).provider).to.equal("s3");
    }
    expect(createStorageAdapter("memory").provider).to.equal("memory");
  });

  it("rejects unknown providers with an actionable error", () => {
    expect(() => createStorageAdapter("gcs", CONFIG)).to.throw(
      /Unsupported MEDIA_STORAGE_PROVIDER "gcs"/
    );
  });

  it("presigns an offline PUT against the configured endpoint and bucket", async () => {
    const adapter = createStorageAdapter("b2", CONFIG);
    const result = await adapter.presignPut({
      key: "tenants/GIRI/members/64b0f0a1a1a1a1a1a1a1a1a1/photo-1-abc123.webp",
      contentType: "image/webp",
      expiresIn: 300,
    });

    expect(result.method).to.equal("PUT");
    expect(result.headers).to.deep.equal({ "Content-Type": "image/webp" });
    const url = result.url.toLowerCase();
    expect(url).to.match(
      /^https:\/\/s3\.us-west-004\.backblazeb2\.com\/giri-gym-media\/tenants\/giri\/members\/64b0f0a1a1a1a1a1a1a1a1a1\/photo-1-abc123\.webp\?/
    );
    expect(url).to.include("x-amz-signature=");
    expect(url).to.include("x-amz-expires=300");
  });
});

/* ============================================================
   MEDIA CONFIG — PROVIDER-AGNOSTIC ENV CONTRACT
   ============================================================ */
describe("media config env compatibility (unit)", () => {
  const TOUCHED = [
    "MEDIA_STORAGE_PROVIDER",
    "MEDIA_BUCKET",
    "MEDIA_ENDPOINT",
    "MEDIA_REGION",
    "MEDIA_ACCESS_KEY_ID",
    "MEDIA_SECRET_ACCESS_KEY",
    "MEDIA_PUBLIC_BASE_URL",
    "MEDIA_STORAGE_ENABLED",
    "MEDIA_R2_ENABLED",
    "R2_BUCKET",
    "R2_ENDPOINT",
    "R2_REGION",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "PHOTO_CDN_BASE_URL",
  ];
  const LEGACY = {
    R2_ENDPOINT: "https://legacy.example.com",
    R2_ACCESS_KEY_ID: "legacy-id",
    R2_SECRET_ACCESS_KEY: "legacy-secret",
    R2_BUCKET: "legacy-bucket",
    PHOTO_CDN_BASE_URL: "https://cdn.example.com/photos",
  };
  let saved;
  let importCounter = 0;

  const freshConfig = async () => {
    importCounter += 1;
    const mod = await import(`../config/mediaConfig.js?test=${importCounter}`);
    return mod.MEDIA_CONFIG;
  };

  beforeEach(() => {
    saved = {};
    for (const name of TOUCHED) {
      saved[name] = process.env[name];
      // Blank (don't delete): mediaConfig re-runs dotenv.config() on each
      // cache-busted import, which would repopulate deleted keys from .env now
      // that the real MEDIA_* values exist there. "" reads as absent for us.
      process.env[name] = "";
    }
  });

  afterEach(() => {
    for (const name of TOUCHED) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it("still honours legacy R2_* / PHOTO_CDN_BASE_URL / MEDIA_R2_ENABLED names", async () => {
    for (const [name, value] of Object.entries(LEGACY)) process.env[name] = value;
    process.env.MEDIA_R2_ENABLED = "true";

    const config = await freshConfig();

    expect(config.storage.provider).to.equal("b2"); // default provider
    expect(config.storage).to.deep.equal({
      provider: "b2",
      bucket: "legacy-bucket",
      endpoint: "https://legacy.example.com",
      region: "us-east-1",
      accessKeyId: "legacy-id",
      secretAccessKey: "legacy-secret",
    });
    expect(config.enabled).to.equal(true);
    expect(config.enabledFlagSet).to.equal(true);
    expect(config.deliveryBaseUrl).to.equal("https://cdn.example.com/photos");
  });

  it("prefers MEDIA_* names over the legacy fallbacks", async () => {
    for (const [name, value] of Object.entries(LEGACY)) process.env[name] = value;
    process.env.MEDIA_STORAGE_PROVIDER = "b2";
    process.env.MEDIA_ENDPOINT = "https://s3.us-west-004.backblazeb2.com";
    process.env.MEDIA_BUCKET = "modern-bucket";
    process.env.MEDIA_ACCESS_KEY_ID = "modern-id";
    process.env.MEDIA_SECRET_ACCESS_KEY = "modern-secret";
    process.env.MEDIA_PUBLIC_BASE_URL = "https://media.example.com/photos";

    const config = await freshConfig();

    expect(config.storage.bucket).to.equal("modern-bucket");
    expect(config.storage.endpoint).to.equal("https://s3.us-west-004.backblazeb2.com");
    expect(config.storage.accessKeyId).to.equal("modern-id");
    expect(config.deliveryBaseUrl).to.equal("https://media.example.com/photos");
  });

  it("derives enabled from credentials and honours the rollback switch", async () => {
    // No credentials → off regardless of the switch.
    process.env.MEDIA_STORAGE_ENABLED = "true";
    let config = await freshConfig();
    expect(config.enabled).to.equal(false);

    // Credentials present → on; enabledFlagSet reflects only an explicit "true".
    process.env.MEDIA_ENDPOINT = "https://s3.us-west-004.backblazeb2.com";
    process.env.MEDIA_BUCKET = "b";
    process.env.MEDIA_ACCESS_KEY_ID = "id";
    process.env.MEDIA_SECRET_ACCESS_KEY = "secret";
    config = await freshConfig();
    expect(config.enabled).to.equal(true);
    expect(config.enabledFlagSet).to.equal(true);

    // Rollback switch wins over credentials.
    process.env.MEDIA_STORAGE_ENABLED = "false";
    config = await freshConfig();
    expect(config.enabled).to.equal(false);
  });
});

/* ============================================================
   MEDIA SERVICE
   ============================================================ */
describe("media service (unit, in-memory storage)", () => {
  let storage;

  beforeEach(() => {
    storage = createMemoryStorage();
    configureMediaForTests({ enabled: true, storage });
  });

  afterEach(() => {
    resetMediaForTests();
  });

  it("presigns an upload for an existing member", async () => {
    const result = await presignPhoto({
      branchCode: BRANCH,
      memberId: MEMBER_ID,
      extension: "webp",
    });

    expect(result.key.startsWith(memberPhotoPrefix(BRANCH, MEMBER_ID))).to.equal(true);
    expect(result.contentType).to.equal("image/webp");
    expect(result.method).to.equal("PUT");
    expect(result.maxBytes).to.equal(getMediaConstraints().maxBytes);
    expect(result.url).to.be.a("string");
  });

  it("presigns an in-flight key for registration (no member id yet)", async () => {
    const result = await presignPhoto({ branchCode: BRANCH, extension: "jpeg" });

    expect(parsePhotoKey(result.key).scope).to.equal("pending");
    expect(result.contentType).to.equal("image/jpeg");
  });

  it("presigns JPEG as image/jpeg and rejects unknown extensions", async () => {
    const jpeg = await presignPhoto({ branchCode: BRANCH, memberId: MEMBER_ID, extension: "jpg" });
    expect(jpeg.contentType).to.equal("image/jpeg");

    let error = null;
    try {
      await presignPhoto({ branchCode: BRANCH, memberId: MEMBER_ID, extension: "png" });
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(MediaError);
    expect(error.statusCode).to.equal(415);
    expect(error.errorCode).to.equal("MEDIA_TYPE_INVALID");
  });

  it("accepts a correctly uploaded WebP object", async () => {
    const { key } = await presignPhoto({ branchCode: BRANCH, memberId: MEMBER_ID });
    await storage.put(key, { contentType: "image/webp", body: "fake-webp-bytes" });

    const verified = await verifyUploadedPhoto({ key, branchCode: BRANCH, memberId: MEMBER_ID });
    expect(verified).to.deep.include({ key, contentType: "image/webp" });
    expect(verified.size).to.be.greaterThan(0);
  });

  it("rejects a reference to an object that was never uploaded", async () => {
    const { key } = await presignPhoto({ branchCode: BRANCH, memberId: MEMBER_ID });

    await expectError(
      () => verifyUploadedPhoto({ key, branchCode: BRANCH, memberId: MEMBER_ID }),
      422,
      "MEDIA_OBJECT_MISSING"
    );
  });

  it("rejects and deletes an oversized object", async () => {
    const { key, maxBytes } = await presignPhoto({ branchCode: BRANCH, memberId: MEMBER_ID });
    await storage.putSized(key, { contentType: "image/webp", size: maxBytes + 1 });

    await expectError(
      () => verifyUploadedPhoto({ key, branchCode: BRANCH, memberId: MEMBER_ID }),
      413,
      "MEDIA_TOO_LARGE"
    );
    expect(await storage.head(key)).to.equal(null);
  });

  it("rejects and deletes an object whose content type is not allowed", async () => {
    const { key } = await presignPhoto({ branchCode: BRANCH, memberId: MEMBER_ID });
    await storage.put(key, { contentType: "image/png", body: "png-bytes" });

    await expectError(
      () => verifyUploadedPhoto({ key, branchCode: BRANCH, memberId: MEMBER_ID }),
      415,
      "MEDIA_TYPE_INVALID"
    );
    expect(await storage.head(key)).to.equal(null);
  });

  it("refuses a cross-tenant key WITHOUT touching the object", async () => {
    const { key } = await presignPhoto({ branchCode: BRANCH, memberId: MEMBER_ID });
    await storage.put(key, { contentType: "image/webp", body: "bytes" });

    await expectError(
      () => verifyUploadedPhoto({ key, branchCode: OTHER_BRANCH, memberId: MEMBER_ID }),
      403,
      "MEDIA_KEY_FORBIDDEN"
    );
    expect(await storage.head(key)).to.not.equal(null);
  });

  it("refuses another member's key inside the same branch", async () => {
    const { key } = await presignPhoto({ branchCode: BRANCH, memberId: MEMBER_ID });
    await storage.put(key, { contentType: "image/webp", body: "bytes" });

    await expectError(
      () => verifyUploadedPhoto({ key, branchCode: BRANCH, memberId: OTHER_MEMBER_ID }),
      403,
      "MEDIA_KEY_FORBIDDEN"
    );
  });

  it("accepts a pending key for registration but not an attached one", async () => {
    const pending = await presignPhoto({ branchCode: BRANCH });
    await storage.put(pending.key, { contentType: "image/webp", body: "bytes" });

    const verified = await verifyUploadedPhoto({ key: pending.key, branchCode: BRANCH });
    expect(verified.key).to.equal(pending.key);

    const attached = await presignPhoto({ branchCode: BRANCH, memberId: MEMBER_ID });
    await storage.put(attached.key, { contentType: "image/webp", body: "bytes" });

    await expectError(
      () => verifyUploadedPhoto({ key: attached.key, branchCode: BRANCH }),
      400,
      "MEDIA_KEY_INVALID"
    );
  });

  it("rejects a malformed key before touching storage", async () => {
    await expectError(
      () => verifyUploadedPhoto({ key: "../../etc/passwd", branchCode: BRANCH, memberId: MEMBER_ID }),
      400,
      "MEDIA_KEY_INVALID"
    );
    expect(storage.objects.size).to.equal(0);
  });

  it("builds delivery URLs from the configured base, never a raw bucket", () => {
    const key = buildMemberPhotoKey(BRANCH, MEMBER_ID, 1, { extension: "webp" });
    const url = deliveryUrl(key);

    expect(url).to.match(/^https?:\/\/.+\/tenants\/MATHUR\//);
    expect(url.endsWith(key)).to.equal(true);
    expect(deliveryUrl(null)).to.equal(null);
  });

  it("prefers the active media key and falls back to legacy photoUrl", () => {
    const key = buildMemberPhotoKey(BRANCH, MEMBER_ID, 2, { extension: "webp" });

    expect(resolvePhotoUrl({ photoKey: key, photoUrl: "/uploads/old.jpg" })).to.equal(
      deliveryUrl(key)
    );
    expect(resolvePhotoUrl({ photoUrl: "/uploads/legacy.jpg" })).to.equal("/uploads/legacy.jpg");
    expect(resolvePhotoUrl({})).to.equal(null);
    expect(resolvePhotoUrl(null)).to.equal(null);
  });

  it("exposes cleanup windows of 24h (orphans) and 14 days (previous photos)", () => {
    const { orphanGraceMs, previousRetentionMs } = getCleanupConfig();

    expect(orphanGraceMs).to.equal(24 * 60 * 60 * 1000);
    expect(previousRetentionMs).to.equal(14 * 24 * 60 * 60 * 1000);
  });
});

describe("media service disabled (unit)", () => {
  afterEach(() => {
    resetMediaForTests();
  });

  it("fails closed with 503 when the pipeline is not configured", async () => {
    configureMediaForTests({ enabled: false, storage: createMemoryStorage() });
    expect(isMediaEnabled()).to.equal(false);

    await expectError(
      () => presignPhoto({ branchCode: BRANCH, memberId: MEMBER_ID }),
      503,
      "MEDIA_DISABLED"
    );
    await expectError(
      () => verifyUploadedPhoto({ key: buildMemberPhotoKey(BRANCH, MEMBER_ID, 1, {}), branchCode: BRANCH, memberId: MEMBER_ID }),
      503,
      "MEDIA_DISABLED"
    );
  });
});

async function expectError(action, statusCode, errorCode) {
  let error = null;
  try {
    await action();
  } catch (err) {
    error = err;
  }
  expect(error, "expected the call to fail").to.be.instanceOf(MediaError);
  expect(error.statusCode).to.equal(statusCode);
  expect(error.errorCode).to.equal(errorCode);
  return error;
}
