import { Queue, Worker, QueueEvents } from "bullmq";
import { Redis } from "ioredis";

/**
 * Represents a single Redis connection with its associated
 * BullMQ queues, workers, and event listeners.
 */
export interface Connection {
  redis: Redis;
  queues: Map<string, Queue>;
  workers: Map<string, Worker>;
  queueEvents: Map<string, QueueEvents>;
}

/**
 * Configuration for establishing a Redis connection.
 */
export interface RedisConnectionConfig {
  id: string;
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
}

/**
 * Rate limiter configuration per tool category.
 */
export interface RateLimitConfig {
  maxTokens: number;
  refillRate: number; // tokens per second
  refillInterval: number; // milliseconds
}

/**
 * Rate limit tiers for different operation categories.
 */
export interface RateLimitTiers {
  read: RateLimitConfig;
  write: RateLimitConfig;
  admin: RateLimitConfig;
}

/**
 * Result from a rate limit check.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  limit: number;
}

/**
 * A snapshot of current metrics for a queue.
 */
export interface QueueMetrics {
  queueName: string;
  toolCalls: number;
  jobsAdded: number;
  jobsFailed: number;
  jobsCompleted: number;
  avgProcessingTimeMs: number;
  timestamp: number;
}

/**
 * Aggregated metrics across all queues.
 */
export interface MetricsSnapshot {
  totalToolCalls: number;
  toolCallBreakdown: Record<string, number>;
  queues: QueueMetrics[];
  rateLimitHits: number;
  uptime: number;
  timestamp: number;
}

/**
 * A group of similar failures for analysis.
 */
export interface FailureGroup {
  pattern: string;
  count: number;
  percentage: number;
  sampleJobIds: string[];
  firstSeen: number;
  lastSeen: number;
  suggestedCause: string;
}

/**
 * Result from failure analysis.
 */
export interface FailureAnalysisResult {
  queueName: string;
  totalFailed: number;
  totalJobs: number;
  failureRate: number;
  groups: FailureGroup[];
  trendByHour: Record<string, number>;
  analyzedAt: number;
}

/**
 * Tool category for rate limiting.
 */
export type ToolCategory = "read" | "write" | "admin";

/**
 * Maps each tool name to its rate limit category.
 */
export const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  // Read operations
  list_connections: "read",
  stats: "read",
  get_jobs: "read",
  get_job: "read",
  get_job_logs: "read",
  list_queues: "read",
  query_dead_letter_queue: "read",
  get_metrics: "read",
  get_failure_summary: "read",

  // Write operations
  connect: "write",
  disconnect: "write",
  switch_connection: "write",
  add_job: "write",
  remove_job: "write",
  retry_job: "write",
  promote_job: "write",
  add_job_log: "write",
  move_failed_jobs_to_dlq: "write",

  // Admin operations
  clean_queue: "admin",
  pause_queue: "admin",
  resume_queue: "admin",
  drain_queue: "admin",
  reset_metrics: "admin",
  analyze_failures: "admin",
};
