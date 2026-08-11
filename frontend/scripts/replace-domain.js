/**
 * replace-domain.js
 * Post-build script: replaces __SITE_URL__ placeholder in dist/ files
 * with the value of VITE_SITE_URL from the environment or .env file.
 *
 * Usage: node scripts/replace-domain.js
 * Called automatically by `npm run build` (postbuild).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = resolve(ROOT, "dist");
const PLACEHOLDER = "__SITE_URL__";

// Read VITE_SITE_URL from .env or environment
function getSiteUrl() {
  if (process.env.VITE_SITE_URL) return process.env.VITE_SITE_URL;

  const envPath = resolve(ROOT, ".env");
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    const match = content.match(/^VITE_SITE_URL=(.+)$/m);
    if (match) {
      const val = match[1].trim();
      if (val) return val;
    }
  }

  return "";
}

const siteUrl = getSiteUrl();

if (!siteUrl) {
  console.warn(
    "[replace-domain] VITE_SITE_URL is not set. " +
    "sitemap.xml and robots.txt will contain the __SITE_URL__ placeholder. " +
    "Set VITE_SITE_URL in frontend/.env or as an environment variable before building."
  );
  process.exit(0);
}

// Strip trailing slash
const normalized = siteUrl.replace(/\/+$/, "");

const targets = [
  resolve(DIST, "index.html"),
  resolve(DIST, "sitemap.xml"),
  resolve(DIST, "robots.txt"),
];

let replaced = 0;

for (const file of targets) {
  if (!existsSync(file)) continue;
  let content = readFileSync(file, "utf-8");
  if (content.includes(PLACEHOLDER)) {
    content = content.split(PLACEHOLDER).join(normalized);
    writeFileSync(file, content, "utf-8");
    replaced++;
    console.log(`[replace-domain] Replaced placeholder in ${file}`);
  }
}

if (replaced === 0) {
  console.log("[replace-domain] No placeholder found in dist/ files.");
} else {
  console.log(`[replace-domain] Done. Replaced in ${replaced} file(s).`);
}
