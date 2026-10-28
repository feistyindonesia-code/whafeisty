const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createPasswordResetCode,
  hashPasswordResetCode,
} = require('../dist/services/security/password-reset');

test('password reset codes are six digits and use a server-secret HMAC verifier', () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-only-jwt-secret-that-is-at-least-32-bytes';
  try {
    const first = createPasswordResetCode();

    assert.match(first.code, /^\d{6}$/);
    assert.match(first.codeHash, /^[a-f0-9]{64}$/);
    assert.notEqual(first.codeHash, first.code);
    assert.equal(hashPasswordResetCode(first.code), first.codeHash);
    assert.notEqual(hashPasswordResetCode(`${first.code}1`), first.codeHash);
    process.env.JWT_SECRET = 'another-test-only-secret-that-is-at-least-32-bytes';
    assert.notEqual(hashPasswordResetCode(first.code), first.codeHash);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
