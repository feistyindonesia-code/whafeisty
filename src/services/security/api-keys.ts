import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export const API_KEY_SCOPES = ['devices:read', 'messages:read', 'messages:send'] as const;
export type ApiKeyScope = typeof API_KEY_SCOPES[number];

const KEY_PREFIX = 'whaf';

export function createApiKey() {
  const identifier = randomBytes(8).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const keyPrefix = `${KEY_PREFIX}_${identifier}`;
  const token = `${keyPrefix}.${secret}`;
  return {
    keyPrefix,
    token,
    keyHash: hashApiKey(token),
  };
}

export function parseApiKey(token: string) {
  const match = /^whaf_[a-f0-9]{16}\.[A-Za-z0-9_-]{43}$/.exec(token);
  if (!match) {
    return null;
  }
  const separator = token.indexOf('.');
  return {
    keyPrefix: token.slice(0, separator),
    keyHash: hashApiKey(token),
  };
}

export function hashApiKey(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function apiKeyHashMatches(expectedHash: string, presentedHash: string) {
  if (!/^[a-f0-9]{64}$/i.test(expectedHash) || !/^[a-f0-9]{64}$/i.test(presentedHash)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expectedHash, 'hex'), Buffer.from(presentedHash, 'hex'));
}

export function normalizeApiKeyScopes(scopes: unknown): ApiKeyScope[] | null {
  if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== 'string')) {
    return null;
  }
  const normalized = [...new Set(scopes)];
  if (normalized.some((scope) => !API_KEY_SCOPES.includes(scope as ApiKeyScope))) {
    return null;
  }
  return normalized as ApiKeyScope[];
}

export function hasApiKeyScope(permissions: unknown, requiredScope: ApiKeyScope) {
  let scopes: unknown = permissions;
  if (typeof permissions === 'string') {
    try {
      scopes = JSON.parse(permissions);
    } catch {
      return false;
    }
  }
  return Array.isArray(scopes) && scopes.includes(requiredScope);
}
