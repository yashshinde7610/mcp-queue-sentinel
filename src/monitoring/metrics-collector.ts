import type { MetricsSnapshot, QueueMetrics } from "../types/index.js";

/**
 * In-memory metrics collector that tracks tool invocations,
 * queue activity, and rate limit events. Metrics can be
 * periodically flushed to Redis for persistence if needed.
 */
export class MetricsCollector {
  private toolCalls = new Map<string, number>();
  private queueMetrics = new Map<
    string,
    {
      jobsAdded: number;
      jobsFailed: number;
      jobsCompleted: number;
      processingTimes: number[];
    }
  >();
  private rateLimitHits = 0;
  private startTime = Date.now();

  /**
   * Record a tool invocation.
   */
  recordToolCall(toolName: string): void {
    const current = this.toolCalls.get(toolName) || 0;
    this.toolCalls.set(toolName, current + 1);
  }

  /**
   * Record a job being added to a queue.
   */
  recordJobAdded(queueName: string): void {
    this.ensureQueueMetrics(queueName);
    this.queueMetrics.get(queueName)!.jobsAdded++;
  }

  /**
   * Record a job failure.
   */
  recordJobFailed(queueName: string): void {
    this.ensureQueueMetrics(queueName);
    this.queueMetrics.get(queueName)!.jobsFailed++;
  }

  /**
   * Record a job completion with processing time.
   */
  recordJobCompleted(queueName: string, processingTimeMs: number): void {
    this.ensureQueueMetrics(queueName);
    const metrics = this.queueMetrics.get(queueName)!;
    metrics.jobsCompleted++;
    metrics.processingTimes.push(processingTimeMs);

    // Keep only last 1000 processing times to avoid memory leaks
    if (metrics.processingTimes.length > 1000) {
      metrics.processingTimes = metrics.processingTimes.slice(-500);
    }
  }

  /**
   * Record a rate limit rejection.
   */
  recordRateLimitHit(): void {
    this.rateLimitHits++;
  }

  /**
   * Get a complete snapshot of all current metrics.
   */
  getSnapshot(): MetricsSnapshot {
    const toolCallBreakdown: Record<string, number> = {};
    let totalToolCalls = 0;

    for (const [tool, count] of this.toolCalls) {
      toolCallBreakdown[tool] = count;
      totalToolCalls += count;
    }

    const queues: QueueMetrics[] = [];
    for (const [queueName, metrics] of this.queueMetrics) {
      const avgTime =
        metrics.processingTimes.length > 0
          ? metrics.processingTimes.reduce((a, b) => a + b, 0) /
            metrics.processingTimes.length
          : 0;

      queues.push({
        queueName,
        toolCalls: 0, // per-queue tool calls not tracked separately
        jobsAdded: metrics.jobsAdded,
        jobsFailed: metrics.jobsFailed,
        jobsCompleted: metrics.jobsCompleted,
        avgProcessingTimeMs: Math.round(avgTime),
        timestamp: Date.now(),
      });
    }

    return {
      totalToolCalls,
      toolCallBreakdown,
      queues,
      rateLimitHits: this.rateLimitHits,
      uptime: Date.now() - this.startTime,
      timestamp: Date.now(),
    };
  }

  /**
   * Reset all metrics counters.
   */
  reset(): void {
    this.toolCalls.clear();
    this.queueMetrics.clear();
    this.rateLimitHits = 0;
    this.startTime = Date.now();
  }

  private ensureQueueMetrics(queueName: string): void {
    if (!this.queueMetrics.has(queueName)) {
      this.queueMetrics.set(queueName, {
        jobsAdded: 0,
        jobsFailed: 0,
        jobsCompleted: 0,
        processingTimes: [],
      });
    }
  }
}
