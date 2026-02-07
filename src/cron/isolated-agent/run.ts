/**
 * Cron isolated agent turn wrapper.
 *
 * This is a thin wrapper that converts CronJob parameters to the generic
 * IsolatedAgentTurnParams and delegates to runIsolatedAgentTurn().
 *
 * It adds cron-specific session tracking (sessionId/sessionKey in results,
 * session labeling) on top of the shared infrastructure.
 */

import type { CliDeps } from "../../cli/deps.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { CronJob } from "../types.js";
import {
  runIsolatedAgentTurn,
  type IsolatedAgentTurnParams,
  type IsolatedAgentTurnResult,
} from "../../agents/isolated-turn/index.js";

export type RunCronAgentTurnResult = IsolatedAgentTurnResult;

/**
 * Run an isolated agent turn for a cron job.
 *
 * This wrapper extracts the relevant parameters from the CronJob and
 * calls the shared runIsolatedAgentTurn() function.
 *
 * Delivery can be configured in two places:
 * 1. job.payload (for agentTurn kind) - inline delivery options
 * 2. job.delivery - separate delivery configuration with mode "announce"|"none"
 *
 * Payload-level settings take precedence over job.delivery settings.
 */
export async function runCronIsolatedAgentTurn(params: {
  cfg: OpenClawConfig;
  deps: CliDeps;
  job: CronJob;
  message: string;
  sessionKey: string;
  agentId?: string;
  lane?: string;
}): Promise<RunCronAgentTurnResult> {
  const { cfg, deps, job, message, sessionKey, agentId, lane } = params;
  const payload = job.payload.kind === "agentTurn" ? job.payload : null;
  const delivery = job.delivery;

  // Resolve delivery settings: payload takes precedence over job.delivery
  // job.delivery.mode === "announce":
  //   - with explicit `to`: use auto mode (undefined) to respect skip logic
  //   - without `to`: use explicit mode (true) to attempt delivery via channel resolution
  // job.delivery.mode === "none" disables delivery entirely (false)
  const resolvedTo = payload?.to ?? delivery?.to;
  const deliverFromJobDelivery =
    delivery?.mode === "announce"
      ? resolvedTo
        ? undefined // auto mode with skip logic
        : true // explicit mode for dynamic target resolution
      : delivery?.mode === "none"
        ? false
        : undefined;
  const deliver = payload?.deliver ?? deliverFromJobDelivery;
  const channel = payload?.channel ?? delivery?.channel;
  const to = payload?.to ?? delivery?.to;
  const bestEffortDeliver = payload?.bestEffortDeliver ?? delivery?.bestEffort;

  // Build IsolatedAgentTurnParams from CronJob
  const isolatedParams: IsolatedAgentTurnParams = {
    cfg,
    deps,
    message,
    sessionKey: sessionKey?.trim() || `cron:${job.id}`,
    agentId: agentId ?? job.agentId,
    lane: lane ?? "cron",

    // Agent options from payload
    model: payload?.model,
    thinking: payload?.thinking,
    timeoutSeconds: payload?.timeoutSeconds,

    // Delivery options (merged from payload and job.delivery)
    deliver,
    channel,
    to,
    bestEffortDeliver,

    // Security
    allowUnsafeExternalContent: payload?.allowUnsafeExternalContent,

    // Source information for message formatting
    source: {
      type: "cron",
      id: job.id,
      name: job.name ?? `job-${job.id}`,
    },

    // Cron-specific session label
    sessionLabel: (sessionKey?.trim() || `cron:${job.id}`).startsWith("cron:")
      ? `Cron: ${typeof job.name === "string" && job.name.trim() ? job.name.trim() : job.id}`
      : undefined,
  };

  return runIsolatedAgentTurn(isolatedParams);
}
