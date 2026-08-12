/**
 * Security-focused unit tests that require NO database or Redis.
 * Covers role-based authorization and auth schema validation.
 */
import { expect } from 'chai';
import requireRole from '../middleware/requireRole.js';
import {
  loginSchema,
  createAdminSchema,
  changePasswordSchema,
} from '../schemas/authSchema.js';

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
    requireRole(['trainer', 'finance'])(
      mockReq({ role: 'finance' }),
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
    });
    expect(error).to.not.exist;
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