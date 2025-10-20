# Developer Quick Reference

**Gym Management System - Architecture & Patterns**

---

## Project Structure

```
backend/
├── src/
│   ├── core/
│   │   ├── config.js          # ✅ Centralized env + DB/Redis config
│   │   ├── logger.js          # ✅ Winston logging
│   │   ├── errorHandler.js    # ✅ Custom errors + middleware
│   │   └── constants.js       # ✅ Application constants
│   │
│   ├── controllers/           # ✅ Business orchestration (10 files)
│   │   ├── authController.js
│   │   ├── memberController.js
│   │   ├── paymentController.js
│   │   └── ...
│   │
│   ├── routes/               # ✅ Express endpoints (11 files)
│   │   ├── adminRoutes.js
│   │   ├── memberRoutes.js
│   │   └── ...
│   │
│   ├── services/             # ✅ Business logic
│   │   ├── analyticsService.js
│   │   ├── summaryService.js
│   │   └── ...
│   │
│   ├── repositories/         # ✅ Data abstraction (4 files)
│   │   ├── memberRepository.js
│   │   ├── paymentRepository.js
│   │   └── ...
│   │
│   ├── schemas/              # ✅ Joi validation (6 files)
│   │   ├── memberSchema.js
│   │   ├── authSchema.js
│   │   └── ...
│   │
│   ├── middleware/           # ✅ Express middleware
│   │   ├── adminAuth.js
│   │   ├── schemaValidator.js
│   │   ├── rateLimiter.js
│   │   └── ...
│   │
│   ├── models/               # ✅ Mongoose schemas
│   │   ├── Member.js
│   │   ├── Admin.js
│   │   └── ...
│   │
│   └── utils/                # ✅ Helpers
│       ├── auditLog.js
│       ├── pdfGenerator.js
│       └── ...
│
├── logs/                     # 📁 Generated log files
├── uploads/                  # 📁 User uploads
├── package.json
├── server.js
└── verify-endpoints.js       # 🧪 Endpoint verification

frontend/                      # React + Vite app
```

---

## Key Patterns

### 1. Adding a New Endpoint

**Step 1: Create validation schema** (`schemas/newSchema.js`)
```javascript
import Joi from "joi";

export const newActionSchema = Joi.object({
  field1: Joi.string().min(3).required(),
  field2: Joi.number().positive().required(),
});
```

**Step 2: Create controller method** (`controllers/newController.js`)
```javascript
import { asyncHandler, ValidationError } from "../core/errorHandler.js";
import { auditActions } from "../utils/auditLog.js";

export const newController = {
  newAction: asyncHandler(async (req, res) => {
    const { field1, field2 } = req.validatedBody; // Already validated!
    
    // Business logic here
    const result = await doSomething(field1, field2);
    
    // Audit log if needed
    await auditActions.someAction(req, result.id, { field1, field2 });
    
    return res.json({ success: true, data: result });
  }),
};
```

**Step 3: Wire in route** (`routes/newRoutes.js`)
```javascript
import { validateSchema } from "../middleware/schemaValidator.js";
import { newActionSchema } from "../schemas/newSchema.js";
import newController from "../controllers/newController.js";

router.post(
  "/action",
  adminAuth,
  validateSchema(newActionSchema),  // ← Validation middleware
  newController.newAction
);
```

### 2. Error Handling

**Available Error Classes** (auto-caught by asyncHandler)
```javascript
import {
  ValidationError,    // 400
  AuthError,          // 401
  ForbiddenError,     // 403
  NotFoundError,      // 404
  ConflictError,      // 409
  RateLimitError,     // 429
} from "../core/errorHandler.js";

throw new ValidationError("Field required", [{ field: "email", message: "Invalid" }]);
throw new AuthError("Invalid credentials");
throw new NotFoundError("Member not found");
```

### 3. Logging

**Access the logger** 
```javascript
import logger from "../core/logger.js";

logger.info("Something happened", { metadata });
logger.error("Error occurred", error);
logger.warn("Warning message");
logger.debug("Debug info"); // Only if LOG_LEVEL=debug
```

**Per-request logging** (request ID automatically included)
```javascript
// In routes, req has child logger with request ID
const childLogger = req.logger; // Has requestId in all logs
childLogger.info("Request processing");
```

### 4. Database Queries (Repositories)

**Pattern:** Access MongoDB through repositories, NOT models directly in controllers
```javascript
// ✅ GOOD - Using repository
const member = await memberRepository.findById(id);

// ❌ BAD - Direct model access
const member = await Member.findById(id);
```

**Repository Methods**
```javascript
// Member repository
await memberRepository.findById(id);
await memberRepository.create(data);
await memberRepository.update(id, changes);
await memberRepository.delete(id);
await memberRepository.findExpiringMembers(days);
await memberRepository.search(query);
await memberRepository.getPaginated(page, pageSize, filters);
```

### 5. Audit Logging

**Built-in actions**
```javascript
import { auditActions } from "../utils/auditLog.js";

await auditActions.memberCreated(req, memberId, memberData);
await auditActions.memberDeleted(req, memberId);
await auditActions.adminLogin(req, adminId, true);
await auditActions.paymentCreated(req, paymentId, amount);
```

**Custom audit logs**
```javascript
import { auditLog } from "../utils/auditLog.js";

await auditLog(req, {
  action: "CUSTOM_ACTION",
  status: "SUCCESS",
  resourceType: "Member",
  resourceId: memberId,
  changes: { field: "value" },
});
```

### 6. Rate Limiting

**Pre-configured limiters**
```javascript
import { adminLimiter, sensitiveLimiter, otpLimiter } from "../middleware/rateLimiter.js";

// Global: 100 requests/min
router.use(adminLimiter);

// Sensitive: 30 requests/min
router.get("/sensitive", sensitiveLimiter, controller.method);

// OTP: 3 requests/min
router.post("/otp", otpLimiter, controller.method);
```

### 7. File Uploads

**Multer configuration** (already set up in routes)
```javascript
import multer from "multer";

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.match(/jpg|jpeg|png/i)) {
      return cb(new Error("Only images allowed"));
    }
    cb(null, true);
  },
});

router.post("/upload", upload.single("photo"), controller.method);
```

---

## Common Tasks

### Test a New Endpoint
```bash
# Terminal 1: Start server
npm start

# Terminal 2: Test endpoint
curl -X POST http://localhost:5000/api/members/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT" \
  -d '{"fullName":"John","phone":"9876543210",...}'

# Or run verification script
node verify-endpoints.js
```

### View Logs
```bash
# Real-time log streaming
tail -f logs/combined.log

# View errors only
cat logs/error.log | tail -50

# Search for specific action
grep "MEMBER_CREATE" logs/combined.log
```

### Database Queries
```javascript
// MongoDB shell
mongosh
use gym_db

// Recent audit logs
db.auditlogs.find().sort({ timestamp: -1 }).limit(10)

// Members joined today
db.members.find({ 
  createdAt: { $gte: new Date(new Date().setHours(0,0,0,0)) }
})

// Revenue metrics
db.financelogs.aggregate([
  { $match: { date: { $gte: new Date("2026-04-17") } } },
  { $group: { _id: "$type", total: { $sum: "$amount" } } }
])
```

### Check Environment Config
```javascript
// server.js or any file
import env from "./src/core/config.js";

console.log(env.MONGO_URI);
console.log(env.PORT);
console.log(env.NODE_ENV);
```

---

## Best Practices

### ✅ DO
- Use `asyncHandler` wrapper on all controller methods
- Validate input with Joi schemas before business logic
- Log important actions with `auditActions`
- Use repositories for all database access
- Throw custom errors instead of returning error responses
- Use constants for magic strings/numbers

### ❌ DON'T
- Access models directly from controllers
- Use `console.log` (use `logger` instead)
- Ignore validation errors
- Make synchronous operations in async functions
- Store secrets in code (use .env)
- Skip error handling in promises

---

## Debugging

### Enable Verbose Logging
```bash
LOG_LEVEL=debug npm start
```

### Inspect Request/Response
```javascript
router.post("/debug", (req, res, next) => {
  console.log("Body:", req.body);
  console.log("Headers:", req.headers);
  console.log("User:", req.admin);
  next();
});
```

### Test Database Connection
```bash
node -e "import('./src/core/config.js').then(m => m.connectDB().then(() => console.log('✓ Connected')))"
```

### Monitor Performance
```bash
npm install -g clinic
clinic doctor -- npm start
```

---

## Git Workflow

```bash
# Create feature branch
git checkout -b feature/new-endpoint

# Make changes, commit
git add .
git commit -m "feat: add new endpoint with validation"

# Run tests
npm run verify

# Check logs for errors
cat logs/error.log

# Push and create PR
git push origin feature/new-endpoint
```

---

## Production Checklist

- [ ] All endpoints have validation schemas
- [ ] All mutations have audit logging
- [ ] No console.log in code (use logger)
- [ ] Error messages don't expose internal details
- [ ] Rate limits configured appropriately
- [ ] Database indexes created
- [ ] CORS origins restricted
- [ ] JWT secrets rotated
- [ ] Logs are being archived
- [ ] Health checks passing

---

**Last Updated:** April 17, 2026
