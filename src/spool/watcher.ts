/**
 * Spool file watcher - watches the events directory and dispatches events.
 *
 * Uses chokidar (like config-reload.ts) to watch for new event files.
 */

import chokidar from "chokidar";
import path from "node:path";
import type { CliDeps } from "../cli/deps.js";
import type { SpoolWatcherState, SpoolDispatchResult } from "./types.js";
import { loadConfig } from "../config/config.js";
import { dispatchSpoolEventFile } from "./dispatcher.js";
import { resolveSpoolEventsDir, resolveSpoolDeadLetterDir } from "./paths.js";
import { listSpoolEvents } from "./reader.js";
import { ensureSpoolEventsDir } from "./writer.js";

export type SpoolWatcherLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

export type SpoolWatcherParams = {
  deps: CliDeps;
  log: SpoolWatcherLogger;
  onEvent?: (result: SpoolDispatchResult) => void;
};

export type SpoolWatcher = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getState: () => SpoolWatcherState;
  processExisting: () => Promise<void>;
};

/**
 * Create a spool watcher that processes events from the spool directory.
 */
export function createSpoolWatcher(params: SpoolWatcherParams): SpoolWatcher {
  const { deps, log, onEvent } = params;

  let watcher: ReturnType<typeof chokidar.watch> | null = null;
  let running = false;
  let processing = false;
  let pendingFiles: Set<string> = new Set();
  let processTimer: ReturnType<typeof setTimeout> | null = null;

  const eventsDir = resolveSpoolEventsDir();
  const deadLetterDir = resolveSpoolDeadLetterDir();

  const scheduleProcessing = () => {
    if (processTimer) {
      clearTimeout(processTimer);
    }
    // Debounce to avoid processing the same file multiple times
    processTimer = setTimeout(() => {
      void processQueue();
    }, 100);
  };

  const processQueue = async () => {
    if (processing || !running) {
      return;
    }
    processing = true;

    try {
      // Capture pending file IDs and clear the set
      const pendingIds = new Set<string>();
      for (const filePath of pendingFiles) {
        const filename = path.basename(filePath);
        if (filename.endsWith(".json") && !filename.includes(".tmp.")) {
          pendingIds.add(filename.replace(/\.json$/, ""));
        }
      }
      pendingFiles.clear();

      if (pendingIds.size === 0) {
        return;
      }

      // Load config once for all events in this batch
      const cfg = loadConfig();

      // Get all events sorted by priority (critical > high > normal > low) then createdAt
      // This ensures proper processing order when multiple events are pending
      const sortedEvents = await listSpoolEvents();

      // Track which IDs were successfully matched (valid events)
      const processedIds = new Set<string>();

      // Filter to only pending events and process in priority order
      for (const event of sortedEvents) {
        if (!running) {
          break;
        }

        if (!pendingIds.has(event.id)) {
          continue;
        }

        processedIds.add(event.id);
        const filePath = path.join(eventsDir, `${event.id}.json`);

        try {
          const result = await dispatchSpoolEventFile({
            cfg,
            deps,
            filePath,
            lane: "spool",
          });

          if (result.status === "ok") {
            log.info(
              `dispatched event ${result.eventId}${result.summary ? `: ${result.summary}` : ""}`,
            );
          } else if (result.status === "error") {
            log.warn(`event ${result.eventId} failed: ${result.error}`);
          } else if (result.status === "expired") {
            log.info(`event ${result.eventId} expired, discarded`);
          }

          onEvent?.(result);
        } catch (err) {
          log.error(`failed to process ${filePath}: ${String(err)}`);
        }
      }

      // Handle malformed files that weren't matched by listSpoolEvents()
      // Dispatch them directly so they get moved to dead-letter
      for (const eventId of pendingIds) {
        if (!running) {
          break;
        }

        if (processedIds.has(eventId)) {
          continue;
        }

        // This file wasn't in sortedEvents - likely malformed/invalid
        const filePath = path.join(eventsDir, `${eventId}.json`);

        try {
          const result = await dispatchSpoolEventFile({
            cfg,
            deps,
            filePath,
            lane: "spool",
          });

          // dispatchSpoolEventFile will move invalid files to dead-letter
          if (result.status === "error") {
            log.warn(`event ${result.eventId} failed: ${result.error}`);
          }

          onEvent?.(result);
        } catch (err) {
          log.error(`failed to process ${filePath}: ${String(err)}`);
        }
      }
    } finally {
      processing = false;

      // If more files arrived while processing, schedule another round
      if (pendingFiles.size > 0) {
        scheduleProcessing();
      }
    }
  };

  const start = async () => {
    if (running) {
      return;
    }
    running = true;

    // Ensure directory exists
    await ensureSpoolEventsDir();

    // Start watching
    watcher = chokidar.watch(eventsDir, {
      ignoreInitial: false, // Process existing files on startup
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      usePolling: Boolean(process.env.VITEST),
    });

    watcher.on("add", (filePath) => {
      if (!running) {
        return;
      }
      pendingFiles.add(filePath);
      scheduleProcessing();
    });

    watcher.on("change", (filePath) => {
      if (!running) {
        return;
      }
      // Re-process changed files (e.g., retry count updated)
      pendingFiles.add(filePath);
      scheduleProcessing();
    });

    watcher.on("error", (err) => {
      log.error(`watcher error: ${String(err)}`);
    });

    log.info(`watching ${eventsDir}`);
  };

  const stop = async () => {
    if (!running) {
      return;
    }
    running = false;

    if (processTimer) {
      clearTimeout(processTimer);
      processTimer = null;
    }

    if (watcher) {
      await watcher.close();
      watcher = null;
    }

    log.info("stopped");
  };

  const getState = (): SpoolWatcherState => ({
    running,
    eventsDir,
    deadLetterDir,
    pendingCount: pendingFiles.size,
  });

  const processExisting = async () => {
    if (!running) {
      return;
    }

    const events = await listSpoolEvents();
    for (const event of events) {
      const filePath = path.join(eventsDir, `${event.id}.json`);
      pendingFiles.add(filePath);
    }

    if (pendingFiles.size > 0) {
      scheduleProcessing();
    }
  };

  return {
    start,
    stop,
    getState,
    processExisting,
  };
}

export type SpoolWatcherHandle = {
  watcher: SpoolWatcher;
  stop: () => Promise<void>;
};

/**
 * Start the spool watcher as a gateway sidecar.
 */
export async function startSpoolWatcher(params: SpoolWatcherParams): Promise<SpoolWatcherHandle> {
  const watcher = createSpoolWatcher(params);
  await watcher.start();

  return {
    watcher,
    stop: () => watcher.stop(),
  };
}
