# Device Lifecycle

## DeviceActivation (intent, not bound to a physical device)

```
CREATED (usedAt=null, revokedAt=null)
  → REDEEMED (usedAt set, usedByMethod set — terminal)
  → REVOKED  (revokedAt set — superseded by a newer activation — terminal)
  → EXPIRED  (expiresAt < now at read — terminal)
```

Exactly one transition to REDEEMED ever. QR secret and 6-digit code are alternate methods for the SAME activation; whichever succeeds first consumes the lifecycle.

## DeviceRegistration (physical device credential authority)

```
ACTIVE (active=true, carries apiKeyHash)
  → DEACTIVATED (active=false, deactivatedAt, credential unset — terminal)
  → REVOKED     (active=false, revokedAt, credential unset — terminal)
```

Only fresh activation via a new DeviceActivation can create a new active registration. Terminal states are never re-activated.

## Kiosk (physical device context, auto-created per browser)

```
ABSENT (no Kiosk document)
  → ACTIVE (kioskId=browserDeviceId, scope from activation, enabled=true)
  → DISABLED (Super Admin sets enabled=false)

ACTIVE Kiosk can be reused by subsequent activations if:
  - enabled=true
  - scope matches activation scope
  - no other Trainer owns it (INVARIANT B)
```

Trainer activation **never** re-enables a disabled Kiosk and **never** overwrites scope.