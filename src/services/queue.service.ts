import { Job } from "bullmq";
import { ConnectionService } from "./connection.service.js";

/**
 * Handles all queue-level operations: listing, pausing, resuming,
 * draining, cleaning, and fetching statistics.
 */
export class QueueService {
  constructor(private connectionService: ConnectionService) {}

  /**
   * List all BullMQ queues discovered via Redis key scanning.
   */
  async listQueues(pattern: string = "*"): Promise<string[]> {
    const redis = this.connectionService.getRedis();
    const keys = await redis.keys(`bull:${pattern}:*`);

    const queueNames = new Set<string>();
    for (const key of keys) {
      const match = key.match(/^bull:([^:]+):/);
      if (match) queueNames.add(match[1]);
    }

    return Array.from(queueNames).sort();
  }

  /**
   * Get job count statistics for a specific queue.
   */
  async getStats(queueName: string): Promise<Record<string, number>> {
    const queue = this.connectionService.getQueue(queueName);
    return await queue.getJobCounts();
  }

  /**
   * Pause processing for a specific queue.
   */
  async pauseQueue(queueName: string): Promise<void> {
    const queue = this.connectionService.getQueue(queueName);
    await queue.pause();
  }

  /**
   * Resume processing for a paused queue.
   */
  async resumeQueue(queueName: string): Promise<void> {
    const queue = this.connectionService.getQueue(queueName);
    await queue.resume();
  }

  /**
   * Remove all jobs from a queue (drain).
   */
  async drainQueue(queueName: string): Promise<void> {
    const queue = this.connectionService.getQueue(queueName);
    await queue.drain();
  }

  /**
   * Clean jobs by status with a configurable grace period and limit.
   */
  async cleanQueue(
    queueName: string,
    grace: number = 0,
    limit: number = 1000,
    status: "completed" | "failed" = "completed"
  ): Promise<number> {
    const queue = this.connectionService.getQueue(queueName);
    const cleaned = await queue.clean(grace, limit, status);
    return cleaned.length;
  }
}
