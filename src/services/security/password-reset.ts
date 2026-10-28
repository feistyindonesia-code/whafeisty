import { createHmac, randomInt } from 'crypto';

function getPasswordResetPepper() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters');
  }
  return secret;
}

export function createPasswordResetCode() {
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  return { code, codeHash: hashPasswordResetCode(code) };
}

export function hashPasswordResetCode(code: string) {
  return createHmac('sha256', getPasswordResetPepper()).update(code).digest('hex');
}
