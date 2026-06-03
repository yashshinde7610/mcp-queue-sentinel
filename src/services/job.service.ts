import { Job } from "bullmq";
import { ConnectionService } from "./connection.service.js";

/**
 * Handles individual job operations: CRUD, retry, promote,
 * logging, and dead-letter queue management.
 */
export class JobService {
  constructor(private connectionService: ConnectionService) {}

  /**
   * Get jobs from a queue filtered by status.
   */
  async getJobs(
    queueName: string,
    status: string,
    start: number = 0,
    end: number = 10
  ): Promise<any[]> {
    const queue = this.connectionService.getQueue(queueName);

    if (status === "repeat") {
      return await queue.getRepeatableJobs(start, end);
    }

    let jobs: Job[] = [];
    switch (status) {
      case "active":
        jobs = await queue.getActive(start, end);
        break;
      case "waiting":
      case "paused":
        jobs = await queue.getWaiting(start, end);
        break;
      case "completed":
        jobs = await queue.getCompleted(start, end);
        break;
      case "failed":
        jobs = await queue.getFailed(start, end);
        break;
      case "delayed":
        jobs = await queue.getDelayed(start, end);
        break;
      case "wait":
        jobs = await queue.getWaitingChildren(start, end);
        break;
    }

    return jobs.map((job) => ({
      id: job.id,
      name: job.name,
      data: job.data,
      progress: job.progress,
      timestamp: job.timestamp,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      returnvalue: job.returnvalue,
    }));
  }

  /**
   * Get a single job by ID with full details.
   */
  async getJob(queueName: string, jobId: string): Promise<any> {
    const queue = this.connectionService.getQueue(queueName);
    const job = await queue.getJob(jobId);

    if (!job) {
      throw new Error(`Job ${jobId} not found in queue ${queueName}`);
    }

    return {
      id: job.id,
      name: job.name,
      data: job.data,
      opts: job.opts,
      progress: job.progress,
      timestamp: job.timestamp,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      stacktrace: job.stacktrace,
      returnvalue: job.returnvalue,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
    };
  }

  /**
   * Add a new job to a queue.
   */
  async addJob(
    queueName: string,
    jobName: string,
    data: Record<string, unknown>,
    opts: Record<string, unknown> = {}
  ): Promise<{ id: string | undefined; name: string }> {
    const queue = this.connectionService.getQueue(queueName);
    const job = await queue.add(jobName, data, opts);
    return { id: job.id, name: job.name };
  }

  /**
   * Remove a job from a queue.
   */
  async removeJob(queueName: string, jobId: string): Promise<void> {
    const queue = this.connectionService.getQueue(queueName);
    const job = await queue.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found in queue ${queueName}`);
    await job.remove();
  }

  /**
   * Retry a failed job.
   */
  async retryJob(queueName: string, jobId: string): Promise<void> {
    const queue = this.connectionService.getQueue(queueName);
    const job = await queue.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found in queue ${queueName}`);
    await job.retry();
  }

  /**
   * Promote a delayed job to be immediately processed.
   */
  async promoteJob(queueName: string, jobId: string): Promise<void> {
    const queue = this.connectionService.getQueue(queueName);
    const job = await queue.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found in queue ${queueName}`);
    await job.promote();
  }

  /**
   * Get logs for a specific job.
   */
  async getJobLogs(queueName: string, jobId: string): Promise<string[]> {
    const queue = this.connectionService.getQueue(queueName);
    const job = await queue.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found in queue ${queueName}`);
    const logs = await queue.getJobLogs(jobId);
    return logs.logs;
  }

  /**
   * Add a log entry to a specific job.
   */
  async addJobLog(
    queueName: string,
    jobId: string,
    message: string
  ): Promise<void> {
    const queue = this.connectionService.getQueue(queueName);
    const job = await queue.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found in queue ${queueName}`);
    await job.log(message);
  }

  /**
   * Move failed jobs to a dead-letter queue (DLQ) stored as plain Redis keys
   * with a configurable TTL. Supports dry-run mode for previewing.
   */
  async moveFailedToDLQ(
    queueName: string,
    jobName: string,
    beforeTimestamp: number,
    dlqKey: string = "dlq:failed_jobs",
    ttlDays: number = 30,
    dryRun: boolean = false
  ): Promise<{ totalMoved: number; movedJobs: any[] }> {
    const queue = this.connectionService.getQueue(queueName);
    const redis = this.connectionService.getRedis();

    const batchSize = 100;
    let start = 0;
    let totalMoved = 0;
    const movedJobs: any[] = [];

    while (true) {
      const failedJobs = await queue.getFailed(start, start + batchSize - 1);
      if (failedJobs.length === 0) break;

      const jobsToMove = failedJobs.filter(
        (job) => job.name === jobName && job.timestamp < beforeTimestamp
      );

      for (const job of jobsToMove) {
        const dlqEntry = {
          originalJobId: job.id,
          jobName: job.name,
          data: job.data,
          failedReason: job.failedReason,
          attemptsMade: job.attemptsMade,
          timestamp: job.timestamp,
          movedAt: Date.now(),
          originalQueue: queueName,
          stacktrace: job.stacktrace,
        };

        if (!dryRun) {
          const entryKey = `${dlqKey}:${job.id}`;
          await redis.setex(
            entryKey,
            ttlDays * 24 * 60 * 60,
            JSON.stringify(dlqEntry)
          );
          await job.remove();
        }

        movedJobs.push({
          jobId: job.id,
          timestamp: job.timestamp,
          failedReason: job.failedReason,
        });
        totalMoved++;
      }

      start += batchSize;
    }

    // Create an index for efficient querying
    if (!dryRun && totalMoved > 0) {
      const indexKey = `${dlqKey}:index:${jobName}`;
      await redis.setex(
        indexKey,
        ttlDays * 24 * 60 * 60,
        JSON.stringify({
          jobName,
          totalJobs: totalMoved,
          movedAt: Date.now(),
          beforeTimestamp,
          ttlDays,
        })
      );
    }

    return { totalMoved, movedJobs };
  }

  /**
   * Query jobs in the dead-letter queue.
   */
  async queryDLQ(
    dlqKey: string = "dlq:failed_jobs",
    jobName?: string,
    limit: number = 10
  ): Promise<any[]> {
    const redis = this.connectionService.getRedis();
    const keys = await redis.keys(`${dlqKey}:*`);
    const jobKeys = keys.filter((key) => !key.includes(":index:"));

    const jobs: any[] = [];
    for (let i = 0; i < Math.min(jobKeys.length, limit); i++) {
      const jobData = await redis.get(jobKeys[i]);
      if (jobData) {
        const parsed = JSON.parse(jobData);
        if (!jobName || parsed.jobName === jobName) {
          jobs.push(parsed);
        }
      }
    }

    return jobs;
  }
}
