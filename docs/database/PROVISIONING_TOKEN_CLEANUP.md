# ProvisioningToken Collection — Operator Cleanup Procedure

## Background

The `provisioningtokens` collection was used by the **old provisioning/request/claim** architecture (Phase 4C / pre-refactor). The provisioning service, models, routes, controllers, and UI have all been removed. **No code references this collection.**

The collection is an orphaned artifact. It is safe to drop, but the operation must be explicit and operator-controlled.

## Current State Inspection *(run against the production database `giri_gym`)*

```bash
# Connect to the production database
mongosh "$DATABASE_URL"

# Count documents
db.provisioningtokens.countDocuments();

# Count by state
db.provisioningtokens.countDocuments({ usedAt: { $ne: null } });   # used
db.provisioningtokens.countDocuments({ usedAt: null, revokedAt: null });  # active (unused)
db.provisioningtokens.countDocuments({ revokedAt: { $ne: null } });  # revoked

# List indexes
db.provisioningtokens.getIndexes();

# Sample one document (fields only, no secrets)
db.provisioningtokens.findOne({}, { tokenId: 1, kioskId: 1, usedAt: 1, revokedAt: 1, createdAt: 1 });
```

## Backup Recommendation

Before any destructive operation, export the collection:

```bash
mongodump --uri="$DATABASE_URL" --collection=provisioningtokens --out=/tmp/provisioning_backup_$(date +%Y%m%d)
```

## Cleanup Command

```bash
# Drop the entire collection (safe — no code references it)
mongosh "$DATABASE_URL" --eval 'db.provisioningtokens.drop()'
```

## Post-Cleanup Verification

```bash
# Verify collection no longer exists
mongosh "$DATABASE_URL" --eval 'db.getCollectionNames().filter(n => n === "provisioningtokens").length'
# Expected: 0
```

## Safety Notes

- Do **NOT** automate this in application startup code.
- The collection is **not referenced** by any remaining service, controller, route, model, or test.
- The model file (`models/ProvisioningToken.js`) was deleted in Phase 4.
- The indexes (`idx_provtok_*`) are defined only in the deleted `utils/dbIndexes.js` block.
- **No data loss**: the provisioning tokens were one-time use; any unused tokens are stale and cannot be redeemed (the redeem endpoint was deleted).