import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../../config/sessions.js";

const mockLoadConfig = vi.fn();
const mockLoadSessionStore = vi.fn();
const mockResolveStorePath = vi.fn();
const mockUpdateSessionStore = vi.fn();
const mockLoadCombinedSessionStoreForGateway = vi.fn();
const mockBuildStatusMessage = vi.fn(() => "status text");
const mockResolveQueueSettings = vi.fn(() => ({
  mode: "collect",
  debounceMs: 0,
  cap: 0,
  dropPolicy: undefined,
}));
const mockGetFollowupQueueDepth = vi.fn(() => 0);
const mockNormalizeGroupActivation = vi.fn();
const mockResolveAgentDir = vi.fn(() => "/tmp/agent");
const mockResolveModelAuthLabel = vi.fn(() => "api-key");
const mockFormatUserTime = vi.fn(() => "12:00");
const mockResolveUserTimeFormat = vi.fn(() => "24h");
const mockResolveUserTimezone = vi.fn(() => "UTC");
const mockLoadProviderUsageSummary = vi.fn();
const mockFormatUsageWindowSummary = vi.fn();
const mockResolveUsageProviderId = vi.fn();

vi.mock("../../auto-reply/status.js", () => ({
  buildStatusMessage: mockBuildStatusMessage,
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock("../../config/sessions.js", () => ({
  loadSessionStore: mockLoadSessionStore,
  resolveStorePath: mockResolveStorePath,
  updateSessionStore: mockUpdateSessionStore,
}));

vi.mock("../../gateway/session-utils.js", () => ({
  loadCombinedSessionStoreForGateway: mockLoadCombinedSessionStoreForGateway,
}));

vi.mock("../../auto-reply/reply/queue.js", () => ({
  resolveQueueSettings: mockResolveQueueSettings,
  getFollowupQueueDepth: mockGetFollowupQueueDepth,
}));

vi.mock("../../auto-reply/group-activation.js", () => ({
  normalizeGroupActivation: mockNormalizeGroupActivation,
}));

vi.mock("../agent-scope.js", () => ({
  resolveAgentDir: mockResolveAgentDir,
}));

vi.mock("../model-auth-label.js", () => ({
  resolveModelAuthLabel: mockResolveModelAuthLabel,
}));

vi.mock("../date-time.js", () => ({
  formatUserTime: mockFormatUserTime,
  resolveUserTimeFormat: mockResolveUserTimeFormat,
  resolveUserTimezone: mockResolveUserTimezone,
}));

vi.mock("../../infra/provider-usage.js", () => ({
  loadProviderUsageSummary: mockLoadProviderUsageSummary,
  formatUsageWindowSummary: mockFormatUsageWindowSummary,
  resolveUsageProviderId: mockResolveUsageProviderId,
}));

vi.mock("../model-catalog.js", () => ({
  loadModelCatalog: vi.fn(async () => ({ models: [] })),
}));

vi.mock("../../sessions/model-overrides.js", () => ({
  applyModelOverrideToSessionEntry: vi.fn(() => ({ updated: false })),
}));

vi.mock("../model-selection.js", () => ({
  buildAllowedModelSet: vi.fn(() => ({ allowedKeys: new Set() })),
  buildModelAliasIndex: vi.fn(() => new Map()),
  modelKey: vi.fn((provider: string, model: string) => `${provider}/${model}`),
  resolveDefaultModelForAgent: vi.fn(() => ({
    provider: "anthropic",
    model: "claude-opus-4-6",
  })),
  resolveModelRefFromString: vi.fn(),
}));

vi.mock("./sessions-helpers.js", () => ({
  shouldResolveSessionIdInput: vi.fn(() => false),
  resolveInternalSessionKey: vi.fn(({ key }: { key: string }) => key),
  resolveMainSessionAlias: vi.fn(() => ({
    mainKey: "main",
    alias: "main",
  })),
  createAgentToAgentPolicy: vi.fn(() => ({
    enabled: false,
    isAllowed: () => false,
  })),
}));

vi.mock("../../routing/session-key.js", () => ({
  buildAgentMainSessionKey: vi.fn(() => "agent:main:main"),
  DEFAULT_AGENT_ID: "main",
  resolveAgentIdFromSessionKey: vi.fn(() => "main"),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createSessionStatusTool", () => {
  it("passes session-level thinkingLevel to buildStatusMessage as resolvedThink", async () => {
    const sessionEntry: SessionEntry = {
      sessionId: "sess-1",
      updatedAt: Date.now(),
      thinkingLevel: "high",
      verboseLevel: "on",
      reasoningLevel: "stream",
      elevatedLevel: "full",
    };

    const store: Record<string, SessionEntry> = {
      "agent:main:main": sessionEntry,
    };

    const cfg = {
      agents: { defaults: {} },
      session: {},
    } as unknown as import("../../config/config.js").OpenClawConfig;

    mockResolveStorePath.mockReturnValue("/tmp/store.json");
    mockLoadSessionStore.mockReturnValue(store);
    mockResolveUsageProviderId.mockReturnValue(undefined);

    const { createSessionStatusTool } = await import("./session-status-tool.js");
    const tool = createSessionStatusTool({
      agentSessionKey: "agent:main:main",
      config: cfg,
    });

    await tool.execute("call-1", { sessionKey: "agent:main:main" });

    expect(mockBuildStatusMessage).toHaveBeenCalledOnce();
    const statusArgs = (mockBuildStatusMessage.mock.calls as never[][])[0][0] as Record<
      string,
      unknown
    >;

    // The bug: resolvedThink was not passed, causing "Think: off".
    // After fix: session entry's thinkingLevel should be forwarded.
    expect(statusArgs.resolvedThink).toBe("high");
    expect(statusArgs.resolvedVerbose).toBe("on");
    expect(statusArgs.resolvedReasoning).toBe("stream");
    expect(statusArgs.resolvedElevated).toBe("full");
  });

  it("falls back gracefully when session has no thinking overrides", async () => {
    const sessionEntry: SessionEntry = {
      sessionId: "sess-2",
      updatedAt: Date.now(),
    };

    const store: Record<string, SessionEntry> = {
      "agent:main:main": sessionEntry,
    };

    const cfg = {
      agents: { defaults: {} },
      session: {},
    } as unknown as import("../../config/config.js").OpenClawConfig;

    mockResolveStorePath.mockReturnValue("/tmp/store.json");
    mockLoadSessionStore.mockReturnValue(store);
    mockResolveUsageProviderId.mockReturnValue(undefined);

    const { createSessionStatusTool } = await import("./session-status-tool.js");
    const tool = createSessionStatusTool({
      agentSessionKey: "agent:main:main",
      config: cfg,
    });

    await tool.execute("call-2", { sessionKey: "agent:main:main" });

    expect(mockBuildStatusMessage).toHaveBeenCalledOnce();
    const statusArgs = (mockBuildStatusMessage.mock.calls as never[][])[0][0] as Record<
      string,
      unknown
    >;

    // When session has no overrides, resolved values should be undefined
    // (letting buildStatusMessage use its own fallback chain).
    expect(statusArgs.resolvedThink).toBeUndefined();
    expect(statusArgs.resolvedVerbose).toBeUndefined();
    expect(statusArgs.resolvedReasoning).toBeUndefined();
    expect(statusArgs.resolvedElevated).toBeUndefined();
  });
});
