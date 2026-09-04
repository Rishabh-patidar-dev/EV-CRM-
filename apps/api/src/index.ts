// =============================================================================
// index.ts — process entrypoint.
// -----------------------------------------------------------------------------
// Node runs JavaScript on one thread. A single process therefore uses exactly
// one CPU core no matter how many the container has, and every request queues
// behind whatever synchronous work is currently on that thread — JSON
// serialization of a large list, a bcrypt comparison, an OCR pass.
//
// This forks one worker per core and lets the OS balance accepted connections
// between them, which multiplies throughput by the core count and means a
// worker that dies takes ~1/N of in-flight traffic with it rather than all of
// it. The primary process supervises and respawns.
//
// Set CLUSTER_WORKERS=1 to disable forking (correct on a single-core
// container, where the extra processes only add memory and context switching).
// =============================================================================
import cluster from "cluster";
import os from "os";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { startServer } from "./server.js";

function desiredWorkers(): number {
  if (env.clusterWorkers > 0) return env.clusterWorkers;
  if (!env.isProd) return 1; // one process in dev keeps logs and debugging sane
  const cores = os.availableParallelism?.() ?? os.cpus().length;
  // Leave headroom: the container also has to run the platform's own agents,
  // and each worker carries its own database connection pool.
  return Math.max(1, Math.min(cores, 8));
}

const workers = desiredWorkers();

if (workers > 1 && cluster.isPrimary) {
  logger.info({ workers, pid: process.pid }, `Primary starting ${workers} workers`);

  for (let i = 0; i < workers; i++) cluster.fork();

  let shuttingDown = false;

  cluster.on("exit", (worker, code, signal) => {
    if (shuttingDown) return;
    // A worker dying under load is survivable; a worker dying in a tight
    // restart loop is not, so this is logged loudly enough to alert on.
    logger.error(
      { workerPid: worker.process.pid, code, signal },
      "Worker exited unexpectedly — replacing"
    );
    cluster.fork();
  });

  // Forward shutdown to the workers so each one drains its own connections,
  // instead of the primary vanishing and orphaning them.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      shuttingDown = true;
      logger.info({ signal }, "Primary shutting down — signalling workers");
      for (const worker of Object.values(cluster.workers ?? {})) worker?.process.kill(signal);
      setTimeout(() => process.exit(0), env.shutdownGraceMs).unref();
    });
  }
} else {
  startServer();
}
