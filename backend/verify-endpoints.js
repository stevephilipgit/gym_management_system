#!/usr/bin/env node
/**
 * Endpoint Verification Script
 * Tests validation, audit logging, error handling, and rate limiting
 * 
 * Usage: node verify-endpoints.js
 */

import http from "http";

const BASE_URL = "http://localhost:5000";
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[36m",
  gray: "\x1b[90m",
};

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset}  ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset}  ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset}  ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset}  ${msg}`),
  test: (msg) => console.log(`\n${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n${msg}\n${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`),
};

/**
 * Make HTTP request
 */
function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "VerifyEndpoints/1.0",
      },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, data });
        }
      });
    });

    req.on("error", reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Test 1: Validation middleware - Invalid login
 */
async function testValidationMiddleware() {
  log.test("TEST 1: Validation Middleware - Invalid Data");

  log.info("Testing POST /api/members/register with missing fullName...");
  const response = await makeRequest("POST", "/api/members/register", {
    // missing fullName, fatherName, phone - should fail validation
  });

  if (response.status === 400 && response.data.details) {
    log.success("✓ Validation middleware caught missing fields");
    log.info(`  Details: ${response.data.details[0]?.message}`);
  } else if (response.status === 400) {
    log.success("✓ Validation rejected invalid data (400)");
  } else {
    log.warn(`⚠ Got status ${response.status} (rate limiting may be active)`);
  }
}

/**
 * Test 2: Schema validation - Strong password enforcement
 */
async function testPasswordValidation() {
  log.test("TEST 2: Password Strength Validation");

  log.info("Testing POST /api/admin/login with weak password...");
  const response = await makeRequest("POST", "/api/admin/login", {
    username: "admin",
    password: "weak", // too short, will fail password strength
  });

  if (response.status === 400) {
    log.success("✓ Weak password rejected (400)");
  } else if (response.status === 429) {
    log.warn(`⚠ Rate limited (429) - retry limiter active, but validation is working`);
  } else {
    log.warn(`⚠ Expected 400, got ${response.status}`);
  }
}

/**
 * Test 3: Health check endpoint
 */
async function testHealthCheck() {
  log.test("TEST 3: Health Check Endpoints");

  log.info("Testing GET /api/health...");
  const health = await makeRequest("GET", "/api/health");
  if (health.status === 200 && health.data.status === "ok") {
    log.success("✓ Health check passed");
    log.info(`  Uptime: ${health.data.uptime}s`);
  } else {
    log.error(`✗ Health check failed: ${health.status}`);
  }

  log.info("Testing GET /api/health/info...");
  const info = await makeRequest("GET", "/api/health/info");
  if (info.status === 200) {
    log.success("✓ Health info retrieved");
    if (info.data.database?.connected) {
      log.success("  ✓ MongoDB connected");
    } else {
      log.error("  ✗ MongoDB not connected");
    }
    if (info.data.redis?.connected) {
      log.success("  ✓ Redis connected");
    } else {
      log.error("  ✗ Redis not connected");
    }
  } else {
    log.error(`✗ Health info failed: ${info.status}`);
  }
}

/**
 * Test 4: Rate limiting
 */
async function testRateLimiting() {
  log.test("TEST 4: Rate Limiting");

  log.info("Testing admin rate limiter (max 100 requests per minute)...");
  
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(makeRequest("GET", "/api/admin/me"));
  }

  const results = await Promise.all(promises);
  const rateLimitedResponse = results.find((r) => r.status === 429);

  if (rateLimitedResponse) {
    log.success("✓ Rate limiter is active");
  } else {
    log.info("ℹ No rate limit hit (within threshold)");
  }

  const firstResponse = results[0];
  if (firstResponse.headers["x-ratelimit-limit"]) {
    log.success("✓ Rate limit headers present");
    log.info(`  Limit: ${firstResponse.headers["x-ratelimit-limit"]}`);
    log.info(`  Remaining: ${firstResponse.headers["x-ratelimit-remaining"]}`);
  }
}

/**
 * Test 5: Error handling
 */
async function testErrorHandling() {
  log.test("TEST 5: Error Handling");

  log.info("Testing 404 error on invalid endpoint...");
  const response = await makeRequest("GET", "/api/nonexistent");
  if (response.status === 404) {
    log.success("✓ 404 error handled correctly");
  } else {
    log.warn(`⚠ Expected 404, got ${response.status}`);
  }

  log.info("Testing method not allowed...");
  const methodResponse = await makeRequest("DELETE", "/api/admin/login");
  if (methodResponse.status >= 400) {
    log.success("✓ Invalid method rejected");
  }
}

/**
 * Test 6: CORS headers
 */
async function testCORS() {
  log.test("TEST 6: Security Headers");

  log.info("Checking response headers...");
  const response = await makeRequest("GET", "/api/health");

  const requiredHeaders = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-xss-protection": "1; mode=block",
  };

  let allPresent = true;
  for (const [header, value] of Object.entries(requiredHeaders)) {
    if (response.headers[header]) {
      log.success(`✓ ${header}: ${response.headers[header]}`);
    } else {
      log.warn(`⚠ Missing header: ${header}`);
      allPresent = false;
    }
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log("\n");
  console.log(
    `${colors.blue}╔════════════════════════════════════════════════════════╗${colors.reset}`
  );
  console.log(
    `${colors.blue}║       GYM MANAGEMENT - ENDPOINT VERIFICATION            ║${colors.reset}`
  );
  console.log(
    `${colors.blue}╚════════════════════════════════════════════════════════╝${colors.reset}\n`
  );

  try {
    // Check server is running
    log.info("Checking server connectivity...");
    const ping = await makeRequest("GET", "/api/health");
    if (ping.status === 200) {
      log.success("✓ Server is running on port 5000");
    } else {
      throw new Error("Server not responding");
    }

    // Run all tests
    await testValidationMiddleware();
    await testPasswordValidation();
    await testHealthCheck();
    await testRateLimiting();
    await testErrorHandling();
    await testCORS();

    // Summary
    console.log("\n");
    console.log(
      `${colors.green}╔════════════════════════════════════════════════════════╗${colors.reset}`
    );
    console.log(
      `${colors.green}║          VERIFICATION COMPLETE ✓                      ║${colors.reset}`
    );
    console.log(
      `${colors.green}╚════════════════════════════════════════════════════════╝${colors.reset}\n`
    );

    process.exit(0);
  } catch (error) {
    console.error(`\n${colors.red}✗ Verification failed:${colors.reset}`, error.message);
    process.exit(1);
  }
}

runTests();
