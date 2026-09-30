/**
 * Member Photo Media Pipeline — Phase 5 (edge delivery Worker).
 *
 * Drives worker/src/index.js (the real Worker handler) from Node with a mock
 * bucket binding, verifying the read path end to end:
 *   AUTH     — HttpOnly media cookie (shared HMAC token), expiry, tampering
 *   TENANT   — a token for branch A can never read branch B's objects
 *   DELIVERY — immutable cache headers, conditional requests, HEAD
 *   FAILSAFE — 500 when unconfigured, no-store on every error status
 * Plus the S3-compatible store (worker/src/s3Store.js) the Worker uses to read
 * from Backblaze B2 when no bucket binding is present.
 *
 * The request URL is built from the backend's own deliveryUrl(), so this suite
 * proves the backend URL shape and the Worker route contract agree.
 *
 * Run: cd backend && npm test
 */

import { expect } from "chai";
import worker, { handlePhotoRequest } from "../../../worker/src/index.js";
import { createS3ObjectStore } from "../../../worker/src/s3Store.js";
import { signMediaToken } from "../media/token.js";
import { deliveryUrl } from "../media/delivery.js";

const SECRET = "worker-test-secret";
const COOKIE = "gym_media_token";
const KEY = "tenants/TEST/members/64b0000000000000000000aa/photo-1-abc123.webp";

const encoder = new TextEncoder();

/** Minimal bucket binding stand-in: get(key) → object | null. */
const makeBucket = (objects) => ({
  get: async (key) => objects.get(key) ?? null,
});

const makeEnv = (overrides = {}) => ({
  MEDIA_TOKEN_SECRET: SECRET,
  PHOTO_ROUTE_PREFIX: "/photos/",
  ...overrides,
});

const makeObject = (body = "fake-image-bytes", { etag = '"v1-etag"' } = {}) => ({
  body: encoder.encode(body),
  size: encoder.encode(body).byteLength,
  etag,
  httpMetadata: { contentType: "image/webp", etag },
});

/** Build the Request the way the browser would, from the backend's URL. */
const photoRequest = (key, { token, method = "GET", headers = {} } = {}) => {
  const request = new Request(deliveryUrl(key), { method });
  if (token) request.headers.set("Cookie", `${COOKIE}=${token}`);
  for (const [name, value] of Object.entries(headers)) request.headers.set(name, value);
  return request;
};

const signFor = (branchCode, options = {}) =>
  signMediaToken({ secret: SECRET, branchCode, subject: "kiosk:test-device", ...options });

describe("Edge delivery Worker (integration)", function () {
  let objects;
  let env;

  beforeEach(() => {
    objects = new Map([[KEY, makeObject()]]);
    env = makeEnv({ MEDIA_BUCKET: makeBucket(objects) });
  });

  it("serves the object for a valid cookie with immutable cache headers", async () => {
    const token = await signFor("TEST");
    const res = await handlePhotoRequest(photoRequest(KEY, { token }), env);

    expect(res.status).to.equal(200);
    expect(res.headers.get("Cache-Control")).to.equal("public, max-age=31536000, immutable");
    expect(res.headers.get("Content-Type")).to.equal("image/webp");
    expect(res.headers.get("ETag")).to.equal('"v1-etag"');
    expect(res.headers.get("X-Content-Type-Options")).to.equal("nosniff");
    expect(await res.text()).to.equal("fake-image-bytes");
  });

  it("supports HEAD without a body", async () => {
    const token = await signFor("TEST");
    const res = await handlePhotoRequest(photoRequest(KEY, { token, method: "HEAD" }), env);

    expect(res.status).to.equal(200);
    expect(res.headers.get("Content-Length")).to.equal("16");
    expect(await res.text()).to.equal("");
  });

  it("answers 304 for a matching If-None-Match", async () => {
    const token = await signFor("TEST");
    const res = await handlePhotoRequest(
      photoRequest(KEY, { token, headers: { "If-None-Match": '"v1-etag"' } }),
      env
    );

    expect(res.status).to.equal(304);
    expect(res.headers.get("ETag")).to.equal('"v1-etag"');
  });

  it("rejects a request without the media cookie (401, never cached)", async () => {
    const res = await handlePhotoRequest(photoRequest(KEY), env);

    expect(res.status).to.equal(401);
    expect(res.headers.get("Cache-Control")).to.equal("private, no-store");
    expect(res.headers.get("X-Media-Error")).to.equal("unauthorized");
  });

  it("rejects a tampered token (401)", async () => {
    const token = await signFor("TEST");
    const forged = token.slice(0, -4) + "AAAA";
    const res = await handlePhotoRequest(photoRequest(KEY, { token: forged }), env);

    expect(res.status).to.equal(401);
  });

  it("rejects an expired token (401)", async () => {
    const token = await signFor("TEST", { ttlSeconds: -600 });
    const res = await handlePhotoRequest(photoRequest(KEY, { token }), env);

    expect(res.status).to.equal(401);
  });

  it("refuses cross-tenant reads: branch A token cannot fetch branch B key (403)", async () => {
    const foreignKey = "tenants/SECOND/members/64b0000000000000000000bb/photo-1-x.webp";
    objects.set(foreignKey, makeObject());
    const token = await signFor("TEST");

    const res = await handlePhotoRequest(photoRequest(foreignKey, { token }), env);

    expect(res.status).to.equal(403);
    expect(res.headers.get("X-Media-Error")).to.equal("tenant_mismatch");
    expect(res.headers.get("Cache-Control")).to.equal("private, no-store");
    // Only the error marker came back — never the foreign object's bytes.
    expect(await res.text()).to.equal("tenant_mismatch");
  });

  it("returns 404 when the object does not exist", async () => {
    const token = await signFor("TEST");
    const res = await handlePhotoRequest(
      photoRequest("tenants/TEST/members/64b0000000000000000000aa/photo-9-gone.webp", { token }),
      env
    );

    expect(res.status).to.equal(404);
    expect(res.headers.get("Cache-Control")).to.equal("private, no-store");
  });

  it("returns 404 for a path outside the photo route", async () => {
    const token = await signFor("TEST");
    const res = await handlePhotoRequest(
      new Request(`http://app.local/other/${KEY}`, {
        headers: { Cookie: `${COOKIE}=${token}` },
      }),
      env
    );

    expect(res.status).to.equal(404);
  });

  it("rejects path traversal in the object key (400)", async () => {
    const token = await signFor("TEST");
    // A literal ".." is normalised away by the URL parser, so the dangerous
    // case is a percent-encoded traversal that only appears after decoding.
    const res = await handlePhotoRequest(
      photoRequest("tenants/TEST/members/%2e%2e%2f%2e%2e/secret.webp", { token }),
      env
    );

    expect(res.status).to.equal(400);
    expect(res.headers.get("X-Media-Error")).to.equal("invalid_key");
  });

  it("rejects keys outside the recognised tenants/ layout (403)", async () => {
    const token = await signFor("TEST");
    const res = await handlePhotoRequest(
      photoRequest("random-bucket-path/file.webp", { token }),
      env
    );

    expect(res.status).to.equal(403);
  });

  it("rejects non-GET methods (405)", async () => {
    const token = await signFor("TEST");
    const res = await handlePhotoRequest(photoRequest(KEY, { token, method: "POST" }), env);

    expect(res.status).to.equal(405);
    expect(res.headers.get("Allow")).to.equal("GET, HEAD");
  });

  it("never serves content when the verification secret is missing (500)", async () => {
    const token = await signFor("TEST");
    const unconfigured = makeEnv({ MEDIA_BUCKET: makeBucket(objects), MEDIA_TOKEN_SECRET: "" });
    const res = await handlePhotoRequest(photoRequest(KEY, { token }), unconfigured);

    expect(res.status).to.equal(500);
    expect(res.headers.get("X-Media-Error")).to.equal("server_misconfigured");
  });
});

/* ============================================================
   S3-COMPATIBLE OBJECT STORE (B2 DELIVERY)
   ============================================================ */
describe("S3-compatible object store (unit)", function () {
  const S3_ENV = {
    MEDIA_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
    MEDIA_BUCKET: "giri-gym-media",
    MEDIA_ACCESS_KEY_ID: "test-key-id",
    MEDIA_SECRET_ACCESS_KEY: "test-secret",
    MEDIA_REGION: "us-west-004",
  };

  it("returns null when configuration is incomplete (fails closed)", () => {
    expect(createS3ObjectStore({})).to.equal(null);
    expect(createS3ObjectStore({ ...S3_ENV, MEDIA_SECRET_ACCESS_KEY: "" })).to.equal(null);
    expect(createS3ObjectStore({ ...S3_ENV, MEDIA_BUCKET: "" })).to.equal(null);
  });

  it("signs a SigV4 GET against the configured endpoint and bucket", async () => {
    let captured;
    const fetchImpl = async (request) => {
      captured = request;
      return new Response("image-bytes", {
        status: 200,
        headers: {
          "content-type": "image/webp",
          etag: '"v1-etag"',
          "content-length": String(Buffer.byteLength("image-bytes")),
        },
      });
    };

    const store = createS3ObjectStore(S3_ENV, { fetchImpl });
    const object = await store.get(KEY);

    expect(captured.url).to.equal(
      `https://s3.us-west-004.backblazeb2.com/giri-gym-media/${KEY}`
    );
    const authorization = captured.headers.get("authorization") || "";
    expect(authorization).to.match(
      /^AWS4-HMAC-SHA256 Credential=test-key-id\/\d{8}\/us-west-004\/s3\/aws4_request/
    );

    expect(object.contentType).to.equal("image/webp");
    expect(object.etag).to.equal('"v1-etag"');
    expect(object.size).to.equal(11);
    expect(await new Response(object.body).text()).to.equal("image-bytes");
  });

  it("maps 404 to null (photo not found)", async () => {
    const store = createS3ObjectStore(S3_ENV, {
      fetchImpl: async () => new Response("NoSuchKey", { status: 404 }),
    });

    expect(await store.get(KEY)).to.equal(null);
  });

  it("throws on storage failures so the Worker answers 502", async () => {
    const store = createS3ObjectStore(S3_ENV, {
      fetchImpl: async () => new Response("boom", { status: 503 }),
    });

    let error;
    try {
      await store.get(KEY);
    } catch (caught) {
      error = caught;
    }
    expect(error).to.be.an("error");
    expect(error.message).to.match(/GET failed with status 503/);
  });

  it("serves a full request through the Worker fetch entry (cookie → B2 → 200)", async () => {
    const originalFetch = globalThis.fetch;
    let sawSignedGet;
    globalThis.fetch = async (request) => {
      sawSignedGet = request;
      return new Response("image-bytes", {
        status: 200,
        headers: { "content-type": "image/webp", etag: '"v1-etag"' },
      });
    };

    try {
      const token = await signFor("TEST");
      const res = await worker.fetch(photoRequest(KEY, { token }), {
        ...S3_ENV,
        MEDIA_TOKEN_SECRET: SECRET,
        PHOTO_ROUTE_PREFIX: "/photos/",
      });

      expect(res.status).to.equal(200);
      expect(res.headers.get("Cache-Control")).to.equal("public, max-age=31536000, immutable");
      expect(res.headers.get("Content-Type")).to.equal("image/webp");
      expect(await res.text()).to.equal("image-bytes");
      expect(sawSignedGet.url).to.equal(
        `https://s3.us-west-004.backblazeb2.com/giri-gym-media/${KEY}`
      );
      expect(sawSignedGet.headers.get("authorization") || "").to.match(
        /^AWS4-HMAC-SHA256 Credential=test-key-id\//
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
