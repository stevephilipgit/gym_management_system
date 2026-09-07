export const THEME_STORAGE_KEY = "giri-gym-theme";

export const DENSITY_STORAGE_KEY_PREFIX = "giri-gym-ui-density:";
export const DENSITY_VERSION_KEY_PREFIX = "giri-gym-ui-density-version:";

export const DENSITY_LEVELS = {
  TINY: 0,
  MINI: 1,
  COMPACT: 2,
  MEDIUM: 3,
  SPACIOUS: 4,
};

export const DENSITY_SCHEMA_VERSION = 2;

export const DENSITY_LABELS = ["Tiny", "Mini", "Compact", "Medium", "Spacious"];
export const DENSITY_HINTS = [
  "Maximum information density",
  "Very dense, still comfortable",
  "Compact everyday working density",
  "Balanced (default)",
  "More breathing room",
];

const clampDensity = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return DENSITY_LEVELS.MEDIUM;
  if (n < DENSITY_LEVELS.TINY) return DENSITY_LEVELS.TINY;
  if (n > DENSITY_LEVELS.SPACIOUS) return DENSITY_LEVELS.SPACIOUS;
  return Math.round(n);
};

export const normalizeDensity = clampDensity;

export const LEGACY_DENSITY_MAP = {
  0: DENSITY_LEVELS.COMPACT,
  1: DENSITY_LEVELS.MEDIUM,
  2: DENSITY_LEVELS.SPACIOUS,
};

export const migrateLegacyDensity = (legacyValue) => {
  const n = Number(legacyValue);
  if (Object.hasOwn(LEGACY_DENSITY_MAP, n)) {
    return LEGACY_DENSITY_MAP[n];
  }
  return null;
};

export function getStoredTheme() {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "dark";
}

export function applyTheme(theme) {
  if (typeof document === "undefined") return;
  const resolvedTheme = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", resolvedTheme);
  window.localStorage.setItem(THEME_STORAGE_KEY, resolvedTheme);
}

export function initializeTheme() {
  applyTheme(getStoredTheme());
}

export function toggleTheme() {
  const nextTheme = getStoredTheme() === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  return nextTheme;
}

// Apply UI density to the document and optionally persist per-user.
// `value` is normalized to 0-4. `adminId` (when provided) is used to
// namespace the localStorage key so per-user isolation is preserved.
// Writes both the value and schema version so old values can be distinguished
// from new ones on read.
export function applyDensity(value, adminId) {
  if (typeof document === "undefined") return DENSITY_LEVELS.MEDIUM;
  const resolved = clampDensity(value);
  document.documentElement.setAttribute("data-density", String(resolved));
  if (adminId && typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(
        `${DENSITY_STORAGE_KEY_PREFIX}${adminId}`,
        String(resolved),
      );
      window.localStorage.setItem(
        `${DENSITY_VERSION_KEY_PREFIX}${adminId}`,
        String(DENSITY_SCHEMA_VERSION),
      );
    } catch {
      // Non-fatal: storage may be unavailable (private mode, quota); the
      // session still uses the in-memory value via the data-density attribute.
    }
  }
  return resolved;
}

// Read the namespaced density for a given admin. Returns Medium when the
// value is missing or invalid so the UI has a safe default.
// Uses schema version to distinguish old (v1: 0/1/2 = Compact/Medium/Spacious)
// from new (v2: 0/1/2/3/4 = Tiny/Mini/Compact/Medium/Spacious). Only migrates
// when the stored version is below v2.
export function getStoredDensity(adminId) {
  if (!adminId || typeof window === "undefined") return DENSITY_LEVELS.MEDIUM;
  try {
    const raw = window.localStorage.getItem(
      `${DENSITY_STORAGE_KEY_PREFIX}${adminId}`,
    );
    const versionRaw = window.localStorage.getItem(
      `${DENSITY_VERSION_KEY_PREFIX}${adminId}`,
    );
    const version = Number(versionRaw);
    const numericRaw = Number(raw);

    if (!Number.isFinite(numericRaw)) return DENSITY_LEVELS.MEDIUM;

    // If schema version is v2 or higher, treat values 0-4 as the new schema.
    if (Number.isFinite(version) && version >= DENSITY_SCHEMA_VERSION) {
      return clampDensity(numericRaw);
    }

    // Schema v1 (or no version) — migrate legacy 0/1/2 values.
    // Values 3-4 are impossible in v1, so they pass through unchanged
    // (handles edge case of manually set future values).
    if (numericRaw <= 2) {
      const migrated = migrateLegacyDensity(numericRaw);
      if (migrated !== null) return migrated;
    }

    return clampDensity(numericRaw);
  } catch {
    return DENSITY_LEVELS.MEDIUM;
  }
}
