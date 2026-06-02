import { Redis } from "ioredis";
import { Queue, Worker, QueueEvents } from "bullmq";
import type { Connection, RedisConnectionConfig } from "../types/index.js";
import {
  createRedisConnection,
  DEFAULT_REDIS_CONFIG,
} from "../config/redis.config.js";

/**
 * Manages multiple Redis connections and provides
 * connection lifecycle operations (connect, disconnect, switch).
 */
export class ConnectionService {
  private connections = new Map<string, Connection>();
  private currentConnectionId: string | null = null;

  /**
   * Connect to a Redis instance and register it under the given ID.
   */
  async connect(config: RedisConnectionConfig): Promise<string> {
    const { id, host, port, password, db, url } = config;

    const isDocker =
      process.env.DOCKER === "true" || !!process.env.DOCKER_HOST;

    // Resolve Redis URL: explicit param > env var > individual params
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

    // Verify the connection is alive
    await redis.ping();

    this.connections.set(id, {
      redis,
      queues: new Map(),
      workers: new Map(),
      queueEvents: new Map(),
    });

    this.currentConnectionId = id;

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

  /**
   * Disconnect from the currently active Redis connection and clean up
   * all associated queues, workers, and event listeners.
   */
  async disconnect(): Promise<string> {
    if (!this.currentConnectionId) {
      throw new Error("No active connection");
    }

    const connection = this.connections.get(this.currentConnectionId);
    if (connection) {
      for (const queue of connection.queues.values()) await queue.close();
      for (const worker of connection.workers.values()) await worker.close();
      for (const qe of connection.queueEvents.values()) await qe.close();
      connection.redis.disconnect();
      this.connections.delete(this.currentConnectionId);
    }

    const disconnectedId = this.currentConnectionId;
    this.currentConnectionId = null;
    return `Disconnected from connection: ${disconnectedId}`;
  }

  /**
   * List all registered connections, indicating which one is active.
   */
  listConnections(): Array<{ id: string; active: boolean }> {
    return Array.from(this.connections.keys()).map((id) => ({
      id,
      active: id === this.currentConnectionId,
    }));
  }

  /**
   * Switch the active connection to a previously registered one.
   */
  switchConnection(id: string): string {
    if (!this.connections.has(id)) {
      throw new Error(`Connection '${id}' not found`);
    }
    this.currentConnectionId = id;
    return `Switched to connection: ${id}`;
  }

  /**
   * Returns the currently active connection, or throws.
   */
  getCurrentConnection(): Connection {
    if (!this.currentConnectionId || !this.connections.has(this.currentConnectionId)) {
      throw new Error("No active connection. Use 'connect' first.");
    }
    return this.connections.get(this.currentConnectionId)!;
  }

  /**
   * Get the Redis client for the current connection.
   */
  getRedis(): Redis {
    return this.getCurrentConnection().redis;
  }

  /**
   * Get or create a BullMQ Queue instance for the given queue name.
   * Queue instances are cached per connection.
   */
  getQueue(queueName: string): Queue {
    const connection = this.getCurrentConnection();

    if (!connection.queues.has(queueName)) {
      const queue = new Queue(queueName, {
        connection: connection.redis.duplicate() as any,
      });
      connection.queues.set(queueName, queue);
    }

    return connection.queues.get(queueName)!;
  }

  /**
   * Gracefully shut down all connections.
   */
  async shutdownAll(): Promise<void> {
    for (const [, connection] of this.connections) {
      for (const queue of connection.queues.values()) await queue.close();
      for (const worker of connection.workers.values()) await worker.close();
      for (const qe of connection.queueEvents.values()) await qe.close();
      connection.redis.disconnect();
    }
    this.connections.clear();
    this.currentConnectionId = null;
  }
}
