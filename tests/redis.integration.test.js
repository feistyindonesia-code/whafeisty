const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const redisUrl = process.env.WHAFEISTY_TEST_REDIS_URL;
let dedicatedRedisDatabase = false;
if (redisUrl) {
  const parsed = new URL(redisUrl);
  dedicatedRedisDatabase = /^\/[1-9]\d*$/.test(parsed.pathname);
  if (!dedicatedRedisDatabase) {
    throw new Error('WHAFEISTY_TEST_REDIS_URL must select a dedicated non-zero Redis database index');
  }
}

test('Redis integration rate-limit counters are shared, expire, and reset', {
  skip: !redisUrl || process.env.NODE_ENV === 'production',
}, async (t) => {
  const Redis = require('ioredis');
  const { RedisRateLimitStore } = require('../dist/middleware/redis-rate-limit-store');
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  const key = `integration-${randomUUID()}`;
  const namespace = `whafeisty:test:${randomUUID()}`;
  const store = new RedisRateLimitStore(redis, namespace);
  const otherInstanceStore = new RedisRateLimitStore(redis, namespace);
  let connected = false;

  try {
    try {
      await redis.connect();
      connected = true;
    } catch {
      t.skip('Configured test Redis service is unavailable');
      return;
    }
    store.init({ windowMs: 1000 });
    otherInstanceStore.init({ windowMs: 1000 });
    const first = await store.increment(key);
    const second = await otherInstanceStore.increment(key);
    assert.equal(first.totalHits, 1);
    assert.equal(second.totalHits, 2);
    assert.ok(second.resetTime instanceof Date);
    assert.ok(second.resetTime.getTime() > Date.now());
    await store.decrement(key);
    const afterDecrement = await otherInstanceStore.increment(key);
    assert.equal(afterDecrement.totalHits, 2);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal((await otherInstanceStore.increment(key)).totalHits, 1);
    await store.resetKey(key);
    assert.equal((await otherInstanceStore.increment(key)).totalHits, 1);
  } finally {
    if (connected) {
      await store.resetKey(key);
      await redis.quit();
    }
  }
});
