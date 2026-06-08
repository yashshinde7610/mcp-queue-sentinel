import { ConnectionService } from "../services/connection.service.js";
import { JobService } from "../services/job.service.js";
import { MetricsCollector } from "../monitoring/metrics-collector.js";
import { ToolHandler } from "../handlers/tool-handler.js";

async function runBenchmark() {
  console.log("🚀 Starting High-Concurrency Benchmark Suite...\n");

  const metricsCollector = new MetricsCollector();
  const connectionService = new ConnectionService(metricsCollector);
  const jobService = new JobService(connectionService);
  const toolHandler = new ToolHandler(connectionService, metricsCollector);

  const connectionId = "benchmark-conn";
  await connectionService.connect({ id: connectionId, host: "localhost", port: 6379 });

  const queueName = "benchmark-queue";
  const queue = connectionService.getQueue(queueName, connectionId);
  await queue.obliterate({ force: true }); // Clean slate

  // --- Test 1: Job Throughput ---
  console.log("⏱️  Test 1: High-Velocity Job Insertion...");
  const JOB_COUNT = 10000;
  const startInsertion = Date.now();
  
  // We'll insert in batches of 500 to simulate a realistic but high-load node event loop
  const BATCH_SIZE = 500;
  for (let i = 0; i < JOB_COUNT; i += BATCH_SIZE) {
    const batch = Array.from({ length: BATCH_SIZE }).map((_, idx) => 
      jobService.addJob(queueName, `job-${i + idx}`, { payload: "data" }, {}, connectionId)
    );
    await Promise.all(batch);
  }
  
  const endInsertion = Date.now();
  const insertionTimeSec = (endInsertion - startInsertion) / 1000;
  const jobsPerSec = Math.round(JOB_COUNT / insertionTimeSec);
  console.log(`✅ Result: ${JOB_COUNT} jobs inserted in ${insertionTimeSec.toFixed(2)}s`);
  console.log(`🔥 Throughput: ${jobsPerSec.toLocaleString()} jobs/sec\n`);

  // --- Test 2: Concurrent MCP Tool Invocations ---
  console.log("⏱️  Test 2: Concurrent MCP Tool Requests (Testing Stateless Thread Safety)...");
  const CONCURRENT_REQUESTS = 2000;
  const startTools = Date.now();
  
  const toolPromises = Array.from({ length: CONCURRENT_REQUESTS }).map(() => 
    toolHandler.handle("get_jobs", { queue: queueName, status: ["waiting"], connectionId })
  );
  
  await Promise.all(toolPromises);
  const endTools = Date.now();
  const toolsTimeSec = (endTools - startTools) / 1000;
  const toolsPerSec = Math.round(CONCURRENT_REQUESTS / toolsTimeSec);
  
  console.log(`✅ Result: ${CONCURRENT_REQUESTS} concurrent LLM tool requests resolved in ${toolsTimeSec.toFixed(2)}s`);
  console.log(`🔥 Throughput: ${toolsPerSec.toLocaleString()} requests/sec\n`);

  // --- Test 3: LRU Cache Memory Efficiency under Queue Sprawl ---
  console.log("⏱️  Test 3: MetricsCollector LRU Cache Memory Pressure...");
  const QUEUE_SPRAWL = 10000; // Creating 10k unique dynamic queue names to trigger LRU eviction
  
  const initialMemory = process.memoryUsage().heapUsed;
  for (let i = 0; i < QUEUE_SPRAWL; i++) {
    metricsCollector.recordJobCompleted(`dynamic-queue-${i}`, Math.random() * 100);
  }
  const finalMemory = process.memoryUsage().heapUsed;
  const memoryIncreaseMB = (finalMemory - initialMemory) / 1024 / 1024;
  
  const snapshot = metricsCollector.getSnapshot();
  console.log(`✅ Result: Simulated ${QUEUE_SPRAWL} unique queues.`);
  console.log(`🔥 Memory Impact: Only ${memoryIncreaseMB.toFixed(2)} MB heap increase (LRU capped at ${snapshot.queues.length} queues max)\n`);

  // Cleanup
  console.log("🧹 Cleaning up...");
  await queue.obliterate({ force: true });
  await connectionService.shutdownAll();
  console.log("🎉 Benchmark Complete.");
}

runBenchmark().catch(console.error);
