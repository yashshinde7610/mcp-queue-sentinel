import { Redis } from "ioredis";

/**
 * Default Redis connection configuration.
 */
export const DEFAULT_REDIS_CONFIG = {
  host: "localhost",
  port: 6379,
  db: 0,
  maxRetriesPerRequest: null as null,
  connectTimeout: 10_000,
  commandTimeout: 5_000,
};

/**
 * Monitoring server configuration.
 */
export const MONITORING_CONFIG = {
  port: parseInt(process.env.MONITOR_PORT || "3001", 10),
  sseIntervalMs: 5_000,
};

/**
 * Creates a Redis connection, automatically handling TLS for `rediss://` URLs
 * and Docker host redirection when running inside a container.
 */
export function createRedisConnection(
  redisUrl: string,
  options: Record<string, unknown> = {}
): Redis {
  const isDocker =
    process.env.DOCKER === "true" || !!process.env.DOCKER_HOST;

  // Redirect localhost to Docker host when running in a container
  let resolvedUrl = redisUrl;
  if (isDocker && resolvedUrl.includes("localhost")) {
    resolvedUrl = resolvedUrl.replace("localhost", "host.docker.internal");
  }

  if (resolvedUrl.startsWith("rediss://")) {
    return createTlsConnection(resolvedUrl, options);
  }

  return new Redis(resolvedUrl, {
    ...DEFAULT_REDIS_CONFIG,
    ...options,
  });
}

/**
 * Creates a TLS-enabled Redis connection for `rediss://` URLs.
 * Common with managed Redis services (AWS ElastiCache, Heroku, Upstash).
 */
function createTlsConnection(
  redisUrl: string,
  options: Record<string, unknown>
): Redis {
  const url = new URL(redisUrl);

  const redisOptions: Record<string, unknown> = {
    ...DEFAULT_REDIS_CONFIG,
    ...options,
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    db: url.pathname ? parseInt(url.pathname.slice(1)) || 0 : 0,
    tls: {
      rejectUnauthorized: false,
      ...(options.tls as Record<string, unknown>),
    },
  };

  if (url.password) redisOptions.password = url.password;
  if (url.username && url.username !== "") {
    redisOptions.username = url.username;
  }

  return new Redis(redisOptions as any);
}
