import { Redis } from "ioredis";
import { Queue, Worker, QueueEvents } from "bullmq";
import type { Connection, RedisConnectionConfig } from "../types/index.js";
import {
  createRedisConnection,
  DEFAULT_REDIS_CONFIG,
} from "../config/redis.config.js";

/** Manages multiple Redis connections and provides connection lifecycle operations. */
export class ConnectionService {
  private connections = new Map<string, Connection>();
  private lastConnectedId: string | null = null;

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
      workers: new Map(),
      queueEvents: new Map(),
    });

    this.lastConnectedId = id;

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

  /** Disconnect a specific connection (or the last-connected one). */
  async disconnect(connectionId?: string): Promise<string> {
    const targetId = connectionId || this.lastConnectedId;
    if (!targetId) {
      throw new Error("No active connection");
    }

    const connection = this.connections.get(targetId);
    if (connection) {
      for (const queue of connection.queues.values()) await queue.close();
      for (const worker of connection.workers.values()) await worker.close();
      for (const qe of connection.queueEvents.values()) await qe.close();
      connection.redis.disconnect();
      this.connections.delete(targetId);
    }

    if (this.lastConnectedId === targetId) {
      this.lastConnectedId = null;
    }
    return `Disconnected from connection: ${targetId}`;
  }

  /** List all registered connections, indicating which one was last connected. */
  listConnections(): Array<{ id: string; active: boolean }> {
    return Array.from(this.connections.keys()).map((id) => ({
      id,
      active: id === this.lastConnectedId,
    }));
  }

  /** Returns the resolved connection, or throws. */
  getCurrentConnection(connectionId?: string): Connection {
    const targetId = connectionId || this.lastConnectedId;
    if (!targetId || !this.connections.has(targetId)) {
      throw new Error("No active connection. Use 'connect' first.");
    }
    return this.connections.get(targetId)!;
  }

  /** Get the Redis client for the specified (or last-connected) connection. */
  getRedis(connectionId?: string): Redis {
    return this.getCurrentConnection(connectionId).redis;
  }

  /** Get or create a BullMQ Queue instance for the given queue name. */
  getQueue(queueName: string, connectionId?: string): Queue {
    const connection = this.getCurrentConnection(connectionId);

    if (!connection.queues.has(queueName)) {
      const queue = new Queue(queueName, {
        connection: connection.redis.duplicate() as any,
      });
      connection.queues.set(queueName, queue);
    }

    return connection.queues.get(queueName)!;
  }

  /** Gracefully shut down all connections. */
  async shutdownAll(): Promise<void> {
    for (const [, connection] of this.connections) {
      for (const queue of connection.queues.values()) await queue.close();
      for (const worker of connection.workers.values()) await worker.close();
      for (const qe of connection.queueEvents.values()) await qe.close();
      connection.redis.disconnect();
    }
    this.connections.clear();
    this.lastConnectedId = null;
  }
}
