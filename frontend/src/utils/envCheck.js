const REQUIRED_ENV_VARS = ["VITE_API_URL", "VITE_SITE_URL"];

export const validateEnv = () => {
  const missing = REQUIRED_ENV_VARS.filter((key) => !import.meta.env[key]);

  if (missing.length === 0) {
    return;
  }

  const message = `Missing recommended env vars: ${missing.join(", ")}. Set them before production deployment.`;

  console.warn(message);
};
