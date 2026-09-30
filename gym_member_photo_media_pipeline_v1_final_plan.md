# Gym Member Photo Media Pipeline — V1 Final Implementation Plan

## Status

**Architecture:** LOCKED for V1  
**Implementation mode:** Audit existing codebase first, then implement incrementally  
**Primary goal:** Replace the existing member-photo handling with a production-grade, scalable media pipeline without breaking existing gym functionality.

---

# 1. V1 Scope and Non-Goals

## In scope

- Member passport/profile photos only.
- Client-side image resize/compression.
- Direct browser/client upload to Cloudflare R2 using presigned upload URLs.
- Private R2 bucket.
- Cloudflare Worker-based edge authorization for photo delivery.
- Browser and CDN/edge caching.
- Versioned photo object keys.
- MongoDB reference to the active photo object.
- Kiosk/admin photo display.
- Device authorization/revocation integration where the existing application already supports or can safely support it.
- Orphan-upload cleanup.
- Old-photo retention and delayed cleanup.
- Graceful image failure handling.
- Multi-tenant-safe data modeling.
- Production-level validation, testing, logging, and error handling.

## Explicitly out of scope for V1

- Offline-first kiosk attendance.
- Local attendance write buffering.
- IndexedDB-based offline synchronization.
- Offline cryptographic check-in signing.
- Attendance-system rewrite.
- Existing dummy-image migration.
- Vepery-specific branch migration.
- Building a new branch architecture unrelated to the existing multi-tenant model.
- Preloading every member photo onto every kiosk.
- Streaming/proxying images through the application backend.

If offline support becomes necessary later, it should be a separate Phase 2 architecture. The media pipeline should not depend on offline functionality.

---

# 2. Important Vepery Decision

The application is already intended to be **multi-tenant**.

`Mathur/Vepery` values currently found in settings/enquiry must therefore **not** be interpreted as the application's branch architecture.

Treat Vepery as legacy/obsolete configuration.

Implementation rules:

- Remove Vepery from active settings/enquiry options if it is no longer required.
- Do not build media architecture around Vepery.
- Do not migrate existing records based on Vepery.
- Do not create Vepery-specific conditionals in the new photo system.
- Do not use Vepery as a special-case tenant or branch identifier.
- If Vepery reopens in the future, it should be introduced as a normal tenant/branch through the application's existing multi-tenant model.

---

# 3. Existing Dummy Images — No Migration

Current images are dummy/test images.

Therefore:

**No `/uploads → R2` migration is required.**

Do not create:

- migration scripts,
- migration verification tooling,
- migration rollback tooling,
- bulk image-copy jobs,
- historical image transformation jobs.

Instead:

```text
Existing dummy images
        ↓
Not migrated
        ↓
New member photo upload
        ↓
Client compression
        ↓
R2
        ↓
New versioned photo URL
```

The existing dummy `/uploads` implementation may be removed or deprecated **only after the code audit confirms that no active feature still depends on it**.

Do not blindly delete legacy image code.

---

# 4. Target Architecture

```text
                         GYM APPLICATION
                               │
              ┌────────────────┴────────────────┐
              │                                 │
       EXISTING BUSINESS                  MEDIA PIPELINE
          SYSTEMS                              │
              │                                │
       ┌──────┼──────┐                         ▼
       │      │      │                    Cloudflare R2
    Members Attendance Kiosk                    │
       │      │      │                    Private Bucket
       │      │      │                         │
       └──────┼──────┘                         ▼
              │                         Cloudflare Worker
              │                                │
              └───────────────►        Edge Authorization
                                               │
                                               ▼
                                          CDN / Edge Cache
                                               │
                                      ┌────────┴────────┐
                                      │                 │
                                   Kiosk             Admin
                                  Browser           Browser
```

The existing application remains responsible for:

- authentication,
- authorization,
- member records,
- attendance,
- tenant/branch context,
- device management,
- business rules.

The media layer is responsible for:

- image upload,
- image storage,
- image authorization,
- image delivery,
- caching,
- media lifecycle.

Keep these responsibilities separated.

---

# 5. WRITE PATH

Writes are intentionally low volume.

A write happens primarily when:

- a new member registers,
- an admin/trainer changes a member's photo.

```text
Trainer / Admin
      ↓
Backend API
      ↓
Presigned R2 upload URL
      ↓
Browser
      ↓
Resize + crop + compress
      ↓
300×300 WebP/JPEG
      ↓
Direct upload to R2
      ↓
Backend receives uploaded object key
      ↓
MongoDB stores active photo key
```

## Critical rule

The backend must **not proxy the image binary**.

The backend only:

1. authorizes the upload,
2. creates the presigned upload URL,
3. validates metadata/constraints,
4. receives the resulting object key,
5. updates the member record.

---

# 6. Client-Side Image Processing

Before upload:

- Correct EXIF orientation.
- Crop appropriately for passport/profile display.
- Resize to approximately `300 × 300`.
- Prefer WebP.
- Provide JPEG fallback where required.
- Target a small file size.
- Enforce a hard maximum upload size.

Recommended V1 maximum:

```text
300 KB
```

The implementation must feature-detect WebP rather than assuming every webview/device supports it.

The processing utility should be reusable and isolated from member/business logic.

Do not duplicate image-processing code across:

- member registration,
- member edit,
- admin profile,
- kiosk,
- other screens.

Create one well-defined media utility/module.

---

# 7. Presigned Upload

The backend generates a short-lived presigned upload URL.

The upload object should use a versioned key.

Example:

```text
members/{memberId}/photo-{version-or-unique-id}.webp
```

Do not overwrite the same object key for every photo update.

This is important because immutable URLs make aggressive caching safe.

## Upload constraints

The backend should enforce/validate:

- allowed content type:
  - `image/webp`
  - `image/jpeg`
- maximum content size:
  - `300 KB`
- authorized member/tenant context
- upload expiration
- object-key ownership
- authenticated uploader
- appropriate tenant/branch scope

Do not trust the client merely because it says the file is an image.

Where the storage/provider API cannot enforce every constraint directly on a presigned PUT, the implementation must compensate with server-side verification or post-upload validation.

---

# 8. MongoDB Reference

The member record should reference the current active media object.

Example:

```json
{
  "profile_photo_key": "members/247/photo-unique-version.webp"
}
```

Do not store image binaries in MongoDB.

Do not store permanent presigned URLs in MongoDB.

Store the stable object identity/key and generate an appropriate delivery URL when needed.

The media reference should remain independent from UI components.

---

# 9. READ PATH

Reads are high volume.

When a member checks in:

```text
Kiosk
  ↓
Attendance API
  ↓
Member + latest photo URL/key
  ↓
Browser requests image
  ↓
Browser cache?
  ├── YES → render immediately
  │
  └── NO
       ↓
  Cloudflare Worker
       ↓
  Validate media/device authorization
       ↓
  CDN / Edge Cache
       ↓
  Private R2 on cache miss
       ↓
  Return image
       ↓
  Cache at edge + browser
```

## Critical separation

The attendance API must **never stream the image through the application backend**.

The API can return:

```json
{
  "member": {},
  "photoUrl": "https://cdn.example.com/members/247/photo-version.webp"
}
```

The browser then retrieves the image directly.

---

# 10. Browser Cache Behavior

Each kiosk/device has its own browser cache.

Example:

```text
Tablet 1
Member A → cached
Member B → cached
Member C → cached

Tablet 2
Member A → not cached
        ↓
CDN/R2
        ↓
cached on Tablet 2
```

There is no requirement to preload all members.

If 100 members visit Tablet 1 today, their images may become cached on Tablet 1.

Tomorrow:

- previously cached members may load immediately;
- uncached members cause a network request;
- new members are fetched and then cached.

Browser cache is limited and managed by the browser. Old/less-used entries can be evicted automatically.

The system must therefore always work correctly on a cache miss.

**Cache is an optimization, never a source of truth.**

---

# 11. CDN / Edge Caching

Photos use immutable, versioned URLs.

Example:

```text
/members/247/photo-v1.webp
/members/247/photo-v2.webp
```

Recommended cache policy:

```http
Cache-Control: public, max-age=31536000, immutable
```

Because the object key changes when the photo changes, long-lived caching does not cause stale-photo problems for the active URL.

The Worker/CDN layer should be designed so that repeated reads do not require application-server image streaming.

---

# 12. Private Photo Security

Member photos are considered internal/private assets.

Use:

```text
Private R2 Bucket
        ↓
Cloudflare Worker
        ↓
Authorization
        ↓
Photo delivery
```

Do not rely on an obscure/unguessable URL as the primary security boundary.

Do not expose the R2 bucket publicly.

## Device authorization

Approved kiosk devices should have an authenticated identity.

The media authorization mechanism should support:

- device identity,
- tenant/branch scope,
- expiration,
- revocation.

Short-lived edge authorization tokens are preferred over permanent unrestricted media credentials.

Avoid designing a system where revocation requires changing every image URL.

---

# 13. Device Revocation

Admins should be able to revoke an approved kiosk/device.

After revocation:

- the device cannot perform new authorized application actions;
- it cannot obtain fresh authorized media access;
- future attendance requests should fail authorization.

Important reality:

Revoking a device cannot physically erase files that the browser has already cached locally.

Therefore:

**Revocation prevents future access; it is not a remote disk-wipe mechanism.**

Do not claim that device revocation deletes browser cache.

---

# 14. New Device Behavior

A newly approved kiosk/device does **not** automatically download every member image.

Instead:

```text
New Device
    ↓
Authenticate / authorize
    ↓
First member check-in
    ↓
Latest photo URL
    ↓
Cache miss
    ↓
Cloudflare Worker
    ↓
R2
    ↓
Image cached on that device
```

The new device progressively builds its own cache as it is used.

---

# 15. Photo Updates

When a member changes their photo:

```text
Old:
members/247/photo-v1.webp

New:
members/247/photo-v2.webp
```

MongoDB changes to the new active key.

Do not immediately destroy the previous object.

Recommended V1 retention:

```text
14 days
```

Then background cleanup removes the old object.

This reduces the risk of transient failures on devices that have not yet received the latest member state.

---

# 16. Orphan Upload Cleanup

An upload can succeed while the subsequent MongoDB update fails.

Example:

```text
R2 upload succeeds
       ↓
Browser closes / API request fails
       ↓
MongoDB never references object
       ↓
Orphan object
```

Do not leave these objects indefinitely.

Implement asynchronous cleanup:

```text
Scheduled job
     ↓
Find old unreferenced objects
     ↓
Check against active MongoDB media references
     ↓
Delete objects older than safety window
```

Use a safety window of at least:

```text
24 hours
```

Do not delete an object immediately just because it is temporarily unreferenced.

---

# 17. Image Failure Handling

Kiosks/admin dashboards must never display a broken image state unnecessarily.

Provide a default avatar/fallback.

Example concept:

```jsx
<img
  src={member.photoUrl}
  onError={handleImageError}
  alt={member.name}
/>
```

The fallback logic should be centralized/reusable where practical.

Avoid putting complex media recovery logic directly into every UI component.

---

# 18. Cache and Photo Update Race Conditions

Example:

```text
Device A → old member state → photo-v1
Device B → member updated → photo-v2
```

The application must ensure that the attendance response uses the latest authoritative member photo reference.

The attendance/check-in response may include the latest photo URL.

Do not use browser cache as the authority for which photo is current.

The authoritative source remains:

```text
MongoDB member record
```

The cache only stores the bytes associated with a specific immutable URL.

---

# 19. Multi-Tenant Requirements

The application is multi-tenant.

The media system must never assume a global member namespace.

Object keys and authorization should respect tenant context.

Conceptually:

```text
tenants/{tenantId}/members/{memberId}/photo-{version}.webp
```

or an equivalent safe structure consistent with the existing application's data model.

Before implementing this structure, inspect the existing tenant/member identifiers and conventions.

Do not invent a second tenant system.

Do not introduce branch-specific special cases.

The agent must follow the existing application's authoritative tenant isolation model.

---

# 20. Offline Kiosk Decision

V1 is **online-only**.

If internet connectivity is lost:

```text
Kiosk
  ↓
Connectivity failure
  ↓
"Connectivity lost — Please see reception"
```

Do not implement:

- offline attendance writes,
- IndexedDB queues,
- local SQLite gateways,
- offline authentication,
- conflict reconciliation,
- cryptographic offline check-in signing.

These can be considered in a future phase if the business requires them.

---

# 21. Cost Model

R2 is not literally unlimited/free.

The design reduces storage and operations by:

1. compressing photos before upload;
2. avoiding backend media proxying;
3. using browser caching;
4. using edge caching;
5. using immutable versioned URLs;
6. cleaning orphaned/obsolete objects.

The architecture should not assume every image read reaches R2.

Conceptually:

```text
FIRST REQUEST

Kiosk
  ↓
Worker
  ↓
R2
  ↓
Edge cache


SUBSEQUENT REQUEST

Kiosk
  ↓
Browser cache
```

If browser cache misses but edge cache has the object:

```text
Kiosk
  ↓
Edge cache
```

R2 is primarily the origin/fallback.

---

# 22. Mandatory Existing-Code Audit Before Implementation

The coding agent must **not start by writing code**.

First inspect the existing codebase and produce an audit.

Identify:

### Member photo flow

- Where member photos are currently uploaded.
- Where they are resized/compressed.
- Where they are stored.
- How photo URLs are generated.
- How photos are returned from APIs.
- How photos are displayed.
- Existing image utilities/components.
- Existing upload abstractions.

### Backend

Identify:

- member APIs,
- upload APIs,
- storage utilities,
- authentication middleware,
- authorization middleware,
- tenant middleware,
- device/kiosk APIs,
- attendance APIs,
- background jobs,
- scheduled jobs,
- error handling,
- logging.

### Frontend

Identify:

- registration screens,
- member-edit screens,
- admin member views,
- kiosk attendance UI,
- reusable image components,
- upload components,
- API hooks,
- state management,
- caching libraries.

### Database

Identify:

- member schema,
- tenant schema,
- branch schema,
- device schema,
- attendance schema,
- existing photo fields,
- indexes,
- existing data relationships.

### Infrastructure

Identify:

- Cloudflare configuration,
- R2 configuration,
- environment variables,
- deployment platform,
- reverse proxy/CDN configuration,
- worker configuration,
- existing storage credentials,
- secrets handling.

### Legacy configuration

Search for:

```text
Vepery
Mathur
/uploads
profile photo
profile_photo
photoUrl
photo_url
avatar
image
member image
```

Determine which references are active and which are obsolete.

---

# 23. Required Audit Output Before Coding

The agent must produce:

## A. Current architecture

```text
Current Upload Flow:
...

Current Read Flow:
...

Current Storage:
...

Current Photo Database Reference:
...

Current Kiosk Flow:
...
```

## B. Impacted files

Provide an explicit list:

```text
Files to modify:
1. ...
2. ...

Files to create:
1. ...
2. ...

Files potentially removable:
1. ...

Files that must remain untouched:
1. ...
```

## C. Dependency map

Show:

```text
Upload UI
   ↓
API
   ↓
Storage
   ↓
MongoDB
```

and:

```text
Attendance
   ↓
Member lookup
   ↓
Photo URL
   ↓
Kiosk UI
```

Identify upstream and downstream consumers.

## D. Risk report

Identify:

- breaking changes,
- hidden dependencies,
- shared utilities,
- authentication assumptions,
- tenant isolation risks,
- API compatibility risks,
- test gaps,
- deployment dependencies.

**Do not implement until this audit is complete.**

---

# 24. Implementation Strategy

Implement incrementally.

Recommended sequence:

### Phase 0 — Audit

No code changes.

### Phase 1 — Shared media foundation

Implement isolated:

- image processing utility,
- storage abstraction,
- media key generation,
- upload validation,
- media types/interfaces.

### Phase 2 — R2 upload

Implement:

- presigned upload endpoint,
- authorization,
- validation,
- direct upload flow.

### Phase 3 — Member integration

Connect the new media system to member registration/update.

### Phase 4 — Secure media delivery

Implement:

- Cloudflare Worker,
- private R2 origin,
- device/tenant authorization,
- cache headers.

### Phase 5 — Kiosk/admin read integration

Update consumers to use the new media URL.

### Phase 6 — Cleanup

After proving all consumers use the new system:

- remove/deprecate obsolete upload logic,
- remove obsolete `/uploads` references,
- remove Vepery from active settings/enquiry where appropriate.

### Phase 7 — Lifecycle jobs

Implement:

- orphan cleanup,
- old-photo cleanup.

### Phase 8 — Testing and production validation

Run:

- unit tests,
- integration tests,
- API tests,
- frontend tests,
- authorization tests,
- upload validation tests,
- cache behavior tests,
- regression tests.

---

# 25. Refactoring Rules

The coding agent must follow production-grade engineering principles.

## Do not rewrite everything

Prefer small, controlled changes.

## Do not duplicate logic

If media processing/storage logic already exists, evaluate whether it can be safely extracted/reused.

## Keep modules loosely coupled

Business logic should not directly know:

```text
R2 SDK details
Cloudflare Worker implementation
browser canvas internals
```

Use appropriate abstractions.

Example conceptual separation:

```text
Member Service
      ↓
Media Service
      ↓
Storage Adapter
      ↓
R2
```

The exact structure must follow the existing codebase rather than forcing a new framework unnecessarily.

## Dependency inversion

Application business logic should depend on media/storage interfaces rather than directly importing provider-specific implementation everywhere.

## Single responsibility

Keep separate responsibilities for:

- image processing,
- upload authorization,
- object-key generation,
- storage,
- database reference updates,
- media authorization,
- delivery,
- cleanup.

## Configuration

Cloudflare/R2 credentials and configuration must come from environment/configuration management.

Never hardcode secrets.

---

# 26. API Compatibility

Before changing an existing API:

1. Find every consumer.
2. Determine whether it is used by:
   - web frontend,
   - kiosk,
   - mobile/webview,
   - other services.
3. Preserve compatibility where practical.
4. If a breaking change is unavoidable, document it explicitly.

Do not silently rename or remove existing API fields.

---

# 27. Database Safety

No production data migration is required for dummy images.

However, if the schema itself must change:

- document the change;
- make it backward-compatible where possible;
- ensure existing member documents remain readable;
- provide a safe fallback for missing photo references;
- do not assume every member has a photo.

No destructive database operation should be performed automatically.

---

# 28. Testing Requirements

At minimum, test:

### Upload

- valid WebP;
- valid JPEG;
- oversized file;
- invalid MIME type;
- missing upload;
- expired presigned URL;
- unauthorized member;
- cross-tenant upload attempt.

### Photo processing

- normal image;
- portrait image;
- landscape image;
- EXIF-rotated image;
- WebP unsupported fallback;
- large source image;
- invalid/corrupt image.

### Read

- authorized device;
- revoked device;
- unauthorized tenant;
- missing image;
- R2 failure;
- Worker authorization failure;
- cache hit;
- cache miss.

### Updates

- photo v1 → v2;
- old URL remains temporarily valid;
- new URL returned by member API;
- old object eventually cleaned.

### Cleanup

- referenced object must not be deleted;
- recent orphan must not be deleted;
- old orphan may be deleted;
- old photo beyond retention window may be deleted.

### Regression

All existing relevant member, attendance, kiosk, and authentication tests must continue passing.

---

# 29. Performance Requirements

The implementation must avoid:

- image binaries through Express/Node;
- repeated image downloads from R2 when cache can serve them;
- synchronous cleanup during attendance;
- synchronous image transformation on the backend;
- loading every member image at kiosk startup;
- N+1 member/photo API calls where avoidable.

Target architecture:

```text
Attendance API
    ↓
small JSON response
    ↓
photo URL
    ↓
browser/CDN handles media
```

---

# 30. Error Handling

Every external boundary should have explicit failure handling.

Examples:

```text
R2 unavailable
→ upload fails cleanly
→ member record is not falsely updated
```

```text
MongoDB update fails after R2 upload
→ uploaded object becomes temporary orphan
→ cleanup job handles it
```

```text
Worker authorization fails
→ image denied
→ UI displays fallback avatar
```

```text
Internet unavailable
→ kiosk shows connectivity error
→ no false attendance confirmation
```

Never swallow errors silently.

Use structured logging appropriate to the existing application.

Do not log:

- image binaries,
- secrets,
- presigned URLs unnecessarily,
- device credentials,
- sensitive member information beyond what is required for diagnostics.

---

# 31. Security Requirements

The implementation must consider:

- tenant isolation;
- authorization before upload;
- authorization before media access;
- device revocation;
- short-lived credentials/tokens;
- private R2 bucket;
- strict MIME/size validation;
- object-key ownership;
- no client-controlled arbitrary storage paths;
- no hardcoded secrets;
- safe CORS configuration;
- no accidental public bucket exposure.

Do not treat CORS as an authentication mechanism.

---

# 32. Observability

Add appropriate operational visibility for:

- upload success/failure;
- image-processing failures;
- media authorization failures;
- Worker authorization failures;
- R2 errors;
- orphan cleanup results;
- old-photo cleanup results.

Use structured logs/metrics consistent with the existing project.

Avoid excessive logging on every successful image cache hit.

---

# 33. Deployment Strategy

Before production:

1. Verify R2 bucket configuration.
2. Verify private access.
3. Verify Worker routing.
4. Verify environment variables.
5. Verify presigned uploads.
6. Verify authorization.
7. Verify cache headers.
8. Verify kiosk behavior.
9. Verify fallback images.
10. Verify cleanup jobs.
11. Run regression tests.
12. Test rollback/deactivation of the new media path.

Do not deploy infrastructure changes without documenting required environment variables and deployment steps.

---

# 34. Rollback Philosophy

Even though dummy images do not require migration, implementation rollback must still be possible.

The agent should document:

- which application changes were made;
- which environment variables were added;
- which Cloudflare/R2 resources were added;
- how the new media path can be disabled;
- how the previous application behavior can be restored if required.

Do not delete legacy code immediately unless the audit proves it is unused and the rollback implications are understood.

---

# 35. Definition of Done

V1 is complete only when:

- [ ] Existing codebase audit completed.
- [ ] Impacted files documented.
- [ ] No hidden consumer identified for modified APIs.
- [ ] Client-side image processing implemented.
- [ ] EXIF orientation handled.
- [ ] WebP/JPEG fallback handled.
- [ ] 300×300 target implemented.
- [ ] 300 KB upload limit enforced.
- [ ] Presigned upload implemented.
- [ ] Direct browser → R2 upload works.
- [ ] Private R2 bucket configured.
- [ ] MongoDB stores active photo key.
- [ ] Versioned object keys implemented.
- [ ] Cloudflare Worker authorization implemented.
- [ ] Tenant/device authorization verified.
- [ ] Browser caching implemented.
- [ ] Edge caching implemented.
- [ ] Kiosk receives latest photo URL.
- [ ] No backend image streaming remains.
- [ ] Image fallback implemented.
- [ ] Orphan cleanup implemented.
- [ ] Old-photo retention implemented.
- [ ] Vepery removed from active settings/enquiry where appropriate.
- [ ] No Vepery-specific media logic exists.
- [ ] No dummy-image migration performed.
- [ ] Offline kiosk functionality not introduced.
- [ ] Existing relevant tests pass.
- [ ] New media tests pass.
- [ ] Security tests pass.
- [ ] Production configuration documented.

---

# 36. Final Instruction to the Coding Agent

You are modifying an **existing production-oriented application**, not creating a greenfield demo.

Your first responsibility is to understand the existing architecture.

**Do not immediately start coding.**

First audit the repository and report:

1. Current photo upload flow.
2. Current photo read/display flow.
3. Current storage mechanism.
4. Current MongoDB member schema.
5. Current kiosk/attendance integration.
6. Existing authentication/authorization.
7. Existing tenant/branch model.
8. Existing device model.
9. Existing `/uploads` dependencies.
10. All Vepery/Mathur references.
11. All files/modules affected by this architecture.
12. Potential regressions and hidden dependencies.
13. Missing infrastructure/configuration required for R2/Cloudflare.
14. Any architectural conflicts with the proposed design.
15. Any business decisions that still require confirmation.

Then produce a phased implementation plan.

**Do not write implementation code until the audit and plan are complete.**

When implementation begins:

- Follow the existing project's conventions.
- Reuse existing abstractions when appropriate.
- Avoid unnecessary rewrites.
- Keep modules loosely coupled.
- Keep provider-specific logic isolated.
- Do not introduce unnecessary dependencies.
- Do not duplicate existing functionality.
- Preserve existing APIs unless a change is explicitly required.
- Keep tenant isolation explicit.
- Keep the attendance system unchanged except where the photo URL must be integrated.
- Keep V1 online-only.
- Do not migrate dummy images.
- Do not create Vepery-specific architecture.
- Never hardcode credentials.
- Never expose private R2 storage directly.
- Never proxy image binaries through the application server.

Implement incrementally and test each phase before proceeding.

If you encounter:

- a bug,
- an unexpected dependency,
- an architectural contradiction,
- a security concern,
- an unclear business rule,
- an infrastructure limitation,
- a data-model conflict,
- an API compatibility issue,
- or any assumption that cannot be verified,

**do not silently guess and continue.**

Record it in a final:

# Blockers / Questions / Risks Report

with:

```text
Issue:
Evidence:
Impact:
Current behavior:
Expected behavior:
Recommended solution:
Decision required:
```

At the end, provide:

1. **Audit findings**
2. **Files changed**
3. **Files created**
4. **Files removed/deprecated**
5. **Architecture implemented**
6. **Tests executed and results**
7. **Security validation**
8. **Performance considerations**
9. **Deployment/configuration requirements**
10. **Remaining bugs**
11. **Blockers**
12. **Business questions**
13. **Recommended follow-up work**

Do not claim the migration/refactor is complete if any critical blocker remains unresolved.

The objective is not merely to make the feature work.

The objective is to make the V1 implementation **correct, secure, maintainable, testable, scalable, loosely coupled, and safe to operate in production**.
