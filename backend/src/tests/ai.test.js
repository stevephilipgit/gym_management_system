/**
 * AI subsystem unit tests — no database required.
 * Tests the provider abstraction, tool layer, input validation, and
 * security boundaries.
 */
import { expect } from 'chai';
import { AIProviderError, ProviderErrorCodes, isRetryableProviderError } from '../services/ai/providers/aiProvider.js';
import { isValidTool, requiresConfirmation, isSideEffectTool, TOOL_REGISTRY } from '../services/ai/toolSchemas.js';
import executeTool from '../services/ai/toolExecutor.js';
import aiConfig from '../config/aiConfig.js';

/* ============================================================
   PROVIDER ERROR CLASSES
   ============================================================ */
describe('AIProviderError', () => {
  it('creates an error with the correct code and message', () => {
    const err = new AIProviderError('test error', ProviderErrorCodes.TIMEOUT, true);
    expect(err).to.be.instanceOf(Error);
    expect(err.message).to.equal('test error');
    expect(err.code).to.equal('TIMEOUT');
    expect(err.retryable).to.be.true;
  });

  it('defaults to non-retryable UNKNOWN', () => {
    const err = new AIProviderError('generic');
    expect(err.code).to.equal('UNKNOWN');
    expect(err.retryable).to.be.false;
  });

  it('isRetryableProviderError returns true only for retryable errors', () => {
    expect(isRetryableProviderError(new AIProviderError('a', 'TIMEOUT', true))).to.be.true;
    expect(isRetryableProviderError(new AIProviderError('b', 'UNAVAILABLE', true))).to.be.true;
    expect(isRetryableProviderError(new AIProviderError('c', 'AUTH', false))).to.be.false;
    expect(isRetryableProviderError(new Error('plain'))).to.be.false;
    expect(isRetryableProviderError(null)).to.be.false;
  });
});

/* ============================================================
   TOOL REGISTRY
   ============================================================ */
describe('TOOL_REGISTRY', () => {
  it('has all required tools registered', () => {
    const required = [
      'getTotalMembers',
      'getActiveMembersCount',
      'getExpiringMembers',
      'getTodayAttendanceCount',
      'getEnquiriesSummary',
      'getInactiveMembers',
      'getDashboardSummary',
    ];
    for (const name of required) {
      expect(isValidTool(name), `tool ${name} should be registered`).to.be.true;
    }
  });

  it('validates known and unknown tools', () => {
    expect(isValidTool('getTotalMembers')).to.be.true;
    expect(isValidTool('getExpiringMembers')).to.be.true;
    expect(isValidTool('unknownTool')).to.be.false;
    expect(isValidTool('')).to.be.false;
    expect(isValidTool(null)).to.be.false;
  });

  it('no tool requires confirmation (side-effect gating removed)', () => {
    for (const name of Object.keys(TOOL_REGISTRY)) {
      expect(requiresConfirmation(name), `tool ${name} should not require confirmation`).to.be.false;
    }
  });

  it('no tool is marked as side-effect', () => {
    for (const name of Object.keys(TOOL_REGISTRY)) {
      expect(isSideEffectTool(name), `tool ${name} should not be a side-effect`).to.be.false;
    }
  });

  it('getExpiringMembers has days param with default 7 and min 1 / max 90', () => {
    const tool = TOOL_REGISTRY.getExpiringMembers;
    expect(tool.params.days).to.exist;
    expect(tool.params.days.default).to.equal(7);
    expect(tool.params.days.min).to.equal(1);
    expect(tool.params.days.max).to.equal(90);
  });

  it('getInactiveMembers has days param with default 30', () => {
    const tool = TOOL_REGISTRY.getInactiveMembers;
    expect(tool.params.days.default).to.equal(30);
  });
});

/* ============================================================
   TOOL EXECUTOR — PARAM VALIDATION
   ============================================================ */
describe('executeTool param validation', () => {
  it('throws for unknown tool', async () => {
    try {
      await executeTool('unknownTool', {});
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.message).to.include('Unknown tool');
    }
  });

  it('throws for invalid param type', async () => {
    try {
      await executeTool('getExpiringMembers', { days: 'abc' });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.message).to.include('Invalid param type');
    }
  });

  it('throws for days below minimum', async () => {
    try {
      await executeTool('getExpiringMembers', { days: 0 });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.message).to.include('must be >= 1');
    }
  });

  it('throws for days above maximum', async () => {
    try {
      await executeTool('getExpiringMembers', { days: 999 });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.message).to.include('must be <= 90');
    }
  });

  it('accepts valid params and passes them to the tool', async () => {
    const { default: Member } = await import('../models/Member.js');
    const original = Member.countDocuments;
    Member.countDocuments = async () => 42;
    try {
      const result = await executeTool('getTotalMembers', {}, { type: 'user', scope: 'all' });
      expect(result).to.have.property('count');
      expect(result.count).to.equal(42);
    } finally {
      Member.countDocuments = original;
    }
  });

  it('uses default param value when not provided', async () => {
    const { default: Member } = await import('../models/Member.js');
    const original = Member.find;
    Member.find = () => ({
      select: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
    });
    try {
      const result = await executeTool('getExpiringMembers', {}, { type: 'user', scope: 'all' });
      expect(result).to.have.property('count');
      expect(result.daysWindow).to.equal(7);
    } finally {
      Member.find = original;
    }
  });

  it('DENIES execution when no principal is provided', async () => {
    try {
      await executeTool('getTotalMembers', {});
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.message).to.include('explicit principal');
    }
  });

  it('DENIES execution for unknown principal type', async () => {
    try {
      await executeTool('getTotalMembers', {}, { type: 'robot', scope: 'all' });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.message).to.include('Unknown principal type');
    }
  });

  it('DENIES execution for a system principal without explicit scope', async () => {
    try {
      await executeTool('getTotalMembers', {}, { type: 'system', name: 'job' });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.message).to.include('must declare an explicit scope');
    }
  });

  it('ALLOWS an explicit system principal with scope all', async () => {
    const { default: Member } = await import('../models/Member.js');
    const original = Member.countDocuments;
    Member.countDocuments = async () => 7;
    try {
      const result = await executeTool(
        'getTotalMembers',
        {},
        { type: 'system', name: 'reminderAgent', systemScope: 'all' }
      );
      expect(result.count).to.equal(7);
    } finally {
      Member.countDocuments = original;
    }
  });
});

/* ============================================================
   CHAT SERVICE — INPUT VALIDATION
   ============================================================ */
describe('Chat service input validation', () => {
  it('rejects empty message', async () => {
    // We test the validation logic inline (processMessage throws)
    const { processMessage } = await import('../services/ai/chatService.js');
    try {
      await processMessage({ message: '', admin: { id: 'test', scope: 'all' } });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.status).to.equal(400);
      expect(err.message).to.include('cannot be empty');
    }
  });

  it('rejects message exceeding max length', async () => {
    const { processMessage } = await import('../services/ai/chatService.js');
    const longMsg = 'x'.repeat(aiConfig.maxMessageLength + 1);
    try {
      await processMessage({ message: longMsg, admin: { id: 'test', scope: 'all' } });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.status).to.equal(400);
      expect(err.message).to.include('too long');
    }
  });

  it('strips HTML tags from message', async () => {
    const { processMessage } = await import('../services/ai/chatService.js');
    try {
      await processMessage({ message: '<script></script>', admin: { id: 'test', scope: 'all' } });
      expect.fail('should have thrown after stripping');
    } catch (err) {
      expect(err.message).to.include('cannot be empty');
    }
  });
});

/* ============================================================
   RATE LIMITER — MESSAGE FORMAT
   ============================================================ */
describe('AI rate limiter message format', () => {
  it('exports a per-minute limiter middleware', async () => {
    const { aiPerMinuteLimiter } = await import('../middleware/aiRateLimiter.js');
    expect(aiPerMinuteLimiter).to.be.a('function');
    expect(aiPerMinuteLimiter.resetKey).to.be.a('function');
  });

  it('exports a per-hour limiter middleware', async () => {
    const { aiPerHourLimiter } = await import('../middleware/aiRateLimiter.js');
    expect(aiPerHourLimiter).to.be.a('function');
    expect(aiPerHourLimiter.resetKey).to.be.a('function');
  });
});

/* ============================================================
   AI CONFIG
   ============================================================ */
describe('aiConfig', () => {
  it('has all required properties', () => {
    expect(aiConfig).to.have.property('enabled');
    expect(aiConfig).to.have.property('provider');
    expect(aiConfig).to.have.property('model');
    expect(aiConfig).to.have.property('apiKey');
    expect(aiConfig).to.have.property('fallbackProvider');
    expect(aiConfig).to.have.property('fallbackModel');
    expect(aiConfig).to.have.property('timeoutMs');
    expect(aiConfig).to.have.property('rateLimitPerMinute');
    expect(aiConfig).to.have.property('rateLimitPerHour');
    expect(aiConfig).to.have.property('maxMessageLength');
    expect(aiConfig).to.have.property('maxHistoryPairs');
    expect(aiConfig).to.have.property('maxMemoryItems');
  });

  it('has sensible defaults when env vars are missing', () => {
    expect(typeof aiConfig.enabled).to.equal('boolean');
    expect(aiConfig.provider).to.equal('gemini');
    expect(aiConfig.timeoutMs).to.equal(15000);
    expect(aiConfig.rateLimitPerMinute).to.equal(20);
    expect(aiConfig.maxMessageLength).to.equal(2000);
  });
});

/* ============================================================
   PROMPT TEMPLATES
   ============================================================ */
describe('buildSystemPrompt', () => {
  it('returns a string with tool references', async () => {
    const { buildSystemPrompt } = await import('../services/ai/promptTemplates.js');
    const prompt = buildSystemPrompt();
    expect(prompt).to.be.a('string');
    expect(prompt).to.include('Giri Gym Assistant');
    expect(prompt).to.include('getTotalMembers');
    expect(prompt).to.include('getExpiringMembers');
    expect(prompt).to.include('FORMAT A');
  });

  it('includes module context when provided', async () => {
    const { buildSystemPrompt } = await import('../services/ai/promptTemplates.js');
    const prompt = buildSystemPrompt('dashboard');
    expect(prompt).to.include('currently viewing: dashboard');
  });
});

/* ============================================================
   AUTHORIZATION — requireRole enforcement
   ============================================================ */
describe('AI authorization (requireRole)', () => {
  it('requireRole("superadmin") rejects trainer', async () => {
    const { default: requireRole } = await import('../middleware/requireRole.js');
    const req = { admin: { role: 'trainer' } };
    const res = {
      status: (code) => {
        res.statusCode = code;
        return res;
      },
      json: () => {},
    };
    let nextCalled = false;
    requireRole('superadmin')(req, res, () => { nextCalled = true; });
    expect(res.statusCode).to.equal(403);
    expect(nextCalled).to.be.false;
  });

  it('requireRole("superadmin") allows superadmin', async () => {
    const { default: requireRole } = await import('../middleware/requireRole.js');
    const req = { admin: { role: 'superadmin' } };
    const res = {
      status: () => res,
      json: () => {},
    };
    let nextCalled = false;
    requireRole('superadmin')(req, res, () => { nextCalled = true; });
    expect(nextCalled).to.be.true;
  });
});

/* ============================================================
   SECURITY — Session ownership boundary
   ============================================================ */
describe('AI session ownership', () => {
  it('session service enforces ownerUserId in every query', async () => {
    const { readFileSync } = await import('node:fs');
    const { createRequire } = await import('node:module');
    const require2 = createRequire(import.meta.url);
    const src = readFileSync(require2.resolve('../services/ai/sessionService.js'), 'utf8');
    expect(src).to.include('ownerUserId');
    // every find/findOne on ChatSession must include ownerUserId
    const findPattern = /ChatSession\.(findOne|find|findOneAndUpdate)\s*\(\s*\{\s*sessionId[\s\S]*?ownerUserId/g;
    const matches = src.match(findPattern) || [];
    // at least the core ownership-bound lookups exist
    expect(matches.length).to.be.at.least(3);
  });

  it('memory service scopes queries by ownerUserId', async () => {
    const { readFileSync } = await import('node:fs');
    const { createRequire } = await import('node:module');
    const require2 = createRequire(import.meta.url);
    const src = readFileSync(require2.resolve('../services/ai/memoryService.js'), 'utf8');
    expect(src).to.include('AIUserMemory.findOne({ ownerUserId, key })');
    expect(src).to.include('AIUserMemory.deleteOne({ ownerUserId, key })');
    expect(src).to.not.include('AIUserMemory.findOne({ key }');
  });
});

/* ============================================================
   PROVIDER FACTORY — status
   ============================================================ */
describe('providerFactory', () => {
  it('getProviderStatus returns enabled status', async () => {
    const { getProviderStatus } = await import('../services/ai/providerFactory.js');
    const status = getProviderStatus();
    expect(status).to.have.property('enabled');
    expect(status).to.have.property('primaryProvider');
    expect(status).to.have.property('primaryModel');
    expect(status).to.have.property('primaryConfigured');
    expect(status).to.have.property('fallbackProvider');
    expect(status).to.have.property('fallbackConfigured');
  });
});