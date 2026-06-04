import { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * MCP tool definitions for queue-level operations.
 */
export const queueTools: Tool[] = [
  {
    name: "list_queues",
    description: "List all BullMQ queues in the current connection",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Queue name pattern (supports wildcards)",
          default: "*",
        },
      },
    },
  },
  {
    name: "stats",
    description: "Get job count statistics for a queue",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "Queue name" },
      },
      required: ["queue"],
    },
  },
  {
    name: "pause_queue",
    description: "Pause processing for a queue",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "Queue name" },
      },
      required: ["queue"],
    },
  },
  {
    name: "resume_queue",
    description: "Resume processing for a paused queue",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "Queue name" },
      },
      required: ["queue"],
    },
  },
  {
    name: "drain_queue",
    description: "Remove all jobs from a queue",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "Queue name" },
      },
      required: ["queue"],
    },
  },
  {
    name: "clean_queue",
    description: "Clean jobs from a queue by status",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "Queue name" },
        grace: { type: "number", description: "Grace period in ms", default: 0 },
        limit: { type: "number", description: "Max jobs to clean", default: 1000 },
        status: {
          type: "string",
          enum: ["completed", "failed"],
          description: "Job status to clean",
          default: "completed",
        },
      },
      required: ["queue"],
    },
  },
];
