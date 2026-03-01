import { describe, expect, it } from "vitest";
import { buildWorkspaceHookStatus } from "./hooks-status.js";
import type { HookEntry } from "./types.js";

function createHookEntry(overrides?: Partial<HookEntry> & { events?: string[] }): HookEntry {
  const events = overrides?.events ?? ["command:new"];
  return {
    hook: {
      name: "test-hook",
      description: "A test hook",
      source: "openclaw-bundled",
      filePath: "/tmp/hooks/test-hook/HOOK.md",
      baseDir: "/tmp/hooks/test-hook",
      handlerPath: "/tmp/hooks/test-hook/handler.js",
      ...overrides?.hook,
    },
    frontmatter: overrides?.frontmatter ?? {},
    metadata: {
      events,
      ...overrides?.metadata,
    },
  };
}

describe("buildWorkspaceHookStatus", () => {
  it("marks hook with events as eligible", () => {
    const entry = createHookEntry({ events: ["command:new"] });
    const report = buildWorkspaceHookStatus("/tmp/workspace", { entries: [entry] });

    expect(report.hooks).toHaveLength(1);
    expect(report.hooks[0].eligible).toBe(true);
  });

  it("marks hook with no events as not eligible", () => {
    const entry = createHookEntry({ events: [] });
    const report = buildWorkspaceHookStatus("/tmp/workspace", { entries: [entry] });

    expect(report.hooks).toHaveLength(1);
    expect(report.hooks[0].eligible).toBe(false);
  });

  it("marks hook with undefined metadata as not eligible", () => {
    const entry: HookEntry = {
      hook: {
        name: "no-metadata-hook",
        description: "Hook with no metadata",
        source: "openclaw-bundled",
        filePath: "/tmp/hooks/no-metadata/HOOK.md",
        baseDir: "/tmp/hooks/no-metadata",
        handlerPath: "/tmp/hooks/no-metadata/handler.js",
      },
      frontmatter: {},
      metadata: undefined,
    };
    const report = buildWorkspaceHookStatus("/tmp/workspace", { entries: [entry] });

    expect(report.hooks).toHaveLength(1);
    // metadata?.events ?? [] yields [], so eligible should be false
    expect(report.hooks[0].eligible).toBe(false);
  });
});
