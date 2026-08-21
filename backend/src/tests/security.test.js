/**
 * Security-focused unit tests that require NO database or Redis.
 * Covers role-based authorization and auth schema validation.
 */
import { expect } from 'chai';
import requireRole from '../middleware/requireRole.js';
import scopeResolver from '../core/scopeResolver.js';
import {
  loginSchema,
  createAdminSchema,
  changePasswordSchema,
} from '../schemas/authSchema.js';
import { memberUpdateSchema, memberRenewSchema } from '../schemas/memberSchema.js';
import { sessionCookieName } from '../utils/sessionCookies.js';

const mockReq = (admin = null) => ({ admin });
const mockRes = () => {
  const res = {};
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
};

describe('requireRole middleware', () => {
  it('rejects unauthenticated requests with 401', () => {
    const req = mockReq(null);
    const res = mockRes();
    let nextCalled = false;
    requireRole('superadmin')(req, res, () => { nextCalled = true; });
    expect(res.statusCode).to.equal(401);
    expect(nextCalled).to.be.false;
  });

  it('rejects a role mismatch with 403', () => {
    const req = mockReq({ role: 'trainer' });
    const res = mockRes();
    let nextCalled = false;
    requireRole('superadmin')(req, res, () => { nextCalled = true; });
    expect(res.statusCode).to.equal(403);
    expect(nextCalled).to.be.false;
  });

  it('allows matching role and calls next', () => {
    let nextCalled = false;
    const res = mockRes();
    requireRole('superadmin')(
      mockReq({ role: 'superadmin' }),
      res,
      () => { nextCalled = true; }
    );
    expect(nextCalled).to.be.true;
  });

  it('supports array of allowed roles', () => {
    let nextCalled = false;
    const res = mockRes();
    requireRole(['superadmin', 'trainer'])(
      mockReq({ role: 'trainer' }),
      res,
      () => { nextCalled = true; }
    );
    expect(nextCalled).to.be.true;
  });

  it('rejects unknown roles not in the canonical set', () => {
    const req = mockReq({ role: 'admin' });
    const res = mockRes();
    let nextCalled = false;
    requireRole('superadmin')(req, res, () => { nextCalled = true; });
    expect(res.statusCode).to.equal(403);
    expect(nextCalled).to.be.false;
  });
});

describe('loginSchema validation', () => {
  it('rejects password shorter than 8 characters', () => {
    const { error } = loginSchema.validate({
      username: 'admin',
      password: 'short',
      captchaId: 'abc',
      captchaAnswer: '1234',
    });
    expect(error).to.exist;
    expect(error.details[0].message).to.include('password');
  });

  it('rejects a missing captcha answer', () => {
    const { error } = loginSchema.validate({
      username: 'admin',
      password: 'password123',
      captchaId: 'abc',
    });
    expect(error).to.exist;
    expect(error.details.some((d) => d.path.includes('captchaAnswer'))).to.be
      .true;
  });

  it('rejects a missing captcha id', () => {
    const { error } = loginSchema.validate({
      username: 'admin',
      password: 'password123',
      captchaAnswer: '1234',
    });
    expect(error).to.exist;
    expect(error.details.some((d) => d.path.includes('captchaId'))).to.be.true;
  });

  it('accepts a valid login payload', () => {
    const { error } = loginSchema.validate({
      username: 'admin',
      password: 'password123',
      captchaId: 'abc',
      captchaAnswer: '1234',
    });
    expect(error).to.not.exist;
  });
});

describe('createAdminSchema validation', () => {
  it('rejects weak passwords missing an uppercase letter', () => {
    const { error } = createAdminSchema.validate({
      username: 'newadmin',
      password: 'lowercase123',
      fullName: 'New Admin',
      email: 'admin@example.com',
      role: 'trainer',
    });
    expect(error).to.exist;
    expect(error.details[0].path).to.include('password');
  });

  it('rejects invalid roles', () => {
    const { error } = createAdminSchema.validate({
      username: 'newadmin',
      password: 'StrongPass123',
      fullName: 'New Admin',
      email: 'admin@example.com',
      role: 'admin',
    });
    expect(error).to.exist;
    expect(error.details.some((d) => d.path.includes('role'))).to.be.true;
  });

  it('accepts a canonical role with a strong password', () => {
    const { error } = createAdminSchema.validate({
      username: 'newadmin',
      password: 'StrongPass123',
      fullName: 'New Admin',
      email: 'admin@example.com',
      role: 'superadmin',
      scope: 'all',
    });
    expect(error).to.not.exist;
  });

  it('rejects a trainer without an explicit scope', () => {
    const { error } = createAdminSchema.validate({
      username: 'newtrainer',
      password: 'StrongPass123',
      fullName: 'New Trainer',
      email: 'trainer2@example.com',
      role: 'trainer',
    });
    expect(error).to.exist;
    expect(error.details.some((d) => d.path.includes('scope'))).to.be.true;
  });

  it('rejects an invalid scope value', () => {
    const { error } = createAdminSchema.validate({
      username: 'newtrainer',
      password: 'StrongPass123',
      fullName: 'New Trainer',
      email: 'trainer3@example.com',
      role: 'trainer',
      scope: 'all_genders',
    });
    expect(error).to.exist;
    expect(error.details.some((d) => d.path.includes('scope'))).to.be.true;
  });

  it('rejects the removed finance role', () => {
    const { error } = createAdminSchema.validate({
      username: 'newfinance',
      password: 'StrongPass123',
      fullName: 'New Finance',
      email: 'finance2@example.com',
      role: 'finance',
      scope: 'all',
    });
    expect(error).to.exist;
    expect(error.details.some((d) => d.path.includes('role'))).to.be.true;
  });
});

describe('changePasswordSchema validation', () => {
  it('rejects a new password below minimum length', () => {
    const { error } = changePasswordSchema.validate({
      currentPassword: 'OldPass123',
      newPassword: 'Sh0rt',
    });
    expect(error).to.exist;
    expect(error.details[0].path).to.include('newPassword');
  });

  it('accepts a strong new password', () => {
    const { error } = changePasswordSchema.validate({
      currentPassword: 'OldPass123',
      newPassword: 'NewPass123',
    });
    expect(error).to.not.exist;
  });
});

describe('scopeResolver — gender-scope rules', () => {
  const reqWithScope = (scope) => ({ admin: { scope } });

  it('superadmin (all) may access every gender', () => {
    expect(scopeResolver.checkMemberScope(reqWithScope('all'), 'Male')).to.be.true;
    expect(scopeResolver.checkMemberScope(reqWithScope('all'), 'Female')).to.be.true;
    expect(scopeResolver.checkMemberScope(reqWithScope('all'), 'Transgender')).to.be.true;
  });

  it('male scope only permits Male members', () => {
    expect(scopeResolver.checkMemberScope(reqWithScope('male'), 'Male')).to.be.true;
    expect(scopeResolver.checkMemberScope(reqWithScope('male'), 'Female')).to.be.false;
    expect(scopeResolver.checkMemberScope(reqWithScope('male'), 'Transgender')).to.be.false;
  });

  it('female_plus_transgender scope permits Female + Transgender only', () => {
    expect(scopeResolver.checkMemberScope(reqWithScope('female_plus_transgender'), 'Female')).to.be.true;
    expect(scopeResolver.checkMemberScope(reqWithScope('female_plus_transgender'), 'Transgender')).to.be.true;
    expect(scopeResolver.checkMemberScope(reqWithScope('female_plus_transgender'), 'Male')).to.be.false;
  });

  it('missing admin scope denies access', () => {
    expect(scopeResolver.checkMemberScope({ admin: null }, 'Male')).to.be.false;
    expect(scopeResolver.checkMemberScope({}, 'Male')).to.be.false;
  });

  it('getScopeAllowedGenders maps scopes correctly', () => {
    expect(scopeResolver.getScopeAllowedGenders(reqWithScope('all'))).to.have.members(['Male', 'Female', 'Transgender']);
    expect(scopeResolver.getScopeAllowedGenders(reqWithScope('male'))).to.deep.equal(['Male']);
    expect(scopeResolver.getScopeAllowedGenders(reqWithScope('female_plus_transgender'))).to.have.members(['Female', 'Transgender']);
    expect(scopeResolver.getScopeAllowedGenders(reqWithScope('bogus'))).to.deep.equal([]);
  });

  it('buildGenderFilter returns a full-gender filter for superadmin (equivalent to no restriction)', () => {
    const filter = scopeResolver.buildGenderFilter(reqWithScope('all'));
    expect(filter.gender.$in).to.have.members(['Male', 'Female', 'Transgender']);
    expect(scopeResolver.buildGenderFilter(reqWithScope('male'))).to.deep.equal({ gender: { $in: ['Male'] } });
    expect(scopeResolver.buildGenderFilter(reqWithScope('female_plus_transgender'))).to.deep.equal({
      gender: { $in: ['Female', 'Transgender'] },
    });
  });

  it('buildGenderFilter never trusts a client-provided scope', () => {
    const req = { admin: { scope: 'male' }, query: { gender: 'Female' } };
    const filter = scopeResolver.buildGenderFilter(req);
    expect(filter).to.deep.equal({ gender: { $in: ['Male'] } });
  });
});

describe('per-session cookie naming (multi-tab isolation)', () => {
  it('produces a distinct cookie name per session id', () => {
    const a = sessionCookieName('sid-a', 'gym_admin_token');
    const b = sessionCookieName('sid-b', 'gym_admin_token');
    expect(a).to.not.equal(b);
    expect(a).to.include('sid-a');
    expect(b).to.include('sid-b');
  });

  it('separates access and refresh cookie names', () => {
    expect(sessionCookieName('sid-1', 'gym_admin_token')).to.not.equal(
      sessionCookieName('sid-1', 'gym_admin_refresh')
    );
  });

  it('access token sid must match the X-Session-Id header (adminAuth rule)', () => {
    // This rule lives in middleware/adminAuth.js: header sid must equal
    // decoded.sid. Here we assert the cookie key resolution invariant:
    const headerSid = 'tab-a-session';
    const tokenCookieName = sessionCookieName(headerSid, 'gym_admin_token');
    expect(tokenCookieName).to.equal('gym_admin_token_tab-a-session');
    // Tab B resolves its own pair — never Tab A's.
    expect(tokenCookieName).to.not.equal('gym_admin_token_tab-b-session');
  });
});

describe('member update/renew schemas — optimistic concurrency version', () => {
  it('update schema rejects a member update without a version', () => {
    const { error } = memberUpdateSchema.validate({
      phone: '9876543210',
      fullName: 'New Name',
    });
    expect(error).to.exist;
    expect(error.details.some((d) => d.path.includes('version'))).to.be.true;
  });

  it('update schema accepts a payload with a valid version', () => {
    const { error } = memberUpdateSchema.validate({
      phone: '9876543210',
      fullName: 'New Name',
      version: 2,
    });
    expect(error).to.not.exist;
  });

  it('renew schema rejects a renewal without a version', () => {
    const { error } = memberRenewSchema.validate({
      newPlan: '3 Months',
      price: 2000,
    });
    expect(error).to.exist;
    expect(error.details.some((d) => d.path.includes('version'))).to.be.true;
  });

  it('renew schema accepts a payload with a valid version', () => {
    const { error } = memberRenewSchema.validate({
      newPlan: '3 Months',
      price: 2000,
      version: 0,
    });
    expect(error).to.not.exist;
  });
});