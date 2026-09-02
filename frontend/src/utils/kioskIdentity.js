// utils/kioskIdentity.js - Kiosk device identity (persists across page refresh)
//
// Two distinct identities live here:
//
// 1. DEVICE CREDENTIAL (gym_kiosk_id / gym_kiosk_key)
//    The credential issued when a Trainer activates a device via the direct
//    activation flow (redeem). Sent as X-Kiosk-Id / X-Kiosk-Key by
//    kioskApiClient. Survives refresh/restart so the customer page keeps
//    working. It is an opaque bearer credential — NOT shown in any UI and NOT
//    hardware attestation.
//
// 2. BROWSER DEVICE ID (gym_browser_device_id)
//    A stable, random identifier for THIS browser/device instance. Generated
//    once on first use and persisted. It is the physical-device key for
//    DeviceRegistration (kioskId = browserDeviceId). It is NOT a credential
//    and NOT hardware attestation — if localStorage is cleared, a new one is
//    generated and the Trainer must re-activate.
//
// localStorage is used because the kiosk is a shared device whose screen is
// always on / reloads. Neither value is an admin credential.

const KIOSK_ID_KEY = "gym_kiosk_id";
const KIOSK_KEY_KEY = "gym_kiosk_key";
const BROWSER_DEVICE_ID_KEY = "gym_browser_device_id";

export const getKioskIdentity = () => ({
  kioskId: localStorage.getItem(KIOSK_ID_KEY) || null,
  key: localStorage.getItem(KIOSK_KEY_KEY) || null,
});

export const getKioskId = () => localStorage.getItem(KIOSK_ID_KEY) || null;
export const getKioskKey = () => localStorage.getItem(KIOSK_KEY_KEY) || null;

export const setKioskIdentity = (kioskId, key) => {
  if (kioskId) localStorage.setItem(KIOSK_ID_KEY, String(kioskId));
  if (key) localStorage.setItem(KIOSK_KEY_KEY, String(key));
};

export const clearKioskIdentity = () => {
  localStorage.removeItem(KIOSK_ID_KEY);
  localStorage.removeItem(KIOSK_KEY_KEY);
};

export const isKioskConfigured = () =>
  !!localStorage.getItem(KIOSK_ID_KEY) && !!localStorage.getItem(KIOSK_KEY_KEY);

/**
 * Return the stable browser/device id for this browser instance, generating and
 * persisting one on first use. It is the physical-device key for the device
 * registration (kioskId = browserDeviceId). NOT a credential.
 */
export const getOrCreateBrowserDeviceId = () => {
  let id = localStorage.getItem(BROWSER_DEVICE_ID_KEY);
  if (!id) {
    // crypto.randomUUID needs a secure context; getRandomValues also requires
    // one. Fall back to a timestamp + Math.random hex so it works on plain http
    // kiosk devices too. This is a dedup key, not a security credential.
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      id = crypto.randomUUID();
    } else if (
      typeof crypto !== "undefined" &&
      typeof crypto.getRandomValues === "function"
    ) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      id = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } else {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    }
    localStorage.setItem(BROWSER_DEVICE_ID_KEY, id);
  }
  return id;
};