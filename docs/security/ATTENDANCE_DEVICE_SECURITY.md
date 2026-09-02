# Attendance Device Security

## Threat Model / Trust Boundaries

| Boundary | What the attacker controls | What the server validates |
|---|---|---|
| Browser → frontend | code, QR secret, password, browserDeviceId, role/scope claims | none of these are trusted for identity/scope |
| frontend → HTTP | X-Session-Id, cookies, headers | session id, session-scoped cookie pair, JWT `sid == header sid` |
| auth middleware | forged JWT, replayed token | signature, issuer, audience, algorithm, admin DB row, tokenVersion |
| controller/service | trainerId, scope, kioskId, browserDeviceId, registrationId | `req.admin.id` only; ObjectId/whitelist validation |
| database | NoSQL operators ($ne/$gt/$in/$regex/$or/$where) | global `noSqlSanitizer` + whitelisted payloads |

## Verified Security Properties (Phase 4)

1. **No client-controlled ownership** — Trainer identity is always `req.admin.id`.
2. **No client-controlled scope** — scope derived from Trainer record; frozen on activation; Super Admin token scope validated server-side.
3. **Activation replay protection** — atomic conditional consume; deterministic 409.
4. **Activation expiry** — TTL (default 120s) checked before redeem.
5. **Password confirmation** — bcrypt compare, never logged.
6. **Brute-force protection** — dedicated redeem limiter (5/min default per IP+Trainer).
7. **INVARIANT A** — one active device per Trainer (DB partial unique index + transaction).
8. **INVARIANT B** — one active owner per browserDeviceId/Kiosk (DB partial unique index + transaction).
9. **Stale/revoked credential rejection** — kioskAuth checks registration active + credential valid + Kiosk enabled + scope.
10. **Trainer scope-change revocation** — scope change revokes active registrations + unused activations.
11. **Super Admin attendance token** — dedicated secret/issuer/audience/purpose; DB role re-check (never trusts role claim alone).
12. **No privilege escalation** — requireRole("superadmin") / requireRole("trainer") on routes.
13. **No sensitive secret leakage** — responses contain no hashes/keys/passwords/JWTs; hashes never returned.
14. **NoSQL/injection protections** — `noSqlSanitizer` + `hppProtection` + whitelisted validation.
15. **Female + Transgender Gym ID collision** — integrity_error, NO attendance write.
16. **No "All Genders" mode** — scope enum only male/female_plus_transgender.
17. **No JWT→kioskAuth bypass** — kioskAuth requires device credential; Super Admin path is separate.
18. **Bearer credential limitation** — `gym_kiosk_id`/`gym_kiosk_key` are opaque bearer credentials, NOT hardware attestation; replayable if copied; mitigated by random 256-bit key, single-active-device invariant, revoke/disable.

## Transaction Requirement

The device switch (consume → deactivate-old → create-new → Kiosk resolve → counters) must run inside a Mongo transaction. Standalone Mongo (no transactions) is BLOCKED (503); a non-atomic fallback is never executed. Production must use a replica set.