import { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * MCP tool definitions for individual job operations.
 */
export const jobTools: Tool[] = [
  {
    name: "get_jobs",
    description: "Get jobs from a queue filtered by status",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "Queue name" },
        status: {
          type: "string",
          enum: ["active", "waiting", "completed", "failed", "delayed", "paused", "repeat", "wait"],
          description: "Job status to filter by",
        },
        start: { type: "number", description: "Start index", default: 0 },
        end: { type: "number", description: "End index", default: 10 },
      },
      required: ["queue", "status"],
    },
  },
  {
    name: "get_job",
    description: "Get a specific job by ID with full details",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "Queue name" },
        jobId: { type: "string", description: "Job ID" },
      },
      required: ["queue", "jobId"],
    },
  },
  {
    name: "add_job",
    description: "Add a new job to a queue",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "Queue name" },
        name: { type: "string", description: "Job name" },
        data: { type: "object", description: "Job data (JSON)" },
        opts: {
          type: "object",
          description: "Job options",
          properties: {
            delay: { type: "number", description: "Delay in ms" },
            priority: { type: "number", description: "Job priority" },
            attempts: { type: "number", description: "Max attempts" },
            backoff: { type: "object", description: "Backoff config" },
            removeOnComplete: { type: "boolean", description: "Remove on complete" },
            removeOnFail: { type: "boolean", description: "Remove on fail" },
          },
        },
      },
      required: ["queue", "name", "data"],
    },
  },
  {
    name: "remove_job",
    description: "Remove a job from a queue",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "Queue name" },
        jobId: { type: "string", description: "Job ID" },
      },
      required: ["queue", "jobId"],
    },
  },
  {
    name: "retry_job",
    description: "Retry a failed job",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "Queue name" },
        jobId: { type: "string", description: "Job ID" },
      },
      required: ["queue", "jobId"],
    },
  },
  {
    name: "promote_job",
    description: "Promote a delayed job to be processed immediately",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "Queue name" },
        jobId: { type: "string", description: "Job ID" },
      },
      required: ["queue", "jobId"],
    },
  },
  {
    name: "get_job_logs",
    description: "Get log entries for a job",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "Queue name" },
        jobId: { type: "string", description: "Job ID" },
      },
      required: ["queue", "jobId"],
    },
  },
  {
    name: "add_job_log",
    description: "Add a log entry to a job",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "Queue name" },
        jobId: { type: "string", description: "Job ID" },
        message: { type: "string", description: "Log message" },
      },
      required: ["queue", "jobId", "message"],
    },
  },
  {
    name: "move_failed_jobs_to_dlq",
    description: "Move failed jobs to a dead-letter queue with configurable TTL",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "Source queue name" },
        jobName: { type: "string", description: "Job name to filter" },
        beforeTimestamp: { type: "number", description: "Unix timestamp (ms) — move jobs created before this" },
        dlqKey: { type: "string", description: "DLQ Redis key", default: "dlq:failed_jobs" },
        ttlDays: { type: "number", description: "TTL in days for DLQ entries", default: 30 },
        dryRun: { type: "boolean", description: "Preview without moving", default: false },
      },
      required: ["queue", "jobName", "beforeTimestamp"],
    },
  },
  {
    name: "query_dead_letter_queue",
    description: "Query jobs in the dead-letter queue",
    inputSchema: {
      type: "object",
      properties: {
        dlqKey: { type: "string", description: "DLQ Redis key", default: "dlq:failed_jobs" },
        jobName: { type: "string", description: "Filter by job name" },
        limit: { type: "number", description: "Max results", default: 10 },
      },
    },
  },
];
