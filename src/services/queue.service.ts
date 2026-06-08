import { Job } from "bullmq";
import { ConnectionService } from "./connection.service.js";

export class QueueService {
  constructor(private connectionService: ConnectionService) {}

  async listQueues(pattern: string = "*", connectionId: string): Promise<string[]> {
    const redis = this.connectionService.getRedis(connectionId);
    const queueNames = new Set<string>();

    const stream = redis.scanStream({ match: `bull:${pattern}:*`, count: 200 });
    for await (const keys of stream) {
      for (const key of keys as string[]) {
        const match = key.match(/^bull:([^:]+):/);
        if (match) queueNames.add(match[1]);
      }
    }
    return Array.from(queueNames).sort();
  }

  async getStats(queueName: string, connectionId: string): Promise<Record<string, number>> {
    const queue = this.connectionService.getQueue(queueName, connectionId);
    return await queue.getJobCounts();
  }

  async pauseQueue(queueName: string, connectionId: string): Promise<void> {
    const queue = this.connectionService.getQueue(queueName, connectionId);
    await queue.pause();
  }

  async resumeQueue(queueName: string, connectionId: string): Promise<void> {
    const queue = this.connectionService.getQueue(queueName, connectionId);
    await queue.resume();
  }

  async drainQueue(queueName: string, connectionId: string): Promise<void> {
    const queue = this.connectionService.getQueue(queueName, connectionId);
    await queue.drain();
  }

  async cleanQueue(
    queueName: string,
    grace: number = 0,
    limit: number = 1000,
    status: "completed" | "failed" = "completed",
    connectionId: string
  ): Promise<number> {
    const queue = this.connectionService.getQueue(queueName, connectionId);
    const cleaned = await queue.clean(grace, limit, status);
    return cleaned.length;
  }
}
