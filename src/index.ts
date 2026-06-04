#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Services
import { ConnectionService } from "./services/connection.service.js";

// Middleware
import { TokenBucketRateLimiter } from "./middleware/rate-limiter.js";

// Monitoring
import { MetricsCollector } from "./monitoring/metrics-collector.js";
import { SSEServer } from "./monitoring/sse-server.js";

// Tool definitions
import { connectionTools } from "./tools/connection.tools.js";
import { queueTools } from "./tools/queue.tools.js";
import { jobTools } from "./tools/job.tools.js";
import { monitoringTools, failureAnalysisTools } from "./tools/monitoring.tools.js";

// Handler
import { ToolHandler } from "./handlers/tool-handler.js";

/**
 * Bootstrap and wire together all microservice components:
 *  - ConnectionService: Redis connection lifecycle
 *  - TokenBucketRateLimiter: Rate limiting middleware
 *  - MetricsCollector: In-memory metrics tracking
 *  - SSEServer: Real-time monitoring dashboard
 *  - ToolHandler: Central dispatcher for MCP tool calls
 */
async function main() {
  // 1. Initialize core services
  const connectionService = new ConnectionService();
  const rateLimiter = new TokenBucketRateLimiter();
  const metricsCollector = new MetricsCollector();
  const toolHandler = new ToolHandler(connectionService, rateLimiter, metricsCollector);

  // 2. Start monitoring SSE server (non-blocking)
  const sseServer = new SSEServer(metricsCollector);
  try {
    await sseServer.start();
  } catch {
    // SSE server is optional — don't crash if port is in use
  }

  // 3. Aggregate all tool definitions
  const allTools = [
    ...connectionTools,
    ...queueTools,
    ...jobTools,
    ...monitoringTools,
    ...failureAnalysisTools,
  ];

  // 4. Create MCP server
  const server = new Server(
    { name: "mcp-queue-sentinel", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  // 5. Register tool listing handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools,
  }));

  // 6. Register tool call handler — delegates to ToolHandler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return toolHandler.handle(name, args as Record<string, any>);
  });

  // 7. Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // 8. Graceful shutdown
  process.on("SIGINT", async () => {
    await connectionService.shutdownAll();
    await sseServer.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await connectionService.shutdownAll();
    await sseServer.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
