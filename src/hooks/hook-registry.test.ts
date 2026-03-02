import { afterEach, describe, expect, it } from "vitest";
import {
  clearAllHooks,
  clearHooksBySource,
  getHookEntries,
  getRegisteredKeys,
  hasHooks,
  registerHook,
  unregisterHook,
} from "./hook-registry.js";

describe("hook-registry", () => {
  afterEach(() => {
    clearAllHooks();
  });

  describe("registerHook / getHookEntries", () => {
    it("registers and retrieves a handler", () => {
      const handler = () => {};
      registerHook("test:event", handler, { source: "config" });
      const entries = getHookEntries("test:event");
      expect(entries).toHaveLength(1);
      expect(entries[0].handler).toBe(handler);
      expect(entries[0].source).toBe("config");
    });

    it("returns empty array for unregistered key", () => {
      expect(getHookEntries("nonexistent")).toEqual([]);
    });

    it("supports multiple handlers on the same key", () => {
      const h1 = () => {};
      const h2 = () => {};
      registerHook("multi", h1, { source: "config" });
      registerHook("multi", h2, { source: "plugin" });
      expect(getHookEntries("multi")).toHaveLength(2);
    });

    it("stores pluginId when provided", () => {
      const handler = () => {};
      registerHook("test", handler, { source: "plugin", pluginId: "my-plugin" });
      expect(getHookEntries("test")[0].pluginId).toBe("my-plugin");
    });
  });

  describe("unregisterHook", () => {
    it("removes a handler by reference", () => {
      const handler = () => {};
      registerHook("remove-test", handler, { source: "config" });
      expect(hasHooks("remove-test")).toBe(true);
      unregisterHook("remove-test", handler);
      expect(hasHooks("remove-test")).toBe(false);
    });

    it("does not affect other handlers", () => {
      const h1 = () => {};
      const h2 = () => {};
      registerHook("partial-remove", h1, { source: "config" });
      registerHook("partial-remove", h2, { source: "plugin" });
      unregisterHook("partial-remove", h1);
      const entries = getHookEntries("partial-remove");
      expect(entries).toHaveLength(1);
      expect(entries[0].handler).toBe(h2);
    });

    it("is a no-op for unknown key", () => {
      unregisterHook("nonexistent", () => {});
    });

    it("is a no-op for unregistered handler", () => {
      const registered = () => {};
      const other = () => {};
      registerHook("ref-test", registered, { source: "config" });
      unregisterHook("ref-test", other);
      expect(hasHooks("ref-test")).toBe(true);
    });
  });

  describe("clearHooksBySource", () => {
    it("clears only specified sources", () => {
      const configHandler = () => "config";
      const pluginHandler = () => "plugin";
      const workspaceHandler = () => "workspace";
      registerHook("scoped", configHandler, { source: "config" });
      registerHook("scoped", pluginHandler, { source: "plugin" });
      registerHook("scoped", workspaceHandler, { source: "workspace" });

      clearHooksBySource(["config", "workspace"]);

      const entries = getHookEntries("scoped");
      expect(entries).toHaveLength(1);
      expect(entries[0].handler).toBe(pluginHandler);
    });

    it("preserves plugin hooks when clearing internal sources", () => {
      registerHook("a", () => {}, { source: "bundled" });
      registerHook("b", () => {}, { source: "workspace" });
      registerHook("c", () => {}, { source: "managed" });
      registerHook("d", () => {}, { source: "config" });
      registerHook("e", () => {}, { source: "plugin" });

      clearHooksBySource(["bundled", "workspace", "managed", "config"]);

      expect(hasHooks("a")).toBe(false);
      expect(hasHooks("b")).toBe(false);
      expect(hasHooks("c")).toBe(false);
      expect(hasHooks("d")).toBe(false);
      expect(hasHooks("e")).toBe(true);
    });

    it("is idempotent", () => {
      registerHook("idem", () => {}, { source: "config" });
      clearHooksBySource(["config"]);
      clearHooksBySource(["config"]);
      expect(hasHooks("idem")).toBe(false);
    });
  });

  describe("clearAllHooks", () => {
    it("removes everything", () => {
      registerHook("x", () => {}, { source: "config" });
      registerHook("y", () => {}, { source: "plugin" });
      clearAllHooks();
      expect(getRegisteredKeys()).toEqual([]);
    });
  });

  describe("hasHooks", () => {
    it("returns false for empty key", () => {
      expect(hasHooks("empty")).toBe(false);
    });

    it("returns true after registration", () => {
      registerHook("count", () => {}, { source: "config" });
      registerHook("count", () => {}, { source: "plugin" });
      expect(hasHooks("count")).toBe(true);
      expect(getHookEntries("count")).toHaveLength(2);
    });
  });

  describe("getRegisteredKeys", () => {
    it("returns all keys with registered handlers", () => {
      registerHook("alpha", () => {}, { source: "config" });
      registerHook("beta", () => {}, { source: "plugin" });
      const keys = getRegisteredKeys();
      expect(keys).toContain("alpha");
      expect(keys).toContain("beta");
    });
  });

  describe("Symbol.for singleton behavior", () => {
    it("registry survives simulated module duplication", () => {
      // Register from "this" module's perspective
      const handler = () => "singleton";
      registerHook("singleton-test", handler, { source: "config" });

      // Simulate another chunk accessing the same globalThis symbol
      const sym = Symbol.for("openclaw:hookRegistry");
      const g = globalThis as Record<symbol, unknown>;
      const registry = g[sym] as Map<string, unknown[]>;
      expect(registry).toBeInstanceOf(Map);
      expect(registry.has("singleton-test")).toBe(true);
    });
  });
});
