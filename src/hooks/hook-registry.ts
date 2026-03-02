/**
 * Unified Hook Registry
 *
 * Single globalThis-backed registry shared by both the internal hook system
 * (HOOK.md file-based handlers) and the plugin typed hook system (HookRunner).
 *
 * WHY THIS EXISTS:
 * The codebase has two independent hook systems that each maintain module-level
 * singleton state (`const handlers = new Map<...>()` in internal-hooks.ts and
 * `let globalHookRunner` in hook-runner-global.ts). The Rolldown bundler can
 * duplicate these module-level variables across output chunks, causing hooks to
 * silently disappear. By storing state on `globalThis` via `Symbol.for()`, the
 * registry survives chunk splitting — any module that imports the registry gets
 * the same underlying Map regardless of which output chunk it lands in.
 *
 * ARCHITECTURE:
 * - One Map<string, HookRegistryEntry[]> holds ALL handlers from both systems.
 * - Each entry is tagged with a `source` so clearing can be scoped (e.g., hot-
 *   reload clears workspace/config hooks without losing plugin hooks).
 * DO NOT create module-level Maps or variables for hook storage — use this
 * registry via registerHook/getHookEntries/clearHooksBySource.
 */

/**
 * Source tag indicating where a hook handler originated.
 * Used for scoped clearing (e.g., hot-reload clears "workspace"+"config" but
 * preserves "plugin" hooks).
 */
export type HookRegistrySource = "bundled" | "workspace" | "managed" | "config" | "plugin";

/**
 * File-based hook sources that get cleared on hot-reload.
 * Plugin hooks are intentionally excluded so they survive reload.
 */
export const FILE_HOOK_SOURCES: HookRegistrySource[] = [
  "bundled",
  "workspace",
  "managed",
  "config",
];

/**
 * A single handler entry in the unified registry.
 */
export type HookRegistryEntry = {
  /** The handler function. Signature varies by hook system. */
  handler: (...args: unknown[]) => unknown;
  /** Where this handler came from — controls scoped clearing. */
  source: HookRegistrySource;
  /** Plugin identifier (set when source is "plugin"). */
  pluginId?: string;
};

type HookRegistryMap = Map<string, HookRegistryEntry[]>;

const REGISTRY_SYMBOL = Symbol.for("openclaw:hookRegistry");

/**
 * Lazily initialize and return the singleton registry Map.
 * Same pattern as src/plugins/runtime.ts — survives bundler chunk splitting.
 */
function getRegistry(): HookRegistryMap {
  const g = globalThis as typeof globalThis & { [REGISTRY_SYMBOL]?: HookRegistryMap };
  if (!g[REGISTRY_SYMBOL]) {
    g[REGISTRY_SYMBOL] = new Map();
  }
  return g[REGISTRY_SYMBOL];
}

/**
 * Register a hook handler in the unified registry.
 *
 * @param key - Event key (e.g., "command", "command:new", "message_received")
 * @param handler - The handler function
 * @param opts - Source tag, optional pluginId
 *
 * @example
 * ```ts
 * registerHook("command:new", myHandler, { source: "workspace" });
 * registerHook("message_received", pluginHandler, { source: "plugin", pluginId: "my-plugin" });
 * ```
 */
export function registerHook(
  key: string,
  handler: (...args: unknown[]) => unknown,
  opts: { source: HookRegistrySource; pluginId?: string },
): void {
  const registry = getRegistry();
  if (!registry.has(key)) {
    registry.set(key, []);
  }
  registry.get(key)!.push({
    handler,
    source: opts.source,
    pluginId: opts.pluginId,
  });
}

/**
 * Unregister a specific handler by reference.
 *
 * @param key - Event key the handler was registered for
 * @param handler - The handler function to remove (matched by reference)
 */
export function unregisterHook(key: string, handler: (...args: unknown[]) => unknown): void {
  const registry = getRegistry();
  const entries = registry.get(key);
  if (!entries) {
    return;
  }
  const index = entries.findIndex((e) => e.handler === handler);
  if (index !== -1) {
    entries.splice(index, 1);
  }
  if (entries.length === 0) {
    registry.delete(key);
  }
}

/**
 * Clear all handlers matching the given source tags.
 * Handlers from other sources are preserved.
 *
 * This is the key mechanism for safe hot-reload: clearing "workspace"+"config"+
 * "managed"+"bundled" hooks on reload preserves "plugin" hooks that were
 * registered during plugin initialization.
 *
 * @param sources - Array of source tags to clear
 *
 * @example
 * ```ts
 * // Hot-reload: clear file-based hooks, keep plugin hooks
 * clearHooksBySource(["bundled", "workspace", "managed", "config"]);
 * ```
 */
export function clearHooksBySource(sources: HookRegistrySource[]): void {
  const sourceSet = new Set(sources);
  const registry = getRegistry();
  for (const [key, entries] of registry) {
    const remaining = entries.filter((e) => !sourceSet.has(e.source));
    if (remaining.length === 0) {
      registry.delete(key);
    } else {
      registry.set(key, remaining);
    }
  }
}

/**
 * Clear ALL handlers from the registry. Use only in tests.
 */
export function clearAllHooks(): void {
  getRegistry().clear();
}

/**
 * Get all entries for a given event key.
 *
 * @param key - Event key to look up
 * @returns Array of hook entries (empty if none registered)
 */
export function getHookEntries(key: string): HookRegistryEntry[] {
  return getRegistry().get(key) ?? [];
}

/**
 * Check whether any handlers are registered for a given event key.
 */
export function hasHooks(key: string): boolean {
  const entries = getRegistry().get(key);
  return entries !== undefined && entries.length > 0;
}

/**
 * Get all registered event keys. Useful for debugging and testing.
 */
export function getRegisteredKeys(): string[] {
  return Array.from(getRegistry().keys());
}
