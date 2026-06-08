import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const monitoringTools: Tool[] = [
  {
    name: "get_metrics",
    description: "Get a snapshot of all current server metrics including tool calls, queue activity, and rate limit stats",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: { type: "string", description: "Target connection ID (uses last connected if omitted)" },
      },
    },
  },
  {
    name: "reset_metrics",
    description: "Reset all metrics counters to zero",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: { type: "string", description: "Target connection ID (uses last connected if omitted)" },
      },
    },
  },
];

export const failureAnalysisTools: Tool[] = [
  {
    name: "analyze_failures",
    description:
      "Analyze failed jobs in a queue — groups errors by similarity, computes failure rates, identifies trends, and suggests root causes",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "Queue name to analyze" },
        windowMs: {
          type: "number",
          description: "Time window in milliseconds (default: 24 hours)",
          default: 86400000,
        },
        limit: {
          type: "number",
          description: "Max failed jobs to analyze",
          default: 500,
        },
        connectionId: { type: "string", description: "Target connection ID (uses last connected if omitted)" },
      },
      required: ["queue"],
    },
  },
  {
    name: "get_failure_summary",
    description: "Get a quick failure rate summary across all queues",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: { type: "string", description: "Target connection ID (uses last connected if omitted)" },
      },
    },
  },
];
