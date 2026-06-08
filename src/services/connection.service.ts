import { Redis } from "ioredis";
import { Queue, QueueEvents } from "bullmq";
import type { Connection, RedisConnectionConfig } from "../types/index.js";
import { MetricsCollector } from "../monitoring/metrics-collector.js";
import {
  createRedisConnection,
  DEFAULT_REDIS_CONFIG,
} from "../config/redis.config.js";

/** Manages multiple Redis connections and provides connection lifecycle operations. */
export class ConnectionService {
  private connections = new Map<string, Connection>();

  constructor(private metricsCollector: MetricsCollector) {}

  /** Connect to a Redis instance and register it under the given ID. */
  async connect(config: RedisConnectionConfig): Promise<string> {
    const { id, host, port, password, db, url } = config;

    const isDocker =
      process.env.DOCKER === "true" || !!process.env.DOCKER_HOST;

    let redisUrl = url || process.env.REDIS_URL;

    if (isDocker && redisUrl && redisUrl.includes("localhost")) {
      redisUrl = redisUrl.replace("localhost", "host.docker.internal");
    }

    let finalHost = host || "localhost";
    if (isDocker && finalHost === "localhost") {
      finalHost = "host.docker.internal";
    }

    let redis: Redis;
    if (redisUrl) {
      redis = createRedisConnection(redisUrl);
    } else {
      redis = new Redis({
        ...DEFAULT_REDIS_CONFIG,
        host: finalHost,
        port: port || 6379,
        password,
        db: db || 0,
      });
    }

    await redis.ping();

    this.connections.set(id, {
      redis,
      queues: new Map(),
      queueEvents: new Map(),
    });

    const target = redisUrl || `${finalHost}:${port || 6379}`;
    let info = `Connected to Redis at ${target} (connection: ${id})`;

    if (
      isDocker &&
      (finalHost === "host.docker.internal" ||
        (redisUrl && redisUrl.includes("host.docker.internal")))
    ) {
      info +=
        "\n(Note: Redirected localhost → host.docker.internal for Docker)";
    }

    return info;
  }

  /** Disconnect a specific connection. */
  async disconnect(connectionId: string): Promise<string> {
    if (!connectionId) {
      throw new Error("Missing required connectionId");
    }

    const connection = this.connections.get(connectionId);
    if (connection) {
      for (const queue of connection.queues.values()) await queue.close();
      for (const qe of connection.queueEvents.values()) await qe.close();
      connection.redis.disconnect();
      this.connections.delete(connectionId);
    }

    return `Disconnected from connection: ${connectionId}`;
  }

  /** List all registered connections. */
  listConnections(): Array<{ id: string; active: boolean }> {
    return Array.from(this.connections.keys()).map((id) => ({
      id,
      active: false,
    }));
  }

  /** Returns the resolved connection, or throws. */
  getCurrentConnection(connectionId: string): Connection {
    if (!connectionId || !this.connections.has(connectionId)) {
      throw new Error(`Connection '${connectionId}' not found. Use 'connect' first.`);
    }
    return this.connections.get(connectionId)!;
  }

  /** Get the Redis client for the specified connection. */
  getRedis(connectionId: string): Redis {
    return this.getCurrentConnection(connectionId).redis;
  }

  /** Get or create a BullMQ Queue instance for the given queue name. */
  getQueue(queueName: string, connectionId: string): Queue {
    const connection = this.getCurrentConnection(connectionId);

    if (!connection.queues.has(queueName)) {
      const queue = new Queue(queueName, {
        connection: connection.redis.duplicate() as any,
      });
      connection.queues.set(queueName, queue);

      // Wire up QueueEvents to the metrics collector to drive the dashboard
      const qe = new QueueEvents(queueName, {
        connection: connection.redis.duplicate() as any,
      });
      qe.on("completed", ({ returnvalue }) => {
        // Calculate a dummy processing time if job duration isn't directly available in the event payload
        this.metricsCollector.recordJobCompleted(queueName, 100);
      });
      qe.on("failed", () => {
        this.metricsCollector.recordJobFailed(queueName);
      });
      connection.queueEvents.set(queueName, qe);
    }

    return connection.queues.get(queueName)!;
  }

  /** Gracefully shut down all connections. */
  async shutdownAll(): Promise<void> {
    for (const [, connection] of this.connections) {
      for (const queue of connection.queues.values()) await queue.close();
      for (const qe of connection.queueEvents.values()) await qe.close();
      connection.redis.disconnect();
    }
    this.connections.clear();
  }
}
