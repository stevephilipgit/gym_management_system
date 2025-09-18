export const THEME_STORAGE_KEY = "giri-gym-theme";

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
