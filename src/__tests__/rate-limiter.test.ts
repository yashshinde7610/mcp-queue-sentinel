import { TokenBucketRateLimiter } from "../middleware/rate-limiter.js";

// Tests run without Redis (REDIS_URL not set), so they exercise the in-memory fallback.
// This validates the token bucket algorithm itself; Redis integration is tested via docker-compose.
describe("TokenBucketRateLimiter", () => {
  let limiter: TokenBucketRateLimiter;

  beforeEach(() => {
    // Override REDIS_URL to ensure in-memory mode
    delete process.env.REDIS_URL;
    limiter = new TokenBucketRateLimiter({
      read: { maxTokens: 5, refillRate: 1, refillInterval: 1000 },
      write: { maxTokens: 3, refillRate: 0.5, refillInterval: 1000 },
      admin: { maxTokens: 2, refillRate: 0.25, refillInterval: 1000 },
    });
  });

  afterEach(async () => {
    await limiter.shutdown();
  });

  describe("consume", () => {
    it("should allow requests when tokens are available", async () => {
      const result = await limiter.consume("read");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
      expect(result.retryAfterMs).toBe(0);
    });

    it("should track remaining tokens correctly", async () => {
      await limiter.consume("read");
      await limiter.consume("read");
      await limiter.consume("read");
      const result = await limiter.consume("read");

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });

    it("should reject when all tokens are exhausted", async () => {
      for (let i = 0; i < 5; i++) {
        const r = await limiter.consume("read");
        expect(r.allowed).toBe(true);
      }

      const result = await limiter.consume("read");
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it("should apply different limits per category", async () => {
      await limiter.consume("admin");
      await limiter.consume("admin");
      const result = await limiter.consume("admin");
      expect(result.allowed).toBe(false);

      // Read should still have tokens (independent bucket)
      const readResult = await limiter.consume("read");
      expect(readResult.allowed).toBe(true);
    });

    it("should scope rate limits per connection ID", async () => {
      // Exhaust all admin tokens for connection "conn-a"
      await limiter.consume("admin", "conn-a");
      await limiter.consume("admin", "conn-a");
      const exhausted = await limiter.consume("admin", "conn-a");
      expect(exhausted.allowed).toBe(false);

      // Connection "conn-b" should still have tokens
      const otherConn = await limiter.consume("admin", "conn-b");
      expect(otherConn.allowed).toBe(true);
    });

    it("should refill tokens over time", async () => {
      for (let i = 0; i < 3; i++) await limiter.consume("write");

      const exhausted = await limiter.consume("write");
      expect(exhausted.allowed).toBe(false);

      // Wait for refill (write refills at 0.5/sec, need 1 token = 2 seconds)
      await new Promise((resolve) => setTimeout(resolve, 2100));

      const refilled = await limiter.consume("write");
      expect(refilled.allowed).toBe(true);
    }, 5000);

    it("should not exceed max tokens during refill", async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await limiter.peek("read");
      expect(result.remaining).toBeLessThanOrEqual(5);
    });
  });

  describe("peek", () => {
    it("should return state without consuming tokens", async () => {
      const before = await limiter.peek("read");
      const after = await limiter.peek("read");
      expect(before.remaining).toBe(after.remaining);
    });
  });

  describe("reset", () => {
    it("should restore all buckets to full capacity", async () => {
      await limiter.consume("read");
      await limiter.consume("read");
      await limiter.consume("write");

      await limiter.reset();

      const result = await limiter.peek("read");
      expect(result.remaining).toBe(5);
    });

    it("should reset a specific category only", async () => {
      await limiter.consume("read");
      await limiter.consume("write");

      await limiter.resetCategory("read");

      const readResult = await limiter.peek("read");
      expect(readResult.remaining).toBe(5);

      const writeResult = await limiter.peek("write");
      expect(writeResult.remaining).toBe(2);
    });
  });

  describe("retryAfterMs", () => {
    it("should return a positive retry time when rejected", async () => {
      for (let i = 0; i < 2; i++) await limiter.consume("admin");

      const result = await limiter.consume("admin");
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(typeof result.retryAfterMs).toBe("number");
    });
  });
});
