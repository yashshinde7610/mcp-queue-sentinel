import { Job } from "bullmq";
import { ConnectionService } from "./connection.service.js";

export class JobService {
  constructor(private connectionService: ConnectionService) {}

  async getJobs(
    queueName: string,
    status: string,
    start: number = 0,
    end: number = 10,
    connectionId: string
  ): Promise<any[]> {
    const queue = this.connectionService.getQueue(queueName, connectionId);

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

  async getJob(queueName: string, jobId: string, connectionId: string): Promise<any> {
    const queue = this.connectionService.getQueue(queueName, connectionId);
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

  async addJob(
    queueName: string,
    jobName: string,
    data: Record<string, unknown>,
    opts: Record<string, unknown> = {},
    connectionId: string
  ): Promise<{ id: string | undefined; name: string }> {
    const queue = this.connectionService.getQueue(queueName, connectionId);
    const job = await queue.add(jobName, data, opts);
    return { id: job.id, name: job.name };
  }

  async removeJob(queueName: string, jobId: string, connectionId: string): Promise<void> {
    const queue = this.connectionService.getQueue(queueName, connectionId);
    const job = await queue.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found in queue ${queueName}`);
    await job.remove();
  }

  async retryJob(queueName: string, jobId: string, connectionId: string): Promise<void> {
    const queue = this.connectionService.getQueue(queueName, connectionId);
    const job = await queue.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found in queue ${queueName}`);
    await job.retry();
  }

  async promoteJob(queueName: string, jobId: string, connectionId: string): Promise<void> {
    const queue = this.connectionService.getQueue(queueName, connectionId);
    const job = await queue.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found in queue ${queueName}`);
    await job.promote();
  }

  async getJobLogs(queueName: string, jobId: string, connectionId: string): Promise<string[]> {
    const queue = this.connectionService.getQueue(queueName, connectionId);
    const job = await queue.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found in queue ${queueName}`);
    const logs = await queue.getJobLogs(jobId);
    return logs.logs;
  }

  async addJobLog(
    queueName: string,
    jobId: string,
    message: string,
    connectionId: string
  ): Promise<void> {
    const queue = this.connectionService.getQueue(queueName, connectionId);
    const job = await queue.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found in queue ${queueName}`);
    await job.log(message);
  }

  async moveFailedToDLQ(
    queueName: string,
    jobName: string,
    beforeTimestamp: number,
    dlqKey: string = "dlq:failed_jobs",
    ttlDays: number = 30,
    dryRun: boolean = false,
    connectionId: string
  ): Promise<{ totalMoved: number; movedJobs: any[] }> {
    const queue = this.connectionService.getQueue(queueName, connectionId);
    const redis = this.connectionService.getRedis(connectionId);

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

  async queryDLQ(
    dlqKey = "dlq:failed_jobs",
    jobName: string | undefined,
    limit = 10,
    connectionId: string
  ): Promise<any[]> {
    const redis = this.connectionService.getRedis(connectionId);
    const jobs: any[] = [];

    const stream = redis.scanStream({ match: `${dlqKey}:*`, count: 200 });
    for await (const keys of stream) {
      for (const key of keys as string[]) {
        if (key.includes(":index:")) continue;
        if (jobs.length >= limit) break;

        const jobData = await redis.get(key);
        if (jobData) {
          const parsed = JSON.parse(jobData);
          if (!jobName || parsed.jobName === jobName) {
            jobs.push(parsed);
          }
        }
      }
      if (jobs.length >= limit) break;
    }
    return jobs;
  }
}
