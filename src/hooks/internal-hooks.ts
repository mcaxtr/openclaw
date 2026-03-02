/**
 * Hook system for OpenClaw agent events
 *
 * Provides an extensible event-driven hook system for agent events
 * like command processing, session lifecycle, etc.
 *
 * Backed by unified hook registry — see hook-registry.ts
 */

import type { WorkspaceBootstrapFile } from "../agents/workspace.js";
import type { CliDeps } from "../cli/deps.js";
import type { OpenClawConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  clearHooksBySource,
  FILE_HOOK_SOURCES,
  getHookEntries,
  getRegisteredKeys,
  registerHook,
  unregisterHook,
  type HookRegistrySource,
} from "./hook-registry.js";

export type InternalHookEventType = "command" | "session" | "agent" | "gateway" | "message";

export type AgentBootstrapHookContext = {
  workspaceDir: string;
  bootstrapFiles: WorkspaceBootstrapFile[];
  cfg?: OpenClawConfig;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
};

export type AgentBootstrapHookEvent = InternalHookEvent & {
  type: "agent";
  action: "bootstrap";
  context: AgentBootstrapHookContext;
};

export type GatewayStartupHookContext = {
  cfg?: OpenClawConfig;
  deps?: CliDeps;
  workspaceDir?: string;
};

export type GatewayStartupHookEvent = InternalHookEvent & {
  type: "gateway";
  action: "startup";
  context: GatewayStartupHookContext;
};

// ============================================================================
// Message Hook Events
// ============================================================================

export type MessageReceivedHookContext = {
  /** Sender identifier (e.g., phone number, user ID) */
  from: string;
  /** Message content */
  content: string;
  /** Unix timestamp when the message was received */
  timestamp?: number;
  /** Channel identifier (e.g., "telegram", "whatsapp") */
  channelId: string;
  /** Provider account ID for multi-account setups */
  accountId?: string;
  /** Conversation/chat ID */
  conversationId?: string;
  /** Message ID from the provider */
  messageId?: string;
  /** Additional provider-specific metadata */
  metadata?: Record<string, unknown>;
};

export type MessageReceivedHookEvent = InternalHookEvent & {
  type: "message";
  action: "received";
  context: MessageReceivedHookContext;
};

export type MessageSentHookContext = {
  /** Recipient identifier */
  to: string;
  /** Message content */
  content: string;
  /** Whether the message was sent successfully */
  success: boolean;
  /** Error message if sending failed */
  error?: string;
  /** Channel identifier (e.g., "telegram", "whatsapp") */
  channelId: string;
  /** Provider account ID for multi-account setups */
  accountId?: string;
  /** Conversation/chat ID */
  conversationId?: string;
  /** Message ID returned by the provider */
  messageId?: string;
};

export type MessageSentHookEvent = InternalHookEvent & {
  type: "message";
  action: "sent";
  context: MessageSentHookContext;
};

export interface InternalHookEvent {
  /** The type of event (command, session, agent, gateway, etc.) */
  type: InternalHookEventType;
  /** The specific action within the type (e.g., 'new', 'reset', 'stop') */
  action: string;
  /** The session key this event relates to */
  sessionKey: string;
  /** Additional context specific to the event */
  context: Record<string, unknown>;
  /** Timestamp when the event occurred */
  timestamp: Date;
  /** Messages to send back to the user (hooks can push to this array) */
  messages: string[];
}

export type InternalHookHandler = (event: InternalHookEvent) => Promise<void> | void;

const log = createSubsystemLogger("internal-hooks");

/**
 * Map from hook file source names to unified registry source tags.
 *
 * @see HookRegistrySource in hook-registry.ts
 */
const FILE_SOURCE_TO_REGISTRY: Record<string, HookRegistrySource> = {
  "openclaw-bundled": "bundled",
  "openclaw-workspace": "workspace",
  "openclaw-managed": "managed",
  "openclaw-plugin": "plugin",
};

/**
 * Register a hook handler for a specific event type or event:action combination.
 *
 * Delegates to the unified hook registry with source tagging. The optional
 * `source` parameter controls which registry source tag is applied — this
 * determines whether the handler survives source-scoped clearing.
 *
 * @param eventKey - Event type (e.g., 'command') or specific action (e.g., 'command:new')
 * @param handler - Function to call when the event is triggered
 * @param source - Registry source tag. Defaults to "config". Use "plugin" for
 *   plugin-registered hooks so they survive clearInternalHooks().
 *
 * @example
 * ```ts
 * // Listen to all command events (default source: "config")
 * registerInternalHook('command', async (event) => {
 *   console.log('Command:', event.action);
 * });
 *
 * // Listen only to /new commands with explicit source
 * registerInternalHook('command:new', handler, 'workspace');
 *
 * // Plugin-registered hook (survives clearInternalHooks)
 * registerInternalHook('command:new', handler, 'plugin');
 * ```
 */
export function registerInternalHook(
  eventKey: string,
  handler: InternalHookHandler,
  source?: string,
): void {
  const registrySource: HookRegistrySource =
    (source ? (FILE_SOURCE_TO_REGISTRY[source] ?? (source as HookRegistrySource)) : undefined) ??
    "config";
  registerHook(eventKey, handler as (...args: unknown[]) => unknown, {
    source: registrySource,
  });
}

/**
 * Unregister a specific hook handler.
 *
 * @param eventKey - Event key the handler was registered for
 * @param handler - The handler function to remove (matched by reference)
 */
export function unregisterInternalHook(eventKey: string, handler: InternalHookHandler): void {
  unregisterHook(eventKey, handler as (...args: unknown[]) => unknown);
}

/**
 * Clear internal hooks registered from file-based and config sources.
 *
 * Clears "bundled", "workspace", "managed", and "config" source hooks while
 * **preserving** "plugin" source hooks. This prevents the bug where gateway
 * hot-reload would wipe plugin hooks that were registered during plugin init.
 *
 * For tests that need a complete wipe, use `clearAllHooks()` from
 * `hook-registry.ts` instead.
 */
export function clearInternalHooks(): void {
  clearHooksBySource(FILE_HOOK_SOURCES);
}

/**
 * Get all registered event keys (useful for debugging).
 *
 * Returns keys from the unified registry.
 */
export function getRegisteredEventKeys(): string[] {
  return getRegisteredKeys();
}

/**
 * Trigger a hook event.
 *
 * Calls all handlers registered for:
 * 1. The general event type (e.g., 'command')
 * 2. The specific event:action combination (e.g., 'command:new')
 *
 * Errors are caught and logged but don't prevent other handlers from running.
 *
 * @param event - The event to trigger
 */
export async function triggerInternalHook(event: InternalHookEvent): Promise<void> {
  const typeEntries = getHookEntries(event.type);
  const specificEntries = getHookEntries(`${event.type}:${event.action}`);

  const allEntries = [...typeEntries, ...specificEntries];

  if (allEntries.length === 0) {
    return;
  }

  for (const entry of allEntries) {
    try {
      await (entry.handler as InternalHookHandler)(event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Hook error [${event.type}:${event.action}]: ${message}`);
    }
  }
}

/**
 * Create a hook event with common fields filled in
 *
 * @param type - The event type
 * @param action - The action within that type
 * @param sessionKey - The session key
 * @param context - Additional context
 */
export function createInternalHookEvent(
  type: InternalHookEventType,
  action: string,
  sessionKey: string,
  context: Record<string, unknown> = {},
): InternalHookEvent {
  return {
    type,
    action,
    sessionKey,
    context,
    timestamp: new Date(),
    messages: [],
  };
}

export function isAgentBootstrapEvent(event: InternalHookEvent): event is AgentBootstrapHookEvent {
  if (event.type !== "agent" || event.action !== "bootstrap") {
    return false;
  }
  const context = event.context as Partial<AgentBootstrapHookContext> | null;
  if (!context || typeof context !== "object") {
    return false;
  }
  if (typeof context.workspaceDir !== "string") {
    return false;
  }
  return Array.isArray(context.bootstrapFiles);
}

export function isGatewayStartupEvent(event: InternalHookEvent): event is GatewayStartupHookEvent {
  if (event.type !== "gateway" || event.action !== "startup") {
    return false;
  }
  const context = event.context as GatewayStartupHookContext | null;
  return Boolean(context && typeof context === "object");
}

export function isMessageReceivedEvent(
  event: InternalHookEvent,
): event is MessageReceivedHookEvent {
  if (event.type !== "message" || event.action !== "received") {
    return false;
  }
  const context = event.context as Partial<MessageReceivedHookContext> | null;
  if (!context || typeof context !== "object") {
    return false;
  }
  return typeof context.from === "string" && typeof context.channelId === "string";
}

export function isMessageSentEvent(event: InternalHookEvent): event is MessageSentHookEvent {
  if (event.type !== "message" || event.action !== "sent") {
    return false;
  }
  const context = event.context as Partial<MessageSentHookContext> | null;
  if (!context || typeof context !== "object") {
    return false;
  }
  return (
    typeof context.to === "string" &&
    typeof context.channelId === "string" &&
    typeof context.success === "boolean"
  );
}
