import * as http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MetricsCollector } from "./metrics-collector.js";
import { MONITORING_CONFIG } from "../config/redis.config.js";
import { logger } from "../utils/logger.js";

const MONITOR_TOKEN = process.env.MONITOR_TOKEN || null;

/**
 * Lightweight HTTP server that exposes:
 *  - GET /events  → Server-Sent Events stream (real-time metrics)
 *  - GET /metrics → JSON snapshot of current metrics
 *  - GET /health  → Health check
 *  - GET /        → Monitoring dashboard (HTML)
 */
export class SSEServer {
  private server: http.Server | null = null;
  private clients = new Set<http.ServerResponse>();
  private intervalId: ReturnType<typeof setInterval> | null = null;

  private static readonly dashboardHtml = (() => {
    const dir = dirname(fileURLToPath(import.meta.url));
    return readFileSync(join(dir, "dashboard.html"), "utf-8");
  })();

  constructor(
    private metricsCollector: MetricsCollector,
    private port: number = MONITORING_CONFIG.port
  ) {}

  /**
   * Start the monitoring HTTP server and begin broadcasting
   * metrics via SSE at a fixed interval.
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = new URL(req.url || "/", `http://localhost:${this.port}`);

        // Health is unauthenticated (for load balancer probes)
        if (url.pathname === "/health") {
          this.handleHealth(res);
          return;
        }

        // All other endpoints require token if MONITOR_TOKEN is set
        if (MONITOR_TOKEN && !this.validateToken(req, url)) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized. Set ?token= query param or Authorization header." }));
          return;
        }

        switch (url.pathname) {
          case "/events":
            this.handleSSE(req, res);
            break;
          case "/metrics":
            this.handleMetrics(res);
            break;
          case "/":
            this.handleDashboard(res);
            break;
          default:
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
        }
      });

      this.server.listen(this.port, () => {
        logger.info("sse-server", `monitoring server started on port ${this.port}`, {
          authEnabled: !!MONITOR_TOKEN,
        });
        resolve();
      });

      this.server.on("error", reject);

      this.intervalId = setInterval(() => {
        this.broadcast();
      }, MONITORING_CONFIG.sseIntervalMs);
    });
  }

  /**
   * Stop the server and clean up all client connections.
   */
  async stop(): Promise<void> {
    if (this.intervalId) clearInterval(this.intervalId);
    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private handleSSE(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Send an initial snapshot immediately
    const snapshot = this.metricsCollector.getSnapshot();
    res.write(`data: ${JSON.stringify(snapshot)}\n\n`);

    this.clients.add(res);

    req.on("close", () => {
      this.clients.delete(res);
    });
  }

  private handleMetrics(res: http.ServerResponse): void {
    const snapshot = this.metricsCollector.getSnapshot();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(snapshot, null, 2));
  }

  private handleHealth(res: http.ServerResponse): void {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        uptime: process.uptime(),
        connectedClients: this.clients.size,
      })
    );
  }

  private handleDashboard(res: http.ServerResponse): void {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(SSEServer.dashboardHtml);
  }

  private broadcast(): void {
    const snapshot = this.metricsCollector.getSnapshot();
    const data = `data: ${JSON.stringify(snapshot)}\n\n`;

    for (const client of this.clients) {
      client.write(data);
    }
  }

  private validateToken(req: http.IncomingMessage, url: URL): boolean {
    if (!MONITOR_TOKEN) return true;

    const token = url.searchParams.get("token")
      || (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null);

    if (!token) return false;

    try {
      const a = Buffer.from(token);
      const b = Buffer.from(MONITOR_TOKEN);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}
