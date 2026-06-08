import { Tool } from "@modelcontextprotocol/sdk/types.js";

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
        connectionId: { type: "string", description: "Target connection ID" },
      },
      required: ["queue", "status", "connectionId"],
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
        connectionId: { type: "string", description: "Target connection ID" },
      },
      required: ["queue", "jobId", "connectionId"],
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
        connectionId: { type: "string", description: "Target connection ID" },
      },
      required: ["queue", "name", "data", "connectionId"],
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
        connectionId: { type: "string", description: "Target connection ID" },
      },
      required: ["queue", "jobId", "connectionId"],
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
        connectionId: { type: "string", description: "Target connection ID" },
      },
      required: ["queue", "jobId", "connectionId"],
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
        connectionId: { type: "string", description: "Target connection ID" },
      },
      required: ["queue", "jobId", "connectionId"],
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
        connectionId: { type: "string", description: "Target connection ID" },
      },
      required: ["queue", "jobId", "connectionId"],
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
        connectionId: { type: "string", description: "Target connection ID" },
      },
      required: ["queue", "jobId", "message", "connectionId"],
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
        connectionId: { type: "string", description: "Target connection ID" },
      },
      required: ["queue", "jobName", "beforeTimestamp", "connectionId"],
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
        connectionId: { type: "string", description: "Target connection ID" },
      },
    },
  },
];
