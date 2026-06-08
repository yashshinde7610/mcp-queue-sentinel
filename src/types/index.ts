import { Queue, QueueEvents } from "bullmq";
import { Redis } from "ioredis";

/** A Redis connection with its associated BullMQ queues and event listeners. */
export interface Connection {
  redis: Redis;
  queues: Map<string, Queue>;
  queueEvents: Map<string, QueueEvents>;
}

export interface RedisConnectionConfig {
  id: string;
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
}

export interface QueueMetrics {
  queueName: string;
  toolCalls: number;
  jobsAdded: number;
  jobsFailed: number;
  jobsCompleted: number;
  avgProcessingTimeMs: number;
  timestamp: number;
}

export interface MetricsSnapshot {
  totalToolCalls: number;
  toolCallBreakdown: Record<string, number>;
  queues: QueueMetrics[];
  uptime: number;
  timestamp: number;
}

export interface FailureGroup {
  pattern: string;
  count: number;
  percentage: number;
  sampleJobIds: string[];
  firstSeen: number;
  lastSeen: number;
  suggestedCause: string;
}

export interface FailureAnalysisResult {
  queueName: string;
  totalFailed: number;
  totalJobs: number;
  failureRate: number;
  groups: FailureGroup[];
  trendByHour: Record<string, number>;
  analyzedAt: number;
}
