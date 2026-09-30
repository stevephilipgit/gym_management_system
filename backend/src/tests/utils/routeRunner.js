// tests/utils/routeRunner.js — mock req/res + middleware-chain runner.
//
// The suites do not boot an HTTP server: they drive a router's route stack
// directly (adminAuth → validation → controller) with a mock request/response
// so authorization and error mapping are still exercised end to end.
//
// Usage:
//   const res = await runRoute(memberRoutes, "post", "/register", req);
//   expect(res.statusCode).to.equal(201);
import { errorHandler } from "../../core/errorHandler.js";

/** Express-shaped response double (cookies + header surface included). */
export function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    cookieJar: {},
    cleared: [],
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    cookie(name, value, options) {
      this.cookieJar[name] = { value, options };
      return this;
    },
    clearCookie(name) {
      this.cleared.push(name);
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    // Node/Express response header surface — required by express-rate-limit.
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    getHeader(name) {
      return this.headers[name];
    },
    removeHeader(name) {
      delete this.headers[name];
      return this;
    },
  };
}

/**
 * Authenticated admin request double: valid X-Session-Id header + matching
 * session-scoped access cookie, so adminAuth passes and the handler under test
 * is what actually runs.
 */
export function makeAdminReq({ session, token, overrides = {} } = {}) {
  return {
    ip: "127.0.0.1",
    method: "POST",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    // express-rate-limit reads `app.get("trust proxy ...")`; auditLog reads
    // `app.locals` — mirror both shapes a real Express req has.
    app: { get: () => undefined, locals: {} },
    get: (name) => (name === "x-session-id" ? session?.sessionId : undefined),
    cookies: session ? { [`gym_admin_token_${session.sessionId}`]: token } : {},
    body: {},
    query: {},
    ...overrides,
  };
}

/**
 * Run one route's full middleware chain against `req`.
 * Thrown AppErrors are routed through the global error handler exactly as
 * Express would, so rejections become real HTTP statuses.
 */
export async function runRoute(router, method, path, req) {
  const res = makeRes();
  let failure = null;

  for (const layer of router.stack) {
    if (!layer.route || layer.route.path !== path) continue;
    if (!layer.route.stack.some((l) => l.method === method)) continue;

    for (const handler of layer.route.stack) {
      if (handler.method !== method) continue;
      if (res.statusCode !== 200) break;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        const done = (err) => {
          if (err && !failure) failure = err;
          resolve();
        };
        const outcome = handler.handle(req, res, done);
        if (outcome && typeof outcome.then === "function") {
          outcome.then(
            () => resolve(),
            (err) => {
              if (!failure) failure = err;
              resolve();
            }
          );
        }
      });
      // Express stops the chain the moment a middleware passes an error on.
      if (failure) break;
    }
    break;
  }

  if (failure && res.statusCode === 200) {
    if (process.env.MEDIA_DEBUG) {
      // eslint-disable-next-line no-console
      console.error(
        "[routeRunner] failure:",
        failure?.message,
        "status:",
        failure?.statusCode,
        "|",
        failure?.stack?.split("\n")[1]?.trim()
      );
    }
    errorHandler(failure, req, res, () => {});
  }
  return res;
}
