import type { FailureAnalysisResult, FailureGroup } from "../types/index.js";
import { ConnectionService } from "../services/connection.service.js";

/**
 * Failure Analysis Engine
 *
 * Analyzes failed jobs across queues by:
 *  1. Grouping similar errors via normalized string matching
 *  2. Computing failure rates and trends over time
 *  3. Suggesting probable root causes based on error patterns
 *
 * This is a practical application of data aggregation and
 * pattern recognition — useful for ops dashboards and SRE workflows.
 */
export class FailureAnalyzer {
  constructor(private connectionService: ConnectionService) {}

  /**
   * Analyze failures for a specific queue within a time window.
   */
  async analyzeFailures(
    queueName: string,
    windowMs: number = 24 * 60 * 60 * 1000, // default: last 24h
    limit: number = 500
  ): Promise<FailureAnalysisResult> {
    const queue = this.connectionService.getQueue(queueName);

    // Fetch failed and total job counts
    const counts = await queue.getJobCounts();
    const totalFailed = counts.failed || 0;
    const totalJobs = Object.values(counts).reduce((a, b) => a + b, 0);

    // Fetch failed jobs (up to limit)
    const failedJobs = await queue.getFailed(0, limit);
    const cutoff = Date.now() - windowMs;

    // Filter to the time window
    const recentFailures = failedJobs.filter(
      (job) => job.timestamp >= cutoff
    );

    // Group failures by normalized error message
    const errorGroups = new Map<
      string,
      {
        count: number;
        jobIds: string[];
        firstSeen: number;
        lastSeen: number;
        rawError: string;
      }
    >();

    for (const job of recentFailures) {
      const rawError = job.failedReason || "Unknown error";
      const pattern = this.normalizeError(rawError);

      if (!errorGroups.has(pattern)) {
        errorGroups.set(pattern, {
          count: 0,
          jobIds: [],
          firstSeen: job.timestamp,
          lastSeen: job.timestamp,
          rawError,
        });
      }

      const group = errorGroups.get(pattern)!;
      group.count++;
      if (group.jobIds.length < 5) group.jobIds.push(job.id || "unknown");
      group.firstSeen = Math.min(group.firstSeen, job.timestamp);
      group.lastSeen = Math.max(group.lastSeen, job.timestamp);
    }

    // Convert to sorted FailureGroup array
    const groups: FailureGroup[] = Array.from(errorGroups.entries())
      .map(([pattern, data]) => ({
        pattern,
        count: data.count,
        percentage:
          recentFailures.length > 0
            ? Math.round((data.count / recentFailures.length) * 100)
            : 0,
        sampleJobIds: data.jobIds,
        firstSeen: data.firstSeen,
        lastSeen: data.lastSeen,
        suggestedCause: this.suggestCause(data.rawError),
      }))
      .sort((a, b) => b.count - a.count);

    // Build hourly trend
    const trendByHour: Record<string, number> = {};
    for (const job of recentFailures) {
      const hourKey = new Date(job.timestamp).toISOString().slice(0, 13) + ":00";
      trendByHour[hourKey] = (trendByHour[hourKey] || 0) + 1;
    }

    return {
      queueName,
      totalFailed,
      totalJobs,
      failureRate:
        totalJobs > 0
          ? Math.round((totalFailed / totalJobs) * 10000) / 100
          : 0,
      groups,
      trendByHour,
      analyzedAt: Date.now(),
    };
  }

  /**
   * Get a summary of failure stats across all queues.
   */
  async getFailureSummary(): Promise<
    Array<{
      queueName: string;
      totalFailed: number;
      totalJobs: number;
      failureRate: number;
      topError: string | null;
    }>
  > {
    const redis = this.connectionService.getRedis();
    const keys = await redis.keys("bull:*:*");

    const queueNames = new Set<string>();
    for (const key of keys) {
      const match = key.match(/^bull:([^:]+):/);
      if (match) queueNames.add(match[1]);
    }

    const summaries = [];
    for (const queueName of queueNames) {
      const queue = this.connectionService.getQueue(queueName);
      const counts = await queue.getJobCounts();
      const totalFailed = counts.failed || 0;
      const totalJobs = Object.values(counts).reduce((a, b) => a + b, 0);

      let topError: string | null = null;
      if (totalFailed > 0) {
        const failedJobs = await queue.getFailed(0, 1);
        if (failedJobs.length > 0) {
          topError = failedJobs[0].failedReason || null;
        }
      }

      summaries.push({
        queueName,
        totalFailed,
        totalJobs,
        failureRate:
          totalJobs > 0
            ? Math.round((totalFailed / totalJobs) * 10000) / 100
            : 0,
        topError,
      });
    }

    return summaries.sort((a, b) => b.failureRate - a.failureRate);
  }

  /**
   * Normalize an error message by stripping variable parts
   * (IDs, timestamps, numbers, paths) to group similar errors.
   */
  private normalizeError(error: string): string {
    return error
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<UUID>")
      .replace(/\b\d{10,13}\b/g, "<TIMESTAMP>")
      .replace(/\b\d+\.\d+\.\d+\.\d+\b/g, "<IP>")
      .replace(/:\d{2,5}\b/g, ":<PORT>")
      .replace(/\b\d+\b/g, "<N>")
      .replace(/\/[^\s]+/g, "<PATH>")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
  }

  /**
   * Suggest a probable root cause based on error message patterns.
   * Maps common error signatures to actionable suggestions.
   */
  private suggestCause(error: string): string {
    const lower = error.toLowerCase();

    if (lower.includes("timeout") || lower.includes("timed out")) {
      return "Connection or processing timeout — consider increasing timeout limits or checking target service health";
    }
    if (lower.includes("econnrefused") || lower.includes("connection refused")) {
      return "Target service is down or unreachable — verify the service is running and the host/port are correct";
    }
    if (lower.includes("econnreset") || lower.includes("connection reset")) {
      return "Connection was forcibly closed — possible network instability or server overload";
    }
    if (lower.includes("enomem") || lower.includes("out of memory") || lower.includes("heap")) {
      return "Memory exhaustion — check for memory leaks or increase available memory / reduce payload sizes";
    }
    if (lower.includes("rate limit") || lower.includes("429") || lower.includes("too many")) {
      return "External API rate limit hit — implement backoff/retry strategy or reduce request frequency";
    }
    if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("forbidden")) {
      return "Authentication/authorization failure — check API keys, tokens, or permissions";
    }
    if (lower.includes("404") || lower.includes("not found")) {
      return "Resource not found — verify the endpoint URL or resource ID is correct";
    }
    if (lower.includes("500") || lower.includes("internal server")) {
      return "Upstream server error — issue is on the target service side, check its logs";
    }
    if (lower.includes("dns") || lower.includes("getaddrinfo")) {
      return "DNS resolution failure — check hostname spelling and DNS configuration";
    }
    if (lower.includes("certificate") || lower.includes("ssl") || lower.includes("tls")) {
      return "TLS/SSL error — check certificate validity and trust chain configuration";
    }

    return "Unknown failure pattern — inspect job stacktrace for more details";
  }
}
