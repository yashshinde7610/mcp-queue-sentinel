import { TokenBucketRateLimiter } from "../middleware/rate-limiter.js";

describe("TokenBucketRateLimiter", () => {
  let limiter: TokenBucketRateLimiter;

  beforeEach(() => {
    limiter = new TokenBucketRateLimiter({
      read: { maxTokens: 5, refillRate: 1, refillInterval: 1000 },
      write: { maxTokens: 3, refillRate: 0.5, refillInterval: 1000 },
      admin: { maxTokens: 2, refillRate: 0.25, refillInterval: 1000 },
    });
  });

  describe("consume", () => {
    it("should allow requests when tokens are available", () => {
      const result = limiter.consume("read");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4); // 5 max - 1 consumed
      expect(result.retryAfterMs).toBe(0);
    });

    it("should track remaining tokens correctly", () => {
      limiter.consume("read");
      limiter.consume("read");
      limiter.consume("read");
      const result = limiter.consume("read");

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1); // 5 - 4 = 1
    });

    it("should reject when all tokens are exhausted", () => {
      // Exhaust all 5 read tokens
      for (let i = 0; i < 5; i++) {
        const r = limiter.consume("read");
        expect(r.allowed).toBe(true);
      }

      // 6th request should be rejected
      const result = limiter.consume("read");
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it("should apply different limits per category", () => {
      // Admin has only 2 tokens
      limiter.consume("admin");
      limiter.consume("admin");
      const result = limiter.consume("admin");

      expect(result.allowed).toBe(false);

      // But read should still have tokens
      const readResult = limiter.consume("read");
      expect(readResult.allowed).toBe(true);
    });

    it("should refill tokens over time", async () => {
      // Exhaust all write tokens (3)
      for (let i = 0; i < 3; i++) limiter.consume("write");

      const exhausted = limiter.consume("write");
      expect(exhausted.allowed).toBe(false);

      // Wait for refill (write refills at 0.5/sec, need 1 token = 2 seconds)
      await new Promise((resolve) => setTimeout(resolve, 2100));

      const refilled = limiter.consume("write");
      expect(refilled.allowed).toBe(true);
    }, 5000);

    it("should not exceed max tokens during refill", async () => {
      // Wait a long time — tokens should cap at maxTokens
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = limiter.peek("read");
      expect(result.remaining).toBeLessThanOrEqual(5);
    });
  });

  describe("peek", () => {
    it("should return state without consuming tokens", () => {
      const before = limiter.peek("read");
      const after = limiter.peek("read");

      expect(before.remaining).toBe(after.remaining);
    });
  });

  describe("reset", () => {
    it("should restore all buckets to full capacity", () => {
      // Drain some tokens
      limiter.consume("read");
      limiter.consume("read");
      limiter.consume("write");

      // Reset
      limiter.reset();

      // Should be back to full
      const result = limiter.peek("read");
      expect(result.remaining).toBe(5);
    });

    it("should reset a specific category only", () => {
      limiter.consume("read");
      limiter.consume("write");

      limiter.resetCategory("read");

      // Read should be full
      const readResult = limiter.peek("read");
      expect(readResult.remaining).toBe(5);

      // Write should still be depleted by 1
      const writeResult = limiter.peek("write");
      expect(writeResult.remaining).toBe(2);
    });
  });

  describe("retryAfterMs", () => {
    it("should return a positive retry time when rejected", () => {
      for (let i = 0; i < 2; i++) limiter.consume("admin");

      const result = limiter.consume("admin");
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(typeof result.retryAfterMs).toBe("number");
    });
  });
});
