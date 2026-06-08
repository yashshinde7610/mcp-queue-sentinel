# MCP Queue Sentinel

A microservices-based **Model Context Protocol (MCP)** server for managing BullMQ Redis job queues. Built with a modular architecture featuring rate limiting, real-time monitoring, and intelligent failure analysis.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    MCP Client (Claude)                    │
│                        ↕ stdio                           │
├──────────────────────────────────────────────────────────┤
│                   src/index.ts (Entry)                    │
│                        ↓                                 │
│              ┌─────────────────────┐                     │
│              │    Tool Handler     │ ← Central Dispatcher│
│              │  (rate limiting +   │                     │
│              │   metrics middleware)│                     │
│              └──────┬──────────────┘                     │
│         ┌───────────┼───────────┬──────────┐             │
│         ↓           ↓           ↓          ↓             │
│  ┌────────────┐ ┌────────┐ ┌────────┐ ┌──────────┐      │
│  │ Connection │ │ Queue  │ │  Job   │ │ Failure  │      │
│  │  Service   │ │Service │ │Service │ │ Analyzer │      │
│  └─────┬──────┘ └───┬────┘ └───┬────┘ └────┬─────┘      │
│        └─────────────┴─────────┴────────────┘            │
│                        ↕                                 │
│              ┌─────────────────┐                         │
│              │   Redis / BullMQ │                         │
│              └─────────────────┘                         │
├──────────────────────────────────────────────────────────┤
│              SSE Server (:3001)                           │
│    /events → Real-time metrics stream                    │
│    /metrics → JSON snapshot                              │
│    /health → Health check                                │
│    / → Live monitoring dashboard                         │
└──────────────────────────────────────────────────────────┘
```

## Features

### Core Queue Management
- **Connection Management** — Connect to multiple Redis instances, switch between dev/staging/prod
- **Queue Operations** — List, pause, resume, drain, and clean queues
- **Job CRUD** — Add, remove, retry, promote jobs with full lifecycle support
- **Dead Letter Queue** — Move failed jobs to DLQ with configurable TTL

### Rate Limiting (Token Bucket Algorithm)
A classic system design pattern implemented as middleware:
- **Tiered limits** — Different rates for read (30/min), write (10/min), and admin (5/min) operations
- **Token Bucket algorithm** — Smooth rate limiting with burst capacity
- **Per-category isolation** — Read operations don't compete with writes

### Real-time Monitoring (SSE)
- **Server-Sent Events** endpoint streaming metrics every 5 seconds
- **Live dashboard** at `http://localhost:3001` with auto-updating charts
- **Metrics tracked**: tool calls, queue activity, failure counts, processing times, rate limit hits

### Failure Analysis Engine
- **Error grouping** — Clusters similar errors by normalizing variable parts (UUIDs, timestamps, IPs)
- **Failure rate computation** — Per-queue failure percentages
- **Hourly trend analysis** — Time-bucketed failure trends for spotting patterns
- **Root cause suggestions** — Maps error signatures to actionable fixes

## Project Structure

```
src/
├── index.ts                         # Entry point — bootstraps all services
├── config/
│   └── redis.config.ts              # Redis connection factory (TLS, Docker)
├── services/
│   ├── connection.service.ts        # Multi-connection lifecycle management
│   ├── queue.service.ts             # Queue-level operations
│   └── job.service.ts               # Job CRUD + DLQ management
├── middleware/
│   └── rate-limiter.ts              # Token Bucket rate limiter
├── handlers/
│   └── tool-handler.ts              # Central tool dispatcher + middleware
├── tools/
│   ├── connection.tools.ts          # MCP tool schemas — connections
│   ├── queue.tools.ts               # MCP tool schemas — queues
│   ├── job.tools.ts                 # MCP tool schemas — jobs
│   └── monitoring.tools.ts          # MCP tool schemas — monitoring + analysis
├── analytics/
│   └── failure-analyzer.ts          # Error grouping + root cause engine
├── monitoring/
│   ├── metrics-collector.ts         # In-memory metrics tracking
│   └── sse-server.ts                # SSE server + HTML dashboard
├── types/
│   └── index.ts                     # Shared TypeScript interfaces
└── __tests__/
    ├── rate-limiter.test.ts         # Rate limiter unit tests
    └── metrics-collector.test.ts    # Metrics collector unit tests
```

## Setup

### Prerequisites
- Node.js 20+
- Redis server running

### Installation

```bash
git clone https://github.com/yashshinde7610/mcp-queue-sentinel.git
cd mcp-queue-sentinel
npm install
npm run build
```

### Development

```bash
npm run dev          # Start MCP server with tsx
npm run monitor      # Start monitoring SSE server only
npm test             # Run unit tests
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
```

### Configure with Claude Desktop

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "queue-sentinel": {
      "command": "node",
      "args": ["path/to/mcp-queue-sentinel/dist/index.js"],
      "env": {
        "REDIS_URL": "redis://localhost:6379"
      }
    }
  }
}
```

### Docker

```bash
docker-compose up -d  # Start Redis + MCP server + monitoring
```

## Available MCP Tools

| Tool | Category | Description |
|------|----------|-------------|
| `connect` | Write | Connect to a Redis instance |
| `disconnect` | Write | Disconnect current connection |
| `list_connections` | Read | List all connections |
| `switch_connection` | Write | Switch active connection |
| `list_queues` | Read | Discover all queues |
| `stats` | Read | Get queue job counts |
| `pause_queue` | Admin | Pause queue processing |
| `resume_queue` | Admin | Resume queue processing |
| `drain_queue` | Admin | Remove all jobs from queue |
| `clean_queue` | Admin | Clean jobs by status |
| `get_jobs` | Read | Get jobs filtered by status |
| `get_job` | Read | Get single job details |
| `add_job` | Write | Add a new job |
| `remove_job` | Write | Remove a job |
| `retry_job` | Write | Retry a failed job |
| `promote_job` | Write | Promote a delayed job |
| `get_job_logs` | Read | Get job logs |
| `add_job_log` | Write | Add a log entry |
| `move_failed_jobs_to_dlq` | Write | Move failed jobs to DLQ |
| `query_dead_letter_queue` | Read | Query DLQ jobs |
| `get_metrics` | Read | Get metrics snapshot |
| `reset_metrics` | Admin | Reset all metrics |
| `analyze_failures` | Admin | Analyze failure patterns |
| `get_failure_summary` | Read | Failure summary across queues |

## Tech Stack

- **TypeScript** — Strict mode, ES2022 target
- **Node.js** — ES modules, stdio transport
- **BullMQ** — Redis-based job queue
- **ioredis** — Redis client with TLS support
- **MCP SDK** — Model Context Protocol server
- **Jest** — Unit testing
- **SSE** — Server-Sent Events for real-time monitoring

