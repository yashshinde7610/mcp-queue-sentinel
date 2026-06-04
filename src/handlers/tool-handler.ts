import { ConnectionService } from "../services/connection.service.js";
import { QueueService } from "../services/queue.service.js";
import { JobService } from "../services/job.service.js";
import { FailureAnalyzer } from "../analytics/failure-analyzer.js";
import { TokenBucketRateLimiter } from "../middleware/rate-limiter.js";
import { MetricsCollector } from "../monitoring/metrics-collector.js";
import { TOOL_CATEGORIES } from "../types/index.js";
import type { ToolCategory } from "../types/index.js";

/**
 * Central tool dispatcher. Routes incoming MCP tool calls to the
 * appropriate service, applying rate limiting and metrics collection
 * as cross-cutting concerns (middleware pattern).
 */
export class ToolHandler {
  private connectionService: ConnectionService;
  private queueService: QueueService;
  private jobService: JobService;
  private failureAnalyzer: FailureAnalyzer;
  private rateLimiter: TokenBucketRateLimiter;
  private metrics: MetricsCollector;

  constructor(
    connectionService: ConnectionService,
    rateLimiter: TokenBucketRateLimiter,
    metrics: MetricsCollector
  ) {
    this.connectionService = connectionService;
    this.queueService = new QueueService(connectionService);
    this.jobService = new JobService(connectionService);
    this.failureAnalyzer = new FailureAnalyzer(connectionService);
    this.rateLimiter = rateLimiter;
    this.metrics = metrics;
  }

  /**
   * Handle an incoming tool call. Applies rate limiting, records metrics,
   * and dispatches to the appropriate service method.
   */
  async handle(
    name: string,
    args: Record<string, any>
  ): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    try {
      // --- Rate Limiting (middleware) ---
      const category = TOOL_CATEGORIES[name] || ("read" as ToolCategory);
      const limitResult = this.rateLimiter.consume(category);

      if (!limitResult.allowed) {
        this.metrics.recordRateLimitHit();
        return {
          content: [
            {
              type: "text",
              text: `Rate limit exceeded for ${category} operations. Retry after ${limitResult.retryAfterMs}ms. Remaining: ${limitResult.remaining}/${limitResult.limit}`,
            },
          ],
          isError: true,
        };
      }

      // --- Metrics ---
      this.metrics.recordToolCall(name);

      // --- Dispatch ---
      const result = await this.dispatch(name, args);

      return {
        content: [
          {
            type: "text",
            text:
              typeof result === "string"
                ? result
                : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Route the tool call to the correct service method.
   */
  private async dispatch(
    name: string,
    args: Record<string, any>
  ): Promise<unknown> {
    switch (name) {
      // === Connection tools ===
      case "connect":
        return this.connectionService.connect(args as any);

      case "disconnect":
        return this.connectionService.disconnect();

      case "list_connections": {
        const conns = this.connectionService.listConnections();
        return conns.length === 0
          ? "No connections available"
          : `Connections:\n${conns.map((c) => `- ${c.id}${c.active ? " (active)" : ""}`).join("\n")}`;
      }

      case "switch_connection":
        return this.connectionService.switchConnection(args.id);

      // === Queue tools ===
      case "list_queues": {
        const queues = await this.queueService.listQueues(args.pattern);
        return queues.length === 0
          ? "No queues found"
          : `Queues:\n${queues.map((q) => `- ${q}`).join("\n")}`;
      }

      case "stats": {
        const counts = await this.queueService.getStats(args.queue);
        return `Queue: ${args.queue}\n${Object.entries(counts)
          .map(([status, count]) => `- ${status}: ${count}`)
          .join("\n")}`;
      }

      case "pause_queue":
        await this.queueService.pauseQueue(args.queue);
        return `Queue ${args.queue} paused`;

      case "resume_queue":
        await this.queueService.resumeQueue(args.queue);
        return `Queue ${args.queue} resumed`;

      case "drain_queue":
        await this.queueService.drainQueue(args.queue);
        return `Queue ${args.queue} drained`;

      case "clean_queue": {
        const cleaned = await this.queueService.cleanQueue(
          args.queue,
          args.grace,
          args.limit,
          args.status
        );
        return `Cleaned ${cleaned} ${args.status || "completed"} jobs from queue ${args.queue}`;
      }

      // === Job tools ===
      case "get_jobs":
        return this.jobService.getJobs(args.queue, args.status, args.start, args.end);

      case "get_job":
        return this.jobService.getJob(args.queue, args.jobId);

      case "add_job": {
        this.metrics.recordJobAdded(args.queue);
        const job = await this.jobService.addJob(args.queue, args.name, args.data, args.opts);
        return `Job added successfully:\n- ID: ${job.id}\n- Name: ${job.name}\n- Queue: ${args.queue}`;
      }

      case "remove_job":
        await this.jobService.removeJob(args.queue, args.jobId);
        return `Job ${args.jobId} removed from queue ${args.queue}`;

      case "retry_job":
        await this.jobService.retryJob(args.queue, args.jobId);
        return `Job ${args.jobId} retried in queue ${args.queue}`;

      case "promote_job":
        await this.jobService.promoteJob(args.queue, args.jobId);
        return `Job ${args.jobId} promoted in queue ${args.queue}`;

      case "get_job_logs": {
        const logs = await this.jobService.getJobLogs(args.queue, args.jobId);
        return logs.join("\n") || "No logs available";
      }

      case "add_job_log":
        await this.jobService.addJobLog(args.queue, args.jobId, args.message);
        return `Log added to job ${args.jobId}`;

      case "move_failed_jobs_to_dlq": {
        const result = await this.jobService.moveFailedToDLQ(
          args.queue,
          args.jobName,
          args.beforeTimestamp,
          args.dlqKey,
          args.ttlDays,
          args.dryRun
        );
        return args.dryRun
          ? `DRY RUN: Would move ${result.totalMoved} failed "${args.jobName}" jobs\n\nSample:\n${result.movedJobs.slice(0, 5).map((j: any) => `- Job ${j.jobId}: ${j.failedReason}`).join("\n")}`
          : `Moved ${result.totalMoved} failed "${args.jobName}" jobs to DLQ "${args.dlqKey}" with ${args.ttlDays || 30} day TTL`;
      }

      case "query_dead_letter_queue": {
        const dlqJobs = await this.jobService.queryDLQ(args.dlqKey, args.jobName, args.limit);
        return dlqJobs.length === 0
          ? `No jobs found in DLQ "${args.dlqKey || "dlq:failed_jobs"}"`
          : dlqJobs;
      }

      // === Monitoring tools ===
      case "get_metrics":
        return this.metrics.getSnapshot();

      case "reset_metrics":
        this.metrics.reset();
        return "All metrics counters have been reset";

      // === Failure Analysis tools ===
      case "analyze_failures":
        return this.failureAnalyzer.analyzeFailures(
          args.queue,
          args.windowMs,
          args.limit
        );

      case "get_failure_summary":
        return this.failureAnalyzer.getFailureSummary();

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
