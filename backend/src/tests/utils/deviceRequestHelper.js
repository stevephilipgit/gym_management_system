// test-utils/deviceRequestHelper.js - Shared helper for direct activation flow
//
// Creates an active DeviceRegistration via the Super-Admin-generated code +
// trainer password confirmation, matching the production direct-activation
// architecture.
//
// Usage in tests:
//   await setTrainerPassword({ trainerId, plaintext: "TestPass123!" });
//   const { registration, apiKey } = await makeActive({ browserDeviceId, trainerId });

import crypto from "crypto";
import bcrypt from "bcryptjs";
import Admin from "../../models/Admin.js";
import {
  generateActivation,
  redeemActivation,
} from "../../services/deviceActivationService.js";

export const makeBrowserId = () => `browser-${crypto.randomUUID()}`;

/**
 * Create an active DeviceRegistration via direct activation.
 * The trainer MUST have had its password set via setTrainerPassword() first
 * (or set some other known plaintext). Returns `{ registration, apiKey }`.
 *
 * If `password` is supplied it overrides any stored plaintext.
 */
export async function makeActive({ browserDeviceId, trainerId, password }) {
  const generated = await generateActivation({
    trainerId,
    createdBy: trainerId,
  });
  let testPassword = password;
  if (!testPassword) {
    const trainer = await Admin.findById(trainerId).lean();
    testPassword = trainer?.testPlaintextPassword || "TestPass123!";
  }
  const redeemed = await redeemActivation({
    trainerId,
    browserDeviceId,
    code: generated.code,
    password: testPassword,
  });
  const registration = {
    registrationId: redeemed.registration.registrationId,
    kioskId: redeemed.registration.kioskId,
    trainerId: redeemed.registration.trainerId,
    browserDeviceId,
    active: redeemed.registration.active,
    activatedAt: redeemed.registration.activatedAt,
  };
  return { registration, apiKey: redeemed.apiKey };
}

/**
 * Set a known plaintext password for the trainer (so direct-activation tests
 * can call `password` without re-hashing through the real auth flow).
 */
export async function setTrainerPassword({ trainerId, plaintext }) {
  const passwordHash = await bcrypt.hash(plaintext, 10);
  await Admin.updateOne(
    { _id: trainerId },
    { $set: { passwordHash, testPlaintextPassword: plaintext } }
  );
}