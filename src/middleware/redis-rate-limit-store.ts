import type { Store, Options } from 'express-rate-limit';
import { createHash } from 'crypto';
import Redis from 'ioredis';

const incrementScript = `
local total = redis.call('INCR', KEYS[1])
if total == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return { total, redis.call('PTTL', KEYS[1]) }
`;

const decrementScript = `
local total = tonumber(redis.call('GET', KEYS[1]) or '0')
if total > 1 then
  return redis.call('DECR', KEYS[1])
elseif total == 1 then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export class RedisRateLimitStore implements Store {
  readonly localKeys = false;
  private readonly keyNamespace: string;
  private windowMs = 0;

  constructor(private readonly redis: Redis, prefix: string) {
    this.keyNamespace = prefix;
  }

  init(options: Options) {
    this.windowMs = options.windowMs;
  }

  async increment(key: string) {
    if (!this.windowMs) {
      throw new Error('Rate limit store has not been initialized');
    }
    const storageKey = this.getStorageKey(key);
    const [totalHits, ttlMs] = await this.redis.eval(
      incrementScript,
      1,
      storageKey,
      this.windowMs
    ) as [number | string, number | string];
    const ttl = Number(ttlMs);
    if (ttl < 0) {
      throw new Error('Redis rate-limit key has no expiration');
    }
    return {
      totalHits: Number(totalHits),
      resetTime: new Date(Date.now() + ttl),
    };
  }

  async decrement(key: string) {
    await this.redis.eval(decrementScript, 1, this.getStorageKey(key));
  }

  async resetKey(key: string) {
    await this.redis.del(this.getStorageKey(key));
  }

  async shutdown() {
    if (this.redis.status === 'wait') {
      this.redis.disconnect();
    } else if (this.redis.status !== 'end') {
      await this.redis.quit();
    }
  }

  private getStorageKey(key: string) {
    const hashedKey = createHash('sha256').update(key).digest('hex');
    return `${this.keyNamespace}:${hashedKey}`;
  }
}

const redisOptions = {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
};
const redisUrl = process.env.REDIS_URL;
const redis = redisUrl
  ? new Redis(redisUrl, redisOptions)
  : new Redis({
    ...redisOptions,
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  });

redis.on('error', (error) => {
  console.error('Shared rate-limit Redis error:', error.message);
});

export const loginRateLimitStore = new RedisRateLimitStore(redis, 'whafeisty:rate-limit:login');
export const registrationRateLimitStore = new RedisRateLimitStore(redis, 'whafeisty:rate-limit:register');
export const passwordResetRateLimitStore = new RedisRateLimitStore(redis, 'whafeisty:rate-limit:password-reset');
