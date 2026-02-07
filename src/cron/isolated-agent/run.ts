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
import { resolveCronDeliveryPlan } from "../delivery.js";

export type RunCronAgentTurnResult = IsolatedAgentTurnResult;

/**
 * Run an isolated agent turn for a cron job.
 *
 * This wrapper extracts the relevant parameters from the CronJob and
 * calls the shared runIsolatedAgentTurn() function.
 *
 * Delivery is resolved using resolveCronDeliveryPlan() for consistent
 * precedence with the cron executor. The plan handles:
 * - job.delivery settings (mode "announce"|"none", channel, to)
 * - Legacy payload delivery fields (deliver, channel, to)
 * - Proper precedence: job.delivery > payload for channel/to
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

  // Use the canonical delivery planner for consistent precedence with cron executor
  const plan = resolveCronDeliveryPlan(job);

  // Map plan to isolated turn delivery params:
  // - none mode → disabled (false)
  // - announce with explicit target → auto mode (undefined) for skip logic
  // - announce without target → explicit mode (true) for dynamic resolution
  const deliver = plan.mode === "none" ? false : plan.to ? undefined : true;

  // bestEffortDeliver is not in the plan; use delivery-first precedence
  const bestEffortDeliver = delivery?.bestEffort ?? payload?.bestEffortDeliver;

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

    // Delivery options from canonical plan
    deliver,
    channel: plan.channel === "last" ? undefined : plan.channel,
    to: plan.to,
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
