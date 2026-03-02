import { describe, expect, it, vi } from "vitest";
import { type BatchLifecycleAdapter, waitForBatch } from "./batch-lifecycle.js";

type FakeStatus = {
  state: string;
  outputFileId?: string;
  errorMessage?: string;
};

function makeAdapter(
  overrides: Partial<BatchLifecycleAdapter<FakeStatus>> = {},
): BatchLifecycleAdapter<FakeStatus> {
  return {
    label: "test",
    fetchStatus: vi.fn().mockResolvedValue({ state: "unknown" }),
    resolveState: (s) => s.state,
    isCompleted: (state) => state === "completed",
    isFailed: (state) => state === "failed",
    resolveOutputFileId: (s) => s.outputFileId,
    ...overrides,
  };
}

describe("waitForBatch", () => {
  it("returns immediately when initial status is already completed", async () => {
    const adapter = makeAdapter({ fetchStatus: vi.fn() });
    const initial: FakeStatus = { state: "completed", outputFileId: "file-001" };

    const result = await waitForBatch({
      adapter,
      batchId: "batch-1",
      wait: true,
      pollIntervalMs: 1,
      timeoutMs: 5000,
      initial,
    });

    expect(result.outputFileId).toBe("file-001");
    // fetchStatus must NOT be called — initial was already completed
    expect(adapter.fetchStatus).not.toHaveBeenCalled();
  });

  it("polls until completed and returns output file ID", async () => {
    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce({ state: "in_progress" })
      .mockResolvedValueOnce({ state: "in_progress" })
      .mockResolvedValueOnce({ state: "completed", outputFileId: "file-final" });

    const adapter = makeAdapter({ fetchStatus });

    const result = await waitForBatch({
      adapter,
      batchId: "batch-2",
      wait: true,
      pollIntervalMs: 1,
      timeoutMs: 5000,
    });

    expect(result.outputFileId).toBe("file-final");
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });

  it("throws when completed without output file ID", async () => {
    const adapter = makeAdapter({
      fetchStatus: vi.fn().mockResolvedValue({ state: "completed", outputFileId: undefined }),
    });

    await expect(
      waitForBatch({
        adapter,
        batchId: "batch-3",
        wait: true,
        pollIntervalMs: 1,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow("test batch batch-3 completed without output file");
  });

  it("throws immediately when failed state is detected", async () => {
    const adapter = makeAdapter({
      fetchStatus: vi.fn().mockResolvedValue({ state: "failed" }),
    });

    await expect(
      waitForBatch({
        adapter,
        batchId: "batch-4",
        wait: true,
        pollIntervalMs: 1,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow("test batch batch-4 failed");
  });

  it("includes error detail from resolveErrorDetail when failed", async () => {
    const adapter = makeAdapter({
      fetchStatus: vi.fn().mockResolvedValue({ state: "failed", errorMessage: "quota exceeded" }),
      resolveErrorDetail: async (s) => s.errorMessage,
    });

    await expect(
      waitForBatch({
        adapter,
        batchId: "batch-5",
        wait: true,
        pollIntervalMs: 1,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow("test batch batch-5 failed: quota exceeded");
  });

  it("throws wait-disabled error when wait=false and batch is not completed", async () => {
    const adapter = makeAdapter({
      fetchStatus: vi.fn().mockResolvedValue({ state: "pending" }),
    });

    await expect(
      waitForBatch({
        adapter,
        batchId: "batch-6",
        wait: false,
        pollIntervalMs: 1,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow("test batch batch-6 still pending; wait disabled");
  });

  it("throws timeout error when elapsed time exceeds timeoutMs", async () => {
    // Always return in_progress so the loop runs until timeout
    const adapter = makeAdapter({
      fetchStatus: vi.fn().mockResolvedValue({ state: "in_progress" }),
    });

    await expect(
      waitForBatch({
        adapter,
        batchId: "batch-7",
        wait: true,
        pollIntervalMs: 1,
        // timeoutMs: 0 is clamped to 1ms, which is exceeded after the first poll
        timeoutMs: 0,
      }),
    ).rejects.toThrow("test batch batch-7 timed out after 1ms");
  });

  it("calls debug callback with state and poll interval while waiting", async () => {
    const debugFn = vi.fn();
    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce({ state: "processing" })
      .mockResolvedValueOnce({ state: "completed", outputFileId: "file-debug" });

    const adapter = makeAdapter({ fetchStatus });

    await waitForBatch({
      adapter,
      batchId: "batch-8",
      wait: true,
      pollIntervalMs: 1,
      timeoutMs: 5000,
      debug: debugFn,
    });

    // pollIntervalMs: 1 is clamped to MIN_POLL_MS (250)
    expect(debugFn).toHaveBeenCalledWith("test batch batch-8 processing; waiting 250ms");
    expect(debugFn).toHaveBeenCalledTimes(1);
  });

  it("uses initial status on first iteration but fetches fresh status on subsequent polls", async () => {
    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce({ state: "completed", outputFileId: "file-polled" });

    const adapter = makeAdapter({ fetchStatus });
    const initial: FakeStatus = { state: "in_progress" };

    const result = await waitForBatch({
      adapter,
      batchId: "batch-9",
      wait: true,
      pollIntervalMs: 1,
      timeoutMs: 5000,
      initial,
    });

    // Should have polled once (initial was in_progress, then fetched completed)
    expect(result.outputFileId).toBe("file-polled");
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("sanitizes error detail by stripping newlines and truncating", async () => {
    const multilineError = "line1\nline2\rline3\ttab";
    const adapter = makeAdapter({
      fetchStatus: vi.fn().mockResolvedValue({ state: "failed", errorMessage: multilineError }),
      resolveErrorDetail: async (s) => s.errorMessage,
    });

    await expect(
      waitForBatch({
        adapter,
        batchId: "batch-sanitize",
        wait: true,
        pollIntervalMs: 1,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow("test batch batch-sanitize failed: line1 line2 line3 tab");
  });

  it("truncates overly long error detail", async () => {
    const longError = "x".repeat(3000);
    const adapter = makeAdapter({
      fetchStatus: vi.fn().mockResolvedValue({ state: "failed", errorMessage: longError }),
      resolveErrorDetail: async (s) => s.errorMessage,
    });

    const err = await waitForBatch({
      adapter,
      batchId: "batch-trunc",
      wait: true,
      pollIntervalMs: 1,
      timeoutMs: 5000,
    }).catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("…[truncated]");
    // Detail is capped at 2000 chars + truncation marker
    expect((err as Error).message.length).toBeLessThan(2100);
  });

  it("clamps pollIntervalMs to minimum 250ms", async () => {
    const debugFn = vi.fn();
    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce({ state: "processing" })
      .mockResolvedValueOnce({ state: "completed", outputFileId: "file-clamp" });

    const adapter = makeAdapter({ fetchStatus });

    await waitForBatch({
      adapter,
      batchId: "batch-clamp",
      wait: true,
      pollIntervalMs: 0, // should be clamped to 250
      timeoutMs: 5000,
      debug: debugFn,
    });

    expect(debugFn).toHaveBeenCalledWith("test batch batch-clamp processing; waiting 250ms");
  });

  it("includes label from adapter in all error messages", async () => {
    const adapter = makeAdapter({
      label: "myprovider",
      fetchStatus: vi.fn().mockResolvedValue({ state: "failed" }),
    });

    await expect(
      waitForBatch({
        adapter,
        batchId: "batch-label",
        wait: true,
        pollIntervalMs: 1,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow("myprovider batch batch-label failed");
  });
});
