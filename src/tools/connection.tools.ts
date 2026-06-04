import { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * MCP tool definitions for Redis connection management.
 */
export const connectionTools: Tool[] = [
  {
    name: "connect",
    description:
      "Connect to a Redis instance. Uses REDIS_URL env var if no URL is provided. Auto-redirects localhost to host.docker.internal in Docker environments.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Connection identifier" },
        url: {
          type: "string",
          description: "Redis URL (e.g., redis://user:pass@localhost:6379/0)",
        },
        host: { type: "string", description: "Redis host", default: "localhost" },
        port: { type: "number", description: "Redis port", default: 6379 },
        password: { type: "string", description: "Redis password" },
        db: { type: "number", description: "Redis database number", default: 0 },
      },
      required: ["id"],
    },
  },
  {
    name: "disconnect",
    description: "Disconnect from the current Redis instance",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_connections",
    description: "List all saved connections",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "switch_connection",
    description: "Switch to a different saved connection",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Connection identifier to switch to" },
      },
      required: ["id"],
    },
  },
];
