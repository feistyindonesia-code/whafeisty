const assert = require('node:assert/strict');
const { test } = require('node:test');
const { RedisRateLimitStore } = require('../dist/middleware/redis-rate-limit-store');

class FakeRedis {
  counters = new Map();

  async eval(script, _numberOfKeys, key, windowMs) {
    if (script.includes('INCR')) {
      const total = (this.counters.get(key) || 0) + 1;
      this.counters.set(key, total);
      return [total, windowMs];
    }
    if (script.includes('DECR')) {
      const total = Math.max((this.counters.get(key) || 0) - 1, 0);
      this.counters.set(key, total);
      return total;
    }
    throw new Error('Unexpected Redis script');
  }

  async del(key) {
    this.counters.delete(key);
  }
}

test('shared Redis rate-limit store increments, decrements, and resets namespaced keys', async () => {
  const redis = new FakeRedis();
  const store = new RedisRateLimitStore(redis, 'test:login');
  store.init({ windowMs: 60_000 });

  const first = await store.increment('127.0.0.1');
  const second = await store.increment('127.0.0.1');
  assert.equal(first.totalHits, 1);
  assert.equal(second.totalHits, 2);
  assert.equal(store.localKeys, false);
  const storageKey = [...redis.counters.keys()][0];
  assert.match(storageKey, /^test:login:[a-f0-9]{64}$/);
  assert.equal(redis.counters.get(storageKey), 2);

  await store.decrement('127.0.0.1');
  assert.equal(redis.counters.get(storageKey), 1);
  await store.resetKey('127.0.0.1');
  assert.equal(redis.counters.has(storageKey), false);
});

test('shared Redis rate-limit store propagates store errors for fail-closed middleware', async () => {
  const store = new RedisRateLimitStore({
    eval: async () => {
      throw new Error('Redis unavailable');
    },
  }, 'test:login');
  store.init({ windowMs: 60_000 });

  await assert.rejects(store.increment('127.0.0.1'), /Redis unavailable/);
});
