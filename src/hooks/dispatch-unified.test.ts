import { afterEach, describe, expect, it, vi } from "vitest";
import { emitGatewayStartup, emitMessageReceived, emitMessageSent } from "./dispatch-unified.js";
import { clearAllHooks, registerHook } from "./hook-registry.js";

// Mock the plugin hook runner
vi.mock("../plugins/hook-runner-global.js", () => {
  const mockRunner = {
    hasHooks: vi.fn().mockReturnValue(false),
    runMessageReceived: vi.fn().mockResolvedValue(undefined),
    runMessageSent: vi.fn().mockResolvedValue(undefined),
  };
  return {
    getGlobalHookRunner: vi.fn(() => mockRunner),
    _mockRunner: mockRunner,
  };
});

// Re-import mock after vi.mock setup
const { getGlobalHookRunner } = await import("../plugins/hook-runner-global.js");
// oxlint-disable-next-line typescript/no-explicit-any
const mockRunner = (await import("../plugins/hook-runner-global.js")) as any as {
  _mockRunner: Record<string, ReturnType<typeof vi.fn>>;
};

describe("dispatch-unified", () => {
  afterEach(() => {
    clearAllHooks();
    vi.clearAllMocks();
  });

  describe("emitMessageReceived", () => {
    it("fires plugin hook when hookRunner has message_received handlers", () => {
      mockRunner._mockRunner.hasHooks.mockReturnValue(true);
      emitMessageReceived({
        from: "+1234567890",
        content: "hello",
        channelId: "whatsapp",
        sessionKey: "session:main",
      });
      expect(mockRunner._mockRunner.runMessageReceived).toHaveBeenCalledWith(
        expect.objectContaining({ from: "+1234567890", content: "hello" }),
        expect.objectContaining({ channelId: "whatsapp" }),
      );
    });

    it("fires internal hook when sessionKey is provided", async () => {
      const captured: unknown[] = [];
      registerHook(
        "message:received",
        (event: unknown) => {
          captured.push(event);
        },
        { source: "config" },
      );
      emitMessageReceived({
        from: "+1234567890",
        content: "hello",
        channelId: "telegram",
        sessionKey: "session:main",
      });
      // Internal hook fires async (fire-and-forget)
      await vi.waitFor(() => expect(captured).toHaveLength(1));
      const event = captured[0] as Record<string, unknown>;
      expect(event).toMatchObject({
        type: "message",
        action: "received",
        sessionKey: "session:main",
      });
    });

    it("skips internal hook when sessionKey is absent", async () => {
      const captured: unknown[] = [];
      registerHook(
        "message:received",
        (event: unknown) => {
          captured.push(event);
        },
        { source: "config" },
      );
      emitMessageReceived({
        from: "+1234567890",
        content: "hello",
        channelId: "whatsapp",
      });
      // Flush microtasks — hook should NOT have fired (no sessionKey)
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      expect(captured).toHaveLength(0);
    });

    it("does not throw when hookRunner is null", () => {
      // Override mock to return null
      vi.mocked(getGlobalHookRunner).mockReturnValueOnce(null);
      expect(() => {
        emitMessageReceived({
          from: "+1234567890",
          content: "hello",
          channelId: "whatsapp",
        });
      }).not.toThrow();
    });
  });

  describe("emitMessageSent", () => {
    it("fires plugin hook when hookRunner has message_sent handlers", () => {
      mockRunner._mockRunner.hasHooks.mockReturnValue(true);
      emitMessageSent({
        to: "+0987654321",
        content: "reply",
        success: true,
        channelId: "telegram",
        sessionKey: "session:main",
      });
      expect(mockRunner._mockRunner.runMessageSent).toHaveBeenCalledWith(
        expect.objectContaining({ to: "+0987654321", content: "reply", success: true }),
        expect.objectContaining({ channelId: "telegram" }),
      );
    });

    it("fires internal hook with sessionKey", async () => {
      const captured: unknown[] = [];
      registerHook(
        "message:sent",
        (event: unknown) => {
          captured.push(event);
        },
        { source: "config" },
      );
      emitMessageSent({
        to: "+0987654321",
        content: "reply",
        success: true,
        channelId: "whatsapp",
        sessionKey: "test:session",
      });
      await vi.waitFor(() => expect(captured).toHaveLength(1));
    });

    it("includes error field when present", () => {
      mockRunner._mockRunner.hasHooks.mockReturnValue(true);
      emitMessageSent({
        to: "+0987654321",
        content: "reply",
        success: false,
        error: "network timeout",
        channelId: "slack",
      });
      expect(mockRunner._mockRunner.runMessageSent).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: "network timeout" }),
        expect.anything(),
      );
    });
  });

  describe("emitGatewayStartup", () => {
    it("fires gateway:startup internal hook synchronously", async () => {
      const captured: unknown[] = [];
      registerHook(
        "gateway:startup",
        (event: unknown) => {
          captured.push(event);
        },
        { source: "config" },
      );
      emitGatewayStartup({
        cfg: { hooks: { internal: { enabled: true } } },
        workspaceDir: "/tmp/test",
      });
      // Fire-and-forget but should resolve within a tick
      await vi.waitFor(() => expect(captured).toHaveLength(1));
    });

    it("also fires on the general 'gateway' key", async () => {
      const captured: unknown[] = [];
      registerHook(
        "gateway",
        (event: unknown) => {
          captured.push(event);
        },
        { source: "config" },
      );
      emitGatewayStartup({ cfg: {} });
      await vi.waitFor(() => expect(captured).toHaveLength(1));
    });

    it("does not throw when no handlers registered", () => {
      expect(() => {
        emitGatewayStartup({ cfg: {} });
      }).not.toThrow();
    });
  });
});
