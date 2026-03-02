/**
 * Unified Dispatch Helpers for Overlapping Hook Events
 *
 * WHY THIS EXISTS:
 * Three events (message_received, message_sent, gateway:startup) exist in both
 * the internal hook system (HOOK.md handlers) and the plugin typed hook system
 * (HookRunner). Previously each call site manually duplicated 15-30 lines of
 * dual-dispatch code. These helpers co-locate both dispatch calls in one place.
 *
 * WHEN TO USE:
 * - `emitMessageReceived()` — when an inbound message arrives (replaces dual dispatch in dispatch-from-config.ts)
 * - `emitMessageSent()` — when an outbound message is delivered (replaces dual dispatch in deliver.ts)
 * - `emitGatewayStartup()` — when the gateway finishes loading hooks/channels (replaces setTimeout in server-startup.ts)
 *
 * For events that only exist in ONE system, call that system directly:
 * - Internal-only events: use `triggerInternalHook()` directly
 * - Plugin-only events: use `hookRunner.run*()` directly
 *
 * When adding a new event that needs both systems, add a helper here.
 */

import type { CliDeps } from "../cli/deps.js";
import type { OpenClawConfig } from "../config/config.js";
import { logVerbose } from "../globals.js";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import { createInternalHookEvent, triggerInternalHook } from "./internal-hooks.js";

/**
 * Emit a message_received event through both hook systems (fire-and-forget).
 *
 * Fires:
 * - Plugin typed hook: `message_received` via HookRunner
 * - Internal hook: `message:received` via triggerInternalHook
 *
 * @example
 * ```ts
 * emitMessageReceived({
 *   from: ctx.From ?? "",
 *   content: messageText,
 *   channelId: "telegram",
 *   sessionKey: ctx.SessionKey,
 * });
 * ```
 */
export function emitMessageReceived(params: {
  from: string;
  content: string;
  timestamp?: number;
  channelId: string;
  accountId?: string;
  conversationId?: string;
  messageId?: string;
  metadata?: Record<string, unknown>;
  /** Required for internal hooks. If absent, only plugin hooks fire. */
  sessionKey?: string;
}): void {
  const hookRunner = getGlobalHookRunner();

  // Plugin typed hook (fire-and-forget)
  if (hookRunner?.hasHooks("message_received")) {
    void hookRunner
      .runMessageReceived(
        {
          from: params.from,
          content: params.content,
          timestamp: params.timestamp,
          metadata: params.metadata,
        },
        {
          channelId: params.channelId,
          accountId: params.accountId,
          conversationId: params.conversationId,
        },
      )
      .catch((err) => {
        logVerbose(`message_received plugin hook failed: ${String(err)}`);
      });
  }

  // Internal hook (fire-and-forget, needs sessionKey)
  if (params.sessionKey) {
    void triggerInternalHook(
      createInternalHookEvent("message", "received", params.sessionKey, {
        from: params.from,
        content: params.content,
        timestamp: params.timestamp,
        channelId: params.channelId,
        accountId: params.accountId,
        conversationId: params.conversationId,
        messageId: params.messageId,
        metadata: params.metadata,
      }),
    ).catch((err) => {
      logVerbose(`message_received internal hook failed: ${String(err)}`);
    });
  }
}

/**
 * Emit a message_sent event through both hook systems (fire-and-forget).
 *
 * Fires:
 * - Plugin typed hook: `message_sent` via HookRunner
 * - Internal hook: `message:sent` via triggerInternalHook
 *
 * @example
 * ```ts
 * emitMessageSent({
 *   to: recipientId,
 *   content: messageText,
 *   success: true,
 *   channelId: "whatsapp",
 *   sessionKey: currentSessionKey,
 * });
 * ```
 */
export function emitMessageSent(params: {
  to: string;
  content: string;
  success: boolean;
  error?: string;
  channelId: string;
  accountId?: string;
  conversationId?: string;
  messageId?: string;
  /** Required for internal hooks. If absent, only plugin hooks fire. */
  sessionKey?: string;
}): void {
  const hookRunner = getGlobalHookRunner();

  // Plugin typed hook (fire-and-forget)
  if (hookRunner?.hasHooks("message_sent")) {
    void hookRunner
      .runMessageSent(
        {
          to: params.to,
          content: params.content,
          success: params.success,
          error: params.error,
        },
        {
          channelId: params.channelId,
          accountId: params.accountId,
          conversationId: params.conversationId,
        },
      )
      .catch((err) => {
        logVerbose(`message_sent plugin hook failed: ${String(err)}`);
      });
  }

  // Internal hook (fire-and-forget, needs sessionKey)
  if (params.sessionKey) {
    void triggerInternalHook(
      createInternalHookEvent("message", "sent", params.sessionKey, {
        to: params.to,
        content: params.content,
        success: params.success,
        error: params.error,
        channelId: params.channelId,
        accountId: params.accountId,
        conversationId: params.conversationId,
        messageId: params.messageId,
      }),
    ).catch((err) => {
      logVerbose(`message_sent internal hook failed: ${String(err)}`);
    });
  }
}

/**
 * Emit gateway:startup internal hook event synchronously (no setTimeout).
 *
 * This should be called AFTER loadInternalHooks() completes so all handlers
 * are registered. The previous implementation used `setTimeout(250)` which
 * created a race condition.
 *
 * Note: This is separate from the `gateway_start` plugin typed hook which
 * fires when the HTTP listener starts (in server.impl.ts). The gateway:startup
 * internal hook fires when all sidecars (hooks, channels, services) are loaded.
 */
export function emitGatewayStartup(params: {
  cfg: OpenClawConfig;
  deps?: CliDeps;
  workspaceDir?: string;
}): void {
  const hookEvent = createInternalHookEvent("gateway", "startup", "gateway:startup", {
    cfg: params.cfg,
    deps: params.deps,
    workspaceDir: params.workspaceDir,
  });
  void triggerInternalHook(hookEvent).catch((err) => {
    logVerbose(`gateway:startup hook failed: ${String(err)}`);
  });
}
