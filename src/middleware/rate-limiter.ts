import { Redis } from "ioredis";
import { createRedisConnection } from "../config/redis.config.js";
import { logger } from "../utils/logger.js";
import type {
  RateLimitConfig,
  RateLimitResult,
  RateLimitTiers,
  ToolCategory,
} from "../types/index.js";

/**
 * Lua script for atomic token bucket consume in Redis.
 *
 * Uses a Redis HASH per bucket with fields: tokens, lastRefill.
 * Atomicity via EVAL prevents race conditions across instances.
 *
 * KEYS[1] = bucket key
 * ARGV[1] = maxTokens, ARGV[2] = refillRate (tokens/sec), ARGV[3] = now (ms)
 */
const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local maxTokens = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local bucket = redis.call('HMGET', key, 'tokens', 'lastRefill')
local tokens = tonumber(bucket[1])
local lastRefill = tonumber(bucket[2])

if tokens == nil then
  tokens = maxTokens
  lastRefill = now
end

local elapsed = (now - lastRefill) / 1000
local tokensToAdd = elapsed * refillRate
tokens = math.min(maxTokens, tokens + tokensToAdd)

if tokens >= 1 then
  tokens = tokens - 1
  redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', now)
  redis.call('EXPIRE', key, 300)
  return {1, math.floor(tokens), 0, maxTokens}
else
  redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', now)
  redis.call('EXPIRE', key, 300)
  local retryAfterMs = math.ceil((1 - tokens) / refillRate * 1000)
  return {0, 0, retryAfterMs, maxTokens}
end
`;

/**
 * Redis-backed Token Bucket Rate Limiter.
 *
 * Stores bucket state in Redis so rate limits persist across restarts
 * and are enforced consistently across multiple server instances.
 * Falls back to in-memory if no Redis URL is configured.
 */
export class TokenBucketRateLimiter {
  private redis: Redis | null = null;
  private inMemoryBuckets = new Map<string, { tokens: number; lastRefill: number }>();
  private tiers: RateLimitTiers;
  private keyPrefix: string;

  constructor(tiers?: Partial<RateLimitTiers>) {
    this.tiers = {
      read: { maxTokens: 30, refillRate: 0.5, refillInterval: 1000, ...tiers?.read },
      write: { maxTokens: 10, refillRate: 0.167, refillInterval: 1000, ...tiers?.write },
      admin: { maxTokens: 5, refillRate: 0.083, refillInterval: 1000, ...tiers?.admin },
    };
    this.keyPrefix = "rl";
    this.initRedis();
  }

  /**
   * Connect to Redis for distributed rate limiting.
   * If REDIS_URL is not set, stays in-memory mode.
   */
  private initRedis(): void {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      logger.warn("rate-limiter", "REDIS_URL not set, running in-memory (single instance only)");
      return;
    }
    try {
      this.redis = createRedisConnection(redisUrl);
      logger.info("rate-limiter", "connected to Redis for distributed rate limiting");
    } catch (err) {
      logger.error("rate-limiter", "failed to connect to Redis, falling back to in-memory", {
        error: err instanceof Error ? err.message : String(err),
      });
      this.redis = null;
    }
  }

  /**
   * Consume a token for the given category, scoped to a connection ID.
   * Uses Redis Lua script for atomic distributed enforcement,
   * or in-memory fallback for single-instance deployments.
   */
  async consume(category: ToolCategory, connectionId?: string): Promise<RateLimitResult> {
    const config = this.tiers[category];
    const bucketKey = this.buildKey(category, connectionId);

    if (this.redis) {
      return this.consumeRedis(bucketKey, config);
    }
    return this.consumeInMemory(bucketKey, config);
  }

  /**
   * Check bucket state without consuming. Works for both backends.
   */
  async peek(category: ToolCategory, connectionId?: string): Promise<RateLimitResult> {
    const config = this.tiers[category];
    const bucketKey = this.buildKey(category, connectionId);

    if (this.redis) {
      return this.peekRedis(bucketKey, config);
    }
    return this.peekInMemory(bucketKey, config);
  }

  /** Reset all rate limit buckets. */
  async reset(): Promise<void> {
    this.inMemoryBuckets.clear();
    if (this.redis) {
      const stream = this.redis.scanStream({ match: `${this.keyPrefix}:*`, count: 200 });
      for await (const keys of stream) {
        if ((keys as string[]).length > 0) await this.redis.del(...(keys as string[]));
      }
    }
  }

  /**
   * Reset a specific category for a specific connection.
   */
  async resetCategory(category: ToolCategory, connectionId?: string): Promise<void> {
    const key = this.buildKey(category, connectionId);
    this.inMemoryBuckets.delete(key);
    if (this.redis) await this.redis.del(key);
  }

  /**
   * Gracefully close the Redis connection used for rate limiting.
   */
  async shutdown(): Promise<void> {
    if (this.redis) {
      this.redis.disconnect();
      this.redis = null;
    }
  }

  // --- Redis-backed operations ---

  private async consumeRedis(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    try {
      const result = await this.redis!.eval(
        TOKEN_BUCKET_LUA, 1, key,
        config.maxTokens, config.refillRate, Date.now()
      ) as number[];

      return {
        allowed: result[0] === 1,
        remaining: result[1],
        retryAfterMs: result[2],
        limit: result[3],
      };
    } catch (err) {
      logger.error("rate-limiter", "Redis eval failed, falling back to in-memory", {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.consumeInMemory(key, config);
    }
  }

  private async peekRedis(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    try {
      const [tokensStr, lastRefillStr] = await this.redis!.hmget(key, "tokens", "lastRefill");
      let tokens = tokensStr !== null ? parseFloat(tokensStr) : config.maxTokens;
      const lastRefill = lastRefillStr !== null ? parseInt(lastRefillStr) : Date.now();

      const elapsed = (Date.now() - lastRefill) / 1000;
      tokens = Math.min(config.maxTokens, tokens + elapsed * config.refillRate);

      return {
        allowed: tokens >= 1,
        remaining: Math.floor(tokens),
        retryAfterMs: tokens >= 1 ? 0 : Math.ceil((1 - tokens) / config.refillRate * 1000),
        limit: config.maxTokens,
      };
    } catch {
      return this.peekInMemory(key, config);
    }
  }

  // --- In-memory fallback ---

  private consumeInMemory(key: string, config: RateLimitConfig): RateLimitResult {
    const bucket = this.getOrCreateBucket(key, config);
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = (elapsed / config.refillInterval) * config.refillRate;

    bucket.tokens = Math.min(config.maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0, limit: config.maxTokens };
    }

    const retryAfterMs = Math.ceil((1 - bucket.tokens) / config.refillRate * config.refillInterval);
    return { allowed: false, remaining: 0, retryAfterMs, limit: config.maxTokens };
  }

  private peekInMemory(key: string, config: RateLimitConfig): RateLimitResult {
    const bucket = this.getOrCreateBucket(key, config);
    const elapsed = Date.now() - bucket.lastRefill;
    const tokensToAdd = (elapsed / config.refillInterval) * config.refillRate;
    const currentTokens = Math.min(config.maxTokens, bucket.tokens + tokensToAdd);

    return {
      allowed: currentTokens >= 1,
      remaining: Math.floor(currentTokens),
      retryAfterMs: currentTokens >= 1 ? 0 : Math.ceil((1 - currentTokens) / config.refillRate * config.refillInterval),
      limit: config.maxTokens,
    };
  }

  private getOrCreateBucket(key: string, config: RateLimitConfig) {
    if (!this.inMemoryBuckets.has(key)) {
      this.inMemoryBuckets.set(key, { tokens: config.maxTokens, lastRefill: Date.now() });
    }
    return this.inMemoryBuckets.get(key)!;
  }

  /**
   * Build a Redis key scoped by category and optionally by connection ID,
   * so each client/connection gets independent rate limits.
   */
  private buildKey(category: string, connectionId?: string): string {
    return connectionId ? `${this.keyPrefix}:${connectionId}:${category}` : `${this.keyPrefix}:global:${category}`;
  }
}
