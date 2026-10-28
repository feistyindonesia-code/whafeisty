const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  apiKeyHashMatches,
  createApiKey,
  hasApiKeyScope,
  normalizeApiKeyScopes,
  parseApiKey,
} = require('../dist/services/security/api-keys');

test('API keys use a random identifier and an unguessable secret with a hash-only verifier', () => {
  const first = createApiKey();
  const second = createApiKey();
  assert.match(first.keyPrefix, /^whaf_[a-f0-9]{16}$/);
  assert.match(first.token, /^whaf_[a-f0-9]{16}\.[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.keyHash, first.token);
  assert.equal(parseApiKey(first.token).keyPrefix, first.keyPrefix);
  assert.equal(apiKeyHashMatches(first.keyHash, parseApiKey(first.token).keyHash), true);
  assert.equal(apiKeyHashMatches(first.keyHash, parseApiKey(second.token).keyHash), false);
});

test('API keys reject malformed tokens and unknown or insufficient scopes', () => {
  assert.equal(parseApiKey('whaf_legacy_plaintext'), null);
  assert.equal(normalizeApiKeyScopes(['messages:send', 'admin:*']), null);
  assert.deepEqual(normalizeApiKeyScopes(['messages:send', 'messages:send']), ['messages:send']);
  assert.equal(hasApiKeyScope(['messages:send'], 'messages:send'), true);
  assert.equal(hasApiKeyScope(['messages:read'], 'messages:send'), false);
  assert.equal(hasApiKeyScope('not-json', 'messages:send'), false);
});
