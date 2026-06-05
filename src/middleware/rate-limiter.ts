import type {
  RateLimitConfig,
  RateLimitResult,
  RateLimitTiers,
  ToolCategory,
  TOOL_CATEGORIES,
} from "../types/index.js";

/**
 * Token Bucket Rate Limiter
 *
 * Implements the Token Bucket algorithm — a classic rate limiting pattern
 * from HLD/system design. Each bucket starts full of tokens and refills
 * at a steady rate. Every request consumes one token; when the bucket
 * is empty, requests are rejected until tokens refill.
 *
 * This implementation is in-memory (no Redis dependency) making it
 * easy to unit test, but could be extended to use Redis for distributed
 * rate limiting across multiple instances.
 *
 * Algorithm:
 *   1. Calculate elapsed time since last refill
 *   2. Add proportional tokens (up to max capacity)
 *   3. If tokens >= 1, allow and consume one token
 *   4. Otherwise, reject and return retry-after time
 */
export class TokenBucketRateLimiter {
  private buckets = new Map<
    string,
    { tokens: number; lastRefill: number }
  >();

  private tiers: RateLimitTiers;

  constructor(tiers?: Partial<RateLimitTiers>) {
    this.tiers = {
      read: {
        maxTokens: 30,
        refillRate: 0.5, // 0.5 token/sec = 30/min
        refillInterval: 1000,
        ...tiers?.read,
      },
      write: {
        maxTokens: 10,
        refillRate: 0.167, // ~10/min
        refillInterval: 1000,
        ...tiers?.write,
      },
      admin: {
        maxTokens: 5,
        refillRate: 0.083, // ~5/min
        refillInterval: 1000,
        ...tiers?.admin,
      },
    };
  }

  /**
   * Attempt to consume a token from the bucket for the given category.
   * Returns whether the request is allowed and metadata for headers.
   */
  consume(category: ToolCategory): RateLimitResult {
    const config = this.tiers[category];
    const bucket = this.getOrCreateBucket(category, config);

    // Refill tokens based on elapsed time
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = (elapsed / config.refillInterval) * config.refillRate;

    bucket.tokens = Math.min(config.maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        retryAfterMs: 0,
        limit: config.maxTokens,
      };
    }

    // Calculate how long until the next token is available
    const retryAfterMs = Math.ceil(
      (1 - bucket.tokens) / config.refillRate * config.refillInterval
    );

    return {
      allowed: false,
      remaining: 0,
      retryAfterMs,
      limit: config.maxTokens,
    };
  }

  /**
   * Check the current state of a bucket without consuming a token.
   */
  peek(category: ToolCategory): RateLimitResult {
    const config = this.tiers[category];
    const bucket = this.getOrCreateBucket(category, config);

    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = (elapsed / config.refillInterval) * config.refillRate;
    const currentTokens = Math.min(config.maxTokens, bucket.tokens + tokensToAdd);

    return {
      allowed: currentTokens >= 1,
      remaining: Math.floor(currentTokens),
      retryAfterMs: currentTokens >= 1
        ? 0
        : Math.ceil(
            (1 - currentTokens) / config.refillRate * config.refillInterval
          ),
      limit: config.maxTokens,
    };
  }

  /**
   * Reset all rate limit buckets (useful for testing or admin reset).
   */
  reset(): void {
    this.buckets.clear();
  }

  /**
   * Reset a specific category's bucket.
   */
  resetCategory(category: ToolCategory): void {
    this.buckets.delete(category);
  }

  private getOrCreateBucket(
    category: string,
    config: RateLimitConfig
  ): { tokens: number; lastRefill: number } {
    if (!this.buckets.has(category)) {
      this.buckets.set(category, {
        tokens: config.maxTokens,
        lastRefill: Date.now(),
      });
    }
    return this.buckets.get(category)!;
  }
}
