import { MetricsCollector } from "../monitoring/metrics-collector.js";
import type { QueueMetrics } from "../types/index.js";

describe("MetricsCollector", () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  describe("recordToolCall", () => {
    it("should count tool invocations", () => {
      collector.recordToolCall("get_jobs");
      collector.recordToolCall("get_jobs");
      collector.recordToolCall("add_job");

      const snapshot = collector.getSnapshot();
      expect(snapshot.totalToolCalls).toBe(3);
      expect(snapshot.toolCallBreakdown["get_jobs"]).toBe(2);
      expect(snapshot.toolCallBreakdown["add_job"]).toBe(1);
    });
  });

  describe("queue metrics", () => {
    it("should track jobs added per queue", () => {
      collector.recordJobAdded("email-queue");
      collector.recordJobAdded("email-queue");
      collector.recordJobAdded("payment-queue");

      const snapshot = collector.getSnapshot();
      const emailQueue = snapshot.queues.find((q: QueueMetrics) => q.queueName === "email-queue");
      const paymentQueue = snapshot.queues.find((q: QueueMetrics) => q.queueName === "payment-queue");

      expect(emailQueue?.jobsAdded).toBe(2);
      expect(paymentQueue?.jobsAdded).toBe(1);
    });

    it("should track job failures", () => {
      collector.recordJobFailed("email-queue");
      collector.recordJobFailed("email-queue");

      const snapshot = collector.getSnapshot();
      const emailQueue = snapshot.queues.find((q: QueueMetrics) => q.queueName === "email-queue");
      expect(emailQueue?.jobsFailed).toBe(2);
    });

    it("should compute average processing time", () => {
      collector.recordJobCompleted("api-queue", 100);
      collector.recordJobCompleted("api-queue", 200);
      collector.recordJobCompleted("api-queue", 300);

      const snapshot = collector.getSnapshot();
      const apiQueue = snapshot.queues.find((q: QueueMetrics) => q.queueName === "api-queue");
      expect(apiQueue?.avgProcessingTimeMs).toBe(200); // (100+200+300)/3
    });
  });

  describe("reset", () => {
    it("should clear all metrics", () => {
      collector.recordToolCall("stats");
      collector.recordJobAdded("test-queue");

      collector.reset();

      const snapshot = collector.getSnapshot();
      expect(snapshot.totalToolCalls).toBe(0);
      expect(snapshot.queues).toHaveLength(0);
    });
  });

  describe("uptime", () => {
    it("should report positive uptime", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const snapshot = collector.getSnapshot();
      expect(snapshot.uptime).toBeGreaterThan(0);
    });
  });

  describe("snapshot structure", () => {
    it("should return a well-formed MetricsSnapshot", () => {
      const snapshot = collector.getSnapshot();

      expect(snapshot).toHaveProperty("totalToolCalls");
      expect(snapshot).toHaveProperty("toolCallBreakdown");
      expect(snapshot).toHaveProperty("queues");
      expect(snapshot).toHaveProperty("uptime");
      expect(snapshot).toHaveProperty("timestamp");
      expect(typeof snapshot.timestamp).toBe("number");
    });
  });
});
