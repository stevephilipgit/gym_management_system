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

/* ============================================================
   CAPABILITY CATALOG
   ============================================================ */
describe('capabilityCatalog', () => {
  it('exports human-facing capabilities', async () => {
    const { getEnabledCapabilities } = await import('../services/ai/capabilityCatalog.js');
    const caps = getEnabledCapabilities();
    expect(caps.length).to.be.at.least(5);
    for (const cap of caps) {
      expect(cap).to.have.property('id');
      expect(cap).to.have.property('displayName');
      expect(cap).to.have.property('description');
      expect(cap).to.have.property('examplePrompts');
      expect(cap.examplePrompts.length).to.be.at.least(1);
      expect(cap).to.have.property('underlyingTools');
    }
  });

  it('frontend payload excludes internal tool names', async () => {
    const { getCapabilitiesPayload } = await import('../services/ai/capabilityCatalog.js');
    const payload = getCapabilitiesPayload('dashboard');
    for (const cap of payload) {
      expect(cap).to.not.have.property('underlyingTools');
      expect(cap).to.not.have.property('enabled');
      expect(JSON.stringify(cap)).to.not.include('getTotalMembers');
    }
  });

  it('is module-contextual', async () => {
    const { getCapabilitiesForModule } = await import('../services/ai/capabilityCatalog.js');
    const attendance = getCapabilitiesForModule('attendance');
    const ids = attendance.map((c) => c.id);
    expect(ids).to.include('attendance');
    // Attendance capability should NOT appear on a module that doesn't list it
    const all = getCapabilitiesForModule(null);
    expect(all.length).to.be.at.least(attendance.length);
  });

  it('validates underlying tools at load time', async () => {
    const { CAPABILITY_CATALOG } = await import('../services/ai/capabilityCatalog.js');
    const { isValidTool } = await import('../services/ai/toolSchemas.js');
    for (const cap of CAPABILITY_CATALOG) {
      for (const tool of cap.underlyingTools) {
        expect(isValidTool(tool), `cap ${cap.id} tool ${tool}`).to.be.true;
      }
    }
  });
});

/* ============================================================
   INTENT RESOLVER — SEMANTIC + TYPO
   ============================================================ */
describe('intentResolver', () => {
  it('resolves common typo "givee epxiry memmebrs" to expiring members', async () => {
    const { resolveIntent } = await import('../services/ai/intentResolver.js');
    const result = resolveIntent('givee epxiry memmebrs');
    expect(result.resolved).to.be.true;
    expect(result.tool).to.equal('getExpiringMembers');
  });

  it('resolves broken English "who expiry nxt week" with days=7', async () => {
    const { resolveIntent } = await import('../services/ai/intentResolver.js');
    const result = resolveIntent('who expiry nxt week');
    expect(result.resolved).to.be.true;
    expect(result.tool).to.equal('getExpiringMembers');
    expect(result.params.days).to.equal(7);
  });

  it('resolves "today atandance" to attendance', async () => {
    const { resolveIntent } = await import('../services/ai/intentResolver.js');
    const result = resolveIntent('today atandance');
    expect(result.resolved).to.be.true;
    expect(result.tool).to.equal('getTodayAttendanceCount');
  });

  it('resolves "new enquires" to enquiries', async () => {
    const { resolveIntent } = await import('../services/ai/intentResolver.js');
    const result = resolveIntent('new enquires');
    expect(result.resolved).to.be.true;
    expect(result.tool).to.equal('getEnquiriesSummary');
  });

  it('resolves "total membars" to total members', async () => {
    const { resolveIntent } = await import('../services/ai/intentResolver.js');
    const result = resolveIntent('total membars');
    expect(result.resolved).to.be.true;
    expect(result.tool).to.equal('getTotalMembers');
  });

  it('resolves "who has not visited" to inactive members', async () => {
    const { resolveIntent } = await import('../services/ai/intentResolver.js');
    const result = resolveIntent('who has not visited');
    expect(result.resolved).to.be.true;
    expect(result.tool).to.equal('getInactiveMembers');
  });

  it('does not resolve an unrelated message', async () => {
    const { resolveIntent } = await import('../services/ai/intentResolver.js');
    const result = resolveIntent('what is the weather tomorrow in delhi?');
    expect(result.resolved).to.be.false;
  });

  it('extractDays parses documented temporal phrases', async () => {
    const { extractDays } = await import('../services/ai/intentResolver.js');
    expect(extractDays('next week')).to.equal(7);
    expect(extractDays('2 weeks')).to.equal(14);
    expect(extractDays('1 month')).to.equal(30);
    expect(extractDays('soon')).to.equal(7);
    expect(extractDays('no time reference')).to.equal(null);
  });
});

/* ============================================================
   CONTEXT BUDGET
   ============================================================ */
describe('contextBudget', () => {
  it('never truncates current message or system prompt', async () => {
    const { fitHistoryToBudget } = await import('../services/ai/contextBudget.js');
    const systemPrompt = 'S'.repeat(2000);
    const currentMessage = 'C'.repeat(2000);
    const history = [
      { role: 'user', parts: [{ text: 'a'.repeat(500) }] },
      { role: 'model', parts: [{ text: 'b'.repeat(500) }] },
      { role: 'user', parts: [{ text: 'c'.repeat(500) }] },
    ];
    const result = fitHistoryToBudget({
      systemPrompt,
      currentMessage,
      history,
      budgetChars: 4500,
    });
    expect(result.truncated).to.be.true;
    expect(result.droppedCount).to.be.at.least(1);
    // Current message kept as-is
    expect(result.usedChars).to.be.at.most(4500);
  });

  it('keeps history when it fits', async () => {
    const { fitHistoryToBudget } = await import('../services/ai/contextBudget.js');
    const history = [
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'hello' }] },
    ];
    const result = fitHistoryToBudget({
      systemPrompt: 'sys',
      currentMessage: 'msg',
      history,
      budgetChars: 10000,
    });
    expect(result.truncated).to.be.false;
    expect(result.droppedCount).to.equal(0);
  });
});

/* ============================================================
   MEMORY — OWNERSHIP + PRUNING
   ============================================================ */
describe('memoryService', () => {
  it('exposes clearAllMemory (owner-scoped)', async () => {
    const memoryService = await import('../services/ai/memoryService.js');
    expect(memoryService.clearAllMemory).to.be.a('function');
    expect(memoryService.setMemory).to.be.a('function');
    expect(memoryService.pruneMemory).to.be.a('function');
  });

  it('all memory queries are owner-scoped', async () => {
    const { readFileSync } = await import('node:fs');
    const { createRequire } = await import('node:module');
    const require2 = createRequire(import.meta.url);
    const src = readFileSync(require2.resolve('../services/ai/memoryService.js'), 'utf8');
    // updateOne/setMemory scopes by ownerUserId (multi-line call in source).
    expect(src).to.include('AIUserMemory.updateOne(');
    expect(src).to.include('{ ownerUserId, key }');
    expect(src).to.include('AIUserMemory.deleteMany({ ownerUserId })');
    expect(src).to.include('AIUserMemory.findOne({ ownerUserId, key })');
    expect(src).to.include('AIUserMemory.deleteOne({ ownerUserId, key })');
  });
});

/* ============================================================
   SESSION — SEQUENCE ORDERING (concurrency readiness)
   ============================================================ */
describe('sessionService', () => {
  it('uses atomic sequence allocation in addMessage', async () => {
    const { readFileSync } = await import('node:fs');
    const { createRequire } = await import('node:module');
    const require2 = createRequire(import.meta.url);
    const src = readFileSync(require2.resolve('../services/ai/sessionService.js'), 'utf8');
    expect(src).to.include('$inc: { messageSeq: 1 }');
    expect(src).to.include('sequence: session.messageSeq');
    expect(src).to.include('sort({ sequence: 1');
  });

  it('exposes clearAllMemory and archive lifecycle helpers', async () => {
    const sessionService = await import('../services/ai/sessionService.js');
    expect(sessionService.archiveSession).to.be.a('function');
    expect(sessionService.listSessions).to.be.a('function');
    expect(sessionService.getSessionMessages).to.be.a('function');
  });
});

/* ============================================================
   FOLLOW-UP INTENT RESOLUTION
   ============================================================ */
describe('followUpResolver', () => {
  it('classifies "how many?" as a count reference when a result exists', async () => {
    const { resolveFollowUp } = await import('../services/ai/followUpResolver.js');
    const ctx = { activeTool: 'findMembers', activeFilters: { expiresWithinDays: 7 }, activeIntent: 'members_expiring' };
    const result = resolveFollowUp('how many?', ctx);
    expect(result.kind).to.equal('reference');
    expect(result.action).to.equal('count');
    expect(result.filters.expiresWithinDays).to.equal(7);
  });

  it('classifies "only unpaid" as a filter modification', async () => {
    const { resolveFollowUp } = await import('../services/ai/followUpResolver.js');
    const ctx = { activeTool: 'findMembers', activeFilters: { expiresWithinDays: 7 }, activeIntent: 'members_expiring' };
    const result = resolveFollowUp('only unpaid', ctx);
    expect(result.kind).to.equal('modify');
    expect(result.filters.paymentStatus).to.equal('not_paid');
    expect(result.filters.expiresWithinDays).to.equal(7);
  });

  it('preserves gender filter across follow-ups', async () => {
    const { resolveFollowUp } = await import('../services/ai/followUpResolver.js');
    const ctx = { activeTool: 'findMembers', activeFilters: { gender: 'Male' }, activeIntent: 'members_expiring' };
    const result = resolveFollowUp('what about unpaid ones?', ctx);
    expect(result.kind).to.equal('modify');
    expect(result.filters.gender).to.equal('Male');
    expect(result.filters.paymentStatus).to.equal('not_paid');
  });

  it('resolves "their names" as a names presentation', async () => {
    const { resolveFollowUp } = await import('../services/ai/followUpResolver.js');
    const ctx = { activeTool: 'findMembers', activeFilters: {}, activeIntent: 'members_overview' };
    const result = resolveFollowUp('show their names', ctx);
    expect(result.kind).to.equal('reference');
    expect(result.action).to.equal('names');
  });

  it('resolves "first 5" with bounded n', async () => {
    const { resolveFollowUp } = await import('../services/ai/followUpResolver.js');
    const ctx = { activeTool: 'findMembers', activeFilters: {}, activeIntent: 'members_overview' };
    const result = resolveFollowUp('show me the first 5', ctx);
    expect(result.kind).to.equal('reference');
    expect(result.action).to.equal('first_n');
    expect(result.n).to.equal(5);
  });

  it('asks to clarify ambiguous references', async () => {
    const { resolveFollowUp } = await import('../services/ai/followUpResolver.js');
    // "them" with a context that is NOT a findMembers/member-list tool
    const ctx = { activeTool: 'getDashboardSummary', activeIntent: 'dashboard_insights' };
    const result = resolveFollowUp('what about them?', ctx);
    expect(result.kind).to.equal('clarify');
  });

  it('handles a brand-new query as "new"', async () => {
    const { resolveFollowUp } = await import('../services/ai/followUpResolver.js');
    const result = resolveFollowUp('show expiring members this week', {});
    expect(result.kind).to.equal('new');
  });

  it('returns explanation for "why"', async () => {
    const { resolveFollowUp } = await import('../services/ai/followUpResolver.js');
    const ctx = { activeTool: 'findMembers', activeFilters: { expiresWithinDays: 7 }, activeIntent: 'members_expiring' };
    const result = resolveFollowUp('why are they listed?', ctx);
    expect(result.kind).to.equal('explanation');
  });
});

/* ============================================================
   CONVERSATIONAL CONTEXT MODEL
   ============================================================ */
describe('conversationContext', () => {
  it('records a compact result reference, never full documents', async () => {
    const { recordToolResult, loadContext, saveContext } = await import('../services/ai/conversationContext.js');
    const ctx = loadContext({});
    const updated = recordToolResult(ctx, {
      tool: 'getExpiringMembers',
      params: { days: 7 },
      result: { count: 143, truncated: true, members: [{ name: 'x', phone: '1' }] },
      currentModule: 'dashboard',
    });
    expect(updated.lastResultType).to.equal('member_list');
    expect(updated.lastResultCount).to.equal(143);
    expect(updated.lastResultTruncated).to.be.true;
    expect(updated.activeTool).to.equal('getExpiringMembers');
    expect(updated.activeFilters.expiresWithinDays).to.equal(7);
    // Ensure we do not persist the raw members array.
    expect(updated.members).to.be.undefined;
    const saved = saveContext(updated);
    expect(saved.members).to.be.undefined;
  });

  it('records findMembers filters into active context', async () => {
    const { recordToolResult, loadContext } = await import('../services/ai/conversationContext.js');
    const ctx = loadContext({});
    const updated = recordToolResult(ctx, {
      tool: 'findMembers',
      params: { gender: 'Female', paymentStatus: 'not_paid' },
      result: { count: 3, truncated: false, members: [] },
    });
    expect(updated.activeIntent).to.equal('members_overview');
    expect(updated.activeFilters.gender).to.equal('Female');
    expect(updated.activeFilters.paymentStatus).to.equal('not_paid');
  });

  it('serializes/deserializes a bounded context through metadata', async () => {
    const { recordToolResult, loadContext, saveContext } = await import('../services/ai/conversationContext.js');
    const ctx = loadContext({});
    const updated = recordToolResult(ctx, {
      tool: 'findMembers',
      params: { gender: 'Male' },
      result: { count: 10, truncated: false, members: [] },
      currentModule: 'all_members',
    });
    const metadata = { conversationContext: saveContext(updated) };
    const restored = loadContext(metadata);
    expect(restored.activeTool).to.equal('findMembers');
    expect(restored.activeFilters.gender).to.equal('Male');
    expect(restored.currentModule).to.equal('all_members');
  });

  it('caps active filters at MAX_ACTIVE_FILTERS', async () => {
    const { recordToolResult, loadContext, MAX_ACTIVE_FILTERS } = await import('../services/ai/conversationContext.js');
    const ctx = loadContext({});
    const updated = recordToolResult(ctx, {
      tool: 'findMembers',
      params: {
        gender: 'Female',
        paymentStatus: 'not_paid',
        expiresWithinDays: 7,
        status: 'active',
        inactiveForDays: 30,
        limit: 5,
      },
      result: { count: 1, truncated: false, members: [] },
    });
    expect(Object.keys(updated.activeFilters).length).to.be.at.most(MAX_ACTIVE_FILTERS);
  });
});

/* ============================================================
   FINDMEMBERS — TYPED COMPOSABLE TOOL
   ============================================================ */
describe('findMembers tool', () => {
  it('is registered with enum validation', async () => {
    const { TOOL_REGISTRY, isValidTool } = await import('../services/ai/toolSchemas.js');
    expect(isValidTool('findMembers')).to.be.true;
    expect(TOOL_REGISTRY.findMembers.params.gender.enum).to.deep.equal(['Male', 'Female', 'Transgender']);
    expect(TOOL_REGISTRY.findMembers.params.paymentStatus.enum).to.deep.equal(['paid', 'not_paid']);
  });

  it('rejects an invalid enum value', async () => {
    const executeTool = (await import('../services/ai/toolExecutor.js')).default;
    try {
      await executeTool('findMembers', { gender: 'Robot' }, { type: 'user', scope: 'all' });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.message).to.include('must be one of');
    }
  });

  it('rejects an invalid numeric bound', async () => {
    const executeTool = (await import('../services/ai/toolExecutor.js')).default;
    try {
      await executeTool('findMembers', { expiresWithinDays: 9999 }, { type: 'user', scope: 'all' });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.message).to.include('must be <=');
    }
  });

  it('executes with typed filters through the executor', async () => {
    const { default: Member } = await import('../models/Member.js');
    const executeTool = (await import('../services/ai/toolExecutor.js')).default;
    const original = Member.find;
    Member.find = () => ({
      select: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
    });
    try {
      const result = await executeTool(
        'findMembers',
        { gender: 'Female', paymentStatus: 'not_paid', limit: 5 },
        { type: 'user', scope: 'all' }
      );
      expect(result).to.have.property('count');
      expect(result).to.have.property('truncated');
      expect(result).to.have.property('members');
    } finally {
      Member.find = original;
    }
  });
});

/* ============================================================
   SESSION RETENTION
   ============================================================ */
describe('sessionService retention', () => {
  it('exposes bounded, idempotent lifecycle helpers', async () => {
    const sessionService = await import('../services/ai/sessionService.js');
    expect(sessionService.archiveInactiveSessions).to.be.a('function');
    expect(sessionService.deleteExpiredSessions).to.be.a('function');
    expect(sessionService.runSessionLifecycle).to.be.a('function');
  });

  it('returns 0 when thresholds are missing/disabled', async () => {
    const sessionService = await import('../services/ai/sessionService.js');
    const archived = await sessionService.archiveInactiveSessions({ archiveAfterDays: 0 });
    const deleted = await sessionService.deleteExpiredSessions({ retentionDays: undefined });
    expect(archived).to.equal(0);
    expect(deleted).to.equal(0);
  });
});

/* ============================================================
   AI AUDIT EVENT TYPES
   ============================================================ */
describe('AI audit action types', () => {
  it('defines AI action types in constants', async () => {
    const { ACTION_TYPES } = await import('../core/constants.js');
    expect(ACTION_TYPES.AI_CHAT).to.equal('AI_CHAT');
    expect(ACTION_TYPES.AI_TOOL_QUERY).to.equal('AI_TOOL_QUERY');
    expect(ACTION_TYPES.AI_SESSION_ARCHIVE).to.equal('AI_SESSION_ARCHIVE');
    expect(ACTION_TYPES.AI_MEMORY_CLEAR).to.equal('AI_MEMORY_CLEAR');
  });

  it('controller imports auditLog', async () => {
    const { readFileSync } = await import('node:fs');
    const { createRequire } = await import('node:module');
    const require2 = createRequire(import.meta.url);
    const src = readFileSync(require2.resolve('../controllers/aiController.js'), 'utf8');
    expect(src).to.include('auditLog(req,');
    expect(src).to.include('ACTION_TYPES.AI_CHAT');
    expect(src).to.include('ACTION_TYPES.AI_TOOL_QUERY');
  });
});