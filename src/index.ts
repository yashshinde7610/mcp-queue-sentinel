#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { ConnectionService } from "./services/connection.service.js";
import { MetricsCollector } from "./monitoring/metrics-collector.js";
import { SSEServer } from "./monitoring/sse-server.js";
import { connectionTools } from "./tools/connection.tools.js";
import { queueTools } from "./tools/queue.tools.js";
import { jobTools } from "./tools/job.tools.js";
import { monitoringTools, failureAnalysisTools } from "./tools/monitoring.tools.js";
import { ToolHandler } from "./handlers/tool-handler.js";
import { logger } from "./utils/logger.js";

async function main() {
  const metricsCollector = new MetricsCollector();
  const connectionService = new ConnectionService(metricsCollector);
  const toolHandler = new ToolHandler(connectionService, metricsCollector);

  // SSE monitoring server — non-critical, log failures instead of crashing
  const sseServer = new SSEServer(metricsCollector);
  try {
    await sseServer.start();
  } catch (err) {
    logger.warn("main", "SSE monitoring server failed to start, continuing without it", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const allTools = [
    ...connectionTools,
    ...queueTools,
    ...jobTools,
    ...monitoringTools,
    ...failureAnalysisTools,
  ];

  const server = new Server(
    { name: "mcp-queue-sentinel", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return toolHandler.handle(name, args as Record<string, any>);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    await connectionService.shutdownAll();
    await sseServer.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  logger.error("main", "fatal startup error", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
