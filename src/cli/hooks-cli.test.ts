import { describe, expect, it } from "vitest";
import type { HookStatusReport } from "../hooks/hooks-status.js";
import { formatHooksCheck, formatHooksList } from "./hooks-cli.js";
import { createEmptyInstallChecks } from "./requirements-test-fixtures.js";

const report: HookStatusReport = {
  workspaceDir: "/tmp/workspace",
  managedHooksDir: "/tmp/hooks",
  hooks: [
    {
      name: "session-memory",
      description: "Save session context to memory",
      source: "openclaw-bundled",
      pluginId: undefined,
      filePath: "/tmp/hooks/session-memory/HOOK.md",
      baseDir: "/tmp/hooks/session-memory",
      handlerPath: "/tmp/hooks/session-memory/handler.js",
      hookKey: "session-memory",
      emoji: "💾",
      homepage: "https://docs.openclaw.ai/automation/hooks#session-memory",
      events: ["command:new"],
      always: false,
      disabled: false,
      eligible: true,
      managedByPlugin: false,
      ...createEmptyInstallChecks(),
    },
  ],
};

describe("hooks cli formatting", () => {
  it("labels hooks list output", () => {
    const output = formatHooksList(report, {});
    expect(output).toContain("Hooks");
    expect(output).not.toContain("Internal Hooks");
  });

  it("labels hooks status output", () => {
    const output = formatHooksCheck(report, {});
    expect(output).toContain("Hooks Status");
  });

  it("shows no-events status for hooks without events", () => {
    const noEventsReport: HookStatusReport = {
      workspaceDir: "/tmp/workspace",
      managedHooksDir: "/tmp/hooks",
      hooks: [
        {
          name: "empty-hook",
          description: "Hook with no events",
          source: "openclaw-managed",
          pluginId: undefined,
          filePath: "/tmp/hooks/empty-hook/HOOK.md",
          baseDir: "/tmp/hooks/empty-hook",
          handlerPath: "/tmp/hooks/empty-hook/handler.js",
          hookKey: "empty-hook",
          emoji: "🔗",
          homepage: undefined,
          events: [],
          always: false,
          disabled: false,
          eligible: false,
          managedByPlugin: false,
          ...createEmptyInstallChecks(),
        },
      ],
    };

    const listOutput = formatHooksList(noEventsReport, {});
    expect(listOutput).toContain("no events");

    const checkOutput = formatHooksCheck(noEventsReport, {});
    expect(checkOutput).toContain("no events defined");
  });

  it("labels plugin-managed hooks with plugin id", () => {
    const pluginReport: HookStatusReport = {
      workspaceDir: "/tmp/workspace",
      managedHooksDir: "/tmp/hooks",
      hooks: [
        {
          name: "plugin-hook",
          description: "Hook from plugin",
          source: "openclaw-plugin",
          pluginId: "voice-call",
          filePath: "/tmp/hooks/plugin-hook/HOOK.md",
          baseDir: "/tmp/hooks/plugin-hook",
          handlerPath: "/tmp/hooks/plugin-hook/handler.js",
          hookKey: "plugin-hook",
          emoji: "🔗",
          homepage: undefined,
          events: ["command:new"],
          always: false,
          disabled: false,
          eligible: true,
          managedByPlugin: true,
          ...createEmptyInstallChecks(),
        },
      ],
    };

    const output = formatHooksList(pluginReport, {});
    expect(output).toContain("plugin:voice-call");
  });
});
